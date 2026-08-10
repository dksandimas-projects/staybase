import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per MRB-10 (2026-08-02, per decision #169): the
// guest lookup resolves a reservation with nested
// rooms. The server returns a `kind: "reservation"`
// response when the looked-up booking has a
// `reservationId` AND the reservation has N>1
// children. N=1 falls through to the legacy
// `kind: "single"` path (byte-equivalent); legacy
// pre-MRB-01 bookings (no `reservationId`) also stay
// `kind: "single"`. The page renders one card with
// the reservation header + a per-room list. Cancel
// acts on the reservation (`scope: "reservation"`);
// resend fires the primary child's email (a future
// "resend reservation email" endpoint will fire the
// reservation-scope template).

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const lookupPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingLookupPage.tsx"),
  "utf8"
);

describe("MRB-10 — handleLookupBooking accepts a reservationRef", () => {
  it("the lookupSchema accepts an optional reservationRef with the R-YYYYMMDD-NNNNN shape", () => {
    // The MRB-09 reservation-scope emails carry a
    // `reservationRef` link so the guest can deep-
    // link straight to the reservation without
    // first landing on a per-child booking.
    expect(bookingsHandlerSrc).toMatch(
      /reservationRef: z\s*\.string\(\)\s*\.trim\(\)\s*\.max\(40\)\s*\.regex\(/
    );
    expect(bookingsHandlerSrc).toMatch(/R-\\d\{8\}-\\d\{5\}/);
  });

  it("the refine accepts a reservationRef as a valid input key alongside bookingRef / email / token", () => {
    expect(bookingsHandlerSrc).toMatch(
      /\.refine\(\s*\(data\) => Boolean\(data\.bookingRef\) \|\| Boolean\(data\.reservationRef\) \|\| Boolean\(data\.guestEmail\) \|\| Boolean\(data\.token\)/
    );
  });

  it("the lookupSchema refines out a body that has neither bookingRef, reservationRef, email, nor token", () => {
    // The legacy "Provide a booking reference, email, or
    // lookup token." message was updated to include
    // "reservation reference" so a guest who pastes only
    // a `reservationRef` (from the MRB-09 email footer)
    // sees a clear error.
    expect(bookingsHandlerSrc).toMatch(
      /"Provide a booking reference, reservation reference, email, or lookup token\.?"/
    );
  });
});

describe("MRB-10 — direct reservationRef lookup path", () => {
  it("the handler dispatches on reservationRef and queries the reservations collection", () => {
    expect(bookingsHandlerSrc).toMatch(
      /if \(trimmedReservationRef\) \{/
    );
    expect(bookingsHandlerSrc).toMatch(
      /adminDb\.collection\("reservations"\)\s*\.where\(\s*"reservationRef",\s*"==",\s*trimmedReservationRef/
    );
  });

  it("the email-second-factor path verifies the email against reservation.leadGuestEmail", () => {
    // The credential is the lead guest's email
    // (the canonical email for the reservation).
    // A mismatch returns the same "Booking not
    // found." reply so this is not an email-
    // existence oracle.
    expect(bookingsHandlerSrc).toMatch(
      /if \(normalizedEmail\) \{[\s\S]*?const leadEmail = String\(reservation\.leadGuestEmail \|\| ""\)\.trim\(\)\.toLowerCase\(\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /if \(leadEmail !== normalizedEmail\) \{[\s\S]*?return res\.status\(404\)\.json\(\{ success: false, error: "Booking not found\." \}\)/
    );
  });

  it("the lookupToken path verifies against the first child's lookupToken", () => {
    // The reservation's first child (by
    // reservationPosition) carries the email
    // footer's lookup token. The handler finds
    // the child whose `lookupToken` matches and
    // hands the child to `enrichAndRespond` so
    // the existing single-booking paths can
    // detect the `reservationId` and return the
    // reservation view.
    expect(bookingsHandlerSrc).toMatch(
      /if \(lookupToken\) \{/
    );
    expect(bookingsHandlerSrc).toMatch(
      /String\(c\.lookupToken/
    );
    expect(bookingsHandlerSrc).toMatch(
      /String\(lookupToken\)\.toLowerCase\(\)/
    );
  });

  it("a bare reservationRef with no credential falls through to enrichAndRespond (R- alone path)", () => {
    // Per #209 (RFO-01, 2026-08-10) the bare R- path
    // is accepted with the same defense posture as
    // the SI- `ref`-alone path. The previous 400
    // response (the original MRB-10 spec, decision
    // #169) was retired because the R- ref is the
    // reservation's public identifier (subject line,
    // body header, receipt PDF filename) and the
    // form's header copy reads "Enter your booking
    // reference or the email you used to book" —
    // the guest expects the R- to work without a
    // second factor. The 99,999-key per-day
    // namespace has the same enumeration risk as
    // the SI- ref-alone path; the same defenses
    // (Turnstile + 10/min rate limit + 3-failure
    // 1-hour backoff) apply.
    //
    // The R- alone path removes the
    // `else { return res.status(400) ... }` branch
    // and falls through to the same first-child
    // lookup + `enrichAndRespond` call the
    // email-second-factor path uses.
    expect(bookingsHandlerSrc).not.toMatch(
      /Please provide your booking email or lookup token along with the reservation reference\./
    );
    // The fall-through still reads the first child
    // and hands to enrichAndRespond (the same
    // shape the email + token paths use).
    expect(bookingsHandlerSrc).toMatch(
      /if \(trimmedReservationRef\) \{[\s\S]*?const reservationSnap[\s\S]*?where\("reservationRef",\s*"==",\s*trimmedReservationRef\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /if \(trimmedReservationRef\) \{[\s\S]*?orderBy\("reservationPosition",\s*"asc"\)/
    );
  });

  it("a credential match hands the first child to enrichAndRespond which detects the reservationId", () => {
    expect(bookingsHandlerSrc).toMatch(
      /adminDb\.collection\("bookings"\)\s*\.where\(\s*"reservationId",\s*"==",\s*reservation\.id\)/
    );
    expect(bookingsHandlerSrc).toMatch(/orderBy\("reservationPosition",\s*"asc"\)/);
  });
});

describe("MRB-10 — enrichAndRespond returns kind: 'reservation' when N>1", () => {
  it("detects the looked-up booking's reservationId and reads the reservation + siblings", () => {
    // Check the file directly for the three reads
    // (reservation doc, children siblings) instead of
    // trying to regex the function body — the body
    // is long and the non-greedy match can miss.
    expect(bookingsHandlerSrc).toMatch(
      /const reservationId = String\(bookingData\.reservationId/
    );
    expect(bookingsHandlerSrc).toMatch(
      /adminDb\.collection\("reservations"\)\.doc\(reservationId\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /"reservationId", "==", reservationId/
    );
  });

  it("the kind: 'reservation' branch is taken only when children.length > 1", () => {
    // N=1 falls through to the legacy single-booking
    // shape (the reservation view is byte-equivalent
    // to the per-child view for N=1). Legacy pre-MRB-01
    // bookings (no reservationId) also fall through.
    const enrichMatch = bookingsHandlerSrc.match(
      /async function enrichAndRespond\(res: any, bookingData: any\) \{[\s\S]*?\n\}/
    );
    expect(enrichMatch).toBeTruthy();
    expect(enrichMatch![0]).toMatch(/if \(children\.length > 1\)/);
  });

  it("buildReservationLookupView returns kind: 'reservation' + the per-room projections", () => {
    // The view carries the reservation ref + the
    // masked email + dates + nights + aggregate
    // total + payment status + the rooms[] array.
    // No `guestName` is reflected (decisions
    // #126/#128/#131). The page renders this view.
    const viewMatch = bookingsHandlerSrc.match(
      /function buildReservationLookupView\(reservation: any, children: any\[\], anchorRoomData: any \| null, anchorBooking: any\) \{[\s\S]*?\n\}/
    );
    expect(viewMatch).toBeTruthy();
    expect(viewMatch![0]).toMatch(/kind: "reservation"/);
    expect(viewMatch![0]).toMatch(/reservationRef: reservation\.reservationRef/);
    expect(viewMatch![0]).toMatch(/maskedEmail:/);
    expect(viewMatch![0]).toMatch(/rooms,/);
    expect(viewMatch![0]).toMatch(/primaryBookingId: anchorBooking\.id/);
    expect(viewMatch![0]).toMatch(/primaryBookingRef: anchorBooking\.bookingRef/);
  });

  it("children are sorted by reservationPosition so the page renders them in creation order", () => {
    expect(bookingsHandlerSrc).toMatch(
      /const sortedChildren = \[\.\.\.children\]\.sort\(/
    );
    expect(bookingsHandlerSrc).toMatch(
      /Number\(a\.reservationPosition/
    );
    expect(bookingsHandlerSrc).toMatch(
      /Number\(b\.reservationPosition/
    );
  });
});

describe("MRB-10 — BookingLookupPage renders the reservation view", () => {
  it("defines the ReservationView + ReservationRoom types", () => {
    expect(lookupPageSrc).toMatch(/interface ReservationRoom \{/);
    expect(lookupPageSrc).toMatch(/interface ReservationView \{/);
    expect(lookupPageSrc).toMatch(/rooms: ReservationRoom\[\]/);
  });

  it("the page holds an activeReservation state set from the kind: 'reservation' response", () => {
    expect(lookupPageSrc).toMatch(
      /const \[activeReservation, setActiveReservation\] = useState<ReservationView \| null>\(null\)/
    );
  });

  it("the response handling detects kind: 'reservation' and sets activeReservation", () => {
    expect(lookupPageSrc).toMatch(
      /if \(kind === "reservation" && Array\.isArray\(data\?\.rooms\)\) \{/
    );
    expect(lookupPageSrc).toMatch(/setActiveReservation\(normalized\)/);
  });

  it("the page clears activeReservation when the user resets the search", () => {
    expect(lookupPageSrc).toMatch(
      /handleResetSearch[\s\S]*?setActiveReservation\(null\)/
    );
  });

  it("the reservation card renders the reservation ref + the room list", () => {
    expect(lookupPageSrc).toMatch(/activeReservation && \(/);
    expect(lookupPageSrc).toMatch(/Reference: \{activeReservation\.reservationRef\}/);
    expect(lookupPageSrc).toMatch(/Rooms in this reservation/);
    expect(lookupPageSrc).toMatch(/Room \{room\.position\} · \{room\.roomType \|\| "Room"\}/);
  });

  it("the cancel submit routes the reservation through scope: 'reservation'", () => {
    // The cancel body adds `scope: "reservation"` when
    // `activeReservation` is set, so the server's
    // `handleCancelBooking` honours the MRB-13
    // reservation-scope cancel path.
    expect(lookupPageSrc).toMatch(
      /cancelPayload\.scope = "reservation"/
    );
    expect(lookupPageSrc).toMatch(
      /activeReservation\?\.primaryBookingRef/
    );
  });

  it("the resend submit routes the reservation through primaryBookingRef", () => {
    // The MRB-09 reservation-scope email templates
    // are fired server-side on create; the resend
    // endpoint is per-child. For MVP the resend
    // fires the primary child's email — the
    // per-child template now renders the full
    // reservation view (per MRB-09). A future
    // "resend reservation email" endpoint is
    // MRB-15 follow-up.
    expect(lookupPageSrc).toMatch(
      /activeReservation\?\.primaryBookingRef/
    );
  });

  it("the cancel modal copy is reservation-scope when activeReservation is set", () => {
    expect(lookupPageSrc).toMatch(
      /This will cancel all <strong>\{guestCancellableReservationRooms\.length\} eligible room/
    );
    expect(lookupPageSrc).toMatch(/activeReservation\.reservationRef\}/);
  });
});
