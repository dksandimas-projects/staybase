// Per PEX-06 (2026-08-01, per decision #147): the daily cleanup
// cron for expired `pending` payment holds. Authoritative path
// for holds that no later booking transaction encountered (a
// guest abandons the booking, never returns, and the hold's
// deadline lapses). The in-transaction retirement at
// `handleCreateBooking` / `handleCreateWalkin` /
// `handleRescheduleBooking` is the *primary* retirement path —
// when the next guest takes the room, the expired hold is
// atomically cancelled as part of that transaction. This cron
// is the *secondary* path for holds nobody claimed.
//
// Auth: the request must carry a `x-cron-secret` header
// (or `Authorization: Bearer <CRON_SECRET>`) matching the
// server's `CRON_SECRET` env var. Vercel sets that header
// on every cron invocation. Same pattern as the janitor /
// storage-sweep cron (per PEX-08's MD sync).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Timestamp } from "firebase-admin/firestore";
import { sendBookingTrigger } from "./email";
import { adminDb } from "../lib/firebase-admin";
import {
  isBookingOccupyingRoom,
  EXPIRED_HOLD_CANCELLATION_REASON
} from "@spark-inn/shared";
// Per CRL-02 (2026-08-02): the cron-driven retirement is a
// server-initiated cancellation, so the audit metadata is
// `cancelledBy: "system"` + `cancellationSource: "system"`.
const SYSTEM_CANCELLATION_SOURCE = "system" as const;

const EXPIRY_BATCH_SIZE = 200;

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

export async function handleHoldExpiryCron(
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

  // Per PEX-06 (2026-08-01, per decision #147): one `now` is
  // captured at the top of the run and threaded into every
  // eligibility check + every per-doc transaction. A Vercel
  // Hobby cron that runs at midnight UTC may straddle a day
  // boundary if the function is slow — the captured `now`
  // means each run reports a consistent deadline.
  const now = new Date();
  // Track every retirement this run performs so the response
  // payload (and the per-doc email) is auditable. Re-fires of
  // the same cron tick (e.g. a manual re-run for ops
  // investigation) are idempotent: a second run finds zero
  // matches because the first run cancelled them all.
  const retirements: Array<{ bookingId: string; bookingRef: string; guestEmail: string; holdExpiresAt: Date | null }> = [];
  const errors: Array<{ bookingId: string; error: string }> = [];

  try {
    // Per PEX-06 (2026-08-01, per decision #147): the
    // Firestore coarse filter is `status == "pending"` plus
    // an `orderBy` on `holdExpiresAt` so the oldest deadlines
    // are retired first (matters at scale). The per-doc
    // eligibility recheck inside the transaction (the
    // `isBookingOccupyingRoom` + `now` test) is the
    // authoritative gate; the coarse filter is a cheap
    // pre-selector. Legacy bookings (no `holdExpiresAt` field
    // at all) are NOT matched by the Firestore query — they
    // occupy indefinitely per `isBookingOccupyingRoom`'s
    // "null deadline = occupies" rule.
    const expiredSnapshot = await adminDb
      .collection("bookings")
      .where("status", "==", "pending")
      .where("holdExpiresAt", "<", Timestamp.fromDate(now))
      .limit(EXPIRY_BATCH_SIZE)
      .get();

    for (const doc of expiredSnapshot.docs) {
      const data = doc.data() || {};
      try {
        const retired = await adminDb.runTransaction(async (transaction) => {
          const freshDoc = await transaction.get(doc.ref);
          if (!freshDoc.exists) return null;
          const freshData = freshDoc.data() || {};
          // Recheck eligibility inside the transaction —
          // a guest may have re-uploaded a proof between
          // the coarse query and this transaction, moving
          // the booking out of `pending` and into
          // `payment-uploaded` (or `confirmed`). The
          // `isBookingOccupyingRoom` + `now` test is the
          // authoritative gate.
          if (!isBookingOccupyingRoom({
            status: freshData.status,
            holdExpiresAt: freshData.holdExpiresAt
          }, now)) {
            return null;
          }
          transaction.update(doc.ref, {
            status: "cancelled",
            cancellationReason: EXPIRED_HOLD_CANCELLATION_REASON,
            // Per CRL-02 (2026-08-02): the cron-driven retirement is
            // a server-initiated cancellation, so the audit metadata
            // is `cancelledBy: "system"` + `cancellationSource: "system"`.
            // Same shape as the in-transaction retirement at the create
            // / walkin / reschedule sites. Reports + emails can switch
            // on either field; the canonical EXPIRED_HOLD_CANCELLATION_REASON
            // is preserved as the reason.
            cancelledBy: SYSTEM_CANCELLATION_SOURCE,
            cancellationSource: SYSTEM_CANCELLATION_SOURCE,
            cancelledAt: now,
            updatedAt: now
          });
          return {
            bookingId: doc.id,
            bookingRef: String(freshData.bookingRef || doc.id),
            guestEmail: String(freshData.guestEmail || ""),
            holdExpiresAt: freshData.holdExpiresAt
              ? (freshData.holdExpiresAt instanceof Date
                ? freshData.holdExpiresAt
                : (typeof freshData.holdExpiresAt.toDate === "function"
                  ? freshData.holdExpiresAt.toDate()
                  : null))
              : null
          };
        });
        if (retired) {
          retirements.push(retired);
        }
      } catch (perDocErr: any) {
        errors.push({ bookingId: doc.id, error: perDocErr.message || "unknown" });
        console.error("[hold-expiry] failed to retire booking", doc.id, perDocErr);
      }
    }

    // Per PEX-05 (2026-08-01, per decision #147): best-effort
    // per-retirement email, sent from outside any transaction.
    // The email template is the same `booking-cancelled` template
    // the guest-facing cancel path uses; the
    // `cancellationReason: payment-hold-expired` field is the
    // discriminator the template uses to switch the headline +
    // rebook CTA.
    for (const retirement of retirements) {
      if (!retirement.guestEmail) continue;
      try {
        await sendBookingTrigger("booking-cancelled", {
          bookingRef: retirement.bookingRef,
          guestEmail: retirement.guestEmail,
          source: "online",
          notes: "Held until " + (retirement.holdExpiresAt ? retirement.holdExpiresAt.toISOString() : "unknown")
            + " — your reservation has been released. Please rebook at /book to choose new dates."
        });
      } catch (emailErr: any) {
        console.error("[hold-expiry] failed to send expiry email for", retirement.bookingRef, emailErr);
        errors.push({ bookingId: retirement.bookingId, error: "email: " + (emailErr.message || "unknown") });
      }
    }

    console.log(
      `[hold-expiry] cron run scanned=${expiredSnapshot.size} retired=${retirements.length} errors=${errors.length} now=${now.toISOString()}`
    );

    return res.status(200).json({
      success: true,
      data: {
        scanned: expiredSnapshot.size,
        retired: retirements.length,
        errors: errors.length,
        retirements: retirements.map((r) => ({ bookingRef: r.bookingRef, guestEmail: r.guestEmail })),
        errorDetails: errors
      }
    });
  } catch (err: any) {
    console.error("[hold-expiry] cron run failed:", err);
    return res
      .status(500)
      .json({ success: false, error: err.message || "Hold expiry cron failed." });
  }
}
