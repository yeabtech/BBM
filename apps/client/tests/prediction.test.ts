import assert from "node:assert/strict";
import test from "node:test";
import { spawnPlayer } from "@bbm/game-simulation";
import type {
  GameplayPlayerSnapshot,
  GameplaySnapshot,
} from "@bbm/shared-contracts";
import {
  LocalPrediction,
  RemoteInterpolationBuffer,
} from "../src/game/network/prediction.js";

const raceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roomId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const guestId = "11111111-1111-4111-8111-111111111111";

function player(
  overrides: Partial<GameplayPlayerSnapshot> = {},
): GameplayPlayerSnapshot {
  return {
    guestId,
    raceId,
    displayName: "Alpha",
    color: "mint",
    ballSkin: "soccer",
    x: 160,
    y: 437,
    velocityX: 0,
    velocityY: 0,
    grounded: true,
    jumpsUsed: 0,
    jumpHeld: false,
    lastProcessedInputSequence: 0,
    connected: true,
    simulationTick: 0,
    updatedAt: new Date(0).toISOString(),
    radius: 22,
    mass: 1,
    ghost: false,
    respawning: false,
    respawnAt: null,
    inventory: [],
    activeEffects: [],
    finished: false,
    finishPlace: null,
    finishedAt: null,
    ...overrides,
  };
}

function snapshot(
  sequence: number,
  playerState: GameplayPlayerSnapshot,
): GameplaySnapshot {
  return {
    protocolVersion: 3,
    raceId,
    roomId,
    snapshotSequence: sequence,
    simulationTick: sequence,
    serverTimestamp: new Date(sequence * 50).toISOString(),
    world: { width: 2400, height: 900, revision: "bbm-physics-v3" },
    players: [
      playerState,
      player({
        guestId: "22222222-2222-4222-8222-222222222222",
        displayName: "Bravo",
        color: "coral",
        x: 220,
      }),
    ],
    diagnostics: {
      simulationTickRate: 60,
      snapshotRate: 20,
      connectedPlayers: 2,
      activeSimulations: 1,
      inputQueueSize: 0,
      snapshotQueueSize: 0,
      droppedInputs: 0,
      rejectedInputs: 0,
      droppedSimulationTicks: 0,
      collisionIterations: 0,
      collisionResolutionMs: 0,
      activePowerUps: 0,
      respawningPlayers: 0,
      availablePickups: 6,
      finishedPlayers: 0,
      snapshotBytes: 0,
      rejectedCommands: 0,
    },
    checkpointId: null,
    checkpoints: [],
    pickups: [],
    environment: { movingPlatforms: [], fallingBlocks: [], crushingTraps: [] },
    results: null,
  };
}

test("local prediction applies movement immediately and reconciliation acknowledges input", () => {
  const predicted = new LocalPrediction(spawnPlayer(guestId, raceId, 0, 0));
  assert.equal(
    predicted.setInput({ sequence: 1, horizontal: 1, jumpDown: false }),
    true,
  );
  assert.ok(predicted.currentState.x > 160);
  const authoritative = player({
    x: 160.4,
    velocityX: 24,
    lastProcessedInputSequence: 1,
    simulationTick: 1,
  });
  const correction = predicted.reconcile(
    snapshot(1, authoritative),
    authoritative,
  );
  assert.equal(correction.applied, true);
  assert.equal(predicted.pendingCount, 0);
  assert.equal(predicted.lastAcknowledgedInput, 1);
});

test("reconciliation replays pending inputs and ignores stale snapshots", () => {
  const predicted = new LocalPrediction(spawnPlayer(guestId, raceId, 0, 0));
  predicted.setInput({ sequence: 1, horizontal: 1, jumpDown: false });
  predicted.predictOneTick();
  const serverPlayer = player({
    x: 160,
    velocityX: 0,
    lastProcessedInputSequence: 0,
  });
  predicted.reconcile(snapshot(3, serverPlayer), serverPlayer);
  assert.ok(predicted.currentState.x > 160);
  assert.equal(
    predicted.reconcile(snapshot(2, serverPlayer), serverPlayer).applied,
    false,
  );
});

test("interpolation smooths remote snapshots and ignores duplicate or old ones", () => {
  const buffer = new RemoteInterpolationBuffer(3);
  const first = snapshot(1, player({ x: 100, velocityX: 100 }));
  const secondPlayer = player({ x: 110, velocityX: 100 });
  const second = snapshot(2, secondPlayer);
  assert.equal(buffer.add(first, first.players[0]!, 100), true);
  assert.equal(buffer.add(second, secondPlayer, 200), true);
  assert.equal(buffer.add(first, first.players[0]!, 210), false);
  assert.equal(buffer.sample(150)?.x, 105);
  assert.equal(buffer.size, 2);
});

test("interpolation extrapolation is capped and stale buffers can be cleared", () => {
  const buffer = new RemoteInterpolationBuffer(3, 100);
  const latest = snapshot(1, player({ x: 100, velocityX: 200 }));
  buffer.add(latest, latest.players[0]!, 100);
  assert.equal(buffer.sample(10_000)?.x, 120);
  buffer.clear();
  assert.equal(buffer.sample(10_000), null);
});
