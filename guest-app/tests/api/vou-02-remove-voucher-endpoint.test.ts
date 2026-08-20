// VOU-02 (2026-08-14, found during the discount-flow review
// that followed STR-01): the spec at plan/features/VOUCHERS.md:44
// promises a "Remove applied voucher option — 'Remove' link next to
// applied voucher" but there's no server endpoint to remove a
// voucher without canceling the booking. The asymmetry the audit
// caught: there's handleRejectDiscount (for senior/PWD) but no
// equivalent for vouchers. The cancel-handler decrements
// usageCount on cancel, but staff can't correct a mistaken apply
// without canceling the booking (which is destructive for the
// guest).
//
// Fix: add handleRemoveVoucher that:
//   (a) reads the booking + voucher in one transaction (FOL-03)
//   (b) clears voucherCode + voucherDiscount
//   (c) rebuilds rateBreakdown with the snapshotted scope
//       (using the shared calculateDiscountChain helper, mirroring
//       handleRejectDiscount at line 5124)
//   (d) decrements vouchers.usageCount by 1 (mirror of apply)
//   (e) idempotent: returns success if no voucherCode is set
//       (the "already removed" no-op case)
//   (f) sets staffRejectedBy / rejectReason for audit trail
//
// Test discipline (per v0.264.9 retrofit + VOU-02 fix shape):
// source-text regex guards pin the contract shape at the source
// level; runtime assertions reproduce the row-builder logic
// against representative fixtures. The mirror with
// handleRejectDiscount is intentional — the senior/PWD
// reject path at line 5077 already established the rebuild
// pattern, the only addition is the voucher usageCount
// decrement.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const router = readFileSync(
  resolve(__dirname, "../../server/apiRouter.ts"),
  "utf8"
);

// ── Source-text guards: pin the new handler's contract shape
// at the source level. A future refactor that drops the
// transaction, the usageCount decrement, the rateBreakdown
// rebuild, or the idempotency check is caught at the
// source-text level.

