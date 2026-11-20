import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import { Pool } from "pg";
import {
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@bbm/shared-contracts";
import type {
  IntervalScheduler,
  ScheduledInterval,
} from "../../src/application/ports/interval-scheduler.js";
import type { Clock } from "../../src/application/ports/security-ports.js";
import { compose } from "../../src/composition/create-server.js";
import { loadConfig } from "../../src/infrastructure/configuration/config.js";
import { loadWorkspaceEnv } from "../../src/infrastructure/configuration/load-env.js";

loadWorkspaceEnv();

class FakeClock implements Clock {
  private current: Date = new Date();
  now(): Date {
    return new Date(this.current);
  }
  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

class ManualScheduler implements IntervalScheduler {
  private readonly intervals: Array<{
    milliseconds: number;
    task: () => void | Promise<void>;
    cancelled: boolean;
  }> = [];
  every(
    milliseconds: number,
    task: () => void | Promise<void>,
  ): ScheduledInterval {
    const entry = { milliseconds, task, cancelled: false };
    this.intervals.push(entry);
    return {
      cancel: async () => {
        entry.cancelled = true;
      },
    };
  }
  async tick(milliseconds: number): Promise<void> {
    for (const interval of this.intervals) {
      if (!interval.cancelled && interval.milliseconds === milliseconds)
        await interval.task();
    }
  }
  get activeCount(): number {
    return this.intervals.filter((interval) => !interval.cancelled).length;
  }
}

class TestClient {
  readonly messages: ServerMessage[] = [];
  readonly socket: WebSocket;
  private readonly waiters: Array<{
    predicate: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(url: string) {
    this.socket = new WebSocket(url, { origin: "http://127.0.0.1:5173" });
    this.socket.on("message", (data) => {
      let decoded: unknown;
      try {
        decoded = JSON.parse(data.toString());
      } catch {
        return;
      }
      const message = parseServerMessage(decoded);
      if (!message) return;
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(message)) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    });
  }

  async open(): Promise<void> {
    await once(this.socket, "open");
  }

  request<T extends ClientMessage["type"]>(
    type: T,
    payload: Extract<ClientMessage, { type: T }>["payload"],
  ): Promise<ServerMessage> {
    const requestId = crypto.randomUUID();
    const result = this.waitFor(
      (message) =>
        message.requestId === requestId &&
        (message.type === "protocol_error" ||
          (type === "authenticate"
            ? message.type === "authenticated"
            : message.type !== "authentication_result")),
    );
    this.socket.send(
      JSON.stringify({ version: PROTOCOL_VERSION, requestId, type, payload }),
    );
    return result;
  }

  sendMessage<T extends ClientMessage["type"]>(
    type: T,
    payload: Extract<ClientMessage, { type: T }>["payload"],
  ): void {
    this.socket.send(
      JSON.stringify({
        version: PROTOCOL_VERSION,
        requestId: crypto.randomUUID(),
        type,
        payload,
      }),
    );
  }

  sendRaw(value: unknown): void {
    this.socket.send(JSON.stringify(value));
  }

  waitFor(
    predicate: (message: ServerMessage) => boolean,
  ): Promise<ServerMessage> {
    const existing = this.messages.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(
            new Error(
              `Timed out waiting for WebSocket event. Seen: ${this.messages
                .map((message) =>
                  message.type === "gameplay_snapshot"
                    ? `${message.type}#${message.payload.snapshotSequence}:${message.payload.players.map((player) => player.lastProcessedInputSequence).join(",")}`
                    : message.type,
                )
                .join(", ")}`,
            ),
          );
        }, 5_000),
      };
      this.waiters.push(waiter);
    });
  }

  count(type: ServerMessage["type"]): number {
    return this.messages.filter((message) => message.type === type).length;
  }

  close(): void {
    this.socket.close();
  }
}

async function createGuest(base: string, displayName: string) {
  const response = await fetch(`${base}/api/guests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://127.0.0.1:5173",
    },
    body: JSON.stringify({ displayName, ballSkin: "soccer" }),
  });
  const data = (await response.json()) as {
    guest?: { id: string };
    token?: string;
  };
  assert.equal(response.status, 201);
  assert.ok(data.guest?.id && data.token);
  return { id: data.guest.id, token: data.token };
}

