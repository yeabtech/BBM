import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import WebSocket from "ws";
import {
  parseServerMessage,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
} from "@bbm/shared-contracts";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compose } from "../../src/composition/create-server.js";
import { loadConfig } from "../../src/infrastructure/configuration/config.js";
import { loadWorkspaceEnv } from "../../src/infrastructure/configuration/load-env.js";

loadWorkspaceEnv();

class TestClient {
  private readonly messages: ServerMessage[] = [];
  /** Origin a browser would send: the client page's own origin. */
  static origin = "http://127.0.0.1:5173";
  private readonly waiters: Array<{
    test: (message: ServerMessage) => boolean;
    resolve: (message: ServerMessage) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  readonly socket: WebSocket;
  constructor(url: string) {
    this.socket = new WebSocket(url, { origin: TestClient.origin });
    this.socket.on("message", (data) => {
      let value: unknown;
      try {
        value = JSON.parse(data.toString());
      } catch {
        return;
      }
      const message = parseServerMessage(value);
      if (!message) return;
      this.messages.push(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.test(message)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        }
      }
    });
  }
  async open(): Promise<void> {
    await once(this.socket, "open");
  }
  async request<T extends ClientMessage["type"]>(
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
  waitFor(
    testMessage: (message: ServerMessage) => boolean,
  ): Promise<ServerMessage> {
    const existing = this.messages.find(testMessage);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        test: testMessage,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          reject(new Error("Timed out waiting for WebSocket event"));
        }, 5000),
      };
      this.waiters.push(waiter);
    });
  }
  close(): void {
    this.socket.close();
  }
}

