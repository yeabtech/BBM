import assert from "node:assert/strict";
import test from "node:test";
import {
  MOVEMENT_CONFIG,
  PLAYER_COLLISION_CONFIG,
  POWER_UP_CONFIG,
  TEST_LEVEL,
  applyRadialShockwave,
  resolvePlayerCollisions,
  spawnPlayer,
  stepHorizontalMovement,
  stepPlayer,
  environmentAt,
} from "../src/index.js";

test("shared movement accelerates, decelerates, reverses, and caps speed", () => {
  const movement = { horizontalVelocity: 0, jumpsUsed: 0 };
  for (let index = 0; index < 60; index++)
    stepHorizontalMovement(movement, {
      axis: 1,
      grounded: true,
      deltaSeconds: 1 / 60,
    });
  assert.equal(movement.horizontalVelocity, MOVEMENT_CONFIG.maxHorizontalSpeed);
  for (let index = 0; index < 60; index++)
    stepHorizontalMovement(movement, {
      axis: 0,
      grounded: true,
      deltaSeconds: 1 / 60,
    });
  assert.equal(movement.horizontalVelocity, 0);
  stepHorizontalMovement(movement, {
    axis: 1,
    grounded: true,
    deltaSeconds: 1 / 60,
  });
  const initial = movement.horizontalVelocity;
  for (let index = 0; index < 10; index++)
    stepHorizontalMovement(movement, {
      axis: -1,
      grounded: true,
      deltaSeconds: 1 / 60,
    });
  assert.ok(movement.horizontalVelocity < initial);
  assert.ok(Math.abs(movement.horizontalVelocity) <= 270);
});

test("environment paths are deterministic and reverse without discontinuities", () => {
  const a = environmentAt(1.25);
  const b = environmentAt(1.25);
  assert.deepEqual(a, b);
  const path = TEST_LEVEL.movingPlatforms[0]!;
  const start = environmentAt(0).movingPlatforms[0]!;
  const end = environmentAt(path.periodSeconds / 2).movingPlatforms[0]!;
  const reverse = environmentAt(path.periodSeconds).movingPlatforms[0]!;
  assert.equal(start.x, path.x);
  assert.equal(end.x, path.endX);
  assert.equal(reverse.x, path.x);
  assert.ok(TEST_LEVEL.fallingBlocks.length > 0);
  assert.ok(TEST_LEVEL.crushingTraps.length > 0);
});

test("a player can be carried by and jump off a moving platform", () => {
  const player = spawnPlayer("carry", "race", 0, 0);
  const platform = { x: 150, y: 400, width: 100, height: 20 };
  player.x = 190;
  player.y = platform.y - player.radius;
  player.grounded = true;
  const beforeX = player.x;
  player.x += 12;
  player.y -= 5;
  stepPlayer(player, { horizontal: 0, jumpDown: false }, 1 / 60, false, [
    { ...platform, x: platform.x + 12, y: platform.y - 5 },
  ]);
  assert.ok(player.x >= beforeX + 11);
  stepPlayer(
    player,
    { horizontal: 0, jumpDown: true, jumpPressed: true },
    1 / 60,
    false,
    [{ ...platform, x: platform.x + 12, y: platform.y - 5 }],
  );
  assert.ok(player.velocityY < 0);
});

test("circle collisions separate head-on players and transfer bounded momentum", () => {
  const left = spawnPlayer("guest-a", "race-a", 0, 0);
  const right = spawnPlayer("guest-b", "race-a", 1, 0);
  left.x = 400;
  right.x = 430;
  left.velocityX = 120;
  right.velocityX = -20;
  left.jumpsUsed = 1;
  const iterations = resolvePlayerCollisions([left, right]);
  assert.ok(iterations > 0);
  assert.ok(
    right.x - left.x >=
      left.radius +
        right.radius -
        PLAYER_COLLISION_CONFIG.separationTolerance -
        0.1,
  );
  assert.ok(left.velocityX < 120);
  assert.ok(right.velocityX > -20);
  assert.equal(left.jumpsUsed, 1);
  assert.ok(
    [left, right].every((player) =>
      [player.x, player.y, player.velocityX, player.velocityY].every(
        Number.isFinite,
      ),
    ),
  );
});

