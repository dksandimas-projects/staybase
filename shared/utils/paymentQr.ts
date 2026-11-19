// Per decision #320 (2026-11-19): the payment-method QR DOWNLOAD
// contract.
//
// WHY A SERVER ROUTE AND NOT A DIRECT LINK: the admin uploads each
// payment-method QR to Firebase Storage and the public hotel-config
// projection exposes the `getDownloadURL()` result. That URL is a
// cross-origin `firebasestorage.googleapis.com` link, and:
//
//   1. The bucket's CORS allow-list echoes `access-control-allow-origin`
//      ONLY for the origins the hotel configured (on the live
//      deployment: `https://www.sparkinnbohol.com`). A white-label
//      client on another domain gets NO allow-origin header, so the
//      browser blocks `fetch()` on it.
//   2. The `download` attribute is IGNORED for cross-origin URLs — the
//      browser navigates to the image instead of saving it.
//
// So a `<a download={qrUrl}>` cannot produce a save on a white-label
// domain, and a `fetch()` + blob + anchor download is CORS-blocked
// there. The robust answer is a SAME-ORIGIN route that proxies the
// configured file and answers with `Content-Disposition: attachment`.
// The guest app then downloads from its own origin, and the file name
// is ours to control.
//
// The QR file itself is already public (the public hotel-config payload
// carries `qrUrl`), so the route exposes NOTHING new.
//
// This module owns the pieces both sides must agree on: the route
// path, the method-key shape, the download URL and the file name. The
// server (which sets `Content-Disposition`) and the guest app (which
// names the saved file) import the SAME functions, so the two cannot
// drift.

/** The same-origin route that serves the QR file for download. */
export const PAYMENT_QR_DOWNLOAD_PATH = "/api/public/payment-qr";

/**
 * The shape of a payment-method key the download route accepts.
 *
 * The keys are admin-configured (`gcash`, `bpi`, `paypal`, ...), so
 * this is deliberately narrow: lowercase letters, digits and dashes,
 * starting with a letter or digit. The key is interpolated into a
 * file name and into a Firestore lookup, so a restrictive pattern is
 * the right default.
 */
export function isPaymentQrMethodKey(value: unknown): boolean {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value.trim());
}

/**
 * The same-origin URL the guest app downloads a method's QR from.
 *
 * @param methodKey The admin-configured payment-method key.
 */
export function paymentQrDownloadUrl(methodKey: string): string {
  return `${PAYMENT_QR_DOWNLOAD_PATH}?method=${encodeURIComponent(methodKey.trim())}`;
}

/**
 * The file extension for a QR image, derived from its content type.
 *
 * The upstream `Content-Type` decides the extension — a JPEG QR must
 * not be saved as a `.png` (some scanners and OS previews key off the
 * extension). Anything unknown falls back to `png`, which is what the
 * admin upload path produces.
 */
export function paymentQrFileExtension(contentType: string): string {
  const normalized = (contentType || "").split(";")[0].trim().toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/svg+xml") return "svg";
  return "png";
}

/**
 * The file name a downloaded QR is saved under.
 *
 * @param methodKey The admin-configured payment-method key.
 * @param extension The file extension (no dot).
 */
export function paymentQrFileName(methodKey: string, extension = "png"): string {
  const slug =
    (methodKey || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "payment";
  const safeExtension = /^[a-z0-9]{1,8}$/.test(extension) ? extension : "png";
  return `${slug}-qr-code.${safeExtension}`;
}