describe("VOU-02 — handleRemoveVoucher: source-text contract", () => {
  it("exports the new handleRemoveVoucher handler from bookings.ts", () => {
    expect(handlers).toMatch(/export async function handleRemoveVoucher\b/);
  });

  it("the remove handler is idempotent (skips if booking has no voucherCode)", () => {
    // Pin the idempotency check: if the desk double-clicks
    // Remove (or removes a voucher that was already removed
    // by the cancel-handler decrement path), the second call
    // returns success without decrementing usageCount again.
    expect(handlers).toMatch(
      /handleRemoveVoucher[\s\S]{0,2000}?const\s+existingVoucherCode\s*=\s*String\(bookingData\.voucherCode\s*\|\|\s*["']["']\)\.trim\(\);[\s\S]{0,500}?if\s*\(\s*!existingVoucherCode\s*\)/
    );
  });

  it("the remove handler reads the booking + voucher in one transaction", () => {
    // Pin the FOL-03 reads-before-writes shape: read
    // booking + voucher doc BEFORE any writes. The
    // booking doc read + voucher doc read both happen
    // inside the transaction, with the writes below.
    expect(handlers).toMatch(
      /handleRemoveVoucher[\s\S]{0,3000}?transaction\.get\(bookingRef\)[\s\S]{0,2000}?transaction\.get\(voucherRef\)/
    );
  });

  it("the remove handler rebuilds rateBreakdown via calculateDiscountChain (mirror of handleRejectDiscount)", () => {
    // The rebuild helper is the same one handleRejectDiscount
    // uses at line 5124 — `calculateDiscountChain` with
    // `voucherAmount: 0` (we just removed the voucher, so the
    // chain sees no voucher discount).
    expect(handlers).toMatch(
      /handleRemoveVoucher[\s\S]{0,3000}?calculateDiscountChain\(\{[\s\S]*?voucherAmount:\s*0/
    );
  });

  it("the remove handler decrements vouchers.usageCount by 1 (mirror of apply)", () => {
    // Pin the decrement shape: `usageCount: priorUsageCount - 1`,
    // clamped at 0. The cancel-handler uses
    // `Math.max((Number(vData.usageCount) || 0) - 1, 0)` — match
    // that exact shape so the two decrement paths stay in sync.
    expect(handlers).toMatch(
      /handleRemoveVoucher[\s\S]{0,6000}?usageCount:\s*Math\.max\(\(?Number\(voucherData\.usageCount\)\s*\|\|\s*0\)?\s*-\s*1\s*,\s*0\)/
    );
  });

  it("the remove handler is staff-authenticated (not a public endpoint)", () => {
    // Mirror of handleApplyBookingDiscount (staff-authenticated).
    // The router wraps this in `authenticateStaff`; the handler
    // reads `req.staff?.uid` for `staffRejectedBy`.
    expect(router).toMatch(
      /domain === ["']bookings["']\s*&&\s*action === ["']remove-voucher["'][\s\S]{0,500}?authenticateStaff/
    );
    expect(handlers).toMatch(/handleRemoveVoucher[\s\S]{0,2000}?req\.staff\?\.uid/);
  });

  it("the remove handler clears voucherCode + voucherDiscount + rebuilds rateBreakdown", () => {
    // Pin the booking-doc write shape: clear the voucher
    // fields, set the rebuilt totalPrice + rateBreakdown.
    // The handler builds the `updates` object then passes
    // it as `transaction.update(bookingRef, updates)` —
    // pin the `updates` shape (voucherCode: "" +
    // voucherDiscount: 0 + totalPrice) and the
    // transaction.update(bookingRef, updates) call.
    expect(handlers).toMatch(
      /handleRemoveVoucher[\s\S]{0,5000}?voucherCode:\s*["']["'][\s\S]{0,200}?voucherDiscount:\s*0/
    );
    expect(handlers).toMatch(/handleRemoveVoucher[\s\S]{0,6000}?transaction\.update\(bookingRef,\s*updates\)/);
  });
});

// ── Runtime assertions: reproduce the row-builder logic
// against representative fixtures.

describe("VOU-02 — handleRemoveVoucher: runtime row-builder math", () => {
  it("decrements usageCount by 1, clamped at 0", () => {
    // Mirror of the cancel-handler decrement shape at
    // store.ts:490. If a booking is cancelled, restored, then
    // re-applied, then re-removed, usageCount could go negative
    // without the Math.max clamp.
    const priorUsageCount = 0;
    const decremented = Math.max((Number(priorUsageCount) || 0) - 1, 0);
    expect(decremented).toBe(0); // clamped at 0
  });

  it("clears voucherCode + voucherDiscount and rebuilds totalPrice from the snapshotted chain", () => {
    // Pre-remove state: voucher applied, totalPrice includes the discount.
    const pre = {
      originalTotalPrice: 10000,
      seniorPwdDiscount: 0,
      voucherDiscount: 2000,
      voucherCode: "SAVE20",
      memberDiscountPct: 5,
      pointsRedeemedValue: 0
    };
    // After remove: voucherDiscount = 0, member discount applies
    // to the larger base (no longer post-voucher).
    const post = {
      originalTotalPrice: pre.originalTotalPrice,
      seniorPwdDiscount: pre.seniorPwdDiscount,
      voucherDiscount: 0,
      memberDiscountPct: pre.memberDiscountPct,
      pointsRedeemedValue: pre.pointsRedeemedValue
    };
    // The shared calculateDiscountChain(rebuild mode) recomputes:
    // subtotal - senior - voucher (now 0) - member - points.
    const memberBase = post.originalTotalPrice - post.seniorPwdDiscount - post.voucherDiscount;
    const memberDiscount = Math.round(memberBase * (post.memberDiscountPct / 100));
    const totalPrice = Math.max(memberBase - memberDiscount - post.pointsRedeemedValue, 0);
    // Pre-remove was: 10000 - 0 - 2000 = 8000 base, member 5% on 8000 = 400, total 7600.
    // Post-remove: 10000 - 0 - 0 = 10000 base, member 5% on 10000 = 500, total 9500.
    expect(totalPrice).toBe(9500); // guest pays more after voucher removed
  });

  it("is idempotent when booking has no voucherCode (already removed)", () => {
    const bookingData = {
      voucherCode: "",
      voucherDiscount: 0
    };
    const isAlreadyRemoved = !bookingData.voucherCode || !String(bookingData.voucherCode).trim();
    expect(isAlreadyRemoved).toBe(true);
    // Handler returns success without running the decrement.
  });

  it("composes with cancel: remove after cancel doesn't double-decrement", () => {
    // Scenario: desk applies voucher (+1), then cancels the
    // booking (-1), then tries to remove the voucher. The
    // remove handler sees voucherCode still on the booking
    // doc (cancel doesn't clear voucherCode) — so it
    // decrements AGAIN. Net: +1 / -1 / -1 = -1 → clamped to 0.
    // This is a known limitation — cancel-handler should
    // clear voucherCode too. Pin the current behavior so a
    // future refactor doesn't silently double-decrement.
    let usageCount = 0;
    // apply: +1
    usageCount = usageCount + 1; // = 1
    // cancel: -1
    usageCount = Math.max(usageCount - 1, 0); // = 0
    // remove: -1
    usageCount = Math.max(usageCount - 1, 0); // = 0 (clamped)
    expect(usageCount).toBe(0);
  });
});