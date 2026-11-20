import {
  DISCONNECT_NEUTRAL_MS,
  INPUT_QUEUE_LIMIT,
  INPUTS_PER_SECOND_LIMIT,
  MOVEMENT_CONFIG,
  POWER_UP_CONFIG,
  RACE_OBJECT_CONFIG,
  TEST_LEVEL,
  environmentAt,
  type EnvironmentSnapshot,
  applyRadialShockwave,
  playerInHazard,
  SIMULATION_MAX_CATCH_UP_TICKS,
  SIMULATION_TICK_SECONDS,
  SNAPSHOT_INTERVAL_MS,
  spawnPlayer,
  resolvePlayerCollisions,
  stepPlayer,
  type GameInputIntent,
  type GamePlayerState,
} from "@bbm/game-simulation";
import type {
  GameplayPlayerSnapshot,
  GameplaySnapshot,
  RoomPlayer,
  PowerUpType,
  ActivePowerUp,
} from "@bbm/shared-contracts";
import { DomainError } from "../../domain/errors/domain-error.js";

interface PlayerRuntime {
  state: GamePlayerState;
  displayName: string;
  color: RoomPlayer["color"];
  ballSkin: RoomPlayer["ballSkin"];
  desiredJumpDown: boolean;
  queue: GameInputIntent[];
  inputTimes: number[];
  lastQueuedSequence: number;
  disconnectedAtMs: number | null;
  inventory: PowerUpType[];
  effects: Array<{ type: PowerUpType; expiresAtMs: number }>;
  respawnUntilMs: number | null;
  finishTimeMs: number | null;
  finishPlace: number | null;
}

interface RuntimePickup {
  id: string;
  type: PowerUpType;
  x: number;
  y: number;
  availableAtMs: number | null;
}

interface RaceRuntime {
  raceId: string;
  roomId: string;
  participantCount: number;
  players: Map<string, PlayerRuntime>;
  active: boolean;
  accumulatorSeconds: number;
  lastMonotonicMs: number;
  lastSnapshotAtMs: number;
  snapshotSequence: number;
  simulationTick: number;
  tickRateWindowStartMs: number;
  tickRateWindowTicks: number;
  measuredTickRate: number;
  droppedInputs: number;
  rejectedInputs: number;
  droppedTicks: number;
  checkpointId: string | null;
  pickups: RuntimePickup[];
  startedAt: Date | null;
  resultsPersisted: boolean;
  collisionIterations: number;
  collisionResolutionMs: number;
  environment: EnvironmentSnapshot;
  fallingStartedTick: Map<string, number>;
}

export function deriveFinishPlaces(
  players: readonly {
    guestId: string;
    slot: number;
    finishTimeMs: number | null;
  }[],
): Map<string, number> {
  const finishers = players
    .filter((player) => player.finishTimeMs !== null)
    .sort((a, b) => a.finishTimeMs! - b.finishTimeMs! || a.slot - b.slot);
  return new Map(finishers.map((player, index) => [player.guestId, index + 1]));
}

export function raceCompletionThreshold(participantCount: number): number {
  if (participantCount < 2 || participantCount > 3)
    throw new RangeError("A race must start with two or three participants.");
  return participantCount === 2 ? 1 : participantCount;
}

export function hasReachedRaceFinishTarget(
  participantCount: number,
  finisherCount: number,
): boolean {
  return finisherCount >= raceCompletionThreshold(participantCount);
}

export class GameplayService {
  private readonly sessions = new Map<string, RaceRuntime>();

