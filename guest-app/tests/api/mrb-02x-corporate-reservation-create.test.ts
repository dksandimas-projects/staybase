import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const corporatePage = readFileSync(
  resolve(__dirname, "../../src/pages/CorporateBookingPage.tsx"),
  "utf8"
);
const sharedIndex = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);
const refs = readFileSync(
  resolve(__dirname, "../../../shared/utils/references.ts"),
  "utf8"
);

// Slice the public create handler's fingerprint
// computation block out of the file so the guards below
// are scoped to the public create path's corporate
// handling. The fingerprint is at function scope
// (computed BEFORE the runTransaction), so the search
// is anchored on the `computeRequestFingerprint` call
// inside `handleCreateBooking` — NOT the walk-in
// handler's fingerprint (which has its own shape) or
// the reschedule handler's fingerprint.
function extractCreateBookingFingerprintBlock(): string {
  // The public create handler starts at
  // `export async function handleCreateBooking`. The
  // fingerprint block begins at the `isCorporateIntent`
  // anchor (the MRB-02.x corporate fix's anchor; pre-fix
  // there was no `isCorporateIntent` and the block
  // started directly with the `guestNameForFingerprint`
  // + `reservationRequestFingerprint` calls) and ends at
  // the matching `});` of the `computeRequestFingerprint`
  // call. We scan forward from the anchor, counting
  // braces to find the matching close.
  const start = handlers.indexOf("export async function handleCreateBooking");
  expect(start).toBeGreaterThanOrEqual(0);
  const anchor = handlers.indexOf("const isCorporateIntent =", start);
  expect(anchor).toBeGreaterThanOrEqual(0);
  const fingerprintStart = handlers.indexOf(
    "const reservationRequestFingerprint = computeRequestFingerprint({",
    anchor
  );
  expect(fingerprintStart).toBeGreaterThanOrEqual(0);
  const fingerprintEnd = handlers.indexOf("\n  });", fingerprintStart);
  if (fingerprintEnd < 0) {
    throw new Error("Could not find the closing call of the fingerprint block.");
  }
  return handlers.slice(anchor, fingerprintEnd + "\n  });".length);
}
const fingerprintBlock = extractCreateBookingFingerprintBlock();

