import Phaser from "phaser";
import {
  SIMULATION_MAX_CATCH_UP_TICKS,
  SIMULATION_TICK_SECONDS,
  TEST_LEVEL,
} from "@bbm/game-simulation";
import type {
  ActivePowerUp,
  BallSkin,
  GameplaySnapshot,
  RaceSessionSnapshot,
  RoomSnapshot,
  ServerMessage,
  RaceResultEntry,
  PowerUpType,
} from "@bbm/shared-contracts";
import { GameInput } from "../input/game-input.js";
import { LEVEL_VISUAL_CONFIG } from "../level/level-visual-config.js";
import {
  drawPixelTerrain,
  preloadTerrain,
  terrainTopOffset,
} from "../rendering/build-level.js";
import { AdaptivePlatformerCamera } from "../rendering/grounded-camera-framing.js";
import { cameraHudPosition } from "../rendering/camera-coordinates.js";
import {
  playerMotionState,
  resultLabel,
} from "../presentation/race-presentation.js";
import { playerBallTextureKey } from "../rendering/ball-skins.js";
import { preloadBallTextures } from "../rendering/preload-ball-textures.js";
import {
  LocalPrediction,
  playerStateFromSnapshot,
  RemoteInterpolationBuffer,
} from "../network/prediction.js";

export interface MultiplayerSceneContext {
  guestId: string;
  room: RoomSnapshot;
  race: RaceSessionSnapshot;
  initialSnapshot: GameplaySnapshot | null;
  sendInput(input: {
    raceId: string;
    sequence: number;
    horizontal: -1 | 0 | 1;
    jumpDown: boolean;
  }): boolean;
  sendPowerUp(raceId: string, slot: 0 | 1): boolean;
  returnToLobby(): void;
  connected(): boolean;
  subscribeMessages(listener: (message: ServerMessage) => void): () => void;
  subscribeConnection(listener: (connected: boolean) => void): () => void;
}

interface PlayerVisual {
  readonly guestId: string;
  readonly ball: Phaser.GameObjects.Container;
  readonly image: Phaser.GameObjects.Image;
  readonly name: Phaser.GameObjects.Text;
  readonly state: Phaser.GameObjects.Text;
  readonly remote: RemoteInterpolationBuffer;
  grounded: boolean | null;
  respawning: boolean;
  finished: boolean;
  motionState: string;
}

interface PowerUpSlotVisual {
  readonly card: Phaser.GameObjects.Rectangle;
  readonly icon: Phaser.GameObjects.Text;
  readonly name: Phaser.GameObjects.Text;
  readonly slot: Phaser.GameObjects.Text;
}

const POWER_UP_DETAILS: Record<
  PowerUpType,
  { icon: string; description: string; color: number }
> = {
  speed: {
    icon: "»",
    description: "Temporarily increases movement speed.",
    color: 0xff8a45,
  },
  jump: {
    icon: "↑",
    description: "Temporarily increases jump strength.",
    color: 0xffd166,
  },
  heavy: {
    icon: "◆",
    description: "Increases mass and pushing strength.",
    color: 0x91a4b4,
  },
  shockwave: {
    icon: "◎",
    description: "Pushes nearby opponents away.",
    color: 0xb887ff,
  },
  shrink: {
    icon: "◇",
    description: "Reduces ball collision size.",
    color: 0x6ed5ff,
  },
  ghost: {
    icon: "◌",
    description: "Allows passing through other players temporarily.",
    color: 0x8ce7d3,
  },
};

const COLOR_HEX = {
  mint: 0x55d6be,
  coral: 0xef7777,
  sun: 0xffd166,
  sky: 0x69bdf4,
  violet: 0xb897f2,
  blue: 0x6089f2,
} as const;

export class MultiplayerScene extends Phaser.Scene {
  private readonly context: MultiplayerSceneContext;
  private readonly visuals = new Map<string, PlayerVisual>();
  private readonly sentAt = new Map<number, number>();
  private inputController!: GameInput;
  private localPrediction: LocalPrediction | null = null;
  private latestSnapshotSequence = -1;
  private inputSequence = 1;
  private lastSentAt = 0;
  private lastInput: { horizontal: -1 | 0 | 1; jumpDown: boolean } | null =
    null;
  private accumulatorSeconds = 0;
  private networkLabel!: Phaser.GameObjects.Text;
  private hudLabel!: Phaser.GameObjects.Text;
  private diagnosticsLabel!: Phaser.GameObjects.Text;
  private localBall: Phaser.GameObjects.Container | null = null;
  private localBallImage: Phaser.GameObjects.Image | null = null;
  private localName: Phaser.GameObjects.Text | null = null;
  private localStateLabel: Phaser.GameObjects.Text | null = null;
  private correctionMagnitude = 0;
  private localRenderOffsetX = 0;
  private localRenderOffsetY = 0;
  private estimatedLatencyMs: number | null = null;
  private detachMessages: (() => void) | null = null;
  private detachConnection: (() => void) | null = null;
  private connected = false;
  private readonly powerUpSlots: PowerUpSlotVisual[] = [];
  private powerUpPanel!: Phaser.GameObjects.Rectangle;
  private powerUpPanelIcon!: Phaser.GameObjects.Text;
  private powerUpPanelName!: Phaser.GameObjects.Text;
  private powerUpPanelDescription!: Phaser.GameObjects.Text;
  private effectsLabel!: Phaser.GameObjects.Text;
  private usePowerButton!: Phaser.GameObjects.Rectangle;
  private usePowerButtonText!: Phaser.GameObjects.Text;
  private localInventory: PowerUpType[] = [];
  private selectedPowerSlot: 0 | 1 | null = null;
  private pendingPowerActivation: {
    slot: 0 | 1;
    before: string;
    at: number;
  } | null = null;
  private serverClockOffsetMs = 0;
  private readonly checkpointObjects = new Map<
    string,
    Phaser.GameObjects.Container
  >();
  private readonly pickupObjects = new Map<
    string,
    Phaser.GameObjects.Container
  >();
  private readonly environmentObjects = new Map<
    string,
    Phaser.GameObjects.Rectangle
  >();
  private readonly movingPlatformTerrain = new Map<
    string,
    Phaser.GameObjects.Image
  >();
  private resultsShown = false;
  private localRespawning = false;
  private localFinished = false;
  private localStatusText = "YOU";
  private lastImpactSnapshot = -1;
  private countdownValue = -1;
  private countdownText: Phaser.GameObjects.Text | null = null;
  private lastActiveEffects = new Set<PowerUpType>();
  private localMotionState = "idle";
  private cameraController!: AdaptivePlatformerCamera;
  private readonly lastPlayerStates = new Map<
    string,
    { grounded: boolean; respawning: boolean; finished: boolean }
  >();

