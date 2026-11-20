import assert from "node:assert/strict";
import test from "node:test";
import type {
  GameplayPlayerSnapshot,
  RaceResultEntry,
} from "@bbm/shared-contracts";
import {
  countdownLabel,
  playerMotionState,
  resultLabel,
} from "../src/game/presentation/race-presentation.js";

const result = (overrides: Partial<RaceResultEntry> = {}): RaceResultEntry => ({
  guestId: "guest",
  displayName: "Racer",
  color: "mint",
  ballSkin: "soccer",
  place: null,
  finishTimeMs: null,
  status: "unfinished",
  ...overrides,
});

test("countdown presentation follows the authoritative deadline and reaches GO once", () => {
  const deadline = new Date(10_000).toISOString();
  assert.equal(countdownLabel(deadline, 0, 7_100), "3");
  assert.equal(countdownLabel(deadline, 250, 10_000), "GO!");
});

test("two-player results leave an unfinished racer without a place or invented time", () => {
  assert.equal(resultLabel(result()), "UNFINISHED  Racer  NO FINISH");
  assert.equal(
    resultLabel(result({ place: 1, finishTimeMs: 12_340, status: "finished" })),
    "#1  Racer  12.34s",
  );
});

test("three-player placements and timeout disconnected status stay explicit", () => {
  assert.equal(
    resultLabel(result({ place: 3, finishTimeMs: 23_456, status: "finished" })),
    "#3  Racer  23.46s",
  );
  assert.equal(
    resultLabel(result({ status: "disconnected" })),
    "UNFINISHED  Racer  DISCONNECTED",
  );
});

test("player motion presentation distinguishes ground, double jump, fall, respawn, and finish", () => {
  const base = {
    respawning: false,
    finished: false,
    grounded: true,
    jumpsUsed: 0,
    velocityX: 0,
    velocityY: 0,
  } satisfies Pick<
    GameplayPlayerSnapshot,
    | "respawning"
    | "finished"
    | "grounded"
    | "jumpsUsed"
    | "velocityX"
    | "velocityY"
  >;
  assert.equal(playerMotionState(base), "idle");
  assert.equal(playerMotionState({ ...base, velocityX: 80 }), "run");
  assert.equal(
    playerMotionState({
      ...base,
      grounded: false,
      jumpsUsed: 2,
      velocityY: -200,
    }),
    "double-jump",
  );
  assert.equal(
    playerMotionState({ ...base, grounded: false, velocityY: 200 }),
    "fall",
  );
  assert.equal(playerMotionState({ ...base, respawning: true }), "respawn");
  assert.equal(playerMotionState({ ...base, finished: true }), "finish");
});