  prepareRace(
    raceId: string,
    roomId: string,
    roomPlayers: readonly RoomPlayer[],
    monotonicNowMs: number,
  ): GameplaySnapshot {
    const existing = this.sessions.get(raceId);
    if (existing) return this.toSnapshot(existing, new Date());
    const eligiblePlayers = roomPlayers.filter(
      (member) => member.connected && member.ready,
    );
    if (eligiblePlayers.length < 2 || eligiblePlayers.length > 3)
      throw new Error("Gameplay requires two or three room members.");
    const players = new Map<string, PlayerRuntime>();
    eligiblePlayers.forEach((member, slot) => {
      const state = spawnPlayer(member.guestId, raceId, slot, monotonicNowMs);
      players.set(member.guestId, {
        state,
        displayName: member.displayName,
        color: member.color,
        ballSkin: member.ballSkin,
        desiredJumpDown: false,
        queue: [],
        inputTimes: [],
        lastQueuedSequence: 0,
        disconnectedAtMs: member.connected ? null : monotonicNowMs,
        inventory: [],
        effects: [],
        respawnUntilMs: null,
        finishTimeMs: null,
        finishPlace: null,
      });
    });
    const session: RaceRuntime = {
      raceId,
      roomId,
      participantCount: eligiblePlayers.length,
      players,
      active: false,
      accumulatorSeconds: 0,
      lastMonotonicMs: monotonicNowMs,
      lastSnapshotAtMs: monotonicNowMs,
      snapshotSequence: 0,
      simulationTick: 0,
      tickRateWindowStartMs: monotonicNowMs,
      tickRateWindowTicks: 0,
      measuredTickRate: 60,
      droppedInputs: 0,
      rejectedInputs: 0,
      droppedTicks: 0,
      checkpointId: null,
      startedAt: null,
      resultsPersisted: false,
      collisionIterations: 0,
      collisionResolutionMs: 0,
      environment: environmentAt(0),
      fallingStartedTick: new Map(),
      pickups: TEST_LEVEL.pickups.map((pickup) => ({
        ...pickup,
        availableAtMs: null,
      })),
    };
    this.sessions.set(raceId, session);
    return this.toSnapshot(session, new Date());
  }

  activateRace(
    raceId: string,
    monotonicNowMs: number,
    serverNow = new Date(),
  ): GameplaySnapshot {
    const session = this.requireSession(raceId);
    if (!session.active) {
      session.active = true;
      session.startedAt = serverNow;
      session.lastMonotonicMs = monotonicNowMs;
      session.lastSnapshotAtMs = monotonicNowMs - SNAPSHOT_INTERVAL_MS;
      session.tickRateWindowStartMs = monotonicNowMs;
      session.tickRateWindowTicks = 0;
      session.measuredTickRate = 60;
    }
    return this.toSnapshot(session, serverNow);
  }

  acceptInput(input: {
    guestId: string;
    raceId: string;
    sequence: number;
    horizontal: -1 | 0 | 1;
    jumpDown: boolean;
    monotonicNowMs: number;
  }): "accepted" | "ignored" {
    const session = this.sessions.get(input.raceId);
    const runtime = session?.players.get(input.guestId);
    if (
      !session?.active ||
      !runtime ||
      !runtime.state.connected ||
      runtime.state.finished ||
      runtime.respawnUntilMs !== null
    ) {
      if (session) session.rejectedInputs += 1;
      throw new DomainError(
        "NOT_IN_RACE",
        "This guest is not connected to the active race.",
      );
    }
    const sequence = input.sequence;
    if (sequence <= runtime.lastQueuedSequence) {
      session.droppedInputs += 1;
      return "ignored";
    }
    if (sequence - runtime.lastQueuedSequence > 1024) {
      session.rejectedInputs += 1;
      throw new DomainError(
        "INVALID_INPUT",
        "Input sequence is too far ahead of the server.",
      );
    }
    runtime.inputTimes = runtime.inputTimes.filter(
      (acceptedAt) => input.monotonicNowMs - acceptedAt < 1000,
    );
    if (runtime.inputTimes.length >= INPUTS_PER_SECOND_LIMIT) {
      session.rejectedInputs += 1;
      throw new DomainError(
        "RATE_LIMITED",
        "Movement input rate exceeded. Try again shortly.",
      );
    }
    if (runtime.queue.length >= INPUT_QUEUE_LIMIT) {
      session.droppedInputs += 1;
      throw new DomainError(
        "RATE_LIMITED",
        "Movement input queue is full. Try again shortly.",
      );
    }
    runtime.inputTimes.push(input.monotonicNowMs);
    runtime.lastQueuedSequence = sequence;
    runtime.queue.push({
      sequence,
      horizontal: input.horizontal,
      jumpDown: input.jumpDown,
      receivedAtMs: input.monotonicNowMs,
    });
    runtime.state.lastAcceptedInputAtMs = input.monotonicNowMs;
    return "accepted";
  }

