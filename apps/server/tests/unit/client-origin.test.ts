import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import {
  isAllowedClientOrigin,
  requestHostname,
  requestPort,
} from "../../src/presentation/http/client-origin.js";

const hotspot = {
  allowedOrigins: [] as string[],
  production: false,
  servesClient: true,
};
const serveOnly = {
  allowedOrigins: [] as string[],
  production: false,
  servesClient: false,
};
const production = {
  allowedOrigins: ["https://bbm.example"],
  production: true,
  servesClient: true,
};

test("same-origin hotspot client is accepted when the server serves the bundle", () => {
  assert.equal(
    isAllowedClientOrigin(
      "http://192.168.1.20:3000",
      "192.168.1.20",
      3000,
      hotspot,
    ),
    true,
  );
  assert.equal(
    isAllowedClientOrigin(
      "http://172.20.10.4:8080",
      "172.20.10.4",
      8080,
      hotspot,
    ),
    true,
  );
});

test("same-origin client on the default HTTP port is accepted", () => {
  // Browsers omit `:80` from the Origin header while the Host header keeps it.
  assert.equal(
    isAllowedClientOrigin("http://192.168.1.20", "192.168.1.20", 80, hotspot),
    true,
  );
});

test("same-origin acceptance stays off when the server does not serve the bundle", () => {
  assert.equal(
    isAllowedClientOrigin(
      "http://192.168.1.20:3000",
      "192.168.1.20",
      3000,
      serveOnly,
    ),
    false,
  );
});

test("cross-origin and non-HTTP origins stay rejected in hotspot mode", () => {
  const cases: Array<[string, string, number]> = [
    ["http://evil.example:3000", "192.168.1.20", 3000],
    ["http://192.168.1.21:3000", "192.168.1.20", 3000],
    ["http://192.168.1.20:4000", "192.168.1.20", 3000],
    ["https://192.168.1.20:3000", "192.168.1.20", 3000],
    ["://missing-scheme", "192.168.1.20", 3000],
    ["not a url", "192.168.1.20", 3000],
  ];
  for (const [origin, hostname, port] of cases)
    assert.equal(
      isAllowedClientOrigin(origin, hostname, port, hotspot),
      false,
      origin,
    );
});

test("explicit allowed origins still win and production ignores same-origin heuristics", () => {
  assert.equal(
    isAllowedClientOrigin(
      "http://127.0.0.1:5173",
      "127.0.0.1",
      5173,
      serveOnly,
    ),
    true,
  );
  assert.equal(
    isAllowedClientOrigin(
      "https://bbm.example",
      "192.168.1.20",
      3000,
      production,
    ),
    true,
  );
  assert.equal(
    isAllowedClientOrigin(
      "http://192.168.1.20:3000",
      "192.168.1.20",
      3000,
      production,
    ),
    false,
  );
});

test("development Vite ports remain allowed for the same host", () => {
  assert.equal(
    isAllowedClientOrigin(
      "http://127.0.0.1:5173",
      "127.0.0.1",
      3000,
      serveOnly,
    ),
    true,
  );
  assert.equal(
    isAllowedClientOrigin("http://127.0.0.1:5173", "127.0.0.1", 3000, hotspot),
    true,
  );
});

test("host and port are read from the Host header, including IPv6", () => {
  const request = (host?: string) =>
    ({ headers: host ? { host } : {} }) as IncomingMessage;
  assert.equal(requestHostname(request("192.168.1.20:3000")), "192.168.1.20");
  assert.equal(requestPort(request("192.168.1.20:3000")), 3000);
  assert.equal(requestHostname(request("192.168.1.20")), "192.168.1.20");
  assert.equal(requestPort(request("192.168.1.20")), null);
  assert.equal(requestHostname(request("[::1]:3000")), "::1");
  assert.equal(requestPort(request("[::1]:3000")), 3000);
  assert.equal(requestHostname(request()), "");
  assert.equal(requestPort(request()), null);
});
