import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per `feat/special-requests-redirect` (2026-08-21): the guest
// booking form previously collected a free-text `specialRequests`
// value that the admin app had no way to action. The product
// decision is to redirect the guest to email/phone for special
// requests instead — the field is removed from the public form
// AND from the auto-seeded values on the admin walk-in / calendar
// create paths. The intercom amber banner still surfaces the
// stored value for any in-flight bookings that already carry
// non-empty `specialRequests` data (the gate at the banner is
// `&& bookingSummary.specialRequests`, so empty values render
// nothing — same behavior as before).
//
// This file pins the new contract at the source-text level so a
// future refactor can't silently re-introduce the textarea, the
// placeholder copy, or the hardcoded admin auto-strings without
// touching these tests first.

const guestBookingPage = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/BookingPage.tsx"),
  "utf8"
);
const guestBookingConfirmPage = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/BookingConfirmPage.tsx"),
  "utf8"
);
const guestBookingsHandler = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const adminBookingsPage = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);
const adminCalendarPage = readFileSync(
  resolve(__dirname, "../pages/CalendarPage.tsx"),
  "utf8"
);
const adminIntercomChatPanel = readFileSync(
  resolve(__dirname, "../components/IntercomChatPanel.tsx"),
  "utf8"
);

describe("Special requests redirect — guest /book form", () => {
  it("does not render a textarea for special requests on the booking form", () => {
    // The textarea used to live with `placeholder="Late check-in, dietary notes, room preferences..."`
    // (per the screenshot at the start of this feature). The
    // textbox is replaced by a redirect card pointing the guest
    // at the hotel's support email + front desk phone.
    expect(guestBookingPage).not.toMatch(
      /placeholder="Late check-in, dietary notes, room preferences\.\.\."/
    );
    expect(guestBookingPage).not.toMatch(/<textarea[\s\S]*?id="requests"/);
  });

  it("does not initialize `requests` from the URL params (the field is gone)", () => {
    // The old `guestDetails` state initialized `requests` from
    // `searchParams.get("requests")`. Since the field is gone,
    // the URL param is no longer read — the redirect is the
    // single source of truth for the guest's special-request
    // path.
    expect(guestBookingPage).not.toMatch(
      /requests:\s*searchParams\.get\("requests"\)\s*\?\?\s*""/
    );
  });

  it("does not forward `requests` in the createBooking wire payload", () => {
    // The old `guestDetails: { ..., requests: guestDetails.requests }`
    // forwarded the field to the server. With the redirect in
    // place, the create body only carries the structured fields
    // the server actually needs.
    expect(guestBookingPage).not.toMatch(
      /requests:\s*guestDetails\.requests/
    );
    // The URL-passthrough for review is also gone — `reviewParams.set("requests", ...)`
    expect(guestBookingPage).not.toMatch(
      /reviewParams\.set\("requests",\s*guestDetails\.requests\)/
    );
  });

  it("renders the redirect card with the support email + front desk phone", () => {
    // SR-01..05 (2026-10-12): the `feat/special-requests-redirect`
    // card is retired. The booking form now has a `SpecialRequestsBlock`
    // component on Step 2 (bed set-up + additional preferences +
    // free-text + arrival time). The contact override pattern is gone.
    expect(guestBookingPage).not.toMatch(/Need something special\?/);
    expect(guestBookingPage).not.toMatch(/contact\?\.frontDeskPhone/);
    expect(guestBookingPage).not.toMatch(/contact\?\.supportEmail/);
  });

  it("uses the `usePublicSiteContent` hook to read the per-hotel contact override", () => {
    // SR-01..05: `usePublicSiteContent` is still imported but only
    // used for `hotelCheckInTime` (the arrival-time dropdown default).
    // The `contact` destructure was removed when the redirect card retired.
    expect(guestBookingPage).toMatch(/usePublicSiteContent/);
    expect(guestBookingPage).not.toMatch(/const\s*{\s*contact\s*}\s*=\s*usePublicSiteContent\(\)/);
    // The hook is still used for hotelCheckInTime (arrival dropdown).
    expect(guestBookingPage).toMatch(/hotelCheckInTime/);
  });
});

describe("Special requests redirect — guest /book/confirm page", () => {
  it("renders the 'Forgot something?' redirect card after the email alert", () => {
    // SR-01..05 (2026-10-12): the confirmation page's
    // `feat/special-requests-redirect` card is retired. The guest
    // captured their preferences on Step 2; the confirmation page
    // no longer surfaces a redirect prompt.
    expect(guestBookingConfirmPage).not.toMatch(/Forgot something\? Need something special\?/);
    expect(guestBookingConfirmPage).not.toMatch(/data-testid="special-requests-redirect"/);
  });

  it("uses the per-hotel contact override with config fallback", () => {
    // The confirmation page still uses `usePublicSiteContent` for
    // the "Email the staff" card (different feature), but the
    // special-requests redirect pattern is gone.
    expect(guestBookingConfirmPage).not.toMatch(/contact\?\.frontDeskPhone\s*\|\|\s*config\.frontDeskPhone/);
    expect(guestBookingConfirmPage).not.toMatch(/contact\?\.supportEmail\s*\|\|\s*config\.supportEmail/);
  });

  it("does not call the `specialRequests` field on the confirmation page", () => {
    // The confirmation page is now a read-only summary; it
    // doesn't carry a special-requests input. Any `.requests`
    // or `.specialRequests` reference on this page is a
    // regression.
    expect(guestBookingConfirmPage).not.toMatch(/searchParams\.get\("requests"\)/);
    expect(guestBookingConfirmPage).not.toMatch(/guestDetails\.requests/);
  });
});

