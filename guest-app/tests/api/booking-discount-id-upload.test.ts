import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("BookingPage.tsx — Senior/PWD discount ID upload", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/BookingPage.tsx"),
    "utf8"
  );

  it("uses a sanitized filename for the Firebase Storage discount-id path", () => {
    expect(src).toMatch(/function\s+sanitizeUploadFileName/);
    expect(src).toMatch(/const\s+safeFileName\s*=\s*sanitizeUploadFileName\(compressed\.file\.name\)/);
    expect(src).toMatch(/`bookings\/\$\{bookingId\}\/discount-id\/\$\{safeFileName\}`/);
  });

  it("uses high-quality compression settings so ID card text stays readable", () => {
    expect(src).toMatch(/const\s+DISCOUNT_ID_COMPRESSION_OPTIONS\s*=/);
    expect(src).toMatch(/maxWidth:\s*2200/);
    expect(src).toMatch(/maxHeight:\s*2200/);
    expect(src).toMatch(/quality:\s*0\.94/);
    expect(src).toMatch(/compressImageFile\(file,\s*DISCOUNT_ID_COMPRESSION_OPTIONS\)/);
  });

  it("shows discount ID upload failures inline instead of using alert", () => {
    const discountUploadHandler = src.match(
      /async function handleDiscountIdChange[\s\S]+?async function handlePaymentProofChange/
    );

    expect(discountUploadHandler, "handleDiscountIdChange block not found").toBeTruthy();
    expect(discountUploadHandler![0]).toMatch(/setDiscountIdUploadError/);
    expect(discountUploadHandler![0]).not.toMatch(/alert\(/);
    expect(src).toMatch(/role="alert"[\s\S]+?\{discountIdUploadError\}/);
  });

  it("resets the hidden file input after success, validation failure, failure, and delete", () => {
    const resetCalls = src.match(/resetDiscountIdInput\(\)/g) ?? [];
    expect(resetCalls.length).toBeGreaterThanOrEqual(2);
    expect(src).toMatch(/e\.target\.value\s*=\s*""/);
    expect(src).toMatch(/ref=\{discountIdInputRef\}/);
  });
});
