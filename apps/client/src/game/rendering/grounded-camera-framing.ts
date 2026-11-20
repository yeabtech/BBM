import Phaser from "phaser";
import { TEST_LEVEL } from "../level/level-config.js";
import {
  cameraScreenPosition,
  cameraScrollForScreenPosition,
} from "./camera-coordinates.js";

export const CAMERA_CONFIG = {
  worldZoom: 0.7,
  horizontal: {
    rightActivation: 0.3,
    rightTarget: 0.33,
    leftActivation: 0.7,
    leftTarget: 0.67,
    maxLookAhead: 150,
    maxLookAheadRatio: 0.08,
    lookAheadVelocity: 0.14,
    normalSmoothing: 7,
    reversalSmoothing: 13,
    lookAheadSmoothing: 6,
    directionDeadband: 24,
  },
  vertical: {
    upActivation: 0.2,
    upTarget: 0.28,
    upRelease: 0.34,
    downActivation: 0.88,
    downTarget: 0.78,
    downRelease: 0.72,
    smoothing: 5,
  },
  initialGroundRatio: 0.74,
  respawnTargetRatio: 0.66,
} as const;

type CameraDirection = -1 | 0 | 1;

/** Client-side camera controller; it never changes the followed actor. */
export class AdaptivePlatformerCamera {
  private width: number;
  private height: number;
  private direction: CameraDirection = 0;
  private trackingHorizontal = false;
  private trackingVertical: "up" | "down" | null = null;
  private lookAhead = 0;
  private lastTargetY: number | null = null;

  constructor(
    private readonly camera: Phaser.Cameras.Scene2D.Camera,
    viewportWidth: number,
    viewportHeight: number,
    startX: number,
  ) {
    this.width = viewportWidth;
    this.height = viewportHeight;
    this.camera.setZoom(CAMERA_CONFIG.worldZoom);
    this.camera.stopFollow();
    this.camera.setRoundPixels(true);
    this.applyBounds();
    this.camera.setScroll(
      this.clampX(
        cameraScrollForScreenPosition(
          startX,
          this.width / 2,
          this.width,
          this.camera.zoom,
        ),
      ),
      this.initialY(),
    );
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applyBounds();
    const targetRatio =
      this.trackingVertical === "up"
        ? CAMERA_CONFIG.vertical.upTarget
        : CAMERA_CONFIG.vertical.downTarget;
    const resizedY =
      this.lastTargetY === null || this.trackingVertical === null
        ? this.initialY()
        : cameraScrollForScreenPosition(
            this.lastTargetY,
            this.height * targetRatio,
            this.height,
            this.camera.zoom,
          );
    this.camera.setScroll(
      this.clampX(this.camera.scrollX),
      this.clampY(resizedY),
    );
  }

  resetToTarget(x: number, y: number): void {
    this.direction = 0;
    this.trackingHorizontal = false;
    this.trackingVertical = null;
    this.lookAhead = 0;
    this.lastTargetY = y;
    this.camera.scrollX = this.clampX(
      cameraScrollForScreenPosition(
        x,
        this.width / 2,
        this.width,
        this.camera.zoom,
      ),
    );
    this.camera.scrollY = this.clampY(
      cameraScrollForScreenPosition(
        y,
        this.height * CAMERA_CONFIG.respawnTargetRatio,
        this.height,
        this.camera.zoom,
      ),
    );
  }

