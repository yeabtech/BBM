import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_AUTOMATIC_RECONNECT_ATTEMPTS,
  reconnectDelayMs,
} from "../src/networking/reconnect-policy.js";

test("reconnect delays back off exponentially and stop growing at the cap", () => {
  assert.equal(reconnectDelayMs(0), 500);
  assert.equal(reconnectDelayMs(1), 1_000);
  assert.equal(reconnectDelayMs(4), 8_000);
  assert.equal(reconnectDelayMs(5), 10_000);
  assert.equal(reconnectDelayMs(20), 10_000);
});

test("automatic reconnect attempts are bounded and allow manual recovery", () => {
  assert.equal(MAX_AUTOMATIC_RECONNECT_ATTEMPTS, 8);
  assert.equal(reconnectDelayMs(-1), 500);
});
