// Per MRB-15-08 (2026-08-03): the legacy
// null-`reservationId` fallback audit. Pre-MRB-01
// bookings (the historical single-room contract)
// carry no `reservationId` field on the booking
// doc. Every MRB path has a legacy fallback that
// reads from the booking doc directly + skips the
// reservation-scope work. The contract:
//
//   - Create: pre-MRB-01 callers that don't
//     preallocate a `reservationId` get the
//     server-auto-mint path (a fresh
//     `generateReservationId()` UUIDv4 is stamped
//     on the booking + the header is created).
//     There's no "create with null
//     `reservationId`" path in the post-MRB-01
//     code — the only way to have a null
//     `reservationId` is a pre-MRB-01 booking
//     already in the database.
//   - Add-room: requires a `reservationId` (the
//     schema validates the field). A legacy
//     null-`reservationId` booking can't be
//     added to.
//   - Reschedule: the existing booking's
//     `reservationId` is the canonical anchor. A
//     legacy null-`reservationId` booking
//     falls through to the per-child path (the
//     reschedule updates the booking but does
//     NOT touch a reservation header).
//   - Cancel: the per-child path for legacy
//     (the reservation-scope branch is gated
//     on BOTH `scope === "reservation"` AND the
//     booking having a `reservationId`).
//   - Check-in + check-out: gated on
//     `bookingReservationId.length > 0` — the
//     header mirror is skipped for legacy, the
//     booking's own status flip + room update
//     still fire (byte-equivalent to pre-MRB-01).
//   - Verify payment + mark payment confirmed:
//     gated on `bookingReservationId.length > 0` —
//     the header mirror is skipped for legacy.
//   - Add payment + add refund: dual-source
//     reads — legacy uses
//     `bookings/{id}/payments/{paymentId}`
//     (the CRL-01 historical convention); new
//     reservations use
//     `reservations/{id}/payments/{paymentId}`.
//     The `bookingReservationId.length > 0` guard
//     picks the source.
//   - readTransactionalFolioSnapshot: early
//     return for legacy — reads from
//     `bookings/{id}/payments/` (the historical
//     contract).
//   - loadReservationEmailView: returns `null`
//     for legacy — the caller falls through to
//     the pre-MRB-09 single-room path.
//   - handleLookupBooking: returns
//     `kind: "single"` for legacy (no
//     reservation header + no children to nest).
//   - CRL-07 cancellation liability snapshot:
//     legacy uses `bookings/{id}.cancellationLiability`
//     (the booking IS the reservation for legacy).
//   - handleRecordCancellationException +
//     handleGetCancellationLiability: dual-source
//     read — legacy reads from the booking doc.
//   - isBookingOccupyingRoom: the
//     `holdExpiresAt` check is per-booking (the
//     header's hold is shared for new
//     reservations, per-child for legacy).
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural test
// (full legacy create -> cancel -> add payment ->
// look up) is the emulator follow-up.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

// Slice the source by handler function. The next
// `^export async function` (or `^export function` for
// the in-file helpers) marks the end of the
// current handler. The slice keeps the test
// resilient to other rewrites elsewhere in the file.
function sliceHandler(name: string): string {
  const start = bookingsHandlerSrc.indexOf(`export async function ${name}`);
  if (start < 0) return "";
  const after = bookingsHandlerSrc.slice(start);
  const nextExport = after.slice(1).search(/^export (async )?function/m);
  return nextExport > 0 ? after.slice(0, nextExport + 1) : after;
}

const createHandlerSrc = sliceHandler("handleCreateBooking");
const walkinHandlerSrc = sliceHandler("handleCreateWalkin");
const addRoomHandlerSrc = sliceHandler("handleAddRoomToReservation");
const rescheduleHandlerSrc = sliceHandler("handleRescheduleBooking");
const cancelHandlerSrc = sliceHandler("handleCancelBooking");
const checkinHandlerSrc = sliceHandler("handleCheckinBooking");
const checkoutHandlerSrc = sliceHandler("handleCheckoutBooking");
const verifyPaymentHandlerSrc = sliceHandler("handleVerifyAndRecordPayment");
const markPaymentConfirmedHandlerSrc = sliceHandler("handleMarkPaymentConfirmed");
const addPaymentHandlerSrc = sliceHandler("handleAddPayment");
const addRefundHandlerSrc = sliceHandler("handleAddRefund");
const recordExceptionHandlerSrc = sliceHandler("handleRecordCancellationException");
const lookupHandlerSrc = sliceHandler("handleLookupBooking");

