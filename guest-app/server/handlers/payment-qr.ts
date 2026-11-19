// Per decision #320 (2026-11-19): the guest app's payment-method QR
// DOWNLOAD route.
//
//   GET /api/public/payment-qr?method=gcash
//
// WHAT IT IS: the Review & Pay step of the guest booking flow shows
// the selected payment method's QR as a small thumbnail. The guest
// asked to be able to view it full-size and to SAVE it (they want to
// screenshot/scan it, or to send it to someone else paying for them).
// The thumbnail is rendered straight from the admin-uploaded Firebase
// Storage URL, which is a cross-origin link.
//
// WHY A PROXY ROUTE AND NOT A DIRECT LINK:
//
//   1. The `download` attribute is ignored for cross-origin URLs —
//      `<a download={qrUrl}>` NAVIGATES to the image instead of
//      saving it.
//   2. The bucket's CORS allow-list echoes `access-control-allow-origin`
//      only for the origins the hotel configured (on the live
//      deployment: `https://www.sparkinnbohol.com`). A white-label
//      client on another domain gets no allow-origin header, so the
//      browser BLOCKS the `fetch()` that a blob download needs.
//
// A same-origin route sidesteps both: the browser downloads from its
// own origin, the `download` attribute is honoured, and the file name
// is under our control.
//
// WHAT IT EXPOSES: nothing new. The public hotel-config projection
// ALREADY carries `paymentMethods[].qrUrl` for every enabled method —
// the QR file is public by design (the guest has to see it to pay).
// This route only re-serves that same file with a download header.
//
// The upstream URL comes from the ADMIN-CONFIGURED `settings/hotelConfig`
// document (never from the request), so the route cannot be pointed at
// an arbitrary host — there is no SSRF surface here.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  isPaymentQrMethodKey,
  paymentQrFileExtension,
  paymentQrFileName
} from "@spark-inn/shared";
import { loadPublicHotelConfig } from "../lib/publicHotelConfig";

/** A payment QR is a small image; anything larger is not one. */
const MAX_QR_BYTES = 5 * 1024 * 1024;
/** The upstream Storage read must not hold the function open. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Read one query parameter, tolerating both Vercel's parsed
 * `req.query` and a raw `req.url` (the catch-all can hand us either
 * depending on how the request was rewritten).
 */
function readQueryParam(req: VercelRequest, name: string): string {
  const query = (req as any)?.query;
  const value = query?.[name];
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && typeof value[0] === "string") return value[0].trim();
  try {
    const parsed = new URL(req.url || "", `http://${req.headers?.host || "localhost"}`);
    return (parsed.searchParams.get(name) || "").trim();
  } catch {
    return "";
  }
}

/**
 * `GET /api/public/payment-qr` — serve a payment method's QR image
 * with a download disposition.
 */
export async function handleGetPaymentQr(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const methodKey = readQueryParam(req, "method");
  if (!isPaymentQrMethodKey(methodKey)) {
    return res.status(400).json({ success: false, error: "A valid payment method is required." });
  }

  try {
    const config = await loadPublicHotelConfig();
    const method = config.paymentMethods.find((entry) => entry.method === methodKey);

    // The route is NOT an access-control boundary: the public
    // hotel-config projection already carries `qrUrl` for EVERY
    // configured method, so the file is public by design (the guest
    // has to be able to SEE it to pay). Rejecting a method here
    // would only break a legitimate surface — the in-room store
    // panel can show the QR of a method the hotel has disabled for
    // REGULAR bookings (`isEnabled: false` means "not bookable
    // online", not "not payable in the store").
    if (!method || !method.qrUrl) {
      return res.status(404).json({
        success: false,
        error: "No QR code is available for that payment method."
      });
    }

    const upstream = await fetch(method.qrUrl, {
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    });
    if (!upstream.ok) {
      return res.status(502).json({
        success: false,
        error: "The QR code is temporarily unavailable."
      });
    }

    const contentType = (upstream.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    // Only an IMAGE may be proxied. A Storage error page answers with
    // `text/html`, and handing that back as a "QR code" would save a
    // broken file on the guest's phone.
    if (!contentType.startsWith("image/")) {
      return res.status(502).json({
        success: false,
        error: "The QR code is temporarily unavailable."
      });
    }

    const declaredLength = Number(upstream.headers.get("content-length") || "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_QR_BYTES) {
      return res.status(413).json({ success: false, error: "The QR code is too large to download." });
    }

    const bytes = Buffer.from(await upstream.arrayBuffer());
    if (bytes.length === 0) {
      return res.status(502).json({
        success: false,
        error: "The QR code is temporarily unavailable."
      });
    }
    if (bytes.length > MAX_QR_BYTES) {
      return res.status(413).json({ success: false, error: "The QR code is too large to download." });
    }

    const fileName = paymentQrFileName(method.method, paymentQrFileExtension(contentType));
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(bytes.length));
    // `attachment` makes the browser SAVE the file instead of opening
    // it. The guest app also names the file client-side, so the two
    // agree on the name.
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600");
    return res.status(200).send(bytes);
  } catch (error: any) {
    // Deliberately minimal: the upstream URL carries a Storage token,
    // so the raw error (which can embed the URL) is NOT logged.
    console.error(
      "Payment QR download failed:",
      String((error as any)?.message || "unknown error")
    );
    return res.status(500).json({
      success: false,
      error: "The QR code is temporarily unavailable."
    });
  }
}
