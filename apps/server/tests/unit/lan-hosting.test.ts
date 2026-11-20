import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { once } from "node:events";
import { createLanHosting } from "../../src/presentation/http/lan-hosting.js";

const lanIp = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;

function freePort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

async function listeningOn(server: Server, port: number): Promise<boolean> {
  return (
    server.listening &&
    (server.address() as { port: number } | null)?.port === port
  );
}

test("hosting starts loopback-only and enable() makes it reachable on the LAN", async (t) => {
  if (!lanIp) {
    t.skip("no non-internal IPv4 adapter on this machine");
    return;
  }
  const port = freePort();
  const server = createServer((_req, res) => res.end("ok"));
  const hosting = createLanHosting(server, port, "127.0.0.1");
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  try {
    assert.equal(hosting.enabled(), false, "localhost mode is not LAN hosting");

    await hosting.enable();

    assert.equal(hosting.enabled(), true);
    assert.ok(
      await listeningOn(server, port),
      "still listening on the same port",
    );
    // The same port is now answered on this machine's LAN address: the exact
    // path another device takes. (Windows routes the host's own LAN IP locally.)
    const response = await fetch(`http://${lanIp}:${port}/`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("enable() is idempotent and never rebinds twice", async (t) => {
  if (!lanIp) {
    t.skip("no non-internal IPv4 adapter on this machine");
    return;
  }
  const port = freePort();
  const server = createServer((_req, res) => res.end("ok"));
  const hosting = createLanHosting(server, port, "127.0.0.1");
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  try {
    await Promise.all([hosting.enable(), hosting.enable()]);
    assert.equal(hosting.enabled(), true);
    assert.ok(await listeningOn(server, port));
    await hosting.enable();
    assert.ok(await listeningOn(server, port));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a server already bound to all interfaces reports hosting immediately", async () => {
  const port = freePort();
  const server = createServer((_req, res) => res.end("ok"));
  const hosting = createLanHosting(server, port, "0.0.0.0");
  assert.equal(hosting.enabled(), true);
  await hosting.enable(); // no-op, must not throw
  assert.equal(hosting.enabled(), true);
  server.close();
});
