// Per CRL-08 (2026-08-11, per decision #213):
// source-text guards for the reschedule's
// `cancellationPolicySnapshot` refresh + the
// "Booked on" / "Originally for" surface across
// the admin drawer, guest /my-booking, cancellation
// preview, confirmation emails, and the receipt
// PDF. The fix + the surface ships together because
// the field exists only to make the underlying
// bug (stale snapshot) visible to the staff. See
// `shared/utils/bookingHistory.ts` for the helpers,
// `guest-app/server/handlers/bookings.ts` for the
// server writes, and the per-surface render sites
// for the client.
//
// These are source-text guards — the test reads
// the source files + greps for the expected
// patterns. End-to-end coverage (the round-trip
// reschedule → cancel-preview with the new
// scheduledCheckInTime) follows the same
// "behavioural emulator tests deferred" precedent
// set by MRB-11 / CRL-09 / MRB-14 (the local
// environment that has the Java emulator).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/email.ts"),
  "utf8"
);
const sharedUtilsSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/bookingHistory.ts"),
  "utf8"
);
const sharedIndexSrc = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);
const adminBookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);
const adminDrawerSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/BookingDrawerWorkspace.tsx"),
  "utf8"
);
const adminCancelPanelSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/CancellationPreviewPanel.tsx"),
  "utf8"
);
const guestLookupPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingLookupPage.tsx"),
  "utf8"
);

// Slice the reschedule handler body out of the file
// so the guards below are scoped to the reschedule
// path. The other handlers (create, walkin, cancel)
// have their own CRL-08-side concerns (the booking
// dates field at the destructive cancel response +
// the lookup response) and are tested separately.
function extractRescheduleHandler(): string {
  const start = bookingsHandlerSrc.indexOf("export async function handleRescheduleBooking");
  expect(start).toBeGreaterThanOrEqual(0);
  return bookingsHandlerSrc.slice(start);
}
const reschedule = extractRescheduleHandler();

