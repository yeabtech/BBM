import Phaser from "phaser";
import { GameInput } from "../input/game-input.js";
import { TEST_LEVEL, validateLevel } from "../level/level-config.js";
import {
  MOVEMENT_CONFIG,
  validateMovementConfig,
} from "../state/movement-config.js";
import { createPlayerMovementState } from "../state/player-state.js";
import {
  processJump,
  resetPlayerMovement,
  stepHorizontalMovement,
} from "../physics/movement.js";
import { ballSkinTextureKey } from "../rendering/ball-skins.js";
import { preloadBallTextures } from "../rendering/preload-ball-textures.js";
import {
  buildLevel,
  preloadTerrain,
  type BuiltLevel,
} from "../rendering/build-level.js";
import { LEVEL_VISUAL_CONFIG } from "../level/level-visual-config.js";
import { AdaptivePlatformerCamera } from "../rendering/grounded-camera-framing.js";
import { cameraHudPosition } from "../rendering/camera-coordinates.js";

export class PlatformerScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private inputController!: GameInput;
  private readonly movement = createPlayerMovementState();
  private level!: BuiltLevel;
  private paused = false;
  private resetting = false;
  private previousPlayerX = 0;
  private titleLabel!: Phaser.GameObjects.Text;
  private pauseLabel!: Phaser.GameObjects.Text;
  private statusLabel!: Phaser.GameObjects.Text;
  private cameraController!: AdaptivePlatformerCamera;

  constructor() {
    super("platformer");
  }

  preload(): void {
    preloadTerrain(this);
    preloadBallTextures(this);
  }

  create(): void {
    const errors = [
      ...validateMovementConfig(MOVEMENT_CONFIG),
      ...validateLevel(TEST_LEVEL),
    ];
    if (errors.length)
      throw new Error(`Invalid game configuration: ${errors.join("; ")}`);

    this.cameras.main.setBackgroundColor(LEVEL_VISUAL_CONFIG.background);
    this.physics.world.setBounds(
      0,
      0,
      TEST_LEVEL.width,
      MOVEMENT_CONFIG.worldHeight,
    );
    this.physics.world.setBoundsCollision(
      MOVEMENT_CONFIG.worldCollision.left,
      MOVEMENT_CONFIG.worldCollision.right,
      MOVEMENT_CONFIG.worldCollision.top,
      MOVEMENT_CONFIG.worldCollision.bottom,
    );
    this.physics.world.gravity.y = MOVEMENT_CONFIG.gravity;
    this.level = buildLevel(this, TEST_LEVEL);
    this.player = this.physics.add.sprite(
      TEST_LEVEL.start.x,
      TEST_LEVEL.start.y,
      ballSkinTextureKey("soccer"),
    );
    this.player.setDisplaySize(32, 32).setDepth(2);
    this.player.setCollideWorldBounds(true);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(26, 26, true);
    body.setMaxVelocity(MOVEMENT_CONFIG.maxHorizontalSpeed, 900);
    for (const platform of this.level.platforms)
      this.physics.add.collider(this.player, platform);
    for (const hazard of this.level.hazards) {
      this.physics.add.overlap(this.player, hazard, () =>
        this.resetPlayer("Hazard hit — level reset"),
      );
    }

    this.inputController = new GameInput(
      this,
      document.querySelector<HTMLElement>("#app") ?? document.body,
    );
    this.createHud();
    this.updateCameraFraming();
    this.scale.on("resize", this.updateCameraFraming, this);
    this.previousPlayerX = this.player.x;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputController.destroy();
      this.scale.off("resize", this.updateCameraFraming, this);
    });
  }

  private updateCameraFraming(size?: Phaser.Structs.Size): void {
    if (this.cameraController) {
      this.cameraController.resize(
        size?.width ?? this.scale.width,
        size?.height ?? this.scale.height,
      );
      return;
    }
    this.cameraController = new AdaptivePlatformerCamera(
      this.cameras.main,
      size?.width ?? this.scale.width,
      size?.height ?? this.scale.height,
      this.player.x,
    );
  }

  override update(_time: number, deltaMs: number): void {
    const frame = this.inputController.read();
    if (frame.resetPressed) this.resetPlayer("Level reset");
    if (frame.pausePressed) this.togglePause();
    if (this.paused || this.resetting) return;

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const grounded = body.blocked.down || body.touching.down;
    const deltaSeconds = Math.min(deltaMs / 1000, 1 / 20);
    const vx = stepHorizontalMovement(
      this.movement,
      { axis: frame.horizontal, grounded, deltaSeconds },
      MOVEMENT_CONFIG,
    );
    body.setVelocityX(vx);
    const jump = processJump(
      this.movement,
      frame.jumpPressed,
      grounded,
      MOVEMENT_CONFIG,
    );
    if (jump.velocityY !== null) body.setVelocityY(jump.velocityY);

    const distanceMoved = this.player.x - this.previousPlayerX;
    this.player.rotation = Phaser.Math.Angle.Wrap(
      this.player.rotation + distanceMoved / 16,
    );
    this.previousPlayerX = this.player.x;
    this.cameraController.update(
      this.player.x,
      this.player.y,
      body.velocity.x,
      deltaMs,
    );
    if (this.player.y > MOVEMENT_CONFIG.fallResetY)
      this.resetPlayer("Fell below the level — reset");
  }

  private createHud(): void {
    const zoom = this.cameras.main.zoom;
    const hudScale = 1 / zoom;
    this.titleLabel = this.add
      .text(0, 0, "BBM  /  SOLO TEST RUN", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#d7f8ef",
        backgroundColor: "#142431",
        padding: { x: 10, y: 7 },
      })
      .setScrollFactor(0)
      .setScale(hudScale)
      .setDepth(5);
    this.statusLabel = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#a9bfcc",
      })
      .setScrollFactor(0)
      .setScale(hudScale)
      .setDepth(5);
    this.pauseLabel = this.add
      .text(
        this.scale.width / 2,
        this.scale.height / 2,
        "PAUSED\nPress ESC to resume",
        {
          fontFamily: "monospace",
          fontSize: "26px",
          color: "#ffffff",
          align: "center",
          backgroundColor: "#142431",
          padding: { x: 22, y: 18 },
        },
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setScale(hudScale)
      .setDepth(10)
      .setVisible(false);
    this.positionHud();
    this.scale.on("resize", this.positionHud, this);
  }

  private positionHud(size?: Phaser.Structs.Size): void {
    const width = size?.width ?? this.scale.width;
    const height = size?.height ?? this.scale.height;
    const zoom = this.cameras.main.zoom;
    const title = cameraHudPosition(18, 16, width, height, zoom);
    const status = cameraHudPosition(18, 54, width, height, zoom);
    this.titleLabel.setPosition(title.x, title.y);
    this.statusLabel.setPosition(status.x, status.y);
    this.pauseLabel.setPosition(width / 2, height / 2);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.physics.world.isPaused = this.paused;
    this.pauseLabel.setVisible(this.paused);
  }

  private resetPlayer(message: string): void {
    if (this.resetting) return;
    this.resetting = true;
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    this.player.setPosition(TEST_LEVEL.start.x, TEST_LEVEL.start.y);
    body.reset(TEST_LEVEL.start.x, TEST_LEVEL.start.y);
    this.player.setRotation(0).setAlpha(0.35);
    this.cameraController.resetToTarget(this.player.x, this.player.y);
    resetPlayerMovement(this.movement);
    this.previousPlayerX = this.player.x;
    this.statusLabel.setText(message);
    this.tweens.add({
      targets: this.player,
      alpha: 1,
      duration: 250,
      onComplete: () => {
        this.resetting = false;
      },
    });
  }
}
