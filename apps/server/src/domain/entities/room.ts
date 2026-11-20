import { DomainError } from "../errors/domain-error.js";
import type { Guest } from "./guest.js";
import type {
  GuestBallSkin,
  GuestColor,
} from "../value-objects/guest-profile.js";

export const ROOM_MIN_PLAYERS = 2 as const;
export const ROOM_MAX_PLAYERS = 3 as const;
export const ROOM_CODE_LENGTH = 6;

export interface RoomMember {
  guestId: string;
  displayName: string;
  color: GuestColor;
  ballSkin: GuestBallSkin;
  ready: boolean;
  connected: boolean;
  connectionId: string | null;
  joinedAt: Date;
  leftAt: Date | null;
}

export type RoomStatus = "open" | "closed" | "expired";
export type RoomCloseReason =
  "host_left" | "expired" | "empty" | "host_timeout";

export class Room {
  private constructor(
    readonly id: string,
    readonly code: string,
    readonly hostGuestId: string,
    readonly createdAt: Date,
    public expiresAt: Date,
    public status: RoomStatus,
    public hostDisconnectedUntil: Date | null,
    readonly members: RoomMember[],
    public revision: number,
  ) {}

  static create(
    id: string,
    code: string,
    host: Guest,
    connectionId: string,
    now: Date,
    expiresAt: Date,
  ): Room {
    return new Room(
      id,
      code,
      host.id,
      now,
      expiresAt,
      "open",
      null,
      [
        {
          guestId: host.id,
          displayName: host.displayName,
          color: host.color,
          ballSkin: host.ballSkin,
          ready: false,
          connected: true,
          connectionId,
          joinedAt: now,
          leftAt: null,
        },
      ],
      0,
    );
  }

  static rehydrate(input: {
    id: string;
    code: string;
    hostGuestId: string;
    createdAt: Date;
    expiresAt: Date;
    status: RoomStatus;
    hostDisconnectedUntil: Date | null;
    members: RoomMember[];
    revision: number;
  }): Room {
    return new Room(
      input.id,
      input.code,
      input.hostGuestId,
      input.createdAt,
      input.expiresAt,
      input.status,
      input.hostDisconnectedUntil,
      input.members,
      input.revision,
    );
  }

  join(
    guest: Guest,
    connectionId: string,
    now: Date,
    expiresAt: Date,
    raceActive = false,
  ): void {
    this.assertOpen(now);
    if (raceActive)
      throw new DomainError(
        "ROOM_RACE_ACTIVE",
        "This room cannot accept new players after its race countdown begins.",
      );
    if (
      this.members.some(
        (member) => member.guestId === guest.id && member.leftAt === null,
      )
    ) {
      throw new DomainError("ALREADY_IN_ROOM", "You are already in this room.");
    }
    if (this.activeMembers.length >= ROOM_MAX_PLAYERS)
      throw new DomainError("ROOM_FULL", "This room is full.");
    this.members.push({
      guestId: guest.id,
      displayName: guest.displayName,
      color: guest.color,
      ballSkin: guest.ballSkin,
      ready: false,
      connected: true,
      connectionId,
      joinedAt: now,
      leftAt: null,
    });
    this.expiresAt = expiresAt;
  }

  reconnect(
    guest: Guest,
    connectionId: string,
    now: Date,
    expiresAt: Date,
  ): void {
    this.assertOpen(now);
    const member = this.activeMember(guest.id);
    member.displayName = guest.displayName;
    member.color = guest.color;
    member.ballSkin = guest.ballSkin;
    member.connected = true;
    member.connectionId = connectionId;
    member.ready = false;
    if (guest.id === this.hostGuestId) this.hostDisconnectedUntil = null;
    this.expiresAt = expiresAt;
  }

  updateMemberProfile(
    guestId: string,
    displayName: string,
    color: GuestColor,
    ballSkin: GuestBallSkin,
    expiresAt: Date,
  ): void {
    const member = this.activeMember(guestId);
    member.displayName = displayName;
    member.color = color;
    member.ballSkin = ballSkin;
    this.expiresAt = expiresAt;
  }

