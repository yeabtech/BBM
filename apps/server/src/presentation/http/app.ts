import express, { type ErrorRequestHandler } from "express";
import type { HealthService } from "../../application/services/health-service.js";
import { logger } from "../../infrastructure/logging/logger.js";
import { DomainError } from "../../domain/errors/domain-error.js";
import type { GuestService } from "../../application/services/guest-service.js";
import type { RoomService } from "../../application/services/room-service.js";
import type { RateLimiter } from "../../application/ports/security-ports.js";
import { lanAddresses } from "../../infrastructure/networking/lan-addresses.js";
import {
  isAllowedClientOrigin,
  requestHostname,
  requestPort,
} from "./client-origin.js";
import { createClientAssets } from "./client-assets.js";

/**
 * Optional LAN hosting control. The lobby on the host computer calls it once;
 * the server then listens on all interfaces so other devices can join.
 */
export interface HostingControl {
  enabled(): boolean;
  /** Turns LAN hosting on (idempotent). Resolves once listening is updated. */
  enable(): Promise<void>;
}

export interface HttpDependencies {
  health: HealthService;
  guests?: GuestService;
  rooms?: RoomService;
  allowedOrigins?: string[];
  rateLimiter?: RateLimiter;
  production?: boolean;
  trustProxy?: boolean;
  lanEnabled?: boolean;
  port?: number;
  /** Directory of a built client bundle to serve from this server, if any. */
  clientDist?: string;
  hosting?: HostingControl;
}

export function createApp(dependencies: HttpDependencies | HealthService) {
  const deps: HttpDependencies =
    "databaseAvailable" in dependencies
      ? { health: dependencies }
      : dependencies;
  const health = deps.health;
  const app = express();
  const clientAssets = deps.clientDist
    ? createClientAssets(deps.clientDist)
    : null;
  app.set("trust proxy", deps.trustProxy ?? false);
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use((req, res, next) => {
    const origin = req.header("origin");
    if (
      origin &&
      isAllowedClientOrigin(origin, requestHostname(req), requestPort(req), {
        allowedOrigins: deps.allowedOrigins ?? [],
        production: deps.production ?? false,
        servesClient: clientAssets !== null,
      })
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, OPTIONS",
      );
    } else if (origin) {
      // Any present browser origin must be explicitly trusted; requests without
      // an Origin header (curl, tests, same-origin navigations) are not CORS.
      res.status(403).json({
        error: {
          code: "ORIGIN_NOT_ALLOWED",
          message: "This origin is not allowed.",
        },
      });
      return;
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    if (deps.production && !req.secure) {
      res.status(426).json({
        error: {
          code: "HTTPS_REQUIRED",
          message: "Secure HTTPS is required.",
        },
      });
      return;
    }
    next();
  });
  app.use(express.json({ limit: "32kb" }));
  app.get("/api/health", (_req, res) =>
    res.status(200).json({ status: "ok", service: "bbm-api" }),
  );
  app.get("/api/health/db", async (_req, res) => {
    const available = await health.databaseAvailable();
    res
      .status(available ? 200 : 503)
      .json({ status: available ? "ok" : "unavailable", service: "postgres" });
  });
  app.get("/api/lan-info", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const enabled = deps.hosting?.enabled() ?? deps.lanEnabled ?? false;
    const candidates = enabled ? lanAddresses() : [];
    res.json({
      enabled,
      port: deps.port ?? 3000,
      addresses: candidates.map((candidate) => candidate.address),
      // Adapter names let the host recognise the Wi-Fi/hotspot address.
      interfaces: candidates.map((candidate) => ({
        address: candidate.address,
        interface: candidate.interface,
      })),
      clientServed: clientAssets !== null,
      canHost: deps.hosting !== undefined,
    });
  });
  app.post("/api/hosting", async (_req, res, next) => {
    // Only an explicitly wired hosting control may change the listen address;
    // it is never available in production or when LAN mode was refused.
    if (!deps.hosting || deps.production) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Not available." },
      });
      return;
    }
    try {
      await deps.hosting.enable();
      res.setHeader("Cache-Control", "no-store");
      res.json({
        enabled: deps.hosting.enabled(),
        port: deps.port ?? 3000,
        addresses: deps.hosting.enabled()
          ? lanAddresses().map((candidate) => candidate.address)
          : [],
      });
    } catch (error) {
      next(error);
    }
  });
  if (deps.guests && deps.rateLimiter) {
    app.post("/api/guests", async (req, res, next) => {
      if (
        !deps.rateLimiter!.consume(
          `guest-create:${requestIp(req)}`,
          5,
          10 * 60_000,
        )
      ) {
        res.status(429).json({
          error: { code: "RATE_LIMITED", message: "Try again later." },
        });
        return;
      }
      try {
        res.setHeader("Cache-Control", "no-store");
        res
          .status(201)
          .json(
            await deps.guests!.create(
              req.body?.displayName,
              req.body?.ballSkin,
            ),
          );
      } catch (error) {
        next(error);
      }
    });
    app.get("/api/guests/me", async (req, res, next) => {
      try {
        res.json(
          await deps.guests!.getProfile(
            readBearer(req.header("authorization")),
          ),
        );
      } catch (error) {
        next(error);
      }
    });
    app.patch("/api/guests/me", async (req, res, next) => {
      try {
        const token = readBearer(req.header("authorization"));
        const guest = await deps.guests!.getProfile(token);
        if (deps.rooms && (await deps.rooms.hasOpenRoom(guest.id))) {
          res.status(409).json({
            error: {
              code: "IN_ROOM",
              message: "Leave your room before changing guest preferences.",
            },
          });
          return;
        }
        res.json(
          await deps.guests!.updatePreferences(
            token,
            req.body?.displayName,
            req.body?.ballSkin,
          ),
        );
      } catch (error) {
        next(error);
      }
    });
  }
  if (clientAssets) app.use(clientAssets.serve);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    const id = crypto.randomUUID();
    logger.error(
      {
        requestId: id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      "Request failed",
    );
    if (error instanceof DomainError) {
      const status =
        error.code === "INVALID_TOKEN"
          ? 401
          : error.code === "INVALID_NAME" ||
              error.code === "INVALID_COLOR" ||
              error.code === "INVALID_BALL_SKIN"
            ? 400
            : 409;
      res
        .status(status)
        .json({ error: { code: error.code, message: error.message } });
      return;
    }
    const status =
      error &&
      typeof error === "object" &&
      "status" in error &&
      typeof error.status === "number" &&
      error.status >= 400 &&
      error.status < 500
        ? error.status
        : error instanceof SyntaxError
          ? 400
          : 500;
    res.status(status).json({ error: "Request failed", requestId: id });
  };
  app.use(errors);
  // Registered after the error handler, so with a hosted client every unmatched
  // path ends in this app's controlled 404 (no HTML error page, no bundle leak).
  if (clientAssets) app.use((_req, res) => res.sendStatus(404));
  return app;
}

function readBearer(header: string | undefined): string {
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]{43})$/);
  if (!match?.[1])
    throw new DomainError(
      "INVALID_TOKEN",
      "Guest session is invalid. Create a new guest session.",
    );
  return match[1];
}

function requestIp(req: express.Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}
