// Per RPT-01b (QA pass 2026-10-23): the Bookings LIST's payment ledger
// must be resolved at COMMIT time, not at snapshot time.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// The bookings mapper resolved each row's ledger from
// `paymentIndexRef.current` INSIDE the `onSnapshot` callback, then
// awaited the private-storage URLs, and only then committed the rows:
//
//   onSnapshot → build rows → resolve ledger (index as it is NOW)
//              → await Promise.all(storage URLs)   ← the payments
//                                                    listener can land
//                                                    in here
//              → setBookings(rows)                 ← the STALE rows
//
// The payments listener and the bookings listener are INDEPENDENT, so
// when the index landed during that `await`, the re-hydration effect
// repaired the rows — and the mapper then committed its stale,
// un-hydrated copy straight over the repair. Nothing re-derived them
// afterwards, so every row read "₱0 paid".
//
// The live proof (QA report §3.6): the list reported
// "All bookings 69 · Needs attention 10 · Balance due 69" and rendered
// 0 "Fully paid" pills across 68 rows, while the drawer showed the
// real amounts and no console error appeared.
//
// THE FIX
// -------
// The ledger is resolved immediately BEFORE the rows are written to
// state, so whichever listener arrives last wins — no arrival order can
// leave the rows stale.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const contextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

describe("RPT-01b — the ledger is resolved at COMMIT time", () => {
  it("the mapper no longer resolves the ledger inside the snapshot callback", () => {
    // The resolution must not be part of the per-row mapping loop.
    const mapperLoop = /legacyOnsitePaymentsRef\.current\[docSnap\.id\][\s\S]{0,600}?\n\s{8}\}\);/;
    const loop = contextSrc.match(mapperLoop);
    expect(loop, "the mapper's per-row loop must be findable").not.toBeNull();
    expect(
      loop![0],
      "the per-row loop must NOT resolve the ledger — that is the stale write"
    ).not.toMatch(/resolveBookingOnsitePayments\(/);
  });

  it("the rows are re-resolved immediately before they are committed", () => {
    const commitBlock = /if \(!active\) return;([\s\S]{0,4000}?)setBookings\(/;
    const block = contextSrc.match(commitBlock);
    expect(block, "the commit block must be findable").not.toBeNull();
    expect(
      block![0],
      "the ledger must be resolved between the last await and the state write"
    ).toMatch(/resolveBookingOnsitePayments\(/);
  });

  it("the commit-time resolution reads the CURRENT index ref", () => {
    expect(
      contextSrc,
      "the commit-time resolution must read `paymentIndexRef.current`"
    ).toMatch(/resolveBookingOnsitePayments\([\s\S]{0,240}?paymentIndexRef\.current/);
  });

  it("the re-hydration effect ALSO depends on the rows (the root cause)", () => {
    // THE ROOT CAUSE of the zeroed ledger in production.
    //
    // The effect used to depend on `[paymentIndex, currentUser]` only.
    // The payments listener and the bookings listener are independent,
    // so the effect could run BEFORE the rows arrived:
    //
    //   1. the index is built -> the effect runs -> `prev.length` is 0
    //      -> it short-circuits
    //   2. the rows are committed UNHYDRATED
    //   3. the index never changes again -> the effect never runs
    //      again -> nothing re-derives the rows
    //
    // Every row then read "PHP 0 paid": the list reported "Balance due
    // 69 / Needs attention 10" and rendered no "Fully paid" pill on any
    // of the 68 rows.
    //
    // Depending on the ROWS makes the effect order-independent:
    // whichever arrives last re-derives the rows.
    expect(
      contextSrc,
      "the re-hydration effect must depend on the rows as well as the index — " +
        "otherwise the hydration is lost the moment the rows arrive after the index"
    ).toMatch(/\}, \[paymentIndex, currentUser, bookings\]\);/);
  });

  it("the legacy denormalized array is still captured as the fallback", () => {
    expect(
      contextSrc,
      "the booking doc's own denormalized array must stay available as the fallback"
    ).toMatch(/legacyOnsitePaymentsRef\.current\[docSnap\.id\]\s*=\s*mappedBooking\.onsitePayments/);
  });
});

describe("SD-4 — a failed ledger subscription must be VISIBLE", () => {
  it("the payments listener handshake has a rejection handler", () => {
    expect(
      contextSrc,
      "a rejected token refresh must be caught, not swallowed"
    ).toMatch(/getIdToken\(true\)\s*\n?\s*\.then\(attachPaymentsLedger\)\s*\n?\s*\.catch\(/);
    expect(contextSrc).toMatch(/attachPaymentsLedger/);
  });

  it("the refunds listener handshake has a rejection handler", () => {
    expect(
      contextSrc,
      "a rejected token refresh must be caught, not swallowed"
    ).toMatch(/getIdToken\(true\)\s*\n?\s*\.then\(attachRefundsLedger\)\s*\n?\s*\.catch\(/);
    expect(contextSrc).toMatch(/attachRefundsLedger/);
  });

  it("a failed attach retries with the SDK's cached token", () => {
    expect(contextSrc).toMatch(/getIdToken\(false\)\s*\n?\s*\.then\(attachPaymentsLedger\)/);
    expect(contextSrc).toMatch(/getIdToken\(false\)\s*\n?\s*\.then\(attachRefundsLedger\)/);
  });
});
