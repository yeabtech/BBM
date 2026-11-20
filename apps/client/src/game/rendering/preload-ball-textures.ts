import Phaser from "phaser";
import {
  BALL_SKIN_OPTIONS,
  ballSkinTextureKey,
  powerBallAssetPaths,
  regularBallAssetPath,
} from "./ball-skins.js";

export function preloadBallTextures(scene: Phaser.Scene): void {
  for (const skin of BALL_SKIN_OPTIONS)
    scene.load.image(
      ballSkinTextureKey(skin.value),
      regularBallAssetPath(skin.file),
    );
  for (const asset of powerBallAssetPaths())
    scene.load.image(asset.key, asset.path);
}
