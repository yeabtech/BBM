import test from "node:test";
import assert from "node:assert/strict";
import {
  MOVEMENT_CONFIG,
  validateMovementConfig,
} from "../src/game/state/movement-config.js";
import { createPlayerMovementState } from "../src/game/state/player-state.js";
import {
  processJump,
  stepHorizontalMovement,
} from "../src/game/physics/movement.js";
import { TouchInputState } from "../src/game/input/input-state.js";
import { TEST_LEVEL, validateLevel } from "../src/game/level/level-config.js";

test("horizontal speed is capped at configured maximum", () => {
  const state = createPlayerMovementState();
  for (let i = 0; i < 120; i++)
    stepHorizontalMovement(
      state,
      { axis: 1, grounded: true, deltaSeconds: 1 / 60 },
      MOVEMENT_CONFIG,
    );
  assert.equal(state.horizontalVelocity, MOVEMENT_CONFIG.maxHorizontalSpeed);
});

test("acceleration and release deceleration are smooth and predictable", () => {
  const state = createPlayerMovementState();
  const first = stepHorizontalMovement(
    state,
    { axis: 1, grounded: true, deltaSeconds: 1 / 60 },
    MOVEMENT_CONFIG,
  );
  const second = stepHorizontalMovement(
    state,
    { axis: 1, grounded: true, deltaSeconds: 1 / 60 },
    MOVEMENT_CONFIG,
  );
  assert.ok(
    first > 0 && second > first && second < MOVEMENT_CONFIG.maxHorizontalSpeed,
  );
  const released = stepHorizontalMovement(
    state,
    { axis: 0, grounded: true, deltaSeconds: 1 / 60 },
    MOVEMENT_CONFIG,
  );
  assert.ok(released < second && released > 0);
});

test("acceleration is consistent across 30 and 60 update rates", () => {
  const at30 = createPlayerMovementState();
  const at60 = createPlayerMovementState();
  for (let i = 0; i < 15; i++) {
    stepHorizontalMovement(
      at30,
      { axis: 1, grounded: true, deltaSeconds: 1 / 30 },
      MOVEMENT_CONFIG,
    );
  }
  for (let i = 0; i < 30; i++) {
    stepHorizontalMovement(
      at60,
      { axis: 1, grounded: true, deltaSeconds: 1 / 60 },
      MOVEMENT_CONFIG,
    );
  }
  assert.ok(Math.abs(at30.horizontalVelocity - at60.horizontalVelocity) < 1);
});

test("opposite direction reverses movement without exceeding the cap", () => {
  const state = createPlayerMovementState();
  state.horizontalVelocity = 160;
  const afterReverse = stepHorizontalMovement(
    state,
    { axis: -1, grounded: true, deltaSeconds: 1 / 20 },
    MOVEMENT_CONFIG,
  );
  assert.ok(afterReverse < 160);
  for (let i = 0; i < 10; i++)
    stepHorizontalMovement(
      state,
      { axis: -1, grounded: true, deltaSeconds: 1 / 20 },
      MOVEMENT_CONFIG,
    );
  assert.ok(state.horizontalVelocity < 0);
  assert.ok(
    Math.abs(state.horizontalVelocity) <= MOVEMENT_CONFIG.maxHorizontalSpeed,
  );
});

test("ground jump, double jump, third jump rejection, and landing reset", () => {
  const state = createPlayerMovementState();
  assert.equal(processJump(state, true, false, MOVEMENT_CONFIG).jumped, false);
  assert.equal(
    processJump(state, true, true, MOVEMENT_CONFIG).velocityY,
    -MOVEMENT_CONFIG.groundJumpVelocity,
  );
  assert.equal(
    processJump(state, true, false, MOVEMENT_CONFIG).velocityY,
    -MOVEMENT_CONFIG.doubleJumpVelocity,
  );
  assert.equal(processJump(state, true, false, MOVEMENT_CONFIG).jumped, false);
  assert.equal(processJump(state, false, true, MOVEMENT_CONFIG).jumpsUsed, 0);
  assert.equal(processJump(state, true, true, MOVEMENT_CONFIG).jumpsUsed, 1);
});

test("a held jump does not create repeated jumps without another press edge", () => {
  const state = createPlayerMovementState();
  assert.equal(processJump(state, true, true, MOVEMENT_CONFIG).jumpsUsed, 1);
  assert.equal(processJump(state, false, false, MOVEMENT_CONFIG).jumpsUsed, 1);
  assert.equal(processJump(state, false, false, MOVEMENT_CONFIG).jumped, false);
});

test("movement configuration validation rejects invalid values", () => {
  assert.deepEqual(validateMovementConfig(MOVEMENT_CONFIG), []);
  assert.ok(
    validateMovementConfig({
      ...MOVEMENT_CONFIG,
      maxHorizontalSpeed: 0,
      maxJumpCount: 1.5,
    }).length >= 2,
  );
});

test("touch input supports multi-touch, edge-triggered jump, and reliable release", () => {
  const input = new TouchInputState();
  input.press("left", 1);
  input.press("right", 2);
  input.press("jump", 3);
  assert.deepEqual(input.read(), { horizontal: 0, jumpPressed: true });
  assert.deepEqual(input.read(), { horizontal: 0, jumpPressed: false });
  input.release(2);
  assert.equal(input.read().horizontal, -1);
  input.release(1);
  assert.equal(input.read().horizontal, 0);
  input.press("jump", 4);
  input.clear();
  assert.equal(input.read().jumpPressed, false);
});

test("test level has valid bounds, multiple landing platforms, gaps, and a hazard", () => {
  assert.deepEqual(validateLevel(TEST_LEVEL), []);
  assert.ok(TEST_LEVEL.platforms.length >= 5);
  assert.ok(TEST_LEVEL.hazards.length >= 1);
  assert.ok(
    TEST_LEVEL.platforms.some(
      (platform) => platform.y !== TEST_LEVEL.platforms[0]?.y,
    ),
  );
  assert.ok(TEST_LEVEL.platforms.some((platform) => platform.x > 650));
});

test("level validation rejects platforms outside world bounds", () => {
  const invalid = {
    ...TEST_LEVEL,
    platforms: [{ x: 2300, y: 10, width: 200, height: 30 }],
  };
  assert.ok(
    validateLevel(invalid).some((error) =>
      error.includes("exceeds level bounds"),
    ),
  );
});

test("level validation rejects an out-of-world starting position", () => {
  assert.ok(
    validateLevel({ ...TEST_LEVEL, start: { x: 2500, y: 20 } }).includes(
      "start must be inside the level",
    ),
  );
});
