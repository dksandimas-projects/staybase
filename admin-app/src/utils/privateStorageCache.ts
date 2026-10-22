// Per P1-STORAGE-404 (2026-10-22): a pure, testable cache for the
// admin app's private-Storage signed-URL lookups.
//
// WHY this exists.
//
// The janitor's storage sweep (`/api/janitor/storage-sweep` — actually
// scheduled since the dead cron was fixed) deletes orphaned files under
// `bookings/`. A booking keeps its `paymentProofPath` after the file is
// gone, so the admin bookings list asked the API to sign a file that no
// longer existed: **7 × HTTP 404 on every list load**, repeated on
// every render, because only SUCCESSES were cached.
//
// The 404 is the CORRECT answer — the file really is gone. The waste
// was asking again and again. So the MISS needs a cache too.
//
// The rule that matters: **only a 404 is worth remembering.** A 5xx or
// a network error is transient and must be retried; caching it would
// hide a real outage behind a silent blank image for the whole TTL.
//
// This is a plain class with an injectable clock so the behaviour is
// unit-testable without a network or a fake timer.

/** A successful lookup: the signed URL and when it stops being usable. */
interface CacheEntry<T> {
  value: T;
  refreshAfter: number;
}

export class PrivateStoragePathCache {
  private readonly hits = new Map<string, CacheEntry<string>>();
  private readonly misses = new Map<string, CacheEntry<true>>();

  /**
   * @param hitTtlMs   how long a signed URL is reused (the API signs for
   *                    50 minutes; the client refreshes a little sooner).
   * @param missTtlMs  how long a "file is gone" answer is remembered.
   */
  constructor(
    private readonly hitTtlMs: number = 50 * 60 * 1000,
    private readonly missTtlMs: number = 15 * 60 * 1000
  ) {}

  /** The cached URL for `path`, or `null` when there is no live hit. */
  getHit(path: string, now: number = Date.now()): string | null {
    const entry = this.hits.get(path);
    if (!entry) return null;
    if (entry.refreshAfter <= now) {
      this.hits.delete(path);
      return null;
    }
    return entry.value;
  }

  /** True when the last lookup for `path` answered "file not found". */
  isKnownMissing(path: string, now: number = Date.now()): boolean {
    const entry = this.misses.get(path);
    if (!entry) return false;
    if (entry.refreshAfter <= now) {
      this.misses.delete(path);
      return false;
    }
    return true;
  }

  /** Remember a successful lookup. Clears any remembered miss. */
  rememberHit(path: string, url: string, now: number = Date.now()): void {
    this.hits.set(path, { value: url, refreshAfter: now + this.hitTtlMs });
    this.misses.delete(path);
  }

  /**
   * Remember that the file does not exist.
   *
   * Only call this for a 404. A 5xx / network failure must NOT be
   * remembered, or a transient outage would blank every proof image for
   * the whole TTL.
   */
  rememberMiss(path: string, now: number = Date.now()): void {
    this.misses.set(path, { value: true, refreshAfter: now + this.missTtlMs });
  }

  /** Drop every entry (used when the signed-in staff member changes). */
  clear(): void {
    this.hits.clear();
    this.misses.clear();
  }
}
