// Per BF-50 (booking-flow audit 2026-06-26): the booking
// form pre-allocates a Firestore doc id client-side and
// uploads images to `bookings/{id}/{discount-id|payment-
// proof}/...` as the user fills the form. If the user
// navigates away without submitting, the Storage subfolder
// is orphaned. This handler runs as a Vercel Cron job (see
// `vercel.json`) to clean those orphans up.
//
// Auth: the request must carry a `x-cron-secret` header
// (or `Authorization: Bearer <CRON_SECRET>`) matching the
// server's `CRON_SECRET` env var. Vercel sets that header
// on every cron invocation.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sweepBookingsStorage, recordSweepResult, getSweepHistory } from "@spark-inn/shared";
import { adminDb, adminStorage } from "../lib/firebase-admin";

function getDefaultBucket(): string | undefined {
  // Read at call time so tests can set the env var in
  // `beforeEach` before invoking the handler.
  return process.env.FIREBASE_STORAGE_BUCKET;
}

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

export async function handleJanitorStorageSweep(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res
      .status(405)
      .json({ success: false, error: "Method not allowed." });
  }

  if (!process.env.CRON_SECRET) {
    return res.status(500).json({
      success: false,
      error: "CRON_SECRET is not configured on the server."
    });
  }

  if (!isAuthorizedCronRequest(req)) {
    return res
      .status(401)
      .json({ success: false, error: "Unauthorized cron request." });
  }

  try {
    const bucketName =
      (typeof req.body?.bucket === "string" && req.body.bucket) ||
      getDefaultBucket();
    if (!bucketName) {
      return res.status(500).json({
        success: false,
        error:
          "Storage bucket is not configured (set FIREBASE_STORAGE_BUCKET or pass `bucket` in body)."
      });
    }
    const bucket = adminStorage.bucket(bucketName);

    const pageToken =
      typeof req.body?.pageToken === "string" ? req.body.pageToken : undefined;
    const maxItems = Number(req.body?.maxItems) || 500;
    const dryRun = Boolean(req.body?.dryRun);

    const result = await sweepBookingsStorage({
      bucket,
      db: adminDb,
      prefix: "bookings/",
      maxItems,
      dryRun,
      pageToken
    });

    // Per H5 (hardening batch 2026-06-26): record + log
    // telemetry so ops can see the sweep actually ran and
    // roughly how much orphan data it's chewing through.
    recordSweepResult(result);
    console.log(
      `[janitor] storage-sweep scanned=${result.scanned} deleted=${result.deleted} kept=${result.kept} errors=${result.errors.length} durationMs=${result.durationMs} dryRun=${result.dryRun}`
    );

    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    console.error("Storage janitor sweep failed:", err);
    return res
      .status(500)
      .json({ success: false, error: "Storage sweep failed." });
  }
}

export async function handleJanitorStats(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  if (!process.env.CRON_SECRET) {
    return res.status(500).json({
      success: false,
      error: "CRON_SECRET is not configured on the server."
    });
  }

  if (!isAuthorizedCronRequest(req)) {
    return res
      .status(401)
      .json({ success: false, error: "Unauthorized cron request." });
  }

  const history = getSweepHistory();
  const totalDeleted = history.reduce((acc, h) => acc + h.deleted, 0);
  const totalScanned = history.reduce((acc, h) => acc + h.scanned, 0);
  const totalErrors = history.reduce((acc, h) => acc + h.errors.length, 0);

  return res.status(200).json({
    success: true,
    data: {
      runs: history.length,
      totalScanned,
      totalDeleted,
      totalErrors,
      lastRunAt: history[0]?.at ?? null,
      history
    }
  });
}
