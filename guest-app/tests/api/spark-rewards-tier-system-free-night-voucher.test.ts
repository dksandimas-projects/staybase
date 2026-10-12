import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Per Phase 5 of the Spark Rewards tier system (2026-10-12,
// decision pending): source-text pins for the free-night
// reward voucher. The schema is extended with `kind` +
// `valueType` discriminators (backward-compat with pre-Phase-5
// promo vouchers), the checkout handler writes the reward
// voucher inside the existing transaction when
// `completedStays % freeNightEvery === 0`, and the admin voucher
// table gains a Kind column. Runtime tests cover the existing
// points-credit / voucher-usage flow — Phase 5 is additive so
// no existing test should regress.

const bookingsSrc = readFileSync(
  join(import.meta.dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const vouchersSrc = readFileSync(
  join(import.meta.dirname, "../../../shared/utils/vouchers.ts"),
  "utf8"
);

const adminCtxSrc = readFileSync(
  join(import.meta.dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

const ratesPageSrc = readFileSync(
  join(import.meta.dirname, "../../../admin-app/src/pages/RatesPage.tsx"),
  "utf8"
);

describe("shared/utils/vouchers.ts — Phase 5 schema extension", () => {
  it("extends VoucherLike with kind, valueType, memberId, memberNumber, rewardSource", () => {
    expect(vouchersSrc).toMatch(/kind\?:\s*["']promo["']\s*\|\s*["']reward["']/);
    expect(vouchersSrc).toMatch(/valueType\?:\s*["']percent["']\s*\|\s*["']flat["']\s*\|\s*["']free-night["']/);
    expect(vouchersSrc).toMatch(/memberId\?:\s*string\s*\|\s*null/);
    expect(vouchersSrc).toMatch(/memberNumber\?:\s*string\s*\|\s*null/);
    expect(vouchersSrc).toMatch(/rewardSource\?:\s*["']free-night-tier["']\s*\|\s*["']welcome["']\s*\|\s*null/);
  });

  it("exports isRewardVoucher + isFreeNightVoucher discriminators", () => {
    expect(vouchersSrc).toMatch(/export function isRewardVoucher/);
    expect(vouchersSrc).toMatch(/export function isFreeNightVoucher/);
    expect(vouchersSrc).toMatch(/voucher\.kind === ["']reward["']/);
    expect(vouchersSrc).toMatch(/voucher\.valueType === ["']free-night["']/);
  });

  it("exports generateFreeNightVoucherCode with deterministic format", () => {
    // Format: FREENIGHT-{memberNumber}-{completedStays}
    expect(vouchersSrc).toMatch(/export function generateFreeNightVoucherCode/);
    expect(vouchersSrc).toMatch(/FREENIGHT-/);
    expect(vouchersSrc).toMatch(/replace\(\/\[\^A-Z0-9_-\]\/gi,\s*["']["']\)/);
  });
});

describe("bookings.ts — Phase 5 free-night voucher write", () => {
  it("writes the free-night voucher inside the existing checkout transaction", () => {
    // The voucher write must be inside the same transaction as
    // the completedStays++ — a retry can't double-award.
    expect(bookingsSrc).toMatch(/freeNightEvery\s*=\s*Number\(rewardsConfig\?\.freeNightEvery\s*\|\|\s*0\)/);
    expect(bookingsSrc).toMatch(/nextCompletedStays\s*>\s*0/);
    expect(bookingsSrc).toMatch(/nextCompletedStays\s*%\s*freeNightEvery\s*===\s*0/);
  });

  it("uses the canonical Phase 5 voucher shape (kind + valueType discriminators)", () => {
    expect(bookingsSrc).toMatch(/kind:\s*["']reward["']/);
    expect(bookingsSrc).toMatch(/valueType:\s*["']free-night["']/);
    expect(bookingsSrc).toMatch(/discountType:\s*["']percent["']/);
    expect(bookingsSrc).toMatch(/discountValue:\s*100/);
    expect(bookingsSrc).toMatch(/usageCap:\s*1/);
  });

  it("back-links the voucher to the member who earned it", () => {
    // Used by the member portal (Phase 7) to surface available
    // free-night vouchers and by the admin filter.
    expect(bookingsSrc).toMatch(/memberId,/);
    expect(bookingsSrc).toMatch(/memberNumber,/);
    expect(bookingsSrc).toMatch(/rewardSource:\s*["']free-night-tier["']/);
  });

  it("sets a 90-day expiry", () => {
    expect(bookingsSrc).toMatch(/90\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it("generates the voucher code deterministically from memberNumber + completedStays", () => {
    expect(bookingsSrc).toMatch(/FREENIGHT-\$\{memberNumber\}-\$\{nextCompletedStays\}/);
  });
});

describe("admin-app — Phase 5 voucher table updates", () => {
  it("extends the admin Voucher interface with the Phase 5 fields", () => {
    expect(adminCtxSrc).toMatch(/kind\?:\s*["']promo["']\s*\|\s*["']reward["']/);
    expect(adminCtxSrc).toMatch(/valueType\?:\s*["']percent["']\s*\|\s*["']flat["']\s*\|\s*["']free-night["']/);
    expect(adminCtxSrc).toMatch(/memberId\?:\s*string\s*\|\s*null/);
    expect(adminCtxSrc).toMatch(/memberNumber\?:\s*string\s*\|\s*null/);
  });

  it("maps the Firestore voucher doc to the Voucher interface with safe defaults", () => {
    // Pre-Phase-5 docs are missing the new keys — treat as
    // legacy promo voucher.
    expect(adminCtxSrc).toMatch(/kind:\s*data\.kind\s*\|\|\s*["']promo["']/);
    expect(adminCtxSrc).toMatch(/valueType:\s*data\.valueType\s*\|\|\s*data\.discountType\s*\|\|\s*["']flat["']/);
    expect(adminCtxSrc).toMatch(/memberId:\s*data\.memberId\s*\|\|\s*null/);
    expect(adminCtxSrc).toMatch(/memberNumber:\s*data\.memberNumber\s*\|\|\s*null/);
  });

  it("renders the Kind column with distinct badges for promo vs free-night reward", () => {
    // Pattern is split across multiple lines + nested ternaries —
    // match the substrings instead of a literal multi-line regex.
    expect(ratesPageSrc).toMatch(/row\.kind === ["']reward["']/);
    expect(ratesPageSrc).toMatch(/row\.valueType === ["']free-night["']\s*\?\s*["']Free Night["']/);
    expect(ratesPageSrc).toMatch(/["']Promo["']/);
  });

  it("renders the Member column for reward vouchers", () => {
    expect(ratesPageSrc).toMatch(/row\.memberNumber\s*\?\s*row\.memberNumber\s*:\s*<span/);
  });
});