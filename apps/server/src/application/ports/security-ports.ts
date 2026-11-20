export interface TokenGenerator {
  createGuestToken(): string;
}
export interface TokenHasher {
  hash(token: string): Buffer;
  safeEqual(left: Buffer, right: Buffer): boolean;
}
export interface RoomCodeGenerator {
  createCode(): string;
}
export interface IdGenerator {
  createId(): string;
}
export interface Clock {
  now(): Date;
}
export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number, now?: number): boolean;
}