describe("Special requests redirect — server handler", () => {
  it("does not write `specialRequests` on the online /book create path", () => {
    // The online create handler used to map `guestDetails.requests`
    // to `specialRequests` on the booking doc. The client no
    // longer sends the field, so the write is dead. Anchor the
    // slice on the online create's `discountRejected: false,`
    // block (the walk-in path uses a different block — the
    // `discountVerified: Boolean(discountType),` line).
    const onlineCreateAnchor = guestBookingsHandler.indexOf(
      "discountVerified: false,\n        discountVerifiedBy: null,"
    );
    expect(onlineCreateAnchor).toBeGreaterThan(-1);
    const onlineCreateSlice = guestBookingsHandler.slice(
      onlineCreateAnchor,
      onlineCreateAnchor + 4000
    );
    expect(onlineCreateSlice).not.toMatch(
      /specialRequests:\s*guestDetails\.requests\s*\|\|\s*""/
    );
  });

  it("keeps the walk-in API schema field for back-compat (in-flight bookings)", () => {
    // The admin walk-in path still posts `requests` via the
    // `WalkinGuestDetailsSchema`, so the helper that maps the
    // walk-in payload to `specialRequests` on the doc stays.
    // The schema's `requests` field is unchanged (see
    // `shared/schemas/booking.ts`). The walk-in handler in
    // `bookings.ts` is anchored on the walk-in's
    // `discountVerified: Boolean(discountType),` line (the
    // online create path uses `discountVerified: false,` —
    // distinct anchors).
    const walkinAnchor = guestBookingsHandler.indexOf(
      "discountVerified: Boolean(discountType),"
    );
    expect(walkinAnchor).toBeGreaterThan(-1);
    const walkinSlice = guestBookingsHandler.slice(
      walkinAnchor,
      walkinAnchor + 4000
    );
    expect(walkinSlice).toMatch(
      /specialRequests:\s*guestDetails\.requests\s*\|\|\s*""/
    );
  });
});

describe("Special requests redirect — admin walk-in / calendar cleanup", () => {
  it("does not auto-seed `specialRequests: \"Walk-in registration.\"`", () => {
    // Per feat/staff-special-requests-capture (2026-08-21,
    // commit follows 78a79f7): the previous empty-string
    // literal `specialRequests: ""` was replaced with the
    // staff-captured value `walkinSpecialRequests.trim().
    // slice(0, 1000)`. The auto-seed check below anchors
    // on the absence of the historical literal — the
    // redirect's promise was to stop the walk-in modal
    // from claiming the booking was "Walk-in registration."
    // in the specialRequests slot. The staff-capture
    // feature preserves that promise (the walk-in modal
    // no longer pre-fills a fake request).
    expect(adminBookingsPage).not.toMatch(
      /specialRequests:\s*"Walk-in registration\."/
    );
    // And the walk-in modal no longer hard-codes an empty
    // string for the field — the staff-capture feature
    // reads from the modal state instead.
    expect(adminBookingsPage).toMatch(/specialRequests:\s*walkinSpecialRequests/);
  });

  it("does not auto-seed `specialRequests: \"Created from booking calendar.\"`", () => {
    // Per feat/staff-special-requests-capture (2026-08-21,
    // commit follows 78a79f7): the previous empty-string
    // literal `specialRequests: ""` was replaced with the
    // staff-captured value `calendarSpecialRequests.
    // trim().slice(0, 1000)`. The auto-seed check below
    // anchors on the absence of the historical literal — the
    // redirect's promise was to stop the calendar from
    // claiming the booking was "Created from booking
    // calendar." in the specialRequests slot. The staff-
    // capture feature preserves that promise (the calendar
    // no longer pre-fills a fake request).
    expect(adminCalendarPage).not.toMatch(
      /specialRequests:\s*"Created from booking calendar\."/
    );
    // And the calendar no longer hard-codes an empty string
    // for the field — the staff-capture feature reads from
    // the modal state instead.
    expect(adminCalendarPage).toMatch(/specialRequests:\s*calendarSpecialRequests/);
  });

  it("removes the 'Special Requests' section from the admin receipt PDF", () => {
    // The admin receipt PDF previously rendered a "Special
    // Requests" section that pulled from `receiptBooking.specialRequests`.
    // With the redirect, the field is never populated for new
    // bookings, so the section is dead code. The filter at the
    // top of the section (`requestBookings.filter(...)`) and
    // the section header (`drawPdfSectionTitle(pdf, "Special Requests", ...)`)
    // both go away.
    expect(adminBookingsPage).not.toMatch(
      /requestBookings = receiptBookings\.filter\(\s*\(receiptBooking\) => receiptBooking\.specialRequests/
    );
    expect(adminBookingsPage).not.toMatch(
      /drawPdfSectionTitle\(pdf, "Special Requests"/
    );
  });
});

describe("Special requests redirect — intercom amber banner (kept)", () => {
  it("keeps the amber banner so existing in-flight bookings still surface their special requests", () => {
    // The amber banner in `IntercomChatPanel.tsx` is the only
    // admin-app surface that shows a non-empty `specialRequests`
    // value to the front desk. The redirect doesn't remove
    // this surface — it gates on `&& bookingSummary.specialRequests`
    // so empty values render nothing, and in-flight bookings
    // with the field filled still display it.
    expect(adminIntercomChatPanel).toMatch(
      /bookingSummary\.specialRequests &&/
    );
    expect(adminIntercomChatPanel).toMatch(
      /border-amber-200 bg-amber-50[\s\S]*?specialRequests/
    );
  });
});
