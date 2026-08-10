import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertRevenueFinanceInvariant } from "@spark-inn/shared";
import { normalizePaymentMethodBucket, dateKeyInTimeZone, PAYMENT_BUCKETS, splitBookingRevenue } from "../utils/finance";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");
const bookings = readFileSync(resolve(__dirname, "../pages/BookingsPage.tsx"), "utf8");

// ── Fix #2: robust payment-method bucketing ─────────────────────────────────
describe("normalizePaymentMethodBucket", () => {
  it("maps known tenders to their own bucket (case/spacing tolerant)", () => {
    expect(normalizePaymentMethodBucket("cash")).toBe("cash");
    expect(normalizePaymentMethodBucket("GCash")).toBe("gcash");
    expect(normalizePaymentMethodBucket("bank")).toBe("bank");
    expect(normalizePaymentMethodBucket("bank_transfer")).toBe("bank");
    expect(normalizePaymentMethodBucket("bank-transfer")).toBe("bank");
    expect(normalizePaymentMethodBucket("Bank Transfer")).toBe("bank");
    expect(normalizePaymentMethodBucket("card")).toBe("card");
    expect(normalizePaymentMethodBucket("credit-card")).toBe("card");
    expect(normalizePaymentMethodBucket("paypal")).toBe("paypal");
  });

  it("routes ambiguous / custom / empty methods to 'other', never 'cash'", () => {
    // The core bug this fixes: unknown methods must NOT silently inflate cash.
    expect(normalizePaymentMethodBucket("pay-at-hotel")).toBe("other");
    expect(normalizePaymentMethodBucket("cod")).toBe("other");
    expect(normalizePaymentMethodBucket("add-to-bill")).toBe("other");
    expect(normalizePaymentMethodBucket("crypto-x")).toBe("other");
    expect(normalizePaymentMethodBucket("")).toBe("other");
    expect(normalizePaymentMethodBucket(undefined as unknown as string)).toBe("other");
  });

  it("exposes exactly the six reconciliation buckets", () => {
    expect(PAYMENT_BUCKETS).toEqual(["cash", "gcash", "bank", "card", "paypal", "other"]);
  });
});

// ── Fix #1: timezone-stable day keys ────────────────────────────────────────
describe("dateKeyInTimeZone", () => {
  it("assigns a post-midnight Manila payment to the correct local day", () => {
    // 2026-07-11T17:30:00Z is 2026-07-12 01:30 in Asia/Manila (UTC+8).
    const d = new Date("2026-07-11T17:30:00Z");
    expect(dateKeyInTimeZone(d, "Asia/Manila")).toBe("2026-07-12");
    // Under naive UTC slicing this would wrongly read 2026-07-11.
    expect(d.toISOString().slice(0, 10)).toBe("2026-07-11");
  });

  it("keeps an evening Manila payment on the same day", () => {
    const d = new Date("2026-07-11T15:00:00Z"); // 23:00 Manila
    expect(dateKeyInTimeZone(d, "Asia/Manila")).toBe("2026-07-11");
  });
});

