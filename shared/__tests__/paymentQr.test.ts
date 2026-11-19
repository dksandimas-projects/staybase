// Per decision #320 (2026-11-19): the payment-method QR DOWNLOAD
// contract.
//
// The guest app saves a payment QR through a SAME-ORIGIN route
// (`GET /api/public/payment-qr?method=<key>`), because the
// admin-uploaded file lives on a cross-origin Storage URL where the
// `download` attribute is ignored and the bucket's CORS allow-list
// does not cover a white-label domain.
//
// These are the pure helpers both sides share: the guest app names the
// saved file with `paymentQrFileName`, and the server sets
// `Content-Disposition` with the SAME helper, so the two cannot drift.

import { describe, expect, it } from "vitest";
import {
  PAYMENT_QR_DOWNLOAD_PATH,
  isPaymentQrMethodKey,
  paymentQrDownloadUrl,
  paymentQrFileExtension,
  paymentQrFileName
} from "../utils/paymentQr";

describe("decision #320 — the payment QR download contract", () => {
  it("accepts the admin-configured method keys and rejects anything else", () => {
    // The keys the hotel actually configures.
    expect(isPaymentQrMethodKey("gcash")).toBe(true);
    expect(isPaymentQrMethodKey("bpi")).toBe(true);
    expect(isPaymentQrMethodKey("pay-at-hotel")).toBe(true);
    expect(isPaymentQrMethodKey("paypal")).toBe(true);

    // Anything that could escape a file name or a lookup.
    expect(isPaymentQrMethodKey("")).toBe(false);
    expect(isPaymentQrMethodKey("   ")).toBe(false);
    expect(isPaymentQrMethodKey("../etc/passwd")).toBe(false);
    expect(isPaymentQrMethodKey("gcash/../../x")).toBe(false);
    expect(isPaymentQrMethodKey("GCASH")).toBe(false);
    expect(isPaymentQrMethodKey("gcash.png")).toBe(false);
    expect(isPaymentQrMethodKey("a".repeat(65))).toBe(false);
    expect(isPaymentQrMethodKey(null)).toBe(false);
    expect(isPaymentQrMethodKey(undefined)).toBe(false);
    expect(isPaymentQrMethodKey(42)).toBe(false);
  });

  it("builds a same-origin download URL", () => {
    expect(PAYMENT_QR_DOWNLOAD_PATH).toBe("/api/public/payment-qr");
    expect(paymentQrDownloadUrl("gcash")).toBe("/api/public/payment-qr?method=gcash");
    // The key is URL-encoded even though the accepted shape is
    // restrictive — the helper never assumes the caller's input.
    expect(paymentQrDownloadUrl("a b")).toBe("/api/public/payment-qr?method=a%20b");
  });

  it("derives the extension from the content type", () => {
    expect(paymentQrFileExtension("image/png")).toBe("png");
    expect(paymentQrFileExtension("image/png; charset=binary")).toBe("png");
    expect(paymentQrFileExtension("image/jpeg")).toBe("jpg");
    expect(paymentQrFileExtension("image/webp")).toBe("webp");
    expect(paymentQrFileExtension("image/gif")).toBe("gif");
    expect(paymentQrFileExtension("image/svg+xml")).toBe("svg");
    // Unknown / hostile content types fall back to `png`.
    expect(paymentQrFileExtension("text/html")).toBe("png");
    expect(paymentQrFileExtension("")).toBe("png");
    expect(paymentQrFileExtension("image/png.exe")).toBe("png");
  });

  it("names the downloaded file after the method key", () => {
    expect(paymentQrFileName("gcash")).toBe("gcash-qr-code.png");
    expect(paymentQrFileName("bpi", "jpg")).toBe("bpi-qr-code.jpg");
    expect(paymentQrFileName("pay-at-hotel", "webp")).toBe("pay-at-hotel-qr-code.webp");

    // A key that is not in the accepted shape still yields a safe name.
    expect(paymentQrFileName("../../etc/passwd")).toBe("etc-passwd-qr-code.png");
    expect(paymentQrFileName("")).toBe("payment-qr-code.png");

    // A hostile extension cannot escape the `.png` fallback.
    expect(paymentQrFileName("gcash", "png\"; rm -rf /")).toBe("gcash-qr-code.png");
  });
});
