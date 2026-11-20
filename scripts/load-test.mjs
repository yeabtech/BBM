import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";

const PROTOCOL_VERSION = 3;
const base = new URL(process.env.BBM_LOAD_TEST_URL ?? "http://127.0.0.1:3000");
if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(base.hostname)) {
  throw new Error("The load test only targets a loopback host.");
}
if (base.protocol !== "http:")
  throw new Error(
    "Use local HTTP only; this procedure must not target a public service.",
  );
const origin = `http://${base.hostname}:5173`;
const rooms = boundedInteger(process.env.BBM_LOAD_TEST_ROOMS, 1, 1, 5);
const playersPerRoom = boundedInteger(
  process.env.BBM_LOAD_TEST_PLAYERS,
  3,
  2,
  3,
);
const cycles = boundedInteger(process.env.BBM_LOAD_TEST_CYCLES, 2, 1, 5);
if (rooms * cycles > 5)
  throw new Error(
    "Keep room creation at or below the server's 5/minute limit.",
  );
const raceWaitMs = boundedInteger(
  process.env.BBM_LOAD_TEST_RESULT_TIMEOUT_MS,
  130_000,
  5_000,
  300_000,
);
const requiredTokens = rooms * playersPerRoom;
const databaseHealthBefore = await databaseHealth();
if (!databaseHealthBefore.ok)
  throw new Error("Local database health check failed before the load run.");
const tokens = await getTokens(requiredTokens);
const stats = {
  messages: 0,
  bytes: 0,
  snapshots: 0,
  snapshotParseMs: 0,
  protocolErrors: 0,
  parseMs: 0,
};
const roundTrips = [];
const startedAt = Date.now();

for (let cycle = 0; cycle < cycles; cycle += 1) {
  await Promise.all(
    Array.from({ length: rooms }, (_, roomIndex) => runRoom(cycle, roomIndex)),
  );
}

const elapsedMs = Date.now() - startedAt;
const databaseHealthAfter = await databaseHealth();
roundTrips.sort((a, b) => a - b);
process.stdout.write(
  `${JSON.stringify(
    {
      target: base.origin,
      roomsPerWave: rooms,
      playersPerRoom,
      completedRaces: rooms * cycles,
      elapsedMs,
      messagesReceived: stats.messages,
      bytesReceived: stats.bytes,
      protocolErrors: stats.protocolErrors,
      gameplaySnapshots: stats.snapshots,
      meanSnapshotParseMs: stats.snapshots
        ? Number((stats.snapshotParseMs / stats.snapshots).toFixed(4))
        : 0,
      databaseHealthAfter: databaseHealthAfter.status,
      meanParseMs: stats.messages
        ? Number((stats.parseMs / stats.messages).toFixed(4))
        : 0,
      requestRttMs: {
        p50: percentile(roundTrips, 0.5),
        p95: percentile(roundTrips, 0.95),
        max: roundTrips.at(-1) ?? 0,
      },
      serverCpuAndMemory: "not collected by this client-side procedure",
    },
    null,
    2,
  )}\n`,
);

async function runRoom(cycle, roomIndex) {
  const group = tokens.slice(
    roomIndex * playersPerRoom,
    (roomIndex + 1) * playersPerRoom,
  );
  const peers = [];
  try {
    for (const token of group) peers.push(await Peer.connect(token));
    const created = await peers[0].request("create_room", {});
    if (created.type !== "room_created")
      throw new Error("Room creation rejected.");
    await Promise.all(
      peers
        .slice(1)
        .map((peer) =>
          peer.request("join_room", { code: created.payload.room.code }),
        ),
    );
    await Promise.all(
      peers.map((peer) => peer.request("set_ready", { ready: true })),
    );
    const started = await peers[0].request("start_race", {});
    if (started.type !== "race_countdown_started")
      throw new Error("Race start rejected.");

    // Reconnect one non-host during the countdown to exercise resume handling.
    const reconnecting = peers[1];
    await reconnecting.disconnect();
    await delay(100);
    peers[1] = await Peer.connect(group[1]);
    const results = await peers[0].waitFor(
      (message) => message.type === "race_results",
      raceWaitMs,
    );
    if (results.type !== "race_results")
      throw new Error("Race did not produce results.");
    await peers[0].request("leave_room", {});
    process.stdout.write(
      `cycle ${cycle + 1}, room ${roomIndex + 1}: results received\n`,
    );
  } finally {
    await Promise.all(peers.map((peer) => peer.disconnect()));
  }
}