describe("MRB-02.x corporate — fingerprint fix for the 'Continue without code' path", () => {
  describe("Public create handler — fingerprint is corporate-aware", () => {
    it("imports RESERVATION_ID_REGEX + generateReservationId + computeRequestFingerprint from @spark-inn/shared", () => {
      // Same imports as the public create path. The
      // fingerprint's `corporateCode` regex validation
      // (handled inside `computeRequestFingerprint`'s
      // `normalizeCorporateCode`) is independent of
      // the schema-level `RESERVATION_ID_REGEX` (the
      // reservation id regex); both are imported in
      // the same block.
      expect(handlers).toMatch(/RESERVATION_ID_REGEX/);
      expect(handlers).toMatch(/generateReservationId/);
      expect(handlers).toMatch(/computeRequestFingerprint/);
    });

    it("derives isCorporateIntent from BOTH corporateCode and corporateFlatRate (not just corporateCode)", () => {
      // The MRB-02.x corporate fix: the fingerprint's
      // `isCorporate` + `source` + `companyName` must
      // match the server-validated `corporateDetails`
      // the transaction stamps on the booking +
      // reservation header. The server sets
      // `isCorporate: true` for BOTH the "with code"
      // path (validated `corporateCode`) AND the
      // "Continue without code" path (the
      // `corporateFlatRate: true` intent flag). Pre-fix,
      // the fingerprint used `Boolean(corporateCode)`
      // which gave `false` / `"online"` for the
      // "Continue without code" path -- a mismatch
      // with the stamped `true` / `"corporate"`. The
      // fix threads the intent flag through.
      expect(fingerprintBlock).toMatch(
        /const isCorporateIntent = Boolean\(corporateCode\) \|\| corporateFlatRate === true/
      );
    });

    it("fingerprint source is 'corporate' when isCorporateIntent is true, 'online' otherwise", () => {
      // The fingerprint's `source` field must match
      // the reservation header's `source` field
      // (the server stamps `corporateDetails.isCorporate
      // ? "corporate" : "online"` on the header). The
      // fingerprint's `isCorporateIntent` mirrors the
      // server's `isCorporate` flag, so the source
      // matches.
      expect(fingerprintBlock).toMatch(
        /source: isCorporateIntent \? "corporate" : "online"/
      );
    });

    it("fingerprint isCorporate is the isCorporateIntent flag (matches the server's stamped value)", () => {
      // The fingerprint's `isCorporate` field must
      // match the server-validated value. For the
      // "Continue without code" path the server stamps
      // `isCorporate: true`; the fingerprint's
      // `isCorporateIntent` captures the same intent.
      expect(fingerprintBlock).toMatch(
        /isCorporate: isCorporateIntent/
      );
    });

    it("fingerprint corporateCode is the uppercased body value (empty string for the 'Continue without code' path)", () => {
      // For the "with code" path the body's
      // `corporateCode` is uppercased + stamped as-is
      // (the server also uppercases the code in the
      // corporateCodes lookup). For the "Continue
      // without code" path the body has no code, so
      // both the fingerprint + the stamped value are
      // empty strings.
      expect(fingerprintBlock).toMatch(
        /corporateCode: String\(corporateCode \|\| ""\)\.trim\(\)\.toUpperCase\(\)/
      );
    });

    it("fingerprint companyName is the body-entered name when isCorporateIntent is true, empty string otherwise", () => {
      // The fingerprint's `companyName` is the
      // guest-entered name from the body — that's
      // the "intent" signal. The server stamps the
      // doc's `companyName` (the "enforced" name) on
      // the header for the "with code" path; the two
      // can differ. The fingerprint's purpose is to
      // detect "different intent" — the guest's stated
      // name IS the intent — so the body value is
      // correct here. A retry with a different stated
      // name is a different intent (409); a retry
      // with the same stated name is the same intent
      // (replay).
      expect(fingerprintBlock).toMatch(
        /companyName: isCorporateIntent\s*\n\s*\? String\(rawGuestDetails\.companyName \|\| ""\)\.trim\(\)\s*\n\s*: ""/
      );
    });
  });

  describe("Client caller — CorporateBookingPage preallocates reservationId", () => {
    it("imports generateReservationId from @spark-inn/shared", () => {
      // The corporate flow (`/corporate/book`) is the
      // third client updated to preallocate a
      // `reservationId`. Same pattern as `BookingPage`
      // (the public `/book` flow) + the walk-in path
      // (server auto-mints; no client preallocation).
      // The import is in the multi-line @spark-inn/shared
      // import block; the regex matches both single-line
      // and multi-line forms via `[\s\S]*?`.
      expect(corporatePage).toMatch(
        /import\s*\{[\s\S]*?generateReservationId[\s\S]*?\}\s*from\s*"@spark-inn\/shared"/
      );
    });

    it("preallocates reservationId via useState lazy init (one-time per mount)", () => {
      // `useState(() => generateReservationId())` is
      // the canonical pattern: the same id survives
      // across renders and
      // retry-after-uncertain-response. The
      // corporate flow's review step is the last
      // submission point; a retry re-uses the id so
      // the server's reservation transaction either
      // replays the original commit (same
      // `requestFingerprint`) or returns a 409
      // (different `requestFingerprint`).
      expect(corporatePage).toMatch(
        /const \[reservationId\]\s*=\s*useState\(\(\)\s*=>\s*generateReservationId\(\)\)/
      );
    });

    it("sends reservationId in the body of POST /api/bookings/create", () => {
      // The client-preallocated id rides on the
      // same request as `bookingId`. The server's
      // schema accepts it as optional; when present,
      // the server uses it as the canonical
      // idempotency key for the create transaction.
      expect(corporatePage).toMatch(/reservationId,/);
    });
  });

  describe("Shared utility — generateReservationId is the canonical preallocator", () => {
    it("is exported from @spark-inn/shared", () => {
      // The shared re-export is the single source of
      // truth — the client and the server both pull
      // from it so the generated id shape is
      // guaranteed to pass `RESERVATION_ID_REGEX`.
      expect(sharedIndex).toMatch(/export \* from "\.\/utils\/references"/);
      expect(refs).toMatch(
        /export function generateReservationId\(/
      );
    });

    it("validates the generated id against RESERVATION_ID_REGEX (defense in depth)", () => {
      // The helper throws when the runtime's
      // `crypto.randomUUID()` returns a
      // non-conforming shape. This is a "missing
      // generator surfaces immediately" guard.
      expect(refs).toMatch(
        /if \(!isValidReservationId\(id\)\) \{\s*throw new Error\("Generated reservationId did not match the expected UUIDv4 shape\.\"\)/
      );
    });
  });
});
