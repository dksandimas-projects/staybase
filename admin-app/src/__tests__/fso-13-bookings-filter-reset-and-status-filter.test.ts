import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOOKING_ADVANCED_FILTER_PARAM_KEYS,
  BOOKING_FILTER_PARAM_KEYS,
  STORE_ADVANCED_FILTER_PARAM_KEYS,
  STORE_FILTER_PARAM_KEYS,
  clearFilterParams,
} from "../utils/listFilterParams";

// Per FSO-13 (2026-11-23): the admin Bookings list — the "Clear all"
// button actually clears, and the lifecycle status filter has a control.
//
// Background
// ----------
// Every filter on the Bookings page lives in the URL (`?bs=checked-in`,
// `?bq=…`, `?br=…`). `writeParams` builds the next query string from the
// `searchParams` captured in the CURRENT render, and React Router's
// `setSearchParams` REPLACES the whole query string. So N `writeParams`
// calls inside ONE handler each rebuild from the SAME stale snapshot and
// the LAST call wins — every earlier write is silently undone.
//
// The toolbar's "Clear all" called one setter per filter:
//
//   setBookingQuickView("all"); setBookingSearch(""); setBookingStatusFilter("all");
//   setBPayState(""); … setBDateTo("");
//
// so it cleared exactly ONE filter — whichever happened to be last in
// the chain — and left the rest of the list filtered. The same shape
// broke the date chip's remove button (it cleared `bdt` and restored
// `bdf`) and both advanced panels' "Clear all" buttons.
//
// The fix is ONE `writeParams` call whose payload nulls EVERY filter
// key. The key lists live in `admin-app/src/utils/listFilterParams.ts`
// and this test holds them to the page: every parameter the page reads
// must be reachable from one of the lists, so a NEW filter can never be
// added without also becoming clearable.
//
// The second half of FSO-13 is the status filter. The `bs` parameter
// and its predicate shipped with the FSO contract
// (`plan/features/BOOKINGS-MANAGEMENT.md §Table Filtering & Search`),
// but NO control ever wrote it — the desk could deep-link
// `?bs=checked-in` and nothing else could produce that URL.

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);

const sharedConstantsSrc = readFileSync(
  resolve(__dirname, "../../../shared/constants/index.ts"),
  "utf8"
);

