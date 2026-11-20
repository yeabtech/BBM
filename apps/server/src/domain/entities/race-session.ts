export const RACE_STATES = [
  "Waiting",
  "Countdown",
  "InProgress",
  "Finished",
  "Cancelled",
] as const;
export type RaceState = (typeof RACE_STATES)[number];

export const RACE_CANCELLATION_REASONS = [
  "Timeout",
  "HostLeft",
  "RoomExpired",
  "ServerRestart",
] as const;
export type RaceCancellationReason = (typeof RACE_CANCELLATION_REASONS)[number];

export interface RaceSessionSnapshot {
  raceId: string;
  roomId: string;
  revision: number;
  state: RaceState;
  countdownStartedAt: string | null;
  countdownDeadlineAt: string | null;
  officialStartAt: string | null;
  timeoutDeadlineAt: string | null;
  cancellationReason: RaceCancellationReason | null;
  cancelledAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  serverNow: string;
}

export class RaceSession {
  private constructor(
    readonly id: string,
    readonly roomId: string,
    public state: RaceState,
    readonly createdAt: Date,
    public updatedAt: Date,
    public revision: number,
    public countdownStartedAt: Date | null,
    public countdownDeadlineAt: Date | null,
    public officialStartAt: Date | null,
    public timeoutDeadlineAt: Date | null,
    public cancellationReason: RaceCancellationReason | null,
    public cancelledAt: Date | null,
    public finishedAt: Date | null,
  ) {}

  static waiting(id: string, roomId: string, now: Date): RaceSession {
    return new RaceSession(
      id,
      roomId,
      "Waiting",
      now,
      now,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
    );
  }

  static rehydrate(input: {
    id: string;
    roomId: string;
    state: RaceState;
    createdAt: Date;
    updatedAt: Date;
    revision: number;
    countdownStartedAt: Date | null;
    countdownDeadlineAt: Date | null;
    officialStartAt: Date | null;
    timeoutDeadlineAt: Date | null;
    cancellationReason: RaceCancellationReason | null;
    cancelledAt: Date | null;
    finishedAt: Date | null;
  }): RaceSession {
    return new RaceSession(
      input.id,
      input.roomId,
      input.state,
      input.createdAt,
      input.updatedAt,
      input.revision,
      input.countdownStartedAt,
      input.countdownDeadlineAt,
      input.officialStartAt,
      input.timeoutDeadlineAt,
      input.cancellationReason,
      input.cancelledAt,
      input.finishedAt,
    );
  }

  beginCountdown(now: Date, countdownMs: number): void {
    if (this.state !== "Waiting")
      throw new Error(`Cannot start a countdown from ${this.state}.`);
    if (!Number.isInteger(countdownMs) || countdownMs <= 0)
      throw new Error("Countdown duration must be a positive integer.");
    this.state = "Countdown";
    this.countdownStartedAt = now;
    this.countdownDeadlineAt = new Date(now.getTime() + countdownMs);
    this.updatedAt = now;
    this.revision += 1;
  }

  enterProgress(now: Date, timeoutMs: number): boolean {
    if (
      this.state !== "Countdown" ||
      !this.countdownDeadlineAt ||
      now < this.countdownDeadlineAt
    )
      return false;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0)
      throw new Error("Race timeout must be a positive integer.");
    this.state = "InProgress";
    this.officialStartAt = this.countdownDeadlineAt;
    this.timeoutDeadlineAt = new Date(
      this.officialStartAt.getTime() + timeoutMs,
    );
    this.updatedAt = now;
    this.revision += 1;
    return true;
  }

  cancel(reason: RaceCancellationReason, now: Date): boolean {
    if (this.state !== "Countdown" && this.state !== "InProgress") return false;
    if (
      reason === "Timeout" &&
      (this.state !== "InProgress" ||
        !this.timeoutDeadlineAt ||
        now < this.timeoutDeadlineAt)
    )
      return false;
    this.state = "Cancelled";
    this.cancellationReason = reason;
    this.cancelledAt = now;
    this.updatedAt = now;
    this.revision += 1;
    return true;
  }

  cancelIfTimedOut(now: Date): boolean {
    if (
      this.state !== "InProgress" ||
      !this.timeoutDeadlineAt ||
      now < this.timeoutDeadlineAt
    )
      return false;
    return this.cancel("Timeout", now);
  }

  finish(now: Date): boolean {
    if (this.state !== "InProgress") return false;
    this.state = "Finished";
    this.finishedAt = now;
    this.updatedAt = now;
    this.revision += 1;
    return true;
  }

  toSnapshot(serverNow = this.updatedAt): RaceSessionSnapshot {
    return {
      raceId: this.id,
      roomId: this.roomId,
      revision: this.revision,
      state: this.state,
      countdownStartedAt: this.countdownStartedAt?.toISOString() ?? null,
      countdownDeadlineAt: this.countdownDeadlineAt?.toISOString() ?? null,
      officialStartAt: this.officialStartAt?.toISOString() ?? null,
      timeoutDeadlineAt: this.timeoutDeadlineAt?.toISOString() ?? null,
      cancellationReason: this.cancellationReason,
      cancelledAt: this.cancelledAt?.toISOString() ?? null,
      finishedAt: this.finishedAt?.toISOString() ?? null,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      serverNow: serverNow.toISOString(),
    };
  }
}
