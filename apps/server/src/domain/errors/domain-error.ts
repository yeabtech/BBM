export type DomainErrorCode =
  | "INVALID_NAME"
  | "INVALID_COLOR"
  | "INVALID_BALL_SKIN"
  | "INVALID_TOKEN"
  | "ROOM_NOT_FOUND"
  | "ROOM_FULL"
  | "ROOM_CLOSED"
  | "ROOM_RACE_ACTIVE"
  | "ALREADY_IN_ROOM"
  | "NOT_IN_ROOM"
  | "NOT_HOST"
  | "NOT_READY"
  | "NOT_IN_RACE"
  | "INVALID_INPUT"
  | "RATE_LIMITED"
  | "UNAUTHENTICATED";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
