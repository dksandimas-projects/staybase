// Per MRB-14-04 (2026-08-03, per decision #180): the
// per-child dates UI surfaces across the Bookings table
// row + the drawer reservation strip + the guest email +
// the staff receipt PDF. The new behaviour reads
// `Reservation.actualDateRange.isDivergent` from the
// `Reservation` header (hydrated by AdminContext) and:
//   - Bookings table Dates column: shows MIN/MAX with
//     "varies by room" badge when isDivergent
//   - Drawer reservation strip: shows an "Actual range"
//     pill row below the Total/Paid/Balance pills
//   - Email `buildReservationEmailView`: emits
//     `actualDateRange` on the view; room projections
//     carry per-child `checkIn` / `checkOut`
//   - Email `bookingRows` reservation branch: shows
//     actual range + "(varies by room)" + per-room dates
//   - Receipt PDF Stay card: "Actual range" line +
//     per-room dates inline under the room label
//
// This file pins the new read paths at the source level
// so a future refactor cannot silently fall through to
// the shared-range render for a divergent reservation.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural tests
// (rsvp confirm + reminder cron divergence) live in
// guest-app/tests/api.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingsPage.tsx"),
  "utf8"
);
const emailHandlerSrc = readFileSync(
  // Per the guest-app's `npm test` layout: server handlers
  // are referenced via the package's relative path from
  // a co-located test. The admin test below is allowed to
  // reach into the guest-app source to pin the contract
  // that the email surfaces depend on.
  resolve(__dirname, "../../../guest-app/server/handlers/email.ts"),
  "utf8"
);

describe("MRB-14-04 — Bookings table row Dates column diverges on `actualDateRange.isDivergent`", () => {
  it("the Dates column render reads `listReservationHeader.actualDateRange.isDivergent` as the gate", () => {
    // The new pattern: the Dates column switches to the
    // divergent read (`earliestCheckIn` → `latestCheckOut`
    // + "varies by room" badge) only when the reservation
    // header carries `actualDateRange.isDivergent === true`.
    // Legacy / N=1 / non-divergent reservations fall
    // through to the original per-row render.
    expect(bookingsPageSrc).toMatch(
      /row\.listReservationHeader\?\.actualDateRange\?\.isDivergent/
    );
  });

  it("the divergent Dates column renders a `data-testid=\"reservation-dates-divergent\"` badge with the actual range", () => {
    // The badge uses the reservation header's
    // `earliestCheckIn` / `latestCheckOut` (Date
    // objects from the AdminContext hydration) +
    // a "varies by room" label. Source-text: the
    // testid + the badge text + the format helper
    // are all present in the column render.
    expect(bookingsPageSrc).toMatch(/data-testid="reservation-dates-divergent"/);
    expect(bookingsPageSrc).toMatch(/varies by room/);
    expect(bookingsPageSrc).toMatch(/formatShortDate\(range\.earliestCheckIn\)/);
    expect(bookingsPageSrc).toMatch(/formatShortDate\(range\.latestCheckOut\)/);
  });

  it("the per-child dates tooltip on the divergent row reads each child's own `checkIn` / `checkOut`", () => {
    // The row's title attribute lists the per-room
    // dates so the desk sees which child has which
    // range on hover. The list is built from
    // `row.listChildBookings`.
    expect(bookingsPageSrc).toMatch(
      /\(row\.listChildBookings \|\| \[\]\)[\s\S]*?\.map\(\(child: any\) => `Room \$\{child\.roomNumber\}: \$\{formatShortDate\(child\.checkIn\)\} – \$\{formatShortDate\(child\.checkOut\)\}`\)/
    );
  });
});

describe("MRB-14-04 — Drawer reservation strip shows the Actual range pill when divergent", () => {
  it("the drawer strip reads `reservationHeader.actualDateRange` and gates on `isDivergent`", () => {
    // The pill row sits after the Total / Paid /
    // Balance pills. The gate is the header's
    // `actualDateRange.isDivergent`. Legacy / N=1
    // reservations hide the pill.
    expect(bookingsPageSrc).toMatch(/data-testid="reservation-strip-actual-range"/);
    expect(bookingsPageSrc).toMatch(
      /const actualRange = reservationHeader\?\.actualDateRange;\s*if \(!actualRange \|\| !actualRange\.isDivergent\) return null;/
    );
  });

  it("the Actual range pill renders the earliest/latest format from the header + a `varies by room` chip", () => {
    // The same format helper the row Dates column
    // uses (MMM D en-US UTC). The "varies by room"
    // chip is the same label the row Dates column
    // shows so the desk sees the same vocabulary on
    // both surfaces.
    expect(bookingsPageSrc).toMatch(
      /earliestStr = formatShortDate\(actualRange\.earliestCheckIn\)/
    );
    expect(bookingsPageSrc).toMatch(
      /latestStr = formatShortDate\(actualRange\.latestCheckOut\)/
    );
  });
});

