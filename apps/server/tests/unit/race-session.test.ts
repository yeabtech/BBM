import test from "node:test";
import assert from "node:assert/strict";
import { RaceSession } from "../../src/domain/entities/race-session.js";

const base = new Date("2026-01-01T00:00:00.000Z");
const session = () =>
  RaceSession.waiting(crypto.randomUUID(), crypto.randomUUID(), base);

test("race lifecycle enforces waiting, countdown, progress and one terminal state", () => {
  const race = session();
  assert.equal(race.state, "Waiting");
  race.beginCountdown(base, 3_000);
  assert.equal(race.state, "Countdown");
  assert.equal(race.countdownDeadlineAt?.getTime(), base.getTime() + 3_000);
  assert.throws(() => race.beginCountdown(base, 3_000));
  assert.equal(
    race.enterProgress(new Date(base.getTime() + 2_999), 120_000),
    false,
  );
  const official = new Date(base.getTime() + 3_000);
  const delayedCallback = new Date(base.getTime() + 3_900);
  assert.equal(race.enterProgress(delayedCallback, 120_000), true);
  assert.equal(race.state, "InProgress");
  assert.equal(race.officialStartAt?.getTime(), official.getTime());
  assert.equal(race.timeoutDeadlineAt?.getTime(), official.getTime() + 120_000);
  assert.equal(
    race.enterProgress(new Date(official.getTime() + 1), 120_000),
    false,
  );
});

test("timeout is measured from official start and cancellation happens once", () => {
  const race = session();
  race.beginCountdown(base, 3_000);
  const official = new Date(base.getTime() + 3_000);
  assert.equal(race.cancel("Timeout", official), false);
  race.enterProgress(official, 120_000);
  assert.equal(
    race.cancelIfTimedOut(new Date(official.getTime() + 119_999)),
    false,
  );
  assert.equal(
    race.cancelIfTimedOut(new Date(official.getTime() + 120_000)),
    true,
  );
  assert.equal(race.state, "Cancelled");
  assert.equal(race.cancellationReason, "Timeout");
  assert.equal(
    race.cancelIfTimedOut(new Date(official.getTime() + 130_000)),
    false,
  );
  assert.equal(race.cancel("ServerRestart", base), false);
  assert.equal(race.finish(base), false);
  assert.throws(() => race.beginCountdown(base, 3_000));
});

test("a countdown can be cancelled before start and cannot later advance", () => {
  const race = session();
  race.beginCountdown(base, 3_000);
  assert.equal(race.cancel("HostLeft", new Date(base.getTime() + 1_000)), true);
  assert.equal(race.state, "Cancelled");
  assert.equal(race.cancellationReason, "HostLeft");
  assert.equal(
    race.enterProgress(new Date(base.getTime() + 3_000), 120_000),
    false,
  );
  assert.equal(race.cancel("ServerRestart", base), false);
});

test("finished is terminal and records one finish time", () => {
  const race = session();
  race.beginCountdown(base, 3_000);
  const official = new Date(base.getTime() + 3_000);
  race.enterProgress(official, 120_000);
  assert.equal(race.finish(new Date(official.getTime() + 10_000)), true);
  assert.equal(race.state, "Finished");
  assert.equal(race.cancel("Timeout", base), false);
});
