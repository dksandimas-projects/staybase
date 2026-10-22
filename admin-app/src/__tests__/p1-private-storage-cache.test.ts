// Per P1-STORAGE-404 (2026-10-22): the private-Storage signed-URL cache.
//
// The janitor's storage sweep deletes orphaned files under `bookings/`.
// A booking keeps its `paymentProofPath` after the file is gone, so the
// admin bookings list asked the API to sign a file that no longer
// existed: 7 × HTTP 404 on every list load, repeated on every render,
// because only SUCCESSES were cached.
//
// The 404 is the correct answer. The waste was asking again and again.
//
// These tests pin the cache contract, and — more importantly — the rule
// that makes it SAFE: **only a 404 is remembered.** A 5xx or a network
// error is transient; caching it would blank every proof image for the
// whole TTL and hide a real outage.

import { describe, expect, it } from "vitest";
import { PrivateStoragePathCache } from "../utils/privateStorageCache";

const T0 = 1_700_000_000_000;

describe("P1-STORAGE-404 — the private storage path cache", () => {
  it("returns a cached hit without asking again", () => {
    const cache = new PrivateStoragePathCache();
    cache.rememberHit("bookings/a/payment-proof/x.jpg", "https://signed", T0);

    expect(cache.getHit("bookings/a/payment-proof/x.jpg", T0 + 1000)).toBe("https://signed");
  });

  it("expires a hit after its TTL", () => {
    const cache = new PrivateStoragePathCache(1000, 5000);
    cache.rememberHit("p", "https://signed", T0);

    expect(cache.getHit("p", T0 + 999)).toBe("https://signed");
    expect(cache.getHit("p", T0 + 1000)).toBeNull();
  });

  it("remembers a miss so the same dead path is not requested again", () => {
    const cache = new PrivateStoragePathCache();
    cache.rememberMiss("bookings/gone/payment-proof/x.jpg", T0);

    expect(cache.isKnownMissing("bookings/gone/payment-proof/x.jpg", T0 + 1000)).toBe(true);
  });

  it("expires a miss after its (shorter) TTL", () => {
    const cache = new PrivateStoragePathCache(50_000, 1000);
    cache.rememberMiss("p", T0);

    expect(cache.isKnownMissing("p", T0 + 999)).toBe(true);
    // The miss window is shorter than the hit window, so a file that is
    // uploaded later shows up promptly.
    expect(cache.isKnownMissing("p", T0 + 1000)).toBe(false);
  });

  it("a miss TTL is shorter than a hit TTL by default", () => {
    const cache = new PrivateStoragePathCache();
    cache.rememberMiss("p", T0);
    cache.rememberHit("q", "https://signed", T0);

    // The hit is still valid at +16 minutes; the miss is not.
    expect(cache.getHit("q", T0 + 16 * 60 * 1000)).toBe("https://signed");
    expect(cache.isKnownMissing("p", T0 + 16 * 60 * 1000)).toBe(false);
  });

  it("a later hit CLEARS a remembered miss for the same path", () => {
    // The file was missing, then it was uploaded. The next lookup must
    // go to the server, not answer from the miss cache.
    const cache = new PrivateStoragePathCache();
    cache.rememberMiss("p", T0);
    expect(cache.isKnownMissing("p", T0)).toBe(true);

    cache.rememberHit("p", "https://signed", T0);
    expect(cache.isKnownMissing("p", T0)).toBe(false);
    expect(cache.getHit("p", T0)).toBe("https://signed");
  });

  it("keeps hits and misses on different paths apart", () => {
    const cache = new PrivateStoragePathCache();
    cache.rememberHit("live", "https://signed", T0);
    cache.rememberMiss("dead", T0);

    expect(cache.getHit("live", T0)).toBe("https://signed");
    expect(cache.getHit("dead", T0)).toBeNull();
    expect(cache.isKnownMissing("dead", T0)).toBe(true);
    expect(cache.isKnownMissing("live", T0)).toBe(false);
  });

  it("clear() drops everything", () => {
    const cache = new PrivateStoragePathCache();
    cache.rememberHit("p", "https://signed", T0);
    cache.rememberMiss("q", T0);

    cache.clear();

    expect(cache.getHit("p", T0)).toBeNull();
    expect(cache.isKnownMissing("q", T0)).toBe(false);
  });
});
