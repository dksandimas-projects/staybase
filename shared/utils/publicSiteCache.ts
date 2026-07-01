// Cross-tab cache invalidation for the public site content hook.
//
// The admin app (different Vite app, different origin port) and the
// guest app share localStorage on the same browser. The admin app
// calls `bustPublicSiteContentCache()` after every successful save
// to `settings/websiteContent` or `settings/hotelConfig`. The guest
// hook subscribes via `subscribeToPublicSiteContentBust(onBust)`;
// the `storage` event fires in every other tab when the bust key
// changes, the hook drops its in-memory + localStorage cache and
// refetches from Firestore. Within ~200 ms an admin can edit a
// hero eyebrow on `localhost:5174` and watch it update on
// `localhost:5173` without a manual refresh.
//
// Cross-device (admin on desktop, public site on phone) still falls
// back to the 5-minute TTL — that's an acceptable demo tradeoff and
// keeps returning visitors fast.

import { PUBLIC_SITE_CONTENT_CACHE_BUST_KEY, PUBLIC_SITE_CONTENT_CACHE_KEY } from "../constants";
import { clearCache } from "./cache";

// Bump the bust key. Safe to call from any tab — the `storage`
// event is only delivered to OTHER tabs, so the caller's own
// localStorage write is the no-op side effect.
export function bustPublicSiteContentCache(now: number = Date.now()): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    window.localStorage.setItem(PUBLIC_SITE_CONTENT_CACHE_BUST_KEY, String(now));
  } catch {
    // QuotaExceeded / SecurityError / Safari private mode — best effort.
  }
}

// Read the current bust timestamp, or 0 if the key has never been
// written. Exposed so the hook can decide whether to refetch on
// mount when the cached value is older than the last bust.
export function readPublicSiteContentBustTimestamp(): number {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(PUBLIC_SITE_CONTENT_CACHE_BUST_KEY);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

// Subscribe to bust events from other tabs. Returns an
// unsubscribe function — the hook should call it in the
// `useEffect` cleanup so the listener doesn't leak.
export function subscribeToPublicSiteContentBust(onBust: (bustedAt: number) => void): () => void {
  if (typeof window === "undefined") return () => {};
  function handler(e: StorageEvent) {
    if (e.key !== PUBLIC_SITE_CONTENT_CACHE_BUST_KEY) return;
    const ts = e.newValue ? Number.parseInt(e.newValue, 10) : 0;
    // Drop the local cache before calling back so the refetch
    // path always starts from "no cache".
    clearCache(PUBLIC_SITE_CONTENT_CACHE_KEY);
    onBust(Number.isFinite(ts) ? ts : Date.now());
  }
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
