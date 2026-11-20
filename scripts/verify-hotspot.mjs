/**
 * Phase 10 LAN/hotspot verification harness.
 *
 * Starts the built BBM server bound to a real local IPv4 address with the
 * production client bundle served from the same port, then drives a full
 * two-player flow the way a phone on the hotspot would: load the client from
 * `http://<lan-ip>:<port>/`, create guests, connect WebSockets, form a room,
 * ready up, start a race, and read authoritative gameplay snapshots.
 *
 * Run with the database available: `node scripts/verify-hotspot.mjs`.
 * Read-only with respect to data it does not create; it never resets a database.
 */
import { once } from "node:events";
import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const PROTOCOL_VERSION = 3;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lanIp = Object.values(networkInterfaces())
  .flat()
  .find(
    (entry) => entry && entry.family === "IPv4" && !entry.internal,
  )?.address;
if (!lanIp) {
  console.error(
    "SKIP: no non-internal IPv4 address to represent the hotspot host.",
  );
  process.exit(2);
}
const port = 3100 + Math.floor(Math.random() * 400);
const baseUrl = `http://${lanIp}:${port}`;
const results = [];
const check = (label, ok, detail = "") => {
  results.push({ label, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`,
  );
};

const server = spawn(
  process.execPath,
  [join(root, "apps/server/dist/index.js")],
  {
    cwd: root,
    env: {
      ...process.env,
      HOST: lanIp,
      PORT: String(port),
      LAN_ENABLED: "true",
      DATABASE_REQUIRED: "true",
      CLIENT_DIST: join(root, "apps/client/dist"),
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health/db`);
      if (response.ok) return;
    } catch {
      /* server still starting */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not become healthy.\n${serverLog}`);
}

class Client {
  constructor(name) {
    this.name = name;
    this.messages = [];
    this.waiters = [];
  }
  async createGuest() {
    const response = await fetch(`${baseUrl}/api/guests`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ displayName: this.name, ballSkin: "soccer" }),
    });
    if (!response.ok) throw new Error(`guest create ${response.status}`);
    const data = await response.json();
    this.token = data.token;
    this.guest = data.guest;
  }
  async connect() {
    const url = baseUrl.replace("http", "ws");
    this.socket = new WebSocket(`${url}/ws`, { origin: baseUrl });
    this.socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString());
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.test(message)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
    await once(this.socket, "open");
    return this.request("authenticate", { token: this.token }, "authenticated");
  }
  request(type, payload, expect) {
    const requestId = crypto.randomUUID();
    const result = this.wait(
      (m) => m.requestId === requestId && m.type === expect,
    );
    this.socket.send(
      JSON.stringify({ version: PROTOCOL_VERSION, requestId, type, payload }),
    );
    return result;
  }
  wait(test) {
    const existing = this.messages.find(test);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = { test, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`timeout waiting in ${this.name}`));
      }, 8000);
    });
  }
  close() {
    this.socket?.close();
  }
}

try {
  await waitForHealth();

  const page = await fetch(`${baseUrl}/`);
  const html = await page.text();
  check(
    "client page loads from LAN address",
    page.status === 200 && html.includes("<script"),
    `${baseUrl}/`,
  );
  const asset = html.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
  const assetResponse = asset ? await fetch(`${baseUrl}/${asset}`) : null;
  check(
    "client bundle assets load over HTTP",
    assetResponse?.status === 200,
    asset ?? "missing",
  );

  const lan = await (await fetch(`${baseUrl}/api/lan-info`)).json();
  check("LAN info reports enabled hosting", lan.enabled === true);
  check("LAN info reports the client is served", lan.clientServed === true);
  check(
    "LAN info lists a usable IPv4 address",
    Array.isArray(lan.addresses) && lan.addresses.length > 0,
    lan.addresses?.join(", "),
  );
  check(
    "LAN info never advertises loopback",
    !lan.addresses.includes("127.0.0.1"),
  );

  const badOrigin = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: "http://evil.example" },
  });
  check(
    "foreign origin is rejected",
    badOrigin.status === 403,
    `status ${badOrigin.status}`,
  );

  const host = new Client("Hotspot Host");
  const guest = new Client("Hotspot Guest");
  await host.createGuest();
  await guest.createGuest();
  await host.connect();
  await guest.connect();
  check(
    "two LAN guests authenticate over WebSocket",
    Boolean(host.guest && guest.guest),
  );

  const created = await host.request("create_room", {}, "room_created");
  const code = created.payload.room.code;
  check(
    "host creates a private room",
    /^[A-HJ-NP-Z2-9]{6}$/.test(code),
    `code ${code}`,
  );

  await guest.request("join_room", { code }, "room_joined");
  const snapshot = await host.request(
    "get_snapshot",
    {},
    "room_snapshot_updated",
  );
  check("guest joins by room code", snapshot.payload.room.players.length === 2);

  await host.request("set_ready", { ready: true }, "room_snapshot_updated");
  const ready = await guest.request(
    "set_ready",
    { ready: true },
    "room_snapshot_updated",
  );
  check(
    "room becomes startable with two ready players",
    ready.payload.room.canPrepareToStart === true,
  );

  const started = await host.request(
    "start_race",
    {},
    "race_countdown_started",
  );
  check(
    "host starts Greenway Rush",
    started.payload.race.state === "Countdown",
  );

  const gameplay = await guest.wait((m) => m.type === "gameplay_snapshot");
  check(
    "authoritative gameplay snapshots reach the LAN guest",
    Array.isArray(gameplay.payload.players) &&
      gameplay.payload.players.length === 2,
  );

  host.close();
  guest.close();
} catch (error) {
  check("harness completed without error", false, error.message);
} finally {
  server.kill();
  await Promise.race([
    once(server, "exit"),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed (host ${baseUrl})`,
  );
  process.exit(failed.length === 0 ? 0 : 1);
}