describe("CRL-08 reschedule — cancellation policy snapshot refresh", () => {
  describe("Imports", () => {
    it("imports getCheckInInstant from @spark-inn/shared for the snapshot.scheduledCheckInTime recompute", () => {
      // The refresh uses the same `getCheckInInstant`
      // helper `createCancellationPolicySnapshot` uses
      // (date + hotel checkInTime + timezone → UTC
      // instant) so the recomputed instant is identical
      // to a fresh snapshot's instant for the same
      // inputs. The import is hoisted into the existing
      // @spark-inn/shared import block alongside
      // `createCancellationPolicySnapshot`.
      expect(bookingsHandlerSrc).toMatch(
        /createCancellationPolicySnapshot,\s*\n\s*getCheckInInstant,/
      );
    });

    it("imports getBookedOnDate + getOriginallyForCheckIn for the destructive-cancel + lookup response enrichment", () => {
      // The helpers are the single source of truth
      // for the booking-date computation; both the
      // `enrichAndRespond` (single + reservation
      // lookup) and the `handleCancelPreview`
      // (the cancel modal panel data) use the same
      // helpers so the two surfaces never drift.
      expect(bookingsHandlerSrc).toMatch(
        /getBookedOnDate,[\s\S]{0,200}?getOriginallyForCheckIn,/
      );
    });
  });

  describe("Reschedule transaction update — refreshes the snapshot in-place", () => {
    it("writes `cancellationPolicySnapshot` into the reservation header's transaction.update payload", () => {
      // The header update is the same `transaction.update(reservationDocRef, { ... })`
      // block that already writes `totalPrice` +
      // `subtotal` + `aggregateRevenueAllocation` +
      // `requestFingerprint` + `actualDateRange` +
      // `updatedAt` (per MRB-14). The new
      // `cancellationPolicySnapshot` key sits inside
      // the same object so the refresh is atomic
      // with the rest of the header update — a
      // partial commit can't leave the booking on
      // new dates with the old snapshot.
      const headerUpdateBlock = reschedule.match(
        /transaction\.update\(reservationDocRef, \{[\s\S]+?\}\);/
      );
      expect(headerUpdateBlock).toBeTruthy();
      const body = headerUpdateBlock![0];
      expect(body).toMatch(/cancellationPolicySnapshot:/);
    });

    it("preserves the existing snapshot's policy fields and only recomputes scheduledCheckInTime", () => {
      // Per CRL-05 (decision #174) the snapshot is
      // pinned at create time — a later settings
      // change should not retroactively rewrite a
      // rescheduled booking's policy. The refresh
      // spreads the previous snapshot (preserving
      // `cutoffHours` / `refundPctBefore` /
      // `refundPctAfter` / `policyText` / `source`)
      // and overrides only `scheduledCheckInTime`
      // with the recomputed ISO instant from the
      // new `checkIn` + the existing
      // `hotelConfig.checkInTime` + `timezone`.
      expect(reschedule).toMatch(
        /\.\.\.previousSnapshot,\s*\n\s*scheduledCheckInTime: newScheduledCheckInTime/
      );
    });

    it("recomputes the new scheduledCheckInTime via getCheckInInstant(checkIn, hotelConfig.checkInTime, hotelConfig.timezone)", () => {
      // The recompute uses the same shape
      // `createCancellationPolicySnapshot` uses
      // (date + checkInTime + timezone). The
      // fallbacks to "14:00" + "Asia/Manila" match
      // the helper's own defaults so the reschedule
      // never crashes on a missing hotelConfig.
      expect(reschedule).toMatch(
        /const tz = String\(hotelConfig\.timezone \|\| "Asia\/Manila"\);/
      );
      expect(reschedule).toMatch(
        /const checkInTime = String\(hotelConfig\.checkInTime \|\| "14:00"\);/
      );
      expect(reschedule).toMatch(
        /getCheckInInstant\(checkIn, checkInTime, tz\)\.toISOString\(\)/
      );
    });

    it("returns `undefined` (no write) when the header has no existing snapshot — a no-op for pre-CRL-05 bookings", () => {
      // Pre-CRL-05 bookings never had a snapshot
      // stamped (the field is on the reservation
      // header, which is itself MRB-01+). The
      // reschedule skips the refresh in that case
      // so we never write `cancellationPolicySnapshot:
      // null` over a pre-existing absence (the
      // cancel-preview's own fallback chain handles
      // those bookings via `booking.checkIn` +
      // legacy defaults).
      expect(reschedule).toMatch(
        /if \(!previousSnapshot\) return undefined;/
      );
    });

    it("the snapshot refresh lives in the SAME runTransaction as the booking + reservation header updates", () => {
      // FOL-03 invariant: every `await transaction.get`
      // completes before any `transaction.update`. The
      // `cancellationPolicySnapshot` write sits inside
      // the `if (reservationDocRef && existingReservationData)`
      // block that already gates the other header
      // fields, so the refresh is part of the same
      // atomic write. A pre-CRL-08 race that left the
      // booking on new dates with the old snapshot
      // (the user-reported bug) is no longer possible.
      const refreshIdx = reschedule.search(
        /cancellationPolicySnapshot: \(\(\) => \{/
      );
      const headerUpdateIdx = reschedule.search(
        /transaction\.update\(reservationDocRef, \{/
      );
      const runTxnCloseIdx = reschedule.indexOf(
        "    });\n\n    // Send email to guest"
      );
      expect(refreshIdx).toBeGreaterThanOrEqual(0);
      expect(headerUpdateIdx).toBeGreaterThanOrEqual(0);
      expect(refreshIdx).toBeLessThan(runTxnCloseIdx);
      expect(headerUpdateIdx).toBeLessThan(runTxnCloseIdx);
    });
  });

  describe("Lookup response — `enrichAndRespond` (single-booking fall-through)", () => {
    it("the response carries `bookedOn` + `originallyFor` ISO strings", () => {
      // Both are computed via the shared
      // `getBookedOnDate` / `getOriginallyForCheckIn`
      // helpers. The `reservation` binding is hoisted
      // to the outer function scope (per the comment
      // block above the `if (reservationId)` branch)
      // so the single-booking fall-through (N=1 +
      // legacy) also gets the values.
      expect(bookingsHandlerSrc).toMatch(
        /bookedOn: \(\(\) => \{\s*\n\s*const d = getBookedOnDate/
      );
      expect(bookingsHandlerSrc).toMatch(
        /originallyFor: \(\(\) => \{\s*\n\s*const d = getOriginallyForCheckIn/
      );
    });

    it("serializes the dates as `.toISOString()` or `null`", () => {
      // ISO string format so the wire shape is
      // consistent across server / client / the
      // helper that takes a `DateLike`. `null` when
      // the helper returns null (legacy with no
      // history, or a non-rescheduled booking where
      // the original equals the current check-in).
      expect(bookingsHandlerSrc).toMatch(
        /return d \? d\.toISOString\(\) : null;/
      );
    });
  });

  describe("Lookup response — `buildReservationLookupView` (reservation-scope)", () => {
    it("the reservation view carries `bookedOn` + `originallyFor` ISO strings", () => {
      // Same helpers, same shape. The reservation
      // view's `bookedOn` reads the header's
      // `createdAt` (the reservation-level creation
      // time) with the booking's `createdAt` as a
      // fallback; the `originallyFor` reads the
      // header's immutable `checkIn` (per MRB-14
      // the reschedule no longer mutates the
      // header's shared range, so this is the
      // create-time check-in).
      expect(bookingsHandlerSrc).toMatch(
        /bookedOn: \(\(\) => \{\s*\n\s*const d = getBookedOnDate\(\{ booking: anchorBooking, reservation \}\)/
      );
      expect(bookingsHandlerSrc).toMatch(
        /originallyFor: \(\(\) => \{\s*\n\s*const d = getOriginallyForCheckIn\(\{ booking: anchorBooking, reservation \}\)/
      );
    });
  });

  describe("Cancel preview response — `handleCancelPreview`", () => {
    it("the response includes top-level `bookedOn` + `originallyFor` fields (sibling to `preview`)", () => {
      // The cancel modal panel needs the dates
      // alongside the preview payload so the
      // "Booked on" / "Originally for" metadata
      // line is always visible next to the policy
      // verdict. The response shape is the same
      // `{ success, preview, bookedOn, originallyFor }`
      // the lookup uses — the panel handles a
      // `null` value as "don't render this row".
      expect(bookingsHandlerSrc).toMatch(
        /return res\.status\(200\)\.json\(\{\s*\n\s*success: true,\s*\n\s*preview,/
      );
      expect(bookingsHandlerSrc).toMatch(
        /bookedOn: bookedOnDate \? bookedOnDate\.toISOString\(\) : null,\s*\n\s*originallyFor: originallyForDate \? originallyForDate\.toISOString\(\) : null/
      );
    });
  });
});

describe("CRL-08 shared helpers — `getBookedOnDate` + `getOriginallyForCheckIn`", () => {
  describe("Module surface", () => {
    it("the new file is exported from the shared package", () => {
      // The shared index re-exports the new module
      // so the server + the client (admin + guest)
      // all import from the same path.
      expect(sharedIndexSrc).toMatch(/export \* from "\.\/utils\/bookingHistory";/);
    });

    it("the helper file declares `getBookedOnDate` + `getOriginallyForCheckIn`", () => {
      expect(sharedUtilsSrc).toMatch(/export function getBookedOnDate/);
      expect(sharedUtilsSrc).toMatch(/export function getOriginallyForCheckIn/);
    });
  });

  describe("getOriginallyForCheckIn — post-MRB-01 reservation header wins", () => {
    it("returns the reservation's `checkIn` when present (the immutable MRB-14 original)", () => {
      // The function reads the reservation first
      // (post-MRB-01 the header's `checkIn` is the
      // create-time original per MRB-14), then
      // falls through to the legacy `rescheduleHistory`
      // path. The shape is the same regardless of
      // whether the booking was rescheduled.
      expect(sharedUtilsSrc).toMatch(
        /const reservationOriginal = toDateOrNull\(input\.reservation\?\.checkIn\)/
      );
    });
  });

  describe("getBookedOnDate — reservation-level creation time wins", () => {
    it("returns the reservation's `createdAt` first, then the booking's `createdAt` as fallback", () => {
      // For a post-MRB-01 reservation the header's
      // `createdAt` is the reservation-level
      // creation time (the booking's own
      // `createdAt` is the same instant for N=1
      // but may differ for N>1 multi-room — the
      // reservation header is the canonical
      // source for the multi-room case).
      expect(sharedUtilsSrc).toMatch(
        /return toDateOrNull\(input\.reservation\?\.createdAt\)\s*\n\s*\?\? toDateOrNull\(input\.booking\?\.createdAt\)/
      );
    });
  });
});

describe("CRL-08 admin booking drawer — surface", () => {
  it("the `BookingDrawerWorkspaceHeader` component accepts `bookedOnLabel` + `originallyForLabel` props", () => {
    // The parent (`BookingsPage`) precomputes the
    // friendly strings via `formatBookedOnLabel` +
    // the shared helpers; the drawer renders them
    // verbatim so the label is consistent across
    // surfaces.
    expect(adminDrawerSrc).toMatch(/bookedOnLabel\?: string \| null;/);
    expect(adminDrawerSrc).toMatch(/originallyForLabel\?: string \| null;/);
  });

  it("the drawer renders the 'Booked on' + 'Originally for' spans in the metadata row", () => {
    // Renders as two inline-flex spans alongside
    // the room + stay dates so the staff reads
    // the full timeline in one place. Each span
    // carries a `data-testid` so the test surface
    // can pin the contract.
    expect(adminDrawerSrc).toMatch(/data-testid="booking-drawer-booked-on"/);
    expect(adminDrawerSrc).toMatch(/data-testid="booking-drawer-originally-for"/);
  });

  it("the parent `BookingsPage` computes the labels from the booking + reservation map", () => {
    // The drawer is a pure function of its inputs;
    // the parent owns the lookup. The parent
    // resolves the reservation via
    // `reservationsMap.get(selectedBooking.reservationId)`
    // (the same map the receipt + the booking list
    // already use) and hands the two ISO-resolved
    // dates + the friendly formatter to the drawer.
    expect(adminBookingsPageSrc).toMatch(
      /bookedOnLabel=\{formatBookedOnLabel\(\s*\n?\s*getBookedOnDate\(\{/
    );
    expect(adminBookingsPageSrc).toMatch(
      /originallyForLabel=\{formatBookedOnLabel\(\s*\n?\s*getOriginallyForCheckIn\(\{/
    );
  });
});

describe("CRL-08 admin cancellation preview panel — surface", () => {
  it("the panel accepts `bookedOn` + `originallyFor` props (ISO strings or `null`)", () => {
    expect(adminCancelPanelSrc).toMatch(/bookedOn\?: string \| null;/);
    expect(adminCancelPanelSrc).toMatch(/originallyFor\?: string \| null;/);
  });

  it("the panel renders both lines in a `data-testid` block when either is present", () => {
    // The block is suppressed entirely when both
    // are `null` (the booking has never been
    // rescheduled AND the booking-date field is
    // unknown). When at least one is present, the
    // block renders with two child spans (each
    // individually guarded by truthiness so a
    // partial payload renders just the available
    // half).
    expect(adminCancelPanelSrc).toMatch(
      /data-testid="cancellation-preview-booking-dates"/
    );
    expect(adminCancelPanelSrc).toMatch(/data-testid="cancellation-preview-booked-on"/);
    expect(adminCancelPanelSrc).toMatch(/data-testid="cancellation-preview-originally-for"/);
  });

  it("the admin `BookingsPage` reads `data.bookedOn` + `data.originallyFor` from the cancel-preview API response", () => {
    // The fetch handler stores both fields in
    // component state and passes them to the
    // panel. The handler also clears both fields
    // on error + on modal close so a previous
    // session's metadata never bleeds into a new
    // one.
    expect(adminBookingsPageSrc).toMatch(
      /setCancelPreviewBookedOn\(typeof data\.bookedOn === "string" \? data\.bookedOn : null\)/
    );
    expect(adminBookingsPageSrc).toMatch(
      /setCancelPreviewOriginallyFor\(typeof data\.originallyFor === "string" \? data\.originallyFor : null\)/
    );
  });
});

describe("CRL-08 guest /my-booking page — surface", () => {
  it("the `BookingData` interface declares `bookedOn` + `originallyFor` (ISO strings or `null`)", () => {
    expect(guestLookupPageSrc).toMatch(/bookedOn\?: string \| null;/);
    expect(guestLookupPageSrc).toMatch(/originallyFor\?: string \| null;/);
  });

  it("the `ReservationView` interface declares the same two fields (reservation-scope card)", () => {
    expect(guestLookupPageSrc).toMatch(/bookedOn\?: string \| null;/);
    expect(guestLookupPageSrc).toMatch(/originallyFor\?: string \| null;/);
  });

  it("the single-booking card renders a 'booking-card-booking-dates' block when either is present", () => {
    expect(guestLookupPageSrc).toMatch(
      /data-testid="booking-card-booking-dates"/
    );
  });

  it("the reservation card renders a 'reservation-card-booking-dates' block when either is present", () => {
    expect(guestLookupPageSrc).toMatch(
      /data-testid="reservation-card-booking-dates"/
    );
  });

  it("the page imports the `CalendarPlus` + `History` icons from lucide-react for the two metadata lines", () => {
    // The two icons match the per-field labels:
    // `CalendarPlus` for the booking creation date
    // (the "calendar-plus" metaphor — making a
    // booking) and `History` for the original
    // scheduled check-in (the "history" metaphor
    // — looking back at the original date).
    expect(guestLookupPageSrc).toMatch(/CalendarPlus, History/);
  });
});

describe("CRL-08 confirmation emails + receipt PDF — surface", () => {
  it("the `bookingRows` template renders a 'Booked on' row when `booking.bookedOn` is set", () => {
    // The reservation-scope + single-booking
    // branches both append the row via the same
    // `${booking.bookedOn ? row(...) : ""}` shape
    // so the two templates never drift.
    expect(emailHandlerSrc).toMatch(
      /\$\{booking\.bookedOn \? row\("Booked on", formatDate\(booking\.bookedOn\)\) : ""\}/
    );
  });

  it("the `bookingRows` template renders an 'Originally for' row when `booking.originallyFor` is set", () => {
    expect(emailHandlerSrc).toMatch(
      /\$\{booking\.originallyFor \? row\("Originally for", formatDate\(booking\.originallyFor\)\) : ""\}/
    );
  });

  it("the `sendBookingTrigger` enrichment populates the single-booking case (legacy + modern N=1)", () => {
    // The reservation-scope view (built by
    // `buildReservationEmailView`) already carries
    // both fields. The enrichment in
    // `sendBookingTrigger` covers the single-booking
    // case (modern N=1 not going through the
    // reservation-scope view, + legacy
    // pre-MRB-01 null-`reservationId` bookings).
    // The `isReservation` guard skips the
    // enrichment for the view (the view's fields
    // win).
    expect(emailHandlerSrc).toMatch(/if \(booking && !booking\.isReservation\)/);
    expect(emailHandlerSrc).toMatch(/booking\.bookedOn = booking\.createdAt \?\? null;/);
  });

  it("the server-side receipt PDF renders 'Booked on' + 'Originally for' lines when the fields are set", () => {
    // The PDF generator appends both lines to the
    // booking-details block (after Check-in /
    // Check-out / Nights). The single-booking case
    // is the only one the server-side PDF handles
    // (the multi-room case uses the per-room PDF
    // in the admin app).
    expect(emailHandlerSrc).toMatch(/text\("Booked on:", fmtDate\(booking\.bookedOn\), top\)/);
    expect(emailHandlerSrc).toMatch(/text\("Originally for:", fmtDate\(booking\.originallyFor\), top\)/);
  });

  it("the admin receipt PDF appends the two rows to the Stay card", () => {
    // The admin receipt uses the `stayRows` array
    // (not the server-side PDF generator). The
    // two lines are appended via the same
    // `...(receiptBookedOn ? [{ label: "Booked on", value: ... }] : [])`
    // shape so the conditional render is
    // uniform — pre-CRL-08 the receipt only
    // printed the current dates, so the "Booked
    // on" + "Originally for" rows are net-new.
    expect(adminBookingsPageSrc).toMatch(
      /\.\.\.\(receiptBookedOn\s*\n?\s*\? \[\{ label: "Booked on", value: formatBookedOnLabel/
    );
    expect(adminBookingsPageSrc).toMatch(
      /\.\.\.\(receiptOriginallyFor\s*\n?\s*\? \[\{ label: "Originally for", value: formatBookedOnLabel/
    );
  });
});
