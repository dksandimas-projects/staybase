import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

describe("Phase 11.7 — Bookings per-page cleanup (P1)", () => {
  describe("Mobile booking card — 3-dot menu + PAID pill", () => {
    const cardBlock = (() => {
      const m = bookingsSrc.match(
        /const renderBookingCard\s*=\s*\(row:\s*Booking\)\s*=>\s*\(\s*<div[\s\S]*?const renderOrderCard/
      );
      return m ? m[0] : "";
    })();

    it("imports the MoreVertical icon from lucide-react", () => {
      expect(bookingsSrc).toMatch(/\bMoreVertical\b/);
    });

    it("renders a 3-dot overflow button inside the card", () => {
      expect(cardBlock).toMatch(/<MoreVertical/);
    });

    it("the 3-dot button opens the detail drawer with stopPropagation", () => {
      expect(cardBlock).toMatch(/e\.stopPropagation\(\)/);
      expect(cardBlock).toMatch(/setSelectedBooking\(row\)/);
      expect(cardBlock).toMatch(/setIsDrawerOpen\(true\)/);
    });

    it("the 3-dot button has an aria-label that names the booking", () => {
      expect(cardBlock).toMatch(/aria-label=\{`Open actions for booking \$\{row\.bookingRef\}`\}/);
    });

    it("computes a 'paid' flag from onsitePayments vs totalPrice", () => {
      const isPaidFn = bookingsSrc.match(
        /const isBookingPaid\s*=\s*\(row:\s*Booking\)\s*=>\s*\{[\s\S]*?onsitePayments[\s\S]*?\}/
      );
      expect(isPaidFn, "expected isBookingPaid helper").toBeTruthy();
      expect(isPaidFn![0]).toMatch(/paid\s*>\s*=\s*row\.totalPrice/);
    });

    it("renders a 'Paid' pill when the booking is fully paid", () => {
      expect(cardBlock).toMatch(/aria-label="Fully paid"/);
      expect(cardBlock).toMatch(/Paid/);
    });
  });

  describe("Walk-in booking modal — single column on mobile", () => {
    it("no sm:grid-cols-2 / sm:grid-cols-3 inside the walk-in form", () => {
      // Extract the walk-in form (between <form onSubmit={handleWalkinSubmit}>
      // and the closing </form>). Use a non-greedy match up to the next </form>.
      const formMatch = bookingsSrc.match(
        /<form onSubmit=\{handleWalkinSubmit\}[\s\S]*?<\/form>/
      );
      expect(formMatch, "expected walk-in form block").toBeTruthy();
      const form = formMatch![0];
      expect(form, "walk-in form should not use sm:grid-cols-2").not.toMatch(/sm:grid-cols-2/);
      expect(form, "walk-in form should not use sm:grid-cols-3").not.toMatch(/sm:grid-cols-3/);
    });

    it("the form is structured as a single column of labels (no parent grid > 1 col)", () => {
      const formMatch = bookingsSrc.match(
        /<form onSubmit=\{handleWalkinSubmit\}[\s\S]*?<\/form>/
      );
      const form = formMatch![0];
      const gridCount = (form.match(/<div className="grid /g) ?? []).length;
      expect(gridCount, "walk-in form should have 0 nested grid wrappers").toBe(0);
    });

    it("still renders the Confirm Reservation submit button (footer is unchanged)", () => {
      const formMatch = bookingsSrc.match(
        /<form onSubmit=\{handleWalkinSubmit\}[\s\S]*?<\/form>/
      );
      const form = formMatch![0];
      expect(form).toMatch(/Confirm Reservation/);
    });
  });
});
