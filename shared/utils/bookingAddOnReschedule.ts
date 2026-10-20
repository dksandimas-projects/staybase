// Per OCT-H8 (2026-10-20, decision #288): the pure re-dating /
// auto-cancel logic for a booking whose stay window moved (or was
// cancelled).
//
// THE BUG THIS FIXES
//
// `handleRescheduleBooking` (and the `mode: "extend"` wrapper) and
// `handleCancelBooking` contained ZERO references to
// `breakfastSelections` / `otherAddOnSelections`. The breakfast
// total simply carried forward, and the selection keys kept the
// OLD dates.
//
// The impact: a guest books Oct 14–17 with three paid breakfasts,
// then reschedules to Oct 20–23. `breakfastTotal` carries forward
// (still charged), the selection keys still say `2026-10-14…`, and
// the kitchen list for Oct 20 shows nothing — the guest is charged
// for three breakfasts that are never served.
//
// WHAT THE SPEC REQUIRES
//
// `plan/features/BREAKFAST.md` §Edge cases 2 + 3:
//
//   2. Reschedule — "any `breakfastSelections[date-*]` whose date
//      falls outside the new date range is auto-cancelled; for paid
//      removals, a refund liability is opened; for unpaid removals,
//      the `breakfastTotal` decreases. New dates in the range get a
//      fresh date block in the manage page (the guest can order)."
//
//   3. Cancel — "any unpaid `breakfastSelections` for future dates
//      is dropped; any paid selections for future dates generate
//      refund liabilities with `category: "breakfast"`. Past-date
//      selections are not refunded."
//
// THE MONEY MODEL (why both a charge removal AND a liability)
//
// A removed meal is "paid" when the booking's `paidAmount` covers
// its price — the same test the BR-04 guest-remove path and the
// BR-05 staff-remove path already use (`mealPrice > 0 &&
// paidAmount >= mealPrice`).
//
//   - UNPAID removal → the charge is simply removed. The breakfast
//     total drops, the bill drops, nothing is owed back.
//   - PAID removal → the charge is removed from the bill AND a
//     pending refund liability is opened. The guest's outstanding
//     balance therefore goes NEGATIVE by the meal's price (the
//     hotel owes them that money back), which is exactly what the
//     liability records.
//
// This mirrors BR-04's remove path, where `totalPrice` keeps the
// original charge and the negative refund entry creates the
// credit. The booking-level folio balance is
// `grandTotal − paymentsTotal` and does NOT subtract the pending
// refund, so the two surfaces agree.
//
// The `paidAmount` test is deliberately the same crude heuristic
// the shipped remove paths use — a single source of truth for
// "was this meal paid for?" beats a second, subtler rule that
// would drift from it.
//
// The BR-01 invariant `booking.breakfastTotal ===
// recomputeBreakfastTotal(booking.breakfastSelections)` is
// preserved: the auto-cancelled entries are marked `removedAt`, and
// `recomputeBreakfastTotal` skips removed entries.
//
// The auto-cancelled entries STAY in the map (marked removed) rather
// than being deleted, for two reasons:
//   1. The audit trail survives on the booking doc.
//   2. `assertSlotForAdd` only blocks a slot whose entry is LIVE
//      (`removedAt === null`), so the guest can re-order the same
//      date if the stay is moved back — the BR-04 remove path has
//      the same property.

import type {
  BreakfastSelectionEntry,
  OtherAddOnSelectionEntry
} from "../types/index";
import { recomputeBreakfastTotal } from "./breakfastTotal";
import { recomputeOtherAddOnTotal } from "./otherAddOnTotal";

/**
 * A stay's window. `checkIn` is inclusive, `checkOut` is
 * exclusive — the same shape the booking doc stores.
 */
export interface StayWindow {
  /** The stay's check-in date (`YYYY-MM-DD`), inclusive. */
  checkIn: string;
  /** The stay's check-out date (`YYYY-MM-DD`), exclusive. */
  checkOut: string;
}

/**
 * Which rule decides whether a selection is auto-cancelled.
 *
 * - `"reschedule"` — the selection's service date must fall inside
 *   the NEW window; anything outside is auto-cancelled. Used by
 *   `handleRescheduleBooking` (and the `mode: "extend"` wrapper,
 *   where the window only grows so nothing is ever cancelled).
 * - `"cancel"` — the selection's service date must not be in the
 *   PAST; anything from today onwards is dropped. Past-date
 *   selections are left alone (they were served, or waived) and
 *   are never refunded. Used by `handleCancelBooking`.
 */
export type AddOnRedateMode = "reschedule" | "cancel";