async function databaseHealth() {
  const response = await fetch(new URL("/api/health/db", base));
  const body = await response.json();
  return { ok: response.ok, status: body.status };
}

class Peer {
  constructor() {
    const wsUrl = new URL(base);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    wsUrl.pathname = "/ws";
    wsUrl.search = "";
    this.socket = new WebSocket(wsUrl, {
      origin,
      maxPayload: 8192,
    });
    this.waiters = new Set();
    this.history = [];
    this.open = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("WebSocket open timed out.")),
        8_000,
      );
      this.socket.once("open", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    this.socket.on("message", (raw) => this.receive(raw));
    this.socket.on("error", () => {});
  }

  static async connect(token) {
    const peer = new Peer();
    await peer.open;
    const authenticated = peer.request(
      "authenticate",
      { token },
      "authenticated",
    );
    const response = await authenticated;
    if (response.type !== "authenticated")
      throw new Error("Authentication failed.");
    return peer;
  }

  request(type, payload, expected = null) {
    const requestId = randomUUID();
    const sentAt = performance.now();
    const result = this.waitFor(
      (message) =>
        message.requestId === requestId &&
        (message.type === "protocol_error" ||
          (type === "authenticate"
            ? message.type === "authenticated"
            : message.type !== "authentication_result" &&
              (!expected || message.type === expected))),
      10_000,
    );
    this.socket.send(
      JSON.stringify({ version: PROTOCOL_VERSION, requestId, type, payload }),
    );
    return result.then((message) => {
      roundTrips.push(performance.now() - sentAt);
      return message;
    });
  }

  waitFor(predicate, timeoutMs) {
    const existing = this.history.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject };
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error("Timed out waiting for a server event."));
      }, timeoutMs);
      waiter.resolve = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.add(waiter);
    });
  }

  receive(raw) {
    const text = raw.toString();
    stats.bytes += Buffer.byteLength(text);
    const before = performance.now();
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      stats.protocolErrors += 1;
      return;
    }
    stats.parseMs += performance.now() - before;
    stats.messages += 1;
    if (message.type === "gameplay_snapshot") {
      stats.snapshots += 1;
      stats.snapshotParseMs += performance.now() - before;
    }
    if (message.type === "protocol_error") stats.protocolErrors += 1;
    this.history.push(message);
    if (this.history.length > 128) this.history.shift();
    for (const waiter of this.waiters) {
      if (waiter.predicate(message)) {
        this.waiters.delete(waiter);
        waiter.resolve(message);
      }
    }
  }

  disconnect() {
    if (this.socket.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      this.socket.once("close", resolve);
      this.socket.close(1000, "Bounded load-test reconnect");
    });
  }
}

async function getTokens(count) {
  let supplied = [];
  if (process.env.BBM_LOAD_TEST_TOKENS) {
    supplied = JSON.parse(process.env.BBM_LOAD_TEST_TOKENS);
    if (
      !Array.isArray(supplied) ||
      supplied.some((token) => typeof token !== "string")
    )
      throw new Error(
        "BBM_LOAD_TEST_TOKENS must be a JSON array of guest tokens.",
      );
  }
  while (supplied.length < count) {
    const response = await fetch(new URL("/api/guests", base), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        displayName: `Load ${randomUUID().slice(0, 8)}`,
        ballSkin: "soccer",
      }),
    });
    if (!response.ok)
      throw new Error(
        `Could not create a local test guest (HTTP ${response.status}); supply existing test tokens.`,
      );
    const guest = await response.json();
    supplied.push(guest.token);
  }
  return supplied.slice(0, count);
}

function boundedInteger(raw, fallback, minimum, maximum) {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `Load-test value must be an integer from ${minimum} to ${maximum}.`,
    );
  return value;
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)
  ];
}