  disconnect(
    guestId: string,
    connectionId: string,
    now: Date,
    graceMs: number,
    expiresAt: Date,
  ): boolean {
    const member = this.members.find(
      (candidate) => candidate.guestId === guestId && candidate.leftAt === null,
    );
    if (!member || !member.connected || member.connectionId !== connectionId)
      return false;
    member.connected = false;
    member.ready = false;
    member.connectionId = null;
    this.expiresAt = expiresAt;
    if (guestId === this.hostGuestId)
      this.hostDisconnectedUntil = new Date(now.getTime() + graceMs);
    return true;
  }

  setReady(
    guestId: string,
    connectionId: string,
    ready: boolean,
    now: Date,
    expiresAt: Date,
  ): void {
    this.assertOpen(now);
    const member = this.activeMember(guestId);
    this.assertCurrentConnection(member, connectionId);
    member.ready = ready;
    this.expiresAt = expiresAt;
  }

  leave(
    guestId: string,
    connectionId: string,
    now: Date,
  ): RoomCloseReason | null {
    const member = this.activeMember(guestId);
    this.assertCurrentConnection(member, connectionId);
    member.leftAt = now;
    member.connected = false;
    member.ready = false;
    member.connectionId = null;
    if (guestId === this.hostGuestId) return this.close("host_left", now);
    if (this.activeMembers.length === 0) return this.close("empty", now);
    return null;
  }

  close(reason: RoomCloseReason, now: Date): RoomCloseReason {
    this.status =
      reason === "expired" || reason === "host_timeout" ? "expired" : "closed";
    this.hostDisconnectedUntil = null;
    for (const member of this.members) {
      if (member.leftAt === null) member.leftAt = now;
      member.connected = false;
      member.ready = false;
      member.connectionId = null;
    }
    return reason;
  }

  isReadyToStart(now: Date): boolean {
    if (this.status !== "open" || now >= this.expiresAt) return false;
    const connected = this.activeMembers.filter((member) => member.connected);
    return (
      connected.length >= ROOM_MIN_PLAYERS &&
      connected.every((member) => member.ready)
    );
  }

  assertCanPrepare(guestId: string, connectionId: string, now: Date): boolean {
    if (guestId !== this.hostGuestId)
      throw new DomainError("NOT_HOST", "Only the host can prepare the room.");
    this.assertCurrentConnection(this.activeMember(guestId), connectionId);
    if (!this.isReadyToStart(now))
      throw new DomainError(
        "NOT_READY",
        "At least two connected players must all be ready.",
      );
    return true;
  }

  assertCanStartRace(guestId: string, connectionId: string, now: Date): void {
    this.assertOpen(now);
    this.assertIsHost(guestId, connectionId);
    if (!this.isReadyToStart(now))
      throw new DomainError(
        "NOT_READY",
        "At least two connected players must all be ready to start a race.",
      );
  }

  assertIsHost(guestId: string, connectionId: string): void {
    if (guestId !== this.hostGuestId)
      throw new DomainError("NOT_HOST", "Only the host can start a race.");
    this.assertCurrentConnection(this.activeMember(guestId), connectionId);
  }

  expireIfNeeded(now: Date): RoomCloseReason | null {
    if (this.status !== "open") return null;
    if (now >= this.expiresAt) return this.close("expired", now);
    if (this.hostDisconnectedUntil && now >= this.hostDisconnectedUntil)
      return this.close("host_timeout", now);
    return null;
  }

  get activeMembers(): RoomMember[] {
    return this.members.filter((member) => member.leftAt === null);
  }

  private activeMember(guestId: string): RoomMember {
    const member = this.members.find(
      (candidate) => candidate.guestId === guestId && candidate.leftAt === null,
    );
    if (!member)
      throw new DomainError(
        "NOT_IN_ROOM",
        "You are not a member of this room.",
      );
    return member;
  }

  private assertCurrentConnection(
    member: RoomMember,
    connectionId: string,
  ): void {
    if (!member.connected || member.connectionId !== connectionId) {
      throw new DomainError(
        "UNAUTHENTICATED",
        "This connection is no longer active.",
      );
    }
  }

  private assertOpen(now: Date): void {
    const expired = this.expireIfNeeded(now);
    if (this.status !== "open" || expired)
      throw new DomainError("ROOM_CLOSED", "This room is closed or expired.");
  }
}
