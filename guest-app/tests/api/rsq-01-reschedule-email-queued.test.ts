// Per RSQ-01 (2026-11-19): the guest-notification email for a
// room/date change must never fail SILENTLY.
//
// THE DEFECT (pre-fix): `handleRescheduleBooking` + 
// `handleAddRoomToReservation` fired the `booking-rescheduled`
// email inside a try/catch that swallowed a Resend failure into a
// `console.error`, and the HTTP response carried NO email state.
// The desk got a green "Booking moved" toast while the guest had
// never heard about their room/date change — the exact silent
// swallow that #11 fixed for the confirm path (which returns
// `emailQueued: boolean`).
//
// THE FIX: both handlers return `emailQueued` in their response
// `data`, set to `false` when the send throws. The DLQ write
// (`failed_emails`) already happens inside `sendEmail` (per #11),
// and `sendEmail` re-throws so the handler's catch sees it.
//
// Also pinned here: the ROUTER registration of the action. The
// pre-fix `booking-rescheduled` was in NEITHER the public nor the
// staff-only allowlist, so `POST /api/email/booking-rescheduled`
// answered 404 and the desk could not re-send a failed
// notification at all.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// the reschedule handler's transaction body is ~1,000 lines deep
// (availability conflicts, rate recomputation, breakfast re-dating,
// reservation mirrors) — a behavioural fixture for it would be a
// brittle re-implementation of the handler. The RUNTIME contract
// for the resend route is pinned at
// `rsq-01-reschedule-email-resend.test.ts`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const bookingsSrc = read("guest-app/server/handlers/bookings.ts");
const emailSrc = read("guest-app/server/handlers/email.ts");
const apiRouterSrc = read("guest-app/server/apiRouter.ts");

// Slice a top-level `export async function <name>(` body. The
// handlers are declared at the top level, so the next top-level
// `export ` marks the end of the slice.
function sliceHandler(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next < 0 ? src.length : next);
}

describe("RSQ-01 — the reschedule guest-notification email is never silent", () => {
  describe("handleRescheduleBooking — the `emailQueued` response flag", () => {
    const handler = sliceHandler(bookingsSrc, "handleRescheduleBooking");

    it("the handler body was found", () => {
      expect(handler.length).toBeGreaterThan(0);
    });

    it("the email send is wrapped in a try/catch that flips `emailQueued` to false", () => {
      // The flag starts `true` (the transaction committed and an
      // email was attempted) and only the catch flips it.
      expect(handler).toMatch(/let emailQueued = true;/);
      expect(handler).toMatch(
        /await sendBookingTrigger\("booking-rescheduled", fullBookingForEmail\);[\s\S]{0,300}?catch \(emailErr\) \{[\s\S]{0,200}?emailQueued = false;/
      );
    });

    it("the response `data` carries the `emailQueued` flag", () => {
      // The desk's toast branches on this flag — if the response
      // drops it, the toast silently reverts to the happy path.
      expect(handler).toMatch(/reservationRef: String\(\(existingReservationData as any\)\?\.reservationRef \|\| ""\),[\s\S]{0,500}?emailQueued/);
    });
  });

  describe("handleAddRoomToReservation — the `emailQueued` response flag", () => {
    const handler = sliceHandler(bookingsSrc, "handleAddRoomToReservation");

    it("the handler body was found", () => {
      expect(handler.length).toBeGreaterThan(0);
    });

    it("the email send is wrapped in a try/catch that flips `emailQueued` to false", () => {
      expect(handler).toMatch(/let emailQueued = true;/);
      expect(handler).toMatch(
        /await sendBookingTrigger\("booking-rescheduled", fullBookingForEmail\);[\s\S]{0,300}?catch \(emailErr\) \{[\s\S]{0,200}?emailQueued = false;/
      );
    });

    it("the response `data` carries the `emailQueued` flag", () => {
      expect(handler).toMatch(/reservationRef: updatedHeader\?\.reservationRef \|\| null,[\s\S]{0,200}?emailQueued/);
    });
  });

  describe("the router registers `booking-rescheduled` as a staff-only action", () => {
    it("`staffOnlyEmailActions` contains the action", () => {
      // Without this the route falls through to the router's
      // fallback 404 — the pre-fix defect.
      const staffOnly = apiRouterSrc.match(
        /const staffOnlyEmailActions = new Set\(\[([\s\S]*?)\]\);/
      );
      expect(staffOnly, "expected the staffOnlyEmailActions set").not.toBeNull();
      expect(staffOnly![1]).toMatch(/"booking-rescheduled"/);
    });

    it("the action is NOT in the public allowlist", () => {
      // Staff-only for the same reason as `booking-confirmed`:
      // this is the DESK's resend button, and no guest code path
      // calls it. A public entry would let anyone trigger a
      // "your booking changed" email for a guest.
      const publicActions = apiRouterSrc.match(
        /const publicEmailActions = new Set\(\[([\s\S]*?)\]\);/
      );
      expect(publicActions, "expected the publicEmailActions set").not.toBeNull();
      expect(publicActions![1]).not.toMatch(/"booking-rescheduled"/);
    });
  });

  describe("the resend renders the reservation-scope view", () => {
    it("the resend path builds the reservation view for `booking-rescheduled`", () => {
      // The generic resend path hands the trigger a single booking
      // doc — for an N-room reservation that renders only the lead
      // room, while the inline path sent every room.
      expect(emailSrc).toMatch(
        /action === "booking-rescheduled"\s*\?\s*await buildRescheduledEmailView\(booking\)/
      );
      expect(emailSrc).toMatch(/async function buildRescheduledEmailView\(booking: any\)/);
    });

    it("the builder falls back to the per-child view when there is no reservation", () => {
      // A legacy pre-MRB-01 booking has no `reservationId`; the
      // per-child view is correct for it.
      expect(emailSrc).toMatch(
        /const reservationId = String\(booking\?\.reservationId \|\| ""\)\.trim\(\);[\s\S]{0,200}?if \(!reservationId\) return booking;/
      );
    });
  });
});