/** One auto-cancelled breakfast selection. */
export interface RemovedBreakfastSelection {
  /** The composite slot key (`yyyy-mm-dd-{slotId}`). */
  key: string;
  /** The service date parsed from the key prefix. */
  serviceDate: string;
  /** The selection entry as it was before the auto-cancel. */
  entry: BreakfastSelectionEntry;
  /** The meal's price — the amount at stake. */
  amount: number;
  /** `true` when the meal was paid for (a refund liability is owed). */
  wasPaid: boolean;
}

/** One auto-cancelled other-add-on selection. */
export interface RemovedOtherAddOnSelection {
  /** The service date (the map key). */
  date: string;
  /** The add-on id. */
  addOnId: string;
  /** The composite selection key (`yyyy-mm-dd-{addOnId}`). */
  selectionKey: string;
  /** The selection entry as it was before the auto-cancel. */
  entry: OtherAddOnSelectionEntry;
  /** The line total (`priceSnapshot × quantity`). */
  amount: number;
  /** `true` when the add-on was paid for (a refund liability is owed). */
  wasPaid: boolean;
}

export interface RedateBreakfastInput {
  /** Which rule decides the auto-cancel. */
  mode: AddOnRedateMode;
  /**
   * The NEW stay window. Only read in `"reschedule"` mode; in
   * `"cancel"` mode the window is irrelevant (the booking is
   * ending, not moving).
   */
  window: StayWindow;
  /** Today's date (`YYYY-MM-DD`) in the hotel timezone. */
  today: string;
  /** The booking's breakfast selections. */
  selections: Record<string, BreakfastSelectionEntry> | null | undefined;
  /** The booking's `paidAmount` — the "was this meal paid for?" test. */
  paidAmount: number;
}

export interface RedateBreakfastResult {
  /**
   * The selections to persist: the survivors plus the
   * auto-cancelled ones marked `removedAt`.
   */
  selections: Record<string, BreakfastSelectionEntry>;
  /** The auto-cancelled selections. */
  removed: RemovedBreakfastSelection[];
  /** The subset of `removed` that was paid for — one liability each. */
  paidRemoved: RemovedBreakfastSelection[];
  /**
   * The recomputed breakfast total over the surviving selections.
   * Equal to `recomputeBreakfastTotal(result.selections)` — the
   * BR-01 invariant holds.
   */
  total: number;
}

export interface RedateOtherAddOnsInput {
  /** Which rule decides the auto-cancel. */
  mode: AddOnRedateMode;
  /** The NEW stay window (see `RedateBreakfastInput.window`). */
  window: StayWindow;
  /** Today's date (`YYYY-MM-DD`) in the hotel timezone. */
  today: string;
  /** The booking's other add-on selections, keyed by service date. */
  selections: Record<string, OtherAddOnSelectionEntry[]> | null | undefined;
  /** The booking's `paidAmount`. */
  paidAmount: number;
}

export interface RedateOtherAddOnsResult {
  /** The selections to persist. */
  selections: Record<string, OtherAddOnSelectionEntry[]>;
  /** The auto-cancelled selections. */
  removed: RemovedOtherAddOnSelection[];
  /** The subset of `removed` that was paid for — one liability each. */
  paidRemoved: RemovedOtherAddOnSelection[];
  /** The recomputed other add-on total over the survivors. */
  total: number;
}

/**
 * The service dates a stay covers: `[checkIn, checkOut − 1]`
 * inclusive — the same shape the breakfast + add-on surfaces
 * enumerate. The gap is capped at 60 days so a malformed booking
 * cannot trigger an unbounded loop.
 */
