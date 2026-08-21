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
    // The redirect follows the same `contact?.X || config.X`
    // pattern as ContactPage.tsx and Footer.tsx so the per-hotel
    // override (Settings → Hotel Info) wins when set, and the
    // deploy-time `hotel.config.ts` is the safe fallback.
    expect(guestBookingPage).toMatch(
      /contact\?\.frontDeskPhone\s*\|\|\s*config\.frontDeskPhone/
    );
    expect(guestBookingPage).toMatch(
      /contact\?\.supportEmail\s*\|\|\s*config\.supportEmail/
    );
    // The redirect's user-facing heading (Draft B, no SLA).
    expect(guestBookingPage).toMatch(/Need something special\?/);
  });

  it("uses the `usePublicSiteContent` hook to read the per-hotel contact override", () => {
    // ContactPage + Footer both use this hook; the redirect
    // card on the booking form must use the same hook so the
    // source of truth is consistent across the guest app.
    expect(guestBookingPage).toMatch(/usePublicSiteContent/);
    expect(guestBookingPage).toMatch(/const\s*{\s*contact\s*}\s*=\s*usePublicSiteContent\(\)/);
  });
});

describe("Special requests redirect — guest /book/confirm page", () => {
  it("renders the 'Forgot something?' redirect card after the email alert", () => {
    // The confirmation page now surfaces a "did you forget?"
    // prompt (the confirmation moment is when guests most often
    // remember a special need). The card lives between the email
    // alert banner and the early check-in section.
    expect(guestBookingConfirmPage).toMatch(/Forgot something\? Need something special\?/);
    // The redirect card is rendered as a `motion.div` (Framer
    // Motion) — match the `data-testid` attribute on its own so
    // the assertion is robust to the wrapper element name.
    expect(guestBookingConfirmPage).toMatch(/data-testid="special-requests-redirect"/);
  });

  it("uses the per-hotel contact override with config fallback", () => {
    // Same pattern as the booking form redirect.
    expect(guestBookingConfirmPage).toMatch(
      /contact\?\.frontDeskPhone\s*\|\|\s*config\.frontDeskPhone/
    );
    expect(guestBookingConfirmPage).toMatch(
      /contact\?\.supportEmail\s*\|\|\s*config\.supportEmail/
    );
    expect(guestBookingConfirmPage).toMatch(/usePublicSiteContent/);
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
    // The admin walk-in modal previously hardcoded a
    // placeholder string into the booking doc. The redirect
    // replaces it with an empty string (the field lives on the
    // schema for back-compat but is no longer user-input nor
    // auto-seeded).
    expect(adminBookingsPage).not.toMatch(
      /specialRequests:\s*"Walk-in registration\."/
    );
    // The admin walk-in now writes an empty string for the
    // field so the intercom banner auto-hides and the receipt
    // PDF section (which filters on `?.trim().length > 0`)
    // skips rendering.
    expect(adminBookingsPage).toMatch(/specialRequests:\s*""/);
  });

  it("does not auto-seed `specialRequests: \"Created from booking calendar.\"`", () => {
    // Same reasoning as the walk-in auto-string above.
    expect(adminCalendarPage).not.toMatch(
      /specialRequests:\s*"Created from booking calendar\."/
    );
    expect(adminCalendarPage).toMatch(/specialRequests:\s*""/);
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
