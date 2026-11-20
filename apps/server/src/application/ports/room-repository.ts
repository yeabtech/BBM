import type { Room } from "../../domain/entities/room.js";

export interface RoomRepository {
  create(room: Room): Promise<void>;
  findOpenByCode(code: string): Promise<Room | null>;
  findOpenForGuest(guestId: string): Promise<Room | null>;
  mutateByCode(
    code: string,
    change: (room: Room, raceActive: boolean) => void,
  ): Promise<Room>;
  mutateForGuest(guestId: string, change: (room: Room) => void): Promise<Room>;
  save(room: Room): Promise<void>;
  expireDue(
    now: Date,
  ): Promise<Array<{ roomId: string; reason: "expired" | "host_timeout" }>>;
  closeOpenRoomsOnStartup(): Promise<void>;
}

export class RoomCodeCollisionError extends Error {
  constructor() {
    super("Room code collision");
    this.name = "RoomCodeCollisionError";
  }
}