  disconnectPlayer(guestId: string, monotonicNowMs: number): void {
    for (const session of this.sessions.values()) {
      const runtime = session.players.get(guestId);
      if (!runtime) continue;
      runtime.state.connected = false;
      runtime.disconnectedAtMs = monotonicNowMs;
      runtime.queue.length = 0;
      return;
    }
  }

  reconnectPlayer(
    guestId: string,
    monotonicNowMs: number,
  ): GameplaySnapshot | null {
    for (const session of this.sessions.values()) {
      const runtime = session.players.get(guestId);
      if (!runtime) continue;
      runtime.state.connected = true;
      runtime.disconnectedAtMs = null;
      runtime.state.lastAcceptedInputAtMs = monotonicNowMs;
      return this.toSnapshot(session, new Date());
    }
    return null;
  }

  tick(monotonicNowMs: number, serverNow = new Date()): GameplaySnapshot[] {
    const snapshots: GameplaySnapshot[] = [];
    for (const session of this.sessions.values()) {
      if (!session.active) continue;
      const elapsedMs = Math.max(0, monotonicNowMs - session.lastMonotonicMs);
      session.lastMonotonicMs = monotonicNowMs;
      session.accumulatorSeconds += Math.min(elapsedMs / 1000, 0.25);
      let steps = 0;
      while (
        session.accumulatorSeconds >= SIMULATION_TICK_SECONDS &&
        steps < SIMULATION_MAX_CATCH_UP_TICKS
      ) {
        this.advanceEnvironment(session);
        for (const runtime of session.players.values())
          this.stepRuntime(
            session,
            runtime,
            SIMULATION_TICK_SECONDS,
            monotonicNowMs,
            serverNow,
          );
        const collisionStartedAt = performance.now();
        session.collisionIterations = resolvePlayerCollisions(
          [...session.players.values()]
            .filter((runtime) => runtime.respawnUntilMs === null)
            .map((runtime) => runtime.state),
        );
        session.collisionResolutionMs = Math.round(
          performance.now() - collisionStartedAt,
        );
        this.processRaceObjects(session, monotonicNowMs, serverNow);
        session.accumulatorSeconds -= SIMULATION_TICK_SECONDS;
        session.simulationTick += 1;
        steps += 1;
      }
      if (session.accumulatorSeconds >= SIMULATION_TICK_SECONDS) {
        session.droppedTicks += Math.floor(
          session.accumulatorSeconds / SIMULATION_TICK_SECONDS,
        );
        session.accumulatorSeconds %= SIMULATION_TICK_SECONDS;
      }
      session.tickRateWindowTicks += steps;
      const tickWindowMs = monotonicNowMs - session.tickRateWindowStartMs;
      if (tickWindowMs >= 1000) {
        session.measuredTickRate = Math.round(
          (session.tickRateWindowTicks * 1000) / tickWindowMs,
        );
        session.tickRateWindowStartMs = monotonicNowMs;
        session.tickRateWindowTicks = 0;
      }
      if (monotonicNowMs - session.lastSnapshotAtMs >= SNAPSHOT_INTERVAL_MS) {
        session.lastSnapshotAtMs = monotonicNowMs;
        snapshots.push(this.toSnapshot(session, serverNow));
      }
    }
    return snapshots;
  }

  snapshot(raceId: string, serverNow = new Date()): GameplaySnapshot | null {
    const session = this.sessions.get(raceId);
    return session?.active ? this.toSnapshot(session, serverNow) : null;
  }

  activatePowerUp(input: {
    raceId: string;
    guestId: string;
    slot: 0 | 1;
    nowMs: number;
  }): void {
    const session = this.sessions.get(input.raceId);
    const player = session?.players.get(input.guestId);
    if (
      !session?.active ||
      !player ||
      !player.state.connected ||
      player.state.finished ||
      player.respawnUntilMs
    )
      throw new DomainError(
        "NOT_IN_RACE",
        "This player cannot use a power-up now.",
      );
    const type = player.inventory[input.slot];
    if (!type)
      throw new DomainError("INVALID_INPUT", "That power-up slot is empty.");
    player.inventory.splice(input.slot, 1);
    const duration = type === "shockwave" ? 0 : POWER_UP_CONFIG.durationMs;
    if (type === "shockwave") {
      applyRadialShockwave(
        player.state,
        [...session.players.values()]
          .filter((other) => other.respawnUntilMs === null)
          .map((other) => other.state),
      );
      return;
    }
    player.effects.push({ type, expiresAtMs: input.nowMs + duration });
  }