describe("splitBookingRevenue", () => {
  it("counts a breakfast booking exactly once across disjoint streams", () => {
    const split = splitBookingRevenue({
      totalPrice: 6_000,
      ratePerNight: 2_500,
      numNights: 2,
      numGuests: 2,
      hasBreakfast: true,
      breakfastRate: 250,
      rateBreakdown: { roomSubtotal: 5_000 }
    });

    expect(split).toEqual({ room: 5_000, breakfast: 1_000 });
    expect(split.room + split.breakfast).toBe(6_000);
  });

  it("reconciles all revenue categories while keeping ledger streams disjoint", () => {
    const bookingRevenue = splitBookingRevenue({
      totalPrice: 6_000,
      ratePerNight: 2_500,
      numNights: 2,
      numGuests: 2,
      hasBreakfast: true,
      breakfastRate: 250,
      rateBreakdown: { roomSubtotal: 5_000 }
    });

    assertRevenueFinanceInvariant({
      roomRevenue: bookingRevenue.room,
      breakfastRevenue: bookingRevenue.breakfast,
      storeRevenue: 1_500,
      incidentalRevenue: 500,
      totalRevenue: 8_000,
      streamEntryIds: {
        revenue: ["booking:b1", "store:s1", "charge:c1"],
        tenders: ["booking:b1/payment:p1", "store:s1/payment:delivery-tender"],
        receivables: ["booking:b2/receivable"]
      }
    });
  });

  it("allocates discounts proportionally between room and breakfast", () => {
    const split = splitBookingRevenue({
      totalPrice: 4_800,
      numNights: 2,
      numGuests: 2,
      hasBreakfast: true,
      breakfastRate: 250,
      rateBreakdown: { roomSubtotal: 5_000 }
    });

    expect(split).toEqual({ room: 4_000, breakfast: 800 });
    expect(split.room + split.breakfast).toBe(4_800);
  });

  it("keeps non-breakfast and malformed legacy bookings safe", () => {
    expect(splitBookingRevenue({ totalPrice: 3_000, hasBreakfast: false })).toEqual({ room: 3_000, breakfast: 0 });
    expect(splitBookingRevenue({ totalPrice: 3_000, hasBreakfast: true, breakfastRate: 200, numGuests: 2, numNights: 1 })).toEqual({ room: 3_000, breakfast: 0 });
    expect(splitBookingRevenue({ totalPrice: Number.NaN, hasBreakfast: true, breakfastRate: 200 })).toEqual({ room: 0, breakfast: 0 });
  });
});

