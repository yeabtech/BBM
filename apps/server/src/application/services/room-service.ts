import type { RoomSnapshot, RoomPlayer } from "@bbm/shared-contracts";
import { DomainError } from "../../domain/errors/domain-error.js";
import {
  Room,
  ROOM_MAX_PLAYERS,
  ROOM_MIN_PLAYERS,
} from "../../domain/entities/room.js";
import type { Guest } from "../../domain/entities/guest.js";
import {
  RoomCodeCollisionError,
  type RoomRepository,
} from "../ports/room-repository.js";
import type {
  Clock,
  IdGenerator,
  RoomCodeGenerator,
} from "../ports/security-ports.js";

const ROOM_IDLE_MS = 30 * 60 * 1000;
export const ROOM_CODE_ATTEMPTS = 5;

export class RoomService {
  constructor(
    private readonly rooms: RoomRepository,
    private readonly codes: RoomCodeGenerator,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly hostGraceMs = 30_000,
    private readonly idleMs = ROOM_IDLE_MS,
  ) {}

  async create(guest: Guest, connectionId: string): Promise<RoomSnapshot> {
    const now = this.clock.now();
    if (await this.rooms.findOpenForGuest(guest.id))
      throw new DomainError(
        "ALREADY_IN_ROOM",
        "Leave your current room before creating another.",
      );
    for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt++) {
      const room = Room.create(
        this.ids.createId(),
        this.codes.createCode(),
        guest,
        connectionId,
        now,
        new Date(now.getTime() + this.idleMs),
      );
      try {
        await this.rooms.create(room);
        return toSnapshot(room, now);
      } catch (error) {
        if (
          error instanceof RoomCodeCollisionError &&
          attempt < ROOM_CODE_ATTEMPTS - 1
        )
          continue;
        if (error instanceof RoomCodeCollisionError)
          throw new DomainError(
            "ROOM_CLOSED",
            "Could not allocate a room code. Please try again.",
          );
        throw error;
      }
    }
    throw new DomainError(
      "ROOM_CLOSED",
      "Could not allocate a room code. Please try again.",
    );
  }

  async join(
    guest: Guest,
    codeInput: string,
    connectionId: string,
  ): Promise<RoomSnapshot> {
    const code = normalizeRoomCode(codeInput);
    const now = this.clock.now();
    if (await this.rooms.findOpenForGuest(guest.id))
      throw new DomainError(
        "ALREADY_IN_ROOM",
        "Leave your current room before joining another.",
      );
    const room = await this.rooms.mutateByCode(code, (target, raceActive) => {
      target.join(
        guest,
        connectionId,
        now,
        new Date(now.getTime() + this.idleMs),
        raceActive,
      );
    });
    return toSnapshot(room, now);
  }

  async reconnect(
    guest: Guest,
    connectionId: string,
  ): Promise<RoomSnapshot | null> {
    const now = this.clock.now();
    const existing = await this.rooms.findOpenForGuest(guest.id);
    if (!existing) return null;
    try {
      const room = await this.rooms.mutateForGuest(guest.id, (target) => {
        target.reconnect(
          guest,
          connectionId,
          now,
          new Date(now.getTime() + this.idleMs),
        );
      });
      return toSnapshot(room, now);
    } catch (error) {
      if (
        error instanceof DomainError &&
        (error.code === "ROOM_CLOSED" || error.code === "NOT_IN_ROOM")
      ) {
        await this.expireDue();
        return null;
      }
      throw error;
    }
  }

  async setReady(
    guestId: string,
    connectionId: string,
    ready: boolean,
  ): Promise<RoomSnapshot> {
    const now = this.clock.now();
    const room = await this.rooms.mutateForGuest(guestId, (target) => {
      target.setReady(
        guestId,
        connectionId,
        ready,
        now,
        new Date(now.getTime() + this.idleMs),
      );
    });
    return toSnapshot(room, now);
  }

  async leave(
    guestId: string,
    connectionId: string,
  ): Promise<{ room: RoomSnapshot; closedReason: string | null }> {
    const now = this.clock.now();
    let closedReason: string | null = null;
    const room = await this.rooms.mutateForGuest(guestId, (target) => {
      closedReason = target.leave(guestId, connectionId, now);
    });
    return { room: toSnapshot(room, now), closedReason };
  }

  async prepare(
    guestId: string,
    connectionId: string,
  ): Promise<{ eligible: boolean; message: string }> {
    const now = this.clock.now();
    const room = await this.rooms.findOpenForGuest(guestId);
    if (!room)
      throw new DomainError("NOT_IN_ROOM", "You are not in an open room.");
    return this.rooms
      .mutateForGuest(guestId, (target) => {
        target.assertCanPrepare(guestId, connectionId, now);
      })
      .then((updated) => ({
        eligible: updated.isReadyToStart(now),
        message: "Room is ready. No race has been started.",
      }));
  }

  async snapshot(guestId: string): Promise<RoomSnapshot> {
    const room = await this.rooms.findOpenForGuest(guestId);
    if (!room)
      throw new DomainError("NOT_IN_ROOM", "You are not in an open room.");
    return toSnapshot(room, this.clock.now());
  }

  async hasOpenRoom(guestId: string): Promise<boolean> {
    return Boolean(await this.rooms.findOpenForGuest(guestId));
  }

  async disconnect(guestId: string, connectionId: string) {
    const now = this.clock.now();
    const existing = await this.rooms.findOpenForGuest(guestId);
    if (!existing) return null;
    let changed = false;
    const room = await this.rooms.mutateForGuest(guestId, (target) => {
      changed = target.disconnect(
        guestId,
        connectionId,
        now,
        this.hostGraceMs,
        new Date(now.getTime() + this.idleMs),
      );
    });
    return changed ? toSnapshot(room, now) : null;
  }

  async markConnected(
    guest: Guest,
    connectionId: string,
  ): Promise<RoomSnapshot | null> {
    return this.reconnect(guest, connectionId);
  }

  async expireDue() {
    return this.rooms.expireDue(this.clock.now());
  }

  async closeRoomsOnStartup() {
    await this.rooms.closeOpenRoomsOnStartup();
  }
}

export function toSnapshot(room: Room, now: Date): RoomSnapshot {
  const players: RoomPlayer[] = room.activeMembers.map((member) => ({
    guestId: member.guestId,
    displayName: member.displayName,
    color: member.color,
    ballSkin: member.ballSkin,
    host: member.guestId === room.hostGuestId,
    connected: member.connected,
    ready: member.ready,
  }));
  const readyPlayers = players.filter((player) => player.connected);
  const canPrepareToStart =
    room.status === "open" &&
    readyPlayers.length >= ROOM_MIN_PLAYERS &&
    readyPlayers.every((player) => player.ready) &&
    now < room.expiresAt;
  return {
    roomId: room.id,
    revision: room.revision,
    code: room.code,
    status: room.status,
    hostGuestId: room.hostGuestId,
    players,
    minPlayers: ROOM_MIN_PLAYERS,
    maxPlayers: ROOM_MAX_PLAYERS,
    canPrepareToStart,
    expiresAt: room.expiresAt.toISOString(),
  };
}

export function normalizeRoomCode(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalized))
    throw new DomainError("ROOM_NOT_FOUND", "Room not found or unavailable.");
  return normalized;
}
