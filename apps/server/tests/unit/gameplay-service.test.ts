import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveFinishPlaces,
  GameplayService,
  hasReachedRaceFinishTarget,
  raceCompletionThreshold,
} from "../../src/application/services/gameplay-service.js";
import type { RoomPlayer } from "@bbm/shared-contracts";

const raceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roomId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const guestA = "11111111-1111-4111-8111-111111111111";
const guestB = "22222222-2222-4222-8222-222222222222";

function players(): RoomPlayer[] {
  return [
    {
      guestId: guestA,
      displayName: "Alpha",
      color: "mint",
      ballSkin: "soccer",
      host: true,
      connected: true,
      ready: true,
    },
    {
      guestId: guestB,
      displayName: "Bravo",
      color: "coral",
      ballSkin: "basketball",
      host: false,
      connected: true,
      ready: true,
    },
  ];
}

function prepared(service = new GameplayService()) {
  service.prepareRace(raceId, roomId, players(), 0);
  service.activateRace(raceId, 0, new Date(0));
  return service;
}

test("race simulation spawns ordered players and acknowledges intention inputs", () => {
  const service = prepared();
  const initial = service.snapshot(raceId, new Date(0))!;
  assert.equal(initial.players[0]?.x, 160);
  assert.equal(initial.players[1]?.x, 220);
  assert.equal(initial.players[0]?.y, 428);
  assert.equal(initial.world.width, 2400);
  assert.equal(initial.players[0]?.guestId, guestA);
  assert.equal(initial.players[1]?.ballSkin, "basketball");
  assert.equal("token" in initial.players[0]!, false);
  assert.equal(
    service.acceptInput({
      guestId: guestA,
      raceId,
      sequence: 1,
      horizontal: 1,
      jumpDown: false,
      monotonicNowMs: 1,
    }),
    "accepted",
  );
  const updates = service.tick(20, new Date(20));
  assert.equal(updates.length, 1);
  const moved = updates[0]!.players[0]!;
  assert.ok(moved.x > 160);
  assert.equal(moved.lastProcessedInputSequence, 1);
  assert.equal(moved.simulationTick, 1);
});

test("independent races keep their state and share one simulation instance per race", () => {
  const service = prepared();
  const anotherRace = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  service.prepareRace(anotherRace, roomId, players(), 0);
  service.activateRace(anotherRace, 0, new Date(0));
  service.prepareRace(raceId, roomId, players(), 10);
  assert.equal(service.activeSimulationCount(), 2);
  service.acceptInput({
    guestId: guestA,
    raceId,
    sequence: 1,
    horizontal: 1,
    jumpDown: false,
    monotonicNowMs: 1,
  });
  service.tick(50, new Date(50));
  assert.ok(service.snapshot(raceId)!.players[0]!.x > 160);
  assert.equal(service.snapshot(anotherRace)!.players[0]!.x, 160);
});

test("stale sequence numbers are ignored and impossible progression is rejected", () => {
  const service = prepared();
  service.acceptInput({
    guestId: guestA,
    raceId,
    sequence: 1,
    horizontal: 1,
    jumpDown: false,
    monotonicNowMs: 1,
  });
  assert.equal(
    service.acceptInput({
      guestId: guestA,
      raceId,
      sequence: 1,
      horizontal: -1,
      jumpDown: true,
      monotonicNowMs: 2,
    }),
    "ignored",
  );
  assert.throws(
    () =>
      service.acceptInput({
        guestId: guestA,
        raceId,
        sequence: 2000,
        horizontal: 0,
        jumpDown: false,
        monotonicNowMs: 3,
      }),
    /too far ahead/,
  );
});

test("bounded fixed timestep caps catch-up and neutralizes stale input", () => {
  const service = prepared();
  service.acceptInput({
    guestId: guestA,
    raceId,
    sequence: 1,
    horizontal: 1,
    jumpDown: false,
    monotonicNowMs: 1,
  });
  service.tick(20, new Date(20));
  const moving = service.snapshot(raceId)!.players[0]!;
  assert.ok(moving.velocityX > 0);
  const afterStall = service.tick(1000, new Date(1000))[0]!;
  assert.equal(afterStall.simulationTick, 9);
  assert.equal(afterStall.diagnostics.simulationTickRate, 9);
  assert.ok(afterStall.players[0]!.velocityX < moving.velocityX);
  assert.equal(service.diagnostics().droppedTicks > 0, true);
});

test("disconnect preserves state; reconnect resumes the same player and race", () => {
  const service = prepared();
  service.acceptInput({
    guestId: guestA,
    raceId,
    sequence: 1,
    horizontal: 1,
    jumpDown: false,
    monotonicNowMs: 1,
  });
  service.tick(20, new Date(20));
  const before = service.snapshot(raceId)!.players[0]!;
  service.disconnectPlayer(guestA, 21);
  service.tick(300, new Date(300));
  const disconnected = service.snapshot(raceId)!.players[0]!;
  const obstacleStateAtReconnect = service.snapshot(raceId)!.environment;
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.x >= before.x, true);
  const resumed = service.reconnectPlayer(guestA, 301)!;
  assert.deepEqual(resumed.environment, obstacleStateAtReconnect);
  assert.equal(resumed.players[0]!.connected, true);
  assert.equal(resumed.players[0]!.x, disconnected.x);
  assert.equal(resumed.players[0]!.lastProcessedInputSequence, 1);
});

