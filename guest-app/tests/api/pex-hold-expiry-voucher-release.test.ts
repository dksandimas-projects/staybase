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

const voucherReleaseSrc = readFileSync(
  resolve(__dirname, "../../server/lib/voucherRelease.ts"),
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
  it("the cron calls the SHARED release helper", () => {
    // One implementation of the release, called from every
    // cancellation site. A second implementation is a second thing
    // that can drift — and the drift is what shipped the missing
    // release in the first place.
    expect(holdExpirySrc).toMatch(/readVoucherReleases\(transaction, \[/);
    expect(holdExpirySrc).toMatch(/readCorporateCodeReleases\(transaction, \[/);
    expect(holdExpirySrc).toMatch(/applyVoucherReleases\(transaction, voucherRelease\)/);
    expect(holdExpirySrc).toMatch(/applyCorporateCodeReleases\(transaction, corporateRelease\)/);
  });

  it("the release READ happens BEFORE the booking write (Firestore FOL-03)", () => {
    // Firestore requires every read in a transaction to precede
    // every write. A read after a write throws at commit time and
    // the whole cancellation is lost — which is how a release can
    // silently stop happening.
    const readAt = holdExpirySrc.indexOf("const voucherRelease = await readVoucherReleases(");
    const writeAt = holdExpirySrc.indexOf("transaction.update(doc.ref, {");
    const applyAt = holdExpirySrc.indexOf("applyVoucherReleases(transaction, voucherRelease)");

    expect(readAt, "the release read must exist").toBeGreaterThan(-1);
    expect(writeAt, "the booking write must exist").toBeGreaterThan(-1);
    expect(applyAt, "the release apply must exist").toBeGreaterThan(-1);

    expect(readAt, "the release READ must come before the booking write").toBeLessThan(writeAt);
    expect(applyAt, "the release APPLY must come after the booking write").toBeGreaterThan(writeAt);
  });

  it("the release releases ONE use per retired booking", () => {
    // The cron retires exactly ONE booking, so it releases exactly one
    // use. The count is the caller's, because the guest cancel path
    // releases one use per cancelled CHILD.
    expect(holdExpirySrc).toMatch(/code: String\(freshData\.voucherCode \|\| ""\),\s*\n\s*count: 1,/);
  });
});

describe("MRB-13 — the shared release helper", () => {
  it("decrements the usageCount, floored at zero", () => {
    // The floor is the point of the whole release: a count that is
    // already 0 must not go negative. Without it, a double-release
    // drives the count below zero and the voucher looks like it has
    // unlimited uses.
    expect(voucherReleaseSrc).toMatch(
      /usageCount: Math\.max\(\(Number\(data\.usageCount\) \|\| 0\) - count, 0\)/
    );
  });

  it("stamps the released document with the caller's timestamp", () => {
    expect(voucherReleaseSrc).toMatch(/updatedAt: now/);
  });

  it("sums repeated codes so two uses of one voucher release two", () => {
    // Two bookings that used the SAME voucher consume two uses of it,
    // so retiring both must release two — not one.
    expect(voucherReleaseSrc).toMatch(/existing\.count \+= count/);
  });

  it("is a no-op for an unknown code or a zero count", () => {
    // A booking that never had a voucher must release nothing, and
    // must not throw — a caller can pass it unconditionally.
    expect(voucherReleaseSrc).toMatch(
      /if \(!code \|\| !Number\.isFinite\(count\) \|\| count <= 0\) continue;/
    );
    expect(voucherReleaseSrc).toMatch(/if \(!voucherDoc\.exists\) continue;/);
  });

  it("has the same corporate-code twin, with the same rules", () => {
    // A corporate booking consumes a corporate-code use the same way
    // it consumes a voucher use, so it must be released the same way.
    expect(voucherReleaseSrc).toMatch(/export async function readCorporateCodeReleases/);
    expect(voucherReleaseSrc).toMatch(/export function applyCorporateCodeReleases/);
    expect(voucherReleaseSrc).toMatch(/collection\("corporateCodes"\)/);
    expect(voucherReleaseSrc).toMatch(
      /usageCount: Math\.max\(\(Number\(data\.usageCount\) \|\| 0\) - count, 0\)/
    );
  });

  it("the guest cancel path uses the same floor, so the two cannot drift", () => {
    const cancelPath = bookingsSrc.match(
      /for \(const \[code, count\] of voucherCounts\.entries\(\)\) \{[\s\S]*?\n        \}/
    );
    expect(cancelPath, "the guest cancel path's voucher release must exist").toBeTruthy();
    expect(cancelPath![0]).toMatch(/Math\.max\(\(Number\(vData\.usageCount\) \|\| 0\) - count, 0\)/);
  });
});
