// ATR-08 follow-up (2026-11-21, `plan/features/AUDIT-TRAIL.md`): the
// booking drawer's HISTORY tab — the hook that reads the two
// server-written per-booking audit trails.
//
// WHY A HOOK AND NOT ADMINCONTEXT: the drawer mounts EVERY section
// panel at once (the panels are hidden with CSS, not unmounted), so a
// subscription owned by AdminContext would attach for every staff
// member the moment they open the drawer — even if they never look at
// the history. This hook attaches only when the History section is
// ACTIVE, and it detaches when it is not.
//
// THE TWO TRAILS THIS READS:
//   - `bookings/{id}/breakfastAudit`  (BR-01) — the breakfast trail.
//   - `bookings/{id}/otherAddOnAudit` (BR-12) — the other-add-on trail.
//
// Both are written by the SERVER inside the mutation's own transaction
// (`auditBreakfastOp` / `auditOtherAddOnOp`), so a row cannot be
// forged by a client and cannot drift from the change it records.
//
// WHAT THIS HOOK DOES NOT READ: the incidental-charge ledger. The
// drawer already loads it (and it is RESERVATION-scoped — it reads
// `reservations/{id}/charges` plus every child's charges), so that
// listener is reused rather than reimplemented. A second copy of that
// resolution is exactly the drift this repo keeps paying for.

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import {
  breakfastAuditEvent,
  otherAddOnAuditEvent,
  type BookingHistoryEvent
} from "@spark-inn/shared";
import { auth, db } from "../firebase/config";

export interface UseBookingHistoryResult {
  /** The normalized trail rows, newest first within each trail. */
  events: BookingHistoryEvent[];
  /** `true` until the first snapshot of EACH trail has landed. */
  loading: boolean;
  /** A human-readable failure message, when a listener was denied. */
  error: string | null;
}

export function useBookingHistory(
  bookingId: string | null | undefined,
  enabled = true
): UseBookingHistoryResult {
  const [events, setEvents] = useState<BookingHistoryEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId || !enabled) {
      setEvents([]);
      setLoading(false);
      setError(null);
      return;
    }

    // The skeleton must be up for the WHOLE load — including the token
    // refresh, which can take a beat. Setting `loading` only after the
    // refresh resolved would flash the previous booking's (or the
    // charges-only) timeline for a frame before the trail lands.
    setEvents([]);
    setLoading(true);
    setError(null);

    let cancelled = false;
    let unsubscribeBreakfast: (() => void) | undefined;
    let unsubscribeAddOn: (() => void) | undefined;
    let landed = 0;

    const breakfastRows: BookingHistoryEvent[] = [];
    const addOnRows: BookingHistoryEvent[] = [];

    const emit = () => {
      if (cancelled) return;
      setEvents([...breakfastRows, ...addOnRows]);
      setLoading(landed < 2);
    };

    // Per MRB-15-09 (2026-08-03): force-refresh the ID token BEFORE
    // attaching a staff-gated listener, so the handshake carries the
    // staff `role` claim. Without it, a listener attached right after
    // a claim mint is PERMISSION_DENIED with no useful error — and
    // the surface silently renders empty.
    //
    // Per RPT-01b (2026-10-23): the refresh MUST have a `.catch()`.
    // An unhandled promise rejection is not a `console.error`, so a
    // failed refresh would leave the subscription never created and
    // the history silently empty.
    void auth.currentUser
      ?.getIdToken(true)
      .then(() => {
        if (cancelled) return;

        unsubscribeBreakfast = onSnapshot(
          collection(db, "bookings", bookingId, "breakfastAudit"),
          (snapshot) => {
            if (cancelled) return;
            breakfastRows.length = 0;
            snapshot.docs.forEach((docSnap) => {
              const event = breakfastAuditEvent(docSnap.data(), docSnap.id);
              if (event) breakfastRows.push(event);
            });
            landed = Math.max(landed, 1);
            emit();
          },
          (err) => {
            if (cancelled) return;
            console.error("Error listening to booking breakfast trail:", err);
            setError(
              err?.message || "Could not load the breakfast activity trail."
            );
            landed = 2;
            emit();
          }
        );

        unsubscribeAddOn = onSnapshot(
          collection(db, "bookings", bookingId, "otherAddOnAudit"),
          (snapshot) => {
            if (cancelled) return;
            addOnRows.length = 0;
            snapshot.docs.forEach((docSnap) => {
              const event = otherAddOnAuditEvent(docSnap.data(), docSnap.id);
              if (event) addOnRows.push(event);
            });
            landed = Math.max(landed, 2);
            emit();
          },
          (err) => {
            if (cancelled) return;
            console.error("Error listening to booking add-on trail:", err);
            setError(
              err?.message || "Could not load the add-on activity trail."
            );
            landed = 2;
            emit();
          }
        );
      })
      .catch((refreshError) => {
        if (cancelled) return;
        console.error(
          "Error refreshing auth token before the booking history listener:",
          refreshError
        );
        setError("Your session expired. Reload the page to see the booking history.");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      unsubscribeBreakfast?.();
      unsubscribeAddOn?.();
    };
  }, [bookingId, enabled]);

  return { events, loading, error };
}