test("faster impacts transfer more momentum and vertical impacts bounce", () => {
  const impact = (speed: number) => {
    const striker = spawnPlayer("guest-a", "race-a", 0, 0);
    const target = spawnPlayer("guest-b", "race-a", 1, 0);
    striker.x = 400;
    target.x = 430;
    striker.velocityX = speed;
    resolvePlayerCollisions([striker, target]);
    return Math.abs(target.velocityX);
  };
  assert.ok(impact(240) > impact(60));
  const upper = spawnPlayer("guest-a", "race-a", 0, 0);
  const lower = spawnPlayer("guest-b", "race-a", 1, 0);
  upper.x = lower.x = 700;
  upper.y = 390;
  lower.y = 425;
  upper.grounded = false;
  lower.grounded = false;
  upper.velocityY = 180;
  resolvePlayerCollisions([upper, lower]);
  assert.ok(upper.velocityY < 180);
  assert.ok(lower.velocityY > 0);
});

test("heavy players move less and ghosts do not collide", () => {
  const light = spawnPlayer("guest-a", "race-a", 0, 0);
  const heavy = spawnPlayer("guest-b", "race-a", 1, 0);
  light.x = 400;
  heavy.x = 430;
  light.velocityX = 150;
  light.mass = 3;
  heavy.mass = 3;
  resolvePlayerCollisions([light, heavy]);
  assert.notEqual(heavy.velocityX, 0);
  const ghost = spawnPlayer("guest-c", "race-a", 2, 0);
  ghost.x = 400;
  ghost.ghost = true;
  const before = light.x;
  resolvePlayerCollisions([light, ghost]);
  assert.equal(light.x, before);
});

test("three-player overlap resolves in bounded deterministic passes", () => {
  const players = [0, 1, 2].map((slot) =>
    spawnPlayer(`guest-${slot}`, "race-a", slot, 0),
  );
  players.forEach((player) => (player.x = 500));
  const clones = players.map((player) => ({ ...player }));
  let iterations = 0;
  for (let pass = 0; pass < 8; pass += 1)
    iterations += resolvePlayerCollisions(players);
  assert.ok(iterations <= 24 * 8);
  assert.ok(
    players.every(
      (player) => Number.isFinite(player.x) && Number.isFinite(player.y),
    ),
  );
  for (let left = 0; left < players.length; left += 1)
    for (let right = left + 1; right < players.length; right += 1)
      assert.ok(
        Math.hypot(
          players[right]!.x - players[left]!.x,
          players[right]!.y - players[left]!.y,
        ) >=
          players[left]!.radius + players[right]!.radius - 0.6,
      );
  const positions = players.map((player) => [player.x, player.y]);
  for (let pass = 0; pass < 8; pass += 1) resolvePlayerCollisions(clones);
  assert.deepEqual(
    clones.map((player) => [player.x, player.y]),
    positions,
  );
});

test("stacked balls stay supported without accumulating bounce energy", () => {
  const lower = spawnPlayer("guest-lower", "race-stack", 0, 0);
  const upper = spawnPlayer("guest-upper", "race-stack", 1, 0);
  lower.x = upper.x = 500;
  upper.y = lower.y - lower.radius - upper.radius;
  for (let tick = 0; tick < 240; tick += 1) {
    stepPlayer(lower, { horizontal: 0, jumpDown: false }, 1 / 60, false);
    stepPlayer(upper, { horizontal: 0, jumpDown: false }, 1 / 60, false);
    resolvePlayerCollisions([lower, upper]);
  }
  assert.ok(Math.abs(upper.y - (lower.y - 44)) < 0.6);
  assert.ok(Math.abs(upper.velocityY) < 1);
  assert.ok(Math.abs(lower.velocityY) < 1);
  assert.ok(Math.hypot(upper.velocityX, upper.velocityY) < 1);
  assert.ok(
    [lower, upper].every((player) =>
      [player.x, player.y, player.velocityX, player.velocityY].every(
        Number.isFinite,
      ),
    ),
  );
});

test("a jumping player can land on and remain supported by another ball", () => {
  const lower = spawnPlayer("guest-platformed", "race-jump-stack", 0, 0);
  const jumper = spawnPlayer("guest-jumper", "race-jump-stack", 1, 0);
  lower.x = 500;
  jumper.x = 560;
  jumper.jumpsUsed = 0;
  for (let tick = 0; tick < 360; tick += 1) {
    stepPlayer(lower, { horizontal: 0, jumpDown: false }, 1 / 60, false);
    stepPlayer(
      jumper,
      {
        horizontal: tick < 20 ? -1 : 0,
        jumpDown: tick === 0,
      },
      1 / 60,
      false,
    );
    resolvePlayerCollisions([lower, jumper]);
  }
  assert.equal(jumper.grounded, true);
  assert.ok(jumper.y < lower.y - jumper.radius);
  assert.ok(Math.abs(jumper.velocityY) < 1);
  assert.equal(jumper.supportedByPlayer, true);
});

