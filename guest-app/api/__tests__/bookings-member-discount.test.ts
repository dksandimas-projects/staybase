import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 #3 (Top-5 #3): member discount was shown
// to the guest client-side but never applied server-side. Per W2.2 /
// decision #90, the server is authoritative: it detects the member via
// the Authorization Bearer token, looks up settings/rewardsConfig for
// the configured pct, and applies the 3rd stacking step.

describe("bookings.ts — member discount server-side (SEV-1 #3)", () => {
  const src = readFileSync(
    resolve(__dirname, "../handlers/bookings.ts"),
    "utf8"
  );

  it("verifies the Firebase ID token from the Authorization header", () => {
    // Pattern: adminAuth.verifyIdToken(idToken)
    expect(src).toMatch(/adminAuth\.verifyIdToken\(\s*idToken\s*\)/);
  });

  it("looks up the member by uid from the decoded token", () => {
    // Pattern: members/{uid} via get() with memberSnap.exists
    expect(src).toMatch(/collection\(["']members["']\)\.doc\(\s*decoded\.uid\s*\)/);
    expect(src).toMatch(/memberSnap\.exists/);
  });

  it("requires the member to be isMember and isActive", () => {
    expect(src).toMatch(/m\.isMember\s*!==\s*false/);
    expect(src).toMatch(/m\.isActive\s*!==\s*false/);
  });

  it("reads settings/rewardsConfig for memberDiscountPct", () => {
    expect(src).toMatch(/collection\(["']settings["']\)\.doc\(["']rewardsConfig["']\)/);
    expect(src).toMatch(/rc\.memberDiscountPct/);
    expect(src).toMatch(/rc\.memberDiscountEnabled/);
  });

  it("sets memberId on the booking when a member is detected", () => {
    // The booking record should now have memberId set from detectedMemberId
    expect(src).toMatch(/memberId:\s*detectedMemberId/);
  });

  it("records memberDiscountPct on the booking for audit trail", () => {
    expect(src).toMatch(/memberDiscountPct:\s*memberDiscountPct/);
  });

  it("applies member discount as 3rd stacking step (post-voucher)", () => {
    // The math should be: memberDiscount = round(afterVoucher × pct/100)
    // and totalPrice = afterVoucher - memberDiscount
    expect(src).toMatch(/afterVoucher\s*\*\s*\(memberDiscountPct\s*\/\s*100\)/);
    expect(src).toMatch(/afterVoucher\s*-\s*memberDiscount/);
  });

  it("uses 3-tier stacking: senior/PWD → voucher → member (per #13b)", () => {
    // The code should compute afterVoucher from afterSeniorPwd
    expect(src).toMatch(/afterSeniorPwd\s*-\s*voucherDiscount/);
    expect(src).toMatch(/subtotal\s*-\s*seniorPwdDiscount/);
  });
});