// ── Wiring: the four fixes are actually applied in the page ────────────────
describe("ReportsPage finance-audit wiring", () => {
  it("Fix #1 — Collections by day groups by hotel-timezone day, not UTC", () => {
    expect(reports).toMatch(/dateKeyInTimeZone\(payment\.recordedAt, config\.timezone\)/);
    expect(reports).not.toMatch(/payment\.recordedAt\.toISOString\(\)\.slice\(0, 10\)/);
  });

  it("Fix #1 — Daily Close keys payments and default date by hotel timezone", () => {
    expect(reports).toMatch(/dateKeyInTimeZone\(new Date\(\), config\.timezone\)/);
    expect(reports).toMatch(/dateKeyInTimeZone\(p\.recordedAt, config\.timezone\) === dateStr/);
    expect(reports).not.toMatch(/p\.recordedAt\.toLocaleDateString\("en-CA"\) === dateStr/);
  });

  it("Fix #2 — Daily Close has an 'other' bucket driven by the normalizer", () => {
    expect(reports).toMatch(/normalizePaymentMethodBucket\(p\.method\)/);
    expect(reports).toMatch(/other: \{ payments: 0, refunds: 0, net: 0, count: 0 \}/);
    expect(reports).toMatch(/dailySummary\.other\.net/);
    expect(reports).toMatch(/other: varianceOther/);
    expect(reports).toMatch(/other: dailySummary\.other\.net/);
    expect(reports).toMatch(/c\.variance\?\.other \?\? 0/);
  });

  it("Fix #3 — staff UIDs resolve to names in the ledger and by-staff view", () => {
    expect(reports).toMatch(/const staffNameMap = useMemo/);
    expect(reports).toMatch(/staffNameMap\.get\(p\.recordedBy\) \|\| p\.recordedBy/);
    expect(reports).toMatch(/const label = staffNameMap\.get\(uid\) \|\| uid;/);
    expect(reports).toMatch(/staffNameMap=\{staffNameMap\}/);
  });

  it("Fix #4 — revenue/billed side includes payment-confirmed bookings", () => {
    expect(reports).toMatch(/b\.status === "payment-confirmed" \|\| b\.status === "confirmed"/);
  });

  it("MRB-11 — Reports surface reads the stored `revenueAllocation` (or the legacy-heuristic fallback for pre-MRB-11 docs)", () => {
    // Per decision #177 (2026-08-03): every KPI + chart + table
    // that used `splitBookingRevenue(b).room` / `.breakfast`
    // (the historical proportional split of the post-discount
    // total) now reads `getBookingRevenueStreams(b).roomNet` /
    // `.breakfastNet`. The new helper:
    //   - returns the stored GROSS per-stream values when
    //     `booking.revenueAllocation` is present (post-MRB-11);
    //   - falls back to the legacy `splitBookingRevenue` math
    //     byte-for-byte for pre-MRB-11 docs (so a single-day
    //     report on historical data returns the same numbers
    //     as before the upgrade);
    //   - tags the result `"allocation: 'stored'"` vs
    //     `"allocation: 'legacy-heuristic'"` so the export
    //     can surface the heuristic to the accountant.
    // The 3 room-stream call sites + 1 breakfast call site +
    // 1 slot-mapping call site mirror the historical pattern.
    expect(reports.match(/getBookingRevenueStreams\(b\)\.roomNet \* fraction/g)).toHaveLength(3);
    expect(reports).toMatch(/getBookingRevenueStreams\(b\)\.breakfastNet \* fraction/);
    expect(reports).toMatch(/const bookingRevenue = getBookingRevenueStreams\(b\)/);
    // The historical `splitBookingRevenue` import is gone
    // from ReportsPage — the per-stream math is now in
    // `getBookingRevenueStreams` (shared bookingFolio.ts),
    // so the export is deterministic across the two apps
    // (admin reports + the eventual MD sync to BACKEND).
    expect(reports).not.toMatch(/import\s*\{[^}]*splitBookingRevenue[^}]*\}\s*from\s*["']\.\.\/utils\/finance["']/);
  });

  it("FR-05 — payment/charge listeners are stable (not re-subscribed on booking changes)", () => {
    // Listeners store raw rows and no longer depend on `bookings`, so they
    // stay subscribed once instead of re-reading Firestore on every booking edit.
    expect(reports).toMatch(/setRawPayments\(snapshot\.docs\.map/);
    expect(reports).toMatch(/setRawCharges\(snapshot\.docs\.map/);
    expect(reports).not.toMatch(/\}, \[bookings, toast\]\);/);
    // Booking display fields are joined in memory instead.
    expect(reports).toMatch(/const bookingDisplayById = useMemo/);
    expect(reports).toMatch(/const payments = useMemo<ReportPayment\[\]>/);
    expect(reports).toMatch(/const charges = useMemo<ReportCharge\[\]>/);
  });
});

describe("BookingsPage onsite tender wiring", () => {
  it("Fix #2 — pay-at-hotel is excluded as an onsite tender", () => {
    expect(bookings).toMatch(/NON_TENDER_ONSITE_PAYMENT_METHODS = new Set\(\["cod", "add-to-bill", "pay-at-hotel"\]\)/);
  });

  it("Fix #2 — Cash is guaranteed as a selectable onsite tender", () => {
    expect(bookings).toMatch(/CASH_ONSITE_PAYMENT_METHOD/);
    expect(bookings).toMatch(/hasCash \? base : \[CASH_ONSITE_PAYMENT_METHOD, \.\.\.base\]/);
  });
});