  constructor(context: MultiplayerSceneContext) {
    super("multiplayer");
    this.context = context;
    this.connected = context.connected();
  }

  preload(): void {
    preloadTerrain(this);
    preloadBallTextures(this);
  }

  create(): void {
    this.cameras.main.setBackgroundColor(LEVEL_VISUAL_CONFIG.background);
    this.drawSharedLevel();
    this.updateCameraFraming();
    this.scale.on("resize", this.updateCameraFraming, this);
    this.inputController = new GameInput(
      this,
      document.querySelector<HTMLElement>("#app") ?? document.body,
    );
    this.hudLabel = this.add
      .text(18, 16, "BBM  /  LIVE RACE", {
        fontFamily: "monospace",
        fontSize: "16px",
        color: "#d7f8ef",
        backgroundColor: "#142431",
        padding: { x: 10, y: 7 },
      })
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(20)
      .setVisible(false);
    this.networkLabel = this.add
      .text(18, 54, "Waiting for server snapshot…", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#ffd166",
        backgroundColor: "#142431",
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(20);
    this.diagnosticsLabel = this.add
      .text(18, 82, "", {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#a9bfcc",
        backgroundColor: "#142431",
        padding: { x: 8, y: 6 },
      })
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(20)
      .setVisible(false);
    this.effectsLabel = this.add
      .text(18, 112, "", {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#ffd166",
        backgroundColor: "#142431",
        padding: { x: 8, y: 5 },
      })
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(20)
      .setVisible(false);
    this.createPowerUpHud();
    this.createCountdown();
    this.positionHud();
    this.detachMessages = this.context.subscribeMessages((message) => {
      if (message.type === "gameplay_snapshot")
        this.applySnapshot(message.payload, performance.now());
      else if (message.type === "race_results")
        this.showResults(message.payload.results, message.payload.durationMs);
      else if (message.type === "protocol_error") {
        this.pendingPowerActivation = null;
        this.refreshPowerUpHud();
      }
    });
    this.detachConnection = this.context.subscribeConnection((connected) => {
      this.connected = connected;
      this.networkLabel.setText(
        connected
          ? "Connected · server authoritative"
          : "Reconnecting · movement paused",
      );
      this.networkLabel.setColor(connected ? "#84dfc5" : "#ffbf69");
    });
    this.scale.on("resize", this.positionHud, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.inputController.destroy();
      this.detachMessages?.();
      this.detachConnection?.();
      this.scale.off("resize", this.positionHud, this);
      this.scale.off("resize", this.positionCountdown, this);
      this.scale.off("resize", this.updateCameraFraming, this);
    });
    if (this.context.initialSnapshot)
      this.applySnapshot(this.context.initialSnapshot, performance.now());
    this.networkLabel.setText(
      this.connected
        ? "Waiting for server snapshot…"
        : "Disconnected · movement paused",
    );
  }

