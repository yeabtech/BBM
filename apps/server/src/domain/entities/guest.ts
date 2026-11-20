import {
  colorForBallSkin,
  parseGuestBallSkin,
  parseGuestColor,
  normalizeDisplayName,
  type GuestBallSkin,
  type GuestColor,
} from "../value-objects/guest-profile.js";

export class Guest {
  private constructor(
    readonly id: string,
    public displayName: string,
    public color: GuestColor,
    public ballSkin: GuestBallSkin,
    readonly createdAt: Date,
    public lastSeenAt: Date,
    readonly revokedAt: Date | null = null,
  ) {}

  static create(
    id: string,
    name: unknown,
    ballSkin: unknown,
    now: Date,
  ): Guest {
    const parsedSkin = parseGuestBallSkin(ballSkin);
    return new Guest(
      id,
      normalizeDisplayName(name),
      colorForBallSkin(parsedSkin),
      parsedSkin,
      now,
      now,
    );
  }

  static rehydrate(input: {
    id: string;
    displayName: string;
    color: string;
    ballSkin: string;
    createdAt: Date;
    lastSeenAt: Date;
    revokedAt?: Date | null;
  }): Guest {
    return new Guest(
      input.id,
      normalizeDisplayName(input.displayName),
      parseGuestColor(input.color),
      parseGuestBallSkin(input.ballSkin),
      input.createdAt,
      input.lastSeenAt,
      input.revokedAt ?? null,
    );
  }

  updatePreferences(name: unknown, ballSkin: unknown, now: Date): void {
    const parsedSkin = parseGuestBallSkin(ballSkin);
    this.displayName = normalizeDisplayName(name);
    this.color = colorForBallSkin(parsedSkin);
    this.ballSkin = parsedSkin;
    this.lastSeenAt = now;
  }
}
