// Per ATR-08 follow-up (2026-11-21, `plan/features/AUDIT-TRAIL.md`): the
// booking drawer's HISTORY tab — the per-booking timeline of WHO changed
// WHAT, and WHEN.
//
// WHY A SHARED MODULE: the timeline is assembled from FOUR sources that
// each own their own row shape:
//
//   1. `bookings/{id}/breakfastAudit/{rowId}`  — the BR-01 breakfast
//      trail (server-written inside the mutation's transaction).
//   2. `bookings/{id}/otherAddOnAudit/{rowId}` — the BR-12 other-add-on
//      trail (same discipline).
//   3. `bookings/{id}/charges/{rowId}` — the incidental-charge ledger
//      (client-written, but the rules pin `addedBy` to the caller).
//   4. The booking document's own milestone stamps — created / checked
//      in / checked out / cancelled / payment verified / payment
//      rejected / special requests updated.
//
// Every one of those four is a DIFFERENT shape with a DIFFERENT
// timestamp field (`occurredAt` / `addedAt` / `checkedInAt` / …) and a
// DIFFERENT actor field (`actorUid` / `addedBy` / `checkedInBy` / …).
// Normalising them in one place is the whole point: a second copy of
// this mapping is how the three raw-UID surfaces drifted in the first
// place (ATR-05, finding 9).
//
// WHAT IT IS NOT: this is NOT the ATR-02 forensic trail. The booking
// MUTATIONS (confirm / cancel / reschedule / payment verify / discount
// verify) do not write event rows yet — ATR-02 is still open. This
// module shows the events that EXIST, and says so plainly rather than
// implying a completeness it does not have.
//
// WHY PURE: the admin app has no component-test harness (no
// @testing-library/react), so the logic lives here where it can be
// unit-tested for real — `shared/__tests__/booking-history.test.ts`.

import { parseBreakfastSlotKey } from "./breakfastSlotKey";
import { parseOtherAddOnSelectionKey } from "./otherAddOnTotal";
import { staffNameFor } from "./staffNames";

/**
 * Who performed the change.
 *
 * `"guest"` is a first-class value, not a fallback: the guest's own
 * Manage-Breakfast save writes a `breakfastAudit` row with
 * `actorRole: "guest"`, so the trail can answer "did the GUEST change
 * this, or the desk?" — which is exactly the question the desk asks.
 */
export type BookingHistoryActorRole = "guest" | "front-desk" | "admin" | "system";

/** The kind of change an event represents. */
export type BookingHistoryEventKind =
  | "created"
  | "checked-in"
  | "checked-out"
  | "cancelled"
  | "payment-confirmed"
  | "payment-rejected"
  | "special-requests-updated"
  | "breakfast-change"
  | "add-on-change"
  | "charge";

/**
 * ONE normalized event, whatever it came from.
 *
 * `at` is an ISO string (or `null` when the source row carries no
 * usable timestamp). Everything else is optional because the four
 * sources are genuinely ragged: a charge has no service date, a
 * breakfast row has no money amount, a milestone has no subject.
 */
export interface BookingHistoryEvent {
  /** Stable key for React lists — unique within one booking's timeline. */
  id: string;
  kind: BookingHistoryEventKind;
  /** ISO timestamp of the change, or `null` when unknown. */
  at: string | null;
  /** The actor's uid, when the source row carries one. */
  actorUid: string | null;
  /** The actor's role, when the source row carries one. */
  actorRole: BookingHistoryActorRole | null;
  /** The actor's DISPLAY NAME snapshotted at write time, when present. */
  actorName: string | null;
  /** One-line, human-readable description of WHAT happened. */
  summary: string;
  /** The item the change applied to (a meal name, an add-on name, a charge label). */
  subject: string | null;
  /** The service date the change applies to (`yyyy-mm-dd`). */
  serviceDate: string | null;
  /** The guest index the change applies to (breakfast slots are per guest). */
  guestIndex: number | null;
  /** The writer's free-text reason, when the source row carries one. */
  reason: string | null;
  /** A free-text note (a charge's note). */
  note: string | null;
  /** Money, for charge events. */
  amount: number | null;
  /** Quantity, for add-on events. */
  quantity: number | null;
  /** `true` when the change landed after the cut-off window. */
  lateChange: boolean;
}

