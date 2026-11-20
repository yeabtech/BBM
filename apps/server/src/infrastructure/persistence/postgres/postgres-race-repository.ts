import type { PoolClient } from "pg";
import type {
  RaceRepository,
  RaceStartResult,
  RaceTransition,
} from "../../../application/ports/race-repository.js";
import { DomainError } from "../../../domain/errors/domain-error.js";
import {
  RaceSession,
  type RaceCancellationReason,
  type RaceState,
} from "../../../domain/entities/race-session.js";
import {
  Room,
  type RoomMember,
  type RoomStatus,
} from "../../../domain/entities/room.js";
import type {
  GuestBallSkin,
  GuestColor,
} from "../../../domain/value-objects/guest-profile.js";
import type { PostgresHealthRepository } from "./postgres-health-repository.js";
import type { RaceResultEntry } from "@bbm/shared-contracts";

interface RaceRow extends Record<string, unknown> {
  race_id: string;
  room_id: string;
  revision: number;
  state: RaceState;
  countdown_started_at: Date | null;
  countdown_deadline_at: Date | null;
  official_start_at: Date | null;
  timeout_deadline_at: Date | null;
  cancellation_reason: RaceCancellationReason | null;
  cancelled_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
interface RoomRow extends Record<string, unknown> {
  room_id: string;
  room_code: string;
  host_guest_id: string;
  status: RoomStatus;
  created_at: Date;
  expires_at: Date;
  host_disconnected_until: Date | null;
  revision: number;
}
interface MemberRow extends Record<string, unknown> {
  guest_id: string;
  display_name: string;
  ball_color: GuestColor;
  ball_skin: GuestBallSkin;
  ready: boolean;
  connected: boolean;
  connection_id: string | null;
  joined_at: Date;
  left_at: Date | null;
}

export class PostgresRaceRepository implements RaceRepository {
  constructor(private readonly database: PostgresHealthRepository) {}

  async startForHost(input: {
    guestId: string;
    connectionId: string;
    raceId: string;
    now: Date;
    countdownMs: number;
    timeoutMs: number;
  }): Promise<RaceStartResult> {
    return this.transaction(async (client) => {
      const member = await client.query<{ room_id: string }>(
        `SELECT r.room_id FROM lobby_rooms r JOIN room_members m ON m.room_id = r.room_id
         WHERE m.guest_id = $1 AND m.left_at IS NULL AND r.status = 'open'
         ORDER BY m.joined_at DESC LIMIT 1 FOR UPDATE OF r`,
        [input.guestId],
      );
      const roomId = member.rows[0]?.room_id;
      if (!roomId)
        throw new DomainError("NOT_IN_ROOM", "You are not in an open room.");
      const room = await this.loadRoom(client, roomId);
      room.assertIsHost(input.guestId, input.connectionId);

      const activeResult = await client.query<RaceRow>(
        `SELECT * FROM race_sessions WHERE room_id = $1
         AND state IN ('Countdown', 'InProgress') FOR UPDATE`,
        [roomId],
      );
      if (activeResult.rows[0])
        return { race: mapRace(activeResult.rows[0]), created: false };

      room.assertCanStartRace(input.guestId, input.connectionId, input.now);
      const race = RaceSession.waiting(input.raceId, roomId, input.now);
      race.beginCountdown(input.now, input.countdownMs);
      await this.insert(client, race);
      return { race, created: true };
    });
  }