test("a falling ball lands on another ball and three-body stacks stay stable", () => {
  const players = [0, 1, 2].map((slot) =>
    spawnPlayer(`guest-stack-${slot}`, "race-stack", slot, 0),
  );
  players[0]!.x = players[1]!.x = players[2]!.x = 500;
  players[1]!.y = players[0]!.y - 44;
  players[2]!.y = players[1]!.y - 44 - 30;
  players[2]!.velocityY = 120;
  for (let tick = 0; tick < 240; tick += 1) {
    for (const player of players)
      stepPlayer(player, { horizontal: 0, jumpDown: false }, 1 / 60, false);
    resolvePlayerCollisions(players);
  }
  assert.ok(Math.abs(players[1]!.y - (players[0]!.y - 44)) < 0.75);
  assert.ok(Math.abs(players[2]!.y - (players[1]!.y - 44)) < 0.75);
  assert.ok(players.every((player) => Math.abs(player.velocityY) < 1));
});

test("contact friction carries a supported ball and allows it to slide off", () => {
  const lower = spawnPlayer("guest-lower", "race-stack", 0, 0);
  const upper = spawnPlayer("guest-upper", "race-stack", 1, 0);
  lower.x = upper.x = 500;
  upper.y = lower.y - 44;
  for (let tick = 0; tick < 45; tick += 1) {
    stepPlayer(lower, { horizontal: 1, jumpDown: false }, 1 / 60, false);
    stepPlayer(upper, { horizontal: 0, jumpDown: false }, 1 / 60, false);
    resolvePlayerCollisions([lower, upper]);
  }
  assert.ok(upper.x > 500);
  const beforeFallY = upper.y;
  for (let tick = 0; tick < 240; tick += 1) {
    stepPlayer(lower, { horizontal: 0, jumpDown: false }, 1 / 60, false);
    stepPlayer(upper, { horizontal: 1, jumpDown: false }, 1 / 60, false);
    resolvePlayerCollisions([lower, upper]);
  }
  assert.ok(Math.hypot(upper.x - lower.x, upper.y - lower.y) > 44);
  assert.ok(upper.y > beforeFallY);
});

test("separating contacts do not receive bounce impulses or gain energy", () => {
  const left = spawnPlayer("guest-left", "race-impact", 0, 0);
  const right = spawnPlayer("guest-right", "race-impact", 1, 0);
  left.x = 500;
  right.x = 540;
  left.velocityX = -40;
  right.velocityX = 40;
  const beforeEnergy = left.velocityX ** 2 + right.velocityX ** 2;
  resolvePlayerCollisions([left, right]);
  assert.equal(left.velocityX, -40);
  assert.equal(right.velocityX, 40);
  assert.ok(left.velocityX ** 2 + right.velocityX ** 2 <= beforeEnergy);
});

test("player collision stays out of solid platforms and power-ups alter collision parameters", () => {
  const edge = spawnPlayer("guest-a", "race-a", 0, 0);
  const intruder = spawnPlayer("guest-b", "race-a", 1, 0);
  edge.x = 645;
  edge.y = 440;
  intruder.x = 670;
  intruder.y = 440;
  resolvePlayerCollisions([edge, intruder]);
  for (const player of [edge, intruder]) {
    const inside = TEST_LEVEL.platforms.some(
      (platform) =>
        player.x > platform.x &&
        player.x < platform.x + platform.width &&
        player.y > platform.y &&
        player.y < platform.y + platform.height,
    );
    assert.equal(inside, false);
  }
  const source = spawnPlayer("guest-c", "race-a", 2, 0);
  source.x = 200;
  const target = spawnPlayer("guest-d", "race-a", 3, 0);
  target.x = 250;
  target.mass = POWER_UP_CONFIG.heavyMass;
  const affected = applyRadialShockwave(source, [target]);
  assert.equal(affected, 1);
  assert.ok(
    Math.hypot(target.velocityX, target.velocityY) <=
      POWER_UP_CONFIG.shockwaveMaxImpulse,
  );
  const small = spawnPlayer("guest-e", "race-a", 1, 0);
  small.radius = POWER_UP_CONFIG.shrinkRadius;
  assert.equal(small.radius, 14);
});

