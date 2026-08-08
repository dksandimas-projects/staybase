// Per BAR-03 (2026-08-08, per decision #204): the
// shared FOL-05 sibling-flip helper. The pre-BAR-03
// FOL-05 sibling-flip pass (the per-child `siblingChildBookings`
// pre-read + the `postUpdateChildStatuses` array
// computation + the per-sibling `transaction.update` calls)
// was open-coded in three handlers:
//
//   - `handleVerifyAndRecordPayment` (verify-payment)
//   - `handleAddPayment` (staff-add-payment)
//   - `handleRejectPayment` (payment rejection)
//
// The three copies were byte-equivalent at the per-child
// status flip, but the FOL-05 pattern (pre-read children
// via `where("reservationId", "==", id)`, decide per-child
// whether to flip, queue a `transaction.update` per flip,
// keep the reservation header's `updatedAt` heartbeat) was
// re-implemented three times. FOL-06 (apply-discount) and
// FOL-07 (partial refund) were on the same path: every
// future multi-room action would re-derive the same shape
// of fix.
//
// The helper collapses the three copies into one. Each
// handler passes a per-handler `rule.decide` callback
// (the per-child decision — return a write payload + new
// status, or `null` to skip) and the per-handler
// reservation-scope `now`. The helper:
//
//   1. Pre-reads every child of the reservation (skipping
//      the read for legacy null-`reservationId` bookings).
//   2. Iterates the children, calls `rule.decide` on each,
//      and queues a `transaction.update(bookings/{id}, ...)`
//      for every flip (excluding the target id — the
//      target's own status update stays in the handler
//      because the target's write payload differs from
//      the sibling write payload in every handler).
//   3. Touches the reservation header's `updatedAt` (per
//      BAR-02: no `paymentStatus` mirror write — the
//      aggregate is derived at read time).
//   4. Returns `{ siblingFlippedCount, postUpdateChildStatuses }`
//      so the handler can build its response + (for the
//      verify handler) drive the `fullyPaid` flag.
//
// The helper is server-side only — the Firestore SDK
// types leak into the signature. It lives in
// `guest-app/server/handlers/reservationScopeTransition.ts`
// (a sibling of `bookings.ts`) so the FOL-05 contract is
// owned in one place.
//
// **Behavior preservation** — the helper is a pure
// extraction. The per-handler behavior is byte-equivalent
// to the pre-BAR-03 open-coded FOL-05 pass. The 38 FOL-05
// source-text tests are rewritten to assert (a) the
// helper exists + is called by all 3 handlers, (b) the
// per-handler rule callback is wired correctly, (c) the
// per-handler response shape is unchanged.

import type {
  Firestore,
  QueryDocumentSnapshot,
  Transaction
} from "firebase-admin/firestore";

/**
 * Pre-read every child booking of a reservation. The
 * pre-read is hoisted out of the post-write block per
 * FOL-03 (the Firestore `runTransaction` requires all
 * reads to complete before any writes). For legacy
 * null-`reservationId` bookings (pre-MRB-01) the
 * pre-read is skipped — the empty array is the
 * byte-equivalent legacy signal (every handler treats
 * the empty case as "no flips, skip the header touch").
 *
 * @param transaction The Firestore transaction (read phase)
 * @param adminDb The Firestore instance
 * @param bookingReservationId The reservation id (empty
 *   string for legacy null-`reservationId` bookings)
 * @param map Per-handler mapper from the QueryDocumentSnapshot
 *   to the child shape the handler needs (the verify +
 *   add handlers need `{ id, status, totalPrice }`; the
 *   reject handler needs `{ id, status }`)
 * @returns The mapped children, or `[]` for legacy bookings
 */
export async function preReadSiblingChildren<TChild>(
  transaction: Transaction,
  adminDb: Firestore,
  bookingReservationId: string,
  map: (doc: QueryDocumentSnapshot) => TChild
): Promise<TChild[]> {
  if (bookingReservationId.length === 0) return [];
  const childrenForFlip = await transaction.get(
    adminDb.collection("bookings").where("reservationId", "==", bookingReservationId)
  );
  return childrenForFlip.docs.map(map);
}

/**
 * The per-child decision interface. The handler returns
 * `null` for "no flip" or a `{ write, newStatus }` for
 * "flip this child". The helper queues the per-child
 * `transaction.update` for every non-null return.
 */
