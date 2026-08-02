import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per MRB-07 (2026-08-02, per decision #159): the admin surface for
// multi-room reservations — the New Booking modal's room list, the
// Bookings list's reservation rows with nested room stays, per-action
// scope labelling, and deep links that resolve both a reservation and a
// child booking.
//
// These are source-text guards in the same style as the surrounding
// admin suites (the emulator tests that would drive the real UI are out
// of scope in this sandbox — Java is not installed, per PMH-03). The
// server-side behavior is covered end to end in
// `guest-app/tests/api/mrb-07-walkin-multi-room.test.ts`.

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

const dataTableSrc = readFileSync(
  resolve(__dirname, "../components/DataTable.tsx"),
  "utf8"
);

describe("MRB-07 — New Booking modal: multi-room reservation", () => {
  it("models the reservation as a list of room stays, each with its own room + occupancy", () => {
    // The room, the guests and the extra beds are per stay so a
    // reservation distributes its party across rooms instead of
    // repeating one occupancy on every room.
    expect(bookingsPageSrc).toMatch(/type WalkinRoomStay = \{/);
    const stayType = bookingsPageSrc.match(/type WalkinRoomStay = \{[\s\S]*?\};/)![0];
    expect(stayType).toMatch(/roomType: string;/);
    expect(stayType).toMatch(/roomNumber: string;/);
    expect(stayType).toMatch(/numAdults: number;/);
    expect(stayType).toMatch(/numChildren: number;/);
    expect(stayType).toMatch(/extraBedCount: number;/);
  });

  it("lets the desk add and remove rooms, starting from a single stay", () => {
    expect(bookingsPageSrc).toMatch(/const addWalkinRoomStay = \(\) =>/);
    expect(bookingsPageSrc).toMatch(/const removeWalkinRoomStay = \(index: number\) =>/);
    // Removing the last remaining room would leave a reservation with
    // no rooms, which the server rejects.
    expect(bookingsPageSrc).toMatch(
      /stays\.length <= 1 \? stays : stays\.filter\(\(_, idx\) => idx !== index\)/
    );
    expect(bookingsPageSrc).toMatch(/\+ Add another room/);
  });

  it("never offers a room already claimed by another stay in the same reservation", () => {
    // The server rejects a duplicate room, so the picker must not let
    // the desk build one.
    const availability = bookingsPageSrc.match(
      /const availableRoomsForStay = \(stayIndex: number\) => \{[\s\S]*?\n  \};/
    );
    expect(availability, "expected the per-stay availability filter").toBeTruthy();
    expect(availability![0]).toMatch(/idx !== stayIndex/);
    expect(availability![0]).toMatch(/!claimed\.has\(r\.roomNumber\)/);
  });

  it("blocks submission until every room stay is creatable", () => {
    // Missing room, unknown type, over-capacity without extra beds, and
    // an empty room are all server rejects — the desk is stopped before
    // the round trip rather than after it.
    const validity = bookingsPageSrc.match(
      /const walkinRoomStayIssues = walkinRoomStays\.map\(\(stay\) => \{[\s\S]*?\n  \}\);/
    );
    expect(validity, "expected the per-stay validity map").toBeTruthy();
    expect(validity![0]).toMatch(/if \(!stay\.roomNumber\) return "room";/);
    expect(validity![0]).toMatch(/overflow\.requiredExtraBeds > stay\.extraBedCount/);
    expect(bookingsPageSrc).toMatch(
      /const walkinReservationIsValid = walkinRoomStayIssues\.every\(\(issue\) => issue === null\)/
    );
    expect(bookingsPageSrc).toMatch(/disabled=\{!walkinReservationIsValid \|\| isWalkinSubmitting\}/);
  });

  it("prices every room stay against its own type and sums them for the preview", () => {
    // Matches the server's shape, so the preview the desk approves is
    // the figure that gets written.
    expect(bookingsPageSrc).toMatch(
      /const walkinRoomChargeTotals = walkinRoomStays\.map\(\(stay\) => \{/
    );
    expect(bookingsPageSrc).toMatch(
      /const roomChargeTotal = walkinRoomChargeTotals\.reduce\(\(sum, amount\) => sum \+ amount, 0\)/
    );
  });

  it("sends the room list to the server only when the reservation holds more than one room", () => {
    // A single-room booking keeps the historical body shape, so nothing
    // about the common case changes on the wire.
    const submit = bookingsPageSrc.match(
      /const handleWalkinSubmit = async[\s\S]*?await addWalkinBooking\(\{[\s\S]*?\}\);/
    );
    expect(submit, "handleWalkinSubmit must exist").toBeTruthy();
    expect(submit![0]).toMatch(/rooms: submittedRoomStays\.map\(\(stay\) => \(\{/);
    expect(adminContextSrc).toMatch(
      /\.\.\.\(input\.rooms && input\.rooms\.length > 1 \? \{ rooms: input\.rooms \} : \{\}\)/
    );
  });

  it("forwards the desk's occupancy split and extra-bed count to the server", () => {
    // These were collected by the modal but dropped from the request
    // body, so the server fell back to "all adults, no extra beds" and
    // priced every staff-created booking without them.
    const walkinFn = adminContextSrc.match(
      /const addWalkinBooking = async \([\s\S]*?\n  \};/
    );
    expect(walkinFn, "addWalkinBooking must exist").toBeTruthy();
    const body = walkinFn![0].match(/body: JSON\.stringify\(\{[\s\S]*?\n        \}\)/);
    expect(body, "expected the create-walkin request body").toBeTruthy();
    expect(body![0]).toMatch(/numAdults: input\.numAdults/);
    expect(body![0]).toMatch(/numChildren: input\.numChildren/);
    expect(body![0]).toMatch(/extraBedCount: input\.extraBedCount/);
  });
});

describe("MRB-07 — Bookings list: reservation rows with nested room stays", () => {
  it("classifies each list row as a booking, a reservation, or a nested room stay", () => {
    expect(bookingsPageSrc).toMatch(/type BookingListRow = Booking & \{/);
    expect(bookingsPageSrc).toMatch(
      /listRowKind: "booking" \| "reservation" \| "roomStay";/
    );
  });

  it("keeps operational quick views as room rows", () => {
    // When the desk is working arrivals, departures, in-house or
    // needs-attention, the unit of work is a room — collapsing rooms
    // into a group would hide the very rows being worked.
    const operational = bookingsPageSrc.match(
      /const OPERATIONAL_QUICK_VIEWS = new Set\(\[[\s\S]*?\]\);/
    );
    expect(operational, "expected the operational quick-view set").toBeTruthy();
    expect(operational![0]).toMatch(/"needs-attention"/);
    expect(operational![0]).toMatch(/"arrivals-today"/);
    expect(operational![0]).toMatch(/"departures-today"/);
    expect(operational![0]).toMatch(/"in-house"/);
    expect(bookingsPageSrc).toMatch(
      /const bookingListIsGrouped = !OPERATIONAL_QUICK_VIEWS\.has\(bookingQuickView\)/
    );
  });

  it("only groups a reservation that actually holds more than one row in view", () => {
    // A single-room reservation, a legacy booking with no reservation
    // link, or a group whose other rooms were filtered out must all
    // render as plain room rows, so filters never lie about the result
    // set.
    expect(bookingsPageSrc).toMatch(
      /if \(!reservationId \|\| !group \|\| group\.length < 2\) \{/
    );
  });

  it("orders nested room stays by their reservation position", () => {
    expect(bookingsPageSrc).toMatch(
      /\(a, b\) => \(a\.reservationPosition \|\| 0\) - \(b\.reservationPosition \|\| 0\)/
    );
  });

  it("shows the reservation's aggregate money, room count and mixed status", () => {
    // The reservation row must be triageable without expanding it.
    expect(bookingsPageSrc).toMatch(
      /const reservationTotal = sorted\.reduce\(\(sum, child\) => sum \+ \(child\.totalPrice \|\| 0\), 0\)/
    );
    expect(bookingsPageSrc).toMatch(/getBookingFolio\(child\)\.balance/);
    expect(bookingsPageSrc).toMatch(/\{row\.listRoomCount\} rooms/);
    // A group whose rooms disagree says so rather than picking one
    // room's status to stand for the whole group.
    expect(bookingsPageSrc).toMatch(
      /new Set\(\(row\.listChildBookings \|\| \[\]\)\.map\(\(child\) => child\.status\)\)\.size > 1/
    );
  });

  it("expands a reservation instead of opening a drawer for it", () => {
    // A reservation has no single booking workspace; the desk's next
    // decision is always "which room".
    expect(bookingsPageSrc).toMatch(
      /if \(row\.listRowKind === "reservation"\) \{\s*toggleReservationExpanded\(row\.listReservationId!\);\s*return;/
    );
  });

  it("renders the nesting through the DataTable's row variant", () => {
    expect(bookingsPageSrc).toMatch(/rows=\{groupedRows\}/);
    expect(bookingsPageSrc).toMatch(/rowVariant=\{\(row\) =>/);
    expect(dataTableSrc).toMatch(
      /rowVariant\?: \(row: T\) => "parent" \| "child" \| undefined;/
    );
    // Nested rows are indented and tinted on both the table and the
    // mobile card list.
    expect(dataTableSrc).toMatch(
      /columnIndex === 0 && rowVariant\?\.\(row\) === "child" && "pl-10"/
    );
    expect(dataTableSrc).toMatch(/rowVariant\?\.\(row\) === "child" && "ml-4/);
  });
});

describe("MRB-07 — action scope + deep links", () => {
  it("derives the reservation context only when there is more than one room", () => {
    // For a legacy booking or a single-room reservation there are no
    // other rooms to disambiguate against, so the drawer stays exactly
    // as it was.
    const context = bookingsPageSrc.match(
      /const selectedReservationContext = useMemo\(\(\) => \{[\s\S]*?\}, \[selectedBooking, bookings\]\);/
    );
    expect(context, "expected the reservation context memo").toBeTruthy();
    expect(context![0]).toMatch(/if \(!selectedBooking\?\.reservationId\) return null;/);
    expect(context![0]).toMatch(/if \(siblings\.length < 2\) return null;/);
  });

  it("labels every action with the scope it acts on", () => {
    // Without this the desk cannot tell whether "Cancel Booking" drops
    // one room or the whole group.
    expect(bookingsPageSrc).toMatch(
      /const renderActionScope = \(scope: "room" \| "reservation"\) => \{/
    );
    expect(bookingsPageSrc).toMatch(/\{scope === "room" \? "This room" : "All rooms"\}/);
    // The label is suppressed for single-room work, where it would
    // always read the same.
    expect(bookingsPageSrc).toMatch(
      /if \(!selectedReservationContext\) return null;\s*\n\s*return \(/
    );

    // Room-scoped actions.
    for (const action of [
      "Confirm pay-at-hotel booking",
      "Confirm booking",
      "Move / upgrade room",
      "Cancel Booking"
    ]) {
      expect(
        bookingsPageSrc,
        `expected "${action}" to declare room scope`
      ).toMatch(
        new RegExp(`${action.replace(/[/]/g, "\\/")}[\\s\\S]{0,80}renderActionScope\\("room"\\)`)
      );
    }

    // Reservation-scoped actions: the folio is reservation-owned per
    // MRB-04, so money actions move the whole group's balance.
    for (const action of ["Review proof in Folio", "Confirm with Balance"]) {
      expect(
        bookingsPageSrc,
        `expected "${action}" to declare reservation scope`
      ).toMatch(
        new RegExp(`${action}[\\s\\S]{0,80}renderActionScope\\("reservation"\\)`)
      );
    }
  });

  it("gives the drawer a reservation strip with one-tap room navigation", () => {
    // The desk works a group room by room; re-finding the next room
    // through the list each time is the friction that makes staff avoid
    // group bookings.
    expect(bookingsPageSrc).toMatch(/Reservation \{selectedReservationContext\.reservationRef/);
    expect(bookingsPageSrc).toMatch(
      /Room \{selectedReservationContext\.position\} of \{selectedReservationContext\.roomCount\}/
    );
    expect(bookingsPageSrc).toMatch(
      /selectedReservationContext\.rooms\.map\(\(sibling\) => \(/
    );
    expect(bookingsPageSrc).toMatch(/onClick=\{\(\) => setSelectedBooking\(sibling\)\}/);
  });

  it("resolves deep links by booking id, reservation id, and reservation ref", () => {
    // Emails, receipts and notifications reference whichever level they
    // were written about, and every one of them must land somewhere
    // useful.
    expect(bookingsPageSrc).toMatch(/const bookingId = searchParams\.get\("bookingId"\)/);
    expect(bookingsPageSrc).toMatch(/const reservationId = searchParams\.get\("reservationId"\)/);
    expect(bookingsPageSrc).toMatch(/const reservationRef = searchParams\.get\("reservationRef"\)/);
    // A reservation link expands the group and opens its lead room
    // rather than dead-ending because the id is not a booking id.
    expect(bookingsPageSrc).toMatch(
      /setExpandedReservationIds\(\(current\) => new Set\(current\)\.add\(resolvedReservationId\)\)/
    );
    expect(bookingsPageSrc).toMatch(/setSelectedBooking\(reservationRooms\[0\]\)/);
  });
});
