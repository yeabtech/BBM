import { Guest } from "../../domain/entities/guest.js";
import { DomainError } from "../../domain/errors/domain-error.js";
import type { GuestRepository } from "../ports/guest-repository.js";
import type {
  Clock,
  IdGenerator,
  TokenGenerator,
  TokenHasher,
} from "../ports/security-ports.js";

export class GuestService {
  constructor(
    private readonly guests: GuestRepository,
    private readonly tokens: TokenGenerator,
    private readonly hasher: TokenHasher,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async create(displayName: unknown, ballSkin: unknown) {
    const now = this.clock.now();
    const guest = Guest.create(this.ids.createId(), displayName, ballSkin, now);
    const token = this.tokens.createGuestToken();
    await this.guests.create(guest, this.hasher.hash(token));
    return { guest: publicGuest(guest), token };
  }

  async authenticate(token: unknown): Promise<Guest> {
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new DomainError(
        "INVALID_TOKEN",
        "Guest session is invalid. Create a new guest session.",
      );
    }
    const presentedHash = this.hasher.hash(token);
    const record = await this.guests.findByTokenHash(presentedHash);
    if (!record || !this.hasher.safeEqual(presentedHash, record.tokenHash)) {
      throw new DomainError(
        "INVALID_TOKEN",
        "Guest session is invalid. Create a new guest session.",
      );
    }
    await this.guests.touch(record.guest.id, this.clock.now());
    return record.guest;
  }

  async updatePreferences(
    token: unknown,
    displayName: unknown,
    ballSkin: unknown,
  ) {
    const guest = await this.authenticate(token);
    guest.updatePreferences(displayName, ballSkin, this.clock.now());
    await this.guests.update(guest);
    return publicGuest(guest);
  }

  async getProfile(token: unknown) {
    const guest = await this.authenticate(token);
    return publicGuest(guest);
  }
}

export function publicGuest(guest: Guest) {
  return {
    id: guest.id,
    displayName: guest.displayName,
    color: guest.color,
    ballSkin: guest.ballSkin,
  };
}
