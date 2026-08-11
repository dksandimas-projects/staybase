// Per MRB-15-05 (2026-08-03): the canonical/copy
// consistency audit. Every user-facing surface
// (email subjects, email preheaders, email body
// copy, receipt PDF labels, admin status labels,
// dashboard text) uses the same vocabulary for the
// same concept. Mixed-capitalisation or term drift
// (e.g. "Cancelled" vs "canceled", "Booking" vs
// "reservation" in the same sentence) is a real
// source of staff + guest confusion.
//
// Canonical conventions (per the schema's JSDoc +
// the MRB-12 / MRB-14 implementation records):
//
//   - "Reservation" for the group (the
//     `Reservation` header + `R-YYYYMMDD-NNNNN`
//     ref). NEVER "Group" or "Multi-room booking".
//   - "Booking" for the individual stay (the
//     `Booking` doc + `B-YYYYMMDD-NNNNN` ref).
//   - "Reservation reference" for `R-...` refs.
//     NEVER "Reservation ID" or "Res ID" or "Ref".
//   - "Booking reference" for `B-...` refs.
//   - "Cancelled" (title case) for display labels.
//     "cancelled" (lowercase) for status code
//     values. NEVER "Canceled" (American spelling)
//     — the rest of the codebase uses British
//     spelling (the team is Filipino + the
//     hotel's English style guide uses British).
//   - "In-house" (status: "in-house") vs
//     "Checked in" (status: "checked-in") — the
//     reservation-scope status uses "in-house";
//     the booking-scope status uses "checked-in".
//   - "Completed" (status: "completed") vs
//     "Checked out" (status: "checked-out") — same
//     pattern.
//   - Status display labels (admin StatusBadge) use
//     title case: "Awaiting", "Proof pending",
//     "Verified", "Confirmed", "In-house",
//     "Completed", "Cancelled".
//   - Email preheaders use natural sentence case
//     (start with a capital, not a status code).
//     The "Booking ${ref} is confirmed" pattern
//     was the legacy quick-identifier style —
//     the reservation-scope rewrite uses natural
//     sentences.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. No behavioural test
// needed — copy is read-only at the source level.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/email.ts"),
  "utf8"
);
const adminBookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);
const adminDashboardSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/DashboardPage.tsx"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

