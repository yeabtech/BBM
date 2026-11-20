export interface InputFrame {
  readonly horizontal: -1 | 0 | 1;
  readonly jumpPressed: boolean;
  readonly jumpDown: boolean;
  readonly resetPressed: boolean;
  readonly pausePressed: boolean;
}

export class TouchInputState {
  private readonly leftPointers = new Set<number>();
  private readonly rightPointers = new Set<number>();
  private readonly jumpPointers = new Set<number>();
  private jumpQueued = false;

  press(button: "left" | "right" | "jump", pointerId: number): void {
    if (button === "left") this.leftPointers.add(pointerId);
    else if (button === "right") this.rightPointers.add(pointerId);
    else {
      if (this.jumpPointers.size === 0) this.jumpQueued = true;
      this.jumpPointers.add(pointerId);
    }
  }
  release(pointerId: number): void {
    this.leftPointers.delete(pointerId);
    this.rightPointers.delete(pointerId);
    this.jumpPointers.delete(pointerId);
  }
  clear(): void {
    this.leftPointers.clear();
    this.rightPointers.clear();
    this.jumpPointers.clear();
    this.jumpQueued = false;
  }
  read(): Pick<InputFrame, "horizontal" | "jumpPressed"> {
    const left = this.leftPointers.size > 0;
    const right = this.rightPointers.size > 0;
    const horizontal: -1 | 0 | 1 = left === right ? 0 : left ? -1 : 1;
    const jumpPressed = this.jumpQueued;
    this.jumpQueued = false;
    return { horizontal, jumpPressed };
  }
  isJumpDown(): boolean {
    return this.jumpPointers.size > 0;
  }
}
