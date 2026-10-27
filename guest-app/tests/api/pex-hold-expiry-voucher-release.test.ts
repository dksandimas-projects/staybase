// Per MRB-13 (and the production evidence of 2026-10-27): a booking
// that is cancelled RELEASES the voucher and corporate-code uses it
// consumed.
//
// THE DEFECT
// ----------
// The guest cancel path (`handleCancelBooking`) does this — it
// decrements `vouchers.usageCount` once per cancelled child, with a
// `Math.max(..., 0)` floor. The hold-expiry CRON did NOT.
//
// The cron retires a `pending` booking whose payment hold lapsed. That
// booking may have carried a voucher, and its use was counted when the
// booking was created. The cron cancelled the booking and left the
// usage count where it was, so every hold that lapsed silently burned
// a use of a voucher nobody ever spent.
//
// PRODUCTION EVIDENCE (measured 2026-10-27, before the fix)
// ---------------------------------------------------------------
//   voucher OFFNOW: usageCount = 5
//   bookings carrying OFFNOW: 5
//     SI-20261021-00022  confirmed  walk-in   isTestData=true
//     SI-20261021-00021  confirmed  walk-in   isTestData=true
//     SI-20261025-00050  cancelled  online    cancelledBy=system
//                                    reason=payment-hold-expired
//     SI-20261025-00063  cancelled  online    cancelledBy=system
//                                    reason=payment-hold-expired
//     SI-20261025-00047  cancelled  online    cancelledBy=system
//                                    reason=payment-hold-expired
//
//   → 2 live bookings, but usageCount 5. The 3 expired holds each
//     burned a use. The nightly reconciliation's I12 check caught it
//     as a WARN: "usageCount=5 but 2 live booking(s) carry the code".
//
// THE BUSINESS EFFECT
// -------------------
// A voucher's `usageCap` is consumed by bookings that were never
// completed, so a legitimate guest is refused a voucher that was
// never actually used. The guest who abandoned a booking loses a
// voucher use they never spent.
//
// THE FIX
// -------
// The cron releases the voucher + corporate code in the SAME
// transaction as the cancellation, mirroring `handleCancelBooking`:
// one decrement per cancelled booking, `Math.max(..., 0)` floor,
// `updatedAt` stamp, and the reads issued before the writes
// (the repo's FOL-03 rule).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const holdExpirySrc = readFileSync(
  resolve(__dirname, "../../server/handlers/hold-expiry.ts"),
  "utf8"
);

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// The retirement block — the transaction that flips the booking to
// `cancelled`. Everything the release must live inside.
const retirementBlock = holdExpirySrc.match(
  /const retired = await adminDb\.runTransaction[\s\S]*?\n        \}\);/
);
if (!retirementBlock) {
  throw new Error(
    "hold-expiry test setup: could not find the retirement transaction in hold-expiry.ts"
  );
}
const retirementSrc = retirementBlock[0];

describe("MRB-13 — the hold-expiry cron releases the voucher it consumed", () => {
  it("the retirement transaction reads the voucher's usageCount", () => {
    // A decrement needs the current value. Without the read, the
    // write would be a blind overwrite and could clobber a
    // concurrent increment.
    expect(retirementSrc).toMatch(/transaction\.get\(vRef\)/);
    expect(retirementSrc).toMatch(/collection\("vouchers"\)/);
  });

  it("the retirement transaction decrements the voucher usageCount", () => {
    // The release, with the same `Math.max(..., 0)` floor the guest
    // cancel path uses. Without the floor a double-release would
    // drive the count negative.
    expect(retirementSrc).toMatch(
      /usageCount: Math\.max\(\(Number\(vData\.usageCount\) \|\| 0\) - 1, 0\)/
    );
  });

  it("the retirement transaction also releases the corporate code", () => {
    // A corporate booking consumes a corporate-code use the same way
    // it consumes a voucher use. Releasing only the voucher would
    // leave the same drift on the corporate-code counter.
    expect(retirementSrc).toMatch(/collection\("corporateCodes"\)/);
    expect(retirementSrc).toMatch(
      /usageCount: Math\.max\(\(Number\(cpData\.usageCount\) \|\| 0\) - 1, 0\)/
    );
  });

  it("the release happens INSIDE the cancellation transaction", () => {
    // A release outside the transaction could fail while the
    // cancellation committed — the same class of drift, just slower.
    const releaseIndex = retirementSrc.indexOf('collection("vouchers")');
    const cancelIndex = retirementSrc.indexOf('status: "cancelled"');
    expect(releaseIndex).toBeGreaterThan(-1);
    expect(cancelIndex).toBeGreaterThan(-1);
    // Both are inside the same `runTransaction` block — the release
    // is not a separate call after the transaction.
    expect(retirementSrc).toContain("runTransaction");
  });

  it("the release mirrors the guest cancel path's shape", () => {
    // The guest cancel path is the reference implementation. Both must
    // floor at 0 and stamp `updatedAt`, so the two paths cannot drift
    // into different arithmetic.
    const cancelPath = bookingsSrc.match(
      /for \(const \[code, count\] of voucherCounts\.entries\(\)\) \{[\s\S]*?\n        \}/
    );
    expect(cancelPath, "the guest cancel path's voucher release must exist").toBeTruthy();
    expect(cancelPath![0]).toMatch(/Math\.max\(\(Number\(vData\.usageCount\) \|\| 0\) - count, 0\)/);
    expect(cancelPath![0]).toMatch(/updatedAt: now/);

    expect(retirementSrc).toMatch(/updatedAt: now/);
  });

  it("the cron does not double-release a booking that carries no code", () => {
    // A booking with no voucher must not decrement anything — the
    // release is guarded by the code being present.
    expect(retirementSrc).toMatch(
      /const voucherCode = String\(freshData\.voucherCode \|\| ""\)\.trim\(\)\.toUpperCase\(\)/
    );
    expect(retirementSrc).toMatch(/if \(voucherCode\) \{/);
    expect(retirementSrc).toMatch(/if \(corporateCode\) \{/);
  });
});
