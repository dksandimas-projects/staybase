// Per HC-01 (decision #328, 2026-11-20): the server-side reader for
// the hotel's CONTACT details.
//
// The SOURCE OF TRUTH is `settings/hotelConfig` — the document the
// admin edits in Settings → Hotel Info. `hotel.config.ts` is the
// DEPLOY-TIME FALLBACK, used only for a field the runtime document
// does not carry.
//
// WHY A DEDICATED LOADER
// ----------------------
// `guest-app/server/lib/publicHotelConfig.ts` serves the PUBLIC
// slice of the same document to the browser. It is an allow-list
// projection of the whole hotel config, and it is cached by the
// public-config HANDLER. The email layer needs the same four fields
// but must not depend on the public projection's caching or on the
// guest route being hit first — so it reads the document directly,
// exactly the way `email.ts` already reads `settings/websiteContent`
// for the house-rules card.
//
// THE CACHE
// ---------
// Every guest email renders the contact, and a booking can fire
// several emails. Reading the document once per email would be a
// wasted round-trip, so the resolved contact is cached for
// `CACHE_TTL_MS`. The TTL matches the public projection's cache
// (`guest-app/server/handlers/public-config.ts`), so the site and the
// emails refresh on the same cadence: an admin edit lands within a
// minute.
//
// A read failure is NOT fatal — the email still goes out with the
// deploy-time fallback, which is what the site shows during its own
// cold-load window.

import { resolveHotelContact, type HotelContact } from "@spark-inn/shared";
import config from "../../../hotel.config";
import { adminDb } from "./firebase-admin";

/** Matches the public projection's cache TTL. */
const CACHE_TTL_MS = 60_000;

let cached: HotelContact | null = null;
let cachedAt = 0;

/**
 * The deploy-time fallback — what the surfaces showed before the
 * runtime document was read (and what they show if the read fails).
 */
export function deployTimeHotelContact(): HotelContact {
  return resolveHotelContact(null, config);
}

/**
 * Reads `settings/hotelConfig` and resolves the hotel's contact
 * details, with `hotel.config.ts` as the fallback for any field the
 * runtime document does not carry.
 *
 * Never throws: a Firestore failure resolves to the deploy-time
 * fallback so a contact-detail read can never break an email.
 */
export async function loadHotelContact(): Promise<HotelContact> {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_TTL_MS) {
    return cached;
  }
  let resolved: HotelContact;
  try {
    const doc = await adminDb.collection("settings").doc("hotelConfig").get();
    resolved = resolveHotelContact(doc.exists ? doc.data() : null, config);
  } catch (error) {
    console.warn(
      "[hotel-contact] Failed to load settings/hotelConfig; using the deploy-time fallback.",
      error
    );
    resolved = deployTimeHotelContact();
  }
  cached = resolved;
  cachedAt = Date.now();
  return resolved;
}

/**
 * Drops the cached contact. Used by the tests so each case resolves
 * a fresh document.
 */
export function resetHotelContactCache(): void {
  cached = null;
  cachedAt = 0;
}
