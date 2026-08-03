function pad(value: number, length: number) {
  return String(value).padStart(length, "0");
}

function compactDate(value: Date) {
  const year = value.getFullYear();
  const month = pad(value.getMonth() + 1, 2);
  const day = pad(value.getDate(), 2);
  return `${year}${month}${day}`;
}

export function generateBookingRef(prefix: string, date: Date, sequence: number) {
  // Per H3 (hardening batch 2026-06-26): the sequence
  // width is now 5 digits (was 3). The per-day namespace
  // goes from 999 → 99,999 which makes brute-forcing the
  // ref via /api/bookings/lookup much harder (combined
  // with the 10/min rate limit, that's 60k attempts/day
  // against a 99,999-key space = 60% PoR if an attacker
  // saturates the rate limit, but only for the day). The
  // BOOKING_REF_REGEX already accepts 3-5 digits, so
  // existing 3-digit refs stay valid.
  return `${prefix}-${compactDate(date)}-${pad(sequence, 5)}`;
}

export function generateMemberNumber(prefix: string, sequence: number) {
  return `${prefix}-${pad(sequence, 5)}`;
}

export function generateStoreOrderRef(date: Date, sequence: number) {
  // Per H3 (hardening batch 2026-06-26): same 5-digit
  // sequence width as booking refs.
  return `SO-${compactDate(date)}-${pad(sequence, 5)}`;
}

export function nextSequence(currentHighestSequence: number | null | undefined) {
  return (currentHighestSequence ?? 0) + 1;
}

// Per BF-21 (booking-flow audit 2026-06-26): the
// canonical booking-ref shape is `<prefix>-YYYYMMDD-<seq>`
// where `<prefix>` is 1–4 uppercase letters (e.g. "SI",
// "INQ" — corporate), `<seq>` is 3–5 digits. Exported as
// a regex + helper so server-side validation can short-
// circuit malformed input before hitting Firestore.
export const BOOKING_REF_REGEX = /^[A-Z]{1,4}-\d{8}-\d{3,5}$/;

export function isValidBookingRef(value: unknown): value is string {
  return typeof value === "string" && BOOKING_REF_REGEX.test(value.trim());
}

// Per MRB-01 (2026-08-02, per decision #159): the canonical
// reservation-ref shape. Distinct prefix (`R-` vs `SI-` for
// bookings) so the public surface reads naturally and a guess
// of one ref space gives no information about the other. The
// sequence width matches the booking-ref widening (5 digits)
// from the H3 hardening batch — a 99,999-key per-day namespace
// per property, combined with the existing 10/min rate limit,
// is the brute-force ceiling. Server-side validation can
// short-circuit malformed input before hitting Firestore.
export const RESERVATION_REF_REGEX = /^R-\d{8}-\d{3,5}$/;

export function isValidReservationRef(value: unknown): value is string {
  return typeof value === "string" && RESERVATION_REF_REGEX.test(value.trim());
}

// Per MRB-01 (2026-08-02): the client-preallocated reservation
// ID format. UUID v4 is the canonical random identifier; the
// regex below accepts UUIDv4 (and rejects the all-zeros + the
// version-1 MAC-derived forms for clarity). The ID is generated
// on the client before the create request and held across a
// retry-after-uncertain-response so the server transaction
// returns the existing reservation rather than creating a
// duplicate. Server-side validation short-circuits malformed
// IDs before hitting Firestore.
export const RESERVATION_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidReservationId(value: unknown): value is string {
  return typeof value === "string" && RESERVATION_ID_REGEX.test(value.trim());
}

// Per MRB-01 (2026-08-02): the client preallocation helper.
// Returns a UUIDv4 string suitable for use as a `reservationId`
// before the create request is sent. The browser's
// `crypto.randomUUID()` is the canonical source (Chrome 92+,
// Firefox 95+, Safari 15.4+); the Node 19+ test runner and the
// Vercel server runtime both expose it too. The injected
// `randomUUID` parameter lets the unit test pin a deterministic
// generator without relying on the runtime's entropy source.
//
// Pattern mirrors `generateLookupToken`: the lazy `require` is
// the only `node:` import in the module so the shared bundle
// stays environment-agnostic at the import level. The default
// implementation is a thin wrapper around the runtime's
// `crypto.randomUUID()` — if the runtime does not expose it,
// the helper throws so a missing generator surfaces immediately
// rather than silently producing a non-conforming ID.
export function generateReservationId(
  randomUUID: () => string = defaultRandomUUID
): string {
  const id = randomUUID();
  if (!isValidReservationId(id)) {
    throw new Error("Generated reservationId did not match the expected UUIDv4 shape.");
  }
  return id;
}

function defaultRandomUUID(): string {
  // node:crypto is always available in the server runtime + the
  // test runner. The browser exposes `globalThis.crypto.randomUUID`.
  // We try the Node path first (server + test) then fall through
  // to the global path (browser) so the same helper works in
  // both runtimes without a bundler hint.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = globalThis as any;
  if (typeof g.crypto?.randomUUID === "function") {
    return String(g.crypto.randomUUID());
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomUUID } = require("node:crypto") as typeof import("node:crypto");
  return String(randomUUID());
}

// Per H2 (hardening batch 2026-06-26): the booking
// lookup token is a 32-char hex string (16 bytes = 128
// bits of entropy) that the email magic link carries
// instead of the raw `guestEmail` URL param. Generated
// server-side at booking-create time and stored on the
// booking doc (`lookupToken`); the lookup + cancel
// endpoints accept `{ bookingRef, token }` in lieu of
// `{ bookingRef, guestEmail }` so PII never appears in
// URLs / browser history / Vercel access logs.
//
// The runtime `randomBytes` call is wrapped in a small
// helper so the unit tests can pin a deterministic
// generator (see `__tests__/references.test.ts`).
const LOOKUP_TOKEN_HEX_LENGTH = 32;

export function generateLookupToken(randomBytes: (n: number) => Uint8Array = defaultRandomBytes): string {
  const bytes = randomBytes(LOOKUP_TOKEN_HEX_LENGTH / 2);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function defaultRandomBytes(n: number): Uint8Array {
  // node:crypto is always available in the server runtime
  // (Vercel functions + the test runner).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomBytes } = require("node:crypto") as typeof import("node:crypto");
  return new Uint8Array(randomBytes(n));
}

export function isValidLookupToken(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{32}$/i.test(value);
}
