// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the staff "mark served" endpoint for other
// add-ons.
//
//   POST /api/bookings/addons/mark-served
//
// Mirrors `handleMarkServed` (BR-05 breakfast) but the
// selection key is `${date}-${addOnId}` (NOT
// `${date}-${guestIndex}` — add-ons are quantity-based).
// BR-12 v1 has no printable kitchen list — the served
// stamp is for the booking-drawer "Served at HH:MM" badge
// + the receipt.
//
// STAFF-Token gated + Turnstile gated at the apiRouter layer.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase-admin";
import {
  OtherAddOnMarkServedSchema,
  parseOtherAddOnSelectionKey,
  // Per OCT-M3 (2026-10-20, decision #291): the shared
  // read-only-booking rule.
  isOtherAddOnBookingMutable,
  OTHER_ADD_ON_READ_ONLY_ERROR,
  type OtherAddOnSelectionEntry
} from "@spark-inn/shared";
import { auditOtherAddOnOp } from "../lib/otherAddOn-selections";

export async function handleMarkServedAddOns(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }
  const parsed = OtherAddOnMarkServedSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Invalid mark-served payload." });
  }
  const { bookingId, selectionKeys } = parsed.data;
  const bookingRef = adminDb.collection("bookings").doc(bookingId);
  const actorUid = (req as any).staff?.uid || "staff";
  const actorRole = ((req as any).staff?.role === "admin" ? "admin" : "front-desk") as
    | "front-desk"
    | "admin";

  let opCode: string | null = null;
  const servedAt = Timestamp.now();

  try {
    await adminDb.runTransaction(async (transaction) => {
      const live = await transaction.get(bookingRef);
      if (!live.exists) {
        opCode = "BOOKING_NOT_FOUND";
        return;
      }
      const liveBooking = live.data() || {};
      // Per OCT-M3 (2026-10-20, decision #291): a closed
      // booking's add-on selections are READ-ONLY. The
      // mark-served endpoint never inspected the booking's
      // status at all, so the front desk could stamp "served"
      // on a checked-out or cancelled booking. The check sits
      // right after the booking read — before any write in this
      // transaction (per GOTCHAS §Firebase "all reads before any
      // writes").
      if (!isOtherAddOnBookingMutable(liveBooking.status)) {
        opCode = "BOOKING_READ_ONLY";
        return;
      }
      const liveSelections: Record<string, OtherAddOnSelectionEntry[]> =
        liveBooking.otherAddOnSelections && typeof liveBooking.otherAddOnSelections === "object"
          ? { ...liveBooking.otherAddOnSelections }
          : {};
      const liveServed: Record<string, unknown> =
        liveBooking.otherAddOnServed && typeof liveBooking.otherAddOnServed === "object"
          ? { ...liveBooking.otherAddOnServed }
          : {};

      const servedSnapshot: Record<string, unknown> = { ...liveServed };
      for (const key of selectionKeys) {
        const parsedKey = parseOtherAddOnSelectionKey(key);
        if (!parsedKey) {
          opCode = `INVALID_KEY:${key}`;
          return;
        }
        const entry = (liveSelections[parsedKey.date] || []).find(
          (e) => e && e.addOnId === parsedKey.addOnId
        );
        if (!entry) {
          opCode = `SERVE_NOT_FOUND:${key}`;
          return;
        }
        servedSnapshot[key] = {
          servedAt,
          servedBy: actorUid
        };
        auditOtherAddOnOp({
          transaction,
          bookingId,
          selectionKey: key,
          action: "mark-served",
          addOnSnapshot: {
            addOnId: entry.addOnId,
            name: entry.nameSnapshot,
            price: entry.priceSnapshot,
            quantity: entry.quantity
          },
          actorUid,
          actorRole,
          reasonOrCutoff: null
        });
      }

      transaction.update(bookingRef, {
        otherAddOnServed: servedSnapshot,
        updatedAt: Timestamp.now()
      });
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: "Failed to mark add-on served." });
  }

  if (opCode) {
    if (opCode.startsWith("SERVE_NOT_FOUND:")) {
      return res.status(404).json({ success: false, error: "Add-on selection not found." });
    }
    if (opCode === "BOOKING_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    // Per OCT-M3 (2026-10-20, decision #291): the read-only
    // booking case gets the same 400 + message the guest path
    // uses (per OTHER-ADD-ONS.md §Edge cases).
    if (opCode === "BOOKING_READ_ONLY") {
      return res.status(400).json({ success: false, error: OTHER_ADD_ON_READ_ONLY_ERROR });
    }
    return res.status(400).json({ success: false, error: "Could not mark add-on served." });
  }

  return res.status(200).json({ success: true });
}