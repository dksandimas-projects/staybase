// Per IDG (decision #227, 2026-08-20, owner option (a) —
// hard block on dashboard alert only): pure-derivation
// helper that gates the dashboard "Verify and record
// payment" + "Reject payment proof" buttons for any
// `PendingPaymentItem` whose rooms include an unverified
// Senior / PWD discount. The helper sits on the alert
// card and is the source of truth for the gate — the
// "open booking" deep-link CTA + the amber callout + the
// pre-discount `dueAmount` all read from it.
//
// Per VPM-01 (decision #322, 2026-11-19): the gate is now
// enforced on the BOOKING DRAWER's "Verify & Record
// Payment" button as well. The original IDG spec scoped
// the gate to the dashboard alert card, but its stated
// intent — "closes the 'verify money, reject ID later'
// gap" — was defeated by the drawer, which offered the
// same action with no gate at all. The room-level
// primitives (`hasUnverifiedDiscountInRooms` /
// `getDueAmountPreDiscountInRooms`) are what both surfaces
// share; the item-level helpers below are thin wrappers
// kept for the dashboard's existing call sites.
//
// Per `plan/project/ROADMAP.md §IDG-01`:
// - Pure (no React, no Firestore).
// - Takes the already-hydrated `PendingPaymentRoom`
//   shape (FOL-05 declares it; IDG-02 extends it with
//   `discountType` + `discountVerified` +
//   `discountRejected` + `originalTotalPrice`).
// - Returns the strict `boolean` the alert card uses to
//   flip `disabled={…}` + `aria-disabled={…}` on the
//   two payment buttons.
//
// What this module is NOT:
// - NOT a Firestore subscription. The `PendingPaymentItem`
//   is already populated by the FOL-05
//   `pendingPaymentItems` `useMemo`.
// - NOT a render component. The alert card's JSX lives
//   in `DashboardPage.tsx` (IDG-03).
// - NOT a new business rule on the discount itself.
//   Per `plan/docs/GOTCHAS.md §Booking Flow`, discount
//   IDs are still verified at check-in — the IDG gate
//   just extends the rule to money verification.

import type { DiscountType } from "@spark-inn/shared";

/** The discount-eligible room shape (FOL-05's
 *  `PendingPaymentRoom` + IDG-02's 4-field extension).
 *  Declared as a structural type here so the helper has
 *  zero coupling to the `DashboardPage` module — the
 *  admin-app test suite pins the runtime contract, the
 *  dashboard source-text guard pins the wire shape.
 */
export type PendingPaymentRoomLike = {
  bookingId: string;
  roomNumber: string;
  roomType: string;
  totalPrice: number;
  status: string;
  /** One of `"" | "senior" | "pwd"` (the `DiscountType`
   *  union from `shared/types/index.ts:22`). `null` for
   *  rooms without a discount. */
  discountType: DiscountType | null;
  /** ID verification status (FOL-02 mapper stamps it on
   *  every snapshot echo). `null` for non-discounted
   *  rooms OR for legacy docs where the field never
   *  existed pre-FOL-02. */
  discountVerified: boolean | null;
  /** ID rejection status (FOL-02 mapper stamps it on
   *  every snapshot echo). `null` for non-discounted
   *  rooms OR for legacy docs. */
  discountRejected: boolean | null;
  /** Pre-discount total (`null` for non-discounted rooms
   *  + the data-drift fallback when the server forgot to
   *  stamp it). Per IDG-03, the dashboard reads this for
   *  the verify amount so the staff sees the HONEST
   *  amount even if a later ID rejection re-prices the
   *  booking. */
  originalTotalPrice: number | null;
};

/** Minimum surface of `PendingPaymentItem` the helper
 *  reads. We only need `rooms[]` — the `id` /
 *  `publicRef` / `isReservation` fields exist on the
 *  shape but are not consulted here. Declared structurally
 *  to keep the helper decoupled from
 *  `DashboardPage.tsx`'s 17-field `PendingPaymentItem`
 *  type. */