  removeRace(raceId: string): boolean {
    return this.sessions.delete(raceId);
  }

  activeSimulationCount(): number {
    return [...this.sessions.values()].filter((session) => session.active)
      .length;
  }

  raceResults(
    raceId: string,
    serverNow = new Date(),
    timeout = false,
  ): {
    results: import("@bbm/shared-contracts").RaceResultEntry[];
    durationMs: number;
  } | null {
    const session = this.sessions.get(raceId);
    if (!session || (!timeout && !this.isRaceComplete(session))) return null;
    const results = [...session.players.values()]
      .sort((a, b) => {
        if (a.finishTimeMs === null)
          return b.finishTimeMs === null ? a.state.slot - b.state.slot : 1;
        if (b.finishTimeMs === null) return -1;
        return a.finishTimeMs - b.finishTimeMs || a.state.slot - b.state.slot;
      })
      .map((runtime) => ({
        guestId: runtime.state.guestId,
        displayName: runtime.displayName,
        color: runtime.color,
        place: runtime.finishPlace,
        finishTimeMs:
          runtime.finishTimeMs === null || !session.startedAt
            ? null
            : runtime.finishTimeMs - session.startedAt.getTime(),
        status:
          runtime.finishTimeMs !== null
            ? ("finished" as const)
            : runtime.state.connected
              ? ("unfinished" as const)
              : ("disconnected" as const),
      }));
    return {
      results,
      durationMs: Math.max(
        0,
        serverNow.getTime() -
          (session.startedAt?.getTime() ?? serverNow.getTime()),
      ),
    };
  }

  markResultsPersisted(raceId: string): void {
    const session = this.sessions.get(raceId);
    if (session) session.resultsPersisted = true;
  }

  needsResultPersistence(raceId: string): boolean {
    return this.sessions.get(raceId)?.resultsPersisted === false;
  }

  private isRaceComplete(session: RaceRuntime): boolean {
    let finished = 0;
    for (const runtime of session.players.values())
      if (runtime.state.finished) finished += 1;
    return hasReachedRaceFinishTarget(session.participantCount, finished);
  }

  diagnostics(): { inputQueueSize: number; droppedTicks: number } {
    let inputQueueSize = 0;
    let droppedTicks = 0;
    for (const session of this.sessions.values()) {
      droppedTicks += session.droppedTicks;
      for (const player of session.players.values())
        inputQueueSize += player.queue.length;
    }
    return { inputQueueSize, droppedTicks };
  }

