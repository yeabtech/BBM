import Phaser from "phaser";
import type { TestLevelDefinition } from "../level/level-config.js";
import { LEVEL_VISUAL_CONFIG } from "../level/level-visual-config.js";

export interface BuiltLevel {
  readonly platforms: Phaser.GameObjects.Rectangle[];
  readonly hazards: Phaser.GameObjects.Rectangle[];
}

const TERRAIN_TEXTURES = {
  "650x100": {
    key: "terrain-650x100",
    file: "ground-650x100.png",
    topOffset: 38,
  },
  "260x32": {
    key: "terrain-260x32",
    file: "platform-260x32.png",
    topOffset: 37,
  },
  "260x100": {
    key: "terrain-260x100",
    file: "ground-260x100.png",
    topOffset: 25,
  },
  "250x32": {
    key: "terrain-250x32",
    file: "platform-250x32.png",
    topOffset: 37,
  },
  "680x100": {
    key: "terrain-680x100",
    file: "ground-680x100.png",
    topOffset: 25,
  },
  "110x24": {
    key: "terrain-110x24",
    file: "platform-110x24.png",
    topOffset: 37,
  },
  "150x24": {
    key: "terrain-150x24",
    file: "platform-150x24.png",
    topOffset: 37,
  },
  "100x20": { key: "terrain-100x20", file: "moving-100x20.png", topOffset: 37 },
  "84x20": { key: "terrain-84x20", file: "moving-84x20.png", topOffset: 37 },
} as const;

export function preloadTerrain(scene: Phaser.Scene): void {
  for (const texture of Object.values(TERRAIN_TEXTURES))
    scene.load.image(texture.key, `/assets/terrain/${texture.file}`);
}

/** Draws a source-art crop at native pixel size; collision geometry stays separate. */
export function drawPixelTerrain(
  scene: Phaser.Scene,
  platform: TestLevelDefinition["platforms"][number],
): Phaser.GameObjects.Image {
  const key =
    `${platform.width}x${platform.height}` as keyof typeof TERRAIN_TEXTURES;
  const texture = TERRAIN_TEXTURES[key];
  if (!texture)
    throw new Error(
      `No source-art terrain texture for ${platform.width}x${platform.height}.`,
    );
  return scene.add
    .image(platform.x, platform.y - texture.topOffset, texture.key)
    .setOrigin(0)
    .setDepth(-1);
}

export function terrainTopOffset(
  platform: TestLevelDefinition["platforms"][number],
): number {
  const texture =
    TERRAIN_TEXTURES[
      `${platform.width}x${platform.height}` as keyof typeof TERRAIN_TEXTURES
    ];
  if (!texture)
    throw new Error(
      `No source-art terrain texture for ${platform.width}x${platform.height}.`,
    );
  return texture.topOffset;
}

export function buildLevel(
  scene: Phaser.Scene,
  level: TestLevelDefinition,
): BuiltLevel {
  const platforms: Phaser.GameObjects.Rectangle[] = [];
  const hazards: Phaser.GameObjects.Rectangle[] = [];
  for (const platform of level.platforms) {
    const block = scene.add.rectangle(
      platform.x + platform.width / 2,
      platform.y + platform.height / 2,
      platform.width,
      platform.height,
      0xffffff,
    );
    block.setAlpha(0);
    scene.physics.add.existing(block, true);
    const body = block.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(platform.width, platform.height);
    platforms.push(block);
    drawPixelTerrain(scene, platform);
  }
  for (const hazard of level.hazards) {
    const marker = scene.add.rectangle(
      hazard.x + hazard.width / 2,
      hazard.y + hazard.height / 2,
      hazard.width,
      hazard.height,
      0xef6666,
    );
    scene.physics.add.existing(marker, true);
    const body = marker.body as Phaser.Physics.Arcade.StaticBody;
    body.setSize(hazard.width, hazard.height);
    hazards.push(marker);
    scene.add.text(hazard.x, hazard.y - 24, "DANGER", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#ff8585",
    });
  }
  scene.add.rectangle(level.finishX, 382, 10, 136, 0xffd166);
  scene.add.text(level.finishX + 12, 318, "FINISH", {
    fontFamily: "monospace",
    fontSize: "12px",
    color: "#ffd166",
  });
  return { platforms, hazards };
}