async function connect(base: string, token: string): Promise<TestClient> {
  const url = new URL(base);
  url.protocol = "ws:";
  url.pathname = "/ws";
  const client = new TestClient(url.toString());
  await client.open();
  const authenticated = await client.request("authenticate", { token });
  assert.equal(authenticated.type, "authenticated");
  return client;
}

async function readRace<T extends Record<string, unknown>>(
  raceId: string,
  columns: string,
): Promise<T | undefined> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query<T>(
      `SELECT ${columns} FROM race_sessions WHERE race_id = $1`,
      [raceId],
    );
    return result.rows[0];
  } finally {
    await pool.end();
  }
}

async function withRuntime<T>(
  work: (
    base: string,
    runtime: ReturnType<typeof compose>,
    clock: FakeClock,
    scheduler: ManualScheduler,
  ) => Promise<T>,
): Promise<T> {
  const clock = new FakeClock();
  const scheduler = new ManualScheduler();
  const config = {
    ...loadConfig({ ...process.env, HOST: "127.0.0.1", LAN_ENABLED: "false" }),
    roomSweepMs: 60_000,
    hostGraceMs: 1_000,
    raceTickMs: 50,
  };
  const runtime = compose(config, {
    clock,
    scheduler,
    monotonicNow: () => clock.now().getTime(),
  });
  assert.ok(
    runtime.rooms && runtime.races && runtime.gateway && runtime.guests,
  );
  await runtime.races.recoverAfterRestart();
  await runtime.rooms.closeRoomsOnStartup();
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const address = runtime.server.address();
  assert.ok(address && typeof address !== "string");
  try {
    return await work(
      `http://127.0.0.1:${address.port}`,
      runtime,
      clock,
      scheduler,
    );
  } finally {
    await runtime.gateway.close();
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
    assert.equal(scheduler.activeCount, 0);
    await runtime.health.close();
  }
}

