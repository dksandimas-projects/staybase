// Per PEX-02 (2026-08-01, per CVQ-12 + decision #147): one authoritative
// server-side rule that decides whether a booking occupies inventory.
// Used by every caller that asks "does this booking block the room?".
//
// The rule is intentionally narrow — a booking only occupies a room
// when **all** of these hold:
//   1. Its `status` is in the occupying set
//      (pending / payment-uploaded / payment-confirmed / confirmed /
//      checked-in). `cancelled` and `checked-out` release the room.
//   2. Its `holdExpiresAt` is missing/null (legacy booking) OR is
//      strictly after `now`.
//
// Together those two checks close the gap that motivated PEX:
// `pending` bookings can hold rooms indefinitely today, because
// nothing checked whether the payment was still being waited on.
// After PEX, a `pending` booking whose `holdExpiresAt` is in the past
// does NOT occupy the room — the next booking transaction is free
// to take it, and the same transaction marks the expired hold
// `cancelled` with `cancellationReason: "payment-hold-expired"`.

export const BOOKING_OCCUPYING_STATUSES = [
  "pending",
  "payment-uploaded",
  "payment-confirmed",
  "confirmed",
  "checked-in"
] as const;

export type BookingOccupyingStatus = (typeof BOOKING_OCCUPYING_STATUSES)[number];

export interface OccupancyInput {
  status: string | null | undefined;
  holdExpiresAt?: Date | string | null | undefined;
}

export function isBookingOccupyingRoom(
  booking: OccupancyInput,
  now: Date = new Date()
): boolean {
  if (!booking || !booking.status) return false;
  if (!BOOKING_OCCUPYING_STATUSES.includes(booking.status as BookingOccupyingStatus)) {
    return false;
  }
  // Per PEX-04: a `payment-uploaded` booking is awaiting staff review
  // and is never auto-expired. The deadline only governs the
  // guest-action states (`pending` and rejected-proof `pending`).
  if (booking.status === "payment-uploaded") {
    return true;
  }
  // For `pending`: a snapshotted deadline in the past means the
  // hold has expired and the room is free. A missing deadline
  // (legacy booking) defaults to occupying (the historical
  // behavior, preserved so we don't accidentally free legacy rooms).
  if (booking.status === "pending") {
    const deadline = booking.holdExpiresAt;
    if (!deadline) return true;
    const expiresAt = deadline instanceof Date ? deadline : new Date(deadline);
    if (isNaN(expiresAt.getTime())) return true;
    return expiresAt.getTime() > now.getTime();
  }
  // For `payment-confirmed` / `confirmed` / `checked-in`: the booking
  // is a real reservation and the room is held. The deadline is
  // irrelevant once payment is in (the field is also typically not
  // set on these states — only `pending` bookings carry a deadline).
  return true;
}

// Convenience helper for the call sites that already have the
// snapshotted window in hours. Returns the `holdExpiresAt` for a
// booking being created RIGHT NOW, or `null` if no deadline should
// be set (e.g. payment already uploaded, or staff walk-in).
//
// Per PEX-01: the window is admin-configurable in
// `settings/hotelConfig.paymentHoldWindowHours`. The helper takes
// the window explicitly so the call site reads the config in one
// place (handleCreateBooking / handleCreateWalkin).
export function computeHoldExpiresAt(
  windowHours: number | null | undefined,
  now: Date = new Date()
): Date | null {
  if (!windowHours || windowHours <= 0 || !Number.isFinite(windowHours)) return null;
  const expires = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
  return expires;
}

// Default the admin-configured hold window. 24 hours is the
// documented PEX-01 default; legacy settings without the field (or
// values outside the 1..72h admin-allowed range) hydrate here.
export const DEFAULT_PAYMENT_HOLD_WINDOW_HOURS = 24;
export const MIN_PAYMENT_HOLD_WINDOW_HOURS = 1;
export const MAX_PAYMENT_HOLD_WINDOW_HOURS = 72;

// Per PEX-01: clamp any incoming value to the admin-allowed
// 1..72h range. The admin UI rejects out-of-range at write time,
// but a legacy persisted value (or a hand-edited Firestore doc)
// must not crash the snapshot hydrate. Returns the default if the
// input is not a finite positive number.
export function normalizePaymentHoldWindowHours(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_PAYMENT_HOLD_WINDOW_HOURS;
  const clamped = Math.min(MAX_PAYMENT_HOLD_WINDOW_HOURS, Math.max(MIN_PAYMENT_HOLD_WINDOW_HOURS, Math.floor(value)));
  return clamped;
}

