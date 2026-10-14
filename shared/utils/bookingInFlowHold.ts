// In-flow hold helpers for the public booking flow.
//
// Per the in-flow-hold decision (see plan/docs/DECISIONS-FEATURES.md
// for the entry that lands with this commit): the booking flow's
// Steps 2 and 3 show a live countdown banner to the guest
// ("Your room is held for you until {time} · {MM:SS} left"). The
// hold starts when the guest clicks "Continue to Step 2" on
// Step 1, runs for `IN_FLOW_HOLD_MINUTES` (15 by default), and
// is the UX signal — NOT a hard inventory lock. The authoritative
// double-booking guarantee remains the Firestore transaction in
// /api/bookings/create; the in-flow hold is honest about this in
// its copy and in its server semantics (a `bookingHolds/{id}` doc
// with `status: "active" + expiresAt` in the future does NOT
// remove the room from the public availability query — two
// guests can both have an active hold for the same room; the
// transaction picks the first one to commit and the other gets
// a "Room no longer available" error).
//
// Why a dedicated ephemeral collection (not a field on
// `reservations/{id}`): the reservation header doesn't exist
// until the booking transaction commits (MRB-01 stamps it
// inside `handleCreateBooking`). Pre-creating the header on the
// Step 1 → Step 2 transition would force MRB-01 to handle a
// "draft" stage that downstream readers would have to ignore.
// A separate `bookingHolds/{id}` collection keeps the hold
// lifecycle (start → consume OR expire) isolated from the
// reservation/booking lifecycle, and the Janitor / cron can
// sweep stale holds without touching real reservations.

export const IN_FLOW_HOLD_MINUTES = 15;
export const MIN_IN_FLOW_HOLD_MINUTES = 5;
export const MAX_IN_FLOW_HOLD_MINUTES = 30;
// Per the IFH-01.2 (settings-routing) follow-up: the
// `settings/hotelConfig.inFlowHoldMinutes` field is the
// per-hotel source of truth. The constant above is the
// fallback for legacy settings (no field) and the
// hand-edit-Firestore case. Mirrors the
// `DEFAULT_PAYMENT_HOLD_WINDOW_HOURS` pattern from
// `shared/utils/bookingOccupancy.ts` (PEX-01).
export const DEFAULT_IN_FLOW_HOLD_MINUTES = IN_FLOW_HOLD_MINUTES;

export const IN_FLOW_HOLD_STATUSES = ["active", "consumed", "expired"] as const;
export type InFlowHoldStatus = (typeof IN_FLOW_HOLD_STATUSES)[number];

// Per IMT-04 (2026-10-14, `plan/project/ROADMAP.md §IMT`): how many
// times one `bookingHolds/{id}` may be extended before the CTA
// disappears. The bound exists to keep unauthenticated doc lifetime
// finite — it is emphatically NOT an inventory protection. An in-flow
// hold is a soft UX signal that neither the public availability query
// nor the booking transaction consults, so extending one can never
// deny a room to another guest. The only thing worth capping is how
// long a doc can sit in `"active"` before the daily Janitor sweep is
// allowed to tombstone it.
//
// With `MAX_IN_FLOW_HOLD_MINUTES = 30`, the worst case is 3 x 30 =
// ~2h of banner lifetime for one hold id.
//
// Owner answer pending (CVQ-01) — the working default stands if no
// answer arrives before implementation.
export const MAX_IN_FLOW_HOLD_EXTENSIONS = 3;

// Per IMT-04: the two statuses an extend may act on. `"consumed"`
// is deliberately ABSENT — a hold linked to a committed booking must
// never be resurrectable, or a stale `?hold=` link could revive a
// completed attempt. Anything outside this list (including a
// hand-edited or corrupt status) is denied — fail-closed, consistent
// with the narrow-by-default posture of the Firestore rules that keep
// `bookingHolds` unreadable from clients.
export const IN_FLOW_HOLD_EXTENSION_STATUSES = ["active", "expired"] as const;
export type InFlowHoldExtensionStatus =
  (typeof IN_FLOW_HOLD_EXTENSION_STATUSES)[number];

export interface InFlowHoldInput {
  status: string | null | undefined;
  expiresAt: Date | string | null | undefined;
}

export function isInFlowHoldActive(
  hold: InFlowHoldInput,
  now: Date = new Date()
): boolean {
  if (!hold || hold.status !== "active") return false;
  if (!hold.expiresAt) return false;
  const expiresAt =
    hold.expiresAt instanceof Date
      ? hold.expiresAt
      : new Date(hold.expiresAt);
  if (isNaN(expiresAt.getTime())) return false;
  return expiresAt.getTime() > now.getTime();
}

export function computeInFlowHoldExpiresAt(
  minutes: number | null | undefined,
  now: Date = new Date()
): Date | null {
  if (
    !Number.isFinite(Number(minutes)) ||
    !minutes ||
    minutes <= 0
  ) {
    return null;
  }
  return new Date(now.getTime() + Number(minutes) * 60 * 1000);
}

