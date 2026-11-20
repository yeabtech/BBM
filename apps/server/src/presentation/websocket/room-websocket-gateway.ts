import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import { URL } from "node:url";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  parseClientMessage,
  PROTOCOL_VERSION,
  type BallSkin,
  type ClientMessage,
  type GameplaySnapshot,
  type ProtocolErrorCode,
  type RaceSessionSnapshot,
  type RoomSnapshot,
  type ServerMessage,
} from "@bbm/shared-contracts";
import { DomainError } from "../../domain/errors/domain-error.js";
import type { RateLimiter } from "../../application/ports/security-ports.js";
import type { GuestService } from "../../application/services/guest-service.js";
import type { Guest } from "../../domain/entities/guest.js";
import type { RoomService } from "../../application/services/room-service.js";
import type { RaceService } from "../../application/services/race-service.js";
import type { GameplayService } from "../../application/services/gameplay-service.js";
import type {
  IntervalScheduler,
  ScheduledInterval,
} from "../../application/ports/interval-scheduler.js";
import type { RaceTransition } from "../../application/ports/race-repository.js";
import { logger } from "../../infrastructure/logging/logger.js";
import {
  isAllowedClientOrigin,
  requestHostname,
  requestPort,
} from "../http/client-origin.js";

interface Peer {
  socket: WebSocket;
  request: IncomingMessage;
  connectionId: string;
  guestId: string | null;
  guest: Guest | null;
  roomId: string | null;
  queue: Promise<void>;
  queueDepth: number;
  invalidMessages: number;
}