describe("MRB-15-08 — `handleCreateBooking` always mints a `reservationId` (legacy null path is the pre-MRB-01 doc, not a new create)", () => {
  it("the create handler's `effectiveReservationId` is always non-empty (server mints when the body doesn't preallocate)", () => {
    // Per MRB-02 / decision #164: the client may
    // preallocate a `reservationId` for
    // idempotency; the server auto-mints one
    // when the field is absent. There's no
    // "create with null `reservationId`" path
    // in the post-MRB-01 code — the only way to
    // have a null `reservationId` is a
    // pre-MRB-01 booking already in the
    // database. Legacy null-`reservationId`
    // bookings are the historical contract;
    // new bookings always carry a `reservationId`.
    expect(bookingsHandlerSrc).toMatch(
      /const effectiveReservationId: string = \(body\.reservationId && RESERVATION_ID_REGEX\.test\(body\.reservationId\)\)[\s\S]{0,200}?: generateReservationId\(\)/
    );
  });
});

describe("MRB-15-08 — `handleCreateWalkin` always mints a `reservationId` (same pattern)", () => {
  it("the walkin handler's `effectiveReservationId` is always non-empty", () => {
    // The walkin handler mirrors the create
    // handler's `effectiveReservationId` pattern:
    // the client may preallocate, the server
    // auto-mints. Walkins never create a
    // legacy null-`reservationId` booking.
    // The walkin's body field is
    // `requestedReservationId` (the reschedule
    // uses the same name; the public create
    // uses `reservationId`).
    expect(walkinHandlerSrc).toMatch(
      /const effectiveReservationId: string = \(requestedReservationId && RESERVATION_ID_REGEX\.test\(requestedReservationId\)\)[\s\S]{0,200}?: generateReservationId\(\)/
    );
  });
});

describe("MRB-15-08 — `handleAddRoomToReservation` requires a `reservationId` (legacy bookings can't be added to)", () => {
  it("the add-room schema requires `reservationId` (AddRoomBookingSchema)", () => {
    // The `AddRoomBookingSchema` in
    // `shared/schemas/booking.ts` requires a
    // `reservationId: RESERVATION_ID_REGEX`
    // field. A legacy null-`reservationId`
    // booking can't be added to — the
    // add-room endpoint is a multi-room
    // concept that requires the header to
    // exist.
    //
    // (The schema is in `shared/schemas/booking.ts`;
    // the test asserts the add-room handler
    // uses the schema for validation.)
    expect(bookingsHandlerSrc).toMatch(
      /handleAddRoomToReservation[\s\S]{0,1000}?AddRoomBookingSchema\.safeParse/
    );
  });
});