  private stepRuntime(
    session: RaceRuntime,
    runtime: PlayerRuntime,
    deltaSeconds: number,
    monotonicNowMs: number,
    serverNow: Date,
  ): void {
    const player = runtime.state;
    if (runtime.respawnUntilMs !== null) {
      if (monotonicNowMs >= runtime.respawnUntilMs)
        this.respawn(session, runtime, monotonicNowMs);
      else return;
      return;
    }
    runtime.effects = runtime.effects.filter(
      (effect) => effect.expiresAtMs > monotonicNowMs,
    );
    player.speedMultiplier = runtime.effects.some(
      (effect) => effect.type === "speed",
    )
      ? POWER_UP_CONFIG.speedMultiplier
      : 1;
    player.jumpMultiplier = runtime.effects.some(
      (effect) => effect.type === "jump",
    )
      ? POWER_UP_CONFIG.jumpMultiplier
      : 1;
    player.mass = runtime.effects.some((effect) => effect.type === "heavy")
      ? POWER_UP_CONFIG.heavyMass
      : 1;
    player.radius = runtime.effects.some((effect) => effect.type === "shrink")
      ? POWER_UP_CONFIG.shrinkRadius
      : MOVEMENT_CONFIG.playerHalfSize;
    player.ghost = runtime.effects.some((effect) => effect.type === "ghost");
    if (player.finished) return;
    let jumpPressed = false;
    while (runtime.queue.length > 0) {
      const input = runtime.queue.shift()!;
      if (monotonicNowMs - input.receivedAtMs > 250) {
        session.droppedInputs += 1;
        continue;
      }
      player.horizontal = input.horizontal;
      if (input.jumpDown && !runtime.desiredJumpDown) jumpPressed = true;
      runtime.desiredJumpDown = input.jumpDown;
      player.lastInput = input;
      player.lastProcessedInputSequence = input.sequence;
      player.lastAcceptedInputAtMs = input.receivedAtMs;
    }
    if (
      !player.connected &&
      runtime.disconnectedAtMs !== null &&
      monotonicNowMs - runtime.disconnectedAtMs >= DISCONNECT_NEUTRAL_MS
    ) {
      player.horizontal = 0;
      runtime.desiredJumpDown = false;
      jumpPressed = false;
      player.lastInput = null;
    } else if (
      player.connected &&
      monotonicNowMs - player.lastAcceptedInputAtMs >= DISCONNECT_NEUTRAL_MS
    ) {
      // Stale browser tabs also become neutral even if their TCP socket has not closed.
      player.horizontal = 0;
      runtime.desiredJumpDown = false;
      jumpPressed = false;
      player.lastInput = null;
    }
    stepPlayer(
      player,
      {
        horizontal: player.horizontal,
        jumpDown: runtime.desiredJumpDown,
        jumpPressed,
      },
      deltaSeconds,
      false,
      [
        ...TEST_LEVEL.platforms,
        ...session.environment.movingPlatforms,
        ...session.environment.fallingBlocks.filter(
          (block) => block.state === "falling",
        ),
      ],
    );
    const hazards = [
      ...session.environment.crushingTraps,
      ...session.environment.fallingBlocks.filter(
        (block) => block.state === "falling",
      ),
    ];
    const obstacleHit = hazards.some(
      (item) =>
        player.x + player.radius > item.x &&
        player.x - player.radius < item.x + item.width &&
        player.y + player.radius > item.y &&
        player.y - player.radius < item.y + item.height,
    );
    if (playerInHazard(player) || obstacleHit) {
      runtime.respawnUntilMs =
        monotonicNowMs + RACE_OBJECT_CONFIG.respawnDelayMs;
      runtime.inventory = [];
      runtime.effects = [];
      player.velocityX = 0;
      player.velocityY = 0;
      player.grounded = false;
      player.speedMultiplier = 1;
      player.jumpMultiplier = 1;
      player.mass = 1;
      player.radius = MOVEMENT_CONFIG.playerHalfSize;
      player.ghost = false;
      return;
    }
    player.updatedAtMs = serverNow.getTime();
  }

  private advanceEnvironment(session: RaceRuntime): void {
    const old = session.environment;
    const next = environmentAt(
      (session.simulationTick + 1) * SIMULATION_TICK_SECONDS,
    );
    for (const runtime of session.players.values()) {
      const player = runtime.state;
      if (!player.grounded || runtime.respawnUntilMs !== null) continue;
      const supportIndex = old.movingPlatforms.findIndex(
        (platform) =>
          player.x + player.radius > platform.x &&
          player.x - player.radius < platform.x + platform.width &&
          Math.abs(player.y + player.radius - platform.y) <= 3,
      );
      if (supportIndex >= 0) {
        const before = old.movingPlatforms[supportIndex]!;
        const after = next.movingPlatforms[supportIndex]!;
        player.x += after.x - before.x;
        player.y += after.y - before.y;
      }
    }
    const blocks = next.fallingBlocks.map((block) => {
      const config = TEST_LEVEL.fallingBlocks.find(
        (item) => item.id === block.id,
      )!;
      const started = session.fallingStartedTick.get(block.id);
      if (
        started === undefined &&
        [...session.players.values()].some(
          ({ state: p }) =>
            Math.hypot(p.x - config.triggerX, p.y - config.triggerY) <
            config.triggerRadius,
        )
      )
        session.fallingStartedTick.set(block.id, session.simulationTick + 1);
      const activated = session.fallingStartedTick.get(block.id);
      if (activated === undefined) return block;
      const elapsed =
        (session.simulationTick + 1 - activated) * SIMULATION_TICK_SECONDS;
      if (elapsed < config.fallSeconds)
        return {
          ...block,
          y: config.y + 650 * elapsed * elapsed,
          state: "falling" as const,
        };
      if (elapsed < config.fallSeconds + config.resetSeconds)
        return {
          ...block,
          y: config.y + 650 * config.fallSeconds ** 2,
          state: "resetting" as const,
        };
      session.fallingStartedTick.delete(block.id);
      return block;
    });
    session.environment = { ...next, fallingBlocks: blocks };
  }

