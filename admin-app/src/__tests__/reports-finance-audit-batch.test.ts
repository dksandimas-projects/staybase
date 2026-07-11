import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizePaymentMethodBucket, dateKeyInTimeZone, PAYMENT_BUCKETS } from "../utils/finance";

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