export type PendingPaymentItemLike = {
  id: string;
  publicRef: string;
  isReservation: boolean;
  rooms: PendingPaymentRoomLike[];
};

/** True iff any room in `item.rooms` carries a Senior /
 *  PWD discount that is NEITHER verified NOR rejected.
 *  Used by IDG-03 to flip the alert card's two payment
 *  buttons to `disabled` + `aria-disabled`.
 *
 *  Defensive coercions:
 *  - `discountType === null` → not a discount → not blocking.
 *  - `discountType === ""` → defensive (the empty-string
 *    case in the `DiscountType` union) → not blocking.
 *  - `discountVerified === null` → treated as NOT
 *    verified (the legacy / pre-FOL-02 case).
 *  - `discountRejected === true` → treated as cleared
 *    (DSC-05 reopened the lifecycle; a rejected ID is
 *    not a gate signal — the desk either re-verifies or
 *    applies a different discount via the folio's
 *    `Re-verify ID` button).
 */
export function hasUnverifiedDiscount(item: PendingPaymentItemLike): boolean {
  return hasUnverifiedDiscountInRooms(item.rooms);
}

/**
 * Room-level twin of {@link hasUnverifiedDiscount}.
 *
 * Per VPM-01 (decision #322): the IDG gate was applied to the
 * DASHBOARD's pending-payments card only, so the booking DRAWER's
 * "Verify & Record Payment" button stayed open on a booking whose
 * Senior / PWD ID had never been sighted — the drawer was a
 * one-click bypass of the gate the dashboard enforced. The gate is
 * now enforced on both surfaces, and the drawer has no
 * `PendingPaymentItem` to hand (it works from a selected booking +
 * its reservation siblings), so the room-level function is the
 * primitive both callers share.
 */
export function hasUnverifiedDiscountInRooms(rooms: PendingPaymentRoomLike[]): boolean {
  return (rooms || []).some((room) => isUnverifiedDiscountRoom(room));
}

/**
 * Room-level twin of {@link getDueAmountPreDiscount}.
 */
export function getDueAmountPreDiscountInRooms(rooms: PendingPaymentRoomLike[]): number {
  if (!rooms || rooms.length === 0) return 0;
  let sum = 0;
  for (const room of rooms) {
    const value = isUnverifiedDiscountRoom(room)
      ? room.originalTotalPrice ?? room.totalPrice
      : room.totalPrice;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      sum += numeric;
    }
  }
  return sum;
}

export function isUnverifiedDiscountRoom(room: PendingPaymentRoomLike): boolean {
  if (room.discountType !== "senior" && room.discountType !== "pwd") {
    return false;
  }
  if (room.discountVerified === true) return false;
  if (room.discountRejected === true) return false;
  return true;
}

/** Sum of the due amounts the staff should verify, but
 *  using the PRE-DISCOUNT total for any unverified
 *  Senior / PWD room (so the verify amount is HONEST if
 *  the staff later rejects the ID and the booking
 *  re-prices to `originalTotalPrice`).
 *
 *  Math per room:
 *  - Unverified senior/pwd → `originalTotalPrice ?? totalPrice`
 *    (the `?? totalPrice` is the data-drift fallback
 *    when the server forgot to stamp `originalTotalPrice`).
 *  - Everything else → `totalPrice`.
 *
 *  Coercions:
 *  - `Number.isFinite` filter drops `NaN` / `Infinity` /
 *    `-Infinity` from the sum (data-drift guard).
 *  - Negative results are floored at 0 (a verified
 *    payment could exceed the post-discount totalPrice;
 *    the gate shows `0` rather than a confusing negative).
 *
 *  Returns `0` for an empty `rooms[]` (the gate is
 *  inactive; defensive default).
 */
export function getDueAmountPreDiscount(item: PendingPaymentItemLike): number {
  return getDueAmountPreDiscountInRooms(item.rooms);
}