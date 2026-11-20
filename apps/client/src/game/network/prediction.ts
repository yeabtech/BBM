import {
  copyPlayerState,
  stepPlayer,
  type GameInputIntent,
  type GamePlayerState,
} from "@bbm/game-simulation";
import type {
  GameplayPlayerSnapshot,
  GameplaySnapshot,
} from "@bbm/shared-contracts";

export interface PredictedInput {
  readonly sequence: number;
  readonly horizontal: -1 | 0 | 1;
  readonly jumpDown: boolean;
  predictedTicks: number;
}

export interface ReconciliationResult {
  readonly applied: boolean;
  readonly correctionDistance: number;
  readonly correctionX: number;
  readonly correctionY: number;
  readonly snapped: boolean;
}

export class LocalPrediction {
  private pending: PredictedInput[] = [];
  private latestSnapshotSequence = -1;
  private latestAcknowledgedInput = 0;
  private currentInput = { horizontal: 0 as -1 | 0 | 1, jumpDown: false };

  constructor(
    private state: GamePlayerState,
    private readonly maxPending = 120,
  ) {}

  get currentState(): GamePlayerState {
    return copyPlayerState(this.state);
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  get lastAcknowledgedInput(): number {
    return this.latestAcknowledgedInput;
  }

  setInput(input: Omit<GameInputIntent, "receivedAtMs">): boolean {
    if (this.pending.length >= this.maxPending) return false;
    this.currentInput = {
      horizontal: input.horizontal,
      jumpDown: input.jumpDown,
    };
    this.pending.push({
      ...this.currentInput,
      sequence: input.sequence,
      predictedTicks: 0,
    });
    this.state.horizontal = input.horizontal;
    this.state.lastInput = {
      ...this.currentInput,
      sequence: input.sequence,
      receivedAtMs: 0,
    };
    this.predictOneTick();
    return true;
  }

  predictOneTick(): void {
    stepPlayer(this.state, this.currentInput);
    const last = this.pending.at(-1);
    if (last) last.predictedTicks += 1;
  }

  reconcile(
    snapshot: GameplaySnapshot,
    player: GameplayPlayerSnapshot,
  ): ReconciliationResult {
    if (snapshot.snapshotSequence <= this.latestSnapshotSequence)
      return {
        applied: false,
        correctionDistance: 0,
        correctionX: 0,
        correctionY: 0,
        snapped: false,
      };
    this.latestSnapshotSequence = snapshot.snapshotSequence;
    this.latestAcknowledgedInput = Math.max(
      this.latestAcknowledgedInput,
      player.lastProcessedInputSequence,
    );
    this.pending = this.pending.filter(
      (input) => input.sequence > this.latestAcknowledgedInput,
    );
    const beforeX = this.state.x;
    const beforeY = this.state.y;
    this.state = {
      guestId: player.guestId,
      playerId: player.guestId,
      raceId: player.raceId,
      slot: snapshot.players.findIndex(
        (entry) => entry.guestId === player.guestId,
      ),
      x: player.x,
      y: player.y,
      velocityX: player.velocityX,
      velocityY: player.velocityY,
      grounded: player.grounded,
      jumpsUsed: player.jumpsUsed,
      jumpDown: player.jumpHeld,
      lastProcessedInputSequence: player.lastProcessedInputSequence,
      lastAcceptedInputAtMs: 0,
      connected: player.connected,
      tick: player.simulationTick,
      updatedAtMs: Date.parse(player.updatedAt),
      horizontal: this.currentInput.horizontal,
      lastInput: null,
      mass: player.mass,
      radius: player.radius,
      ghost: player.ghost,
      finished: player.finished,
      speedMultiplier: player.activeEffects.some(
        (effect) => effect.type === "speed",
      )
        ? 1.35
        : 1,
      jumpMultiplier: player.activeEffects.some(
        (effect) => effect.type === "jump",
      )
        ? 1.3
        : 1,
    };
    for (const input of this.pending) {
      this.currentInput = {
        horizontal: input.horizontal,
        jumpDown: input.jumpDown,
      };
      this.state.horizontal = input.horizontal;
      for (let tick = 0; tick < input.predictedTicks; tick++)
        stepPlayer(this.state, this.currentInput);
    }
    const correctionDistance = Math.hypot(
      this.state.x - beforeX,
      this.state.y - beforeY,
    );
    return {
      applied: true,
      correctionDistance,
      correctionX: this.state.x - beforeX,
      correctionY: this.state.y - beforeY,
      snapped: correctionDistance > 80,
    };
  }
}

export interface InterpolatedPosition {
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly connected: boolean;
  readonly displayName: string;
  readonly color: GameplayPlayerSnapshot["color"];
}

interface TimedSample {
  atMs: number;
  player: GameplayPlayerSnapshot;
  snapshotSequence: number;
}

export class RemoteInterpolationBuffer {
  private readonly samples: TimedSample[] = [];
  private latestSequence = -1;

