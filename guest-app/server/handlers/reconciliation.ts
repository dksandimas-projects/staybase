// Per H8 (production-readiness audit 2026-10-20): the NIGHTLY money
// reconciliation cron.
//
// WHY THIS EXISTS
// --------------
// The AI browser QA pass recomputed every money figure from the raw
// Firestore documents and found three real defects that no summary card
// had caught — a refund written without a settled status (money already
// paid out in cash reading back as money still owed), other add-ons that
// never reached `revenueAllocation` (so every revenue report
// under-reported), and a `paidAmount` that had gone negative.
//
// Every one of them was found BY RUNNING the reconciliation. Until now it
// only ran when a human remembered to run it. A hotel cannot afford a
// wrong number sitting in the books for a month before anyone looks.
//
// This runs the same arithmetic on a schedule. It is READ-ONLY with
// respect to the money — it never writes a payment, a refund or a
// booking. It writes ONE run report into `reconciliationRuns` and alerts
// the desk ONLY when a check FAILS.
//
// Same CRON_SECRET auth pattern as the existing janitor sweep
// (`/api/janitor/storage-sweep`) and the notification prune
// (`/api/notifications/prune`), and the same `CRON_SECRET` gate: with no
// secret configured the endpoint refuses to run at all.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runReconciliation, recordReconciliationRun } from "../lib/reconciliation";

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

export async function handleReconciliationCron(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  if (!process.env.CRON_SECRET) {
    return res
      .status(500)
      .json({ success: false, error: "CRON_SECRET is not configured on the server." });
  }

  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ success: false, error: "Unauthorized cron request." });
  }

  try {
    const result = await runReconciliation();
    await recordReconciliationRun(result);

    // The run itself SUCCEEDED even when a check failed — a failing check
    // is a FINDING, not a cron error. The cron reports 200 with the
    // findings so Vercel's cron log shows them; the desk is alerted
    // through the notification.
    return res.status(200).json({
      success: true,
      data: {
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        bookingsScanned: result.bookingsScanned,
        passed: result.passed,
        failed: result.failed,
        warned: result.warned,
        findings: result.findings
      }
    });
  } catch (err) {
    console.error("[reconciliation] the run failed:", err);
    return res
      .status(500)
      .json({ success: false, error: "The nightly reconciliation failed to run." });
  }
}
