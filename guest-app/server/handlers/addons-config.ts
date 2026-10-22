// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the public other-add-ons catalog endpoint.
//
//   GET /api/bookings/addons/config
//
// Returns the hotel's enabled add-ons catalog + a derived
// `checkInDateLockByAddOn` map (per booking check-in date ×
// per add-on, is the add-on currently locked?). Public
// (no auth) — mirrors the BR-03 breakfast-config surface;
// the catalog is non-sensitive public site content. The
// handler is registered in `apiRouter.ts` alongside the
// breakfast block; rate-limited at 60/min/IP.
//
// Pre-seed: when the `addOns` collection is empty, the
// handler reads the `AIRPORT_TRANSFER_PRESEED` defaults and
// returns a single row (no write — the seed lands when the
// admin Settings tab first loads).

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { adminDb } from "../lib/firebase-admin";
import { loadOtherAddOnsHotelEnabled } from "../lib/otherAddOns-settings";
import {
  AIRPORT_TRANSFER_PRESEED,
  normalizeAddOn,
  buildPublicAddOnsCatalog,
  type AddOn
} from "@spark-inn/shared";

export async function handleGetAddOnsConfig(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  try {
    const snap = await adminDb.collection("addOns").get();
    const rawAddOns: AddOn[] = [];
    for (const doc of snap.docs) {
      const norm = normalizeAddOn({ id: doc.id, ...doc.data() }, doc.id);
      if (norm) rawAddOns.push(norm);
    }

    // Per BR-12: if the catalog is empty, return the
    // pre-seed row as a public fallback so a fresh
    // deployment can render the Step 2 + Manage Other
    // Add-Ons UI without waiting for the admin to visit
    // Settings. The actual write happens in the admin
    // Settings tab (`handleSaveAddOns`) — until then the
    // pre-seed is read-only.
    //
    // Per P0-9 (2026-10-22): whether the FALLBACK was used
    // has to be tracked explicitly. The old test was
    // `rawAddOns.length === 1 && rawAddOns[0].id ===
    // "airport-transfer"`, which is ALSO true for a hotel
    // that saved a REAL `airport-transfer` row in Settings →
    // Other Add-Ons — so a hotel with its own catalog was
    // told (through `preSeeded`) that it was looking at a
    // read-only placeholder. The flag now means exactly one
    // thing: "this row came from the hard-coded fallback
    // because the collection was empty".
    const usedFallback = rawAddOns.length === 0;
    if (usedFallback) {
      const pre: AddOn = {
        id: "airport-transfer",
        ...AIRPORT_TRANSFER_PRESEED,
        updatedAt: new Date().toISOString(),
        updatedBy: "pre-seed"
      };
      rawAddOns.push(pre);
    }

    // Per OCT-M1 (2026-10-20, decision #295): the hotel-wide
    // "Add-ons enabled" master switch. It lives on
    // `settings/hotelConfig.otherAddOnsEnabled` and is the switch
    // the admin's Settings tab actually toggles. When it is off, the
    // catalog is empty for EVERY guest-facing surface — this
    // endpoint is the single read path they all share, so one read
    // is enough.
    const hotelEnabled = await loadOtherAddOnsHotelEnabled();

    // The envelope is the SHARED contract (`OtherAddOnsCatalogResponse`),
    // built by the pure `buildPublicAddOnsCatalog` helper so the guest
    // app and the admin app cannot drift onto two different shapes of
    // the same endpoint again (decision #313) — and so the payload
    // rules are unit-testable instead of only observable through a
    // live request.
    const response = buildPublicAddOnsCatalog({
      rows: rawAddOns,
      hotelEnabled,
      usedFallback
    });

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).json(response);
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: "Failed to load other-add-ons catalog."
    });
  }
}