// Per BR-03 (Phase 13 — Breakfast Redesign, decision
// #232, 2026-10-12): the public `GET
// /api/bookings/breakfast/config` handler. Returns the
// meal catalog + cutoff + instructions for the guest
// Step 2 UI + the future Manage Breakfast page. Cached
// 60s on the server. No auth required (public site
// content). Rate-limited per IP at 60/min.
//
// The handler is a thin read: it loads the
// `settings/breakfastConfig` doc, normalizes it via the
// shared `normalizeBreakfastConfig` helper (which strips
// admin-only fields), and returns the public shape. The
// client uses the same shape `usePublicSiteContent`
// exposes so the Step 2 UI doesn't need a second source
// of truth.
//
// The handler lives in its own file (per the file
// structure rule — one handler per file) and is wired
// into `apiRouter.ts` alongside the other `domain ===
// "bookings" && action === "*"` routes. The 12-function
// Vercel Hobby cap is unchanged — this is a new branch
// in the existing catch-all, not a new Vercel function.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { normalizeBreakfastConfig } from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";

const CACHE_TTL_SECONDS = 60;

// `handleGetBreakfastConfig` is a single-purpose GET
// handler. Caches the response for 60s (matching the
// existing rooms-availability cache window) so a
// multi-render Step 2 page doesn't fan-out to Firestore
// for every dropdown. Falls back to the default disabled
// config on any error (a missing settings doc is the
// "breakfast is off" state per the BR-01 spec).
export async function handleGetBreakfastConfig(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }
  try {
    const snapshot = await adminDb.collection("settings").doc("breakfastConfig").get();
    const source = snapshot.exists ? snapshot.data() : null;
    const normalized = normalizeBreakfastConfig(source);
    res.setHeader("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`);
    return res.status(200).json({ success: true, data: normalized });
  } catch (error: any) {
    // Per W2.13 / decision #101: 503 for transient
    // infrastructure errors so the client retries.
    // Falls through to a generic 500 for everything
    // else (the Step 2 UI renders the disabled state
    // on any error).
    const code = String((error as any)?.code || "");
    const isInfra = code.includes("UNAVAILABLE")
      || code.includes("DEADLINE_EXCEEDED")
      || code.includes("RESOURCE_EXHAUSTED");
    return res.status(isInfra ? 503 : 500).json({
      success: false,
      error: "Failed to load breakfast config."
    });
  }
}
