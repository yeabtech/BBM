import assert from "node:assert/strict";
import test from "node:test";
import type { Server } from "node:http";
import { gracefullyCloseServer } from "../../src/infrastructure/runtime/graceful-shutdown.js";

test("graceful shutdown stops HTTP accepts before draining sockets and database", async () => {
  const order: string[] = [];
  const server = {
    close(callback: (error?: Error) => void) {
      order.push("http-stop");
      queueMicrotask(() => callback());
    },
  } as unknown as Server;
  await gracefullyCloseServer(
    server,
    {
      async close() {
        order.push("websocket-drain");
      },
    },
    {
      async close() {
        order.push("database-close");
      },
    },
  );
  assert.deepEqual(order, ["http-stop", "websocket-drain", "database-close"]);
});
