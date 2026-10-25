// Per OCT-M4 (2026-10-20, decision #297): the guest's OTHER ADD-ONS
// draft, built in the browser before the booking is submitted.
//
// BR-12 shipped the other-add-ons catalog, the staff walk-in grid and
// the post-booking "Manage Other Add-Ons" page — but the GUEST
// booking flow never had one. `BookingPage.tsx` contained ZERO
// occurrences of "otherAddOn", so a guest could not order an airport
// transfer at booking time at all, and the spec's headline BR-12 flow
// was unreachable.
//
// These helpers build the draft selection map the Step 2 grid edits
// and the create payload carries. They are PURE and live in `shared/`
// so they can be asserted behaviourally — the grid's correctness
// (per-day × per-add-on rows, quantity clamped to the guest count,
// zero-quantity rows dropped) is invisible in a regex.
//
// The server REBUILDS every entry from the live catalog on create
// (the OCT-C2 price-authority rule), so the price/name/unit this
// module snapshots are advisory only — they exist so the client can
// render a total that matches the bill.

import type { OtherAddOnSelectionEntry } from "../types";
import { buildOtherAddOnSelectionKey } from "./otherAddOnTotal";

/** The catalog shape the guest grid reads from `GET /api/bookings/addons/config`. */
export interface OtherAddOnDraftCatalogRow {
  id: string;
  name: string;
  description?: string;
  price: number;
  unit: "per-person" | "per-stay";
  isEnabled?: boolean;
  cutoffHoursBeforeCheckIn?: number;
  displayOrder?: number;
}

/**
 * A row of the PUBLIC other-add-ons catalog — the exact shape
 * `GET /api/bookings/addons/config` returns. The handler maps to
 * precisely these seven fields and deliberately does NOT expose
 * `isEnabled` or `updatedAt` (the per-row switch has already been
 * applied server-side, and `updatedAt` is admin-only metadata).
 */
export interface OtherAddOnsCatalogRow {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: "per-person" | "per-stay";
  cutoffHoursBeforeCheckIn: number;
  displayOrder: number;
}

/**
 * The response envelope of `GET /api/bookings/addons/config`.
 *
 * **The rows live under `addOns` — NOT under `data`.** `data` is the
 * BREAKFAST config endpoint's shape (`{ success, data: {...} }`), and
 * the admin app's add-on consumers were written against it, so the
 * catalog read as permanently empty (decision #313).
 *
 * Both the guest app and the admin app parse this same envelope, so
 * the two cannot drift onto two different shapes of the same endpoint
 * again.
 */
export interface OtherAddOnsCatalogResponse {
  success: boolean;
  addOns: OtherAddOnsCatalogRow[];
  /** The hotel-wide master switch (OCT-M1, decision #295). `false` = the hotel took other add-ons off sale. */
  otherAddOnsEnabled: boolean;
  /** True when the catalog is the read-only pre-seed row (a fresh install with no admin catalog yet). */
  preSeeded: boolean;
}

/**
 * The composite key for one (service date × add-on) cell — the same
 * shape the audit + refund records use
 * (`yyyy-mm-dd-{addOnId}`, per `buildOtherAddOnSelectionKey`).
 */
export function otherAddOnDraftKey(date: string, addOnId: string): string {
  return `${date}-${String(addOnId).trim()}`;
}

/**
 * Clamp a quantity to the legal range for an other add-on.
 *
 * Per BR-12 decision 3 the quantity is the number of guests using the
 * add-on that day — editable `0..guestCount`. A value above the guest
 * count is a client bug or a hostile payload; clamping keeps the grid
 * honest and keeps the server's own bounds check as the last line of
 * defence.
 */
export function clampOtherAddOnQuantity(quantity: unknown, guestCount: number): number {
  const max = Math.max(0, Math.floor(Number(guestCount) || 0));
  const raw = Math.floor(Number(quantity) || 0);
  if (raw <= 0) return 0;
  return Math.min(raw, max);
}

export interface BuildOtherAddOnDraftSelectionsInput {
  /** The enabled catalog rows. */
  catalog: OtherAddOnDraftCatalogRow[];
  /** The stay's service dates (one per night). */
  dates: string[];
  /**
   * The guest's quantities, keyed by `otherAddOnDraftKey(date, addOnId)`.
   * A missing key means "not selected" (quantity 0).
   */
  quantities: Record<string, number>;
  /** The booking's total guest count — the per-day quantity ceiling. */
  guestCount: number;
  /** Defaults to `new Date()`. */
  now?: Date;
}

