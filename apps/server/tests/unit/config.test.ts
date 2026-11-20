import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/infrastructure/configuration/config.js";
import { ConfigurationError } from "../../src/domain/errors/configuration-error.js";

test("defaults to localhost and optional database", () => {
  assert.deepEqual(loadConfig({}), {
    host: "127.0.0.1",
    port: 3000,
    databaseRequired: false,
    logLevel: "info",
    clientOrigins: ["http://127.0.0.1:5173", "http://localhost:5173"],
    roomIdleMs: 1_800_000,
    hostGraceMs: 30_000,
    roomSweepMs: 5_000,
    raceCountdownMs: 3_000,
    raceTimeoutMs: 120_000,
    raceTickMs: 50,
    production: false,
    trustProxy: false,
    lanEnabled: false,
  });
});
test("LAN binding requires explicit enablement and defaults to all interfaces", () => {
  assert.throws(() => loadConfig({ HOST: "0.0.0.0" }), /LAN_ENABLED=true/);
  const lan = loadConfig({ LAN_ENABLED: "true" });
  assert.equal(lan.lanEnabled, true);
  assert.equal(lan.host, "0.0.0.0");
  assert.throws(
    () => loadConfig({ LAN_ENABLED: "true", HOST: "127.0.0.1" }),
    /LAN mode HOST/,
  );
  assert.throws(() => loadConfig({ LAN_ENABLED: "yes" }), /LAN_ENABLED/);
  assert.throws(
    () => loadConfig({ LAN_ENABLED: "true", HOST: "203.0.113.10" }),
    /local interface IP/,
  );
});
test("rejects invalid port and required missing database", () => {
  assert.throws(() => loadConfig({ PORT: "NaN" }), ConfigurationError);
  assert.throws(
    () => loadConfig({ DATABASE_REQUIRED: "true" }),
    ConfigurationError,
  );
});

test("production requires an explicit database and trusted HTTPS proxy policy", () => {
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://app:placeholder@db.internal/bbm",
        CLIENT_ORIGINS: "https://bbm.example",
        TRUST_PROXY: "true",
      }),
    ConfigurationError,
  );
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://app:placeholder@db.internal/bbm",
        DATABASE_REQUIRED: "true",
        CLIENT_ORIGINS: "https://bbm.example/path",
        TRUST_PROXY: "true",
      }),
    ConfigurationError,
  );
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: "production",
        DATABASE_URL: "postgres://app:placeholder@db.internal/bbm",
        DATABASE_REQUIRED: "true",
        CLIENT_ORIGINS: "https://bbm.example",
      }),
    ConfigurationError,
  );
  assert.doesNotThrow(() =>
    loadConfig({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://app:placeholder@db.internal/bbm",
      DATABASE_REQUIRED: "true",
      CLIENT_ORIGINS: "https://bbm.example",
      TRUST_PROXY: "true",
    }),
  );
});
