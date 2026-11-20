import test from "node:test";
import assert from "node:assert/strict";
import {
  parseClientMessage,
  parseServerMessage,
  PROTOCOL_VERSION,
} from "@bbm/shared-contracts";

const uuid = "4ef32535-e053-49eb-a386-3d947eeb041c";
test("protocol accepts only versioned messages with the exact runtime schema", () => {
  assert.deepEqual(
    parseClientMessage({
      version: PROTOCOL_VERSION,
      requestId: "r1",
      type: "create_room",
      payload: {},
    }),
    {
      version: PROTOCOL_VERSION,
      requestId: "r1",
      type: "create_room",
      payload: {},
    },
  );
  assert.equal(
    parseClientMessage({
      version: PROTOCOL_VERSION,
      requestId: "r1",
      type: "create_room",
      payload: { hostGuestId: uuid },
    }),
    null,
  );
  assert.deepEqual(
    parseClientMessage({
      version: PROTOCOL_VERSION,
      requestId: "race-start",
      type: "start_race",
      payload: {},
    }),
    {
      version: PROTOCOL_VERSION,
      requestId: "race-start",
      type: "start_race",
      payload: {},
    },
  );
  assert.equal(
    parseClientMessage({
      version: 1,
      requestId: "r1",
      type: "create_room",
      payload: {},
    }),
    null,
  );
  assert.equal(
    parseClientMessage({
      version: PROTOCOL_VERSION,
      requestId: "r1",
      type: "set_ready",
      payload: { ready: "yes" },
    }),
    null,
  );
});

test("race snapshots are runtime validated with authoritative countdown timing", () => {
  const now = "2026-10-30T12:00:00.000Z";
  const countdown = {
    raceId: uuid,
    roomId: "99e4292d-e20c-4c51-924a-4a6dc13086a0",
    revision: 1,
    state: "Countdown",
    countdownStartedAt: now,
    countdownDeadlineAt: "2026-10-30T12:00:03.000Z",
    officialStartAt: null,
    timeoutDeadlineAt: null,
    cancellationReason: null,
    cancelledAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    serverNow: now,
  };
  assert.ok(
    parseServerMessage({
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "race_countdown_started",
      payload: { race: countdown },
    }),
  );
  assert.ok(
    parseServerMessage({
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "race_state_changed",
      payload: { race: countdown },
    }),
  );
  assert.equal(
    parseServerMessage({
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "race_started",
      payload: { race: countdown },
    }),
    null,
  );
  assert.equal(
    parseServerMessage({
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "race_snapshot",
      payload: { race: { ...countdown, state: "Countdown", revision: -1 } },
    }),
    null,
  );
});

test("room-code protocol accepts normalized display formats but rejects invalid characters", () => {
  assert.ok(
    parseClientMessage({
      version: PROTOCOL_VERSION,
      requestId: "r2",
      type: "join_room",
      payload: { code: "ab-cd 23" },
    }),
  );
  assert.equal(
    parseClientMessage({
      version: PROTOCOL_VERSION,
      requestId: "r2",
      type: "join_room",
      payload: { code: "AB!CD1" },
    }),
    null,
  );
});

test("server messages are runtime checked before the client consumes them", () => {
  assert.equal(
    parseServerMessage({
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "room_snapshot_updated",
      payload: { room: {} },
    }),
    null,
  );
  assert.equal(
    parseServerMessage({
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "room_closed",
      payload: { roomId: uuid, reason: "host_migrated" },
    }),
    null,
  );
});

test("movement inputs carry intentions only and validate bounded sequences", () => {
  const valid = {
    version: PROTOCOL_VERSION,
    requestId: "movement-1",
    type: "move_input",
    payload: {
      raceId: uuid,
      sequence: 1,
      horizontal: -1,
      jumpDown: true,
    },
  };
  assert.deepEqual(parseClientMessage(valid), valid);
  assert.equal(
    parseClientMessage({
      ...valid,
      payload: { ...valid.payload, horizontal: 2 },
    }),
    null,
  );
  assert.equal(
    parseClientMessage({
      ...valid,
      payload: { ...valid.payload, raceId: undefined },
    }),
    null,
  );
  assert.equal(
    parseClientMessage({
      ...valid,
      payload: { ...valid.payload, jumpDown: "yes" },
    }),
    null,
  );
  assert.equal(
    parseClientMessage({
      ...valid,
      payload: { ...valid.payload, sequence: 2_147_483_648 },
    }),
    null,
  );
  assert.equal(
    parseClientMessage({
      ...valid,
      payload: { ...valid.payload, x: 999_999, y: -999_999 },
    }),
    null,
  );
});

test("power-up activation validates only the race and bounded inventory slot", () => {
  const message = {
    version: PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    type: "activate_power_up",
    payload: { raceId: uuid, slot: 1 },
  };
  assert.ok(parseClientMessage(message));
  assert.equal(
    parseClientMessage({ ...message, payload: { raceId: uuid, slot: 2 } }),
    null,
  );
  assert.equal(
    parseClientMessage({
      ...message,
      payload: { ...message.payload, guestId: uuid },
    }),
    null,
  );
});

test("gameplay snapshots validate room, race, player, world, and diagnostics", () => {
  const snapshot = {
    protocolVersion: PROTOCOL_VERSION,
    raceId: uuid,
    roomId: "99e4292d-e20c-4c51-924a-4a6dc13086a0",
    snapshotSequence: 1,
    simulationTick: 3,
    serverTimestamp: "2026-10-30T12:00:00.050Z",
    world: { width: 2400, height: 900, revision: "bbm-physics-v3" },
    players: [
      {
        guestId: uuid,
        raceId: uuid,
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
        simulationTick: 3,
        updatedAt: "2026-10-30T12:00:00.050Z",
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
      },
      {
        guestId: "b5535a65-27cb-4f7c-941a-43bfe577afcc",
        raceId: uuid,
        displayName: "Bravo",
        color: "coral",
        ballSkin: "basketball",
        x: 220,
        y: 437,
        velocityX: 0,
        velocityY: 0,
        grounded: true,
        jumpsUsed: 0,
        jumpHeld: false,
        lastProcessedInputSequence: 0,
        connected: true,
        simulationTick: 3,
        updatedAt: "2026-10-30T12:00:00.050Z",
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
      },
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
    checkpoints: [{ id: "checkpoint-1", x: 560, y: 428, activated: false }],
    pickups: [],
    environment: { movingPlatforms: [], fallingBlocks: [], crushingTraps: [] },
    results: null,
  };
  assert.ok(
    parseServerMessage({
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "gameplay_snapshot",
      payload: snapshot,
    }),
  );
  assert.equal(
    parseServerMessage({
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "gameplay_snapshot",
      payload: {
        ...snapshot,
        players: snapshot.players.map((player) => ({ ...player, x: Infinity })),
      },
    }),
    null,
  );
  assert.equal(
    parseServerMessage({
      version: PROTOCOL_VERSION,
      requestId: null,
      type: "gameplay_snapshot",
      payload: {
        ...snapshot,
        players: snapshot.players.map((player, index) =>
          index === 0 ? { ...player, ballSkin: "lava" } : player,
        ),
      },
    }),
    null,
  );
});
