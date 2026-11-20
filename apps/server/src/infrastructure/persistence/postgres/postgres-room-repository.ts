import type { PoolClient } from "pg";
import {
  RoomCodeCollisionError,
  type RoomRepository,
} from "../../../application/ports/room-repository.js";
import { DomainError } from "../../../domain/errors/domain-error.js";
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

export class PostgresRoomRepository implements RoomRepository {
  constructor(private readonly database: PostgresHealthRepository) {}

  async create(room: Room): Promise<void> {
    const client = await this.database.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO lobby_rooms(room_id, room_code, host_guest_id, status, created_at, expires_at)
         VALUES ($1, $2, $3, 'open', $4, $5)`,
        [room.id, room.code, room.hostGuestId, room.createdAt, room.expiresAt],
      );
      await this.insertMembers(client, room);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (isRoomCodeCollision(error)) throw new RoomCodeCollisionError();
      if (isActiveRoomMembershipCollision(error)) {
        throw new DomainError(
          "ALREADY_IN_ROOM",
          "Leave your current room before joining another.",
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findOpenByCode(code: string): Promise<Room | null> {
    const client = await this.database.connect();
    try {
      const result = await client.query<{ room_id: string }>(
        "SELECT room_id FROM lobby_rooms WHERE room_code = $1 AND status = 'open'",
        [code],
      );
      return result.rows[0]
        ? this.loadRoom(client, result.rows[0].room_id)
        : null;
    } finally {
      client.release();
    }
  }

  async findOpenForGuest(guestId: string): Promise<Room | null> {
    const client = await this.database.connect();
    try {
      const result = await client.query<{ room_id: string }>(
        `SELECT r.room_id FROM lobby_rooms r JOIN room_members m ON m.room_id = r.room_id
         WHERE m.guest_id = $1 AND m.left_at IS NULL AND r.status = 'open'
         ORDER BY m.joined_at DESC LIMIT 1`,
        [guestId],
      );
      return result.rows[0]
        ? this.loadRoom(client, result.rows[0].room_id)
        : null;
    } finally {
      client.release();
    }
  }

  async mutateByCode(
    code: string,
    change: (room: Room, raceActive: boolean) => void,
  ): Promise<Room> {
    return this.transaction(async (client) => {
      const result = await client.query<{
        room_id: string;
        status: RoomStatus;
      }>(
        "SELECT room_id, status FROM lobby_rooms WHERE room_code = $1 FOR UPDATE",
        [code],
      );
      const row = result.rows[0];
      if (!row)
        throw new DomainError(
          "ROOM_NOT_FOUND",
          "Room not found or unavailable.",
        );
      if (row.status !== "open")
        throw new DomainError("ROOM_CLOSED", "Room not found or unavailable.");
      const room = await this.loadRoom(client, row.room_id);
      const activeRace = await client.query<{ active: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM race_sessions WHERE room_id = $1
         AND state IN ('Countdown', 'InProgress')) AS active`,
        [row.room_id],
      );
      change(room, activeRace.rows[0]?.active ?? false);
      await this.persist(client, room);
      return room;
    });
  }

  async mutateForGuest(
    guestId: string,
    change: (room: Room) => void,
  ): Promise<Room> {
    return this.transaction(async (client) => {
      const result = await client.query<{ room_id: string }>(
        `SELECT r.room_id FROM lobby_rooms r JOIN room_members m ON m.room_id = r.room_id
         WHERE m.guest_id = $1 AND m.left_at IS NULL AND r.status = 'open'
         ORDER BY m.joined_at DESC LIMIT 1 FOR UPDATE OF r`,
        [guestId],
      );
      const row = result.rows[0];
      if (!row)
        throw new DomainError("NOT_IN_ROOM", "You are not in an open room.");
      const room = await this.loadRoom(client, row.room_id);
      change(room);
      await this.persist(client, room);
      return room;
    });
  }

  async save(room: Room): Promise<void> {
    await this.transaction((client) => this.persist(client, room));
  }

  async expireDue(
    now: Date,
  ): Promise<Array<{ roomId: string; reason: "expired" | "host_timeout" }>> {
    return this.transaction(async (client) => {
      const due = await client.query<{ room_id: string }>(
        `SELECT room_id FROM lobby_rooms WHERE status = 'open'
         AND (expires_at <= $1 OR host_disconnected_until <= $1)
         ORDER BY expires_at LIMIT 100 FOR UPDATE SKIP LOCKED`,
        [now],
      );
      const closed: Array<{
        roomId: string;
        reason: "expired" | "host_timeout";
      }> = [];
      for (const row of due.rows) {
        const room = await this.loadRoom(client, row.room_id);
        const reason = room.expireIfNeeded(now);
        if (reason === "expired" || reason === "host_timeout") {
          await this.persist(client, room);
          closed.push({ roomId: room.id, reason });
        }
      }
      return closed;
    });
  }

  async closeOpenRoomsOnStartup(): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        "UPDATE lobby_rooms SET status = 'closed', closed_at = now(), host_disconnected_until = NULL WHERE status = 'open'",
      );
      await client.query(
        "UPDATE room_members SET connected = false, ready = false, connection_id = NULL, left_at = COALESCE(left_at, now()) WHERE left_at IS NULL",
      );
    });
  }

  private async loadRoom(client: PoolClient, roomId: string): Promise<Room> {
    const roomResult = await client.query<RoomRow>(
      `SELECT room_id, room_code, host_guest_id, status, created_at, expires_at, host_disconnected_until, revision
       FROM lobby_rooms WHERE room_id = $1`,
      [roomId],
    );
    const row = roomResult.rows[0];
    if (!row)
      throw new DomainError("ROOM_NOT_FOUND", "Room not found or unavailable.");
    const memberResult = await client.query<MemberRow>(
      `SELECT guest_id, display_name, ball_color, ball_skin, ready, connected, connection_id, joined_at, left_at
       FROM room_members WHERE room_id = $1 ORDER BY joined_at, guest_id`,
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

  private async persist(client: PoolClient, room: Room): Promise<void> {
    const revision = await client.query<{ revision: number }>(
      `UPDATE lobby_rooms SET status = $2, expires_at = $3, host_disconnected_until = $4, revision = revision + 1,
       closed_at = CASE WHEN $2 = 'open' THEN NULL ELSE COALESCE(closed_at, now()) END
       WHERE room_id = $1 RETURNING revision`,
      [room.id, room.status, room.expiresAt, room.hostDisconnectedUntil],
    );
    room.revision = revision.rows[0]?.revision ?? room.revision + 1;
    await this.insertMembers(client, room);
  }

  private async insertMembers(client: PoolClient, room: Room): Promise<void> {
    for (const member of room.members) {
      await client.query(
        `INSERT INTO room_members(room_id, guest_id, display_name, ball_color, ball_skin, ready, connected, connection_id, joined_at, left_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT(room_id, guest_id) DO UPDATE SET display_name = EXCLUDED.display_name,
         ball_color = EXCLUDED.ball_color, ball_skin = EXCLUDED.ball_skin, ready = EXCLUDED.ready, connected = EXCLUDED.connected,
         connection_id = EXCLUDED.connection_id, left_at = EXCLUDED.left_at`,
        [
          room.id,
          member.guestId,
          member.displayName,
          member.color,
          member.ballSkin,
          member.ready,
          member.connected,
          member.connectionId,
          member.joinedAt,
          member.leftAt,
        ],
      );
    }
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

function isRoomCodeCollision(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "lobby_rooms_room_code_key"
  );
}

function isActiveRoomMembershipCollision(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "room_members_one_active_room_guest_idx"
  );
}