test(
  "authoritative countdown, reconnect, timeout and room-return policy persist in PostgreSQL",
  { timeout: 30_000 },
  async () => {
    await withRuntime(async (base, runtime, clock, scheduler) => {
      const host = await createGuest(base, "Race Host");
      const player = await createGuest(base, "Race Player");
      const latePlayer = await createGuest(base, "Late Player");
      const hostClient = await connect(base, host.token);
      const playerClient = await connect(base, player.token);
      const roomCreated = await hostClient.request("create_room", {});
      assert.equal(roomCreated.type, "room_created");
      if (roomCreated.type !== "room_created") return;
      const code = roomCreated.payload.room.code;
      const tooFewConnected = await hostClient.request("start_race", {});
      assert.equal(tooFewConnected.type, "protocol_error");
      if (tooFewConnected.type === "protocol_error")
        assert.equal(tooFewConnected.payload.code, "NOT_READY");
      assert.equal(
        (await playerClient.request("join_room", { code })).type,
        "room_joined",
      );
      const tooFew = await hostClient.request("start_race", {});
      assert.equal(tooFew.type, "protocol_error");
      if (tooFew.type === "protocol_error")
        assert.equal(tooFew.payload.code, "NOT_READY");
      const nonHost = await playerClient.request("start_race", {});
      assert.equal(nonHost.type, "protocol_error");
      if (nonHost.type === "protocol_error")
        assert.equal(nonHost.payload.code, "NOT_HOST");

      await hostClient.request("set_ready", { ready: true });
      const secondNotReady = await hostClient.request("start_race", {});
      assert.equal(secondNotReady.type, "protocol_error");
      if (secondNotReady.type === "protocol_error")
        assert.equal(secondNotReady.payload.code, "NOT_READY");
      await playerClient.request("set_ready", { ready: true });
      const [firstStart, repeatedStart] = await Promise.all([
        hostClient.request("start_race", {}),
        hostClient.request("start_race", {}),
      ]);
      const countdown = [firstStart, repeatedStart].find(
        (message) => message.type === "race_countdown_started",
      );
      assert.ok(countdown && countdown.type === "race_countdown_started");
      const duplicate = [firstStart, repeatedStart].find(
        (message) => message.type === "race_snapshot",
      );
      assert.ok(duplicate && duplicate.type === "race_snapshot");
      const countdownRace = countdown.payload.race;
      assert.equal(duplicate.payload.race.raceId, countdownRace.raceId);
      assert.equal(
        duplicate.payload.race.countdownDeadlineAt,
        countdownRace.countdownDeadlineAt,
      );
      const playerCountdown = await playerClient.waitFor(
        (message) => message.type === "race_countdown_started",
      );
      assert.equal(playerCountdown.type, "race_countdown_started");
      assert.equal(playerCountdown.payload.race.raceId, countdownRace.raceId);
      assert.equal(
        playerCountdown.payload.race.countdownDeadlineAt,
        countdownRace.countdownDeadlineAt,
      );
      assert.equal(hostClient.count("race_countdown_started"), 1);

      const lateClient = await connect(base, latePlayer.token);
      const deniedJoin = await lateClient.request("join_room", { code });
      assert.equal(deniedJoin.type, "protocol_error");
      if (deniedJoin.type === "protocol_error")
        assert.equal(deniedJoin.payload.code, "ROOM_RACE_ACTIVE");

      const replacement = await connect(base, player.token);
      const auth = await replacement.waitFor(
        (message) => message.type === "authenticated",
      );
      assert.equal(auth.type, "authenticated");
      assert.equal(auth.payload.race?.raceId, countdownRace.raceId);
      assert.equal(
        auth.payload.race?.countdownDeadlineAt,
        countdownRace.countdownDeadlineAt,
      );

      const startedHost = hostClient.waitFor(
        (message) => message.type === "race_started",
      );
      const startedPlayer = replacement.waitFor(
        (message) => message.type === "race_started",
      );
      clock.advance(3_000);
      await scheduler.tick(50);
      const [hostStartEvent, playerStartEvent] = await Promise.all([
        startedHost,
        startedPlayer,
      ]);
      assert.equal(hostStartEvent.type, "race_started");
      assert.equal(playerStartEvent.type, "race_started");
      if (
        hostStartEvent.type !== "race_started" ||
        playerStartEvent.type !== "race_started"
      )
        return;
      assert.equal(
        hostStartEvent.payload.race.officialStartAt,
        countdownRace.countdownDeadlineAt,
      );
      assert.equal(
        hostStartEvent.payload.race.officialStartAt,
        playerStartEvent.payload.race.officialStartAt,
      );
      assert.equal(
        Date.parse(hostStartEvent.payload.race.timeoutDeadlineAt!) -
          Date.parse(hostStartEvent.payload.race.officialStartAt!),
        120_000,
      );

      const timeoutHost = hostClient.waitFor(
        (message) => message.type === "race_cancelled",
      );
      const timeoutPlayer = replacement.waitFor(
        (message) => message.type === "race_cancelled",
      );
      const resultsHost = hostClient.waitFor(
        (message) => message.type === "race_results",
      );
      const resultsPlayer = replacement.waitFor(
        (message) => message.type === "race_results",
      );
      clock.advance(120_000);
      await scheduler.tick(50);
      const [hostTimeout, playerTimeout, hostResults, playerResults] =
        await Promise.all([
          timeoutHost,
          timeoutPlayer,
          resultsHost,
          resultsPlayer,
        ]);
      assert.equal(hostTimeout.type, "race_cancelled");
      assert.equal(playerTimeout.type, "race_cancelled");
      if (
        hostTimeout.type !== "race_cancelled" ||
        playerTimeout.type !== "race_cancelled"
      )
        return;
      assert.equal(hostTimeout.payload.race.cancellationReason, "Timeout");
      assert.equal(hostResults.type, "race_results");
      assert.equal(playerResults.type, "race_results");
      if (hostResults.type === "race_results") {
        assert.ok(
          hostResults.payload.results.every(
            (result) => result.place === null && result.status === "unfinished",
          ),
        );
        assert.equal(
          await runtime
            .races!.results(countdownRace.raceId)
            .then((results) => results?.length),
          2,
        );
      }
      assert.equal(hostTimeout.payload.race.raceId, countdownRace.raceId);
      const savedTimeout = await readRace<{
        state: string;
        cancellation_reason: string;
      }>(countdownRace.raceId, "state, cancellation_reason");
      assert.deepEqual(savedTimeout, {
        state: "Cancelled",
        cancellation_reason: "Timeout",
      });
      const terminalEvents = hostClient.count("race_cancelled");
      assert.equal(scheduler.activeCount, 1);
      clock.advance(10_000);
      await scheduler.tick(50);
      assert.equal(hostClient.count("race_cancelled"), terminalEvents);

      const roomAgain = await lateClient.request("join_room", { code });
      assert.equal(roomAgain.type, "room_joined");
      await lateClient.request("set_ready", { ready: true });
      await replacement.request("set_ready", { ready: true });
      const secondRace = await hostClient.request("start_race", {});
      assert.equal(secondRace.type, "race_countdown_started");
      if (secondRace.type === "race_countdown_started")
        assert.notEqual(secondRace.payload.race.raceId, countdownRace.raceId);

      const hostLeaveCancel = replacement.waitFor(
        (message) =>
          message.type === "race_cancelled" &&
          message.payload.race.cancellationReason === "HostLeft",
      );
      const hostAlsoReceivesCancel = hostClient.waitFor(
        (message) =>
          message.type === "race_cancelled" &&
          message.payload.race.cancellationReason === "HostLeft",
      );
      const hostLeaveRoom = replacement.waitFor(
        (message) =>
          message.type === "room_closed" &&
          message.payload.reason === "host_left",
      );
      const hostLeft = await hostClient.request("leave_room", {});
      assert.equal(hostLeft.type, "room_closed");
      const [cancelledOnLeave, cancelledForHost, closedOnLeave] =
        await Promise.all([
          hostLeaveCancel,
          hostAlsoReceivesCancel,
          hostLeaveRoom,
        ]);
      assert.equal(cancelledOnLeave.type, "race_cancelled");
      assert.equal(cancelledForHost.type, "race_cancelled");
      assert.equal(closedOnLeave.type, "room_closed");
      hostClient.close();
      playerClient.close();
      replacement.close();
      lateClient.close();
    });
  },
);

