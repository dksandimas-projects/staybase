// Tiny typed localStorage helper for the public site content
// cache (and any future non-sensitive client cache). All
// operations are defensive: missing storage, private mode,
// quota errors, malformed JSON, missing or wrong-typed fields
// — every failure mode returns `null` from reads and silently
// no-ops from writes. The cache is best-effort; the app must
// still work correctly with no cache present (e.g. SSR, Safari
// private mode, disabled storage).

// Per-call storage check (not a module constant) so tests can
// stub `window` / `globalThis.localStorage` between cases.
function storageNotAvailable(): boolean {
  if (typeof window === "undefined") return true;
  if (typeof window.localStorage === "undefined") return true;
  return false;
}

interface CacheEnvelope<T> {
  // Versioned schema. Bump the key suffix in the call sites if
  // you change the cached shape so old entries are ignored.
  fetchedAt: number;
  value: T;
}

export function readCacheWithTtl<T>(key: string, ttlMs: number, now: number = Date.now()): T | null {
  if (storageNotAvailable()) return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // SecurityError in some private modes — treat as no cache.
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Malformed JSON — discard.
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const envelope = parsed as CacheEnvelope<T>;
  if (typeof envelope.fetchedAt !== "number") return null;
  if (now - envelope.fetchedAt > ttlMs) return null;
  return envelope.value ?? null;
}

export function writeCache<T>(key: string, value: T, now: number = Date.now()): void {
  if (storageNotAvailable()) return;
  const envelope: CacheEnvelope<T> = { fetchedAt: now, value };
  try {
    window.localStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // QuotaExceededError, SecurityError (private mode), etc.
    // Best-effort — the next page load will just re-fetch.
  }
}

export function clearCache(key: string): void {
  if (storageNotAvailable()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
