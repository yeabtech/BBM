import test from "node:test";
import assert from "node:assert/strict";
import { Guest } from "../../src/domain/entities/guest.js";
import { Room } from "../../src/domain/entities/room.js";
import { DomainError } from "../../src/domain/errors/domain-error.js";
import {
  parseGuestBallSkin,
  normalizeDisplayName,
  parseGuestColor,
} from "../../src/domain/value-objects/guest-profile.js";

const now = new Date("2026-01-01T00:00:00.000Z");
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const guest = (n: number, name = `Player ${n}`) =>
  Guest.create(id(n), name, "soccer", now);
const room = () =>
  Room.create(
    id(99),
    "ABC234",
    guest(1, "Host"),
    id(501),
    now,
    new Date(now.getTime() + 60_000),
  );

test("guest names normalize to NFC, trim edges, and collapse whitespace", () => {
  assert.equal(normalizeDisplayName("  Cafe\u0301   Racer  "), "Café Racer");
  assert.throws(
    () => normalizeDisplayName(" A "),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_NAME",
  );
  assert.throws(() => normalizeDisplayName("Valid\u0000Name"), DomainError);
  assert.throws(
    () => normalizeDisplayName("A name that is much too long"),
    DomainError,
  );
});

test("guest colors use an allowlist", () => {
  assert.equal(parseGuestColor("coral"), "coral");
  assert.throws(
    () => parseGuestColor("#ff0000"),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_COLOR",
  );
});

test("guest ball skins use an allowlist and synchronize through room membership", () => {
  assert.equal(parseGuestBallSkin("basketball"), "basketball");
  assert.throws(
    () => parseGuestBallSkin("lava"),
    (error: unknown) =>
      error instanceof DomainError && error.code === "INVALID_BALL_SKIN",
  );
  const target = room();
  assert.equal(target.activeMembers[0]?.ballSkin, "soccer");
  target.join(guest(2), id(502), now, new Date(now.getTime() + 60_000));
  assert.equal(target.activeMembers[1]?.ballSkin, "soccer");
});

test("room capacity is three and duplicate membership does not use another slot", () => {
  const target = room();
  target.join(guest(2), id(502), now, new Date(now.getTime() + 60_000));
  assert.throws(
    () => target.join(guest(2), id(503), now, new Date(now.getTime() + 60_000)),
    (error: unknown) =>
      error instanceof DomainError && error.code === "ALREADY_IN_ROOM",
  );
  target.join(guest(3), id(504), now, new Date(now.getTime() + 60_000));
  assert.throws(
    () => target.join(guest(4), id(505), now, new Date(now.getTime() + 60_000)),
    (error: unknown) =>
      error instanceof DomainError && error.code === "ROOM_FULL",
  );
  assert.equal(target.activeMembers.length, 3);
});

test("a lobby refuses new memberships while a race is counting down or active", () => {
  const target = room();
  assert.throws(
    () =>
      target.join(
        guest(2),
        id(502),
        now,
        new Date(now.getTime() + 60_000),
        true,
      ),
    (error: unknown) =>
      error instanceof DomainError && error.code === "ROOM_RACE_ACTIVE",
  );
  assert.equal(target.activeMembers.length, 1);
});

test("race start requires the connected host and every connected player ready", () => {
  const target = room();
  assert.throws(
    () => target.assertCanStartRace(id(1), id(501), now),
    (error: unknown) =>
      error instanceof DomainError && error.code === "NOT_READY",
  );
  target.join(guest(2), id(502), now, new Date(now.getTime() + 60_000));
  target.setReady(id(1), id(501), true, now, new Date(now.getTime() + 60_000));
  assert.throws(
    () => target.assertCanStartRace(id(1), id(501), now),
    (error: unknown) =>
      error instanceof DomainError && error.code === "NOT_READY",
  );
  target.setReady(id(2), id(502), true, now, new Date(now.getTime() + 60_000));
  assert.throws(
    () => target.assertCanStartRace(id(2), id(502), now),
    (error: unknown) =>
      error instanceof DomainError && error.code === "NOT_HOST",
  );
  assert.doesNotThrow(() => target.assertCanStartRace(id(1), id(501), now));
});

test("readiness requires two connected members and every connected member ready", () => {
  const target = room();
  target.join(guest(2), id(502), now, new Date(now.getTime() + 60_000));
  assert.equal(target.isReadyToStart(now), false);
  assert.throws(
    () => target.assertCanPrepare(id(502), id(502), now),
    (error: unknown) =>
      error instanceof DomainError && error.code === "NOT_HOST",
  );
  target.setReady(id(1), id(501), true, now, new Date(now.getTime() + 60_000));
  assert.equal(target.isReadyToStart(now), false);
  target.setReady(id(2), id(502), true, now, new Date(now.getTime() + 60_000));
  assert.equal(target.assertCanPrepare(id(1), id(501), now), true);
});

test("disconnected players are not ready and do not count toward the minimum", () => {
  const target = room();
  target.join(guest(2), id(502), now, new Date(now.getTime() + 60_000));
  target.join(guest(3), id(503), now, new Date(now.getTime() + 60_000));
  target.setReady(id(2), id(502), true, now, new Date(now.getTime() + 60_000));
  target.setReady(id(3), id(503), true, now, new Date(now.getTime() + 60_000));
  assert.equal(
    target.disconnect(
      id(1),
      id(501),
      now,
      30_000,
      new Date(now.getTime() + 60_000),
    ),
    true,
  );
  assert.equal(
    target.members.find((member) => member.guestId === id(1))?.ready,
    false,
  );
  assert.equal(target.isReadyToStart(now), true);
});

test("host departure closes a room and room expiry is deterministic", () => {
  const target = room();
  target.join(guest(2), id(502), now, new Date(now.getTime() + 60_000));
  assert.equal(target.leave(id(1), id(501), now), "host_left");
  assert.equal(target.status, "closed");
  assert.equal(target.activeMembers.length, 0);
  const expiring = room();
  assert.equal(
    expiring.expireIfNeeded(new Date(now.getTime() + 60_000)),
    "expired",
  );
  assert.equal(expiring.status, "expired");
});

test("a stale socket cannot mark a reconnected host offline", () => {
  const target = room();
  assert.equal(
    target.disconnect(
      id(1),
      id(501),
      now,
      30_000,
      new Date(now.getTime() + 60_000),
    ),
    true,
  );
  target.reconnect(
    guest(1, "Host"),
    id(502),
    new Date(now.getTime() + 1_000),
    new Date(now.getTime() + 60_000),
  );
  assert.equal(
    target.disconnect(
      id(1),
      id(501),
      new Date(now.getTime() + 2_000),
      30_000,
      new Date(now.getTime() + 60_000),
    ),
    false,
  );
  assert.equal(target.members[0]?.connected, true);
  assert.equal(target.members[0]?.connectionId, id(502));
});