  constructor(
    private readonly capacity = 8,
    private readonly maxExtrapolationMs = 100,
  ) {}

  add(
    snapshot: GameplaySnapshot,
    player: GameplayPlayerSnapshot,
    receivedAtMs: number,
  ): boolean {
    if (snapshot.snapshotSequence <= this.latestSequence) return false;
    this.latestSequence = snapshot.snapshotSequence;
    const previous = this.samples.at(-1);
    if (previous && receivedAtMs - previous.atMs > 1000)
      this.samples.length = 0;
    this.samples.push({
      atMs: receivedAtMs,
      player,
      snapshotSequence: snapshot.snapshotSequence,
    });
    if (this.samples.length > this.capacity) this.samples.shift();
    return true;
  }

  sample(renderAtMs: number): InterpolatedPosition | null {
    if (this.samples.length === 0) return null;
    let before = this.samples[0]!;
    let after: TimedSample | undefined;
    for (let index = 1; index < this.samples.length; index++) {
      const candidate = this.samples[index]!;
      if (candidate.atMs >= renderAtMs) {
        after = candidate;
        break;
      }
      before = candidate;
    }
    if (after && after.atMs > before.atMs) {
      const amount = Math.max(
        0,
        Math.min(1, (renderAtMs - before.atMs) / (after.atMs - before.atMs)),
      );
      return interpolate(before.player, after.player, amount);
    }
    const age = Math.max(
      0,
      Math.min(this.maxExtrapolationMs, renderAtMs - before.atMs),
    );
    return {
      x: before.player.x + (before.player.velocityX * age) / 1000,
      y: before.player.y + (before.player.velocityY * age) / 1000,
      velocityX: before.player.velocityX,
      velocityY: before.player.velocityY,
      connected: before.player.connected,
      displayName: before.player.displayName,
      color: before.player.color,
    };
  }

  clear(): void {
    this.samples.length = 0;
    this.latestSequence = -1;
  }

  get size(): number {
    return this.samples.length;
  }
}

export function playerStateFromSnapshot(
  player: GameplayPlayerSnapshot,
  slot: number,
): GamePlayerState {
  return {
    guestId: player.guestId,
    playerId: player.guestId,
    raceId: player.raceId,
    slot,
    x: player.x,
    y: player.y,
    velocityX: player.velocityX,
    velocityY: player.velocityY,
    grounded: player.grounded,
    jumpsUsed: player.jumpsUsed,
    jumpDown: player.jumpHeld,
    lastProcessedInputSequence: player.lastProcessedInputSequence,
    lastAcceptedInputAtMs: 0,
    connected: player.connected,
    tick: player.simulationTick,
    updatedAtMs: Date.parse(player.updatedAt),
    horizontal: 0,
    lastInput: null,
    mass: player.mass,
    radius: player.radius,
    ghost: player.ghost,
    finished: player.finished,
    speedMultiplier: player.activeEffects.some(
      (effect) => effect.type === "speed",
    )
      ? 1.35
      : 1,
    jumpMultiplier: player.activeEffects.some(
      (effect) => effect.type === "jump",
    )
      ? 1.3
      : 1,
  };
}

function interpolate(
  from: GameplayPlayerSnapshot,
  to: GameplayPlayerSnapshot,
  amount: number,
): InterpolatedPosition {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    velocityX: to.velocityX,
    velocityY: to.velocityY,
    connected: to.connected,
    displayName: to.displayName,
    color: to.color,
  };
}
