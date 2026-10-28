// The desk's money surfaces must tell a QA rehearsal entry from a real
// guest's money.
//
// WHY
// ---
// On 2026-10-27 a live check found that 100% of the admin app's
// "Breakfast refunds pending" headline — 3 pending refunds worth
// ₱300.00 — was the owner's own rehearsal run. Not one peso was real
// guest money. The desk could not tell, so the card was unreadable.
//
// These tests pin the split:
//   * a refund whose booking carries `isTestData: true` is a fixture;
//   * a refund whose booking is NOT tagged is REAL;
//   * a refund that cannot be attributed to any booking is REAL — the
//     safe default, because under-reporting a liability is much worse
//     than over-reporting one;
//   * nothing is ever silently dropped: the split always accounts for
//     every refund.

import { describe, it, expect } from "vitest";
import {
  buildFixtureBookingIds,
  refundBookingId,
  isFixtureRefund,
  splitFixtureRefunds,
  fixtureNote
} from "../utils/qaFixtures";

function refundDoc(path: string, data: Record<string, unknown> = {}) {
  return {
    id: path.split("/").pop(),
    ref: { path },
    data: () => data
  };
}

describe("the QA-fixture lookup", () => {
  it("collects only the bookings explicitly tagged as test data", () => {
    const ids = buildFixtureBookingIds([
      { id: "a", isTestData: true },
      { id: "b", isTestData: false },
      { id: "c" },
      { id: "d", isTestData: null }
    ]);
    expect([...ids]).toEqual(["a"]);
  });

  it("survives a missing bookings array", () => {
    expect(buildFixtureBookingIds(null).size).toBe(0);
    expect(buildFixtureBookingIds(undefined).size).toBe(0);
  });
});

describe("attributing a refund to its booking", () => {
  it("uses the bookingId the refund document carries", () => {
    const doc = refundDoc("bookings/xyz/refunds/r1", { bookingId: "xyz" });
    expect(refundBookingId(doc as any)).toBe("xyz");
  });

  it("falls back to the path when the document has no bookingId", () => {
    const doc = refundDoc("bookings/abc/refunds/r1");
    expect(refundBookingId(doc as any)).toBe("abc");
  });

  it("returns null when it cannot be attributed — and null means REAL", () => {
    const doc = refundDoc("reservations/res1/refunds/r1", { reservationId: "res1" });
    expect(refundBookingId(doc as any)).toBeNull();
    expect(isFixtureRefund(doc as any, new Set(["res1"]))).toBe(false);
  });
});

describe("telling a fixture from real guest money", () => {
  const fixtureIds = new Set(["fixture-1"]);

  it("marks a refund of a tagged booking as a fixture", () => {
    const doc = refundDoc("bookings/fixture-1/refunds/r1", { bookingId: "fixture-1" });
    expect(isFixtureRefund(doc as any, fixtureIds)).toBe(true);
  });

  it("marks a refund of an untagged booking as REAL", () => {
    const doc = refundDoc("bookings/real-1/refunds/r1", { bookingId: "real-1" });
    expect(isFixtureRefund(doc as any, fixtureIds)).toBe(false);
  });

  it("treats an unattributable refund as REAL, not as a fixture", () => {
    const doc = refundDoc("reservations/res1/refunds/r1");
    expect(isFixtureRefund(doc as any, fixtureIds)).toBe(false);
  });
});

describe("the split accounts for every single refund", () => {
  it("never loses a refund", () => {
    const docs = [
      refundDoc("bookings/fixture-1/refunds/r1", { bookingId: "fixture-1" }),
      refundDoc("bookings/real-1/refunds/r2", { bookingId: "real-1" }),
      refundDoc("reservations/res1/refunds/r3"),
      refundDoc("bookings/fixture-1/refunds/r4", { bookingId: "fixture-1" })
    ];
    const { real, fixtures } = splitFixtureRefunds(docs as any, new Set(["fixture-1"]));
    expect(fixtures.length).toBe(2);
    expect(real.length).toBe(2);
    expect(real.length + fixtures.length).toBe(docs.length);
  });

  it("reports an empty note when there are no fixtures", () => {
    expect(fixtureNote(0, 0)).toBe("");
  });

  it("says plainly that the fixture money is not guest money", () => {
    const note = fixtureNote(3, 300);
    expect(note).toContain("3 QA test fixtures");
    expect(note).toContain("₱300.00");
    expect(note).toContain("not guest money");
  });

  it("uses the singular for one fixture", () => {
    expect(fixtureNote(1, 100)).toContain("1 QA test fixture (");
  });
});
