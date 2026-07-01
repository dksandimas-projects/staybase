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
import { sweepBookingsStorage, recordSweepResult, getSweepHistory, runBackfill, generateLookupToken } from "@spark-inn/shared";
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
    // Per S3 (soft batch 2026-06-26): persist the same
    // result to Firestore so cold starts don't lose the
    // history. The `janitor/sweeps` collection is
    // append-only; the stats endpoint aggregates it.
    try {
      await adminDb.collection("janitor").doc("sweeps").collection("history").add({
        ...result,
        at: new Date()
      });
    } catch (persistErr) {
      console.error("Failed to persist janitor sweep result:", persistErr);
    }
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

  // Per S3 (soft batch 2026-06-26): the source of truth
  // is the persisted `janitor/sweeps/history` collection
  // (last 50, sorted desc). The in-memory ring buffer is
  // a warm-instance-only fallback for the brief window
  // before the first Firestore write settles.
  let history: ReadonlyArray<any> = [];
  try {
    const snap = await adminDb
      .collection("janitor")
      .doc("sweeps")
      .collection("history")
      .orderBy("at", "desc")
      .limit(50)
      .get();
    history = snap.docs.map((d) => {
      const data = d.data();
      return {
        ...data,
        at: data.at && typeof data.at.toDate === "function" ? data.at.toDate().getTime() : data.at
      };
    });
  } catch (err) {
    console.error("Failed to read persisted janitor stats, falling back to in-memory:", err);
    history = getSweepHistory();
  }

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

// Per S1 (soft batch 2026-06-26): one-time backfill that
// adds `lookupToken` to every booking doc that was
// created before H2 shipped. Without this, legacy bookings
// return `?ref=X&token=` from the StaysPage link and the
// lookup rejects the empty token. The endpoint is
// resumable — the cursor is persisted in
// `admin/janitor/h2-backfill-cursor` so re-running it
// (manually or via cron) picks up where the previous run
// left off instead of re-scanning the whole collection.

const BACKFILL_CURSOR_DOC = "janitor/h2-backfill-cursor";

async function loadBackfillCursor(): Promise<{ afterId: string | null; totalUpdated: number; runs: number }> {
  const snap = await adminDb.doc(BACKFILL_CURSOR_DOC).get();
  if (!snap.exists) return { afterId: null, totalUpdated: 0, runs: 0 };
  const data = snap.data() || {};
  return {
    afterId: typeof data.afterId === "string" ? data.afterId : null,
    totalUpdated: Number(data.totalUpdated || 0),
    runs: Number(data.runs || 0)
  };
}

async function saveBackfillCursor(state: { afterId: string | null; totalUpdated: number; runs: number }): Promise<void> {
  await adminDb.doc(BACKFILL_CURSOR_DOC).set({
    afterId: state.afterId,
    totalUpdated: state.totalUpdated,
    runs: state.runs,
    updatedAt: new Date()
  });
}

export async function handleH2LookupTokenBackfill(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  if (!process.env.CRON_SECRET) {
    return res.status(500).json({
      success: false,
      error: "CRON_SECRET is not configured on the server."
    });
  }

  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized cron request." });
  }

  try {
    const cursor = await loadBackfillCursor();
    const requestedBatch = Number(req.body?.batchSize) || 500;

    const result = await runBackfill({
      collection: {
        query: async (afterId, limit) => {
          let q: any = adminDb.collection("bookings").orderBy("__name__").limit(limit);
          if (afterId) q = q.startAfter(afterId);
          const snap = await q.get();
          return snap.docs.map((d: any) => ({ id: d.id, data: d.data() }));
        },
        update: async (id, patch) => {
          await adminDb.collection("bookings").doc(id).update(patch);
        }
      },
      needsUpdate: (doc) => {
        const token = doc.data?.lookupToken;
        return typeof token !== "string" || !/^[a-f0-9]{32}$/i.test(token);
      },
      buildPatch: () => ({ lookupToken: generateLookupToken() }),
      batchSize: requestedBatch
    });

    const nextCursor = result.exhausted ? null : result.nextCursor;
    const newState = {
      afterId: nextCursor,
      totalUpdated: cursor.totalUpdated + result.updated,
      runs: cursor.runs + 1
    };
    await saveBackfillCursor(newState);

    console.log(
      `[janitor] h2-lookup-token-backfill scanned=${result.scanned} updated=${result.updated} skipped=${result.skipped} exhausted=${result.exhausted} cumulativeUpdated=${newState.totalUpdated}`
    );

    return res.status(200).json({
      success: true,
      data: {
        ...result,
        cumulativeUpdated: newState.totalUpdated,
        runs: newState.runs,
        cursor: nextCursor
      }
    });
  } catch (err) {
    console.error("H2 lookup-token backfill failed:", err);
    return res.status(500).json({ success: false, error: "Backfill failed." });
  }
}

export async function handleH2BackfillStatus(
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
    return res.status(401).json({ success: false, error: "Unauthorized cron request." });
  }

  const cursor = await loadBackfillCursor();
  return res.status(200).json({
    success: true,
    data: {
      ...cursor,
      completed: cursor.afterId === null && cursor.runs > 0
    }
  });
}