/**
 * Build the guest's other-add-on draft selections.
 *
 * The result is `Record<serviceDate, OtherAddOnSelectionEntry[]>`
 * — the exact shape the booking doc stores and the create payload
 * carries.
 *
 * Rules:
 *   - A row is emitted only when its quantity is > 0 (a guest who
 *     set a date back to 0 has removed it; the shape keeps no
 *     zero-quantity rows).
 *   - A date with no rows at all is omitted from the map entirely.
 *   - The quantity is clamped to `0..guestCount`.
 *   - The price / name / unit are snapshotted from the catalog. The
 *     server re-snapshots them on create.
 */
export function buildOtherAddOnDraftSelections(
  input: BuildOtherAddOnDraftSelectionsInput
): Record<string, OtherAddOnSelectionEntry[]> {
  const now = input.now ?? new Date();
  const stamp = now.toISOString();
  const catalogById = new Map<string, OtherAddOnDraftCatalogRow>();
  for (const row of input.catalog || []) {
    if (row && row.id) catalogById.set(row.id, row);
  }

  const out: Record<string, OtherAddOnSelectionEntry[]> = {};
  for (const date of input.dates || []) {
    const rows: OtherAddOnSelectionEntry[] = [];
    for (const addOn of catalogById.values()) {
      const raw = input.quantities?.[otherAddOnDraftKey(date, addOn.id)];
      const quantity = clampOtherAddOnQuantity(raw, input.guestCount);
      if (quantity <= 0) continue;
      rows.push({
        addOnId: addOn.id,
        nameSnapshot: addOn.name,
        priceSnapshot: Math.max(0, Number(addOn.price) || 0),
        quantity,
        unitSnapshot: addOn.unit === "per-stay" ? "per-stay" : "per-person",
        addedAt: stamp,
        addedBy: "guest",
        lastModifiedAt: stamp,
        lastModifiedBy: "guest",
        removedAt: null,
        removedBy: null,
        cutoffHoursBeforeCheckInSnapshot: Math.max(
          0,
          Math.min(168, Math.floor(Number(addOn.cutoffHoursBeforeCheckIn) || 24))
        )
      });
    }
    if (rows.length > 0) out[date] = rows;
  }
  return out;
}

/**
 * How many (date × add-on) rows carry a quantity > 0 — the number
 * the Step 2 CTA quotes as "N add-ons".
 *
 * Zero-quantity rows and removed rows do not count.
 */
export function countOtherAddOnDraftSelections(
  selections: Record<string, OtherAddOnSelectionEntry[]> | null | undefined
): number {
  if (!selections) return 0;
  let count = 0;
  for (const date of Object.keys(selections)) {
    const rows = selections[date];
    if (!Array.isArray(rows)) continue;
    for (const entry of rows) {
      if (!entry) continue;
      if (entry.removedAt !== null && entry.removedAt !== undefined) continue;
      if (Math.max(0, Math.floor(Number(entry.quantity) || 0)) > 0) count += 1;
    }
  }
  return count;
}

/**
 * One operation of the Manage Other Add-Ons save batch.
 *
 * `add` and `change` carry the full snapshot; `remove` only needs the
 * key + the add-on id.
 */
export interface OtherAddOnManageOp {
  selectionKey: string;
  addOnId: string;
  quantity?: number;
  priceSnapshot?: number;
  nameSnapshot?: string;
  unitSnapshot?: "per-person" | "per-stay";
  cutoffHoursBeforeCheckInSnapshot?: number;
}

export interface BuildOtherAddOnManageOpsInput {
  /** What the server currently holds for the booking. */
  original: Record<string, OtherAddOnSelectionEntry[]> | null | undefined;
  /** What the guest has edited in the browser. */
  draft: Record<string, OtherAddOnSelectionEntry[]> | null | undefined;
  /** The live catalog rows — the ADD op snapshots them. */
  catalog: OtherAddOnDraftCatalogRow[] | null | undefined;
}

export interface OtherAddOnManageOps {
  add: OtherAddOnManageOp[];
  change: OtherAddOnManageOp[];
  remove: OtherAddOnManageOp[];
}

