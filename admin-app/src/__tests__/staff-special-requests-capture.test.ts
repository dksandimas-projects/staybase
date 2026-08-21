import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per `feat/staff-special-requests-capture` (2026-08-21): the
// previous redirect-only PR (feat/special-requests-redirect,
// commit 78a79f7) removed the public-facing textarea on the
// guest /book form on the rationale that special requests
// should arrive via email or phone where the hotel can respond
// reliably. This follow-up PR closes the operational loop on
// the admin side: the front desk / admin now captures those
// inbound requests into the booking doc, and the booking
// drawer + calendar surface them so the staff can honor them
// at check-in.
//
// The feature is a **closed-loop, staff-only** flow:
//   - Guest contacts the hotel by email or phone
//   - Front desk reads the message and types the request
//     into the booking (drawer editor OR walk-in / calendar
//     create modal at the moment of booking)
//   - Calendar cell shows a small "has special request" icon
//     with hover-tooltip so the next shift sees it
//   - Guest never sees the field (no public input on the form
//     or confirmation page; redirect copy stays intact)
//
// This file pins the new contract at the source-text level.
// Tests live in the admin-app test tree because every change
// is admin-side; the redirect-preservation guards at the
// bottom are the regression net that ensures the guest-facing
// surfaces we shipped in the previous PR are untouched.

const bookingDrawerWorkspace = readFileSync(
  resolve(__dirname, "../components/BookingDrawerWorkspace.tsx"),
  "utf8"
);
const adminContext = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
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
const firestoreRules = readFileSync(
  resolve(__dirname, "../../../firebase/firestore.rules"),
  "utf8"
);
const sharedTypes = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);
const sharedSchemas = readFileSync(
  resolve(__dirname, "../../../shared/schemas/booking.ts"),
  "utf8"
);
const guestBookingPage = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/BookingPage.tsx"),
  "utf8"
);
const guestBookingConfirmPage = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/BookingConfirmPage.tsx"),
  "utf8"
);

describe("Staff special-requests capture — booking drawer", () => {
  // Per the design: the drawer is the primary edit surface
  // for existing bookings. The editor lives in the Overview
  // section (where guest details already live) so the front
  // desk sees the request alongside guest identity. No new
  // tab — the request is a guest-context field, not a
  // workflow action.

  it("renders a Special Requests section in the drawer workspace", () => {
    // The drawer workspace is the tabbed component; the
    // Overview panel lives inside BookingsPage. The Special
    // Requests editor anchor is a stable data-testid so the
    // e2e + integration tests can locate it without DOM
    // scraping. The editor is mounted inside the Overview
    // section's panel (not a 5th tab) so the staff doesn't
    // have to drill in to find it.
    expect(bookingDrawerWorkspace).toMatch(/data-testid="special-requests-editor"/);
  });

  it("uses the textarea with a 1000-char cap matching the historical WalkinGuestDetailsSchema limit", () => {
    // The cap matches the historical `requests` field on the
    // walk-in schema (`z.string().trim().max(1000)`) so a
    // request captured at walk-in time and one captured in
    // the drawer after the fact share the same envelope. The
    // editor uses a `SPECIAL_REQUESTS_MAX_LENGTH = 1000`
    // constant so a future cap change touches one place.
    expect(bookingDrawerWorkspace).toMatch(
      /maxLength=\{(?:1000|SPECIAL_REQUESTS_MAX_LENGTH)\}/,
    );
    expect(bookingDrawerWorkspace).toMatch(/SPECIAL_REQUESTS_MAX_LENGTH\s*=\s*1000/);
  });

  it("shows the last-edited metadata (who / when) when the field has been touched", () => {
    // The previous feature shipped without metadata; this
    // PR adds the timestamp + staff-uid pair
    // (`specialRequestsUpdatedAt` + `specialRequestsUpdatedBy`).
    // The drawer surfaces them inline so the next shift
    // knows when the request was captured and by whom.
    expect(bookingDrawerWorkspace).toMatch(/specialRequestsUpdatedAt/);
    expect(bookingDrawerWorkspace).toMatch(/specialRequestsUpdatedBy/);
  });
});