// Per IMT-04 (2026-10-14): the single place the extension window
// arithmetic lives, so the server is the only authority on what an
// extend does to the deadline.
//
// ADDITIVE from the later of `now` and the current deadline, not a
// reset from `now`:
//   * hold still active (13:30 left of a 15-min window) -> base is
//     the current deadline, so the guest KEEPS the 13:30 they had
//     and gains a full window on top.
//   * hold already expired -> the base is `now`, so the guest gets a
//     full fresh window instead of being pushed 1 second forward.
//
// A reset-from-now would silently destroy the remaining time of an
// actively-ticking hold, which is the opposite of "I need more time".
// CVQ-02 carries the guest-visible wording question; this is the
// mechanism either way.
//
// A missing / unparseable `currentExpiresAt` (a hand-edited doc) is
// treated as "no remaining time" rather than trusted.
export function computeExtendedInFlowHoldExpiresAt(
  minutes: number | null | undefined,
  currentExpiresAt: Date | string | null | undefined,
  now: Date = new Date()
): Date | null {
  let base = now;
  if (currentExpiresAt) {
    const parsed =
      currentExpiresAt instanceof Date
        ? currentExpiresAt
        : new Date(currentExpiresAt);
    if (!isNaN(parsed.getTime()) && parsed.getTime() > now.getTime()) {
      base = parsed;
    }
  }
  return computeInFlowHoldExpiresAt(minutes, base);
}

export interface InFlowHoldExtensionInput {
  status: string | null | undefined;
  extensionCount?: number | null | undefined;
}

// Per IMT-04: server-side gate for "may this hold be extended?".
// Mirrors `isInFlowHoldActive`'s shape so the two read the same way
// at their call sites.
//
// Deliberately takes NO `now` parameter: the only two gates are the
// status and the counter, and neither depends on the clock. Note that
// an EXPIRED hold IS extendable — that is the literal "I need more
// time" moment, and reviving it is safe precisely because the hold is
// soft (see the `MAX_IN_FLOW_HOLD_EXTENSIONS` note above). The
// countdown is not auto-revived on a passive re-entry though: revival
// always requires an explicit call to the extend endpoint. See
// `plan/docs/GOTCHAS.md §Booking Flow` (never auto-revive) and the
// IMT-01 pins in `guest-app/tests/api/in-flow-hold.test.ts`.
export function canExtendInFlowHold(
  hold: InFlowHoldExtensionInput | null | undefined
): boolean {
  if (!hold) return false;
  if (
    !(IN_FLOW_HOLD_EXTENSION_STATUSES as readonly string[]).includes(
      String(hold.status)
    )
  ) {
    return false;
  }
  const count = Number(hold.extensionCount ?? 0);
  // A non-finite / negative counter is a hand-edited doc — fail
  // closed rather than treating it as 0 and handing out extensions.
  if (!Number.isFinite(count) || count < 0) return false;
  return count < MAX_IN_FLOW_HOLD_EXTENSIONS;
}

// Per the IFH-01.2 (settings-routing) follow-up:
// clamps any incoming value to the admin-allowed
// 5..30 minute range. The Settings UI rejects out-of-range
// at write time, but a legacy persisted value (or a
// hand-edited Firestore doc) must not crash the
// snapshot hydrate. Returns the default if the input is
// not a finite positive number. Mirrors the
// `normalizePaymentHoldWindowHours` pattern from
// `shared/utils/bookingOccupancy.ts` (PEX-01).
export function normalizeInFlowHoldMinutes(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_IN_FLOW_HOLD_MINUTES;
  const clamped = Math.min(
    MAX_IN_FLOW_HOLD_MINUTES,
    Math.max(MIN_IN_FLOW_HOLD_MINUTES, Math.floor(value))
  );
  return clamped;
}

// Per the IFH-01.3 (Settings UI editor) follow-up:
// reusable integer-clamp helper that the Settings page
// uses to validate both `paymentHoldWindowHours` (1..72)
// and `inFlowHoldMinutes` (5..30) at the input layer
// (mirrors the server-side normalize helpers so the
// client's "Save" button is disabled when the value is
// out of range, hand-typed, or non-finite). Returns
// `null` when the value is invalid so the UI can render
// the field's error state without falling back to the
// default (the default is a server-side concern — the
// client should NOT silently rewrite the operator's
// input to a "safe" value, that hides typos).
export function clampIntegerInRange(
  raw: unknown,
  min: number,
  max: number
): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const floored = Math.floor(value);
  if (floored < min || floored > max) return null;
  return floored;
}

// UUIDv4 shape used for `holdId` — the client preallocates
// before the API call so a retry-after-uncertain-response can
// re-use the same id (mirrors the `reservationId` pattern from
// MRB-02).
export const HOLD_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function generateHoldId(): string {
  // Node 18+ + Vite/browsers expose `crypto.randomUUID`. We
  // also accept a manual fallback in case the runtime is exotic
  // (e.g. an older edge function).
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC 4122 v4 fallback — sufficient entropy for an opaque
  // hold id. Not cryptographic-grade; the id is non-secret.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