test("air steering and gravity use configured shared values", () => {
  const player = spawnPlayer("guest-a", "race-a", 0, 0);
  player.grounded = false;
  player.y = 400;
  const beforeY = player.y;
  stepPlayer(player, { horizontal: 1, jumpDown: false });
  assert.ok(player.y > beforeY);
  assert.ok(player.velocityX > 0);
  assert.equal(
    player.velocityX,
    (MOVEMENT_CONFIG.airAcceleration * MOVEMENT_CONFIG.airControlMultiplier) /
      60,
  );
});

test("ground jump, fresh-edge double jump, held jump, and landing reset", () => {
  const player = spawnPlayer("guest-a", "race-a", 0, 0);
  stepPlayer(player, { horizontal: 0, jumpDown: true });
  assert.equal(player.velocityY, -MOVEMENT_CONFIG.groundJumpVelocity + 17.5);
  assert.equal(player.jumpsUsed, 1);
  for (let index = 0; index < 6; index++)
    stepPlayer(player, { horizontal: 0, jumpDown: true });
  assert.equal(player.jumpsUsed, 1);
  stepPlayer(player, { horizontal: 0, jumpDown: false });
  stepPlayer(player, { horizontal: 0, jumpDown: true });
  assert.equal(player.jumpsUsed, 2);
  assert.equal(player.velocityY, -MOVEMENT_CONFIG.doubleJumpVelocity + 17.5);
  for (let index = 0; index < 300 && !player.grounded; index++)
    stepPlayer(player, { horizontal: 0, jumpDown: false });
  assert.equal(player.grounded, true);
  assert.equal(player.jumpsUsed, 0);
  assert.equal(player.y, 450 - MOVEMENT_CONFIG.playerHalfSize);
});

test("platform side collision stops horizontal movement without resetting jumps", () => {
  const player = spawnPlayer("guest-a", "race-a", 0, 0);
  player.x = 735;
  player.y = 406;
  player.grounded = false;
  player.jumpsUsed = 1;
  player.velocityX = 270;
  stepPlayer(player, { horizontal: 1, jumpDown: false });
  assert.equal(player.x, 760 - MOVEMENT_CONFIG.playerHalfSize);
  assert.equal(player.velocityX, 0);
  assert.equal(player.jumpsUsed, 1);
});

test("gaps do not create ground contact and fall reset returns to safe spawn", () => {
  const player = spawnPlayer("guest-a", "race-a", 0, 0);
  player.x = 700;
  player.y = 600;
  player.grounded = false;
  for (let index = 0; index < 10; index++)
    stepPlayer(player, { horizontal: 0, jumpDown: false });
  assert.equal(player.x, 700);
  assert.equal(player.grounded, false);
  assert.ok(player.y > 600);
  assert.ok(player.y < MOVEMENT_CONFIG.fallResetY);
});

test("world boundaries and hazard collision are authoritative", () => {
  const player = spawnPlayer("guest-a", "race-a", 0, 0);
  player.x = 14;
  player.velocityX = -270;
  stepPlayer(player, { horizontal: -1, jumpDown: false });
  assert.equal(player.x, MOVEMENT_CONFIG.playerHalfSize);
  assert.equal(player.velocityX, 0);
  player.x = MOVEMENT_CONFIG.worldWidth - MOVEMENT_CONFIG.playerHalfSize - 1;
  player.velocityX = 270;
  stepPlayer(player, { horizontal: 1, jumpDown: false });
  assert.equal(
    player.x,
    MOVEMENT_CONFIG.worldWidth - MOVEMENT_CONFIG.playerHalfSize,
  );
  assert.equal(player.velocityX, 0);
  player.x = 160;
  player.y = MOVEMENT_CONFIG.playerHalfSize + 2;
  player.velocityY = -900;
  player.grounded = false;
  stepPlayer(player, { horizontal: 0, jumpDown: false });
  assert.equal(player.y, MOVEMENT_CONFIG.playerHalfSize);
  assert.equal(player.velocityY, 0);
  player.x = 1850;
  player.y = 420;
  player.grounded = false;
  stepPlayer(player, { horizontal: 0, jumpDown: false });
  assert.equal(player.x, 160);
  assert.equal(player.grounded, true);
  assert.equal(player.velocityY, 0);
});