// ── Coercion helpers (defensive — a malformed row is ignored, never fatal) ──

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * Normalize any timestamp-ish value to an ISO string.
 *
 * Handles the three shapes the four sources use: a Firestore
 * `Timestamp` (an object with a `toDate()`), a JS `Date`, and an ISO
 * string (what the admin mapper's `parseDateTimeString` produces).
 * Returns `null` for anything unusable — an event with no usable time
 * sorts last rather than pretending to be "now".
 */
export function toIsoTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === "function") {
      const date = candidate.toDate();
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function asActorRole(value: unknown): BookingHistoryActorRole | null {
  const text = asText(value);
  if (text === "guest" || text === "front-desk" || text === "admin" || text === "system") {
    return text;
  }
  return null;
}

// ── The four sources ──────────────────────────────────────────────

/**
 * A `breakfastAudit` row → one event.
 *
 * The BR-01 breakfast trail is written by the SERVER inside the
 * mutation's own transaction (`auditBreakfastOp` in
 * `guest-app/server/lib/breakfast-selections.ts`), so the row cannot
 * be forged by a client and cannot drift from the change it records.
 */
export function breakfastAuditEvent(row: unknown, fallbackId = ""): BookingHistoryEvent | null {
  if (!row || typeof row !== "object") return null;
  const data = row as Record<string, unknown>;

  const action = asText(data.action);
  if (!action) return null;

  const slot = parseBreakfastSlotKey(asText(data.slotKey));
  const snapshot = (data.mealSnapshot || null) as { mealName?: string } | null;
  const mealName = asText(snapshot?.mealName) || null;

  const base = action.startsWith("override-") ? action.slice("override-".length) : action;
  const late = action.startsWith("override-");

  const summaries: Record<string, string> = {
    add: "Added breakfast",
    change: "Changed breakfast",
    remove: "Removed breakfast",
    serve: "Marked breakfast served",
    unserve: "Marked breakfast not served"
  };
  const summary = summaries[base];
  if (!summary) return null;

  return {
    id: asText(data.id) || fallbackId,
    kind: "breakfast-change",
    at: toIsoTimestamp(data.occurredAt),
    actorUid: asText(data.actorUid) || null,
    actorRole: asActorRole(data.actorRole),
    actorName: null,
    summary: late ? `${summary} (late change)` : summary,
    subject: mealName,
    serviceDate: slot?.serviceDate ?? null,
    guestIndex: slot ? slot.rawIndex : null,
    reason: asText(data.reason) || null,
    note: null,
    amount: null,
    quantity: null,
    lateChange: Boolean(data.occurredAfterCutoff) || late
  };
}

/**
 * An `otherAddOnAudit` row → one event.
 *
 * Same discipline as the breakfast trail (BR-12): server-written inside
 * the mutation's transaction.
 */
export function otherAddOnAuditEvent(row: unknown, fallbackId = ""): BookingHistoryEvent | null {
  if (!row || typeof row !== "object") return null;
  const data = row as Record<string, unknown>;

  const action = asText(data.action);
  if (!action) return null;

  const key = parseOtherAddOnSelectionKey(asText(data.selectionKey));
  const snapshot = (data.addOnSnapshot || null) as { name?: string; quantity?: number } | null;
  const addOnName = asText(snapshot?.name) || null;
  const quantity = asNumber(snapshot?.quantity);

  const base = action.startsWith("override-") ? action.slice("override-".length) : action;
  const late = action.startsWith("override-");

  const summaries: Record<string, string> = {
    add: "Added add-on",
    change: "Changed add-on",
    remove: "Removed add-on",
    "mark-served": "Marked add-on served"
  };
  const summary = summaries[base];
  if (!summary) return null;

  return {
    id: asText(data.id) || fallbackId,
    kind: "add-on-change",
    at: toIsoTimestamp(data.occurredAt),
    actorUid: asText(data.actorUid) || null,
    actorRole: asActorRole(data.actorRole),
    actorName: null,
    summary: late ? `${summary} (late change)` : summary,
    subject: addOnName,
    serviceDate: key?.date ?? null,
    guestIndex: null,
    reason: asText(data.reason) || null,
    note: null,
    amount: null,
    quantity,
    lateChange: Boolean(data.occurredAfterCutoff) || late
  };
}

/**
 * An incidental-charge row → one event.
 *
 * A charge is a money movement, so it is BOTH a ledger entry and an
 * activity record. The rules pin `addedBy` to the caller, so the actor
 * is trustworthy.
 */
export function incidentalChargeEvent(row: unknown, fallbackId = ""): BookingHistoryEvent | null {
  if (!row || typeof row !== "object") return null;
  const data = row as Record<string, unknown>;

  const label = asText(data.label) || "Incidental charge";
  const amount = asNumber(data.amount);
  const isReversal = Boolean(asText(data.voidOf));

  return {
    id: asText(data.id) || fallbackId,
    kind: "charge",
    at: toIsoTimestamp(data.addedAt),
    actorUid: asText(data.addedBy) || null,
    actorRole: null,
    actorName: null,
    summary: isReversal ? "Reversed a charge" : "Added an incidental charge",
    subject: label,
    serviceDate: null,
    guestIndex: null,
    reason: null,
    note: asText(data.note) || null,
    amount,
    quantity: null,
    lateChange: false
  };
}

/**
 * The booking document's own milestone stamps → events.
 *
 * These are the ATR-04 attribution fields plus the pre-existing
 * lifecycle stamps. They are NOT event rows — they are the CURRENT
 * state of each milestone — so each one is rendered as the single
 * moment it records rather than as a sequence.
 *
 * A milestone with no timestamp is DROPPED: the drawer header's
 * provenance line already shows who created / checked in / checked out
 * the booking, and a timeline row with no time would be a lie about
 * when it happened.
 */
export function bookingMilestoneEvents(booking: unknown): BookingHistoryEvent[] {
  if (!booking || typeof booking !== "object") return [];
  const data = booking as Record<string, unknown>;
  const events: BookingHistoryEvent[] = [];

  const push = (
    kind: BookingHistoryEventKind,
    summary: string,
    at: string | null,
    actorUid: string | null,
    actorName: string | null,
    actorRole: BookingHistoryActorRole | null = null
  ) => {
    if (!at) return;
    events.push({
      id: `${kind}:${at}`,
      kind,
      at,
      actorUid,
      actorRole,
      actorName,
      summary,
      subject: null,
      serviceDate: null,
      guestIndex: null,
      reason: null,
      note: null,
      amount: null,
      quantity: null,
      lateChange: false
    });
  };

  const createdBy = asText(data.createdBy);
  push(
    "created",
    "Booking created",
    toIsoTimestamp(data.createdAt),
    createdBy || null,
    asText(data.createdByName) || null,
    createdBy === "guest" ? "guest" : null
  );

  push(
    "checked-in",
    "Checked in",
    toIsoTimestamp(data.checkedInAt),
    asText(data.checkedInBy) || null,
    asText(data.checkedInByName) || null
  );

  push(
    "checked-out",
    "Checked out",
    toIsoTimestamp(data.checkedOutAt),
    asText(data.checkedOutBy) || null,
    asText(data.checkedOutByName) || null
  );

  const cancelledBy = asText(data.cancelledBy);
  push(
    "cancelled",
    "Booking cancelled",
    toIsoTimestamp(data.cancelledAt),
    cancelledBy || null,
    null,
    cancelledBy === "guest" ? "guest" : cancelledBy === "system" ? "system" : null
  );

  push(
    "payment-confirmed",
    "Payment verified",
    toIsoTimestamp(data.paymentConfirmedAt),
    null,
    null
  );

  push(
    "payment-rejected",
    "Payment rejected",
    toIsoTimestamp(data.paymentRejectedAt),
    asText(data.paymentRejectedBy) || null,
    null
  );

  push(
    "special-requests-updated",
    "Updated special requests",
    toIsoTimestamp(data.specialRequestsUpdatedAt),
    asText(data.specialRequestsUpdatedBy) || null,
    null
  );

  // Newest-first, the same order `mergeBookingHistoryEvents` produces —
  // so a caller that uses this builder on its own gets a timeline, not
  // an arbitrary push order.
  return events.sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    return b.at.localeCompare(a.at);
  });
}

