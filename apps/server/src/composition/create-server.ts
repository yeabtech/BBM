import { createServer } from "node:http";
import type { Config } from "../infrastructure/configuration/config.js";
import { PostgresHealthRepository } from "../infrastructure/persistence/postgres/postgres-health-repository.js";
import { HealthService } from "../application/services/health-service.js";
import { createApp } from "../presentation/http/app.js";
import { PostgresGuestRepository } from "../infrastructure/persistence/postgres/postgres-guest-repository.js";
import { PostgresRoomRepository } from "../infrastructure/persistence/postgres/postgres-room-repository.js";
import { GuestService } from "../application/services/guest-service.js";
import { RoomService } from "../application/services/room-service.js";
import {
  SecureRoomCodeGenerator,
  SecureTokenGenerator,
  Sha256TokenHasher,
  SystemClock,
  UuidGenerator,
} from "../infrastructure/configuration/crypto-adapters.js";
import { InMemoryRateLimiter } from "../infrastructure/configuration/in-memory-rate-limiter.js";
import { RoomWebSocketGateway } from "../presentation/websocket/room-websocket-gateway.js";
import { PostgresRaceRepository } from "../infrastructure/persistence/postgres/postgres-race-repository.js";
import { RaceService } from "../application/services/race-service.js";
import { GameplayService } from "../application/services/gameplay-service.js";
import { SystemIntervalScheduler } from "../infrastructure/configuration/interval-scheduler.js";
import type { IntervalScheduler } from "../application/ports/interval-scheduler.js";
import type { Clock } from "../application/ports/security-ports.js";
import { createLanHosting } from "../presentation/http/lan-hosting.js";
import type { HostingControl } from "../presentation/http/app.js";

export interface CompositionOverrides {
  clock?: Clock;
  scheduler?: IntervalScheduler;
  monotonicNow?: () => number;
}

export function compose(config: Config, overrides: CompositionOverrides = {}) {
  const database = config.databaseUrl
    ? new PostgresHealthRepository(config.databaseUrl)
    : null;
  const health = new HealthService(database);
  const clock = overrides.clock ?? new SystemClock();
  const scheduler = overrides.scheduler ?? new SystemIntervalScheduler();
  const gameplay = new GameplayService();
  const ids = new UuidGenerator();
  const rateLimiter = new InMemoryRateLimiter();
  const guests = database
    ? new GuestService(
        new PostgresGuestRepository(database),
        new SecureTokenGenerator(),
        new Sha256TokenHasher(),
        ids,
        clock,
      )
    : null;
  const rooms = database
    ? new RoomService(
        new PostgresRoomRepository(database),
        new SecureRoomCodeGenerator(),
        ids,
        clock,
        config.hostGraceMs,
        config.roomIdleMs,
      )
    : null;
  const races = database
    ? new RaceService(
        new PostgresRaceRepository(database),
        ids,
        clock,
        config.raceCountdownMs,
        config.raceTimeoutMs,
      )
    : null;
  // The server object must exist before the hosting control can rebind it, and
  // the app needs the control while being created: pass a forwarder that reads
  // the control once it is assigned.
  let hosting: HostingControl | undefined;
  const forwardingHosting: HostingControl | undefined = config.production
    ? undefined
    : {
        enabled: () => hosting?.enabled() ?? config.lanEnabled,
        enable: async () => {
          if (!hosting)
            throw new Error("LAN hosting is not available on this server.");
          await hosting.enable();
        },
      };
  const server = createServer(
    createApp({
      health,
      ...(forwardingHosting ? { hosting: forwardingHosting } : {}),
      ...(guests ? { guests } : {}),
      ...(rooms ? { rooms } : {}),
      allowedOrigins: config.clientOrigins,
      rateLimiter,
      production: config.production,
      trustProxy: config.trustProxy,
      lanEnabled: config.lanEnabled,
      port: config.port,
      ...(config.clientDist ? { clientDist: config.clientDist } : {}),
    }),
  );
  if (forwardingHosting)
    hosting = createLanHosting(server, config.port, config.host);
  const gateway =
    guests && rooms
      ? new RoomWebSocketGateway(
          server,
          guests,
          rooms,
          rateLimiter,
          config.clientOrigins,
          config.production,
          config.roomSweepMs,
          races!,
          gameplay,
          scheduler,
          config.raceTickMs,
          overrides.monotonicNow,
          Boolean(config.clientDist),
        )
      : null;
  return { server, health, guests, rooms, races, gameplay, gateway };
}
