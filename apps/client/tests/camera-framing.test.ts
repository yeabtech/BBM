import test from "node:test";
import assert from "node:assert/strict";
import {
  cameraScreenPosition,
  cameraScrollForScreenPosition,
} from "../src/game/rendering/camera-coordinates.js";

test("camera scroll positions place targets at their requested screen coordinates", () => {
  const cases = [
    { world: 110, screen: 422, viewport: 844, zoom: 0.7 },
    { world: 414, screen: 257.4, viewport: 390, zoom: 0.7 },
    { world: 450, screen: 288.6, viewport: 390, zoom: 0.7 },
  ];

  for (const { world, screen, viewport, zoom } of cases) {
    const scroll = cameraScrollForScreenPosition(world, screen, viewport, zoom);
    assert.ok(
      Math.abs(cameraScreenPosition(world, scroll, viewport, zoom) - screen) <
        0.001,
    );
  }
});
