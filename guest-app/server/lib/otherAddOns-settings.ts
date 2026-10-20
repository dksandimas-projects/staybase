// Per OCT-M1 (2026-10-20, decision #295): the hotel-wide
// "Add-ons enabled" master switch, read from
// `settings/hotelConfig.otherAddOnsEnabled`.
//
// The Settings → Other Add-Ons tab has shown a hotel-wide toggle
// since BR-12.1 (2026-10-15), but it was a dead `useState` — no
// Firestore read, no write, no localStorage mirror — while the copy
// under it claimed that turning it off would empty every
// `getEnabledAddOnsByHotel` call. An admin who flipped it believed
// other add-ons were off sale while guests kept buying the airport
// transfer.
//
// The switch is now REAL. This module is the ONE place that reads
// it, so the catalog endpoint, the guest Manage page and the guest
// save path can never disagree about whether add-ons are on sale.
//
// FAIL-OPEN: a transient Firestore error returns `true` (add-ons
// stay on sale) rather than taking a revenue stream off sale
// because of an infrastructure blip. The error is logged so it is
// never silent.

import { adminDb } from "./firebase-admin";
import { normalizeOtherAddOnsEnabled } from "@spark-inn/shared";

/**
 * Read the hotel-wide master switch.
 *
 * @returns `false` only when the settings doc explicitly says the
 *   add-ons are off. A missing doc, a missing field, or a read
 *   failure all resolve to `true` (the pre-OCT-M1 behaviour).
 */
export async function loadOtherAddOnsHotelEnabled(): Promise<boolean> {
  try {
    const snap = await adminDb
      .collection("settings")
      .doc("hotelConfig")
      .get();
    if (!snap.exists) return true;
    return normalizeOtherAddOnsEnabled(snap.data()?.otherAddOnsEnabled);
  } catch (err) {
    console.error(
      "Failed to read settings/hotelConfig.otherAddOnsEnabled; treating other add-ons as enabled:",
      err
    );
    return true;
  }
}

/** The message the guest sees when the hotel has taken other add-ons off sale. */
export const OTHER_ADD_ONS_UNAVAILABLE_ERROR = "Other add-ons are currently unavailable.";
