// Per S2 (soft batch 2026-06-26): consecutive-404 backoff
// for the booking-lookup endpoint. The booking-ref +
// booking-token pair is a 64-bit key space per day
// (post-H3 sequence width), so even with Turnstile + a
// 10/min rate limit a determined attacker with a proxy
// pool can grind ~14,400 attempts/day. The backoff adds a
// second layer: after 3 consecutive 404s from the same
// IP, the IP is parked in a 1-hour cooldown. A single
// successful lookup clears the counter.
//
// The cache is in-memory (same as the existing
// `isRateLimited` helper) which is fine for a single
// Vercel function instance. In production with warm
// instances this holds across requests; cold starts reset
// the cache. A determined attacker with the right timing
// could exploit a cold start to reset their counter, but
// that requires hitting the exact cold-start window AND
// being within the first 3 attempts of the new instance
// — low PoR, accepted trade-off for the simplicity of
// not standing up a Redis layer.

export interface FailureRecord {
  count: number;
  resetTime: number;
}

export interface FailureBackoffState {
  /** Read the failure record for an IP (or null if missing / expired). */
  get(ip: string): FailureRecord | null;
  /** Increment the counter; returns the new count. */
  record(ip: string, windowMs: number, now?: number): number;
  /** Drop the counter. */
  clear(ip: string): void;
  /** Returns true when the IP has burned through the threshold. */
  isInBackoff(ip: string, threshold: number, now?: number): boolean;
}

export function createFailureBackoffState(): FailureBackoffState {
  const cache = new Map<string, FailureRecord>();
  const clock = (now?: number) => now ?? Date.now();
  return {
    get: (ip) => cache.get(ip) ?? null,
    record: (ip, windowMs, now) => {
      const t = clock(now);
      const existing = cache.get(ip);
      if (!existing || t > existing.resetTime) {
        const next: FailureRecord = { count: 1, resetTime: t + windowMs };
        cache.set(ip, next);
        return next.count;
      }
      existing.count += 1;
      return existing.count;
    },
    clear: (ip) => {
      cache.delete(ip);
    },
    isInBackoff: (ip, threshold, now) => {
      const t = clock(now);
      const existing = cache.get(ip);
      if (!existing) return false;
      if (t > existing.resetTime) {
        cache.delete(ip);
        return false;
      }
      return existing.count >= threshold;
    }
  };
}
