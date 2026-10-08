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