/**
 * Merge several event groups into ONE reverse-chronological timeline.
 *
 * Newest first — the question a desk asks ("what just happened?") is
 * answered by the top of the list, and the older rows stay reachable
 * by scrolling.
 *
 * Events with no usable timestamp sort LAST (a timeline that puts an
 * undated row at the top would be worse than useless — it would read
 * as "the most recent thing that happened"). Within the same
 * millisecond, the order is stable by input order, so the caller
 * controls the tie-break.
 */
export function mergeBookingHistoryEvents(
  ...groups: Array<Array<BookingHistoryEvent>>
): BookingHistoryEvent[] {
  const merged = groups.flat().filter((event): event is BookingHistoryEvent => Boolean(event));
  return merged.sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    return b.at.localeCompare(a.at);
  });
}

/**
 * The display name for an event's actor.
 *
 * Resolution order:
 *   1. the role's own label for a NON-STAFF actor — "Guest" / "System";
 *   2. the write-time name snapshot (it survives a rename or a
 *      deleted account, which is why the ATR rows carry one);
 *   3. the uid resolved through the ONE shared resolver;
 *   4. "Staff" as the last resort — NEVER a raw uid.
 *
 * A raw 28-character uid on a staff-facing surface tells a front-desk
 * user nothing (GOTCHAS §Security & PII).
 */
export function bookingHistoryActorLabel(
  event: BookingHistoryEvent,
  staffNameMap: Map<string, string>,
  fallback = "Staff"
): string {
  if (event.actorRole === "guest") return "Guest";
  if (event.actorRole === "system") return "System";
  if (event.actorName) return event.actorName;
  if (event.actorUid) {
    const resolved = staffNameFor(staffNameMap, event.actorUid, "");
    if (resolved) return resolved;
  }
  return fallback;
}