export interface SiblingFlipDecision {
  /** The `transaction.update` payload for this child. */
  write: Record<string, unknown>;
  /** The new status after the flip (used for `postUpdateChildStatuses`). */
  newStatus: string;
}

/**
 * The per-handler rule callback. Invoked once per
 * child. Return `null` for "no flip" or a `SiblingFlipDecision`
 * for "flip this child".
 *
 * The rule is hand-rolled per handler because the
 * flip criteria + the write payload differ:
 *
 *   - verify / add: "if the new cumulative reservation
 *     payments cover the child's `totalPrice` AND the
 *     child's current status is `pending` or
 *     `payment-uploaded` → flip to `payment-confirmed`".
 *     Write: `{ status: "payment-confirmed",
 *     paymentConfirmedAt, handledBy, updatedAt }`.
 *
 *   - reject: "if the child's current status is
 *     `payment-uploaded` → flip to `pending`". Write:
 *     `{ status: "pending", paymentRejectionReason,
 *     paymentRejectedAt, paymentRejectedBy,
 *     holdExpiresAt, updatedAt }`.
 */
export type SiblingFlipRule<TChild> = (
  child: TChild
) => SiblingFlipDecision | null;

/**
 * The helper's return value. The handler uses
 * `siblingFlippedCount` for the 200 OK response (the
 * "X more rooms cleared" breadcrumb + the bell
 * notification) and `postUpdateChildStatuses` for the
 * `paymentStatus` aggregate (now derived at read time per
 * BAR-02 — the array is still computed for the
 * helper-side derivation contract + the FOL-05
 * source-text test surface).
 */
export interface SiblingFlipResult {
  /** Number of children that flipped (excludes the target id). */
  siblingFlippedCount: number;
  /** The post-update child statuses — one entry per child, in the same order as the pre-read. */
  postUpdateChildStatuses: string[];
}

/**
 * The shared FOL-05 sibling-flip pass. See the file
 * header for the full contract.
 *
 * @param transaction The Firestore transaction (write phase)
 * @param adminDb The Firestore instance
 * @param bookingReservationId The reservation id (empty
 *   string for legacy null-`reservationId` bookings — the
 *   header touch is skipped for those)
 * @param targetBookingId The target booking id — the helper
 *   never queues a flip for this child (the target's own
 *   status update is the handler's responsibility because
 *   the write payload differs from the sibling write
 *   payload in every handler)
 * @param children The pre-read children (from
 *   `preReadSiblingChildren`)
 * @param rule The per-handler flip rule
 * @param updatedAt The shared `now` (a Firestore Timestamp
 *   or a `Date` — the helper writes it to every flip
 *   payload's `updatedAt` field via the rule, and to the
 *   reservation header's `updatedAt`)
 * @returns The sibling-flip result
 */
export function applyReservationScopePaymentTransition<TChild extends { id: string; status: string }>(
  transaction: Transaction,
  adminDb: Firestore,
  bookingReservationId: string,
  targetBookingId: string,
  children: TChild[],
  rule: SiblingFlipRule<TChild>,
  updatedAt: unknown
): SiblingFlipResult {
  const postUpdateChildStatuses: string[] = [];
  const siblingFlips: Array<{ id: string; fromStatus: string; toStatus: string }> = [];
  for (const child of children) {
    const decision = rule(child);
    const newStatus = decision ? decision.newStatus : child.status;
    postUpdateChildStatuses.push(newStatus);
    if (decision && child.id !== targetBookingId) {
      siblingFlips.push({ id: child.id, fromStatus: child.status, toStatus: newStatus });
      // The rule's `write` payload is the contract —
      // the helper never merges its own fields (the
      // `updatedAt` is in the payload the rule built,
      // the handler's `now` is the same value the
      // header touch uses).
      transaction.update(adminDb.collection("bookings").doc(child.id), decision.write);
    }
  }
  // Per BAR-02 (2026-08-08, per decision #203): the
  // header touch is a heartbeat `updatedAt` only — the
  // `paymentStatus` aggregate mirror is no longer
  // written (consumers derive it at read time). The
  // `bookingReservationId.length > 0` guard skips the
  // touch for legacy null-`reservationId` bookings.
  if (bookingReservationId.length > 0 && children.length > 0) {
    transaction.update(adminDb.collection("reservations").doc(bookingReservationId), { updatedAt });
  }
  return {
    siblingFlippedCount: siblingFlips.length,
    postUpdateChildStatuses
  };
}
