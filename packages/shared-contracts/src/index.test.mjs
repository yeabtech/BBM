import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("shared contracts package exposes a module entry", async () => {
  const source = await readFile(new URL("./index.ts", import.meta.url), "utf8");
  assert.match(source, /export interface HealthResponse/);
  assert.match(source, /status: "ok" \| "unavailable"/);
  assert.match(source, /type: "start_race"/);
  assert.match(source, /race_countdown_started/);
});
