import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per MRB-09 (2026-08-02, per decision #168): the
// reservation-scope email fan-out. Every
// guest-facing booking email (booking-submitted /
// payment-confirmed / booking-confirmed /
// checkin-reminder / booking-confirmed-with-balance /
// booking-rescheduled / booking-cancelled /
// booking-cancelled-reservation / receipt PDF)
// renders a single block view that lists every room
// in the reservation. The pre-MRB-09 code sent per
// child, which produced N duplicate or single-room
// emails for an N-room reservation. The new code
// uses `buildReservationEmailView` + the
// `loadReservationEmailView` helper to build the
// view from the captured create-transaction data or
// from a fresh Firestore read, and the templates
// detect the `rooms[]` array to switch into the
// multi-room rendering.

const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/email.ts"),
  "utf8"
);

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

describe("MRB-09 — Reservation-scope email view builder", () => {
  it("exports buildReservationEmailView from the email handler", () => {
    expect(emailHandlerSrc).toMatch(
      /export function buildReservationEmailView\(/
    );
  });

  it("the view carries the reservation ref + a rooms[] array of per-stay projections", () => {
    // The view is the single source of truth for the
    // guest-facing email — it carries the reservation
    // ref, the per-room projections, and the aggregate
    // total. The pre-MRB-09 `computedData` shape (just
    // one room's data) is replaced by this view for
    // every reservation-scope email.
    const viewReturn = emailHandlerSrc.match(
      /return\s*\{[\s\S]*?reservationRef:\s*String\(reservation\.reservationRef[\s\S]*?\};\s*\}/
    );
    expect(viewReturn, "expected the view return object").toBeTruthy();
    expect(viewReturn![0]).toMatch(/reservationRef:/);
    expect(viewReturn![0]).toMatch(/reservationId:/);
    expect(viewReturn![0]).toMatch(/isReservation:\s*true/);
    expect(viewReturn![0]).toMatch(/roomCount:/);
    expect(viewReturn![0]).toMatch(/rooms:\s*roomProjections/);
  });

  it("falls through to null for legacy single-room bookings (no reservationId)", () => {
    // The pre-MRB-09 single-room path is preserved —
    // legacy bookings without a `reservationId` return
    // `null` from the helper and the caller falls
    // through to the legacy per-child view.
    const helper = emailHandlerSrc.match(
      /export function buildReservationEmailView\(reservation: any, children: any\[\]\): any \| null \{[\s\S]*?\n\}/
    );
    expect(helper).toBeTruthy();
    expect(helper![0]).toMatch(
      /if \(!reservation \|\| !Array\.isArray\(children\) \|\| children\.length === 0\) return null/
    );
  });

  it("prefixes each room line with 'Room N —' when N>1", () => {
    // The per-room rate breakdown lines are prefixed
    // with the room's 1-indexed position so the email
    // reader can match the line to the rooms list. N=1
    // stays as the legacy single-room label.
    expect(emailHandlerSrc).toMatch(
      /label: children\.length > 1[\s\S]*?`Room \$\{index \+ 1\} — \$\{line\.label \|\| "Room rate"\}`/
    );
  });
});

describe("MRB-09 — Email templates render all rooms when rooms[] is present", () => {
  it("bookingRows iterates over rooms[] and lists every room's ref + occupancy + per-stay total", () => {
    // The legacy `bookingRows` rendered ONE room. The
    // new shape iterates over `rooms[]` when present
    // and renders one row per room with its own ref +
    // type + occupancy + breakfast flag + per-stay
    // total. N=1 falls through to the legacy single-room
    // table (byte-equivalent to pre-MRB-09).
    const bookingRowsBody = emailHandlerSrc.match(
      /function bookingRows\(booking: any\) \{[\s\S]*?\n\}/
    );
    expect(bookingRowsBody).toBeTruthy();
    expect(bookingRowsBody![0]).toMatch(/Array\.isArray\(booking\.rooms\)/);
    expect(bookingRowsBody![0]).toMatch(/rooms\.map\(\(room: any\) =>/);
    expect(bookingRowsBody![0]).toMatch(/`Room \$\{room\.position \|\| 1\}/);
    // The reservation ref surfaces when N>1.
    expect(bookingRowsBody![0]).toMatch(
      /booking\.reservationRef \? row\("Reservation reference", booking\.reservationRef\) : ""/
    );
  });

  it("generateReceiptPdf lists every room with its own ref + per-stay total", () => {
    // The receipt PDF (attached to booking-confirmed
    // + booking-confirmed-with-balance) lists every
    // room when the view is reservation-scope. N=1
    // falls through to the legacy single-room PDF
    // (byte-equivalent to pre-MRB-09).
    const pdfBody = emailHandlerSrc.match(
      /function generateReceiptPdf[\s\S]*?return Buffer\.from\(doc\.output/
    );
    expect(pdfBody).toBeTruthy();
    expect(pdfBody![0]).toMatch(/Array\.isArray\(booking\.rooms\)/);
    expect(pdfBody![0]).toMatch(/Rooms:/);
    expect(pdfBody![0]).toMatch(/booking\.reservationRef/);
  });
});

describe("MRB-09 — Subject lines use the reservation ref when N>1", () => {
  it("every reservation-scope template subject branches on reservationRef", () => {
    // booking-submitted, payment-confirmed,
    // booking-confirmed, checkin-reminder,
    // booking-cancelled, booking-rescheduled, and
    // booking-cancelled-reservation all carry the
    // `subject: booking.reservationRef ? ... : ...`
    // shape. discount-rejected and payment-rejected
    // stay per-room (those actions fire on a specific
    // room's payment proof, not the reservation).
    const expectedTemplates = [
      "booking-submitted",
      "payment-confirmed",
      "booking-confirmed",
      "checkin-reminder",
      "booking-cancelled",
      "booking-cancelled-reservation",
      "booking-rescheduled"
    ];
    for (const template of expectedTemplates) {
      const templateBlock = emailHandlerSrc.match(
        new RegExp(`"${template}":\\s*\\{[\\s\\S]*?subject:\\s*booking\\.reservationRef[\\s\\S]*?\\},?`)
      );
      expect(templateBlock, `expected ${template} subject block`).toBeTruthy();
      expect(templateBlock![0]).toMatch(
        /booking\.reservationRef/
      );
      expect(templateBlock![0]).toMatch(/\$\{config\.brandName\}/);
    }
  });

  it("the receipt PDF filename uses the reservation ref when N>1", () => {
    // The receipt PDF attachment filename uses the
    // reservation ref when present (N>1) and the
    // per-room ref otherwise (N=1, byte-equivalent
    // to pre-MRB-09).
    const pdfAttachment = emailHandlerSrc.match(
      /"booking-confirmed":\s*\{[\s\S]*?attachments:\s*\[[\s\S]*?\}/
    );
    expect(pdfAttachment).toBeTruthy();
    expect(pdfAttachment![0]).toMatch(
      /filename:\s*booking\.reservationRef/
    );
    expect(pdfAttachment![0]).toMatch(
      /receipt-\$\{String\(booking\.reservationRef\)\.replace\(/
    );
  });
});

describe("MRB-09 — Reservation-scope cancel email (booking-cancelled-reservation)", () => {
  it("declares the new EmailAction member", () => {
    // The action is added to the `EmailAction` union
    // and routed through `sendBookingTrigger` like
    // every other template.
    expect(emailHandlerSrc).toMatch(
      /\|\s*"booking-cancelled-reservation"/
    );
  });

  it("declares the bookingCancelledReservationEmail template function", () => {
    expect(emailHandlerSrc).toMatch(
      /function bookingCancelledReservationEmail\(booking: any\) \{/
    );
  });

  it("renders a per-room table with Cancelled / Confirmed status for the partial-cancel case", () => {
    // The template reads each room's `cancelledAt`
    // (per CRL-02 audit stamps) to decide whether
    // the row is "Cancelled" or "Confirmed". A
    // partial cancel (one room cancelled out of N)
    // renders the cancelled row in red and the
    // surviving rows in green so the email is
    // unambiguous about which rooms were affected.
    const template = emailHandlerSrc.match(
      /function bookingCancelledReservationEmail\(booking: any\) \{[\s\S]*?\n\}/
    );
    expect(template).toBeTruthy();
    expect(template![0]).toMatch(/cancelledRooms/);
    expect(template![0]).toMatch(/survivingRooms/);
    expect(template![0]).toMatch(/isFullCancel/);
    expect(template![0]).toMatch(/Cancelled/);
    expect(template![0]).toMatch(/Confirmed/);
  });

  it("uses 'Reservation updated' as the eyebrow for the partial-cancel case", () => {
    // A full cancel keeps the "Reservation cancelled"
    // eyebrow + title. A partial cancel switches to
    // "Reservation updated" + "Part of your reservation
    // was cancelled (N of M rooms)" so the email
    // doesn't read as a full cancellation when only
    // one room was affected.
    const template = emailHandlerSrc.match(
      /function bookingCancelledReservationEmail\(booking: any\) \{[\s\S]*?\n\}/
    );
    expect(template).toBeTruthy();
    expect(template![0]).toMatch(
      /eyebrow = isFullCancel \? "Reservation cancelled" : "Reservation updated"/
    );
  });
});

describe("MRB-09 — Create handler wires the reservation view into the booking-submitted email", () => {
  it("imports buildReservationEmailView from the email handler", () => {
    expect(bookingsHandlerSrc).toMatch(
      /import \{[\s\S]*?buildReservationEmailView[\s\S]*?\} from "\.\/email"/
    );
  });

  it("defines buildCreateEmailView + loadReservationEmailView helpers", () => {
    expect(bookingsHandlerSrc).toMatch(
      /function buildCreateEmailView\(args: \{[\s\S]*?\}\): any \| null \{/
    );
    expect(bookingsHandlerSrc).toMatch(
      /async function loadReservationEmailView\(bookingId: string\): Promise<any \| null> \{/
    );
  });

  it("the post-transaction booking-submitted email send prefers the reservation view", () => {
    // The new code calls `buildCreateEmailView` and
    // hands the result to `sendBookingTrigger`. The
    // pre-MRB-09 `computedData` shape is preserved as
    // the fallback for legacy single-room bookings
    // (pre-MRB-01) that have no `reservationId`.
    expect(bookingsHandlerSrc).toMatch(
      /await sendBookingTrigger\(\s*"booking-submitted",\s*emailView \?\? \{/
    );
    expect(bookingsHandlerSrc).toMatch(
      /const emailView = buildCreateEmailView\(/
    );
    // The pre-MRB-09 `computedData` shape is preserved
    // as the fallback after `emailView ?? {`.
    expect(bookingsHandlerSrc).toMatch(
      /await sendBookingTrigger\(\s*"booking-submitted",\s*emailView \?\? \{[\s\S]*?holdExpiresAt: bookingHoldExpiresAt\s*\}/
    );
  });

  it("the confirm handler passes the reservation view to the booking-confirmed email", () => {
    expect(bookingsHandlerSrc).toMatch(
      /await sendBookingTrigger\(\s*"booking-confirmed",\s*reservationView \?\? \{ \.\.\.bookingData, status: "confirmed" \}/
    );
  });

  it("the cancel handler passes the reservation view (with cancellationReason) to the booking-cancelled email", () => {
    expect(bookingsHandlerSrc).toMatch(
      /await sendBookingTrigger\(\s*"booking-cancelled",\s*reservationView[\s\S]*?cancellationReason: validReason/
    );
  });
});

describe("MRB-09 — Checkin reminder cron consolidates to one email per reservation", () => {
  it("groups pending bookings by reservationId", () => {
    const cronBlock = emailHandlerSrc.match(
      /if \(action === "checkin-reminder" && !req\.body\?\.bookingId && !req\.body\?\.bookingRef\) \{[\s\S]*?legacySingles: legacySingles\.length/
    );
    expect(cronBlock).toBeTruthy();
    expect(cronBlock![0]).toMatch(/reservationGroups/);
    expect(cronBlock![0]).toMatch(/legacySingles/);
  });

  it("sends one email per reservation + one per legacy single", () => {
    const cronBlock = emailHandlerSrc.match(
      /if \(action === "checkin-reminder" && !req\.body\?\.bookingId && !req\.body\?\.bookingRef\) \{[\s\S]*?legacySingles: legacySingles\.length/
    );
    expect(cronBlock).toBeTruthy();
    expect(cronBlock![0]).toMatch(
      /for \(const \{ anchor, view \} of resolvedReservationViews\)/
    );
    expect(cronBlock![0]).toMatch(
      /for \(const single of legacySingles\)/
    );
  });

  it("stamps reminderSentAt on every child of every reminded reservation", () => {
    const cronBlock = emailHandlerSrc.match(
      /if \(action === "checkin-reminder" && !req\.body\?\.bookingId && !req\.body\?\.bookingRef\) \{[\s\S]*?legacySingles: legacySingles\.length/
    );
    expect(cronBlock).toBeTruthy();
    expect(cronBlock![0]).toMatch(
      /for \(const \[, children\] of reservationGroups\.entries\(\)\)[\s\S]*?adminDb\.collection\(["']bookings["']\)\.doc\(child\.id\)\.update\(\{ reminderSentAt: stamp \}\)/
    );
  });
});