describe("MRB-14-04 — Receipt PDF Stay card + pricing breakdown diverge on `actualDateRange.isDivergent`", () => {
  it("the receipt Stay card adds an `Actual range` row when the header is divergent", () => {
    // The Stay card row is only added when the
    // reservation header's `actualDateRange.isDivergent`
    // is true. The value is "earliest → latest
    // (varies by room)" using the same short date
    // format as the row + drawer.
    const stayRows = bookingsPageSrc.match(
      /const stayRows = \[[\s\S]*?\]\;/
    );
    expect(stayRows, "expected the receipt Stay rows array").toBeTruthy();
    if (!stayRows) return;
    expect(stayRows[0]).toMatch(/label: "Actual range"/);
    expect(stayRows[0]).toMatch(/varies by room/);
  });

  it("the receipt pricing breakdown prints per-room dates inline under each room label when divergent", () => {
    // The room allocations block prints the
    // child's `checkIn → checkOut` (raw ISO string
    // from the booking doc) under the room label
    // when the header is divergent. The non-
    // divergent path omits the line so the
    // reservation's shared dates aren't duplicated.
    expect(bookingsPageSrc).toMatch(
      /reservationActualRange\?\.isDivergent && receiptBooking\.checkIn && receiptBooking\.checkOut/
    );
    expect(bookingsPageSrc).toMatch(
      /\$\{receiptBooking\.checkIn\} → \$\{receiptBooking\.checkOut\}/
    );
  });
});

describe("MRB-14-04 — Email `buildReservationEmailView` emits `actualDateRange` + per-room dates", () => {
  it("the view's `roomProjections` carry each child's `checkIn` / `checkOut` / `numNights`", () => {
    // The multi-room email needs the per-child
    // dates on the room projection so the
    // reservation branch can render the actual
    // range + per-room dates when the children
    // have diverged.
    expect(emailHandlerSrc).toMatch(
      /checkIn: child\.checkIn,\s*\n\s*checkOut: child\.checkOut,\s*\n\s*numNights: Number\(child\.numNights \|\| 0\)/
    );
  });

  it("the view exposes `actualDateRange` (with `isDivergent` flag) at the top level", () => {
    // The view passes the denormalised range
    // through to the templates. Pre-MRB-14
    // reservations carry no field (`undefined` on
    // `reservation.actualDateRange`) and the
    // template falls through to the legacy
    // shared-range render.
    expect(emailHandlerSrc).toMatch(
      /actualDateRange: reservation\.actualDateRange\s*\n\s*\? \{[\s\S]*?isDivergent: Boolean\(reservation\.actualDateRange\.isDivergent\)[\s\S]*?\}\s*:\s*null/
    );
  });
});

describe("MRB-14-04 — Email `bookingRows` reservation branch surfaces divergent dates", () => {
  it("the reservation branch detects divergence via `booking.actualDateRange.isDivergent`", () => {
    // The multi-room branch reads the view's
    // `actualDateRange.isDivergent` flag and
    // switches the check-in / check-out rows to
    // the actual range + "(varies by room)".
    expect(emailHandlerSrc).toMatch(
      /const isDivergent = Boolean\(actualRange && actualRange\.isDivergent\)/
    );
  });

  it("the divergent check-in / check-out rows append ` (varies by room)` to the actual range", () => {
    // The legacy single-room path is unchanged;
    // only the reservation path with the new
    // flag adds the "(varies by room)" suffix.
    expect(emailHandlerSrc).toMatch(
      /isDivergent && actualRange\.earliestCheckIn\s*\n\s*\? `\$\{formatDate\(actualRange\.earliestCheckIn\)\} from \$\{config\.checkInTime \|\| "14:00"\} \(varies by room\)`/
    );
    expect(emailHandlerSrc).toMatch(
      /isDivergent && actualRange\.latestCheckOut\s*\n\s*\? `\$\{formatDate\(actualRange\.latestCheckOut\)\} by \$\{config\.checkOutTime \|\| "12:00"\} \(varies by room\)`/
    );
  });

  it("the per-room dates appear inline on each room row when divergent", () => {
    // The room line in the multi-room email
    // appends the per-child checkIn → checkOut
    // when the reservation is divergent. The
    // non-divergent path keeps the compact
    // "Room N — type" line (byte-equivalent to
    // pre-MRB-14).
    const roomDatesBlock = emailHandlerSrc.match(
      /const roomDatesSuffix[\s\S]{0,400}/
    );
    expect(roomDatesBlock, "expected the roomDatesSuffix ternary").toBeTruthy();
    if (!roomDatesBlock) return;
    expect(roomDatesBlock[0]).toMatch(/isDivergent && room\.checkIn && room\.checkOut/);
    expect(roomDatesBlock[0]).toMatch(/formatDate\(room\.checkIn\)/);
    expect(roomDatesBlock[0]).toMatch(/formatDate\(room\.checkOut\)/);
  });
});
