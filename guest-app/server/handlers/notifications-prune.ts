// Per Phase 12 — Notification Center (decision #120):
// Vercel Cron-driven retention job that hard-deletes
// `notifications` docs older than 30 days. Same
// CRON_SECRET auth pattern as the existing janitor sweep
// (`/api/janitor/storage-sweep`) and the check-in reminder
// cron.
//
// Without this, the collection grows linearly forever on
// Blaze — the FLR-03 trap. The job is best-effort: one
// run prunes at most `batchSize` (default 500) docs; Vercel
// fires it daily, and a few thousand rows is well under the
// cap. The bounded `query(limit(batchSize))` keeps the
// per-run Firestore read cost low.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { pruneNotifications } from "../lib/notifications";

function isAuthorizedCronRequest(req: VercelRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const headerSecret = req.headers["x-cron-secret"];
  if (typeof headerSecret === "string" && headerSecret === expected) return true;
  const authHeader = req.headers.authorization;
  if (
    typeof authHeader === "string" &&
    authHeader.startsWith("Bearer ") &&
    authHeader.slice("Bearer ".length) === expected
  ) {
    return true;
  }
  return false;
}

export const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function handleNotificationsPrune(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ success: false, error: "CRON_SECRET is not configured on the server." });
  }

  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized cron request." });
  }

  // Allow a custom maxAgeMs in the body for testing
  // (kept small in production via the 30-day constant).
  const requestedMaxAgeMs = Number(req.body?.maxAgeMs);
  const maxAgeMs = Number.isFinite(requestedMaxAgeMs) && requestedMaxAgeMs > 0
    ? Math.min(requestedMaxAgeMs, NOTIFICATION_RETENTION_MS)
    : NOTIFICATION_RETENTION_MS;
  const requestedBatch = Number(req.body?.batchSize);
  const batchSize = Number.isFinite(requestedBatch) && requestedBatch > 0
    ? Math.min(requestedBatch, 2000)
    : 500;

  try {
    const result = await pruneNotifications(maxAgeMs, batchSize);
    console.log(
      `[notifications-prune] scanned=${result.scanned} deleted=${result.deleted} cutoffIso=${result.cutoffIso}`
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error("Notifications prune failed:", err);
    return res.status(500).json({ success: false, error: "Notifications prune failed." });
  }
}