describe("Staff special-requests capture — AdminContext handler", () => {
  // The drawer editor's Save button calls an AdminContext
  // handler that posts to a server endpoint. The endpoint
  // validates the staff role + applies the char cap server-
  // side (defense in depth; the client already caps at 1000).
  // This matches the existing pattern (LOU flag, verify
  // payment, reject payment) and keeps Firestore writes off
  // the client.

  it("declares an updateBookingSpecialRequests handler on the context", () => {
    // Mirror the existing pattern: every staff mutation on
    // the booking doc is a function on the AdminContext
    // that posts to `/api/bookings/<verb>`. The ShareBooking
    // endpoint shape is identical to setLouReceived: a
    // { bookingId, value } body, returns { success, error? }.
    expect(adminContext).toMatch(
      /updateBookingSpecialRequests:\s*\(bookingId: string, value: string\) => Promise<\{ success: boolean; error\?: string \}>/,
    );
  });

  it("posts to /api/bookings/set-special-requests with bearer auth", () => {
    // Matches the setLouReceived implementation:
    // `Bearer ${token}` header + JSON body with
    // { bookingId, value } + server returns { success }.
    // The endpoint is server-authoritative for the staff
    // role + the char limit + the last-edited metadata
    // write. Anchor on the unique URL substring + the
    // bearer header + the JSON body shape.
    expect(adminContext).toMatch(/\/api\/bookings\/set-special-requests/);
    expect(adminContext).toMatch(/Bearer \$\{token\}/);
    expect(adminContext).toMatch(
      /body:\s*JSON\.stringify\(\{\s*bookingId:\s*bookingId\.trim\(\),\s*value\s*\}\)/,
    );
  });

  it("returns the handler on the AdminContextType interface and the context value", () => {
    // The same shape used by every other handler (see
    // setLouReceived, verifyAndRecordPayment, etc.).
    // Without these two pins, the consumer would type-
    // erase on the context and the drawer's `useAdmin()`
    // call would not type-check. We assert the handler
    // appears in the interface block (preceded by
    // `setLouReceived` to confirm placement) AND in the
    // context-value block (followed by
    // `confirmBookingWithBalance` to confirm placement).
    // The interface declaration of `setLouReceived` and
    // `updateBookingSpecialRequests` are separated by ~700
    // chars of JSDoc-style comments — the regex needs a
    // generous bound to traverse them.
    expect(adminContext).toMatch(
      /setLouReceived:[\s\S]{0,1200}?updateBookingSpecialRequests:/,
    );
    expect(adminContext).toMatch(
      /setLouReceived,\s*\n\s*updateBookingSpecialRequests,/,
    );
  });
});

describe("Staff special-requests capture — walk-in modal", () => {
  // The admin walk-in modal (BookingsPage.tsx) is the
  // capture-at-source surface. When the desk creates a
  // walk-in booking AND the guest has flagged a request at
  // the counter (common for repeat guests + the late-
  // check-in / extra-pillow / dietary cases), the desk types
  // it directly into the modal. The walk-in payload already
  // routes through addWalkinBooking, which posts to the
  // walk-in API endpoint. The request rides along with the
  // existing payload — no separate write.

  it("captures the request via a textarea on the walk-in modal with the 1000-char cap", () => {
    // The walk-in modal captures requests at booking time
    // when the desk is taking the call in person. The state
    // carries the value, the textarea renders with the cap.
    expect(adminBookingsPage).toMatch(/walkinSpecialRequests/);
    expect(adminBookingsPage).toMatch(
      /maxLength=\{(?:1000|SPECIAL_REQUESTS_MAX_LENGTH)\}/,
    );
  });

  it("forwards the request through addWalkinBooking as a sibling field", () => {
    // The walk-in API endpoint (`/api/bookings/create-walkin`)
    // accepts `requests` inside `guestDetails` (per the
    // existing WalkinGuestDetailsSchema). The field
    // `walkinSpecialRequests` flows into the wire payload
    // so the server writes it to `Booking.specialRequests`
    // — same shape as the historical path that the redirect
    // PR removed on the public form.
    expect(adminBookingsPage).toMatch(
      /specialRequests:\s*walkinSpecialRequests/,
    );
  });
});

describe("Staff special-requests capture — calendar create modal", () => {
  // The calendar-create modal (CalendarPage.tsx) mirrors
  // the walk-in modal pattern. Same textarea + same cap +
  // same forwarded field. The state hook matches the
  // existing modal state variables (firstName, lastName,
  // guestEmail, etc.).

  it("captures the request via a textarea on the calendar-create modal with the 1000-char cap", () => {
    expect(adminCalendarPage).toMatch(/calendarSpecialRequests/);
    expect(adminCalendarPage).toMatch(
      /maxLength=\{(?:1000|SPECIAL_REQUESTS_MAX_LENGTH)\}/,
    );
  });

  it("forwards the request through addWalkinBooking as a sibling field", () => {
    // Same forwarding as the walk-in modal: the calendar-
    // created booking posts through addWalkinBooking with
    // `specialRequests` on the payload. Source is set to
    // "walk-in" (the calendar doesn't expose a source
    // selector for create — it inherits the booking-source
    // default).
    expect(adminCalendarPage).toMatch(
      /specialRequests:\s*calendarSpecialRequests/,
    );
  });
});

