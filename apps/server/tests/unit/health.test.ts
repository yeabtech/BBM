import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createApp } from "../../src/presentation/http/app.js";
import { HealthService } from "../../src/application/services/health-service.js";
import type { HealthRepository } from "../../src/application/ports/health-repository.js";

async function request(database: HealthRepository | null, path: string) {
  const server = createServer(createApp(new HealthService(database)));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No address");
  try {
    return await fetch(`http://127.0.0.1:${address.port}${path}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
test("health endpoint returns stable JSON and 200", async () => {
  const response = await request(null, "/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", service: "bbm-api" });
});
test("LAN status endpoint reports disabled defaults without exposing addresses", async () => {
  const response = await request(null, "/api/lan-info");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    enabled: false,
    port: 3000,
    addresses: [],
    clientServed: false,
    canHost: false,
  });
});
test("database health safely reports missing or unavailable database", async () => {
  const noDatabase = await request(null, "/api/health/db");
  assert.equal(noDatabase.status, 503);
  assert.deepEqual(await noDatabase.json(), {
    status: "unavailable",
    service: "postgres",
  });
  const unavailable: HealthRepository = {
    check: async () => {
      throw new Error("secret SQL details");
    },
    close: async () => {},
  };
  const failed = await request(unavailable, "/api/health/db");
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), {
    status: "unavailable",
    service: "postgres",
  });
});