describe("FSO-13 — the filter key lists cover every filter the page reads", () => {
  const NON_FILTER_PARAMS = new Set([
    // Navigation / deep links — deliberately NOT cleared by "Clear all".
    "tab",
    "filter",
    "orderRef",
    "orderId",
    "bookingId",
    "reservationId",
    "reservationRef",
    "staffHoldId",
    "roomIds",
    "checkIn",
    "checkOut",
    "newBooking",
    "holdExpiresAt",
  ]);

  const readParams = [
    ...bookingsPageSrc.matchAll(/readParam\("([a-zA-Z]+)"/g),
  ].map((m) => m[1]);

  it("the page reads at least the known filter parameters", () => {
    expect(readParams.length).toBeGreaterThan(20);
    expect(readParams).toContain("bs");
    expect(readParams).toContain("ss");
  });

  it("EVERY parameter the page reads is clearable by one of the lists", () => {
    const known = new Set<string>([
      ...BOOKING_FILTER_PARAM_KEYS,
      ...STORE_FILTER_PARAM_KEYS,
    ]);
    const uncovered = readParams.filter(
      (key) => !NON_FILTER_PARAMS.has(key) && !known.has(key)
    );
    expect(
      uncovered,
      "these URL parameters are read as filters but no \"Clear all\" can reset them"
    ).toEqual([]);
  });

  it("the booking and store key lists do not overlap", () => {
    const booking = new Set<string>(BOOKING_FILTER_PARAM_KEYS);
    const store = new Set<string>(STORE_FILTER_PARAM_KEYS);
    const overlap = [...booking].filter((key) => store.has(key));
    expect(overlap).toEqual([]);
  });

  it("each advanced-panel list is a subset of its tab's full list", () => {
    const booking = new Set<string>(BOOKING_FILTER_PARAM_KEYS);
    const store = new Set<string>(STORE_FILTER_PARAM_KEYS);
    for (const key of BOOKING_ADVANCED_FILTER_PARAM_KEYS) {
      expect(booking.has(key), `${key} must be a booking filter`).toBe(true);
    }
    for (const key of STORE_ADVANCED_FILTER_PARAM_KEYS) {
      expect(store.has(key), `${key} must be a store filter`).toBe(true);
    }
  });

  it("the panel lists own the status filter (it is rendered in the panel)", () => {
    expect(BOOKING_ADVANCED_FILTER_PARAM_KEYS).toContain("bs");
    expect(STORE_ADVANCED_FILTER_PARAM_KEYS).toContain("ss");
  });
});

describe("FSO-13 — clearFilterParams clears EVERY key in ONE payload", () => {
  it("returns one null-valued entry per key", () => {
    const payload = clearFilterParams(BOOKING_FILTER_PARAM_KEYS);
    expect(Object.keys(payload).sort()).toEqual(
      [...BOOKING_FILTER_PARAM_KEYS].sort()
    );
    for (const value of Object.values(payload)) expect(value).toBeNull();
  });

  it("one payload clears the whole list — the N-calls shape does not", () => {
    // The root cause, expressed as a test. `setSearchParams` replaces
    // the whole query string from the snapshot the render captured, so
    // a chain of writes only ever leaves the LAST write standing.
    const snapshot = new URLSearchParams(
      "bq=del+crUZ&bqv=in-house&bs=checked-in&br=101&bdt=2026-12-02"
    );
    const writeParams = (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(snapshot);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      return next;
    };

    // The OLD shape: one write per filter. Only the LAST one survives —
    // every earlier clear is undone by the next write, because the next
    // write rebuilds the query string from the same stale snapshot.
    let chained = writeParams({ bq: null });
    chained = writeParams({ bqv: null });
    chained = writeParams({ bs: null });
    chained = writeParams({ br: null });
    expect(chained.get("br")).toBeNull(); // ← the only clear that survived
    expect(chained.get("bq")).toBe("del crUZ"); // ← restored by the next write
    expect(chained.get("bqv")).toBe("in-house"); // ← restored by the next write
    expect(chained.get("bs")).toBe("checked-in"); // ← restored by the next write

    // The NEW shape: ONE write with every key.
    const cleared = writeParams(clearFilterParams(BOOKING_FILTER_PARAM_KEYS));
    expect([...cleared.keys()]).toEqual([]);
  });
});

describe("FSO-13 — the page resets its filters with ONE writeParams call", () => {
  it("the toolbar's \"Clear all\" calls the tab helper (no chained setters)", () => {
    expect(bookingsPageSrc).toMatch(
      /onClick=\{\(\) => \{\s*if \(activeMainTab === "bookings"\) clearBookingFilters\(\);\s*else clearStoreFilters\(\);/
    );
    // The old chained shape is gone.
    expect(bookingsPageSrc).not.toMatch(
      /setBookingQuickView\("all"\); setBookingSearch\(""\)/
    );
    expect(bookingsPageSrc).not.toMatch(
      /setStoreQuickView\("all"\); setStoreSearch\(""\)/
    );
  });

  it("each clear helper issues exactly ONE writeParams call", () => {
    for (const helper of [
      "clearBookingFilters",
      "clearBookingAdvancedFilters",
      "clearStoreFilters",
      "clearStoreAdvancedFilters",
    ]) {
      const body = bookingsPageSrc.match(
        new RegExp(`const ${helper} = \\(\\)[\\s\\S]*?;`)
      );
      expect(body, `${helper} must exist`).toBeTruthy();
      expect(body![0].match(/writeParams\(/g) || []).toHaveLength(1);
    }
  });

  it("both advanced panels' \"Clear all\" buttons call the advanced helpers", () => {
    expect(bookingsPageSrc).toMatch(
      /onClick=\{clearBookingAdvancedFilters\}/
    );
    expect(bookingsPageSrc).toMatch(/onClick=\{clearStoreAdvancedFilters\}/);
  });

  it("the date chips remove BOTH dates in one write", () => {
    expect(bookingsPageSrc).toMatch(
      /onRemove: \(\) => writeParams\(\{ bdf: null, bdt: null \}\)/
    );
    expect(bookingsPageSrc).toMatch(
      /onRemove: \(\) => writeParams\(\{ sdf: null, sdt: null \}\)/
    );
  });
});

describe("FSO-13 — the lifecycle status filter has a control", () => {
  it("the desktop toolbar renders a status dropdown for both tabs", () => {
    expect(bookingsPageSrc).toMatch(
      /value=\{activeMainTab === "bookings" \? bookingStatusFilter : storeStatusFilter\}/
    );
    expect(bookingsPageSrc).toMatch(
      /BOOKING_STATUS_FILTER_OPTIONS[\s\S]*?STORE_ORDER_STATUS_FILTER_OPTIONS/
    );
  });

  it("the toolbar dropdown is hidden on mobile (the panel carries it there)", () => {
    // Per ADMIN-MOBILE.md §Filter / search bar: on mobile the status
    // dropdown becomes part of the filter sheet. The panel renders the
    // same control for every size.
    expect(bookingsPageSrc).toMatch(/<label className="hidden sm:block">/);
    expect(bookingsPageSrc).toMatch(
      /Booking status[\s\S]*?value=\{bookingStatusFilter\}/
    );
    expect(bookingsPageSrc).toMatch(
      /Order status[\s\S]*?value=\{storeStatusFilter\}/
    );
  });

  it("the booking options are derived from the shared BOOKING_STATUSES constant", () => {
    expect(sharedConstantsSrc).toMatch(/export const BOOKING_STATUSES = \[/);
    expect(bookingsPageSrc).toMatch(
      /const BOOKING_STATUS_FILTER_OPTIONS = BOOKING_STATUSES\.map\(/
    );
    expect(bookingsPageSrc).toMatch(/BOOKING_STATUSES,\s*\n/); // imported from @spark-inn/shared
  });

  it("the dropdown carries every lifecycle status the desk works with", () => {
    const labels = bookingsPageSrc.match(
      /const BOOKING_STATUS_FILTER_LABELS: Record<string, string> = \{([\s\S]*?)\};/
    );
    expect(labels, "the label map must exist").toBeTruthy();
    for (const key of [
      "pending",
      "payment-uploaded",
      "payment-confirmed",
      "confirmed",
      "checked-in",
      "checked-out",
      "cancelled",
    ]) {
      // The map's keys are a mix of bare identifiers and quoted keys.
      expect(
        labels![1],
        `missing label for ${key}`
      ).toMatch(new RegExp(`(^|[\\s{])"?'?${key}"?:`, "m"));
    }
  });

  it("the store options cover the order lifecycle", () => {
    const options = bookingsPageSrc.match(
      /const STORE_ORDER_STATUS_FILTER_OPTIONS = \[([\s\S]*?)\];/
    );
    expect(options, "the store option list must exist").toBeTruthy();
    for (const key of [
      "placed",
      "confirmed",
      "out-for-delivery",
      "delivered",
      "cancelled",
    ]) {
      expect(options![1]).toContain(`"${key}"`);
    }
  });

  it("the status chip shows the same label the dropdown shows", () => {
    expect(bookingsPageSrc).toMatch(
      /BOOKING_STATUS_FILTER_LABELS\[bookingStatusFilter\] \|\| bookingStatusFilter/
    );
  });

  it("choosing a status replaces the quick view, but \"All statuses\" does not", () => {
    expect(bookingsPageSrc).toMatch(
      /writeParams\(v === "all" \? \{ bs: null \} : \{ bs: v, bqv: null \}\)/
    );
    expect(bookingsPageSrc).toMatch(
      /writeParams\(v === "all" \? \{ ss: null \} : \{ ss: v, sqv: null \}\)/
    );
  });

  it("the status filter counts toward the active-filter badge", () => {
    expect(bookingsPageSrc).toMatch(
      /advancedCount = activeMainTab === "bookings"\s*\n\s*\? \[bookingStatusFilter !== "all" \? bookingStatusFilter : ""/
    );
  });
});
