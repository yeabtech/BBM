import Phaser from "phaser";
import { TouchInputState, type InputFrame } from "./input-state.js";

type ControlName = "left" | "right" | "jump";

export class GameInput {
  private readonly touch = new TouchInputState();
  private readonly keyboard: Phaser.Input.Keyboard.KeyboardPlugin | null;
  private readonly keys: Record<string, Phaser.Input.Keyboard.Key> | undefined;
  private readonly detachButtonListeners: Array<() => void> = [];
  private readonly onWindowBlur = () => this.touch.clear();

  constructor(scene: Phaser.Scene, root: HTMLElement) {
    const keyboard = scene.input.keyboard;
    this.keyboard = keyboard;
    if (keyboard) {
      this.keys = keyboard.addKeys({
        left: Phaser.Input.Keyboard.KeyCodes.A,
        leftArrow: Phaser.Input.Keyboard.KeyCodes.LEFT,
        right: Phaser.Input.Keyboard.KeyCodes.D,
        rightArrow: Phaser.Input.Keyboard.KeyCodes.RIGHT,
        jump: Phaser.Input.Keyboard.KeyCodes.SPACE,
        jumpUp: Phaser.Input.Keyboard.KeyCodes.UP,
        reset: Phaser.Input.Keyboard.KeyCodes.R,
        pause: Phaser.Input.Keyboard.KeyCodes.ESC,
      }) as Record<string, Phaser.Input.Keyboard.Key>;
      keyboard.addCapture([
        Phaser.Input.Keyboard.KeyCodes.SPACE,
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
      ]);
    }
    root
      .querySelectorAll<HTMLButtonElement>("[data-control]")
      .forEach((button) => {
        const control = button.dataset.control as ControlName | undefined;
        if (!control || !["left", "right", "jump"].includes(control)) return;
        const down = (event: PointerEvent) => {
          event.preventDefault();
          button.setPointerCapture?.(event.pointerId);
          this.touch.press(control, event.pointerId);
        };
        const up = (event: PointerEvent) => {
          event.preventDefault();
          this.touch.release(event.pointerId);
        };
        button.addEventListener("pointerdown", down);
        button.addEventListener("pointerup", up);
        button.addEventListener("pointercancel", up);
        button.addEventListener("lostpointercapture", up);
        this.detachButtonListeners.push(() => {
          button.removeEventListener("pointerdown", down);
          button.removeEventListener("pointerup", up);
          button.removeEventListener("pointercancel", up);
          button.removeEventListener("lostpointercapture", up);
        });
      });
    window.addEventListener("blur", this.onWindowBlur);
  }

  read(): InputFrame {
    const touch = this.touch.read();
    const left =
      this.isDown("left") || this.isDown("leftArrow") || touch.horizontal < 0;
    const right =
      this.isDown("right") || this.isDown("rightArrow") || touch.horizontal > 0;
    const horizontal: -1 | 0 | 1 = left === right ? 0 : left ? -1 : 1;
    const spaceJump = this.justDown("jump");
    const upJump = this.justDown("jumpUp");
    const jumpDown =
      Boolean(this.keys?.jump?.isDown || this.keys?.jumpUp?.isDown) ||
      this.touch.isJumpDown();
    return {
      horizontal,
      jumpPressed: touch.jumpPressed || spaceJump || upJump,
      jumpDown,
      resetPressed: this.justDown("reset"),
      pausePressed: this.justDown("pause"),
    };
  }
  destroy(): void {
    window.removeEventListener("blur", this.onWindowBlur);
    this.detachButtonListeners.forEach((detach) => detach());
    if (this.keys)
      Object.values(this.keys).forEach((key) => this.keyboard?.removeKey(key));
  }
  private isDown(name: string): boolean {
    return Boolean(this.keys?.[name]?.isDown);
  }
  private justDown(name: string): boolean {
    const key = this.keys?.[name];
    return key ? Phaser.Input.Keyboard.JustDown(key) : false;
  }
}
