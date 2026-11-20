import assert from "node:assert/strict";
import test from "node:test";
import {
  checkServerHealth,
  isBbmServer,
  parseServerAddress,
  serverAddressParts,
} from "../src/networking/server-address.js";

test("LAN server address validates host and numeric port", () => {
  assert.equal(
    parseServerAddress("192.168.1.12", "3000"),
    "http://192.168.1.12:3000",
  );
  assert.equal(
    parseServerAddress("bbm-host.local", "65535"),
    "http://bbm-host.local:65535",
  );
  assert.equal(parseServerAddress("::1", "3000"), "http://[::1]:3000");
  assert.throws(() => parseServerAddress("", "3000"), /valid host/);
  assert.throws(() => parseServerAddress("bad/path", "3000"), /valid host/);
  assert.throws(() => parseServerAddress("192.168.1.12", "0"), /port/);
  assert.throws(() => parseServerAddress("192.168.1.12", "65536"), /port/);
  assert.throws(() => parseServerAddress("192.168.1.12", "abc"), /port/);
});

test("configured server address fields preserve bracketed IPv6 host syntax", () => {
  assert.deepEqual(serverAddressParts("http://[::1]:3000"), {
    host: "::1",
    port: "3000",
  });
});

test("server health check reports unreachable hosts and timeouts clearly", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await assert.rejects(
      checkServerHealth("http://192.0.2.5:3000"),
      /Could not reach that host/,
    );
    globalThis.fetch = async () => {
      throw new DOMException("timed out", "TimeoutError");
    };
    await assert.rejects(
      checkServerHealth("http://192.0.2.5:3000"),
      /timed out/,
    );
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(
      checkServerHealth("http://192.0.2.5:3000"),
      /database is unavailable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("BBM server detection accepts the LAN API and rejects static-host fallbacks", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "http://192.168.1.12:3000/api/lan-info");
      return Response.json({
        enabled: true,
        port: 3000,
        addresses: ["192.168.1.12"],
        interfaces: [{ address: "192.168.1.12", interface: "Wi-Fi" }],
        clientServed: true,
        canHost: false,
      });
    };
    assert.equal(await isBbmServer("http://192.168.1.12:3000"), true);

    globalThis.fetch = async () =>
      new Response("<!doctype html><html></html>", {
        headers: { "Content-Type": "text/html" },
      });
    assert.equal(await isBbmServer("http://192.168.1.12:3000"), false);

    globalThis.fetch = async () => Response.json({ enabled: true });
    assert.equal(await isBbmServer("http://192.168.1.12:3000"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
