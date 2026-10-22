// Per F09 / SEC-6 / SEC-5 (2026-10-22, P2 revenue leak): the public
// read handlers that replace the anonymous Firestore read of
// `settings/hotelConfig`.
//
//   GET /api/public/hotel-config
//     The PUBLIC projection of `settings/hotelConfig` — the hotel
//     name, contact details, room types, amenities, public prices,
//     booking preferences and payment methods the guest site and the
//     guest booking flow render.
//
//     The projection drops `roomTypes[].corporateRate` (the hotel's
//     negotiated corporate ladder) and the `accountNumber` of every
//     payment method the admin hid from the corporate surface
//     (`showInCorporate === false`). See `lib/publicHotelConfig.ts`.
//
//   GET /api/corporate/rates
//     The PUBLISHED flat corporate rate card — the per-type rates the
//     corporate booking path (`/corporate/book`) shows and the
//     booking server applies. Per `plan/features/RATE-MANAGEMENT.md`
//     this is the hotel's public rate ("This is the public rate at
//     `/corporate/book`"), and the booking server already applies it
//     to any corporate booking carrying the `corporateFlatRate` intent
//     flag.
//
//     It is served from the SERVER so the ladder never ships inside
//     the guest's JavaScript bundle (SEC-5). The NEGOTIATED
//     per-company rates live in the `corporateCodes` collection and
//     are NOT part of this payload — they stay behind
//     `POST /api/validate/corporate-code` and the staff-only
//     `corporateCodes` rules.
//
// Both handlers read through the Admin SDK (which bypasses the rules
// on purpose) and are rate-limited per IP by the router.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../lib/firebase-admin";
import { loadPublicHotelConfig } from "../lib/publicHotelConfig";
import { buildCorporateRateCard } from "../lib/corporateRates";

const CACHE_TTL_SECONDS = 60;

/**
 * `GET /api/public/hotel-config` — the public, corporate-rate-free
 * projection of `settings/hotelConfig`.
 */
export async function handleGetPublicHotelConfig(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }
  try {
    const config = await loadPublicHotelConfig();
    res.setHeader(
      "Cache-Control",
      `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`
    );
    return res.status(200).json({ success: true, data: config });
  } catch (error: any) {
    const code = String((error as any)?.code || "");
    const isInfra =
      code.includes("UNAVAILABLE") ||
      code.includes("DEADLINE_EXCEEDED") ||
      code.includes("RESOURCE_EXHAUSTED");
    return res.status(isInfra ? 503 : 500).json({
      success: false,
      error: "Failed to load the hotel configuration."
    });
  }
}

/**
 * `GET /api/corporate/rates` — the published flat corporate rate
 * card for the corporate booking path.
 */
export async function handleGetCorporateRates(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }
  try {
    const snapshot = await adminDb.collection("settings").doc("hotelConfig").get();
    const ratePerRoomType = buildCorporateRateCard(
      snapshot.exists ? snapshot.data() : null
    );
    res.setHeader(
      "Cache-Control",
      `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`
    );
    return res.status(200).json({ success: true, ratePerRoomType });
  } catch (error: any) {
    const code = String((error as any)?.code || "");
    const isInfra =
      code.includes("UNAVAILABLE") ||
      code.includes("DEADLINE_EXCEEDED") ||
      code.includes("RESOURCE_EXHAUSTED");
    return res.status(isInfra ? 503 : 500).json({
      success: false,
      error: "Failed to load the corporate rates."
    });
  }
}