  override update(_time: number, deltaMs: number): void {
    if (
      this.pendingPowerActivation &&
      performance.now() - this.pendingPowerActivation.at > 5_000
    ) {
      this.pendingPowerActivation = null;
      this.refreshPowerUpHud();
    }
    if (!this.localPrediction) return;
    const frame = this.inputController.read();
    const input = { horizontal: frame.horizontal, jumpDown: frame.jumpDown };
    const changed =
      !this.lastInput ||
      input.horizontal !== this.lastInput.horizontal ||
      input.jumpDown !== this.lastInput.jumpDown;
    if (
      this.connected &&
      !this.localRespawning &&
      !this.localFinished &&
      (changed || performance.now() - this.lastSentAt >= 50)
    ) {
      this.inputSequence += 1;
      if (
        this.localPrediction.setInput({
          sequence: this.inputSequence,
          ...input,
        })
      ) {
        const sent = this.context.sendInput({
          raceId: this.context.race.raceId,
          sequence: this.inputSequence,
          ...input,
        });
        if (sent) {
          const now = performance.now();
          this.lastSentAt = now;
          this.sentAt.set(this.inputSequence, now);
          while (this.sentAt.size > 120)
            this.sentAt.delete(this.sentAt.keys().next().value!);
          this.lastInput = input;
        }
      }
    }
    if (this.connected && !this.localRespawning && !this.localFinished) {
      this.accumulatorSeconds += Math.min(deltaMs / 1000, 0.25);
      let steps = 0;
      while (
        this.accumulatorSeconds >= SIMULATION_TICK_SECONDS &&
        steps < SIMULATION_MAX_CATCH_UP_TICKS
      ) {
        this.localPrediction.predictOneTick();
        this.accumulatorSeconds -= SIMULATION_TICK_SECONDS;
        steps += 1;
      }
      if (this.accumulatorSeconds >= SIMULATION_TICK_SECONDS)
        this.accumulatorSeconds %= SIMULATION_TICK_SECONDS;
    }
    this.renderPlayers(performance.now());
    if (this.localBall) {
      this.cameraController.update(
        this.localBall.x,
        this.localBall.y,
        this.localPrediction.currentState.velocityX,
        deltaMs,
      );
    }
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
      TEST_LEVEL.start.x,
    );
  }

  private drawSharedLevel(): void {
    for (const platform of TEST_LEVEL.platforms) {
      drawPixelTerrain(this, platform);
    }
    for (const hazard of TEST_LEVEL.hazards) {
      this.add.rectangle(
        hazard.x + hazard.width / 2,
        hazard.y + hazard.height / 2,
        hazard.width,
        hazard.height,
        0xef6666,
      );
      for (let sx = hazard.x; sx < hazard.x + hazard.width; sx += 18)
        this.add
          .triangle(sx + 9, hazard.y - 3, 0, 20, 9, 0, 18, 20, 0xff8585)
          .setDepth(2);
      this.add
        .text(hazard.x, hazard.y - 24, "DANGER", {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#ff8585",
        })
        .setDepth(1);
    }
    for (const checkpoint of TEST_LEVEL.checkpoints) {
      const flag = this.add.container(checkpoint.x, checkpoint.y).setDepth(2);
      flag.add(this.add.rectangle(0, 0, 8, 46, 0x75899a));
      flag.add(this.add.triangle(13, -12, 0, 0, 24, 7, 0, 15, 0x8094a2));
      this.checkpointObjects.set(checkpoint.id, flag);
    }
    this.add.rectangle(TEST_LEVEL.finishX, 382, 10, 136, 0xffd166);
    this.add
      .triangle(TEST_LEVEL.finishX + 35, 350, 0, 0, 54, 10, 0, 22, 0xffd166)
      .setDepth(2);
    this.add.text(TEST_LEVEL.finishX + 12, 318, "FINISH", {
      fontFamily: "monospace",
      fontSize: "12px",
      color: "#ffd166",
    });
  }

  private applySnapshot(
    snapshot: GameplaySnapshot,
    receivedAtMs: number,
  ): void {
    if (
      snapshot.raceId !== this.context.race.raceId ||
      snapshot.snapshotSequence <= this.latestSnapshotSequence
    )
      return;
    const previousLocalRespawning = this.localRespawning;
    this.latestSnapshotSequence = snapshot.snapshotSequence;
    this.updateCountdown();
    this.serverClockOffsetMs =
      Date.parse(snapshot.serverTimestamp) - Date.now();
    const local = snapshot.players.find(
      (player) => player.guestId === this.context.guestId,
    );
    if (!local) {
      this.networkLabel.setText("Waiting for your race session…");
      return;
    }
    if (!this.localPrediction || local.respawning || local.finished) {
      const slot = snapshot.players.findIndex(
        (player) => player.guestId === this.context.guestId,
      );
      this.localPrediction = new LocalPrediction(
        playerStateFromSnapshot(local, slot),
      );
      this.inputSequence = local.lastProcessedInputSequence;
      this.localRenderOffsetX = 0;
      this.localRenderOffsetY = 0;
    }
    const reconciliation = this.localPrediction.reconcile(snapshot, local);
    if (reconciliation.applied) {
      this.correctionMagnitude = reconciliation.correctionDistance;
      if (reconciliation.snapped) {
        this.localRenderOffsetX = 0;
        this.localRenderOffsetY = 0;
      } else {
        this.localRenderOffsetX -= reconciliation.correctionX;
        this.localRenderOffsetY -= reconciliation.correctionY;
      }
      for (const sequence of this.sentAt.keys()) {
        if (sequence <= local.lastProcessedInputSequence) {
          this.estimatedLatencyMs = Math.round(
            receivedAtMs - this.sentAt.get(sequence)!,
          );
          this.sentAt.delete(sequence);
        }
      }
    }
    const present = new Set(snapshot.players.map((player) => player.guestId));
    for (const [kind, values] of [
      ["moving", snapshot.environment.movingPlatforms],
      ["block", snapshot.environment.fallingBlocks],
      ["trap", snapshot.environment.crushingTraps],
    ] as const) {
      for (const item of values) {
        const id = `${kind}:${item.id}`;
        if (kind === "moving") {
          let terrain = this.movingPlatformTerrain.get(id);
          if (!terrain) {
            terrain = drawPixelTerrain(this, item);
            this.movingPlatformTerrain.set(id, terrain);
          }
          terrain.setPosition(item.x, item.y - terrainTopOffset(item));
          continue;
        }
        let object = this.environmentObjects.get(id);
        if (!object) {
          object = this.add
            .rectangle(
              item.x,
              item.y,
              item.width,
              item.height,
              kind === "block" ? 0xb47b50 : 0xef7777,
            )
            .setDepth(4);
          this.environmentObjects.set(id, object);
        }
        object.setPosition(item.x + item.width / 2, item.y + item.height / 2);
        object.setSize(item.width, item.height);
        if (kind === "block" && "state" in item)
          object.setVisible(item.state !== "resetting");
      }
    }
    for (const checkpoint of snapshot.checkpoints) {
      const visual = this.checkpointObjects.get(checkpoint.id);
      if (visual)
        visual
          .setAlpha(checkpoint.activated ? 1 : 0.45)
          .setData("activated", checkpoint.activated);
      if (visual && checkpoint.activated)
        visual.each((child: Phaser.GameObjects.GameObject) => {
          if (child instanceof Phaser.GameObjects.Triangle)
            child.setFillStyle(0x55d6be);
        });
    }
    for (const pickup of snapshot.pickups) {
      let visual = this.pickupObjects.get(pickup.id);
      if (!visual) {
        visual = this.add.container(pickup.x, pickup.y).setDepth(3);
        visual.add(
          this.add
            .rectangle(0, 0, 22, 22, POWER_UP_DETAILS[pickup.type].color)
            .setRotation(Math.PI / 4),
        );
        visual.add(
          this.add.text(-7, -7, pickup.type[0]!.toUpperCase(), {
            fontFamily: "monospace",
            fontSize: "11px",
            color: "#17202b",
          }),
        );
        this.pickupObjects.set(pickup.id, visual);
      }
      visual.setVisible(pickup.available);
    }
    const effects = local.activeEffects
      .map(
        (effect) =>
          `${effect.type} ${Math.max(0, (Date.parse(effect.expiresAt) - (Date.now() + this.serverClockOffsetMs)) / 1000).toFixed(0)}s`,
      )
      .join(", ");
    const currentEffects = new Set(
      local.activeEffects.map((effect) => effect.type),
    );
    for (const type of currentEffects) {
      if (!this.lastActiveEffects.has(type))
        this.burst(
          local.x,
          local.y,
          POWER_UP_DETAILS[type].color,
          type === "shockwave" ? 22 : 12,
          type === "shockwave" ? 1.7 : 1,
        );
    }
    this.lastActiveEffects = currentEffects;
    this.localInventory = [...local.inventory];
    if (
      this.pendingPowerActivation &&
      JSON.stringify(local.inventory) !== this.pendingPowerActivation.before
    )
      this.pendingPowerActivation = null;
    if (
      this.selectedPowerSlot !== null &&
      !local.inventory[this.selectedPowerSlot]
    )
      this.selectedPowerSlot = null;
    if (previousLocalRespawning !== local.respawning) {
      this.cameraController?.resetToTarget(local.x, local.y);
    }
    this.effectsLabel.setText(effects ? `ACTIVE  ${effects}` : "");
    this.refreshPowerUpHud();
    this.localRespawning = local.respawning;
    this.localFinished = local.finished;
    this.localStatusText = local.respawning
      ? `RESPAWN ${Math.max(0, (Date.parse(local.respawnAt ?? "") - Date.now()) / 1000).toFixed(1)}s`
      : local.finished
        ? `FINISHED #${local.finishPlace ?? "—"}`
        : local.ghost
          ? "GHOST"
          : local.connected
            ? "YOU"
            : "RECONNECTING";
    if (this.localStateLabel)
      this.localStateLabel.setText(this.localStatusText);
    if (this.localBall) {
      const radiusScale = local.radius / 22;
      if (this.localBall.getData("radiusScale") !== radiusScale) {
        this.tweens.killTweensOf(this.localBall);
        this.localBall
          .setScale(radiusScale)
          .setData("radiusScale", radiusScale);
        this.localMotionState = "";
      }
      this.localBall.setAlpha(local.ghost ? 0.4 : local.respawning ? 0.25 : 1);
    }
    for (const player of snapshot.players) {
      const previousState = this.lastPlayerStates.get(player.guestId);
      if (previousState && !previousState.grounded && player.grounded) {
        this.burst(player.x, player.y + player.radius, 0xccebdc, 6, 0.7);
        const playerVisual =
          player.guestId === this.context.guestId
            ? null
            : this.visuals.get(player.guestId);
        if (playerVisual)
          this.tweens.add({
            targets: playerVisual.ball,
            scaleX: 1.12,
            scaleY: 0.88,
            duration: 65,
            yoyo: true,
            ease: "Sine.easeOut",
          });
      }
      if (previousState && !previousState.respawning && player.respawning)
        this.burst(player.x, player.y, 0xff777d, 12, 1.1);
      if (previousState && !previousState.finished && player.finished)
        this.burst(player.x, player.y, 0xffd166, 18, 1.35);
      this.lastPlayerStates.set(player.guestId, {
        grounded: player.grounded,
        respawning: player.respawning,
        finished: player.finished,
      });
      if (player.guestId === this.context.guestId) {
        if (!this.localBall) {
          const visual = this.createVisual(
            player.guestId,
            player.ballSkin,
            player.displayName,
            player.activeEffects,
          );
          this.localBall = visual.ball;
          this.localBallImage = visual.image;
          this.localName = visual.name;
          this.localStateLabel = visual.state;
        }
        if (this.localBallImage)
          this.updateBallTexture(
            this.localBallImage,
            player.ballSkin,
            player.activeEffects,
          );
        continue;
      }
      let visual = this.visuals.get(player.guestId);
      if (!visual) {
        visual = this.createVisual(
          player.guestId,
          player.ballSkin,
          player.displayName,
          player.activeEffects,
        );
        this.visuals.set(player.guestId, visual);
      }
      this.updateBallTexture(
        visual.image,
        player.ballSkin,
        player.activeEffects,
      );
      visual.remote.add(snapshot, player, receivedAtMs);
      visual.ball
        .setScale(player.radius / 22)
        .setAlpha(player.ghost ? 0.4 : player.respawning ? 0.25 : 1);
      const nextMotion = playerMotionState(player);
      if (visual.motionState !== nextMotion) {
        visual.motionState = nextMotion;
        this.tweens.killTweensOf(visual.ball);
        const stretchX =
          nextMotion === "run"
            ? 1.07
            : nextMotion === "jump" || nextMotion === "double-jump"
              ? 0.92
              : nextMotion === "fall"
                ? 1.06
                : 1;
        const stretchY =
          nextMotion === "run"
            ? 0.94
            : nextMotion === "jump" || nextMotion === "double-jump"
              ? 1.08
              : nextMotion === "fall"
                ? 0.94
                : nextMotion === "finish"
                  ? 1.18
                  : 1;
        this.tweens.add({
          targets: visual.ball,
          scaleX: (stretchX * player.radius) / 22,
          scaleY: (stretchY * player.radius) / 22,
          duration: 140,
          yoyo: nextMotion === "run" || nextMotion === "finish",
          repeat: nextMotion === "run" ? -1 : 0,
          ease: "Sine.easeInOut",
        });
      }
      visual.state.setText(
        player.respawning
          ? "RESPAWNING"
          : player.finished
            ? `FINISHED #${player.finishPlace ?? "—"}`
            : player.ghost
              ? "GHOST"
              : player.connected
                ? "ONLINE"
                : "OFFLINE",
      );
    }
    for (const [guestId, visual] of this.visuals) {
      if (!present.has(guestId)) {
        visual.ball.destroy();
        visual.name.destroy();
        visual.state.destroy();
        this.visuals.delete(guestId);
      }
    }
    this.networkLabel.setText(
      this.connected
        ? "Connected · server authoritative"
        : "Reconnecting · movement paused",
    );
    this.hudLabel.setText(
      `GREENWAY RUSH  /  ${Math.min(100, Math.round((local.x / TEST_LEVEL.finishX) * 100))}%  /  CP ${snapshot.checkpoints.findIndex((item) => item.activated) + 1}/${snapshot.checkpoints.length}  /  ${snapshot.players.length} PLAYERS  /  ${local.respawning ? "RESPAWNING" : local.finished ? `FINISHED #${local.finishPlace ?? "—"}` : this.connected ? "ONLINE" : "RECONNECTING"}`,
    );
    this.diagnosticsLabel.setText(
      `tick ${snapshot.simulationTick} · ${snapshot.diagnostics.simulationTickRate}t/s · ${snapshot.diagnostics.snapshotRate}s/s · ${snapshot.diagnostics.connectedPlayers} online · sim ${snapshot.diagnostics.activeSimulations} · RTT ${this.estimatedLatencyMs ?? "—"}ms · fix ${this.correctionMagnitude.toFixed(1)}px · q ${snapshot.diagnostics.inputQueueSize} · drop ${snapshot.diagnostics.droppedInputs}/${snapshot.diagnostics.droppedSimulationTicks}`,
    );
    if (
      snapshot.diagnostics.collisionIterations > 0 &&
      snapshot.snapshotSequence > this.lastImpactSnapshot &&
      snapshot.snapshotSequence % 8 === 0
    ) {
      this.lastImpactSnapshot = snapshot.snapshotSequence;
      this.cameras.main.shake(65, 0.001);
      this.burst(local.x, local.y, 0xffffff, 5, 0.6);
    }
    if (snapshot.results)
      this.showResults(
        snapshot.results,
        Math.max(
          0,
          ...snapshot.results.map((result) => result.finishTimeMs ?? 0),
        ),
      );
  }

  private showResults(results: RaceResultEntry[], durationMs: number): void {
    if (this.resultsShown) return;
    this.resultsShown = true;
    const width = Math.min(560, this.scale.width - 32);
    const height = Math.min(390, this.scale.height - 32);
    const panel = this.add
      .container(this.scale.width / 2, this.scale.height / 2)
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(100);
    panel.add(
      this.add
        .rectangle(0, 0, width, height, 0x111a27, 0.97)
        .setStrokeStyle(2, 0x55d6be),
    );
    panel.add(
      this.add.text(
        -width / 2 + 24,
        -height / 2 + 24,
        results.some((r) => r.place === 1)
          ? "VICTORY / RACE RESULTS"
          : "RACE RESULTS",
        {
          fontFamily: "monospace",
          fontSize: "22px",
          color: "#ffd166",
        },
      ),
    );
    panel.add(
      this.add.text(
        -width / 2 + 24,
        -height / 2 + 58,
        `Duration ${(durationMs / 1000).toFixed(1)}s`,
        { fontFamily: "monospace", fontSize: "13px", color: "#b8cbd5" },
      ),
    );
    results.forEach((result, index) => {
      const colors = ["#ffd166", "#d4e2eb", "#e69a69"];
      panel.add(
        this.add.circle(
          -width / 2 + 32,
          -height / 2 + 110 + index * 48,
          8,
          COLOR_HEX[result.color],
        ),
      );
      panel.add(
        this.add.text(
          -width / 2 + 50,
          -height / 2 + 102 + index * 48,
          resultLabel(result),
          {
            fontFamily: "monospace",
            fontSize: "15px",
            color: (result.place ? colors[result.place - 1] : "#9eabb6")!,
          },
        ),
      );
    });
    const button = this.add
      .text(0, height / 2 - 38, "RETURN TO LOBBY", {
        fontFamily: "monospace",
        fontSize: "15px",
        color: "#111a27",
        backgroundColor: "#55d6be",
        padding: { x: 20, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    button.on("pointerdown", () => this.context.returnToLobby());
    if (results.some((result) => result.place === 1)) {
      const winner = panel.add(
        this.add
          .text(0, -height / 2 + 78, "★", {
            fontSize: "30px",
            color: "#ffd166",
          })
          .setOrigin(0.5),
      );
      this.tweens.add({
        targets: winner,
        y: winner.y - 5,
        alpha: 0.65,
        duration: 500,
        yoyo: true,
        repeat: -1,
      });
    }
    panel.add(button);
    this.networkLabel.setText("Race complete · results from server");
  }

  private createVisual(
    guestId: string,
    ballSkin: BallSkin,
    displayName: string,
    activeEffects: readonly ActivePowerUp[],
  ): PlayerVisual {
    const ball = this.add.container(0, 0).setDepth(5);
    const image = this.add
      .image(0, 0, playerBallTextureKey(ballSkin, activeEffects))
      .setDisplaySize(44, 44);
    ball.add(image);
    const name = this.add
      .text(0, -31, displayName, {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#f4f7fb",
        stroke: "#10141d",
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(6);
    const state = this.add
      .text(0, -17, guestId === this.context.guestId ? "YOU" : "CONNECTED", {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#84dfc5",
        stroke: "#10141d",
        strokeThickness: 2,
      })
      .setOrigin(0.5)
      .setDepth(6);
    return {
      guestId,
      ball,
      image,
      name,
      state,
      remote: new RemoteInterpolationBuffer(),
      grounded: null,
      respawning: false,
      finished: false,
      motionState: "idle",
    };
  }

  private updateBallTexture(
    image: Phaser.GameObjects.Image,
    ballSkin: BallSkin,
    activeEffects: readonly ActivePowerUp[],
  ): void {
    const textureKey = playerBallTextureKey(ballSkin, activeEffects);
    if (image.texture.key !== textureKey)
      image.setTexture(textureKey).setDisplaySize(44, 44);
  }

  private createCountdown(): void {
    this.countdownText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, "", {
        fontFamily: "monospace",
        fontSize: "clamp(72px, 18vw, 150px)",
        fontStyle: "bold",
        color: "#ffd166",
        stroke: "#142431",
        strokeThickness: 10,
        shadow: { color: "#000000", blur: 18, fill: true },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(90)
      .setVisible(false);
    this.scale.on("resize", this.positionCountdown, this);
  }

  private positionCountdown(): void {
    this.countdownText?.setPosition(
      this.scale.width / 2,
      this.scale.height / 2,
    );
  }

  private updateCountdown(): void {
    const deadline = this.context.race.countdownDeadlineAt;
    if (!deadline || !this.countdownText || this.resultsShown) return;
    const remaining =
      Date.parse(deadline) - (Date.now() + this.serverClockOffsetMs);
    const next = remaining > 0 ? Math.ceil(remaining / 1000) : 0;
    if (next === this.countdownValue) return;
    this.countdownValue = next;
    const label = next > 0 ? String(next) : "GO!";
    this.countdownText
      .setText(label)
      .setColor(
        next === 3
          ? "#55d6be"
          : next === 2
            ? "#ffd166"
            : next === 1
              ? "#ff777d"
              : "#ffffff",
      )
      .setScale(0.65 / this.cameras.main.zoom)
      .setAlpha(1)
      .setVisible(true);
    this.tweens.killTweensOf(this.countdownText);
    this.tweens.add({
      targets: this.countdownText,
      scale: 1 / this.cameras.main.zoom,
      duration: 220,
      ease: "Back.Out",
      yoyo: next === 0,
      hold: 350,
      onComplete: () => {
        if (next === 0) this.countdownText?.setVisible(false);
      },
    });
  }

  private burst(
    x: number,
    y: number,
    color: number,
    count: number,
    force: number,
  ): void {
    for (let i = 0; i < count; i += 1) {
      const dot = this.add
        .circle(x, y, Phaser.Math.Between(2, 4), color, 0.85)
        .setDepth(8);
      const angle = Phaser.Math.FloatBetween(-Math.PI, 0);
      const distance = Phaser.Math.Between(12, 32) * force;
      this.tweens.add({
        targets: dot,
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance,
        alpha: 0,
        scale: 0.2,
        duration: Phaser.Math.Between(220, 420),
        onComplete: () => dot.destroy(),
      });
    }
  }

  private renderPlayers(now: number): void {
    if (this.localPrediction && this.localBall) {
      const player = this.localPrediction.currentState;
      const nextMotion = playerMotionState({
        respawning: this.localRespawning,
        finished: this.localFinished,
        grounded: player.grounded,
        jumpsUsed: player.jumpsUsed,
        velocityX: player.velocityX,
        velocityY: player.velocityY,
      });
      if (this.localMotionState !== nextMotion) {
        this.localMotionState = nextMotion;
        const base = this.localBall.getData("radiusScale") as
          number | undefined;
        const scale = base ?? 1;
        this.tweens.killTweensOf(this.localBall);
        this.tweens.add({
          targets: this.localBall,
          scaleX:
            scale *
            (nextMotion === "run"
              ? 1.06
              : nextMotion === "jump" || nextMotion === "double-jump"
                ? 0.94
                : nextMotion === "fall"
                  ? 1.04
                  : 1),
          scaleY:
            scale *
            (nextMotion === "run"
              ? 0.95
              : nextMotion === "jump" || nextMotion === "double-jump"
                ? 1.08
                : nextMotion === "fall"
                  ? 0.95
                  : nextMotion === "finish"
                    ? 1.15
                    : 1),
          duration: 140,
          yoyo: nextMotion === "run" || nextMotion === "finish",
          repeat: nextMotion === "run" ? -1 : 0,
          ease: "Sine.easeInOut",
        });
      }
      this.localRenderOffsetX *= 0.82;
      this.localRenderOffsetY *= 0.82;
      if (Math.abs(this.localRenderOffsetX) < 0.05) this.localRenderOffsetX = 0;
      if (Math.abs(this.localRenderOffsetY) < 0.05) this.localRenderOffsetY = 0;
      const renderX = player.x + this.localRenderOffsetX;
      const renderY = player.y + this.localRenderOffsetY;
      this.localBall.setPosition(renderX, renderY);
      this.localBall.rotation += player.velocityX * 0.00004;
      this.localName?.setPosition(renderX, renderY - 31);
      this.localStateLabel?.setPosition(renderX, renderY - 17);
      this.localStateLabel?.setText(
        this.connected ? this.localStatusText : "RECONNECTING",
      );
    }
    const renderAt = now - 100;
    for (const visual of this.visuals.values()) {
      const position = visual.remote.sample(renderAt);
      if (!position) continue;
      visual.ball.setPosition(position.x, position.y);
      visual.ball.rotation += position.velocityX * 0.00004;
      visual.name.setPosition(position.x, position.y - 31);
      visual.state
        .setPosition(position.x, position.y - 17)
        .setText(position.connected ? "CONNECTED" : "DISCONNECTED")
        .setColor(position.connected ? "#84dfc5" : "#ffbf69");
      visual.ball.setAlpha(position.connected ? 1 : 0.48);
    }
  }

  private positionHud(): void {
    const zoom = this.cameras.main.zoom;
    const hudPoint = (x: number, y: number) =>
      cameraHudPosition(x, y, this.scale.width, this.scale.height, zoom);
    const title = hudPoint(18, 16);
    const network = hudPoint(18, 54);
    const diagnostics = hudPoint(18, 82);
    const effects = hudPoint(18, 112);
    this.hudLabel.setPosition(title.x, title.y);
    this.networkLabel.setPosition(network.x, network.y);
    this.diagnosticsLabel.setPosition(diagnostics.x, diagnostics.y);
    if (this.effectsLabel) this.effectsLabel.setPosition(effects.x, effects.y);
    const mobile = this.scale.width <= 760;
    const slotY = this.scale.height - (mobile ? 190 : 62);
    const leftX = this.scale.width / 2 - 139;
    this.powerUpSlots.forEach((slot, index) => {
      const card = hudPoint(leftX + index * 140, slotY);
      const icon = hudPoint(leftX - 53 + index * 140, slotY);
      const name = hudPoint(leftX - 34 + index * 140, slotY);
      const slotLabel = hudPoint(leftX - 60 + index * 140, slotY - 21);
      slot.card.setPosition(card.x, card.y);
      slot.icon.setPosition(icon.x, icon.y);
      slot.name.setPosition(name.x, name.y);
      slot.slot.setPosition(slotLabel.x, slotLabel.y);
    });
    const panelY = slotY - 84;
    const panel = hudPoint(this.scale.width / 2, panelY);
    const panelIcon = hudPoint(this.scale.width / 2 - 118, panelY - 20);
    const panelName = hudPoint(this.scale.width / 2 - 95, panelY - 34);
    const panelDescription = hudPoint(this.scale.width / 2 - 95, panelY - 13);
    const useButton = hudPoint(this.scale.width / 2, panelY + 29);
    this.powerUpPanel?.setPosition(panel.x, panel.y);
    this.powerUpPanelIcon?.setPosition(panelIcon.x, panelIcon.y);
    this.powerUpPanelName?.setPosition(panelName.x, panelName.y);
    this.powerUpPanelDescription?.setPosition(
      panelDescription.x,
      panelDescription.y,
    );
    this.usePowerButton?.setPosition(useButton.x, useButton.y);
    this.usePowerButtonText?.setPosition(useButton.x, useButton.y);
  }

  private createPowerUpHud(): void {
    const makeSlot = (index: 0 | 1): PowerUpSlotVisual => {
      const card = this.add
        .rectangle(0, 0, 132, 56, 0xffffff, 0.12)
        .setStrokeStyle(1.5, 0xffffff, 0.28)
        .setScrollFactor(0)
        .setScale(1 / this.cameras.main.zoom)
        .setDepth(30)
        .setInteractive({ useHandCursor: true });
      const icon = this.add
        .text(0, 0, "·", {
          fontFamily: "monospace",
          fontSize: "20px",
          color: "#f3f8fd",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setScale(1 / this.cameras.main.zoom)
        .setDepth(31);
      const name = this.add
        .text(0, 0, "EMPTY", {
          fontFamily: "monospace",
          fontSize: "12px",
          color: "#edf4fb",
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setScale(1 / this.cameras.main.zoom)
        .setDepth(31);
      const slot = this.add
        .text(0, 0, `SLOT ${index + 1}`, {
          fontFamily: "monospace",
          fontSize: "9px",
          color: "#dfeaf1",
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setScale(1 / this.cameras.main.zoom)
        .setDepth(31);
      card.on("pointerdown", () => {
        if (!this.localInventory[index]) {
          this.selectedPowerSlot = null;
        } else {
          this.selectedPowerSlot = index;
        }
        this.refreshPowerUpHud();
      });
      this.powerUpSlots[index] = { card, icon, name, slot };
      return this.powerUpSlots[index]!;
    };
    makeSlot(0);
    makeSlot(1);
    this.powerUpPanel = this.add
      .rectangle(0, 0, 276, 96, 0xffffff, 0.12)
      .setStrokeStyle(1.5, 0xffffff, 0.32)
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(29)
      .setVisible(false);
    this.powerUpPanelIcon = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "18px",
        color: "#ffd166",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(31)
      .setVisible(false);
    this.powerUpPanelName = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "12px",
        color: "#ffd166",
      })
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(31)
      .setVisible(false);
    this.powerUpPanelDescription = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#d7e1e8",
        wordWrap: { width: 185 },
      })
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(31)
      .setVisible(false);
    this.usePowerButton = this.add
      .rectangle(0, 0, 166, 42, 0xffffff, 0.2)
      .setStrokeStyle(1, 0xffffff, 0.28)
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(30)
      .setVisible(false)
      .setInteractive({ useHandCursor: true });
    this.usePowerButtonText = this.add
      .text(0, 0, "USE POWER", {
        fontFamily: "monospace",
        fontSize: "11px",
        color: "#f4f9ff",
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setScale(1 / this.cameras.main.zoom)
      .setDepth(31)
      .setVisible(false);
    this.usePowerButton.on("pointerdown", () => {
      if (
        this.selectedPowerSlot === null ||
        this.pendingPowerActivation ||
        this.localRespawning ||
        this.localFinished
      )
        return;
      const slot = this.selectedPowerSlot;
      const before = JSON.stringify(this.localInventory);
      if (this.context.sendPowerUp(this.context.race.raceId, slot)) {
        this.pendingPowerActivation = { slot, before, at: performance.now() };
        this.refreshPowerUpHud();
      }
    });
  }

  private refreshPowerUpHud(): void {
    this.powerUpSlots.forEach((visual, index) => {
      const type = this.localInventory[index];
      if (!visual) return;
      const occupied = Boolean(type);
      const selected = this.selectedPowerSlot === index;
      visual.card
        .setVisible(occupied)
        .setFillStyle(selected ? 0xffffff : 0xffffff, selected ? 0.22 : 0.12)
        .setStrokeStyle(
          1.5,
          selected ? 0xffffff : 0xffffff,
          selected ? 0.45 : 0.28,
        );
      visual.icon
        .setVisible(occupied)
        .setText(type ? POWER_UP_DETAILS[type].icon : "·");
      const color = type ? POWER_UP_DETAILS[type].color : 0x718492;
      visual.icon.setColor(
        occupied ? `#${color.toString(16).padStart(6, "0")}` : "#718492",
      );
      visual.name
        .setVisible(occupied)
        .setText(type ? type.toUpperCase() : "EMPTY");
      visual.name.setColor(occupied ? "#f4f7fb" : "#edf4fb");
      visual.slot
        .setVisible(occupied)
        .setColor(selected ? "#f4f7fb" : "#dfeaf1");
    });
    const selectedType =
      this.selectedPowerSlot === null
        ? undefined
        : this.localInventory[this.selectedPowerSlot];
    const show = Boolean(selectedType);
    for (const object of [
      this.powerUpPanel,
      this.powerUpPanelIcon,
      this.powerUpPanelName,
      this.powerUpPanelDescription,
      this.usePowerButton,
      this.usePowerButtonText,
    ])
      object?.setVisible(show);
    if (selectedType) {
      const detail = POWER_UP_DETAILS[selectedType];
      this.powerUpPanelIcon.setText(detail.icon);
      this.powerUpPanelIcon.setColor(
        `#${detail.color.toString(16).padStart(6, "0")}`,
      );
      this.powerUpPanel.setStrokeStyle(1, detail.color);
      this.powerUpPanelName.setText(
        `${selectedType.toUpperCase()} · SLOT ${(this.selectedPowerSlot ?? 0) + 1}`,
      );
      this.powerUpPanelDescription.setText(detail.description);
      this.usePowerButtonText.setText(
        this.pendingPowerActivation ? "WAITING FOR SERVER" : "USE POWER",
      );
      this.usePowerButton.setFillStyle(
        0xffffff,
        this.pendingPowerActivation ? 0.12 : 0.2,
      );
      this.usePowerButtonText.setColor(
        this.pendingPowerActivation ? "#dfeaf1" : "#f4f9ff",
      );
    }
    this.positionHud();
  }
}
