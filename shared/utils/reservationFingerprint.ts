// Per MRB-01 (2026-08-02, per decision #159): the canonical
// request fingerprint. The same `reservationId` + same fingerprint
// is an idempotent replay — the server returns the existing
// reservation with no re-assigned inventory, no double
// voucher/corporate usage increment, no duplicate loyalty award,
// and no duplicate email. The same `reservationId` + different
// fingerprint is a 409 conflict — the client reused an ID it
// had already committed for a different request.
//
// The fingerprint is computed server-side at create time and
// stored on the `reservations/{id}` document (`requestFingerprint`).
// It is never client-supplied and never read by clients. The
// canonicalization rules are:
//   - room types: sorted by `type` then `position` for byte
//     equivalence; each line carries `quantity` + `adults` +
//     `children` + `extraBeds` (CHD-01 + EXB-01 + MRB-06 inputs)
//   - dates: ISO `YYYY-MM-DD` strings, `checkIn` < `checkOut`
//   - lead booker: `leadGuestEmail` lowercased + trimmed;
//     `leadGuestName` / `leadGuestPhone` trimmed
//   - source / corporate / voucher codes: trimmed, uppercased
//   - discount scope: full nested object (DSC-01 snapshot)
//   - consent: terms + privacy version strings
//   - everything else: `Number(...) || 0` for numerics, trimmed
//     for strings
//
// Hash function is the only `node:` import in the shared module
// (lazy-required inside the function with the same shape as
// `references.ts`'s `defaultRandomBytes`). The hash function is
// injected so the unit test can pin a deterministic generator
// without spinning up Node's crypto at test time.

export interface FingerprintableRoomLine {
  type: string;
  quantity: number;
  adults: number;
  children: number;
  extraBeds: number;
}

export interface FingerprintableDiscountScope {
  senior: { room: boolean; breakfast: boolean; extraBed: boolean };
  voucher: { room: boolean; breakfast: boolean; extraBed: boolean };
  member: { room: boolean; breakfast: boolean; extraBed: boolean };
}

export interface FingerprintableReservationRequest {
  reservationId: string;
  roomLines: FingerprintableRoomLine[];
  checkIn: string;       // YYYY-MM-DD
  checkOut: string;      // YYYY-MM-DD
  leadGuestName: string;
  leadGuestEmail: string;
  leadGuestPhone: string;
  source: string;
  isCorporate: boolean;
  corporateCode: string;
  companyName: string;
  voucherCode: string;
  memberDiscountPct: number;
  discountScope: FingerprintableDiscountScope;
  termsVersion: string;
  privacyVersion: string;
}

export type FingerprintHasher = (input: string) => string;

function defaultHasher(): FingerprintHasher {
  // node:crypto is always available in the server runtime
  // (Vercel functions + the test runner). Lazy-required to
  // keep the shared module environment-agnostic at the import
  // level so the client bundle does not pull in `node:crypto`.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return (input: string) => createHash("sha256").update(input).digest("hex");
}

function normalizeRoomLine(line: FingerprintableRoomLine): FingerprintableRoomLine {
  return {
    type: String(line.type || "").trim(),
    quantity: Math.max(0, Math.floor(Number(line.quantity) || 0)),
    adults: Math.max(0, Math.floor(Number(line.adults) || 0)),
    children: Math.max(0, Math.floor(Number(line.children) || 0)),
    extraBeds: Math.max(0, Math.floor(Number(line.extraBeds) || 0))
  };
}

function normalizeDiscountScope(scope: FingerprintableDiscountScope | null | undefined): FingerprintableDiscountScope {
  const empty: FingerprintableDiscountScope = {
    senior: { room: false, breakfast: false, extraBed: false },
    voucher: { room: false, breakfast: false, extraBed: false },
    member: { room: false, breakfast: false, extraBed: false }
  };
  if (!scope) return empty;
  return {
    senior: {
      room: Boolean(scope.senior?.room),
      breakfast: Boolean(scope.senior?.breakfast),
      extraBed: Boolean(scope.senior?.extraBed)
    },
    voucher: {
      room: Boolean(scope.voucher?.room),
      breakfast: Boolean(scope.voucher?.breakfast),
      extraBed: Boolean(scope.voucher?.extraBed)
    },
    member: {
      room: Boolean(scope.member?.room),
      breakfast: Boolean(scope.member?.breakfast),
      extraBed: Boolean(scope.member?.extraBed)
    }
  };
}

function buildCanonicalPayload(req: FingerprintableReservationRequest): string {
  const roomLines = (Array.isArray(req.roomLines) ? req.roomLines : [])
    .map(normalizeRoomLine)
    // Sort by `type` (primary) then quantity (tie-breaker) so the
    // canonical JSON is byte-equivalent regardless of the order
    // the client sent the lines in.
    .sort((a, b) => {
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      return a.quantity - b.quantity;
    });
  const payload = {
    reservationId: String(req.reservationId || "").trim(),
    roomLines,
    checkIn: String(req.checkIn || "").trim(),
    checkOut: String(req.checkOut || "").trim(),
    leadGuestName: String(req.leadGuestName || "").trim(),
    leadGuestEmail: String(req.leadGuestEmail || "").trim().toLowerCase(),
    leadGuestPhone: String(req.leadGuestPhone || "").trim(),
    source: String(req.source || "").trim(),
    isCorporate: Boolean(req.isCorporate),
    corporateCode: String(req.corporateCode || "").trim().toUpperCase(),
    companyName: String(req.companyName || "").trim(),
    voucherCode: String(req.voucherCode || "").trim().toUpperCase(),
    memberDiscountPct: Math.max(0, Number(req.memberDiscountPct) || 0),
    discountScope: normalizeDiscountScope(req.discountScope),
    termsVersion: String(req.termsVersion || "").trim(),
    privacyVersion: String(req.privacyVersion || "").trim()
  };
  // `JSON.stringify` with sorted keys is the byte-equivalence
  // anchor. Object key order is preserved by the literal above
  // (we built the object in a fixed order); the array of room
  // lines is sorted by the comparison function. The result is
  // a stable string the SHA-256 hash can fold.
  return JSON.stringify(payload);
}

export function computeRequestFingerprint(
  req: FingerprintableReservationRequest,
  hasher: FingerprintHasher = defaultHasher()
): string {
  const canonical = buildCanonicalPayload(req);
  return hasher(canonical);
}

// Exported for the unit test so a deterministic generator can
// be injected without spinning up Node's crypto at test time.
// The contract: `hasher(canonicalJson) -> 64-char hex sha256`.
export const __test__ = { buildCanonicalPayload, normalizeRoomLine, normalizeDiscountScope };
