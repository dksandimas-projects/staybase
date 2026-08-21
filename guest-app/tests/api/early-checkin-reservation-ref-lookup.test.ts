// Per EC-02 follow-up (operator-reported 2026-08-21): the
// BookingConfirmPage's "Request early check-in" wire sends
// the URL's `bookingRef` param to the server. Post-MRB-01
// bookings return `reservationRef` (the human `R-…` ref) in
// the booking-create response, so the URL carries the
// reservation ref — but `findBooking` (in
// `guest-app/server/handlers/email.ts`) only knew how to
// lookup by `bookingRef` (the legacy `SI-…` ref). Booking
// not found.
//
// Same bug class as FOL-02 / MRB-10 (post-MRB-01 wire
// breakage) the MED-3 G1 fix addressed for `link-booking`.
// Fix: extend `findBooking` to also resolve `R-YYYYMMDD-NNNNN`
// via `reservations.where("reservationRef", "==", input)` and
// pick the lead child (reservationPosition === 1).
//
// Source-text pin (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. Runtime behavior is exercised
// by the existing `early-checkin-resolve-confirmed-time.test.ts`
// + the `early-checkin-member-auth.test.ts` suite + the
// BookingConfirmPage wire.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/email.ts"),
  "utf8"
);

// Slice the `findBooking` helper so the assertions target just
// the resolver (the rest of the file is 2700+ lines and
// unrelated references would bleed in).
const findBookingStart = emailHandlerSrc.indexOf(
  "async function findBooking("
);
// End anchor: the closing `}` of the `if (options.requireGuestMatch
// && user.uid) { ... }` block is hard to anchor reliably (it
// shares its shape with other functions). Anchor on the
// `return booking;` line just before the function's closing
// `}` instead — that's a stable marker for this function
// (the helper has exactly one return statement).
const findBookingEnd = emailHandlerSrc.indexOf(
  "return booking;\n}",
  findBookingStart
);
const findBookingSlice =
  findBookingStart >= 0 && findBookingEnd > findBookingStart
    ? emailHandlerSrc.slice(findBookingStart, findBookingEnd + "return booking;\n}".length)
    : "";

describe("EC-02b — findBooking resolves reservationRef (R-YYYYMMDD-NNNNN) for post-MRB-01 bookings", () => {
  it("findBooking is locatable in email.ts", () => {
    // Sanity: the function exists and we sliced a non-empty
    // region. If a future refactor moves findBooking to a
    // shared lib (e.g. `server/lib/findBooking.ts`), this test
    // will need its `resolve(...)` updated.
    expect(findBookingSlice.length).toBeGreaterThan(0);
  });

  it("imports RESERVATION_REF_REGEX from the shared package", () => {
    // The regex is the canonical way to distinguish a legacy
    // `SI-…` booking ref from a post-MRB-01 `R-…` reservation
    // ref. Without the import the resolver can't tell them
    // apart on a bare string match. Either
    // `@spark-inn/shared` (the root re-export) or
    // `@spark-inn/shared/references` is acceptable — both
    // land on the same export per `shared/index.ts`.
    expect(emailHandlerSrc).toMatch(
      /import\s*\{[^}]*RESERVATION_REF_REGEX[^}]*\}\s*from\s*["']@spark-inn\/shared(?:\/references)?["']/
    );
  });

  it("findBooking matches RESERVATION_REF_REGEX and queries the reservations collection", () => {
    // The fix: an `if (RESERVATION_REF_REGEX.test(trimmed))`
    // branch that queries `reservations.where("reservationRef",
    // "==", input)` and reads the lead booking via the
    // reservation header. Mirrors the `resolveBookingForLink`
    // shape at `members.ts:816` (the MED-3 G1 fix). The
    // regex tolerates the multiline `adminDb\n        .collection(
    // "reservations")` split that esbuild leaves in the
    // pre-formatted source.
    expect(findBookingSlice).toMatch(/RESERVATION_REF_REGEX\.test/);
    expect(findBookingSlice).toMatch(
      /adminDb[\s\S]{0,40}?\.collection\(\s*["']reservations["']\s*\)/
    );
    expect(findBookingSlice).toMatch(
      /where\(\s*["']reservationRef["']\s*,\s*["']==["']\s*,\s*trimmed\s*\)/
    );
  });

  it("findBooking picks the lead child booking (reservationPosition === 1) from the reservation", () => {
    // The reservation header has multiple children; the
    // resolve needs to pick ONE booking to attach the
    // `earlyCheckIn` map to. The canonical pick is the lead
    // (reservationPosition === 1) so the request lands on the
    // same child the rest of the system treats as the
    // "primary" record. Mirror the per-reservation "anchor"
    // pattern at `email.ts:2200+` (the checkin-reminder
    // cron) — anchor = first child of reservationPosition
    // === 1.
    expect(findBookingSlice).toMatch(
      /reservationPosition\s*[!=]==\s*1|orderBy\(\s*["']reservationPosition["']/
    );
  });

  it("findBooking still supports the legacy bookingRef path (no regression for pre-MRB-01 bookings)", () => {
    // Sanity that the new branch is ADDITIVE — the existing
    // bookingRef path stays intact for any pre-MRB-01 single
    // bookings still in the system (the early Spark Inn seed
    // data + manual test bookings). Note: the
    // `String(bookingRef).trim()` expression in the pre-fix
    // code is hoisted to a `trimmed` local at the top of the
    // branch — the regex allows either form.
    expect(findBookingSlice).toMatch(
      /where\(\s*["']bookingRef["']\s*,\s*["']==["']\s*,\s*(?:String\(bookingRef\)\.trim\(\)|trimmed)\s*\)/
    );
  });

  it("findBooking still supports the bookingId (raw doc id) path", () => {
    // The RewardsPage flow uses `booking.id` (the raw Firestore
    // doc id), not the bookingRef. The fix must not break
    // that wire.
    expect(findBookingSlice).toMatch(
      /adminDb\.collection\(\s*["']bookings["']\s*\)\.doc\(\s*String\(bookingId\)\s*\)/
    );
  });
});

describe("EC-02b — wire-path regression sanity", () => {
  it("BookingConfirmPage sends the reservationRef when the URL has one (not just bookingRef)", () => {
    // Per the bug: BookingPage.tsx:1587 sends
    // `result.data.reservationRef || result.data.bookingRef`,
    // so post-MRB-01 bookings carry the `R-…` ref. The
    // confirm page POSTs that same string to the API. The
    // server-side fix above makes the lookup succeed.
    const bookingConfirmSrc = readFileSync(
      resolve(__dirname, "../../src/pages/BookingConfirmPage.tsx"),
      "utf8"
    );
    expect(bookingConfirmSrc).toMatch(/bookingRef,/);
    // The wire payload (the `body: JSON.stringify(...)` shape)
    // should include `bookingRef` as the top-level field.
    expect(bookingConfirmSrc).toMatch(
      /body:\s*JSON\.stringify\(\s*\{[^}]*bookingRef/
    );
  });
});