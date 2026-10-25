import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("BookingPage.tsx — voucher application", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/BookingPage.tsx"),
    "utf8"
  );

  it("calculates percent voucher preview from the post-Senior/PWD base", () => {
    const voucherMemo = src.match(/const voucherDiscount = useMemo\(\(\) => \{[\s\S]+?\}, \[voucherApplied/);
    expect(voucherMemo, "voucherDiscount useMemo not found").toBeTruthy();
    expect(voucherMemo![0]).toMatch(/seniorPwdDiscount/);
    expect(voucherMemo![0]).toMatch(/voucherBase/);
    expect(voucherMemo![0]).toMatch(/Math\.round\(voucherBase \* \(voucherDiscountValue \/ 100\)\)/);
  });

  it("stores the canonical voucher code returned by validation", () => {
    expect(src).toMatch(/setVoucherCode\(result\.data\.code \|\| code\)/);
  });

  it("does not submit voucher validation before Turnstile is ready", () => {
    // Per QA-2026-10-23 §3.2 (2026-10-25): the token requirement is
    // conditional on the hotel-wide bot-protection mode — it still
    // applies in the default mode, and it is skipped only when the
    // mode is "disabled" (the server does not ask for a token then).
    expect(src).toMatch(/if \(!isBotProtectionDisabled && !turnstileToken\)\s*\{/);
    expect(src).toMatch(/Security check is still loading/);
    expect(src).toMatch(/disabled=\{isValidatingVoucher \|\| !voucherCode\.trim\(\) \|\| \(!isBotProtectionDisabled && !turnstileToken\)\}/);
  });

  it("clears an applied voucher when the code text changes", () => {
    expect(src).toMatch(/setVoucherApplied\(false\);[\s\S]+?setVoucherDiscountValue\(0\);[\s\S]+?setVoucherError\(""\);/);
  });
});