describe("Staff special-requests capture — calendar cell indicator", () => {
  // The calendar grid renders one cell per (room, day) pair.
  // When the cell maps to a booking with non-empty
  // `specialRequests`, a small icon surfaces the request.
  // Hover tooltip shows the text. No click handler — the
  // cell already opens the booking drawer on click.

  it("renders a special-requests icon on the cell when the booking has non-empty requests", () => {
    // The icon is rendered conditionally on
    // booking.specialRequests?.trim().length > 0 and
    // carries a stable data-testid so the e2e harness can
    // assert presence without DOM scraping. The icon is
    // a MessageSquareText glyph (lucide) — same family as
    // the redirect card on the guest side.
    // The conditional may use `booking.specialRequests?.trim().length > 0`
    // OR `(booking.specialRequests ?? "").trim().length > 0` — both
    // gate the icon to non-empty trimmed values.
    expect(adminCalendarPage).toMatch(
      /(?:booking\.specialRequests\?\.trim\(\)|\(booking\.specialRequests \?\? ""\)\.trim\(\))\.length\s*>\s*0/,
    );
    expect(adminCalendarPage).toMatch(/data-testid="calendar-special-request-icon"/);
  });

  it("shows the request text via title= hover (no popup needed)", () => {
    // `title=` is the simplest cross-device tooltip — works
    // on touch (long-press) and on hover without any custom
    // tooltip component. Truncated at 80 chars to keep the
    // cell tidy; the drawer has the full text.
    // Title may be `title={booking.specialRequests}` (direct)
    // OR `title={(booking.specialRequests ?? ...)` (defensive
    // coercion) — both formats pass the tooltip through.
    expect(adminCalendarPage).toMatch(
      /title=\{[\s(]*booking\.specialRequests/,
    );
  });
});

describe("Staff special-requests capture — schema + firestore rules", () => {
  // Schema + rules are the source of truth for what the
  // staff can write. The field has been in the staff-allowed
  // update list since before this PR (per SECURITY.md), so
  // no rule change is required for the new write. The
  // schema gains two new optional fields for the last-edited
  // metadata.

  it("adds specialRequestsUpdatedAt + specialRequestsUpdatedBy to the Booking type", () => {
    // Optional fields. The staff-captured value is stored
    // alongside `specialRequests` so the drawer's "Last
    // edited by" line can render without a separate
    // subcollection read. Timestamp is a Firestore
    // Timestamp on the server (or a number-ms for client-
    // preallocated write; the handler normalizes).
    expect(sharedTypes).toMatch(/specialRequestsUpdatedAt:\s*string\s*\|\s*null/);
    expect(sharedTypes).toMatch(/specialRequestsUpdatedBy:\s*string\s*\|\s*null/);
  });

  it("keeps specialRequests in the firestore.rules staff-allowed update list", () => {
    // The previous redirect PR confirmed this list already
    // includes specialRequests; this PR adds the two new
    // metadata fields to the same list so the staff writer
    // can stamp them in the same update.
    expect(firestoreRules).toMatch(
      /"specialRequestsUpdatedAt"[\s\S]{0,200}?"specialRequestsUpdatedBy"[\s\S]{0,200}?\]/
    );
  });

  it("keeps the WalkinGuestDetailsSchema.requests field for back-compat", () => {
    // The walk-in API endpoint still accepts `requests`
    // inside `guestDetails`; the walk-in modal flow passes
    // the staff-typed request through this surface.
    expect(sharedSchemas).toMatch(
      /requests:\s*z\.string\(\)\.trim\(\)\.max\(1000\)\.optional\(\)\.default\(""\)/,
    );
  });
});

describe("Staff special-requests capture — intercom banner preserved", () => {
  // The intercom amber banner in IntercomChatPanel.tsx is
  // the secondary surface for special requests — used
  // when a guest mentions a request mid-chat. The staff
  // capture flow is the primary surface; the banner remains
  // as a discovery aid. This test guards against an
  // accidental regression during the implementation.

  it("still renders the amber banner for in-flight bookings with a non-empty value", () => {
    expect(adminIntercomChatPanel).toMatch(
      /bookingSummary\.specialRequests\s*&&/,
    );
    expect(adminIntercomChatPanel).toMatch(/border-amber-200 bg-amber-50/);
  });
});

describe("Staff special-requests capture — redirect preservation", () => {
  // The previous PR (feat/special-requests-redirect,
  // commit 78a79f7) shipped the redirect copy on the guest
  // booking form + confirmation page. This PR does NOT
  // remove the redirect — the redirect is for guest-initiated
  // contact; the staff capture is the inbound record. These
  // tests pin the redirect so a future refactor can't
  // silently undo it.

  it("keeps the 'Need something special?' card on the /book form", () => {
    expect(guestBookingPage).toMatch(/Need something special\?/);
    expect(guestBookingPage).toMatch(/data-testid="special-requests-redirect"/);
  });

  it("keeps the 'Forgot something?' card on the /book/confirm page", () => {
    expect(guestBookingConfirmPage).toMatch(
      /Forgot something\? Need something special\?/,
    );
    expect(guestBookingConfirmPage).toMatch(/data-testid="special-requests-redirect"/);
  });
});