  update(x: number, y: number, velocityX: number, deltaMs: number): void {
    const dt = Math.min(deltaMs / 1000, 0.05);
    const c = CAMERA_CONFIG.horizontal;
    let nextDirection: CameraDirection = 0;
    if (velocityX > c.directionDeadband) nextDirection = 1;
    else if (velocityX < -c.directionDeadband) nextDirection = -1;
    const reversed =
      nextDirection !== 0 &&
      this.direction !== 0 &&
      nextDirection !== this.direction;
    if (nextDirection !== 0 && nextDirection !== this.direction) {
      this.direction = nextDirection;
      this.trackingHorizontal = false;
    }

    const currentScreenX = cameraScreenPosition(
      x,
      this.camera.scrollX,
      this.width,
      this.camera.zoom,
    );
    const left = this.width * c.leftActivation;
    const right = this.width * c.rightActivation;
    if (this.direction === 1 && currentScreenX >= right)
      this.trackingHorizontal = true;
    if (this.direction === -1 && currentScreenX <= left)
      this.trackingHorizontal = true;

    const maxLookAhead = Math.min(
      c.maxLookAhead,
      (this.width * c.maxLookAheadRatio) / this.camera.zoom,
    );
    const desiredLookAhead =
      this.direction *
      Math.min(maxLookAhead, Math.abs(velocityX) * c.lookAheadVelocity);
    this.lookAhead = this.lerp(
      this.lookAhead,
      desiredLookAhead,
      this.alpha(c.lookAheadSmoothing, dt),
    );
    if (Math.abs(velocityX) < c.directionDeadband && this.direction !== 0) {
      this.direction = 0;
      this.trackingHorizontal = false;
    }

    if (this.trackingHorizontal && this.direction !== 0) {
      const targetRatio = this.direction > 0 ? c.rightTarget : c.leftTarget;
      const desiredX =
        cameraScrollForScreenPosition(
          x,
          this.width * targetRatio,
          this.width,
          this.camera.zoom,
        ) + this.lookAhead;
      const smoothing = reversed ? c.reversalSmoothing : c.normalSmoothing;
      this.camera.scrollX = this.clampX(
        this.lerp(this.camera.scrollX, desiredX, this.alpha(smoothing, dt)),
      );
    }

    this.updateVertical(y, dt);
  }

  private updateVertical(y: number, dt: number): void {
    this.lastTargetY = y;
    const c = CAMERA_CONFIG.vertical;
    const screenY = cameraScreenPosition(
      y,
      this.camera.scrollY,
      this.height,
      this.camera.zoom,
    );
    const ratio = screenY / this.height;
    if (this.trackingVertical === null) {
      if (ratio < c.upActivation) this.trackingVertical = "up";
      else if (ratio > c.downActivation) this.trackingVertical = "down";
    } else if (this.trackingVertical === "up" && ratio > c.upRelease) {
      this.trackingVertical = null;
    } else if (this.trackingVertical === "down" && ratio < c.downRelease) {
      this.trackingVertical = null;
    }
    if (!this.trackingVertical) return;

    const targetRatio =
      this.trackingVertical === "up" ? c.upTarget : c.downTarget;
    const desiredY = cameraScrollForScreenPosition(
      y,
      this.height * targetRatio,
      this.height,
      this.camera.zoom,
    );
    this.camera.scrollY = this.clampY(
      this.lerp(this.camera.scrollY, desiredY, this.alpha(c.smoothing, dt)),
    );
  }

  private applyBounds(): void {
    this.camera.removeBounds();
  }

  private initialY(): number {
    const ground = TEST_LEVEL.platforms.find((p) => p.kind === "ground")!;
    return cameraScrollForScreenPosition(
      ground.y,
      this.height * CAMERA_CONFIG.initialGroundRatio,
      this.height,
      this.camera.zoom,
    );
  }

  private clampX(value: number): number {
    return Phaser.Math.Clamp(
      value,
      0,
      Math.max(0, TEST_LEVEL.width - this.width / this.camera.zoom),
    );
  }

  private clampY(value: number): number {
    const min = Math.min(
      0,
      this.initialY(),
      -Math.max(this.height / this.camera.zoom, TEST_LEVEL.height),
    );
    const max = Math.max(
      min,
      TEST_LEVEL.height - this.height / this.camera.zoom,
    );
    return Phaser.Math.Clamp(value, min, max);
  }

  private alpha(rate: number, dt: number): number {
    return 1 - Math.exp(-rate * dt);
  }

  private lerp(from: number, to: number, amount: number): number {
    return from + (to - from) * amount;
  }
}
