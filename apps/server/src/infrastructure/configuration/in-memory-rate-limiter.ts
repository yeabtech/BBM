import type { RateLimiter } from "../../application/ports/security-ports.js";

export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): boolean {
    if (!this.windows.has(key) && this.windows.size >= 10_000) {
      for (const [candidate, window] of this.windows)
        if (window.resetAt <= now) this.windows.delete(candidate);
      if (this.windows.size >= 10_000) return false;
    }
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (current.count >= limit) return false;
    current.count += 1;
    return true;
  }
}
