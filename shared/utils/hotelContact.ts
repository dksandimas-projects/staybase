// Per HC-01 (decision #328, 2026-11-20): the hotel's CONTACT
// details — the address, the front-desk phone, the support email
// and the DPO email — have ONE source of truth.
//
// THE SOURCE OF TRUTH IS `settings/hotelConfig`.
//
// That is the document the admin edits in Settings → Hotel Info, and
// it is the same document the guest site already read: the public
// projection (`GET /api/public/hotel-config` →
// `guest-app/server/lib/publicHotelConfig.ts`) serves the runtime
// values, and `usePublicSiteContent` merges them over the deploy-time
// ones. `hotel.config.ts` is the DEPLOY-TIME FALLBACK — it is used
// only for a field the runtime document does not carry.
//
// WHY THIS MODULE EXISTS
// -----------------------
// The guest EMAILS did not follow that rule. `email.ts` imported
// `hotel.config.ts` directly and rendered the deploy-time address /
// phone / support email in the footer of EVERY guest email (and in
// the receipt PDF header and the `replyTo`). So a hotel that fixed
// its phone number in the admin app still emailed guests the old
// number — the same value the site showed was not the value the
// email showed. The two surfaces had drifted because they resolved
// the same fact through two different code paths.
//
// Every surface now resolves the contact through the SAME pure
// function below, so the site, the emails, the PDFs and the admin
// cannot drift again.
//
// THE LEGACY FIELDS ARE DELIBERATELY NOT READ.
//
// `contactEmail` / `contactPhone` were the pre-Phase-11.8 field
// names. The admin UI stopped writing them (pinned by
// `admin-app/src/__tests__/phase-11.8-tier-1-hotel-contacts.test.ts`,
// which asserts a hotel-settings save must NOT contain them) and
// production still carries their placeholder values
// (`sparkinn.dev@gmail.com` / `+63-38-000-0000`). Reading them
// would resurrect exactly the stale values this change removes, so
// they are ignored even when present on the document.

/**
 * The hotel's contact details as every surface renders them.
 *
 * All four fields are STRINGS and all four are always present (an
 * empty string means "the hotel has not set this one"), so a
 * consumer never has to branch on a missing field.
 */
export interface HotelContact {
  /** The full postal address, as one line. */
  address: string;
  /** The front-desk phone number, as typed by the hotel. */
  frontDeskPhone: string;
  /** The support / reservations email address. */
  supportEmail: string;
  /** The data-privacy-officer email address (RA 10173). */
  dpoEmail: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Formats a hotel address into the ONE line the surfaces render.
 *
 * Accepts BOTH shapes, because the two sources disagree:
 *
 *   - a plain STRING — what the admin types and what
 *     `settings/hotelConfig` stores:
 *     `"J. Borja St, Poblacion II, Tagbilaran City, Bohol, 6300"`;
 *   - the STRUCTURED `{ street, city, region, postalCode }` OBJECT —
 *     the shape `hotel.config.ts` uses.
 *
 * The object form is rendered `street, city, region, postalCode` —
 * the same order and the same comma separator the string form uses,
 * so the two render identically once normalised.
 */
export function formatHotelAddress(value: unknown): string {
  if (typeof value === "string") return value.trim();
  const record = asRecord(value);
  return ["street", "city", "region", "postalCode"]
    .map((key) => asTrimmedString(record[key]))
    .filter((part) => part.length > 0)
    .join(", ");
}

/**
 * Resolves the hotel's contact details.
 *
 * `runtime` is the raw `settings/hotelConfig` payload (or anything
 * shaped like it); `fallback` is the deploy-time config. For each
 * field the runtime value wins when it is a non-empty string,
 * otherwise the fallback is used.
 *
 * Pure — no Firestore, no clock, no env — so it is unit-testable and
 * safe to call from the guest client, the admin app and the server.
 */
export function resolveHotelContact(runtime: unknown, fallback?: unknown): HotelContact {
  const r = asRecord(runtime);
  const f = asRecord(fallback);
  const pick = (key: "frontDeskPhone" | "supportEmail" | "dpoEmail"): string =>
    asTrimmedString(r[key]) || asTrimmedString(f[key]);
  return {
    address: formatHotelAddress(r.address) || formatHotelAddress(f.address),
    frontDeskPhone: pick("frontDeskPhone"),
    supportEmail: pick("supportEmail"),
    dpoEmail: pick("dpoEmail")
  };
}