export function enumerateStayServiceDates(window: StayWindow): string[] {
  const dates: string[] = [];
  const startMs = Date.parse(`${window.checkIn}T00:00:00Z`);
  const endMs = Date.parse(`${window.checkOut}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return dates;
  const maxDays = 60;
  for (let ms = startMs, i = 0; ms < endMs && i < maxDays; ms += 86_400_000, i += 1) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

/**
 * Is `serviceDate` inside the stay window? The check is a plain
 * string comparison — `YYYY-MM-DD` sorts lexicographically in
 * chronological order.
 */
export function isDateInStayWindow(serviceDate: string, window: StayWindow): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return false;
  return serviceDate >= window.checkIn && serviceDate < window.checkOut;
}

/**
 * The service date a breakfast slot key starts with. The key shape
 * is `yyyy-mm-dd-{slotId}` — the date prefix is the service date.
 * Returns `null` for a malformed key.
 */
export function serviceDateFromSlotKey(slotKey: string): string | null {
  if (typeof slotKey !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})-/.exec(slotKey);
  return match ? match[1] : null;
}

/**
 * Should this selection be auto-cancelled?
 *
 * `"reschedule"` → `true` when the service date is outside the new
 * window. `"cancel"` → `true` when the service date is not in the
 * past (today or later).
 */
export function shouldAutoCancelSelection(
  mode: AddOnRedateMode,
  serviceDate: string | null,
  window: StayWindow,
  today: string
): boolean {
  if (!serviceDate) return false;
  if (mode === "cancel") {
    // Past-date selections are NOT refunded and are left alone.
    return serviceDate >= today;
  }
  return !isDateInStayWindow(serviceDate, window);
}

/**
 * Auto-cancel the breakfast selections that fell outside the stay
 * window and recompute the total.
 *
 * See the file header for the money model.
 */
export function redateBreakfastSelections(
  input: RedateBreakfastInput
): RedateBreakfastResult {
  const { mode, window, today, paidAmount } = input;
  const source = input.selections || {};
  const next: Record<string, BreakfastSelectionEntry> = {};
  const removed: RemovedBreakfastSelection[] = [];

  // The running "how much of the paid amount is still attributable
  // to a meal" budget. Each PAID removal consumes its price, so a
  // booking with a single peso paid does not open two liabilities.
  let remainingPaid = Math.max(0, Number(paidAmount) || 0);
  const nowIso = new Date().toISOString();

  for (const key of Object.keys(source)) {
    const entry = source[key];
    if (!entry) {
      next[key] = entry;
      continue;
    }
    // An already-removed entry is history — leave it alone.
    if (entry.removedAt !== null && entry.removedAt !== undefined) {
      next[key] = entry;
      continue;
    }
    const serviceDate = serviceDateFromSlotKey(key);
    if (!shouldAutoCancelSelection(mode, serviceDate, window, today)) {
      next[key] = entry;
      continue;
    }
    const amount = Math.max(0, Number(entry.price) || 0);
    const wasPaid = amount > 0 && remainingPaid >= amount;
    if (wasPaid) remainingPaid -= amount;
    removed.push({
      key,
      serviceDate: serviceDate || "",
      entry,
      amount,
      wasPaid
    });
    next[key] = {
      ...entry,
      removedAt: nowIso,
      removedBy: "system",
      lastModifiedAt: nowIso,
      lastModifiedBy: "system"
    } as BreakfastSelectionEntry;
  }

  return {
    selections: next,
    removed,
    paidRemoved: removed.filter((r) => r.wasPaid),
    total: recomputeBreakfastTotal(next)
  };
}

/**
 * Auto-cancel the other add-on selections that fell outside the
 * stay window and recompute the total.
 *
 * The other add-ons are NOT inside `booking.totalPrice` (they are
 * added on top of it for the balance), so removing one does not
 * change the room bill — the liability is the only money effect.
 */
export function redateOtherAddOnSelections(
  input: RedateOtherAddOnsInput
): RedateOtherAddOnsResult {
  const { mode, window, today, paidAmount } = input;
  const source = input.selections || {};
  const next: Record<string, OtherAddOnSelectionEntry[]> = {};
  const removed: RemovedOtherAddOnSelection[] = [];

  let remainingPaid = Math.max(0, Number(paidAmount) || 0);
  const nowIso = new Date().toISOString();

  for (const date of Object.keys(source)) {
    const entries = source[date];
    if (!Array.isArray(entries)) {
      next[date] = [];
      continue;
    }
    const kept: OtherAddOnSelectionEntry[] = [];
    for (const entry of entries) {
      if (!entry) continue;
      if (entry.removedAt !== null && entry.removedAt !== undefined) {
        kept.push(entry);
        continue;
      }
      if (!shouldAutoCancelSelection(mode, date, window, today)) {
        kept.push(entry);
        continue;
      }
      const quantity = Math.max(0, Math.floor(Number(entry.quantity) || 0));
      const amount = Math.round(Math.max(0, Number(entry.priceSnapshot) || 0) * quantity);
      const wasPaid = amount > 0 && remainingPaid >= amount;
      if (wasPaid) remainingPaid -= amount;
      removed.push({
        date,
        addOnId: String(entry.addOnId || ""),
        selectionKey: `${date}-${String(entry.addOnId || "")}`,
        entry,
        amount,
        wasPaid
      });
      kept.push({
        ...entry,
        removedAt: nowIso,
        removedBy: "system",
        lastModifiedAt: nowIso,
        lastModifiedBy: "system"
      } as OtherAddOnSelectionEntry);
    }
    next[date] = kept;
  }

  return {
    selections: next,
    removed,
    paidRemoved: removed.filter((r) => r.wasPaid),
    total: recomputeOtherAddOnTotal(next)
  };
}
