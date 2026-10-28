// The desk's two money surfaces must BOTH split real guest money from
// QA rehearsal data.
//
// WHY
// ---
// On 2026-10-27 a live check found that 100% of the admin app's
// "Breakfast refunds pending" headline (3 pending refunds, ₱300.00)
// was the owner's own rehearsal run — not one peso was real guest
// money. The dashboard's "Pending refunds" card reads the same
// collectionGroup, so it was just as unreadable.
//
// These tests pin that BOTH surfaces use the split, and that NEITHER of
// them can quietly drop a real guest's money.
//
// They read the source rather than rendering the app, because the bug
// here is "the split was never wired into this surface" — and a render
// test would still pass if the split were removed from a surface the
// test did not exercise.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const adminSrc = join(__dirname, "..");

function read(file: string): string {
  return readFileSync(join(adminSrc, file), "utf8");
}

describe("the dashboard's pending-refunds card", () => {
  const source = read("pages/DashboardPage.tsx");

  it("splits the pending breakfast refunds into real and fixture", () => {
    expect(source).toContain("isFixtureRefund");
    expect(source).toContain("setBreakfastPendingFixtures");
  });

  it("shows the REAL count as the headline, not the combined one", () => {
    // The card's value is the real total.
    expect(source).toMatch(/value=\{String\(pendingRefundsTotal\)\}/);
    // And `pendingRefundsTotal` must be the real sum only — the
    // fixtures are counted separately.
    expect(source).toMatch(
      /const pendingRefundsTotal = cancellationPendingRefunds \+ breakfastPendingRefunds;/
    );
    expect(source).toMatch(
      /const pendingRefundFixtures = cancellationPendingFixtures \+ breakfastPendingFixtures;/
    );
  });

  it("still reports the fixtures instead of hiding them", () => {
    expect(source).toContain("dashboard-pending-refunds-fixture-note");
    expect(source).toContain("rehearsal data, not guest money");
  });

  it("treats a cancellation liability on a test booking as a fixture", () => {
    expect(source).toMatch(/isTestData === true\) fixtureCount \+= 1/);
  });

  // The Revenue card. A live check found it showing ₱42,800.00 for the
  // month, of which 100% was the owner's own rehearsal run.
  it("shows only REAL guest revenue as the headline", () => {
    expect(source).toContain("monthlyRevenueFixtures");
    expect(source).toMatch(
      /const monthlyRevenue = bookings[\s\S]*?isTestData !== true[\s\S]*?\.reduce/
    );
  });

  it("reports the rehearsal revenue next to the real figure", () => {
    expect(source).toContain("is QA test data");
    expect(source).toContain("Real guest bookings this month");
  });

  // The Bookings card. It showed 154, of which 133 were rehearsal.
  it("shows only REAL guest bookings as the headline", () => {
    expect(source).toContain("monthlyBookingsFixtures");
    expect(source).toMatch(
      /const monthlyBookingsCount = bookings\.filter\([\s\S]*?isTestData !== true/
    );
  });

  it("reports the rehearsal bookings next to the real count", () => {
    expect(source).toContain("QA test fixture");
    expect(source).toContain("excluded");
  });

  // The Pending Payments card. It counted rehearsal payment proofs as
  // if a guest were waiting.
  it("shows only REAL guest payment proofs as the headline", () => {
    expect(source).toContain("pendingPaymentRealCount");
    expect(source).toContain("pendingPaymentFixtureCount");
    expect(source).toMatch(/value=\{String\(pendingPaymentRealCount\)\}/);
  });

  it("does not raise the payment alert for rehearsal proofs alone", () => {
    expect(source).toMatch(/tone=\{pendingPaymentRealCount > 0 \? "warning" : "neutral"\}/);
  });

  it("badges a rehearsal payment row so the desk knows before acting", () => {
    expect(source).toContain("dashboard-payment-fixture-badge");
    expect(source).toContain("not a guest payment");
  });

  it("treats a MIXED reservation group as real, because a guest is in it", () => {
    expect(source).toMatch(
      /isTestData: sorted\.length > 0 && sorted\.every\(\(c\) => c\.isTestData === true\)/
    );
  });
});

describe("the liability tab", () => {
  const source = read("components/LiabilityTab.tsx");

  it("splits the pending breakfast refunds into real and fixture", () => {
    expect(source).toContain("isFixtureRefund");
    expect(source).toContain("breakfastFixtureCount");
    expect(source).toContain("breakfastFixtureAmount");
  });

  it("shows the REAL count and amount as the headline", () => {
    expect(source).toMatch(/value=\{metrics\.breakfastPendingCount\}/);
    expect(source).toMatch(/sublabel=\{formatPrice\(metrics\.breakfastPendingAmount\)\}/);
  });

  it("reports the fixture money underneath the headline, not instead of it", () => {
    expect(source).toContain("fixtureNote(");
    expect(source).toContain("liability-metric-fixture-note");
  });

  it("badges a rehearsal row in the pending list", () => {
    expect(source).toContain("liability-row-fixture-badge");
    expect(source).toContain("QA test fixture — rehearsal data, not guest money");
  });

  it("carries the fixture flag onto every row it builds", () => {
    // Both row builders (the reservation one and the per-child booking
    // one) must set the flag, or a row would silently look like a real
    // guest's.
    const matches = source.match(/isTestData: (data|booking)\.isTestData === true/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });
});

describe("the helper the surfaces share", () => {
  const source = read("utils/qaFixtures.ts");

  it("defaults an unattributable refund to REAL, never to a fixture", () => {
    expect(source).toContain("return null;");
    expect(source).toMatch(/if \(!bookingId\) return false;/);
  });

  it("only treats an EXPLICIT `isTestData === true` as a fixture", () => {
    expect(source).toContain("booking.isTestData === true");
  });
});