  private processRaceObjects(
    session: RaceRuntime,
    nowMs: number,
    serverNow: Date,
  ): void {
    for (const runtime of session.players.values()) {
      const player = runtime.state;
      if (
        !player.connected ||
        player.finished ||
        runtime.respawnUntilMs !== null
      )
        continue;
      if (
        player.x + player.radius >= TEST_LEVEL.finishX &&
        player.y + player.radius >= 360 &&
        player.y - player.radius <= 520
      ) {
        player.finished = true;
        player.velocityX = 0;
        player.velocityY = 0;
        runtime.finishTimeMs =
          (session.startedAt?.getTime() ?? serverNow.getTime()) +
          Math.round(
            (session.simulationTick + 1) * SIMULATION_TICK_SECONDS * 1000,
          );
        const finishPlaces = deriveFinishPlaces(
          [...session.players.values()].map((candidate) => ({
            guestId: candidate.state.guestId,
            slot: candidate.state.slot,
            finishTimeMs: candidate.finishTimeMs,
          })),
        );
        for (const candidate of session.players.values())
          candidate.finishPlace =
            finishPlaces.get(candidate.state.guestId) ?? null;
        if (this.isRaceComplete(session)) break;
        continue;
      }
      const checkpoints = TEST_LEVEL.checkpoints;
      const activeCheckpointIndex = checkpoints.findIndex(
        (item) => item.id === session.checkpointId,
      );
      const checkpoint = checkpoints.find(
        (item, index) =>
          index > activeCheckpointIndex &&
          Math.hypot(player.x - item.x, player.y - item.y) <=
            player.radius + RACE_OBJECT_CONFIG.checkpointActivationRadius,
      );
      if (checkpoint) session.checkpointId = checkpoint.id;
      for (const pickup of session.pickups) {
        if (pickup.availableAtMs !== null && nowMs >= pickup.availableAtMs)
          pickup.availableAtMs = null;
        if (pickup.availableAtMs !== null || runtime.inventory.length >= 2)
          continue;
        if (
          Math.hypot(player.x - pickup.x, player.y - pickup.y) <=
          player.radius + RACE_OBJECT_CONFIG.pickupActivationRadius
        ) {
          runtime.inventory.push(pickup.type);
          pickup.availableAtMs = nowMs + POWER_UP_CONFIG.pickupRespawnMs;
        }
      }
    }
  }

  private respawn(
    session: RaceRuntime,
    runtime: PlayerRuntime,
    nowMs: number,
  ): void {
    const player = runtime.state;
    const checkpoints = TEST_LEVEL.checkpoints;
    const checkpoint = checkpoints.find(
      (item) => item.id === session.checkpointId,
    );
    const start = spawnPlayer(
      player.guestId,
      player.raceId,
      player.slot,
      nowMs,
    );
    Object.assign(
      player,
      start,
      checkpoint ? { x: checkpoint.x, y: checkpoint.y } : {},
    );
    runtime.respawnUntilMs = null;
    runtime.effects = [];
    runtime.inventory = [];
    runtime.desiredJumpDown = false;
  }

