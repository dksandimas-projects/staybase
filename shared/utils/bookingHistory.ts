// Per ATR-08 follow-up (2026-11-21, `plan/features/AUDIT-TRAIL.md`): the
// booking drawer's HISTORY tab — the per-booking timeline of WHO changed
// WHAT, and WHEN.
//
// WHY A SHARED MODULE: the timeline is assembled from FIVE sources that
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
//   5. The booking document's `rescheduleHistory[]` — the ROOM CHANGE
//      trail (a room re-assignment or a move / upgrade), added
//      2026-11-21 after the desk reported that a room change did not
//      appear in the drawer's history.
//
// Every one of those five is a DIFFERENT shape with a DIFFERENT
// timestamp field (`occurredAt` / `addedAt` / `checkedInAt` / `at` / …)
// and a DIFFERENT actor field (`actorUid` / `addedBy` / `checkedInBy` /
// `by` / …).
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
  | "charge"
  | "room-change";

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
  /**
   * Money: a charge's amount, or the price delta a room move / extend
   * produced. `null` when the change moved no money (a room override
   * is always `deltaTotalPrice: 0`).
   */
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

/**
 * A staff uid — or `""` when the value is NOT one.
 *
 * The booking document carries three RESERVED literals in its actor
 * fields: `"guest"` (the guest's own action), `"system"` (a
 * server-initiated one) and `"staff"` (a legacy write with no uid).
 * None of them is a uid, and passing one to the staff-name resolver
 * would look up a staff member that does not exist.
 */