// Per PEX-04 (2026-08-01, per decision #147): the cancellation
// reason string written to the booking doc when the daily cron or
// the in-transaction retirement marks a `pending` hold as expired.
// Pinned by `bookings-create.test.ts` (the in-transaction path) and
// `pex-cleanup-cron.test.ts` (the cron path) so a typo here would
// break both surfaces.
export const EXPIRED_HOLD_CANCELLATION_REASON = "payment-hold-expired";

// Reason string written when a guest re-uploads a proof after a
// staff rejection — the booking returns to `pending` with a fresh
// `holdExpiresAt` stamped from `paymentRejectedAt`. Pinned by the
// same tests as `EXPIRED_HOLD_CANCELLATION_REASON`.
export const PAYMENT_REJECTED_FRESH_DEADLINE_FROM = "paymentRejectedAt";

// Cancellation source discriminator (CRL-02, 2026-08-02).
// "guest" — a guest self-service cancellation through /api/bookings/cancel
//   (the apiRouter only sets req.staff if authenticateStaff succeeded;
//   a non-staff request routes through guestCancelSchema and the lookup
//   branch). No PII is written into `cancelledBy`; we just stamp "guest"
//   so the audit row is legible.
// "staff" — an authenticated staff member through /api/bookings/cancel
//   (req.staff.role is "admin" or "staff"). cancelledBy is the staff UID.
// "system" — a server-initiated cancellation: the PEX-03 in-transaction
//   retirement that fires when a new booking displaces an expired hold,
//   or the PEX-06 daily cron at /api/holds/expire. cancelledBy is the
//   literal "system"; EXPIRED_HOLD_CANCELLATION_REASON is the canonical
//   cancellationReason for this source. Per the CRL-02 spec, the system
//   expiry keeps its reason string — the new `cancellationSource` is a
//   parallel discriminator, not a replacement.
export const CANCELLATION_SOURCES = ["guest", "staff", "system"] as const;
export type CancellationSource = (typeof CANCELLATION_SOURCES)[number];

// Per CRL-03 (2026-08-02): the server-side status matrix that
// authorises a cancellation. Three sets, each pinned here so the
// handler + the email-template switch + future Reports queries all
// key off the same lists.
//
//   GUEST_CANCELLABLE_STATUSES — the pre-arrival statuses a guest
//   can self-service cancel through /api/bookings/cancel. CRL-06
//   expands this from the original pre-payment pair to the complete
//   pre-arrival set because the guest cancel modal now shows the
//   policy-derived financial preview before confirmation. Paid
//   cancellations never issue a refund automatically; the preview
//   explicitly identifies when staff processing remains required.
//
//   STAFF_CANCELLABLE_STATUSES — every pre-arrival status. A staff
//   member can cancel any booking that has not yet checked in.
//   Terminal statuses (checked-in, checked-out, cancelled) are NOT
//   in this set; cancellation is irreversible, so once a guest is
//   on-property or past checkout, the status cannot flip back.
//
//   TERMINAL_CANCELLATION_STATUSES — the two statuses NO path
//   can cancel. `cancelled` is already terminal (idempotent
//   rejection of an already-cancelled booking); `checked-in`
//   has the guest on-property (in-house cancellation is a
//   separate checkout flow, not a cancel).
//
//   `checked-out` is NOT in this set as of MRB-05 PR #2
//   (2026-08-02, per decision #159): the post-settlement
//   cancellation path is now allowed for staff — the booking
//   flips to `cancelled` and a negative `pointsHistory` entry
//   is recorded against the awarding member (the loyalty
//   clawback, MRB open-question Q1). The universal reject is
//   now 2 values, not 3. `checked-out` moved from the
//   universal reject list to the staff-only "cancelable
//   with clawback" list.
export const GUEST_CANCELLABLE_STATUSES = [
  "pending",
  "payment-uploaded",
  "payment-confirmed",
  "confirmed"
] as const;
export type GuestCancellableStatus = (typeof GUEST_CANCELLABLE_STATUSES)[number];

export const STAFF_CANCELLABLE_STATUSES = [
  "pending",
  "payment-uploaded",
  "payment-confirmed",
  "confirmed"
] as const;
export type StaffCancellableStatus = (typeof STAFF_CANCELLABLE_STATUSES)[number];

export const TERMINAL_CANCELLATION_STATUSES = [
  "checked-in",
  "cancelled"
] as const;
export type TerminalCancellationStatus = (typeof TERMINAL_CANCELLATION_STATUSES)[number];
