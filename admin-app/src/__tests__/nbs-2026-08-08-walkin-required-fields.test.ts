import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per NBS-2026-08-08 (F4, booking-flow audit 2026-08-08):
// the previous admin walk-in create path wrote
// `walkin-${Date.now()}@example.invalid` + the literal
// string `"n/a"` to Firestore when the desk left the
// email/phone fields blank. The fake email then
// occupied the match-by-email field for every later
// Spark Rewards link / /my-booking lookup /
// contact-inquiry reply. The fix requires both fields
// at submit time and stores the desk-entered values.
// The Calendar create path had the same shape
// (`calendar-${Date.now()}@example.invalid` + `"n/a"`)
// and is fixed in the same batch.
//
// This test file pins the no-fake-email/no-fake-phone
// contract at the source-text level. The test searches
// for the previous fake placeholders in the source and
// asserts they're GONE — a regression test against a
// future refactor that silently re-introduces the
// placeholder-write path.

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);
const calendarPageSrc = readFileSync(
  resolve(__dirname, "../pages/CalendarPage.tsx"),
  "utf8"
);

describe("NBS-2026-08-08 — admin walk-in requires real email + phone (F4)", () => {
  describe("BookingsPage New Booking modal", () => {
    it("no longer writes a synthetic `walkin-${Date.now()}@example.invalid` placeholder", () => {
      // The previous shape was:
      //   guestEmail: guestEmail || `walkin-${Date.now()}@example.invalid`,
      // The fix trims the desk-entered value; an
      // empty trim returns early via the
      // `if (!trimmedEmail)` guard. The check is
      // anchored to the `||` default-value pattern
      // (a future regression would have to land the
      // exact `||` form to bypass the test) — it
      // does NOT match documentation comments that
      // reference the old placeholder string.
      expect(bookingsPageSrc).not.toMatch(
        /guestEmail \|\| `walkin-\$\{Date\.now\(\)\}@example\.invalid`/
      );
    });

    it("no longer writes the literal `\"n/a\"` phone placeholder", () => {
      // The previous shape was:
      //   guestPhone: guestPhone || "n/a",
      // The fix sends the trimmed value or bails
      // out via the `if (!trimmedPhone)` guard.
      // Anchored to the `||` default-value pattern.
      expect(bookingsPageSrc).not.toMatch(
        /guestPhone \|\| "n\/a"/
      );
    });

    it("trims the email + phone values before passing them to addWalkinBooking", () => {
      // The trimmed values are the canonical
      // source for the wire payload. The earlier
      // shape sent the raw `guestEmail` /
      // `guestPhone` state which could carry
      // leading/trailing whitespace.
      const trimMatch = bookingsPageSrc.match(
        /const trimmedEmail = guestEmail\.trim\(\)/
      );
      const phoneMatch = bookingsPageSrc.match(
        /const trimmedPhone = guestPhone\.trim\(\)/
      );
      expect(trimMatch).not.toBeNull();
      expect(phoneMatch).not.toBeNull();
    });

    it("refuses to submit when the email is empty (toast warning + early return)", () => {
      // The previous shape silently wrote a fake
      // email; the fix surfaces a `toast.warning`
      // with the field name + the next step, then
      // returns before any wire call. The guard
      // checks `!trimmedEmail` (the trimmed value,
      // not the raw state).
      const guardMatch = bookingsPageSrc.match(
        /if \(!trimmedEmail\) \{[\s\S]*?toast\.warning\(\s*"Email required"/
      );
      expect(guardMatch).not.toBeNull();
    });

    it("refuses to submit when the phone is empty (toast warning + early return)", () => {
      const guardMatch = bookingsPageSrc.match(
        /if \(!trimmedPhone\) \{[\s\S]*?toast\.warning\(\s*"Phone required"/
      );
      expect(guardMatch).not.toBeNull();
    });

    it("sends the trimmed values to addWalkinBooking (not the raw state)", () => {
      // The wire payload uses the trimmed values;
      // the server-side `WalkinGuestDetailsSchema`
      // still re-validates with the same trim + max
      // length guards (F4 doesn't loosen the
      // server contract — it just stops the
      // placeholder write on the client).
      const wireMatch = bookingsPageSrc.match(
        /guestEmail: trimmedEmail,[\s\S]*?guestPhone: trimmedPhone,/
      );
      expect(wireMatch).not.toBeNull();
    });
  });

  describe("CalendarPage create modal (F4 Calendar mirror)", () => {
    it("no longer writes a synthetic `calendar-${Date.now()}@example.invalid` placeholder", () => {
      // Anchored to the `||` default-value pattern.
      // A future regression would have to land the
      // exact `||` form to bypass the test.
      expect(calendarPageSrc).not.toMatch(
        /guestEmail \|\| `calendar-\$\{Date\.now\(\)\}@example\.invalid`/
      );
    });

    it("no longer writes the literal `\"n/a\"` phone placeholder", () => {
      expect(calendarPageSrc).not.toMatch(
        /guestPhone \|\| "n\/a"/
      );
    });

    it("refuses to submit when the email is empty", () => {
      const guardMatch = calendarPageSrc.match(
        /if \(!trimmedEmail\) \{[\s\S]*?toast\.warning\(\s*"Email required"/
      );
      expect(guardMatch).not.toBeNull();
    });

    it("refuses to submit when the phone is empty", () => {
      const guardMatch = calendarPageSrc.match(
        /if \(!trimmedPhone\) \{[\s\S]*?toast\.warning\(\s*"Phone required"/
      );
      expect(guardMatch).not.toBeNull();
    });

    it("sends the trimmed values to addWalkinBooking", () => {
      const wireMatch = calendarPageSrc.match(
        /guestEmail: trimmedEmail,[\s\S]*?guestPhone: trimmedPhone,/
      );
      expect(wireMatch).not.toBeNull();
    });
  });
});