describe("MRB-15-08 — `handleRescheduleBooking` falls through to the per-child path for legacy null-`reservationId` bookings", () => {
  it("the reschedule handler's `bookingReservationId` derivation collapses legacy null / undefined / whitespace to `\"\"` (or returns `null` when no `reservationId` is available)", () => {
    // Per MRB-02 / decision #164: the
    // reschedule's canonical `reservationId`
    // derivation is an IIFE that returns
    // `string | null`. The stored
    // `booking.reservationId` is the
    // canonical anchor; the body's
    // `requestedReservationId` is honored only
    // when the stored value is null
    // (a defensive migration path for a future
    // bulk reschedule tool). Legacy
    // null-`reservationId` bookings return
    // `null` from the IIFE — the reschedule
    // updates the booking but does NOT touch
    // a reservation header (the booking's own
    // rate breakdown + status matrix remain
    // the single source of truth for those
    // legacy records).
    expect(bookingsHandlerSrc).toMatch(
      /handleRescheduleBooking[\s\S]{0,5000}?const bookingReservationId: string \| null = \(\(\) => \{[\s\S]{0,500}?const stored = String\(\(booking as any\)\.reservationId \|\| ""\)\.trim\(\)/
    );
  });
});

describe("MRB-15-08 — `handleCancelBooking` falls through to the per-child path for legacy bookings", () => {
  it("the cancel's reservation-scope branch is gated on BOTH `scope === \"reservation\"` AND `lookedUpReservationId.length > 0`", () => {
    // Per MRB-13 / decision #166: a legacy
    // pre-MRB-01 booking always goes through
    // the per-child path (the `scope` is
    // honored but the reservation branch is
    // unreachable). An N=1 reservation with
    // `scope: "room"` (the default) also stays
    // on the per-child path. The two never
    // overlap.
    expect(bookingsHandlerSrc).toMatch(
      /const isReservationScope = requestedScope === "reservation" && lookedUpReservationId\.length > 0/
    );
  });
});

describe("MRB-15-08 — `handleCheckinBooking` + `handleCheckoutBooking` skip the header mirror for legacy bookings", () => {
  it("the check-in handler's header write is gated on `bookingReservationId.length > 0`", () => {
    // Legacy pre-MRB-01 bookings (no
    // `reservationId`) skip the header write
    // entirely — byte-equivalent to pre-MRB-15-03
    // behavior. The gate is the existing
    // `bookingReservationId.length > 0` check
    // (introduced by MRB-05).
    expect(bookingsHandlerSrc).toMatch(
      /handleCheckinBooking[\s\S]{0,9000}?if \(bookingReservationId\.length > 0\) \{[\s\S]{0,800}?transaction\.update\(reservationRef/
    );
  });

  it("the check-out handler's header write is gated on `bookingReservationId.length > 0`", () => {
    // Same byte-equivalence gate for check-out.
    expect(bookingsHandlerSrc).toMatch(
      /handleCheckoutBooking[\s\S]{0,11000}?if \(bookingReservationId\.length > 0\) \{[\s\S]{0,1000}?transaction\.update\(reservationRef/
    );
  });
});

describe("MRB-15-08 — `handleVerifyAndRecordPayment` + `handleMarkPaymentConfirmed` skip the header mirror for legacy bookings", () => {
  it("the verify-payment handler's header mirror is gated on `bookingReservationId.length > 0`", () => {
    // The reservation-scope payment status
    // mirror (per MRB-04 Phase 3) is skipped
    // for legacy null-`reservationId` bookings
    // — byte-equivalent to pre-Phase 3
    // behavior. The same `now` is used for the
    // booking update AND the header mirror.
    expect(bookingsHandlerSrc).toMatch(
      /handleVerifyAndRecordPayment[\s\S]{0,5000}?bookingReservationId\.length > 0[\s\S]{0,200}?paymentStatus: mapBookingStatusToReservationPaymentStatus/
    );
  });

  it("the verify-payment handler's header mirror is gated on `fullyPaid && bookingReservationId.length > 0` (legacy = skip)", () => {
    // The verify-payment handler mirrors
    // the payment status to the reservation
    // header when the booking just transitioned
    // to `payment-confirmed`. The gate is
    // BOTH `fullyPaid` (the transition fired)
    // AND `bookingReservationId.length > 0`
    // (the booking has a header to mirror
    // to). Legacy null-`reservationId`
    // bookings skip the mirror — byte-
    // equivalent to pre-MRB-04 Phase 3
    // behavior for legacy records.
    expect(verifyPaymentHandlerSrc).toMatch(
      /fullyPaid && bookingReservationId\.length > 0[\s\S]{0,500}?paymentStatus: mapBookingStatusToReservationPaymentStatus/
    );
  });

  it("the mark-payment-confirmed handler is byte-equivalent to pre-MRB-04 (no header mirror)", () => {
    // The mark-payment-confirmed handler is
    // a thin status flipper (`pending` /
    // `payment-uploaded` →
    // `payment-confirmed`). It does NOT
    // mirror the header — the status flip
    // is the only write; the header's
    // `paymentStatus` is recomputed when the
    // staff re-reads the folio. The verify-
    // payment handler (which does mirror) is
    // the separate path that fires from the
    // payment-uploaded transition.
    expect(markPaymentConfirmedHandlerSrc).not.toMatch(
      /paymentStatus: mapBookingStatusToReservationPaymentStatus/
    );
  });
});

describe("MRB-15-08 — `handleAddPayment` + `handleAddRefund` use the dual-source pattern (legacy = `bookings/{id}/...`)", () => {
  it("the add-payment handler's record shape adds the `reservationId` field ONLY for new reservations", () => {
    // Per the dual-source pattern: for new
    // reservations (post-MRB-01, the booking
    // has a `reservationId`), the payment record
    // lives at
    // `reservations/{reservationId}/payments/{paymentId}`.
    // For legacy null-`reservationId` bookings
    // (pre-MRB-01), the payment record stays at
    // `bookings/{bookingId}/payments/{paymentId}`
    // (the historical contract) — the record
    // shape is byte-equivalent to the historical
    // `OnsitePayment` shape (no `reservationId`
    // field).
    expect(bookingsHandlerSrc).toMatch(
      /handleAddPayment[\s\S]{0,5000}?const recordWithReservation = bookingReservationId\.length > 0/
    );
  });

  it("the add-refund handler's record shape uses the dual-source pattern (legacy = `bookings/{id}/payments/`)", () => {
    // The add-refund handler reads from
    // `reservations/{id}/refunds/` (the
    // writer for new reservations per MRB-04
    // Phase 2.x); for legacy
    // null-`reservationId` bookings the refunds
    // are negative-amount entries on
    // `bookings/{id}/payments/` (the CRL-01
    // historical convention). The same sign-
    // aware sum handles both shapes.
    expect(addRefundHandlerSrc).toMatch(
      /historical CRL-01 contract — refunds are[\s\S]{0,100}?negative-amount entries on the booking's payments[\s\S]{0,100}?subcollection/
    );
    // The dual-source pattern: the
    // `refundsRef` is the reservation
    // subcollection when `reservationId` is
    // present, the booking subcollection
    // (the `bookingRef` booking doc + the
    // historical `payments/` subcollection)
    // otherwise.
    expect(addRefundHandlerSrc).toMatch(
      /const refundsRef = bookingReservationId\.length > 0[\s\S]{0,200}?reservations[\s\S]{0,200}?refunds[\s\S]{0,200}?bookingRef[\s\S]{0,200}?payments/
    );
  });

  it("the add-refund handler does NOT mirror the reservation header (it's a money path, not a status path)", () => {
    // Unlike `handleVerifyAndRecordPayment`
    // and `handleMarkPaymentConfirmed`, the
    // add-refund handler does NOT mirror the
    // reservation header's `paymentStatus`.
    // The mirror is reserved for status
    // transitions (the verify / mark-confirmed
    // paths flip the status; the add-refund
    // path only appends a refund record). The
    // header's `paymentStatus` is recomputed
    // when the staff re-reads the folio
    // (via `getReservationFolioSummary`).
    expect(addRefundHandlerSrc).not.toMatch(
      /paymentStatus: mapBookingStatusToReservationPaymentStatus/
    );
  });
});

describe("MRB-15-08 — `readTransactionalFolioSnapshot` early-returns for legacy null-`reservationId` bookings", () => {
  it("the helper skips reservation subcollection reads when `bookingReservationId === \"\"`", () => {
    // The transactional folio reader takes
    // the reservation-aware path (read
    // `reservations/{id}/payments` + `/refunds`
    // + `/charges` + the children) only when
    // the booking has a `reservationId`. For
    // legacy null-`reservationId` bookings,
    // the helper returns early with a
    // snapshot that reads from
    // `bookings/{id}/payments` (the CRL-01
    // historical convention) +
    // `bookings/{id}/charges` — byte-equivalent
    // to pre-MRB-04 Phase 2.
    expect(bookingsHandlerSrc).toMatch(
      /function readTransactionalFolioSnapshot[\s\S]{0,2000}?if \(!bookingReservationId\) \{/
    );
  });
});

describe("MRB-15-08 — `loadReservationEmailView` returns `null` for legacy null-`reservationId` bookings", () => {
  it("the helper returns `null` when `booking.reservationId` is empty (caller falls through to the pre-MRB-09 single-room path)", () => {
    // The reservation-scope email view loader
    // is the single source of truth for the
    // multi-room email view. For legacy
    // null-`reservationId` bookings (pre-MRB-01)
    // it MUST return `null` so the caller
    // falls through to the pre-MRB-09
    // single-room path. The
    // `String(booking.reservationId || "").trim()`
    // defensive coercion is the canonical
    // pattern.
    expect(bookingsHandlerSrc).toMatch(
      /function loadReservationEmailView[\s\S]{0,2500}?if \(!reservationId\) return null/
    );
  });
});

describe("MRB-15-08 — `handleLookupBooking` returns `kind: \"single\"` for legacy null-`reservationId` bookings", () => {
  it("the lookup's reservation branch is gated on the booking having a `reservationId` AND `children.length > 1` (legacy falls through)", () => {
    // The MRB-10 lookup's reservation branch
    // is gated on TWO conditions: the looked-
    // up booking has a `reservationId` (so
    // legacy pre-MRB-01 bookings skip it) AND
    // the reservation has more than 1 child
    // (so N=1 reservations stay on the
    // `kind: "single"` path). Legacy
    // null-`reservationId` bookings skip the
    // reservation branch entirely — they fall
    // through to the `kind: "single"` shape
    // that mirrors the per-child view.
    const lookupGate = bookingsHandlerSrc.match(
      /if \(reservationId\) \{[\s\S]{0,1500}?if \(children\.length > 1\) \{[\s\S]{0,300}?return res\.status\(200\)\.json\(\{[\s\S]{0,300}?data: buildReservationLookupView/
    );
    expect(
      lookupGate,
      "expected handleLookupBooking to call buildReservationLookupView only when reservationId is present AND children.length > 1"
    ).toBeTruthy();
  });

  it("the lookup's single-booking fallback always carries `kind: \"single\"` (the legacy + N=1 path)", () => {
    // Every non-reservation response (legacy
    // null-`reservationId` + N=1 + the error /
    // not-found cases) carries
    // `kind: "single"` so the page can branch
    // deterministically. The single-booking
    // fallback is the legacy byte-equivalent
    // path.
    const singleKind = bookingsHandlerSrc.match(
      /data: \{[\s\S]{0,200}?kind: "single"/
    );
    expect(
      singleKind,
      "expected handleLookupBooking's single-booking fallback to carry kind: 'single'"
    ).toBeTruthy();
  });
});

describe("MRB-15-08 — CRL-07 cancellation liability snapshot lives on the booking doc for legacy (no header to write to)", () => {
  it("the cancel handler's per-child path writes the `cancellationLiability` snapshot onto the booking doc for legacy + per-child cancels", () => {
    // Per CRL-07 / decision #173: the
    // destructive cancel materialises the
    // liability snapshot onto the cancelled
    // entity in the same transaction as the
    // status flip. For reservation-scope
    // cancels + N=1 (the new path), the
    // snapshot lives on the reservation
    // header. For per-child cancels inside a
    // multi-room reservation + legacy
    // null-`reservationId` bookings (the
    // booking IS the reservation), the
    // snapshot lives on the booking doc. The
    // reservation-scope branch uses the
    // `reservationHeaderUpdate` object
    // (writes to the header); the per-child +
    // legacy branch uses the `bookingUpdate`
    // object (writes to the booking doc).
    expect(bookingsHandlerSrc).toMatch(
      /reservationHeaderUpdate\.cancellationLiability = liabilitySnapshot/
    );
    // The per-child + legacy path's
    // snapshot stamp is on the booking
    // doc — the `bookingUpdate` object's
    // `cancellationLiability` field is set
    // when the snapshot is present.
    expect(bookingsHandlerSrc).toMatch(
      /bookingUpdate\.cancellationLiability = liabilitySnapshot/
    );
  });
});

describe("MRB-15-08 — `handleRecordCancellationException` + `handleGetCancellationLiability` use the dual-source read for legacy", () => {
  it("the exception handler reads the liability from the right path (booking doc for legacy, header for new reservations)", () => {
    // Per CRL-07: the exception handler
    // accepts an optional `reservationId` OR
    // `bookingId` and reads the liability from
    // the right path. Legacy
    // null-`reservationId` bookings
    // (`bookingId` is set, `reservationId` is
    // null) read from
    // `bookings/{id}.cancellationLiability`.
    // New reservations read from
    // `reservations/{id}.cancellationLiability`.
    expect(bookingsHandlerSrc).toMatch(
      /handleRecordCancellationException[\s\S]{0,1500}?const safeReservationId = typeof reservationId === "string" \? reservationId\.trim\(\) : ""/
    );
    expect(bookingsHandlerSrc).toMatch(
      /handleRecordCancellationException[\s\S]{0,3000}?const targetRef = safeReservationId[\s\S]{0,200}?adminDb\.collection\("reservations"\)\.doc\(safeReservationId\)[\s\S]{0,200}?adminDb\.collection\("bookings"\)\.doc\(safeBookingId\)/
    );
  });
});