test("race cleanup removes simulation state", () => {
  const service = prepared();
  assert.equal(service.activeSimulationCount(), 1);
  assert.equal(service.removeRace(raceId), true);
  assert.equal(service.activeSimulationCount(), 0);
  assert.equal(service.snapshot(raceId), null);
});

test("sequential race lifecycles release every runtime simulation", () => {
  const service = new GameplayService();
  for (let index = 0; index < 100; index += 1) {
    const id = `race-${index}`;
    service.prepareRace(id, roomId, players(), index * 100);
    service.activateRace(id, index * 100, new Date(index * 100));
    assert.ok(service.snapshot(id));
    assert.equal(service.removeRace(id), true);
  }
  assert.equal(service.activeSimulationCount(), 0);
});

test("finish placements use authoritative timestamps and stable slot tie breaking", () => {
  const places = deriveFinishPlaces([
    { guestId: guestA, slot: 0, finishTimeMs: 1200 },
    { guestId: guestB, slot: 1, finishTimeMs: 900 },
    {
      guestId: "33333333-3333-4333-8333-333333333333",
      slot: 2,
      finishTimeMs: 900,
    },
  ]);
  assert.equal(places.get(guestB), 1);
  assert.equal(places.get("33333333-3333-4333-8333-333333333333"), 2);
  assert.equal(places.get(guestA), 3);
  assert.equal(
    deriveFinishPlaces([
      { guestId: guestA, slot: 0, finishTimeMs: 1 },
      { guestId: guestB, slot: 1, finishTimeMs: null },
    ]).has(guestB),
    false,
  );
});

test("race completion threshold stays fixed to the official participant count", () => {
  assert.equal(raceCompletionThreshold(2), 1);
  assert.equal(raceCompletionThreshold(3), 3);
  assert.equal(hasReachedRaceFinishTarget(2, 1), true);
  assert.equal(hasReachedRaceFinishTarget(2, 0), false);
  assert.equal(hasReachedRaceFinishTarget(3, 1), false);
  assert.equal(hasReachedRaceFinishTarget(3, 2), false);
  assert.equal(hasReachedRaceFinishTarget(3, 3), true);
  assert.throws(() => raceCompletionThreshold(1), /two or three/);
});

test("race participant set excludes disconnected members and stays fixed", () => {
  const service = new GameplayService();
  const third: RoomPlayer = {
    guestId: "33333333-3333-4333-8333-333333333333",
    displayName: "Offline",
    color: "sun",
    ballSkin: "volleyball",
    host: false,
    connected: false,
    ready: false,
  };
  service.prepareRace(raceId, roomId, [...players(), third], 0);
  service.activateRace(raceId, 0, new Date(0));
  assert.deepEqual(
    service.snapshot(raceId)!.players.map((player) => player.guestId),
    [guestA, guestB],
  );
  service.disconnectPlayer(guestB, 1);
  assert.equal(hasReachedRaceFinishTarget(2, 1), true);
  assert.equal(hasReachedRaceFinishTarget(3, 2), false);
});

test("input queue and rate are bounded and old input is dropped", () => {
  const queueBounded = prepared();
  for (let sequence = 1; sequence <= 64; sequence++)
    queueBounded.acceptInput({
      guestId: guestA,
      raceId,
      sequence,
      horizontal: 1,
      jumpDown: false,
      monotonicNowMs: 1,
    });
  assert.equal(queueBounded.diagnostics().inputQueueSize, 64);
  assert.throws(
    () =>
      queueBounded.acceptInput({
        guestId: guestA,
        raceId,
        sequence: 65,
        horizontal: 1,
        jumpDown: false,
        monotonicNowMs: 1,
      }),
    /queue is full/,
  );

  const rateBounded = prepared();
  for (let sequence = 1; sequence <= 120; sequence++) {
    const now = sequence * 8;
    rateBounded.acceptInput({
      guestId: guestA,
      raceId,
      sequence,
      horizontal: 1,
      jumpDown: false,
      monotonicNowMs: now,
    });
    rateBounded.tick(now + 8, new Date(now + 8));
  }
  assert.throws(
    () =>
      rateBounded.acceptInput({
        guestId: guestA,
        raceId,
        sequence: 121,
        horizontal: 1,
        jumpDown: false,
        monotonicNowMs: 968,
      }),
    /rate exceeded/,
  );

  const freshness = prepared();
  freshness.acceptInput({
    guestId: guestA,
    raceId,
    sequence: 1,
    horizontal: 1,
    jumpDown: false,
    monotonicNowMs: 1,
  });
  const stale = freshness.tick(300, new Date(300))[0]!;
  assert.equal(stale.players[0]!.lastProcessedInputSequence, 0);
  assert.equal(stale.players[0]!.x, 160);
  assert.equal(stale.diagnostics.droppedInputs, 1);
});

