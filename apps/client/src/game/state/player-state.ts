export interface PlayerMovementState {
  horizontalVelocity: number;
  jumpsUsed: number;
}

export interface HorizontalInput {
  readonly axis: -1 | 0 | 1;
  readonly grounded: boolean;
  readonly deltaSeconds: number;
}

export function createPlayerMovementState(): PlayerMovementState {
  return { horizontalVelocity: 0, jumpsUsed: 0 };
}
