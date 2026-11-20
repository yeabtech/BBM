import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("platformer bootstrap does not add networking or multiplayer gameplay", async () => {
  const bootstrap = await readFile(
    new URL("../src/game/create-game.ts", import.meta.url),
    "utf8",
  );
  const scene = await readFile(
    new URL("../src/game/scenes/platformer-scene.ts", import.meta.url),
    "utf8",
  );
  assert.match(bootstrap, /PlatformerScene/);
  assert.doesNotMatch(scene, /WebSocket|matchmaking|roomCode|leaderboard/i);
});
