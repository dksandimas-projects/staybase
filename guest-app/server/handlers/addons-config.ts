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
import {
  ADDON_PRESEEDS,
  normalizeAddOn,
  getEnabledAddOnsByHotel,
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

    // Per BR-12 + BR-13.x (decision #250): if the catalog
    // is empty, return every `ADDON_PRESEEDS` row as a
    // public fallback so a fresh deployment can render
    // the Step 2 + Manage Other Add-Ons UI without
    // waiting for the admin to visit Settings. The actual
    // write happens in the admin Settings tab — until
    // then the pre-seed is read-only. `preSeeded` in the
    // response signals the read-only fallback so the
    // guest-side cache + the dashboard confirm-the-catalog
    // logic can distinguish "saw defaults" from "saw an
    // admin-curated catalog".
    if (rawAddOns.length === 0) {
      const fallbackStamp = new Date().toISOString();
      for (const seed of ADDON_PRESEEDS) {
        rawAddOns.push({
          ...seed,
          updatedAt: fallbackStamp,
          updatedBy: "pre-seed"
        });
      }
    }

    const enabled = getEnabledAddOnsByHotel(rawAddOns);

    res.setHeader("Cache-Control", "public, max-age=60");
    return res.status(200).json({
      success: true,
      addOns: enabled.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        price: a.price,
        unit: a.unit,
        cutoffHoursBeforeCheckIn: a.cutoffHoursBeforeCheckIn,
        displayOrder: a.displayOrder
      })),
      preSeeded:
        rawAddOns.length === ADDON_PRESEEDS.length &&
        ADDON_PRESEEDS.every((s) => rawAddOns.some((r) => r.id === s.id))
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: "Failed to load other-add-ons catalog."
    });
  }
}