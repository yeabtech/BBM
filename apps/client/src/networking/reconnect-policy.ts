export const MAX_AUTOMATIC_RECONNECT_ATTEMPTS = 8;

export function reconnectDelayMs(
  attempt: number,
  baseDelayMs = 500,
  maximumDelayMs = 10_000,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  return Math.min(maximumDelayMs, baseDelayMs * 2 ** safeAttempt);
}
