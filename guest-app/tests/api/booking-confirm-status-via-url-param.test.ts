import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per `fix/booking-confirm-status-via-url-param` (2026-08-22):
// the BookingConfirmPage's client-side gate for the "Request
// early check-in" widget used `getDoc(doc(db, "bookings",
// bookingRef))` to fetch the booking status. The Firestore
// rules (`firebase/firestore.rules:43`) gate `bookings` reads
// behind `isStaff()` — guests don't have direct read access.
// The `getDoc` call fails with "Missing or insufficient
// permissions", `bookingStatus` stays at the default `""`,
// `bookingStatusAllowsEarlyCheckIn` evaluates to `false`, and
// the widget never renders for any signed-in member.
//
// The fix passes the booking status through the URL redirect
// chain (Option 2a from the design): the booking-creation
// response already carries the status (set at line 2833 of
// `guest-app/server/handlers/bookings.ts`), the BookingPage
// redirect puts it in the `confirmParams` URLSearchParams,
// and BookingConfirmPage reads it from `searchParams.get("status")`
// on first render. No async fetch. No race condition. No
// permission error. The `getDoc` useEffect is removed.
//
// Trade-off accepted: a deep-linked `/book/confirm` URL with
// a stale `status` param might show or hide the widget
// incorrectly. The server-side gate in
// `guest-app/server/handlers/email.ts` (3-status allowlist) still
// protects the actual click, so the worst case is a UX hiccup
// not a security hole.
//
// This file pins the new contract at the source-text level:
//
//   1. BookingPage puts `status` in the /book/confirm URL params.
//   2. BookingConfirmPage reads `status` from the URL (not getDoc).
//   3. BookingConfirmPage no longer calls getDoc on bookings/{ref}.
//   4. The server's create response carries the status (so the
//      BookingPage redirect has something to put in the URL).
//   5. Regression nets pin the unchanged parts of the gate.

const bookingPage = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

const bookingConfirmPage = readFileSync(
  resolve(__dirname, "../../src/pages/BookingConfirmPage.tsx"),
  "utf8"
);

const createBookingHandler = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

describe("BookingPage.tsx — passes booking status to /book/confirm via URL", () => {
  // The redirect URLSearchParams must carry the booking
  // status so the confirmation page can read it on first
  // render. The status comes from the create-booking
  // server response (`result.data.status`) — see test below.

  it("includes status in the confirmParams URLSearchParams", () => {
    // Anchor on the redirect block: confirmParams.set("status", ...)
    // must appear between the existing room/rateBreakdown sets and
    // the navigate() call.
    expect(bookingPage).toMatch(
      /confirmParams\.set\(\s*["']status["']\s*,\s*(?:String\()?\s*result\.data\?\.status\s*(?:\)|)/
    );
  });
});

describe("BookingConfirmPage.tsx — reads booking status from URL (not Firestore)", () => {
  // The pre-fix code had a useEffect that did
  // `getDoc(doc(db, "bookings", bookingRef))`. That call fails
  // for guests. The fix replaces it with a synchronous read
  // from the URL.

  it("seeds bookingStatus from searchParams.get('status') at mount", () => {
    // Match the useState initializer that reads `status` from
    // searchParams. The default state on pre-fix was an empty
    // string. Post-fix it's `searchParams.get("status") ?? ""`
    // — synchronous on first render.
    expect(bookingConfirmPage).toMatch(
      /useState<string>\(\(\)\s*=>\s*searchParams\.get\(\s*["']status["']\s*\)\s*\?\?/
    );
  });

  it("does NOT call getDoc on the bookings collection", () => {
    // The pre-fix code had `getDoc(doc(db, "bookings", bookingRef))`
    // which fails with "Missing or insufficient permissions"
    // because the Firestore rules gate booking reads behind
    // isStaff(). The fix removes this call.
    expect(bookingConfirmPage).not.toMatch(
      /getDoc\(\s*doc\(\s*db\s*,\s*["']bookings["']\s*,\s*bookingRef/
    );
  });

  it("keeps the bookingStatus-based client gate", () => {
    // The fix preserves the existing 3-status allowlist gate
    // (added in fix/early-checkin-payment-uploaded-allowlist).
    // Only the source of `bookingStatus` changes (URL param
    // instead of getDoc).
    expect(bookingConfirmPage).toMatch(/bookingStatusAllowsEarlyCheckIn/);
    expect(bookingConfirmPage).toMatch(/"payment-uploaded"/);
    expect(bookingConfirmPage).toMatch(/"payment-confirmed"/);
    expect(bookingConfirmPage).toMatch(/"confirmed"/);
    expect(bookingConfirmPage).toMatch(/\.includes\(bookingStatus\)/);
  });
});

describe("BookingConfirmPage.tsx — regression nets", () => {
  // The pre-fix code also did getDoc on settings/hotelConfig +
  // settings/rewardsConfig. Those reads use the public `settings/*`
  // collection (Firestore rules allow guest reads on settings).
  // The fix keeps those reads. The two must remain.

  it("keeps the hotelConfig fetch via settings/hotelConfig", () => {
    expect(bookingConfirmPage).toMatch(
      /getDoc\(\s*doc\(\s*db\s*,\s*["']settings["']\s*,\s*["']hotelConfig["']/
    );
  });

  it("keeps the rewardsConfig fetch via settings/rewardsConfig", () => {
    expect(bookingConfirmPage).toMatch(
      /getDoc\(\s*doc\(\s*db\s*,\s*["']settings["']\s*,\s*["']rewardsConfig["']/
    );
  });

  it("keeps the existing isRewardsMember + earlyCheckInEnabled conjunction", () => {
    // The pre-fix gate was
    //   isRewardsMember && earlyCheckInEnabled && bookingStatusAllowsEarlyCheckIn
    // The fix preserves the first two conjuncts; only
    // `bookingStatus` sources change.
    expect(bookingConfirmPage).toMatch(
      /isRewardsMember\s*&&\s*earlyCheckInEnabled\s*&&/
    );
  });
});

describe("Server handler — booking create response carries status", () => {
  // The fix depends on the server's `/api/bookings/create`
  // response including `status`. The pre-fix response shape
  // (lines 3477-3515 of `guest-app/server/handlers/bookings.ts`)
  // includes bookingId, bookingRef, reservationId, totalPrice,
  // roomId, roomNumber, roomType, rooms, holdExpiresAt — but
  // not status. The fix adds it.

  it("includes status in the success response data of handleCreateBooking", () => {
    // The success return at line 3477+ is followed by an
    // object with the booking fields. The fix adds
    // `status: initialBookingStatus` inside that object so the
    // BookingPage redirect has something to put in the URL. The same
    // function-scoped value is written to the booking document.
    expect(createBookingHandler).toMatch(
      /return res\.status\(200\)\.json\(\{\s*\n?\s*success:\s*true,[\s\S]{0,4000}?status:\s*initialBookingStatus/
    );
  });

  it("uses the same initialBookingStatus for persistence and response", () => {
    expect(createBookingHandler).toMatch(/status:\s*initialBookingStatus/);
    expect(createBookingHandler.match(/status:\s*initialBookingStatus/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
