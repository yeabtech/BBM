import { ConfigurationError } from "../../domain/errors/configuration-error.js";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  host: string;
  port: number;
  clientDist?: string;
  databaseUrl?: string;
  databaseRequired: boolean;
  logLevel: string;
  clientOrigins: string[];
  roomIdleMs: number;
  hostGraceMs: number;
  roomSweepMs: number;
  raceCountdownMs: number;
  raceTimeoutMs: number;
  raceTickMs: number;
  production: boolean;
  trustProxy: boolean;
  lanEnabled: boolean;
}
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  if (env.LAN_ENABLED && !["true", "false"].includes(env.LAN_ENABLED))
    throw new ConfigurationError("LAN_ENABLED must be true or false");
  const lanEnabled = env.LAN_ENABLED === "true";
  const host = env.HOST ?? (lanEnabled ? "0.0.0.0" : "127.0.0.1");
  const port = Number(env.PORT ?? "3000");
  if (!host.trim()) throw new ConfigurationError("HOST must not be empty");
  const loopbackHost = ["127.0.0.1", "::1", "localhost"].includes(
    host.toLowerCase(),
  );
  if (!lanEnabled && !loopbackHost)
    throw new ConfigurationError(
      "Set LAN_ENABLED=true before binding outside localhost",
    );
  // Starting on loopback and switching to LAN later is allowed: the lobby's
  // "Start hosting" action does exactly that, and `LAN_ENABLED=true` simply
  // starts hosted immediately.
  if (lanEnabled) {
    if (
      loopbackHost ||
      (host !== "0.0.0.0" &&
        host !== "::" &&
        (isIP(host) === 0 || !isLocalInterfaceAddress(host)))
    )
      throw new ConfigurationError(
        "LAN mode HOST must be 0.0.0.0, ::, or a local interface IP address",
      );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new ConfigurationError("PORT must be an integer from 1 to 65535");
  const databaseUrl = env.DATABASE_URL?.trim();
  if (databaseUrl) {
    try {
      if (!["postgres:", "postgresql:"].includes(new URL(databaseUrl).protocol))
        throw new Error();
    } catch {
      throw new ConfigurationError(
        "DATABASE_URL must be a valid PostgreSQL URL",
      );
    }
  }
  const databaseRequired = env.DATABASE_REQUIRED === "true";
  if (
    env.DATABASE_REQUIRED &&
    !["true", "false"].includes(env.DATABASE_REQUIRED)
  )
    throw new ConfigurationError("DATABASE_REQUIRED must be true or false");
  if (databaseRequired && !databaseUrl)
    throw new ConfigurationError(
      "DATABASE_URL is required when DATABASE_REQUIRED=true",
    );
  const clientOrigins = (
    env.CLIENT_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of clientOrigins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new ConfigurationError("CLIENT_ORIGINS must contain valid origins");
    }
    if (
      parsed.origin !== origin ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new ConfigurationError(
        "CLIENT_ORIGINS entries must be exact origins without paths",
      );
  }
  const roomIdleMs = positiveInteger(env.ROOM_IDLE_MINUTES, 30) * 60_000;
  const hostGraceMs = positiveInteger(env.HOST_GRACE_SECONDS, 30) * 1000;
  const roomSweepMs = positiveInteger(env.ROOM_SWEEP_SECONDS, 5) * 1000;
  const raceCountdownMs = positiveInteger(env.RACE_COUNTDOWN_SECONDS, 3) * 1000;
  const raceTimeoutMs = positiveInteger(env.RACE_TIMEOUT_SECONDS, 120) * 1000;
  const raceTickMs = positiveInteger(env.RACE_TICK_MS, 50);
  const production = env.NODE_ENV === "production";
  if (production && !databaseRequired)
    throw new ConfigurationError(
      "DATABASE_REQUIRED=true is required in production",
    );
  if (
    production &&
    (clientOrigins.length === 0 ||
      clientOrigins.some((origin) => !origin.startsWith("https://")))
  ) {
    throw new ConfigurationError(
      "At least one HTTPS CLIENT_ORIGINS entry is required in production",
    );
  }
  if (production && !databaseUrl)
    throw new ConfigurationError("DATABASE_URL is required in production");
  // Resolve against the repository root: the server process starts in
  // apps/server, so a documented value such as apps/client/dist must still work.
  const clientDistInput = env.CLIENT_DIST?.trim();
  const clientDist = clientDistInput
    ? resolveFromRoots(clientDistInput)
    : undefined;
  if (clientDist && !existsSync(join(clientDist, "index.html")))
    throw new ConfigurationError(
      "CLIENT_DIST must point to a built BBM client directory containing index.html",
    );
  const trustProxy = env.TRUST_PROXY === "true";
  if (production && !trustProxy)
    throw new ConfigurationError(
      "TRUST_PROXY=true is required behind the production HTTPS proxy",
    );
  return {
    host,
    port,
    ...(clientDist ? { clientDist } : {}),
    ...(databaseUrl ? { databaseUrl } : {}),
    databaseRequired,
    logLevel: env.LOG_LEVEL ?? "info",
    clientOrigins,
    roomIdleMs,
    hostGraceMs,
    roomSweepMs,
    raceCountdownMs,
    raceTimeoutMs,
    raceTickMs,
    production,
    trustProxy,
    lanEnabled,
  };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new ConfigurationError(
      "Room timing settings must be positive integers",
    );
  return parsed;
}

function resolveFromRoots(input: string): string {
  // This module lives at <root>/apps/server/src/infrastructure/configuration/
  // (or dist/infrastructure/configuration/ when built); five levels up is the root.
  const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "..",
  );
  const candidates = [
    resolve(process.cwd(), input),
    resolve(repositoryRoot, input),
  ];
  return (
    candidates.find((candidate) => existsSync(join(candidate, "index.html"))) ??
    candidates[0]!
  );
}

function isLocalInterfaceAddress(host: string): boolean {
  return Object.values(networkInterfaces()).some((entries) =>
    entries?.some(
      (entry) =>
        !entry.internal && entry.address.toLowerCase() === host.toLowerCase(),
    ),
  );
}