  async findCurrentForGuest(guestId: string): Promise<RaceSession | null> {
    const client = await this.database.connect();
    try {
      const result = await client.query<RaceRow>(
        `SELECT rs.* FROM race_sessions rs
         JOIN lobby_rooms r ON r.room_id = rs.room_id
         JOIN room_members m ON m.room_id = r.room_id
         WHERE m.guest_id = $1 AND m.left_at IS NULL AND r.status = 'open'
         ORDER BY rs.created_at DESC LIMIT 1`,
        [guestId],
      );
      return result.rows[0] ? mapRace(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async findCurrentForRoom(roomId: string): Promise<RaceSession | null> {
    const client = await this.database.connect();
    try {
      const result = await client.query<RaceRow>(
        `SELECT * FROM race_sessions WHERE room_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [roomId],
      );
      return result.rows[0] ? mapRace(result.rows[0]) : null;
    } finally {
      client.release();
    }
  }

  async hasActiveRaces(): Promise<boolean> {
    const result = await this.database.query<{ active: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM race_sessions
       WHERE state IN ('Countdown', 'InProgress')) AS active`,
    );
    return result.rows[0]?.active ?? false;
  }

  async advanceDue(now: Date, timeoutMs: number): Promise<RaceTransition[]> {
    return this.transaction(async (client) => {
      const due = await client.query<{ race_id: string }>(
        `SELECT race_id FROM race_sessions WHERE
         (state = 'Countdown' AND countdown_deadline_at <= $1) OR
         (state = 'InProgress' AND timeout_deadline_at <= $1)
         ORDER BY COALESCE(countdown_deadline_at, timeout_deadline_at)
         LIMIT 100 FOR UPDATE SKIP LOCKED`,
        [now],
      );
      const transitions: RaceTransition[] = [];
      for (const row of due.rows) {
        const race = await this.loadRace(client, row.race_id);
        if (race.enterProgress(now, timeoutMs))
          transitions.push({
            snapshot: race.toSnapshot(now),
            state: "InProgress",
          });
        if (race.cancelIfTimedOut(now))
          transitions.push({
            snapshot: race.toSnapshot(now),
            state: "Cancelled",
          });
        await this.persist(client, race);
      }
      return transitions;
    });
  }

  async cancelForRoom(
    roomId: string,
    reason: RaceCancellationReason,
    now: Date,
  ): Promise<RaceSession | null> {
    return this.transaction(async (client) => {
      const result = await client.query<RaceRow>(
        `SELECT * FROM race_sessions WHERE room_id = $1
         AND state IN ('Countdown', 'InProgress') FOR UPDATE`,
        [roomId],
      );
      if (!result.rows[0]) return null;
      const race = mapRace(result.rows[0]);
      if (!race.cancel(reason, now)) return null;
      await this.persist(client, race);
      return race;
    });
  }

  async cancelActiveOnRestart(now: Date): Promise<RaceSession[]> {
    return this.transaction(async (client) => {
      const result = await client.query<{ race_id: string }>(
        `SELECT race_id FROM race_sessions WHERE state IN ('Countdown', 'InProgress')
         ORDER BY created_at FOR UPDATE SKIP LOCKED`,
      );
      const cancelled: RaceSession[] = [];
      for (const row of result.rows) {
        const race = await this.loadRace(client, row.race_id);
        if (!race.cancel("ServerRestart", now)) continue;
        await this.persist(client, race);
        cancelled.push(race);
      }
      return cancelled;
    });
  }

  async persistResults(
    raceId: string,
    finishedAt: Date,
    results: readonly RaceResultEntry[],
    finishRace: boolean,
  ): Promise<void> {
    await this.transaction(async (client) => {
      const raceResult = await client.query<RaceRow>(
        "SELECT * FROM race_sessions WHERE race_id = $1 FOR UPDATE",
        [raceId],
      );
      if (!raceResult.rows[0]) return;
      const race = mapRace(raceResult.rows[0]);
      if (finishRace && race.finish(finishedAt))
        await this.persist(client, race);
      await client.query(
        `INSERT INTO race_results(race_id, finished_at, results) VALUES ($1, $2, $3::jsonb)
         ON CONFLICT (race_id) DO NOTHING`,
        [raceId, finishedAt, JSON.stringify(results)],
      );
    });
  }

  async findResults(raceId: string): Promise<RaceResultEntry[] | null> {
    const result = await this.database.query<{ results: RaceResultEntry[] }>(
      "SELECT results FROM race_results WHERE race_id = $1",
      [raceId],
    );
    return result.rows[0]?.results ?? null;
  }

  private async insert(client: PoolClient, race: RaceSession): Promise<void> {
    await client.query(
      `INSERT INTO race_sessions(
        race_id, room_id, revision, state, countdown_started_at, countdown_deadline_at,
        official_start_at, timeout_deadline_at, cancellation_reason, cancelled_at,
        finished_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      raceValues(race),
    );
  }

  private async persist(client: PoolClient, race: RaceSession): Promise<void> {
    await client.query(
      `UPDATE race_sessions SET revision = $2, state = $3, countdown_started_at = $4,
       countdown_deadline_at = $5, official_start_at = $6, timeout_deadline_at = $7,
       cancellation_reason = $8, cancelled_at = $9, finished_at = $10, updated_at = $11
       WHERE race_id = $1`,
      [
        race.id,
        race.revision,
        race.state,
        race.countdownStartedAt,
        race.countdownDeadlineAt,
        race.officialStartAt,
        race.timeoutDeadlineAt,
        race.cancellationReason,
        race.cancelledAt,
        race.finishedAt,
        race.updatedAt,
      ],
    );
  }

  private async loadRace(
    client: PoolClient,
    raceId: string,
  ): Promise<RaceSession> {
    const result = await client.query<RaceRow>(
      "SELECT * FROM race_sessions WHERE race_id = $1",
      [raceId],
    );
    if (!result.rows[0]) throw new Error("Race session disappeared.");
    return mapRace(result.rows[0]);
  }

  private async loadRoom(client: PoolClient, roomId: string): Promise<Room> {
    const roomResult = await client.query<RoomRow>(
      `SELECT room_id, room_code, host_guest_id, status, created_at, expires_at,
       host_disconnected_until, revision FROM lobby_rooms WHERE room_id = $1`,
      [roomId],
    );
    const row = roomResult.rows[0];
    if (!row) throw new DomainError("ROOM_NOT_FOUND", "Room is unavailable.");
    const memberResult = await client.query<MemberRow>(
      `SELECT guest_id, display_name, ball_color, ball_skin, ready, connected, connection_id,
       joined_at, left_at FROM room_members WHERE room_id = $1 ORDER BY joined_at, guest_id`,
      [roomId],
    );
    const members: RoomMember[] = memberResult.rows.map((member) => ({
      guestId: member.guest_id,
      displayName: member.display_name,
      color: member.ball_color,
      ballSkin: member.ball_skin,
      ready: member.ready,
      connected: member.connected,
      connectionId: member.connection_id,
      joinedAt: member.joined_at,
      leftAt: member.left_at,
    }));
    return Room.rehydrate({
      id: row.room_id,
      code: row.room_code.trim(),
      hostGuestId: row.host_guest_id,
      status: row.status,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      hostDisconnectedUntil: row.host_disconnected_until,
      members,
      revision: row.revision,
    });
  }

  private async transaction<T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

function mapRace(row: RaceRow): RaceSession {
  return RaceSession.rehydrate({
    id: row.race_id,
    roomId: row.room_id,
    revision: row.revision,
    state: row.state,
    countdownStartedAt: row.countdown_started_at,
    countdownDeadlineAt: row.countdown_deadline_at,
    officialStartAt: row.official_start_at,
    timeoutDeadlineAt: row.timeout_deadline_at,
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function raceValues(race: RaceSession): unknown[] {
  return [
    race.id,
    race.roomId,
    race.revision,
    race.state,
    race.countdownStartedAt,
    race.countdownDeadlineAt,
    race.officialStartAt,
    race.timeoutDeadlineAt,
    race.cancellationReason,
    race.cancelledAt,
    race.finishedAt,
    race.createdAt,
    race.updatedAt,
  ];
}