/**
 * Assemble the Manage Other Add-Ons save batch from what the server holds
 * and what the guest has edited.
 *
 * **A quantity of 0 is a REMOVAL, never a change.** This is the whole
 * point of the helper. The server processes REMOVEs first and then
 * CHANGEs, and a CHANGE op that lands on a selection the REMOVE already
 * took away fails with `SELECTION_NOT_ORDERED` — which the guest sees as
 * "Nothing to change — add the add-on first." even though the removal
 * WAS applied. The client used to emit both ops for the same line
 * (a change with quantity 0 AND a remove), so lowering a quantity to 0
 * always ended in a false error. (Found by the AI-BROWSER-QA pass,
 * 2026-10-25 — scenario AO-08.)
 *
 * Rules:
 *   - A line the server does not hold (or holds as removed) and the
 *     guest now wants → `add`.
 *   - A line the server holds and the guest still wants at a DIFFERENT
 *     quantity → `change`.
 *   - A line the server holds and the guest no longer wants (missing
 *     from the draft, removed in the draft, or a quantity of 0) →
 *     `remove`.
 *   - A line that is unchanged produces no op at all.
 */
export function buildOtherAddOnManageOps(input: BuildOtherAddOnManageOpsInput): OtherAddOnManageOps {
  const original = input.original || {};
  const draft = input.draft || {};
  const catalogById = new Map<string, OtherAddOnDraftCatalogRow>();
  for (const row of input.catalog || []) {
    if (row && row.id) catalogById.set(row.id, row);
  }

  const add: OtherAddOnManageOp[] = [];
  const change: OtherAddOnManageOp[] = [];
  const remove: OtherAddOnManageOp[] = [];

  const dates = new Set([...Object.keys(original), ...Object.keys(draft)]);
  for (const date of dates) {
    const origList = (original[date] || []).filter(Boolean);
    const draftList = (draft[date] || []).filter(Boolean);
    const draftByKey = new Map(draftList.map((e) => [e.addOnId, e]));
    const origByKey = new Map(origList.map((e) => [e.addOnId, e]));

    for (const draftEntry of draftList) {
      const liveAddOn = catalogById.get(draftEntry.addOnId);
      if (!liveAddOn) continue;
      const origEntry = origByKey.get(draftEntry.addOnId);
      const key = buildOtherAddOnSelectionKey(date, draftEntry.addOnId);
      const draftQuantity = Math.max(0, Math.floor(Number(draftEntry.quantity) || 0));
      const draftRemoved = draftEntry.removedAt !== null && draftEntry.removedAt !== undefined;

      if (!origEntry || origEntry.removedAt !== null) {
        // Not ordered (or ordered and removed) — the guest now wants it.
        if (draftQuantity > 0 && !draftRemoved) {
          add.push({
            selectionKey: key,
            addOnId: draftEntry.addOnId,
            quantity: draftQuantity,
            priceSnapshot: Math.max(0, Number(liveAddOn.price) || 0),
            nameSnapshot: liveAddOn.name,
            unitSnapshot: liveAddOn.unit === "per-stay" ? "per-stay" : "per-person",
            cutoffHoursBeforeCheckInSnapshot: Math.max(
              0,
              Math.min(168, Math.floor(Number(liveAddOn.cutoffHoursBeforeCheckIn) || 24))
            )
          });
        }
        continue;
      }

      if (draftRemoved || draftQuantity === 0) {
        // The guest took the line away. The REMOVE op is the whole story —
        // a CHANGE op with a quantity of 0 would land on a selection the
        // remove already took and fail the whole batch.
        remove.push({ selectionKey: key, addOnId: draftEntry.addOnId });
        continue;
      }

      const origQuantity = Math.max(0, Math.floor(Number(origEntry.quantity) || 0));
      if (draftQuantity !== origQuantity) {
        change.push({
          selectionKey: key,
          addOnId: draftEntry.addOnId,
          quantity: draftQuantity,
          priceSnapshot: Math.max(0, Number(liveAddOn.price) || 0),
          nameSnapshot: liveAddOn.name,
          unitSnapshot: liveAddOn.unit === "per-stay" ? "per-stay" : "per-person",
          cutoffHoursBeforeCheckInSnapshot: Math.max(
            0,
            Math.min(168, Math.floor(Number(liveAddOn.cutoffHoursBeforeCheckIn) || 24))
          )
        });
      }
    }

    // A line the server holds that the draft dropped entirely.
    for (const origEntry of origList) {
      if (origEntry.removedAt !== null && origEntry.removedAt !== undefined) continue;
      const draftEntry = draftByKey.get(origEntry.addOnId);
      if (!draftEntry) {
        remove.push({
          selectionKey: buildOtherAddOnSelectionKey(date, origEntry.addOnId),
          addOnId: origEntry.addOnId
        });
        continue;
      }
      // The draft still lists it, but with a quantity of 0 — the remove
      // op for that line was already pushed above. Nothing more to do.
    }
  }

  return { add, change, remove };
}