// Per MED-1 / MED-2 / LOW-2 (reports audit 2026-08-10):
// the receivables + occupancy + acquisition widgets must
// include the corporate chargeback case (pending +
// pay-at-hotel + isCorporate) and the corporate personal-pay
// receipt-pending case (payment-uploaded + isCorporate) —
// both are real ARs / real room holds that the pre-fix
// status whitelist dropped.
describe("ReportsPage status filter coverage (reports audit 2026-08-10)", () => {
  it("MED-1 — receivables filter includes the corporate chargeback (`pending` + `pay-at-hotel` + isCorporate)", () => {
    // The pre-fix filter was a single-line
    // `["confirmed","payment-confirmed","checked-in","checked-out"].includes(...)`
    // — a corporate chargeback (`status: "pending"`,
    // `paymentMethod: "pay-at-hotel"`, `isCorporate: true`)
    // never matched, so it never appeared in the "Corporate
    // AR" card or the by-company list. The post-fix filter
    // adds the corporate chargeback case explicitly.
    expect(reports).toMatch(
      /booking\.status === "pending" && booking\.isCorporate === true && booking\.paymentMethod === "pay-at-hotel"/
    );
  });

  it("LOW-2 — receivables filter includes the corporate personal-pay receipt-pending case (`payment-uploaded` + isCorporate)", () => {
    // A corporate personal-pay booking that uploaded a
    // receipt (`status: "payment-uploaded"`,
    // `isCorporate: true`) is a real AR until staff verifies
    // the receipt. The pre-fix filter excluded it; the
    // post-fix filter includes it.
    expect(reports).toMatch(
      /booking\.status === "payment-uploaded" && booking\.isCorporate === true/
    );
  });

  it("MED-1 — receivables filter STILL excludes the non-corporate walk-in `pending` + `pay-at-hotel` (will pay on arrival, not AR)", () => {
    // A non-corporate `pending` walk-in is not an AR —
    // the guest will pay on arrival at the desk. The
    // post-fix filter must NOT include this case (the
    // condition is gated on `isCorporate === true`).
    //
    // The single-line source-text check looks for the
    // `&& booking.isCorporate === true` guard on BOTH new
    // cases. If a future refactor drops the `isCorporate`
    // guard from either branch, the walk-in-pending case
    // would leak into the AR aging report and inflate the
    // drawer variance (the desk would expect cash that
    // hasn't been collected yet).
    const pendingBranch = reports.match(
      /booking\.status === "pending"[\s\S]{0,160}booking\.isCorporate === true/
    );
    const paymentUploadedBranch = reports.match(
      /booking\.status === "payment-uploaded"[\s\S]{0,160}booking\.isCorporate === true/
    );
    expect(pendingBranch).not.toBeNull();
    expect(paymentUploadedBranch).not.toBeNull();
  });

  it("MED-2 — occupancy memo derives from the broader room-hold set (pending + payment-uploaded + the existing 4 statuses), NOT from revenueBookings", () => {
    // Per MED-2 (reports audit 2026-08-10): the create
    // transaction holds the room regardless of payment
    // status, so occupancy + acquisition must include
    // `pending` and `payment-uploaded`. The pre-fix path
    // derived `occupancyBookings` from `revenueBookings`
    // (which intentionally excludes those statuses for
    // cash-side accuracy) — a corporate chargeback that
    // stayed `pending` for weeks while the LOU was
    // processed was missing from the room-type occupancy
    // chart AND the acquisition / booking-source chart.
    //
    // The fix introduces a `roomHoldBookings` memo that
    // includes every room-holding status and feeds the
    // occupancy + acquisition widgets. The revenue memo
    // stays narrow.
    expect(reports).toMatch(/const roomHoldBookings = useMemo/);
    // The room-hold set explicitly includes `pending` and
    // `payment-uploaded` (the two pre-fix gap cases).
    expect(reports).toMatch(
      /b\.status === "pending" \|\|[\s\S]{0,200}b\.status === "payment-uploaded"/
    );
    // The occupancy memo sources from `roomHoldBookings`,
    // not `revenueBookings`.
    expect(reports).toMatch(
      /return roomHoldBookings\.filter\(b => \{/
    );
  });

  it("MED-2 — revenue memo is UNCHANGED (stays narrow, cash-side metric)", () => {
    // The revenue memo must keep its 4-status whitelist so
    // a paid-but-not-yet-confirmed booking is revenue-
    // eligible (the historical `payment-confirmed`
    // inclusion per line 422-427).
    expect(reports).toMatch(
      /b\.status === "payment-confirmed" \|\| b\.status === "confirmed" \|\| b\.status === "checked-in" \|\| b\.status === "checked-out"/
    );
  });
});
