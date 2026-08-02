import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 17 — #83 (Cron reminderSentAt
// idempotency) + #100 (Corporate bookings never accept promo vouchers).
//
// #83: The /api/email/checkin-reminder cron previously re-sent the
// reminder on every run. The handler now writes a `reminderSentAt`
// timestamp on each booking it sends to and skips bookings that
// already have the field set, so Vercel cron re-runs are safe.
//
// #100: handleCreateBooking silently zeros the voucher discount when
// the booking is a corporate booking (server-derived isCorporate is
// true). The booking doc is written with `voucherCode: ""` +
// `voucherDiscount: 0` regardless of what the client supplied.

const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/email.ts"),
  "utf8"
);
const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const bookingTypeSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);
const adminCtxSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);
const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

describe("Phase 11.6 Batch 17 — cron idempotency + corporate no-promo", () => {
  describe("#83 — reminderSentAt idempotency on the checkin-reminder cron", () => {
    it("handler filters out bookings that already have reminderSentAt set", () => {
      const cronMatch = emailHandlerSrc.match(
        /if\s*\(\s*action\s*===\s*["']checkin-reminder["']\s*&&\s*!req\.body\?\.bookingId[\s\S]*?\}\s*\)\s*;\s*\n\s*\}/
      );
      expect(cronMatch, "expected to find the checkin-reminder cron branch").toBeTruthy();
      const body = cronMatch![0];
      expect(body).toMatch(/bookings\.filter\(\(booking: any\)\s*=>\s*!booking\?\.reminderSentAt\)/);
    });

    it("handler writes reminderSentAt to each booking it sends to", () => {
      const cronMatch = emailHandlerSrc.match(
        /if\s*\(\s*action\s*===\s*["']checkin-reminder["']\s*&&\s*!req\.body\?\.bookingId[\s\S]*?\}\s*\)\s*;\s*\n\s*\}/
      );
      expect(cronMatch).toBeTruthy();
      const body = cronMatch![0];
      expect(body).toMatch(/adminDb\.collection\(["']bookings["']\)\.doc\(id\)\.update\(\{\s*reminderSentAt:\s*stamp\s*\}\)/);
    });

    it("handler reports both sent + skipped counts in the response", () => {
      const cronMatch = emailHandlerSrc.match(
        /if\s*\(\s*action\s*===\s*["']checkin-reminder["']\s*&&\s*!req\.body\?\.bookingId[\s\S]*?\}\s*\)\s*;\s*\n\s*\}/
      );
      expect(cronMatch).toBeTruthy();
      const body = cronMatch![0];
      expect(body).toMatch(/sent:\s*pending\.length/);
      expect(body).toMatch(/skipped:\s*bookings\.length\s*-\s*pending\.length/);
    });

    it("Booking type has reminderSentAt as string | null", () => {
      const blockMatch = bookingTypeSrc.match(
        /export\s+interface\s+Booking\s*\{[\s\S]*?\n\}/
      );
      expect(blockMatch).toBeTruthy();
      const body = blockMatch![0];
      expect(body).toMatch(/reminderSentAt:\s*string\s*\|\s*null/);
    });

    it("AdminContext snapshot mapper reads reminderSentAt from Firestore", () => {
      expect(adminCtxSrc).toMatch(/reminderSentAt:\s*data\.reminderSentAt\s*\?\s*parseDateTimeString\(data\.reminderSentAt\)\s*:\s*null/);
    });

    it("admin Booking type also exposes reminderSentAt", () => {
      const typeMatch = adminCtxSrc.match(
        /export\s+interface\s+Booking\s*\{[\s\S]*?\n\}/
      );
      expect(typeMatch).toBeTruthy();
      const body = typeMatch![0];
      expect(body).toMatch(/reminderSentAt:\s*string\s*\|\s*null/);
    });

    it("BookingsPage walk-in booking submission includes reminderSentAt: null", () => {
      expect(bookingsPageSrc).toMatch(/reminderSentAt:\s*null/);
    });
  });

  describe("#100 — corporate bookings never accept promo vouchers", () => {
    it("handleCreateBooking gates voucherCode on !corporateDetails.isCorporate", () => {
      const voucherMatch = bookingsHandlerSrc.match(
        /if\s*\(\s*voucherCode\s*&&\s*!corporateDetails\.isCorporate\s*\)/
      );
      expect(voucherMatch, "expected to find the corporate-gated voucher check").toBeTruthy();
    });

    it("the voucher validation block no longer runs for corporate bookings", () => {
      // The previous code unconditionally entered the if(voucherCode)
      // block. Now the only entry path is the gated check.
      const createMatch = bookingsHandlerSrc.match(
        // Per MRB-06 / MRB-07 (2026-08-02, per decision #159): the
        // create path writes N booking docs in a loop rather than one
        // `transaction.set(bookingDocRef, newBooking)`, so the body is
        // anchored on the reservation header write instead.
        /async\s+function\s+handleCreateBooking\s*\([\s\S]*?transaction\.set\(reservationDocRef,\s*newReservation\);/
      );
      expect(createMatch).toBeTruthy();
      const body = createMatch![0];
      // No bare `if (voucherCode)` (without the !isCorporate guard).
      expect(body).not.toMatch(/^\s*if\s*\(\s*voucherCode\s*\)\s*\{/m);
      // The gated check is present.
      expect(body).toMatch(/if\s*\(\s*voucherCode\s*&&\s*!corporateDetails\.isCorporate\s*\)\s*\{/);
    });

    it("the booking doc always persists voucherCode: '' + voucherDiscount: 0 for corporate bookings", () => {
      // The doc write block hard-codes both fields; if the voucher
      // branch was skipped (corporate), the defaults from the doc
      // literal are what gets stored.
      const createMatch = bookingsHandlerSrc.match(
        // Per MRB-06 / MRB-07 (2026-08-02, per decision #159): the
        // create path writes N booking docs in a loop rather than one
        // `transaction.set(bookingDocRef, newBooking)`, so the body is
        // anchored on the reservation header write instead.
        /async\s+function\s+handleCreateBooking\s*\([\s\S]*?transaction\.set\(reservationDocRef,\s*newReservation\);/
      );
      expect(createMatch).toBeTruthy();
      const body = createMatch![0];
      expect(body).toMatch(/voucherCode:\s*appliedVoucherCode/);
      expect(body).toMatch(/voucherDiscount,\s*$/m);
    });
  });
});