test("jump intentions require release edges and cannot reset airborne jumps", () => {
  const service = prepared();
  const send = (sequence: number, jumpDown: boolean) =>
    service.acceptInput({
      guestId: guestA,
      raceId,
      sequence,
      horizontal: 0,
      jumpDown,
      monotonicNowMs: sequence * 20,
    });
  send(1, true);
  service.tick(20, new Date(20));
  assert.equal(service.snapshot(raceId)!.players[0]!.jumpsUsed, 1);
  send(2, true);
  service.tick(40, new Date(40));
  assert.equal(service.snapshot(raceId)!.players[0]!.jumpsUsed, 1);
  send(3, false);
  service.tick(60, new Date(60));
  send(4, true);
  service.tick(80, new Date(80));
  assert.equal(service.snapshot(raceId)!.players[0]!.jumpsUsed, 2);
  send(5, false);
  service.tick(100, new Date(100));
  send(6, true);
  service.tick(120, new Date(120));
  assert.equal(service.snapshot(raceId)!.players[0]!.jumpsUsed, 2);
});

test("shared checkpoint and pickup collection are authoritative and power-up storage is limited", () => {
  const service = prepared();
  let sequence = 0;
  for (let frame = 1; frame <= 100; frame += 1) {
    const now = frame * 17;
    if (frame % 3 === 1) {
      sequence += 1;
      service.acceptInput({
        guestId: guestA,
        raceId,
        sequence,
        horizontal: 1,
        jumpDown: false,
        monotonicNowMs: now,
      });
      const other = service
        .snapshot(raceId)!
        .players.find((player) => player.guestId === guestB)!;
      if (!other.respawning && !other.finished)
        service.acceptInput({
          guestId: guestB,
          raceId,
          sequence,
          horizontal: 1,
          jumpDown: false,
          monotonicNowMs: now,
        });
    }
    service.tick(now, new Date(now));
  }
  const state = service.snapshot(raceId)!;
  assert.equal(
    state.checkpointId,
    "checkpoint-1",
    `x=${state.players[0]!.x} y=${state.players[0]!.y} respawn=${state.players[0]!.respawning}`,
  );
  assert.equal(state.checkpoints[0]!.activated, true);
  const holder = state.players.find((player) =>
    player.inventory.includes("speed"),
  );
  assert.ok(holder);
  assert.throws(
    () =>
      service.activatePowerUp({
        raceId,
        guestId: holder!.guestId,
        slot: 1,
        nowMs: 1_700,
      }),
    /slot is empty/,
  );
  service.activatePowerUp({
    raceId,
    guestId: holder!.guestId,
    slot: 0,
    nowMs: 1_700,
  });
  const activated = service.snapshot(raceId)!;
  const activatedPlayer = activated.players.find(
    (player) => player.guestId === holder!.guestId,
  )!;
  assert.equal(activatedPlayer.inventory.length, 0);
  assert.equal(activatedPlayer.activeEffects[0]!.type, "speed");
  const effectExpiryMs = Date.parse(
    activatedPlayer.activeEffects[0]!.expiresAt,
  );
  assert.ok(effectExpiryMs > 0);
  service.disconnectPlayer(holder!.guestId, 2_000);
  service.tick(10_000, new Date(10_000));
  const resumed = service.reconnectPlayer(holder!.guestId, 10_001)!;
  assert.equal(resumed.checkpointId, "checkpoint-1");
  assert.equal(
    resumed.players.find((player) => player.guestId === holder!.guestId)!
      .activeEffects.length,
    0,
  );
});

test("respawn delay is server-owned and uses the shared checkpoint", () => {
  const service = prepared();
  let sequence = 0;
  let sawRespawning = false;
  let now = 0;
  for (let frame = 1; frame <= 240; frame += 1) {
    now = frame * 17;
    if (frame % 3 === 1) {
      sequence += 1;
      service.acceptInput({
        guestId: guestA,
        raceId,
        sequence,
        horizontal: 1,
        jumpDown: false,
        monotonicNowMs: now,
      });
      const other = service
        .snapshot(raceId)!
        .players.find((player) => player.guestId === guestB)!;
      if (!other.respawning && !other.finished)
        service.acceptInput({
          guestId: guestB,
          raceId,
          sequence,
          horizontal: 1,
          jumpDown: false,
          monotonicNowMs: now,
        });
    }
    service.tick(now, new Date(now));
    if (service.snapshot(raceId)!.players[0]!.respawning) {
      sawRespawning = true;
      break;
    }
  }
  assert.equal(sawRespawning, true);
  assert.ok(service.snapshot(raceId)!.players[0]!.respawnAt);
  service.tick(now + 1_600, new Date(now + 1_600));
  const after = service.snapshot(raceId)!.players[0]!;
  assert.equal(after.respawning, false);
  assert.ok(Math.abs(after.x - 560) < 50);
  assert.ok(Math.abs(after.y - 428) < 50);
  assert.equal(after.jumpsUsed, 0);
});