test(
  "race results persist idempotently and mark a completed session finished",
  { timeout: 20_000 },
  async () => {
    await withRuntime(async (base, runtime, clock, scheduler) => {
      const host = await createGuest(base, "Result Host");
      const player = await createGuest(base, "Result Player");
      const hostClient = await connect(base, host.token);
      const playerClient = await connect(base, player.token);
      const created = await hostClient.request("create_room", {});
      assert.equal(created.type, "room_created");
      if (created.type !== "room_created") return;
      await playerClient.request("join_room", {
        code: created.payload.room.code,
      });
      await hostClient.request("set_ready", { ready: true });
      await playerClient.request("set_ready", { ready: true });
      const countdown = await hostClient.request("start_race", {});
      assert.equal(countdown.type, "race_countdown_started");
      if (countdown.type !== "race_countdown_started") return;
      clock.advance(3_000);
      await scheduler.tick(50);
      const results = [
        {
          guestId: host.id,
          displayName: "Result Host",
          color: "mint" as const,
          place: 1,
          finishTimeMs: 25_000,
          status: "finished" as const,
        },
        {
          guestId: player.id,
          displayName: "Result Player",
          color: "coral" as const,
          place: 2,
          finishTimeMs: 29_000,
          status: "finished" as const,
        },
      ];
      await Promise.all(
        Array.from({ length: 5 }, () =>
          runtime.races!.saveResults(
            countdown.payload.race.raceId,
            results,
            true,
          ),
        ),
      );
      assert.deepEqual(
        await runtime.races!.results(countdown.payload.race.raceId),
        results,
      );
      const race = await runtime.races!.currentForRoom(
        created.payload.room.roomId,
      );
      assert.equal(race?.state, "Finished");
      hostClient.close();
      playerClient.close();
    });
  },
);

