import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const schemas = readFileSync(
  resolve(__dirname, "../../../shared/schemas/booking.ts"),
  "utf8"
);

// Slice the walk-in handler body out of the file so the
// guards below are scoped to `handleCreateWalkin` — the
// public create handler (`handleCreateBooking`) has its
// own MRB-02 test (`mrb-02-reservation-create.test.ts`)
// and the walk-in guards must not pick up the public
// handler's pattern by mistake.
function extractWalkinHandler(): string {
  const start = handlers.indexOf("export async function handleCreateWalkin");
  expect(start).toBeGreaterThanOrEqual(0);
  // Find the closing `}` of the handler — the first
  // top-level `}` after the export that closes the
  // function body. We scan for `^}` at the start of a
  // line followed by the next export.
  const end = handlers.indexOf("\nexport async function ", start + 1);
  return handlers.slice(start, end);
}
const walkin = extractWalkinHandler();

describe("MRB-02.x walk-in reservation create", () => {
  describe("WalkinBookingSchema — accepts optional reservationId", () => {
    it("imports RESERVATION_ID_REGEX from the shared references module", () => {
      // The schema validates the optional client-supplied
      // id against the shared regex (same as the public
      // create path). When absent, the server auto-mints
      // a UUIDv4.
      expect(schemas).toMatch(
        /import \{ RESERVATION_ID_REGEX \} from "\.\.\/utils\/references"/
      );
    });

    it("declares reservationId as an optional, regex-validated string on WalkinBookingSchema", () => {
      // The field is optional so the walk-in modal (which
      // doesn't currently preallocate) keeps working; the
      // server auto-mints a fresh id. A future walk-in
      // client that does preallocate rides the same
      // idempotency contract as the public path.
      expect(schemas).toMatch(
        /reservationId:\s*z\.string\(\)\.trim\(\)\.regex\(RESERVATION_ID_REGEX\)\.optional\(\)/
      );
    });
  });

  describe("Idempotency matrix — walk-in transaction reads reservation header", () => {
    it("declares effectiveReservationId + reservationDocRef at function scope (above the runTransaction call)", () => {
      // Same `finalX` capture pattern as
      // `handleCreateBooking` — declared above the
      // `runTransaction` call so the post-transaction
      // success response can echo the id back to the
      // client. For walk-in the auto-mint is the default
      // (the modal doesn't currently preallocate).
      const effectiveDeclIdx = walkin.search(
        /const effectiveReservationId:\s*string\s*=\s*\(requestedReservationId/
      );
      const reservationDocRefIdx = walkin.search(
        /const reservationDocRef = adminDb\.collection\("reservations"\)\.doc\(effectiveReservationId\)/
      );
      const runTxnIdx = walkin.indexOf(
        "await adminDb.runTransaction(async (transaction) => {"
      );
      expect(effectiveDeclIdx).toBeGreaterThanOrEqual(0);
      expect(reservationDocRefIdx).toBeGreaterThanOrEqual(0);
      expect(runTxnIdx).toBeGreaterThan(effectiveDeclIdx);
      expect(runTxnIdx).toBeGreaterThan(reservationDocRefIdx);
    });

    it("computes effectiveReservationId from requestedReservationId (when valid) OR auto-mints via generateReservationId()", () => {
      // Symmetric with the public path: the regex guard
      // runs on `requestedReservationId`; a malformed id
      // falls through to the auto-mint. Both branches
      // produce a valid UUIDv4 shape.
      expect(walkin).toMatch(
        /const effectiveReservationId:\s*string\s*=\s*\(requestedReservationId\s*&&\s*RESERVATION_ID_REGEX\.test\(requestedReservationId\)\)/
      );
      expect(walkin).toMatch(/:\s*generateReservationId\(\)/);
    });

    it("reads the reservation header inside the transaction and applies the idempotency matrix", () => {
      // The reservation read runs AFTER the room read
      // (so the fingerprint has `roomData.type` for the
      // walk-in — walk-in submits a `roomId`, not a
      // `roomType`, so the type is only known once the
      // room doc is read) and BEFORE the booking doc
      // read (so the canonical idempotency anchor is the
      // reservation, not the booking).
      const roomReadIdx = walkin.search(
        /const roomRef = adminDb\.collection\("rooms"\)\.doc\(roomId\)/
      );
      const reservationReadIdx = walkin.search(
        /const existingReservationSnap = await transaction\.get\(reservationDocRef\)/
      );
      const bookingReadIdx = walkin.search(
        /const existingWalkin = await transaction\.get\(bookingDocRef\)/
      );
      expect(roomReadIdx).toBeGreaterThanOrEqual(0);
      expect(reservationReadIdx).toBeGreaterThan(roomReadIdx);
      expect(bookingReadIdx).toBeGreaterThan(reservationReadIdx);
    });

    it("idempotent replay: same reservationId + same fingerprint returns the existing booking's response shape", () => {
      // When the reservation header already exists AND
      // the child booking exists, the transaction reads
      // the existing child doc and builds a response
      // from it. The response carries
      // `idempotentReplay: true` so the caller knows it
      // is a replay, not a fresh create. The walk-in
      // response shape echoes the existing child + the
      // reservation linkage.
      expect(walkin).toMatch(
        /const sameRequest = String\(existingData\.requestFingerprint \|\| ""\) === walkinFingerprint/
      );
      expect(walkin).toMatch(
        /const existingChildSnap = await transaction\.get\(bookingDocRef\)/
      );
      expect(walkin).toMatch(/idempotentReplay:\s*true/);
    });

    it("fingerprint conflict: same reservationId + different fingerprint throws RESERVATION_ID_FINGERPRINT_CONFLICT", () => {
      // Same shape as the public path. The throw fires
      // when the same `reservationId` is re-used with a
      // different request shape. The catch block maps it
      // to 409.
      expect(walkin).toMatch(
        /if \(!sameRequest\) \{\s*throw new Error\("RESERVATION_ID_FINGERPRINT_CONFLICT"\);/
      );
    });

    it("partial-state guard: reservation header exists but child booking missing throws RESERVATION_HEADER_WITHOUT_CHILD", () => {
      // Half-applied create is a 500 (not retryable from
      // the same request — the client must abandon the
      // `reservationId` and start over).
      expect(walkin).toMatch(
        /throw new Error\("RESERVATION_HEADER_WITHOUT_CHILD"\)/
      );
    });

    it("walk-in fingerprint uses the room's `type` (not the roomId) for byte-equivalence", () => {
      // The walk-in submits a `roomId` and reads the
      // type from the room doc. The fingerprint's
      // `roomLines[0].type` is the type label (e.g.
      // "Deluxe"), not the roomId. This is the same
      // contract as the public path (which uses
      // `roomType` from the body) so the byte-equivalence
      // rule holds across both surfaces.
      const fingerprintBlock = walkin.match(
        /computeRequestFingerprint\(\{[\s\S]+?\}\);[\s\S]{0,100}const sameRequest/
      );
      expect(fingerprintBlock).toBeTruthy();
      expect(fingerprintBlock![0]).toMatch(
        /type:\s*String\(roomData\.type \|\| ""\)\.trim\(\)/
      );
    });
  });

  describe("Error mapping — catch block maps reservation errors to HTTP status", () => {
    it("RESERVATION_ID_FINGERPRINT_CONFLICT maps to 409", () => {
      // Same status code as the public path's 409
      // mappings. 409 keeps the walk-in caller from
      // retrying with the stale id.
      expect(walkin).toMatch(
        /errorMessage === "RESERVATION_ID_FINGERPRINT_CONFLICT"[\s\S]{0,80}status = 409/
      );
    });

    it("RESERVATION_HEADER_WITHOUT_CHILD maps to 500", () => {
      // Same 500 mapping as the public path — the
      // half-applied state is unrecoverable by the
      // request and must be flagged to staff.
      expect(walkin).toMatch(
        /errorMessage === "RESERVATION_HEADER_WITHOUT_CHILD"[\s\S]{0,80}status = 500/
      );
    });

    it("preserves the existing 409 mappings (Room no longer available + lingering checked-in)", () => {
      // The pre-MRB-02.x walk-in catch block already
      // mapped "Room no longer available" +
      // ROOM_NOT_READY_PREVIOUS_GUEST_ERROR to 409. The
      // refactor keeps both mappings alongside the new
      // reservation-level mappings.
      expect(walkin).toMatch(
        /errorMessage === "Room no longer available"/
      );
      expect(walkin).toMatch(/errorMessage === ROOM_NOT_READY_PREVIOUS_GUEST_ERROR/);
    });
  });

  describe("Header creation — single-room walk-in header fields", () => {
    it("writes newReservation via transaction.set with id = effectiveReservationId", () => {
      // The header is created in the same transaction
      // as the child booking. `id` mirrors the doc id
      // (UUID shape) so the two are one-to-one.
      expect(walkin).toMatch(
        /id:\s*effectiveReservationId,\s*\n\s*reservationRef:\s*finalReservationRef,/
      );
    });

    it("single-room walk-in header sets roomCount: 1, activeRoomCount: 1, cancelledRoomCount: 0", () => {
      // The single-room walk-in case stamps the header
      // with `roomCount: 1` + the matching
      // active/cancelled counters. `checkedInRoomCount`
      // is conditional on the resolved `status` (the
      // walk-in can land on `checked-in` directly), and
      // `checkedOutRoomCount` similarly.
      expect(walkin).toMatch(/roomCount:\s*1,/);
      expect(walkin).toMatch(/activeRoomCount:\s*1/);
      expect(walkin).toMatch(/cancelledRoomCount:\s*0/);
    });

    it("walk-in paymentStatus mirrors the child's resolved status (in-house for checked-in, confirmed otherwise)", () => {
      // Walk-ins don't have a `pending` → `confirmed`
      // flip — they land on `confirmed` or `checked-in`
      // directly. The header mirrors the child's
      // resolved status so a future read doesn't have
      // to fan out to every child to derive the
      // reservation-level money state.
      expect(walkin).toMatch(
        /paymentStatus:\s*\(status === "checked-in" \? "in-house" : "confirmed"\)/
      );
    });

    it("walk-in holdExpiresAt is null (no auto-expiry for staff-created bookings)", () => {
      // Walk-ins are exempt from the guest-side hold
      // window (the staff is creating the booking, not
      // waiting on a guest action). The header mirrors
      // the same null so the unified PEX hold + the
      // header's hold stay in lock-step.
      expect(walkin).toMatch(/holdExpiresAt:\s*null,/);
    });

    it("stamps requestFingerprint on the header (same canonical shape as the public path)", () => {
      // The fingerprint is the SHA-256 of the
      // canonicalized create request. The walk-in
      // inputs are: the room's `type` (post room read),
      // the body inputs (numAdults, numChildren,
      // extraBedCount), the lead booker
      // (name/email/phone), `source: "walk-in"`, the
      // voucher code (uppercased), and the same
      // placeholders for `discountScope` + `termsVersion`
      // + `privacyVersion` as the public path. Same
      // byte-equivalence rule.
      expect(walkin).toMatch(
        /requestFingerprint:\s*computeRequestFingerprint\(\{/
      );
    });

    it("walk-in header sets source: 'walk-in', isCorporate: false, memberDiscountPct: 0, memberId: null", () => {
      // The walk-in is staff-created (no auth token,
      // no member discount, no corporate path). The
      // header carries the canonical "walk-in" source
      // + the boolean flags so a future read doesn't
      // have to guess.
      expect(walkin).toMatch(/source:\s*"walk-in",/);
      expect(walkin).toMatch(/isCorporate:\s*false,/);
      expect(walkin).toMatch(/memberDiscountPct:\s*0,/);
      expect(walkin).toMatch(/memberId:\s*null,/);
    });
  });

  describe("Booking doc — 4 reservation fields stamped on newBooking", () => {
    it("stamps reservationId, reservationRef, reservationPosition: 1, reservationRoomCount: 1", () => {
      // Same shape as the public path. The single-room
      // walk-in case is `position: 1` /
      // `roomCount: 1`; MRB-06's N>1 generalization
      // will assign sequential positions.
      expect(walkin).toMatch(
        /reservationId:\s*effectiveReservationId,\s*\n\s*reservationRef:\s*finalReservationRef,\s*\n\s*reservationPosition:\s*1,\s*\n\s*reservationRoomCount:\s*1/
      );
    });
  });

  describe("Success response — echoes reservationId + reservationRef + idempotentReplay", () => {
    it("declares finalReservationRef at function scope (above the runTransaction call)", () => {
      // Captured at function scope so the
      // post-transaction success response can echo it.
      // Same `finalX` capture pattern as
      // `finalBookingRef` / `finalTotalPrice` /
      // `finalReservationRef` in the public path.
      const finalDeclIdx = walkin.search(/let finalReservationRef = ""/);
      const runTxnIdx = walkin.indexOf(
        "await adminDb.runTransaction(async (transaction) => {"
      );
      expect(finalDeclIdx).toBeGreaterThanOrEqual(0);
      expect(runTxnIdx).toBeGreaterThan(finalDeclIdx);
    });

    it("captures finalReservationRef inside the transaction (same now + counter as the booking ref)", () => {
      // The reservation ref is minted inside the
      // transaction so it shares the same `now` + the
      // same counter transaction as the booking ref.
      // The per-day counter is global (not per
      // reservation), so the seq is whatever the
      // counter produced. Same `R-YYYYMMDD-NNNNN`
      // shape as the public path.
      expect(walkin).toMatch(
        /finalReservationRef = `R-\$\{todayCompact\}-\$\{String\(sequence\)\.padStart\(5, "0"\)\}`/
      );
    });

    it("echoes reservationId + reservationRef + idempotentReplay in the success payload", () => {
      // The walk-in success payload mirrors the public
      // path's shape (bookingId, bookingRef,
      // reservationId, reservationRef, idempotentReplay,
      // totalPrice, rateBreakdown) so the caller gets
      // a consistent payload across the two surfaces.
      // The `idempotentReplay` flag is read from the
      // `newBooking` object — `true` when the
      // reservation-level replay short-circuited the
      // transaction; `false` on a fresh create.
      expect(walkin).toMatch(
        /reservationId:\s*effectiveReservationId,\s*\n\s*reservationRef:\s*finalReservationRef,\s*\n\s*idempotentReplay:\s*Boolean\(\(newBooking as any\)\?\.idempotentReplay\)/
      );
    });
  });
});