  private toSnapshot(session: RaceRuntime, serverNow: Date): GameplaySnapshot {
    session.snapshotSequence += 1;
    const players: GameplayPlayerSnapshot[] = [...session.players.values()]
      .sort((left, right) => left.state.slot - right.state.slot)
      .map((runtime) => ({
        guestId: runtime.state.guestId,
        raceId: session.raceId,
        displayName: runtime.displayName,
        color: runtime.color,
        ballSkin: runtime.ballSkin,
        x: round(runtime.state.x),
        y: round(runtime.state.y),
        velocityX: round(runtime.state.velocityX),
        velocityY: round(runtime.state.velocityY),
        grounded: runtime.state.grounded,
        jumpsUsed: runtime.state.jumpsUsed,
        jumpHeld: runtime.state.jumpDown,
        lastProcessedInputSequence: runtime.state.lastProcessedInputSequence,
        connected: runtime.state.connected,
        simulationTick: session.simulationTick,
        updatedAt: serverNow.toISOString(),
        radius: runtime.state.radius,
        mass: runtime.state.mass,
        ghost: runtime.state.ghost,
        respawning: runtime.respawnUntilMs !== null,
        respawnAt:
          runtime.respawnUntilMs === null
            ? null
            : new Date(
                serverNow.getTime() +
                  Math.max(0, runtime.respawnUntilMs - session.lastMonotonicMs),
              ).toISOString(),
        inventory: [...runtime.inventory],
        activeEffects: runtime.effects.map((effect): ActivePowerUp => ({
          type: effect.type,
          expiresAt: new Date(
            serverNow.getTime() +
              Math.max(0, effect.expiresAtMs - session.lastMonotonicMs),
          ).toISOString(),
        })),
        finished: runtime.state.finished,
        finishPlace: runtime.finishPlace,
        finishedAt:
          runtime.finishTimeMs === null
            ? null
            : new Date(runtime.finishTimeMs).toISOString(),
      }));
    const snapshot: GameplaySnapshot = {
      protocolVersion: 3,
      raceId: session.raceId,
      roomId: session.roomId,
      snapshotSequence: session.snapshotSequence,
      simulationTick: session.simulationTick,
      serverTimestamp: serverNow.toISOString(),
      world: {
        width: MOVEMENT_CONFIG.worldWidth as 2400,
        height: MOVEMENT_CONFIG.worldHeight as 900,
        revision: MOVEMENT_CONFIG.revision as "bbm-physics-v3",
      },
      players,
      checkpointId: session.checkpointId,
      checkpoints: TEST_LEVEL.checkpoints.map((checkpoint) => ({
        ...checkpoint,
        activated: checkpoint.id === session.checkpointId,
      })),
      pickups: session.pickups.map((pickup) => ({
        id: pickup.id,
        type: pickup.type,
        x: pickup.x,
        y: pickup.y,
        available: pickup.availableAtMs === null,
        availableAt:
          pickup.availableAtMs === null
            ? null
            : new Date(
                serverNow.getTime() +
                  Math.max(0, pickup.availableAtMs - session.lastMonotonicMs),
              ).toISOString(),
      })),
      environment: session.environment,
      results: this.isRaceComplete(session)
        ? [...session.players.values()]
            .sort(
              (a, b) =>
                (a.finishTimeMs ?? Number.MAX_SAFE_INTEGER) -
                (b.finishTimeMs ?? Number.MAX_SAFE_INTEGER),
            )
            .map((runtime) => ({
              guestId: runtime.state.guestId,
              displayName: runtime.displayName,
              color: runtime.color,
              place: runtime.finishPlace,
              finishTimeMs:
                runtime.finishTimeMs === null || !session.startedAt
                  ? null
                  : runtime.finishTimeMs - session.startedAt.getTime(),
              status:
                runtime.finishTimeMs !== null
                  ? ("finished" as const)
                  : runtime.state.connected
                    ? ("unfinished" as const)
                    : ("disconnected" as const),
            }))
        : null,
      diagnostics: {
        simulationTickRate: session.measuredTickRate,
        snapshotRate: 20,
        connectedPlayers: players.filter((player) => player.connected).length,
        activeSimulations: this.activeSimulationCount(),
        inputQueueSize: [...session.players.values()].reduce(
          (sum, player) => sum + player.queue.length,
          0,
        ),
        snapshotQueueSize: 0,
        droppedInputs: session.droppedInputs,
        rejectedInputs: session.rejectedInputs,
        droppedSimulationTicks: session.droppedTicks,
        collisionIterations: session.collisionIterations,
        collisionResolutionMs: session.collisionResolutionMs,
        activePowerUps: [...session.players.values()].reduce(
          (sum, runtime) => sum + runtime.effects.length,
          0,
        ),
        respawningPlayers: [...session.players.values()].filter(
          (runtime) => runtime.respawnUntilMs !== null,
        ).length,
        availablePickups: session.pickups.filter(
          (pickup) => pickup.availableAtMs === null,
        ).length,
        finishedPlayers: players.filter((player) => player.finished).length,
        snapshotBytes: 0,
        rejectedCommands: session.rejectedInputs,
      },
    };
    snapshot.diagnostics.snapshotBytes = JSON.stringify(snapshot).length;
    return snapshot;
  }

  private requireSession(raceId: string): RaceRuntime {
    const session = this.sessions.get(raceId);
    if (!session)
      throw new DomainError(
        "NOT_IN_RACE",
        "No gameplay session exists for this race.",
      );
    return session;
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
