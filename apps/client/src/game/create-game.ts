import Phaser from "phaser";
import { PlatformerScene } from "./scenes/platformer-scene.js";

export function createGame(parent: HTMLElement) {
  return new Phaser.Game({
    type: Phaser.AUTO,
    physics: {
      default: "arcade",
      arcade: { debug: false, gravity: { x: 0, y: 0 } },
    },
    parent,
    backgroundColor: "#10141d",
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: "100%",
      height: "100%",
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [PlatformerScene],
    render: { antialias: false, pixelArt: true, roundPixels: true },
  });
}
