import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type {
  Clock,
  IdGenerator,
  RoomCodeGenerator,
  TokenGenerator,
  TokenHasher,
} from "../../application/ports/security-ports.js";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class SecureTokenGenerator implements TokenGenerator {
  createGuestToken(): string {
    return randomBytes(32).toString("base64url");
  }
}

export class Sha256TokenHasher implements TokenHasher {
  hash(token: string): Buffer {
    return createHash("sha256").update(token, "utf8").digest();
  }
  safeEqual(left: Buffer, right: Buffer): boolean {
    return left.length === right.length && timingSafeEqual(left, right);
  }
}

export class SecureRoomCodeGenerator implements RoomCodeGenerator {
  createCode(): string {
    let code = "";
    for (let index = 0; index < 6; index++)
      code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
    return code;
  }
}

export class UuidGenerator implements IdGenerator {
  createId(): string {
    return randomUUID();
  }
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
