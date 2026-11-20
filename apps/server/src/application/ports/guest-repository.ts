import type { Guest } from "../../domain/entities/guest.js";

export interface GuestRepository {
  create(guest: Guest, tokenHash: Buffer): Promise<void>;
  findByTokenHash(
    tokenHash: Buffer,
  ): Promise<{ guest: Guest; tokenHash: Buffer } | null>;
  update(guest: Guest): Promise<void>;
  touch(guestId: string, at: Date): Promise<void>;
}