async function createGuest(base: string, name: string) {
  const response = await fetch(`${base}/api/guests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: TestClient.origin,
    },
    body: JSON.stringify({ displayName: name, ballSkin: "soccer" }),
  });
  const data = (await response.json()) as {
    guest?: { id: string; displayName: string };
    token?: string;
  };
  assert.equal(response.status, 201);
  assert.ok(data.guest?.id && data.token);
  assert.equal(JSON.stringify(data.guest).includes(data.token!), false);
  const profileResponse = await fetch(`${base}/api/guests/me`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  const profile = (await profileResponse.json()) as Record<string, unknown>;
  assert.equal(profileResponse.status, 200);
  assert.equal("token" in profile, false);
  return {
    id: data.guest.id,
    displayName: data.guest.displayName,
    token: data.token,
  };
}

const clientDist = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../client/dist",
);
const hostedClient = existsSync(join(clientDist, "index.html"));

async function withServer<T>(
  work: (base: string) => Promise<T>,
  options: { served?: boolean } = {},
): Promise<T> {
  const config = loadConfig({
    ...process.env,
    HOST: "127.0.0.1",
    LAN_ENABLED: "false",
    ...(options.served && hostedClient ? { CLIENT_DIST: clientDist } : {}),
  });
  const runtime = compose(config);
  assert.ok(
    runtime.rooms && runtime.gateway && runtime.guests,
    "DATABASE_URL must be set for lobby integration tests",
  );
  await runtime.rooms.closeRoomsOnStartup();
  runtime.server.listen(0, "127.0.0.1");
  await once(runtime.server, "listening");
  const address = runtime.server.address();
  assert.ok(address && typeof address !== "string");
  // Browser flow: the client page is served on the same host:port as the API.
  TestClient.origin = options.served
    ? `http://127.0.0.1:${address.port}`
    : "http://127.0.0.1:5173";
  try {
    return await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await runtime.gateway.close();
    await new Promise<void>((resolve) => runtime.server.close(() => resolve()));
    await runtime.health.close();
  }
}

async function authenticatedClient(
  base: string,
  token: string,
): Promise<TestClient> {
  const url = new URL(base);
  url.protocol = "ws:";
  url.pathname = "/ws";
  const client = new TestClient(url.toString());
  await client.open();
  const auth = await client.request("authenticate", { token });
  assert.equal(auth.type, "authenticated");
  return client;
}

for (const [mode, options] of [
  ["dev client origin", {}],
  ["server-hosted client", { served: true }],
] as const) {
  test(
    `HTTP guests and three WebSocket clients share authoritative lobby state (${mode})`,
    { timeout: 30_000 },
    async () => {
      await withServer(async (base) => {
        const [host, second, third, fourth] = await Promise.all([
          createGuest(base, "Host Racer"),
          createGuest(base, "Second Racer"),
          createGuest(base, "Third Racer"),
          createGuest(base, "Fourth Racer"),
        ]);
        const hostClient = await authenticatedClient(base, host.token);
        const secondClient = await authenticatedClient(base, second.token);
        const hostRoom = await hostClient.request("create_room", {});
        assert.equal(hostRoom.type, "room_created");
        if (hostRoom.type !== "room_created") return;
        const code = hostRoom.payload.room.code;
        const duplicateCreate = await hostClient.request("create_room", {});
        assert.equal(duplicateCreate.type, "protocol_error");
        if (duplicateCreate.type === "protocol_error")
          assert.equal(duplicateCreate.payload.code, "ALREADY_IN_ROOM");
        const joined = await secondClient.request("join_room", {
          code: code.toLowerCase(),
        });
        assert.equal(joined.type, "room_joined");
        const secondJoinUpdate = await hostClient.waitFor(
          (message) =>
            message.type === "room_snapshot_updated" &&
            message.payload.room.players.length === 2,
        );
        assert.equal(secondJoinUpdate.type, "room_snapshot_updated");

        const premature = await hostClient.request("prepare_to_start", {});
        assert.equal(premature.type, "protocol_error");
        if (premature.type === "protocol_error")
          assert.equal(premature.payload.code, "NOT_READY");
        const nonHost = await secondClient.request("prepare_to_start", {});
        assert.equal(nonHost.type, "protocol_error");
        if (nonHost.type === "protocol_error")
          assert.equal(nonHost.payload.code, "NOT_HOST");

        await hostClient.request("set_ready", { ready: true });
        const allReadyFirst = await secondClient.request("set_ready", {
          ready: true,
        });
        assert.equal(allReadyFirst.type, "room_snapshot_updated");
        if (allReadyFirst.type === "room_snapshot_updated")
          assert.equal(allReadyFirst.payload.room.canPrepareToStart, true);
        const ready = await hostClient.request("prepare_to_start", {});
        assert.equal(ready.type, "ready_to_start_result");
        if (ready.type === "ready_to_start_result")
          assert.match(ready.payload.message, /No race has been started/);

        const thirdClient = await authenticatedClient(base, third.token);
        const thirdJoin = await thirdClient.request("join_room", { code });
        assert.equal(thirdJoin.type, "room_joined");
        const full = await authenticatedClient(base, fourth.token);
        const invalidCode = await full.request("join_room", { code: "AAAAAA" });
        assert.equal(invalidCode.type, "protocol_error");
        if (invalidCode.type === "protocol_error")
          assert.equal(invalidCode.payload.code, "ROOM_NOT_FOUND");
        const fourthJoin = await full.request("join_room", { code });
        assert.equal(fourthJoin.type, "protocol_error");
        if (fourthJoin.type === "protocol_error")
          assert.equal(fourthJoin.payload.code, "ROOM_FULL");

        const thirdDisconnected = hostClient.waitFor(
          (message) =>
            message.type === "room_snapshot_updated" &&
            message.payload.room.players.some(
              (player) => player.guestId === third.id && !player.connected,
            ),
        );
        thirdClient.close();
        assert.equal((await thirdDisconnected).type, "room_snapshot_updated");
        const replacement = await authenticatedClient(base, third.token);
        const restored = await replacement.request("get_snapshot", {});
        assert.equal(restored.type, "room_snapshot_updated");
        if (restored.type === "room_snapshot_updated")
          assert.equal(
            restored.payload.room.players.find(
              (player) => player.guestId === third.id,
            )?.connected,
            true,
          );

        const hostClosed = secondClient.waitFor(
          (message) =>
            message.type === "room_closed" &&
            message.payload.reason === "host_left",
        );
        const left = await hostClient.request("leave_room", {});
        assert.equal(left.type, "room_closed");
        assert.equal((await hostClosed).type, "room_closed");
        hostClient.close();
        secondClient.close();
        full.close();
        replacement.close();
      }, options);
    },
  );
}

test(
  "concurrent joins cannot overfill the final room slot",
  { timeout: 20_000 },
  async () => {
    await withServer(async (base) => {
      const [host, second, third, fourth] = await Promise.all([
        createGuest(base, "Race Host"),
        createGuest(base, "Race Two"),
        createGuest(base, "Race Three"),
        createGuest(base, "Race Four"),
      ]);
      const hostClient = await authenticatedClient(base, host.token);
      const roomMessage = await hostClient.request("create_room", {});
      assert.equal(roomMessage.type, "room_created");
      if (roomMessage.type !== "room_created") return;
      const secondClient = await authenticatedClient(base, second.token);
      assert.equal(
        (
          await secondClient.request("join_room", {
            code: roomMessage.payload.room.code,
          })
        ).type,
        "room_joined",
      );
      const thirdClient = await authenticatedClient(base, third.token);
      const fourthClient = await authenticatedClient(base, fourth.token);
      const results = await Promise.all([
        thirdClient.request("join_room", {
          code: roomMessage.payload.room.code,
        }),
        fourthClient.request("join_room", {
          code: roomMessage.payload.room.code,
        }),
      ]);
      assert.equal(
        results.filter((result) => result.type === "room_joined").length,
        1,
      );
      assert.equal(
        results.filter(
          (result) =>
            result.type === "protocol_error" &&
            result.payload.code === "ROOM_FULL",
        ).length,
        1,
      );
      const snapshot = await hostClient.request("get_snapshot", {});
      assert.equal(snapshot.type, "room_snapshot_updated");
      if (snapshot.type === "room_snapshot_updated")
        assert.equal(snapshot.payload.room.players.length, 3);
      hostClient.close();
      secondClient.close();
      thirdClient.close();
      fourthClient.close();
    });
  },
);
