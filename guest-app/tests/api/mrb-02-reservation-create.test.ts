import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const bookingPage = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);
const refs = readFileSync(
  resolve(__dirname, "../../../shared/utils/references.ts"),
  "utf8"
);
const sharedIndex = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);

describe("MRB-02 single-room reservation create", () => {
  describe("createBookingSchema — accepts client-preallocated reservationId", () => {
    it("imports RESERVATION_ID_REGEX + generateReservationId from shared", () => {
      // The schema validates the client-supplied id against
      // the shared regex; the helper auto-mints a fresh id
      // when the client omits the field. Both are imported
      // from the same `@spark-inn/shared` surface so the
      // wire shape and the generated shape share a single
      // source of truth.
      expect(handlers).toMatch(/RESERVATION_ID_REGEX/);
      expect(handlers).toMatch(/generateReservationId/);
    });

    it("declares reservationId as an optional, regex-validated string on createBookingSchema", () => {
      // The field is optional so legacy callers that have
      // not been updated (e.g. the corporate /book flow —
      // follow-up MRB-02.x) still work; the server
      // auto-mints a fresh id. Validated against the shared
      // regex so a malformed id is rejected at the schema
      // boundary before reaching the transaction.
      expect(handlers).toMatch(
        /reservationId:\s*z\.string\(\)\.trim\(\)\.regex\(RESERVATION_ID_REGEX\)\.optional\(\)/
      );
    });
  });

  describe("Idempotency matrix — reservation transaction reads header first", () => {
    it("declares effectiveReservationId at function scope (above the runTransaction call)", () => {
      // Declared at function scope (not inside the
      // transaction callback) so the post-transaction
      // success response can echo it back to the client.
      // The declaration is above the `runTransaction(async
      // (transaction) => {` call.
      const effectiveDeclIdx = handlers.search(
        /const effectiveReservationId:\s*string\s*=\s*\(body\.reservationId/
      );
      const runTxnIdx = handlers.indexOf(
        "await adminDb.runTransaction(async (transaction) => {"
      );
      expect(effectiveDeclIdx).toBeGreaterThanOrEqual(0);
      expect(runTxnIdx).toBeGreaterThan(effectiveDeclIdx);
    });

    it("computes effectiveReservationId from body.reservationId (when valid) OR auto-mints via generateReservationId()", () => {
      // The server-side derivation of the canonical
      // reservation id. The regex guard runs on
      // `body.reservationId`; a malformed id falls through
      // to the auto-mint. Both branches produce a valid
      // UUIDv4 shape.
      expect(handlers).toMatch(
        /const effectiveReservationId:\s*string\s*=\s*\(body\.reservationId\s*&&\s*RESERVATION_ID_REGEX\.test\(body\.reservationId\)\)/
      );
      expect(handlers).toMatch(/:\s*generateReservationId\(\)/);
    });

    it("reads the reservation header FIRST inside the transaction (before any other read)", () => {
      // The first read in the create transaction is the
      // idempotency check on the reservation header — not
      // the booking doc. This guarantees the
      // reservation-level idempotency matrix
      // (replay / conflict / missing-child) is the first
      // gate, before any booking-level read.
      const firstRead = handlers.search(/transaction\.get\(reservationDocRef\)/);
      const firstBookingRead = handlers.search(/transaction\.get\(bookingDocRef\)/);
      expect(firstRead).toBeGreaterThanOrEqual(0);
      expect(firstBookingRead).toBeGreaterThan(firstRead);
    });

    it("idempotent replay: same reservationId + same fingerprint returns the existing booking's response shape", () => {
      // When the reservation header already exists AND the
      // child booking exists, the transaction reads the
      // existing child doc and builds a response from it.
      // The response carries `idempotentReplay: true` so
      // the client knows it is a replay, not a fresh
      // create.
      expect(handlers).toMatch(
        /sameRequest\s*=\s*String\(existingData\.requestFingerprint \|\| ""\)\s*===\s*reservationRequestFingerprint/
      );
      expect(handlers).toMatch(
        /const existingChildSnap = await transaction\.get\(bookingDocRef\)/
      );
      expect(handlers).toMatch(/idempotentReplay:\s*true/);
    });

    it("fingerprint conflict: same reservationId + different fingerprint throws RESERVATION_ID_FINGERPRINT_CONFLICT", () => {
      // The conflict is detected when the same
      // `reservationId` is re-used with a different
      // request shape (same id, different
      // `requestFingerprint`). Throwing inside the
      // transaction aborts the create and surfaces the
      // canonical error string the catch block maps to
      // 409.
      expect(handlers).toMatch(
        /if \(!sameRequest\) \{\s*throw new Error\("RESERVATION_ID_FINGERPRINT_CONFLICT"\);/
      );
    });

    it("partial-state guard: reservation header exists but child booking missing throws RESERVATION_HEADER_WITHOUT_CHILD", () => {
      // Half-applied create is a 500 (not retryable from
      // the same request — the client must abandon the
      // `reservationId` and start over). The throw fires
      // when the inner `existingChildSnap.exists` is
      // `false` after the reservation header was found.
      expect(handlers).toMatch(
        /throw new Error\("RESERVATION_HEADER_WITHOUT_CHILD"\)/
      );
    });
  });

  describe("Error mapping — catch block maps reservation errors to HTTP status", () => {
    it("RESERVATION_ID_FINGERPRINT_CONFLICT maps to 409", () => {
      // The 409 keeps the booking from being retried with
      // the stale id. Same status code as the existing
      // voucher / corporate-code conflict mappings (per
      // BF-32 + BI-10).
      expect(handlers).toMatch(
        /error\.message === "RESERVATION_ID_FINGERPRINT_CONFLICT"[\s\S]{0,80}status = 409/
      );
    });

    it("RESERVATION_HEADER_WITHOUT_CHILD maps to 500", () => {
      // The half-applied state is unrecoverable by the
      // request and should be flagged to staff. 500 (not
      // 409) signals the client to abandon the
      // `reservationId` rather than retry.
      expect(handlers).toMatch(
        /error\.message === "RESERVATION_HEADER_WITHOUT_CHILD"[\s\S]{0,80}status = 500/
      );
    });
  });

  describe("Header creation — single-room header fields", () => {
    it("writes newReservation via transaction.set with id = effectiveReservationId", () => {
      // The header is created in the same transaction as
      // the child booking. `id` mirrors the doc id (UUID
      // shape) so the two are one-to-one.
      expect(handlers).toMatch(
        /id:\s*effectiveReservationId,\s*\n\s*reservationRef:\s*finalReservationRef/
      );
    });

    it("single-room header sets roomCount: 1, activeRoomCount: 1, cancelledRoomCount: 0, checkedInRoomCount: 0, checkedOutRoomCount: 0", () => {
      // The header's counters are the reservation's actual room
      // count, which for the single-room MRB-02 case is 1.
      //
      // Per MRB-06 / MRB-07 (2026-08-02, per decision #159): both
      // create paths now stamp the counters from the number of rooms
      // they assigned (`assignedRooms.length` on the public path,
      // `walkinRoomCount` on the walk-in), rather than a literal 1.
      // This asserts the expression rather than the literal, because
      // a whole-file search for `roomCount: 1,` passed only by
      // accident once one path still hardcoded it.
      expect(handlers).toMatch(/roomCount:\s*assignedRooms\.length,/);
      expect(handlers).toMatch(/activeRoomCount:\s*assignedRooms\.length,/);
      expect(handlers).toMatch(/roomCount:\s*walkinRoomCount,/);
      expect(handlers).toMatch(/activeRoomCount:\s*walkinRoomCount,/);
      // The lifecycle counters still start empty on a fresh
      // reservation — nothing is cancelled or checked out at create.
      expect(handlers).toMatch(/cancelledRoomCount:\s*0/);
      expect(handlers).toMatch(/checkedInRoomCount:\s*0/);
      expect(handlers).toMatch(/checkedOutRoomCount:\s*0/);
    });

    it("derives paymentStatus from the child's status: awaiting-payment for pending, payment-uploaded for payment-uploaded", () => {
      // The header's `paymentStatus` mirrors the child's
      // status until the post-transaction code transitions
      // the booking to `payment-confirmed` / `confirmed`.
      // Both pre-confirmation states map to a single
      // `awaiting-payment` / `payment-uploaded` shape.
      expect(handlers).toMatch(
        /paymentStatus:\s*\(paymentProofPath \|\| paymentProofUrl\)\s*\?\s*"payment-uploaded"\s*:\s*"awaiting-payment"/
      );
    });

    it("stamps requestFingerprint on the header (the canonical idempotency anchor)", () => {
      // The fingerprint is the same
      // `reservationRequestFingerprint` the pre-transaction
      // block computes from the schema inputs. The header
      // carries it so the next request with the same
      // `reservationId` can compare.
      expect(handlers).toMatch(
        /requestFingerprint:\s*reservationRequestFingerprint/
      );
    });
  });

  describe("Booking doc — 4 reservation fields stamped on newBooking", () => {
    it("stamps reservationId, reservationRef, reservationPosition: 1, reservationRoomCount: 1", () => {
      // Per MRB-01, every new booking (including a
      // one-room stay) carries the four nullable
      // reservation fields. The single-room case is
      // `position: 1` / `roomCount: 1`; MRB-06's N>1
      // case will assign sequential positions.
      expect(handlers).toMatch(
        /reservationId:\s*effectiveReservationId,\s*\n\s*reservationRef:\s*finalReservationRef,\s*\n\s*reservationPosition:\s*1,\s*\n\s*reservationRoomCount:\s*1/
      );
    });
  });

  describe("Success response — echoes reservationId + reservationRef + idempotentReplay", () => {
    it("declares finalReservationRef at function scope (above the runTransaction call)", () => {
      // Captured at function scope so the post-transaction
      // response can echo it. Same `finalX` capture
      // pattern as `finalBookingRef` / `finalTotalPrice`.
      const finalDeclIdx = handlers.search(/let finalReservationRef = ""/);
      const runTxnIdx = handlers.indexOf(
        "await adminDb.runTransaction(async (transaction) => {"
      );
      expect(finalDeclIdx).toBeGreaterThanOrEqual(0);
      expect(runTxnIdx).toBeGreaterThan(finalDeclIdx);
    });

    it("echoes reservationId + reservationRef + idempotentReplay: false in the success payload", () => {
      // The fresh-create success payload mirrors the
      // replay payload shape (bookingId, reservationId,
      // reservationRef, roomId, roomNumber, totalPrice,
      // bookingRef, rateBreakdown, holdExpiresAt,
      // idempotentReplay) so the client gets the same
      // fields whether the call is a fresh create or an
      // idempotent replay. The fresh create has
      // `idempotentReplay: false` to discriminate.
      expect(handlers).toMatch(
        /reservationId:\s*effectiveReservationId,\s*\n\s*reservationRef:\s*finalReservationRef,\s*\n\s*idempotentReplay:\s*false/
      );
    });

    it("legacy alreadyExistingBookingResponse carries the same shape (reservationId + reservationRef + idempotentReplay: true)", () => {
      // The legacy booking-level replay (the
      // pre-MRB-02 path that fires when
      // `body.reservationId` is absent and the booking
      // doc already exists) carries the same shape so
      // the client gets a consistent payload across the
      // three paths (fresh create, reservation-level
      // replay, legacy booking-level replay).
      expect(handlers).toMatch(
        /reservationId:\s*String\(existing\.reservationId \|\| ""\),\s*\n\s*reservationRef:\s*String\(existing\.reservationRef \|\| ""\),\s*\n\s*idempotentReplay:\s*true/
      );
    });
  });

  describe("Client caller — BookingPage preallocates reservationId", () => {
    it("imports generateReservationId from @spark-inn/shared", () => {
      // The single-room public create flow
      // (`BookingPage.tsx`) is the first caller updated
      // to preallocate a `reservationId`. The corporate
      // /book flow stays on legacy null-reservationId
      // (follow-up MRB-02.x).
      expect(bookingPage).toMatch(
        /import\s*\{\s*generateReservationId\s*\}\s*from\s*"@spark-inn\/shared"/
      );
    });

    it("preallocates reservationId via useState lazy init (one-time per mount)", () => {
      // `useState(() => generateReservationId())` is the
      // canonical pattern: the same id survives across
      // renders and retry-after-uncertain-response (the
      // user re-tries without reloading the page; the id
      // is reused so the server's reservation
      // transaction either replays the original commit
      // — same `requestFingerprint` — or returns a 409
      // conflict for a different `requestFingerprint`).
      expect(bookingPage).toMatch(
        /const \[reservationId\]\s*=\s*useState\(\(\)\s*=>\s*generateReservationId\(\)\)/
      );
    });

    it("sends reservationId in the body of POST /api/bookings/create", () => {
      // The client-preallocated id rides on the same
      // request as `bookingId`. The server's schema
      // accepts it as optional; when present, the
      // server uses it as the canonical idempotency
      // key for the create transaction.
      expect(bookingPage).toMatch(/reservationId,/);
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
      // `crypto.randomUUID()` (or the supplied
      // generator) returns a non-conforming shape. This
      // is a "missing generator surfaces immediately"
      // guard — a malformed id would silently corrupt
      // the idempotency contract.
      expect(refs).toMatch(
        /if \(!isValidReservationId\(id\)\) \{\s*throw new Error\("Generated reservationId did not match the expected UUIDv4 shape\.\"\)/
      );
    });
  });
});
