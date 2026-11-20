import assert from "node:assert/strict";
import test from "node:test";
import type { ActivePowerUp } from "@bbm/shared-contracts";
import {
  ballSkinTextureKey,
  playerBallTextureKey,
  powerBallTextureKey,
} from "../src/game/rendering/ball-skins.js";

test("players use their selected regular ball until an active power skin applies", () => {
  assert.equal(playerBallTextureKey("beach", []), ballSkinTextureKey("beach"));
  const speed: ActivePowerUp = {
    type: "speed",
    expiresAt: new Date(10_000).toISOString(),
  };
  assert.equal(playerBallTextureKey("soccer", [speed]), "power-ball-electric");
});

test("power skins map to their selected game effects", () => {
  const effect = (type: ActivePowerUp["type"]): ActivePowerUp => ({
    type,
    expiresAt: new Date(10_000).toISOString(),
  });
  assert.equal(powerBallTextureKey("jump"), "power-ball-cloud");
  assert.equal(powerBallTextureKey("heavy"), "power-ball-steel");
  assert.equal(powerBallTextureKey("shockwave"), "power-ball-spiked");
  assert.equal(powerBallTextureKey("shrink"), "power-ball-slime");
  assert.equal(powerBallTextureKey("ghost"), "power-ball-ice-crystal");
  assert.equal(
    playerBallTextureKey("volleyball", [effect("heavy"), effect("speed")]),
    "power-ball-steel",
  );
  assert.equal(playerBallTextureKey("volleyball", []), "ball-volleyball");
});
