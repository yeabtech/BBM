import Phaser from "phaser";
import {
  MultiplayerScene,
  type MultiplayerSceneContext,
} from "./scenes/multiplayer-scene.js";

export function createMultiplayerGame(
  parent: HTMLElement,
  context: MultiplayerSceneContext,
): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#10141d",
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: "100%",
      height: "100%",
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [new MultiplayerScene(context)],
    render: { antialias: false, pixelArt: true, roundPixels: true },
  });
}