function staffUidFrom(value: string): string {
  if (!value) return "";
  if (value === "guest" || value === "system" || value === "staff") return "";
  return value;
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
 * Handles the three shapes the five sources use: a Firestore
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

// ── The five sources ──────────────────────────────────────────────

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
  // Per ATR-09 (2026-11-21): the creator's uid.
  //
  // `createdBy` is the stamp ATR-04 added — "guest" for a public online
  // booking, the staff uid for a desk booking. A LEGACY desk booking
  // (written before ATR-04) has NO `createdBy` at all, so the row
  // rendered the generic "Staff" fallback with no name.
  //
  // For those records the creator is unrecoverable from the booking
  // document, so the BEST-EFFORT fallback is `handledBy` — the last
  // staff member who handled the booking. On a desk booking created and
  // paid at the counter that is the same person; on a booking later
  // touched by another member it is that member. It is a name, and it
  // is the only one the record carries — which is strictly more useful
  // to the desk than "Staff", and no more of a claim than the drawer
  // header's existing "Last updated by" segment.
  const createdActorUid = staffUidFrom(createdBy) || staffUidFrom(asText(data.handledBy));
  push(
    "created",
    "Booking created",
    toIsoTimestamp(data.createdAt),
    createdBy === "guest" ? null : createdActorUid || null,
    createdBy === "guest" ? null : asText(data.createdByName) || null,
    createdBy === "guest" ? "guest" : null
  );

  push(
    "checked-in",
    "Checked in",
    toIsoTimestamp(data.checkedInAt),
    staffUidFrom(asText(data.checkedInBy)) || null,
    asText(data.checkedInByName) || null
  );

  push(
    "checked-out",
    "Checked out",
    toIsoTimestamp(data.checkedOutAt),
    staffUidFrom(asText(data.checkedOutBy)) || null,
    asText(data.checkedOutByName) || null
  );

  const cancelledBy = asText(data.cancelledBy);
  push(
    "cancelled",
    "Booking cancelled",
    toIsoTimestamp(data.cancelledAt),
    staffUidFrom(cancelledBy) || null,
    null,
    cancelledBy === "guest" ? "guest" : cancelledBy === "system" ? "system" : null
  );

  // Per ATR-09 (2026-11-21): the payment verifier.
  //
  // This milestone used to carry NO actor at all, so it ALWAYS rendered
  // the generic "Staff" fallback — the desk could see that a payment was
  // verified but never by whom.
  //
  // `paymentConfirmedBy` is the stamp the server writes in the SAME
  // transaction that stamps `paymentConfirmedAt` (ATR-09): the uid of
  // the staff member who verified the money. It is the exact answer.
  //
  // `handledBy` is the FALLBACK for a legacy booking (one whose payment
  // was verified before ATR-09): the server has always stamped
  // `handledBy` next to `paymentConfirmedAt`, but it is OVERWRITTEN by
  // every later staff action (AUDIT-TRAIL.md §Attribution fields), so it
  // names the last member who handled the booking rather than
  // necessarily the verifier. A name beats "Staff"; the fallback is
  // documented rather than silent.
  push(
    "payment-confirmed",
    "Payment verified",
    toIsoTimestamp(data.paymentConfirmedAt),
    staffUidFrom(asText(data.paymentConfirmedBy)) || staffUidFrom(asText(data.handledBy)) || null,
    asText(data.paymentConfirmedByName) || null
  );

  push(
    "payment-rejected",
    "Payment rejected",
    toIsoTimestamp(data.paymentRejectedAt),
    staffUidFrom(asText(data.paymentRejectedBy)) || null,
    null
  );

  push(
    "special-requests-updated",
    "Updated special requests",
    toIsoTimestamp(data.specialRequestsUpdatedAt),
    staffUidFrom(asText(data.specialRequestsUpdatedBy)) || null,
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
 * `2026-11-20` — the calendar date of a date-ish value.
 *
 * The trail's date fields arrive in TWO shapes: a `yyyy-mm-dd` KEY
 * (the room override path) and a full ISO timestamp (the reschedule
 * path). Both reduce to the same calendar day here, so the History
 * tab never shows a raw timestamp to the desk.
 */
function dateLabel(value: unknown): string {
  const text = asText(value);
  if (!text) return "";
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

/**
 * The actor of a `rescheduleHistory[]` entry.
 *
 * The server writes `req.staff?.uid || req.staff?.email || "staff"`.
 * A UID resolves through the ONE shared staff resolver; an EMAIL is
 * PII and is NOT a uid, so it is DROPPED (the desk sees the generic
 * "Staff" label rather than a colleague's address); the reserved
 * literals ("staff" / "guest" / "system") are not uids either.
 */
function rescheduleActorUid(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  if (text.includes("@")) return null;
  return staffUidFrom(text) || null;
}

/**
 * A `rescheduleHistory[]` entry → one event.
 *
 * WHY THIS SOURCE EXISTS (2026-11-21): the desk reported "I did a
 * room change for the booking, it was not tracked in the history in
 * the booking drawer". The WRITE was always there — the server
 * appends to `booking.rescheduleHistory[]` inside the same
 * transaction that moves the room — but the drawer's History tab
 * merged only FOUR sources, so a room change was invisible there.
 *
 * THIS TRAIL IS THE RIGHT SOURCE (not the `auditLogs` forensic row):
 * it is server-written, it commits atomically with the move, and the
 * FRONT DESK can read it — the audit log is ADMIN-ONLY
 * (`firestore.rules`), so it could never have served the desk.
 *
 * THREE KINDS, because the server distinguishes them:
 *   - `"room"`   — a room override: the SAME dates, a different room,
 *                  and the money deliberately PRESERVED
 *                  (`pricingBasis: "preserved"`, delta 0).
 *   - `"move"`   — a different room AND re-dated stay; the money was
 *                  re-derived.
 *   - `"extend"` — the same room, a later check-out.
 */
export function rescheduleHistoryEvent(
  entry: unknown,
  fallbackId = ""
): BookingHistoryEvent | null {
  if (!entry || typeof entry !== "object") return null;
  const data = entry as Record<string, unknown>;

  const rawKind = asText(data.kind);
  const kind = rawKind === "move" || rawKind === "extend" ? rawKind : "room";

  const fromRoom = asText(data.fromRoomNumber);
  const toRoom = asText(data.toRoomNumber);
  const fromCheckIn = dateLabel(data.fromCheckIn);
  const toCheckIn = dateLabel(data.toCheckIn);
  const fromCheckOut = dateLabel(data.fromCheckOut);
  const toCheckOut = dateLabel(data.toCheckOut);

  const summary =
    kind === "move"
      ? "Moved to another room"
      : kind === "extend"
        ? "Extended stay"
        : "Changed room";

  let subject: string | null = null;
  let note: string | null = null;

  if (kind === "extend") {
    subject =
      fromCheckOut && toCheckOut && fromCheckOut !== toCheckOut
        ? `Check-out ${fromCheckOut} → ${toCheckOut}`
        : toCheckOut
          ? `Check-out ${toCheckOut}`
          : null;
  } else {
    subject =
      fromRoom && toRoom
        ? `Room ${fromRoom} → Room ${toRoom}`
        : toRoom
          ? `Room ${toRoom}`
          : fromRoom
            ? `Room ${fromRoom}`
            : null;
    // A "move" also RE-DATES the stay — that is half of what
    // happened, so it is shown, not dropped.
    const dateParts: string[] = [];
    if (fromCheckIn && toCheckIn && fromCheckIn !== toCheckIn) {
      dateParts.push(`Check-in ${fromCheckIn} → ${toCheckIn}`);
    }
    if (fromCheckOut && toCheckOut && fromCheckOut !== toCheckOut) {
      dateParts.push(`Check-out ${fromCheckOut} → ${toCheckOut}`);
    }
    note = dateParts.length > 0 ? dateParts.join(" · ") : null;
  }

  const delta = asNumber(data.deltaTotalPrice);
  const at = toIsoTimestamp(data.at);

  return {
    id: `reschedule:${kind}:${at ?? ""}:${fallbackId}`,
    kind: "room-change",
    at,
    actorUid: rescheduleActorUid(data.by),
    actorRole: null,
    actorName: null,
    summary,
    subject,
    serviceDate: null,
    guestIndex: null,
    reason: asText(data.reason) || null,
    note,
    // A room override is always `deltaTotalPrice: 0` — showing
    // "₱0" would read as a money movement that did not happen.
    amount: delta !== null && delta !== 0 ? delta : null,
    quantity: null,
    lateChange: false
  };
}

/**
 * The booking document's `rescheduleHistory[]` → events.
 *
 * The array is APPEND-ONLY on the server (every write spreads the
 * existing entries and adds one), so the order in the document IS
 * the order of the changes. The events are still returned
 * newest-first, the same order `mergeBookingHistoryEvents` produces.
 */
export function rescheduleHistoryEvents(booking: unknown): BookingHistoryEvent[] {
  if (!booking || typeof booking !== "object") return [];
  const data = booking as Record<string, unknown>;
  const entries = Array.isArray(data.rescheduleHistory) ? data.rescheduleHistory : [];

  return entries
    .map((entry, index) => rescheduleHistoryEvent(entry, String(index)))
    .filter((event): event is BookingHistoryEvent => Boolean(event))
    .sort((a, b) => {
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