export class RoomWebSocketGateway {
  private readonly socketServer = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
  });
  private readonly peers = new Set<Peer>();
  private readonly activeSockets = new Map<string, Peer>();
  private readonly disconnectTasks = new Set<Promise<void>>();
  private readonly onUpgrade = (
    request: IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ) => {
    let pathname: string;
    let hasQuery = false;
    try {
      const url = new URL(request.url ?? "/", "http://local");
      pathname = url.pathname;
      hasQuery = url.search.length > 0;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== "/ws" || hasQuery || !this.allowedRequest(request)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    this.socketServer.handleUpgrade(request, socket, head, (websocket) => {
      this.socketServer.emit("connection", websocket, request);
    });
  };
  private readonly sweepTimer: ScheduledInterval;
  private raceTimer: ScheduledInterval | null = null;
  private raceTimerGeneration = 0;
  private readonly retiringRaceTimers = new Set<Promise<void>>();
  private closing = false;
  private roomSweepRunning = false;
  private raceSweepRunning = false;
  private readonly scheduler: IntervalScheduler;

  constructor(
    private readonly server: Server,
    private readonly guests: GuestService,
    private readonly rooms: RoomService,
    private readonly rateLimiter: RateLimiter,
    private readonly allowedOrigins: readonly string[],
    private readonly production: boolean,
    roomSweepMs: number,
    private readonly races: RaceService,
    private readonly gameplay: GameplayService,
    scheduler: IntervalScheduler,
    private readonly raceTickMs: number,
    private readonly monotonicNow: () => number = () => performance.now(),
    private readonly servesClient = false,
  ) {
    server.on("upgrade", this.onUpgrade);
    this.socketServer.on("connection", (socket, request) =>
      this.connect(socket, request),
    );
    this.sweepTimer = scheduler.every(roomSweepMs, () => this.sweep());
    this.scheduler = scheduler;
  }

  async close(): Promise<void> {
    this.closing = true;
    const timerCancels = [this.sweepTimer.cancel()];
    if (this.raceTimer) {
      const raceTimer = this.raceTimer;
      this.raceTimer = null;
      timerCancels.push(raceTimer.cancel());
    }
    await Promise.all(timerCancels);
    await Promise.all([...this.peers].map((peer) => peer.queue));
    await Promise.all([...this.retiringRaceTimers]);
    for (const race of await this.races.recoverAfterRestart()) {
      this.gameplay.removeRace(race.raceId);
      this.broadcastRace(race, "race_cancelled");
    }
    this.server.off("upgrade", this.onUpgrade);
    for (const peer of this.peers)
      peer.socket.close(1001, "Server shutting down");
    await new Promise<void>((resolve) =>
      this.socketServer.close(() => resolve()),
    );
    await Promise.all([...this.disconnectTasks]);
  }

  private allowedRequest(request: IncomingMessage): boolean {
    const origin = request.headers.origin;
    const secure =
      Boolean(
        (request.socket as IncomingMessage["socket"] & { encrypted?: boolean })
          .encrypted,
      ) || request.headers["x-forwarded-proto"] === "https";
    if (this.production && !secure) return false;
    if (this.production && !origin) return false;
    if (!origin) return !this.production;
    return isAllowedClientOrigin(
      origin,
      requestHostname(request),
      requestPort(request),
      {
        allowedOrigins: this.allowedOrigins,
        production: this.production,
        servesClient: this.servesClient,
      },
    );
  }

  private connect(socket: WebSocket, request: IncomingMessage): void {
    const peer: Peer = {
      socket,
      request,
      connectionId: randomUUID(),
      guestId: null,
      guest: null,
      roomId: null,
      queue: Promise.resolve(),
      queueDepth: 0,
      invalidMessages: 0,
    };
    this.peers.add(peer);
    socket.on("message", (raw, binary) => {
      if (peer.queueDepth >= 128) {
        this.sendError(
          peer,
          null,
          "RATE_LIMITED",
          "Too many queued messages. Reconnect and try again.",
        );
        socket.close(1008, "Inbound queue limit exceeded");
        return;
      }
      peer.queueDepth += 1;
      peer.queue = peer.queue
        .then(() => this.handle(peer, raw, binary))
        .catch((error: unknown) => {
          if (error instanceof DomainError)
            this.sendError(peer, null, error.code, error.message);
          else {
            this.logError("WebSocket event failed", error, peer);
            this.sendError(
              peer,
              null,
              "INTERNAL_ERROR",
              "The request could not be completed.",
            );
          }
        })
        .finally(() => {
          peer.queueDepth = Math.max(0, peer.queueDepth - 1);
        });
    });
    socket.on("close", () => {
      const task = this.disconnect(peer);
      this.disconnectTasks.add(task);
      void task.finally(() => this.disconnectTasks.delete(task));
    });
    socket.on("error", (error) =>
      this.logError("WebSocket transport error", error, peer),
    );
  }

  private async handle(
    peer: Peer,
    raw: RawData,
    binary: boolean,
  ): Promise<void> {
    if (this.closing) return;
    if (binary) {
      this.sendError(
        peer,
        null,
        "MALFORMED_MESSAGE",
        "Text protocol messages are required.",
      );
      peer.socket.close(1003, "Text messages required");
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      this.invalidMessage(peer, null, "MALFORMED_MESSAGE");
      return;
    }
    if (isRecord(parsed) && parsed.version !== PROTOCOL_VERSION) {
      this.sendError(
        peer,
        safeRequestId(parsed.requestId),
        "UNSUPPORTED_VERSION",
        "This protocol version is not supported.",
      );
      return;
    }
    const message = parseClientMessage(parsed);
    if (!message) {
      this.invalidMessage(
        peer,
        safeRequestId(isRecord(parsed) ? parsed.requestId : null),
        "MALFORMED_MESSAGE",
      );
      return;
    }
    if (message.type !== "move_input") {
      const ip = peer.request.socket.remoteAddress ?? "unknown";
      if (!this.rateLimiter.consume(`ws-message:${ip}`, 180, 60_000)) {
        this.sendError(
          peer,
          message.requestId,
          "RATE_LIMITED",
          "Too many messages. Try again shortly.",
        );
        return;
      }
    }
    if (message.type === "authenticate") {
      await this.authenticate(peer, message);
      return;
    }
    if (!peer.guestId || this.activeSockets.get(peer.guestId) !== peer) {
      this.sendError(
        peer,
        message.requestId,
        "UNAUTHENTICATED",
        "Authenticate this guest session first.",
      );
      return;
    }
    try {
      await this.dispatch(peer, message);
    } catch (error) {
      if (error instanceof DomainError)
        this.sendError(peer, message.requestId, error.code, error.message);
      else {
        this.logError("WebSocket command failed", error, peer);
        this.sendError(
          peer,
          message.requestId,
          "INTERNAL_ERROR",
          "The request could not be completed.",
        );
      }
    }
  }

  private async authenticate(
    peer: Peer,
    message: Extract<ClientMessage, { type: "authenticate" }>,
  ): Promise<void> {
    if (peer.guestId) {
      this.sendError(
        peer,
        message.requestId,
        "MALFORMED_MESSAGE",
        "This connection is already authenticated.",
      );
      return;
    }
    try {
      const guest = await this.guests.authenticate(message.payload.token);
      const previous = this.activeSockets.get(guest.id);
      if (previous && previous !== peer)
        previous.socket.close(4001, "Guest connected in another session");
      this.activeSockets.set(guest.id, peer);
      peer.guestId = guest.id;
      peer.guest = guest;
      const room = await this.rooms.markConnected(guest, peer.connectionId);
      const race = await this.races.currentForGuest(guest.id);
      if (race?.state === "Countdown" || race?.state === "InProgress")
        this.ensureRaceTimer();
      peer.roomId = room?.roomId ?? null;
      const gameplaySnapshot =
        race?.state === "Countdown" || race?.state === "InProgress"
          ? this.gameplay.reconnectPlayer(guest.id, this.monotonicNow())
          : null;
      this.send(peer, {
        version: PROTOCOL_VERSION,
        requestId: message.requestId,
        type: "authentication_result",
        payload: { ok: true, guest: publicProfile(guest) },
      });
      this.send(peer, {
        version: PROTOCOL_VERSION,
        requestId: message.requestId,
        type: "authenticated",
        payload: { guest: publicProfile(guest), room, race },
      });
      if (room) {
        this.broadcast(room.roomId, {
          version: PROTOCOL_VERSION,
          requestId: null,
          type: "player_connection_status_changed",
          payload: { guestId: guest.id, connected: true },
        });
        this.broadcastSnapshot(room, peer);
        if (gameplaySnapshot && race?.state === "InProgress") {
          this.sendGameplay(peer, gameplaySnapshot);
          this.broadcastGameplay(gameplaySnapshot, peer);
        }
        if (race) {
          const results = await this.races.results(race.raceId);
          if (results) {
            const durationMs = Math.max(
              0,
              Date.parse(
                race.finishedAt ?? race.cancelledAt ?? race.updatedAt,
              ) -
                Date.parse(
                  race.officialStartAt ??
                    race.countdownDeadlineAt ??
                    race.createdAt,
                ),
            );
            this.send(peer, {
              version: PROTOCOL_VERSION,
              requestId: null,
              type: "race_results",
              payload: { raceId: race.raceId, durationMs, results },
            });
          }
        }
      }
    } catch (error) {
      if (error instanceof DomainError && error.code === "INVALID_TOKEN") {
        this.send(peer, {
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          type: "authentication_result",
          payload: { ok: false },
        });
        this.sendError(peer, message.requestId, "INVALID_TOKEN", error.message);
        peer.socket.close(4003, "Invalid guest session");
        return;
      }
      if (peer.guestId) {
        if (this.activeSockets.get(peer.guestId) === peer)
          this.activeSockets.delete(peer.guestId);
        peer.guestId = null;
        peer.guest = null;
      }
      throw error;
    }
  }

  private async dispatch(
    peer: Peer,
    message: Exclude<ClientMessage, { type: "authenticate" }>,
  ): Promise<void> {
    const guestId = peer.guestId!;
    switch (message.type) {
      case "create_room": {
        if (
          !this.rateLimiter.consume(
            `room-create:${peer.request.socket.remoteAddress ?? "unknown"}`,
            5,
            60_000,
          )
        ) {
          this.sendError(
            peer,
            message.requestId,
            "RATE_LIMITED",
            "Too many room requests. Try again shortly.",
          );
          return;
        }
        const room = await this.rooms.create(peer.guest!, peer.connectionId);
        peer.roomId = room.roomId;
        this.send(peer, {
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          type: "room_created",
          payload: { room },
        });
        this.broadcastSnapshot(room, peer);
        return;
      }
      case "join_room": {
        if (
          !this.rateLimiter.consume(
            `room-join:${peer.request.socket.remoteAddress ?? "unknown"}`,
            10,
            60_000,
          )
        ) {
          this.sendError(
            peer,
            message.requestId,
            "RATE_LIMITED",
            "Too many room-code attempts. Try again shortly.",
          );
          return;
        }
        const room = await this.rooms.join(
          peer.guest!,
          message.payload.code,
          peer.connectionId,
        );
        peer.roomId = room.roomId;
        this.send(peer, {
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          type: "room_joined",
          payload: { room },
        });
        const player = room.players.find((entry) => entry.guestId === guestId);
        if (player)
          this.broadcast(
            room.roomId,
            {
              version: PROTOCOL_VERSION,
              requestId: null,
              type: "player_joined",
              payload: { player },
            },
            peer,
          );
        this.broadcastSnapshot(room, peer);
        return;
      }
      case "set_ready": {
        const room = await this.rooms.setReady(
          guestId,
          peer.connectionId,
          message.payload.ready,
        );
        this.broadcast(room.roomId, {
          version: PROTOCOL_VERSION,
          requestId: null,
          type: "ready_status_changed",
          payload: { guestId, ready: message.payload.ready },
        });
        this.send(peer, {
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          type: "room_snapshot_updated",
          payload: { room },
        });
        this.broadcastSnapshot(room, peer);
        return;
      }
      case "leave_room": {
        const { room, closedReason } = await this.rooms.leave(
          guestId,
          peer.connectionId,
        );
        if (closedReason) {
          const cancelled = await this.races.cancelForRoom(
            room.roomId,
            "HostLeft",
          );
          if (cancelled) {
            this.gameplay.removeRace(cancelled.raceId);
            this.broadcastRace(cancelled, "race_cancelled");
          }
          await this.stopRaceTimerIfIdle();
          const event = {
            version: PROTOCOL_VERSION,
            requestId: null,
            type: "room_closed" as const,
            payload: {
              roomId: room.roomId,
              reason: closedReason as "host_left" | "empty",
            },
          };
          this.broadcast(room.roomId, event);
          for (const member of this.peers)
            if (member.roomId === room.roomId) member.roomId = null;
          this.send(peer, { ...event, requestId: message.requestId });
          return;
        }
        this.gameplay.disconnectPlayer(guestId, this.monotonicNow());
        peer.roomId = null;
        this.broadcast(room.roomId, {
          version: PROTOCOL_VERSION,
          requestId: null,
          type: "player_left",
          payload: { guestId },
        });
        this.send(peer, {
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          type: "player_left",
          payload: { guestId },
        });
        this.broadcastSnapshot(room);
        const race = await this.races.currentForRoom(room.roomId);
        const gameplaySnapshot = race
          ? this.gameplay.snapshot(race.raceId)
          : null;
        if (gameplaySnapshot) this.broadcastGameplay(gameplaySnapshot);
        return;
      }
      case "prepare_to_start": {
        const result = await this.rooms.prepare(guestId, peer.connectionId);
        this.send(peer, {
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          type: "ready_to_start_result",
          payload: result,
        });
        return;
      }
      case "start_race": {
        const result = await this.races.start(guestId, peer.connectionId);
        this.ensureRaceTimer();
        peer.roomId = result.race.roomId;
        if (result.created) {
          const room = await this.rooms.snapshot(guestId);
          this.gameplay.prepareRace(
            result.race.raceId,
            room.roomId,
            room.players,
            this.monotonicNow(),
          );
          this.broadcastRace(result.race, "race_countdown_started", peer);
          this.broadcastRace(result.race, "race_state_changed");
          this.send(peer, {
            version: PROTOCOL_VERSION,
            requestId: message.requestId,
            type: "race_countdown_started",
            payload: { race: result.race },
          });
        } else {
          this.send(peer, {
            version: PROTOCOL_VERSION,
            requestId: message.requestId,
            type: "race_snapshot",
            payload: { race: result.race },
          });
        }
        return;
      }
      case "get_race_snapshot": {
        const race = await this.races.currentForGuest(guestId);
        if (race?.state === "Countdown" || race?.state === "InProgress")
          this.ensureRaceTimer();
        this.send(peer, {
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          type: "race_snapshot",
          payload: { race },
        });
        return;
      }
      case "get_snapshot": {
        const room = await this.rooms.snapshot(guestId);
        peer.roomId = room.roomId;
        this.send(peer, {
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          type: "room_snapshot_updated",
          payload: { room },
        });
        return;
      }
      case "move_input": {
        this.gameplay.acceptInput({
          guestId,
          raceId: message.payload.raceId,
          sequence: message.payload.sequence,
          horizontal: message.payload.horizontal,
          jumpDown: message.payload.jumpDown,
          monotonicNowMs: this.monotonicNow(),
        });
        return;
      }
      case "activate_power_up": {
        this.gameplay.activatePowerUp({
          guestId,
          raceId: message.payload.raceId,
          slot: message.payload.slot,
          nowMs: this.monotonicNow(),
        });
        return;
      }
    }
  }

  private async disconnect(peer: Peer): Promise<void> {
    this.peers.delete(peer);
    if (!peer.guestId) return;
    const isCurrent = this.activeSockets.get(peer.guestId) === peer;
    if (isCurrent) {
      this.activeSockets.delete(peer.guestId);
      this.gameplay.disconnectPlayer(peer.guestId, this.monotonicNow());
    }
    try {
      const room = await this.rooms.disconnect(peer.guestId, peer.connectionId);
      if (room) {
        this.broadcast(room.roomId, {
          version: PROTOCOL_VERSION,
          requestId: null,
          type: "player_connection_status_changed",
          payload: { guestId: peer.guestId, connected: false },
        });
        this.broadcastSnapshot(room);
        if (isCurrent) {
          const race = await this.races.currentForRoom(room.roomId);
          const gameplaySnapshot = race
            ? this.gameplay.snapshot(race.raceId)
            : null;
          if (gameplaySnapshot) this.broadcastGameplay(gameplaySnapshot);
        }
      }
    } catch (error) {
      this.logError("Could not persist lobby disconnect", error, peer);
    }
  }

  private async sweep(): Promise<void> {
    if (this.roomSweepRunning || this.closing) return;
    this.roomSweepRunning = true;
    try {
      for (const room of await this.rooms.expireDue()) {
        const cancelled = await this.races.cancelForRoom(
          room.roomId,
          room.reason === "host_timeout" ? "HostLeft" : "RoomExpired",
        );
        if (cancelled) this.broadcastRace(cancelled, "race_cancelled");
        if (cancelled) this.gameplay.removeRace(cancelled.raceId);
        await this.stopRaceTimerIfIdle();
        this.broadcast(room.roomId, {
          version: PROTOCOL_VERSION,
          requestId: null,
          type: "room_closed",
          payload: { roomId: room.roomId, reason: room.reason },
        });
        for (const peer of this.peers)
          if (peer.roomId === room.roomId) peer.roomId = null;
      }
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Lobby expiry sweep failed",
      );
    } finally {
      this.roomSweepRunning = false;
    }
  }

  private async sweepRaces(): Promise<void> {
    if (this.raceSweepRunning || this.closing) return;
    this.raceSweepRunning = true;
    try {
      for (const transition of await this.races.advanceDue())
        await this.broadcastRaceTransition(transition);
      const now = this.monotonicNow();
      for (const snapshot of this.gameplay.tick(now, new Date())) {
        this.broadcastGameplay(snapshot);
        const result = this.gameplay.raceResults(
          snapshot.raceId,
          new Date(snapshot.serverTimestamp),
        );
        if (result && this.gameplay.needsResultPersistence(snapshot.raceId)) {
          await this.races.saveResults(snapshot.raceId, result.results, true);
          this.gameplay.markResultsPersisted(snapshot.raceId);
          const race = await this.races.currentForRoom(snapshot.roomId);
          if (race) this.broadcastRace(race, "race_state_changed");
          this.broadcastResults(
            snapshot.raceId,
            result.durationMs,
            result.results,
            snapshot.roomId,
          );
          this.gameplay.removeRace(snapshot.raceId);
        }
      }
      await this.stopRaceTimerIfIdle();
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Race transition sweep failed",
      );
    } finally {
      this.raceSweepRunning = false;
    }
  }

  private ensureRaceTimer(): void {
    this.raceTimerGeneration += 1;
    if (!this.raceTimer)
      this.raceTimer = this.scheduler.every(this.raceTickMs, () =>
        this.sweepRaces(),
      );
  }

  private async stopRaceTimerIfIdle(): Promise<void> {
    const generation = this.raceTimerGeneration;
    if (await this.races.hasActiveRaces()) return;
    if (generation !== this.raceTimerGeneration || !this.raceTimer) return;
    const timer = this.raceTimer;
    this.raceTimer = null;
    // A race sweep may be stopping its own shared interval. Clearing it is
    // synchronous; do not wait for that same sweep from inside itself.
    const cancellation = timer.cancel();
    this.retiringRaceTimers.add(cancellation);
    void cancellation.then(
      () => this.retiringRaceTimers.delete(cancellation),
      () => this.retiringRaceTimers.delete(cancellation),
    );
  }

  private async broadcastRaceTransition(
    transition: RaceTransition,
  ): Promise<void> {
    this.broadcastRace(transition.snapshot, "race_state_changed");
    if (transition.state === "InProgress") {
      const snapshot = this.gameplay.activateRace(
        transition.snapshot.raceId,
        this.monotonicNow(),
        new Date(transition.snapshot.officialStartAt ?? Date.now()),
      );
      this.broadcastRace(transition.snapshot, "race_started");
      this.broadcastGameplay(snapshot);
    } else if (transition.state === "Cancelled") {
      if (transition.snapshot.cancellationReason === "Timeout") {
        const result = this.gameplay.raceResults(
          transition.snapshot.raceId,
          new Date(
            transition.snapshot.cancelledAt ?? transition.snapshot.updatedAt,
          ),
          true,
        );
        if (result) {
          await this.races.saveResults(
            transition.snapshot.raceId,
            result.results,
            false,
          );
          this.broadcastResults(
            transition.snapshot.raceId,
            result.durationMs,
            result.results,
            transition.snapshot.roomId,
          );
        }
      }
      this.gameplay.removeRace(transition.snapshot.raceId);
      this.broadcastRace(transition.snapshot, "race_cancelled");
    }
  }

  private broadcastResults(
    raceId: string,
    durationMs: number,
    results: import("@bbm/shared-contracts").RaceResultEntry[],
    roomId: string,
  ): void {
    this.broadcast(roomId, {
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "race_results",
      payload: { raceId, durationMs, results },
    });
  }

  private broadcastRace(
    race: RaceSessionSnapshot,
    type:
      | "race_countdown_started"
      | "race_started"
      | "race_cancelled"
      | "race_state_changed",
    exclude?: Peer,
  ): void {
    this.broadcast(
      race.roomId,
      { version: PROTOCOL_VERSION, requestId: null, type, payload: { race } },
      exclude,
    );
  }

  private broadcastSnapshot(room: RoomSnapshot, exclude?: Peer): void {
    this.broadcast(
      room.roomId,
      {
        version: PROTOCOL_VERSION,
        requestId: null,
        type: "room_snapshot_updated",
        payload: { room },
      },
      exclude,
    );
  }

  private broadcast(
    roomId: string,
    message: ServerMessage,
    exclude?: Peer,
  ): void {
    for (const peer of this.peers)
      if (peer.roomId === roomId && peer !== exclude) this.send(peer, message);
  }

  private broadcastGameplay(snapshot: GameplaySnapshot, exclude?: Peer): void {
    for (const peer of this.peers)
      if (peer.roomId === snapshot.roomId && peer !== exclude)
        this.sendGameplay(peer, snapshot);
  }

  private sendGameplay(peer: Peer, snapshot: GameplaySnapshot): void {
    if (peer.socket.bufferedAmount > 64 * 1024) return;
    this.send(peer, {
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "gameplay_snapshot",
      payload: snapshot,
    });
  }

  private sendError(
    peer: Peer,
    requestId: string | null,
    code: ProtocolErrorCode,
    message: string,
  ): void {
    this.send(peer, {
      version: PROTOCOL_VERSION,
      requestId,
      type: "protocol_error",
      payload: { code, message },
    });
  }

  private send(peer: Peer, message: ServerMessage): void {
    if (peer.socket.readyState !== WebSocket.OPEN) return;
    try {
      peer.socket.send(JSON.stringify(message), (error) => {
        if (error)
          logger.warn(
            { guestId: peer.guestId, errorName: error.name },
            "WebSocket send failed",
          );
      });
    } catch (error) {
      this.logError("WebSocket send failed", error, peer);
    }
  }

  private invalidMessage(
    peer: Peer,
    requestId: string | null,
    code: ProtocolErrorCode,
  ): void {
    peer.invalidMessages += 1;
    this.sendError(
      peer,
      requestId,
      code,
      "The message is invalid for this protocol.",
    );
    if (peer.invalidMessages >= 3)
      peer.socket.close(1008, "Invalid protocol messages");
  }

  private logError(message: string, error: unknown, peer: Peer): void {
    logger.warn(
      {
        guestId: peer.guestId,
        errorName: error instanceof Error ? error.name : "UnknownError",
      },
      message,
    );
  }
}

function publicProfile(guest: {
  id: string;
  displayName: string;
  color: "mint" | "coral" | "sun" | "sky" | "violet" | "blue";
  ballSkin: BallSkin;
}) {
  return {
    id: guest.id,
    displayName: guest.displayName,
    color: guest.color,
    ballSkin: guest.ballSkin,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function safeRequestId(value: unknown): string | null {
  return typeof value === "string" && value.length <= 80 ? value : null;
}