test(
  "authenticated room members exchange authoritative movement and reconnect state",
  { timeout: 30_000 },
  async () => {
    await withRuntime(async (base, runtime, clock, scheduler) => {
      const host = await createGuest(base, "Sim Host");
      const guest = await createGuest(base, "Sim Guest");
      const outsider = await createGuest(base, "Sim Outsider");
      const hostClient = await connect(base, host.token);
      const guestClient = await connect(base, guest.token);
      const outsiderClient = await connect(base, outsider.token);
      const unauthenticatedUrl = new URL(base);
      unauthenticatedUrl.protocol = "ws:";
      unauthenticatedUrl.pathname = "/ws";
      const unauthenticatedClient = new TestClient(
        unauthenticatedUrl.toString(),
      );
      await unauthenticatedClient.open();
      const room = await hostClient.request("create_room", {});
      assert.equal(room.type, "room_created");
      if (room.type !== "room_created") return;
      await guestClient.request("join_room", { code: room.payload.room.code });
      await hostClient.request("set_ready", { ready: true });
      await guestClient.request("set_ready", { ready: true });
      const startedHost = hostClient.waitFor(
        (message) => message.type === "race_started",
      );
      const startedGuest = guestClient.waitFor(
        (message) => message.type === "race_started",
      );
      const start = await hostClient.request("start_race", {});
      assert.equal(start.type, "race_countdown_started");
      if (start.type !== "race_countdown_started") return;
      const hostInitialSnapshot = hostClient.waitFor(
        (message) => message.type === "gameplay_snapshot",
      );
      const guestInitialSnapshot = guestClient.waitFor(
        (message) => message.type === "gameplay_snapshot",
      );
      clock.advance(3_000);
      await scheduler.tick(50);
      const [hostRaceStart, guestRaceStart, hostInitial, guestInitial] =
        await Promise.all([
          startedHost,
          startedGuest,
          hostInitialSnapshot,
          guestInitialSnapshot,
        ]);
      assert.equal(hostRaceStart.type, "race_started");
      assert.equal(guestRaceStart.type, "race_started");
      assert.equal(hostInitial.type, "gameplay_snapshot");
      assert.equal(guestInitial.type, "gameplay_snapshot");
      if (
        hostInitial.type !== "gameplay_snapshot" ||
        guestInitial.type !== "gameplay_snapshot"
      )
        return;
      const initial = hostInitial.payload;
      const hostIndex = initial.players.findIndex(
        (player) => player.guestId === host.id,
      );
      const guestIndex = initial.players.findIndex(
        (player) => player.guestId === guest.id,
      );
      assert.notEqual(hostIndex, -1);
      assert.notEqual(guestIndex, -1);
      assert.equal(initial.raceId, start.payload.race.raceId);
      assert.equal(guestInitial.payload.raceId, initial.raceId);
      assert.deepEqual(
        initial.players.map((player) => player.x),
        [160, 220],
      );
      assert.equal(runtime.gameplay.activeSimulationCount(), 1);

      unauthenticatedClient.sendMessage("move_input", {
        raceId: initial.raceId,
        sequence: 1,
        horizontal: 1,
        jumpDown: false,
      });
      const unauthenticatedDenied = await unauthenticatedClient.waitFor(
        (message) =>
          message.type === "protocol_error" &&
          message.payload.code === "UNAUTHENTICATED",
      );
      assert.equal(unauthenticatedDenied.type, "protocol_error");

      outsiderClient.sendMessage("move_input", {
        raceId: initial.raceId,
        sequence: 1,
        horizontal: 1,
        jumpDown: false,
      });
      const outsiderDenied = await outsiderClient.waitFor(
        (message) =>
          message.type === "protocol_error" &&
          message.payload.code === "NOT_IN_RACE",
      );
      assert.equal(outsiderDenied.type, "protocol_error");

      hostClient.sendMessage("move_input", {
        raceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        sequence: 1,
        horizontal: 1,
        jumpDown: false,
      });
      const wrongRaceDenied = await hostClient.waitFor(
        (message) =>
          message.type === "protocol_error" &&
          message.payload.code === "NOT_IN_RACE",
      );
      assert.equal(wrongRaceDenied.type, "protocol_error");

      hostClient.sendMessage("move_input", {
        raceId: initial.raceId,
        sequence: 1,
        horizontal: 1,
        jumpDown: false,
      });
      const hostMoved = hostClient.waitFor(
        (message) =>
          message.type === "gameplay_snapshot" &&
          message.payload.players[hostIndex]!.lastProcessedInputSequence === 1,
      );
      const guestSawMove = guestClient.waitFor(
        (message) =>
          message.type === "gameplay_snapshot" &&
          message.payload.players[hostIndex]!.lastProcessedInputSequence === 1,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      clock.advance(50);
      await scheduler.tick(50);
      const [movedOnHost, movedOnGuest] = await Promise.all([
        hostMoved,
        guestSawMove,
      ]);
      assert.equal(movedOnHost.type, "gameplay_snapshot");
      assert.equal(movedOnGuest.type, "gameplay_snapshot");
      if (
        movedOnHost.type !== "gameplay_snapshot" ||
        movedOnGuest.type !== "gameplay_snapshot"
      )
        return;
      assert.ok(
        movedOnHost.payload.players[hostIndex]!.x >
          initial.players[hostIndex]!.x,
      );
      assert.equal(
        movedOnHost.payload.players[hostIndex]!.x,
        movedOnGuest.payload.players[hostIndex]!.x,
      );
      assert.equal(outsiderClient.count("gameplay_snapshot"), 0);
      assert.equal(unauthenticatedClient.count("gameplay_snapshot"), 0);

      const malformedRequestId = crypto.randomUUID();
      const maliciousResponse = hostClient.waitFor(
        (message) => message.requestId === malformedRequestId,
      );
      hostClient.sendRaw({
        version: PROTOCOL_VERSION,
        requestId: malformedRequestId,
        type: "move_input",
        payload: {
          raceId: initial.raceId,
          sequence: 2,
          horizontal: 1,
          jumpDown: false,
          x: 2_000_000,
          y: -5_000,
        },
      });
      const rejectedTeleport = await maliciousResponse;
      assert.equal(rejectedTeleport.type, "protocol_error");
      if (rejectedTeleport.type === "protocol_error")
        assert.equal(rejectedTeleport.payload.code, "MALFORMED_MESSAGE");

      const lastX = movedOnHost.payload.players[hostIndex]!.x;
      hostClient.close();
      const replacement = await connect(base, host.token);
      const resumed = await replacement.waitFor(
        (message) =>
          message.type === "gameplay_snapshot" &&
          message.payload.raceId === initial.raceId,
      );
      assert.equal(resumed.type, "gameplay_snapshot");
      if (resumed.type === "gameplay_snapshot") {
        const resumedHost = resumed.payload.players.find(
          (player) => player.guestId === host.id,
        )!;
        assert.equal(resumedHost.x, lastX);
        assert.equal(resumedHost.lastProcessedInputSequence, 1);
        assert.equal(resumedHost.connected, true);
      }

      const cancelled = replacement.waitFor(
        (message) => message.type === "race_cancelled",
      );
      clock.advance(120_000);
      await scheduler.tick(50);
      assert.equal((await cancelled).type, "race_cancelled");
      assert.equal(runtime.gameplay.activeSimulationCount(), 0);
      guestClient.close();
      replacement.close();
      outsiderClient.close();
      unauthenticatedClient.close();
    });
  },
);

test(
  "restart recovery cancels active sessions with ServerRestart",
  { timeout: 20_000 },
  async () => {
    await withRuntime(async (base, runtime) => {
      const host = await createGuest(base, "Restart Host");
      const player = await createGuest(base, "Restart Player");
      const hostClient = await connect(base, host.token);
      const playerClient = await connect(base, player.token);
      const room = await hostClient.request("create_room", {});
      assert.equal(room.type, "room_created");
      if (room.type !== "room_created") return;
      await playerClient.request("join_room", { code: room.payload.room.code });
      await hostClient.request("set_ready", { ready: true });
      await playerClient.request("set_ready", { ready: true });
      const started = await hostClient.request("start_race", {});
      assert.equal(started.type, "race_countdown_started");
      if (started.type !== "race_countdown_started") return;
      const recovered = await runtime.races!.recoverAfterRestart();
      assert.equal(recovered.length, 1);
      assert.equal(recovered[0]?.state, "Cancelled");
      assert.equal(recovered[0]?.cancellationReason, "ServerRestart");
      const stored = await readRace<{
        state: string;
        cancellation_reason: string;
      }>(started.payload.race.raceId, "state, cancellation_reason");
      assert.deepEqual(stored, {
        state: "Cancelled",
        cancellation_reason: "ServerRestart",
      });
      hostClient.close();
      playerClient.close();
    });
  },
);

test(
  "host grace expiry closes the room and cancels its active race",
  { timeout: 20_000 },
  async () => {
    await withRuntime(async (base, _runtime, clock, scheduler) => {
      const host = await createGuest(base, "Grace Host");
      const player = await createGuest(base, "Grace Player");
      const hostClient = await connect(base, host.token);
      const playerClient = await connect(base, player.token);
      const room = await hostClient.request("create_room", {});
      assert.equal(room.type, "room_created");
      if (room.type !== "room_created") return;
      await playerClient.request("join_room", { code: room.payload.room.code });
      await hostClient.request("set_ready", { ready: true });
      await playerClient.request("set_ready", { ready: true });
      const started = await hostClient.request("start_race", {});
      assert.equal(started.type, "race_countdown_started");
      if (started.type !== "race_countdown_started") return;

      const disconnected = playerClient.waitFor(
        (message) =>
          message.type === "room_snapshot_updated" &&
          message.payload.room.players.some(
            (member) => member.guestId === host.id && !member.connected,
          ),
      );
      hostClient.close();
      await disconnected;
      const cancelled = playerClient.waitFor(
        (message) => message.type === "race_cancelled",
      );
      const closed = playerClient.waitFor(
        (message) =>
          message.type === "room_closed" &&
          message.payload.reason === "host_timeout",
      );
      clock.advance(1_000);
      await scheduler.tick(60_000);
      const [raceCancelled, roomClosed] = await Promise.all([
        cancelled,
        closed,
      ]);
      assert.equal(raceCancelled.type, "race_cancelled");
      if (raceCancelled.type === "race_cancelled")
        assert.equal(raceCancelled.payload.race.cancellationReason, "HostLeft");
      assert.equal(roomClosed.type, "room_closed");
      assert.equal(scheduler.activeCount, 1);
      playerClient.close();
    });
  },
);

test(
  "malformed and oversized WebSocket frames are rejected without crashing the server",
  { timeout: 20_000 },
  async () => {
    await withRuntime(async (base) => {
      const url = new URL(base);
      url.protocol = "ws:";
      url.pathname = "/ws";
      const malformed = new TestClient(url.toString());
      await malformed.open();
      const malformedClosed = once(malformed.socket, "close");
      malformed.socket.send("{");
      malformed.socket.send("{");
      malformed.socket.send("{");
      const [malformedCode] = await malformedClosed;
      assert.equal(malformedCode, 1008);

      const oversized = new TestClient(url.toString());
      await oversized.open();
      const oversizedClosed = once(oversized.socket, "close");
      oversized.socket.send("x".repeat(8_193));
      const [oversizedCode] = await oversizedClosed;
      assert.equal(oversizedCode, 1009);
      const health = await fetch(new URL("/api/health", base));
      assert.equal(health.status, 200);
      assert.equal(base.startsWith("http://127.0.0.1:"), true);
      oversized.close();
    });
  },
);