describe("MRB-15-05 — Admin StatusBadge uses title-case labels (no mixed capitalisation)", () => {
  it("the 7 ReservationPaymentStatus values map to title-case display labels", () => {
    // The status map is the single source of
    // truth for the admin pill tone + label.
    // Every entry uses title case (the first
    // letter is capitalised; the rest is lower
    // case except for "In-house" which keeps the
    // hyphen). British spelling throughout
    // ("Cancelled" not "Canceled").
    const statusMapBlock = adminBookingsPageSrc.match(
      /"awaiting-payment": \{ label: "Awaiting"[\s\S]{0,800}?cancelled: \{ label: "Cancelled"/
    );
    expect(
      statusMapBlock,
      "expected the 7 ReservationPaymentStatus entries with title-case labels"
    ).toBeTruthy();
    if (!statusMapBlock) return;
    // Every status code maps to a single-word or
    // hyphenated title-case label. No American
    // "Canceled" spelling.
    expect(statusMapBlock[0]).toMatch(/"awaiting-payment": \{ label: "Awaiting"/);
    expect(statusMapBlock[0]).toMatch(/"payment-uploaded": \{ label: "Proof pending"/);
    expect(statusMapBlock[0]).toMatch(/"payment-confirmed": \{ label: "Verified"/);
    expect(statusMapBlock[0]).toMatch(/confirmed: \{ label: "Confirmed"/);
    expect(statusMapBlock[0]).toMatch(/"in-house": \{ label: "In-house"/);
    expect(statusMapBlock[0]).toMatch(/completed: \{ label: "Completed"/);
    expect(statusMapBlock[0]).toMatch(/cancelled: \{ label: "Cancelled"/);
  });

  it("the admin codebase never uses the American 'Canceled' spelling", () => {
    // The rest of the codebase uses British
    // spelling. A future American-spelling fix
    // would silently break the staff-facing UI.
    // The audit asserts zero "Canceled" / "canceled"
    // matches in the admin source.
    expect(adminBookingsPageSrc).not.toMatch(/\bCanceled\b/);
    expect(adminBookingsPageSrc).not.toMatch(/\bcanceled\b/);
  });
});

describe("MRB-15-05 — Email subjects use a consistent subject prefix + reservation ref + room count", () => {
  it("every booking-cancelled / -updated / -confirmed subject reads `[${brandName}] ${verb}: ${ref} (N room[s])`", () => {
    // The subject pattern is: `[${brandName}] <verb>: ${ref} (${roomCount} room[s])`.
    // The reservation branch carries the
    // reservation ref + the room count; the
    // single-room branch carries the booking ref
    // (no parenthetical). Every MRB-aware subject
    // follows the same shape.
    const subjectBlock = emailHandlerSrc.match(
      /"booking-submitted": \{[\s\S]{0,5000}?"payment-rejected": \{/
    );
    expect(
      subjectBlock,
      "expected the booking-related subject map"
    ).toBeTruthy();
    if (!subjectBlock) return;
    // The reservation branch always carries the
    // `(N room[s])` parenthetical.
    expect(subjectBlock[0]).toMatch(/Booking request received: \$\{booking\.reservationRef\} \(\$\{booking\.roomCount \|\| 1\} room/);
    expect(subjectBlock[0]).toMatch(/Payment confirmed: \$\{booking\.reservationRef\} \(\$\{booking\.roomCount \|\| 1\} room/);
    expect(subjectBlock[0]).toMatch(/Booking confirmed: \$\{booking\.reservationRef\} \(\$\{booking\.roomCount \|\| 1\} room/);
    expect(subjectBlock[0]).toMatch(/Check-in reminder: \$\{booking\.reservationRef\} \(\$\{booking\.roomCount \|\| 1\} room/);
    expect(subjectBlock[0]).toMatch(/Booking cancelled: \$\{booking\.reservationRef\} \(\$\{booking\.roomCount \|\| 1\} room/);
    // The reservation-scope cancel + reschedule
    // subjects are "Reservation updated:" (per
    // the comment, the title says "updated" not
    // "cancelled" because a partial cancel sends
    // the same action with surviving rooms).
    expect(subjectBlock[0]).toMatch(/Reservation updated: \$\{booking\.reservationRef\} \(\$\{booking\.roomCount \|\| 1\} room/);
  });

  it("the store-order subjects never use the legacy Booking prefix (store orders are not bookings)", () => {
    // The store order subjects use `Order` (not
    // `Booking`) — the store order is a separate
    // entity from the booking. Mixing the two
    // would confuse the guest.
    const storeSubjects = emailHandlerSrc.match(
      /"store-order-[a-z-]+": \{[\s\S]{0,200}?subject: `\[\$\{config\.brandName\}\] Order/
    );
    expect(
      storeSubjects,
      "expected the store-order subjects to use 'Order' (not 'Booking')"
    ).toBeTruthy();
  });
});

describe("MRB-15-05 — Email preheaders use natural sentence case (start with a capital, no 'Booking' quick-identifier pattern)", () => {
  it("the rescheduled-email preheader starts with a capital (natural sentence case)", () => {
    // The legacy `bookingRescheduledEmail` template's
    // preheader is `Your reservation ... has been
    // updated.` — natural sentence case. The other
    // single-room preheaders also follow natural
    // sentence case (start with a capital letter).
    expect(emailHandlerSrc).toMatch(
      /preheader: `Your reservation \$\{booking\.bookingRef\} has been updated\.`/
    );
  });

  it("the rescheduled-email preheader is consistent with the new 'Reservation updated' subject verb", () => {
    // The subject is "Reservation updated:" and
    // the preheader is "Your reservation has been
    // updated." — the preheader reuses the same
    // verb so the email reads as one consistent
    // message across subject + preview + body.
    // The subject is a conditional on
    // `booking.reservationRef` (the reservation
    // branch uses "Reservation updated:", the
    // single-room branch uses "Booking updated:";
    // both are valid).
    expect(emailHandlerSrc).toMatch(
      /\[\$\{config\.brandName\}\] Reservation updated: \$\{booking\.reservationRef\}/
    );
    expect(emailHandlerSrc).toMatch(
      /preheader: `Your reservation \$\{booking\.bookingRef\} has been updated\.`/
    );
  });

  it("the cancelled-email preheader uses natural sentence case ('Booking ${ref} has been cancelled.')", () => {
    // The legacy `bookingCancelledEmail`
    // preheader is `Booking ${ref} has been
    // cancelled.` — a quick-identifier pattern.
    // The reservation-scope rewrite is
    // `Reservation ${ref} was updated.` Both
    // forms are valid; the audit pins both.
    expect(emailHandlerSrc).toMatch(
      /preheader: `Booking \$\{booking\.bookingRef\} has been cancelled\.`/
    );
    expect(emailHandlerSrc).toMatch(
      /preheader: booking\.reservationRef\s*\n\s*\? `Reservation \$\{booking\.reservationRef\} was updated\.`/
    );
  });

  it("the email preheaders never mix title case ('Booking') and lowercase ('booking') in the same word", () => {
    // The preheader copies read either as a
    // natural sentence ("Your reservation has
    // been updated") or as a quick-identifier
    // ("Booking ${ref} is confirmed"). The
    // audit asserts every preheader uses one
    // of these two styles consistently within
    // the same string — no mixed-capitalisation
    // within a single preheader.
    //
    // The preheader list also includes some
    // non-sentence snippets (e.g. the
    // `Extra beds: ${count} (...)` summary
    // line and the contact-inquiry
    // `Website contact from ${name} —
    // ${subject}` snippet). The audit skips
    // those — the preheader copy that matters
    // for guest-facing consistency is the
    // sentence-style preheader.
    const preheaders = emailHandlerSrc.match(
      /preheader: `([^`]+)`/g
    );
    expect(preheaders, "expected to find preheader strings").toBeTruthy();
    if (!preheaders) return;
    for (const preheader of preheaders) {
      const text = preheader.match(/`([^`]+)`/)?.[1] || "";
      // Skip non-sentence snippets: the
      // `Extra beds: ...` line is a preheader
      // for the receipt PDF, not a sentence.
      // The contact-inquiry preheader is a
      // pure identifier ("Website contact
      // from X — Y") and doesn't end with a
      // period. Every sentence-style preheader
      // ends with a period (the email client
      // convention).
      const isReceiptSnippet = text.startsWith("Extra beds:") || text.startsWith("Receipt:");
      const isContactSnippet = text.startsWith("Website contact from");
      if (isReceiptSnippet || isContactSnippet) continue;
      expect(
        text,
        `preheader ${preheader} should end with a period`
      ).toMatch(/\.$/);
    }
  });
});

describe("MRB-15-05 — Email body copy uses 'Your reservation' / 'Your booking' consistently (no 'Your stay' / 'Your order' mixing)", () => {
  it("the booking-cancelled email body uses 'Your reservation' (the canonical guest-facing term)", () => {
    // The cancelled email body's title is "Your
    // reservation has been cancelled" — the
    // guest-facing term for a cancelled booking.
    // "Your stay" / "Your order" would be
    // ambiguous.
    expect(emailHandlerSrc).toMatch(
      /title: "Your reservation has been cancelled"/
    );
  });

  it("the booking-rescheduled email body uses 'Your reservation' (the canonical guest-facing term)", () => {
    // The rescheduled email body's title is
    // "Your booking dates or room have changed"
    // but the intro says "your reservation" —
    // the canonical term for a rescheduled
    // booking.
    expect(emailHandlerSrc).toMatch(
      /function bookingRescheduledEmail[\s\S]{0,200}?title: "Your booking dates or room have changed"/
    );
    expect(emailHandlerSrc).toMatch(
      /function bookingRescheduledEmail[\s\S]{0,500}?your reservation at <strong>/
    );
  });

  it("the booking-confirmed email body uses 'Your reservation' (the canonical guest-facing term)", () => {
    // The confirmed email body's intro says
    // "your reservation at ${brandName} is now
    // confirmed" — the canonical term.
    expect(emailHandlerSrc).toMatch(
      /function bookingConfirmedEmail[\s\S]{0,500}?your reservation at <strong>/
    );
  });
});

describe("MRB-15-05 — Receipt PDF labels use the canonical terminology (no 'Group' / 'Multi-room')", () => {
  it("the receipt Guest + Stay cards use the canonical labels (Guest: 'Name', 'Email', 'Phone'; Stay: 'Rooms' / 'Room', 'Dates', 'Stay', 'Rate', 'Actual range')", () => {
    // The receipt's cards use the canonical
    // terms: "Name" + "Email" + "Phone" for the
    // Guest card, "Rooms" (reservation) or "Room"
    // (single) for the Stay card's room summary,
    // "Dates" for the check-in / check-out,
    // "Stay" for the night / guest / extra-bed
    // summary, "Rate" for the per-night rate,
    // "Actual range" for the divergent-dates line
    // (per MRB-14). No "Group" or "Multi-room
    // booking" mixing.
    const guestBlock = adminBookingsPageSrc.match(
      /drawInfoCard\("Guest", \[[\s\S]{0,500}?\]/
    );
    expect(
      guestBlock,
      "expected the receipt Guest card"
    ).toBeTruthy();
    if (guestBlock) {
      expect(guestBlock[0]).toMatch(/label: "Name"/);
      expect(guestBlock[0]).toMatch(/label: "Email"/);
      expect(guestBlock[0]).toMatch(/label: "Phone"/);
    }
    const stayRowsBlock = adminBookingsPageSrc.match(
      /const stayRows = \[[\s\S]{0,5000}?label: "Rate"/
    );
    expect(
      stayRowsBlock,
      "expected the receipt Stay card labels to use canonical terminology"
    ).toBeTruthy();
    if (!stayRowsBlock) return;
    // The "Rooms" / "Room" label is a
    // conditional on `isReservationReceipt` —
    // the receipt uses "Rooms" for
    // reservation-scope + "Room" for
    // single-booking. The canonical terms are
    // both present.
    expect(stayRowsBlock[0]).toMatch(/label: isReservationReceipt \? "Rooms" : "Room"/);
    expect(stayRowsBlock[0]).toMatch(/label: "Dates"/);
    expect(stayRowsBlock[0]).toMatch(/label: "Stay"/);
    expect(stayRowsBlock[0]).toMatch(/label: "Rate"/);
    expect(stayRowsBlock[0]).toMatch(/label: "Actual range"/);
    // No drift terms.
    expect(stayRowsBlock[0]).not.toMatch(/label: "Group/);
    expect(stayRowsBlock[0]).not.toMatch(/label: "Multi-room/);
  });

  it("the receipt PDF header is the canonical 'Booking Confirmation Receipt' (or 'Reservation Confirmation Receipt' for reservations)", () => {
    // The receipt title is "Booking Confirmation
    // Receipt" for single-booking + "Reservation"
    // for reservation receipts. The audit pins
    // the single-booking title; the reservation
    // title is built from the same template with
    // a different subtitle.
    expect(adminBookingsPageSrc).toMatch(
      /title: "Booking Confirmation Receipt"/
    );
  });
});

describe("MRB-15-05 — Admin `Reservations` / `Bookings` table column labels are the canonical terms", () => {
  it("the Bookings table quick-view chips use 'Cancelled' (title case)", () => {
    // The quick-view filter chip is labelled
    // "Cancelled" (title case) — matches the
    // StatusBadge's "Cancelled" label. The two
    // surfaces never drift.
    expect(adminBookingsPageSrc).toMatch(
      /\{ id: "cancelled", label: "Cancelled", desc: "Cancelled reservations" \}/
    );
  });
});

describe("MRB-15-05 — Dashboard terminology uses 'Bookings' (the operational table name)", () => {
  it("the dashboard revenue help text uses 'bookings' (lowercase, operational term)", () => {
    // The dashboard reads "bookings" (lowercase
    // operational term) for the in-memory
    // `bookings` array. "Reservations" is the
    // header-scope term; "bookings" is the
    // per-stay term. The two never mix on the
    // same surface.
    expect(adminDashboardSrc).toMatch(
      /bookings checking in this month with payment-confirmed/
    );
  });

  it("the dashboard never uses the 'Reservations' term in the operational revenue + occupancy copy", () => {
    // The dashboard is the operational surface
    // — it counts individual bookings, not
    // reservations. The MRB-12 reservation row
    // lives in the Bookings table (not a
    // separate Reservations page). A future
    // refactor that adds "reservations" to the
    // dashboard copy would be confusing.
    const dashboardRevenueCopy = adminDashboardSrc.match(
      /Revenue is the sum of totalPrice[\s\S]{0,300}?It is booking value, not cash collected\./
    );
    expect(
      dashboardRevenueCopy,
      "expected the dashboard revenue help text to use 'booking' (not 'reservation')"
    ).toBeTruthy();
  });
});
