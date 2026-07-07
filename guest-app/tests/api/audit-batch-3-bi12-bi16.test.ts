import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for the BI-12 / BI-16 audit fixes
// (plan/project/AUDIT-BOOKING-INTERCOM-2026-07-06.md):
//
//   BI-12 — Corporate flow defaults to hardcoded past dates; server
//           accepts past check-ins. The corporate page seeded
//           `checkIn` / `checkOut` with literal `"2026-06-12"` /
//           `"2026-06-14"` (Phase 0.5 wireframe defaults that
//           became past-the-day the audit ran), and the server
//           never rejected past check-ins. The durable fix is
//           server-side past-date rejection on the public
//           /api/bookings/create route (the walkin route is exempt
//           so staff can backfill). The client-side fix is to
//           default to today / tomorrow (matching BookingPage)
//           instead of the hardcoded literal.
//
//   BI-16 — `guestDetails` not Zod-validated server-side. The
//           create endpoint previously checked field *presence*
//           only — a garbage email (breaks every booking email
//           downstream) or a 100KB `requests` blob went straight
//           into Firestore. The fix is the `guestDetailsSchema`
//           in `bookings.ts` that trims, length-caps, and
//           normalizes every field. (BI-11's corporate-metadata
//           work added the schema as a side effect; the regression
//           test pins its presence + structure.)
//
// All assertions are source-pattern tests so a future agent that
// removes the validation triggers a CI failure.

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const corporateBookingSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/CorporateBookingPage.tsx"),
  "utf8"
);

describe("Audit Batch 3 (BI-12 + BI-16) — past-date rejection + guest details Zod schema", () => {
  describe("BI-12 — server-side past-date rejection", () => {
    it("handleCreateBooking reads Manila today's date and rejects past check-ins with a 400", () => {
      // The past-date check must run *inside* `handleCreateBooking`
      // (the public /api/bookings/create route) so a hostile client
      // cannot bypass the client's date-picker min attribute.
      // The audit explicitly notes `handleCreateWalkin` is exempt —
      // staff may legitimately backfill past stays — so the check
      // is *not* expected in the walkin handler.
      const fnStart = bookingsSrc.indexOf("export async function handleCreateBooking");
      const fnEnd = bookingsSrc.indexOf("export async function handleCreateWalkin", fnStart);
      const createFn = bookingsSrc.slice(fnStart, fnEnd);
      expect(createFn).toMatch(/getManilaDateInfo\(\)/);
      expect(createFn).toMatch(/todayStr:\s*manilaToday/);
      // Must throw a 400 with a clear error message — not silently
      // accept the past date.
      expect(createFn).toMatch(
        /checkIn\s*<\s*manilaToday[\s\S]{0,400}Check-in date cannot be in the past/
      );
      // Must return 400 (not 500 / 409) on past-date rejection.
      expect(createFn).toMatch(
        /return res\.status\(400\)\.json\([\s\S]{0,400}Check-in date cannot be in the past/
      );
    });

    it("handleCreateWalkin is exempt from past-date rejection (staff backfill)", () => {
      // Staff may legitimately create a walkin for a guest who
      // arrived and forgot to register. The past-date rejection
      // must be scoped to the public /api/bookings/create handler
      // only. Assert the walkin handler does NOT contain the
      // past-date check so the exemption is preserved.
      const fnStart = bookingsSrc.indexOf("export async function handleCreateWalkin");
      const fnEnd = bookingsSrc.indexOf("export async function handleRejectDiscount", fnStart);
      const walkinFn = bookingsSrc.slice(fnStart, fnEnd);
      expect(walkinFn).not.toMatch(/manilaToday/);
      expect(walkinFn).not.toMatch(/Check-in date cannot be in the past/);
    });

    it("CorporateBookingPage defaults checkIn to today and checkOut to tomorrow (no hardcoded literal)", () => {
      // The previous implementation seeded the corporate page
      // with literal `"2026-06-12"` / `"2026-06-14"` dates —
      // hardcoded Phase 0.5 wireframe defaults that became
      // past-the-day the audit ran. A guest who never touched
      // the date picker was booking a stay that had already
      // ended. The fix matches `BookingPage`: today / tomorrow,
      // computed from the browser's `new Date()`.
      expect(corporateBookingSrc).not.toMatch(/"2026-06-12"/);
      expect(corporateBookingSrc).not.toMatch(/"2026-06-14"/);
      // Mirrors BookingPage's timezone-aware shared helper.
      expect(corporateBookingSrc).toMatch(/getDateKeyInTimezone\(config\.timezone,\s*1\)/);
      expect(corporateBookingSrc).toMatch(/getDateKeyInTimezone\(config\.timezone,\s*2\)/);
      expect(corporateBookingSrc).toMatch(
        /useState\(searchParams\.get\(\s*["']checkIn["']\s*\)\s*\?\?\s*getDateKeyInTimezone\(config\.timezone,\s*1\)\)/
      );
      expect(corporateBookingSrc).toMatch(
        /useState\(searchParams\.get\(\s*["']checkOut["']\s*\)\s*\?\?\s*getDateKeyInTimezone\(config\.timezone,\s*2\)\)/
      );
    });
  });

  describe("BI-16 — guestDetails Zod schema on the create endpoint", () => {
    it("handleCreateBooking uses a Zod schema (guestDetailsSchema) to validate guestDetails", () => {
      // The create endpoint previously checked field *presence*
      // only. A 100KB `requests` string or a garbage email
      // (breaks every booking email downstream) landed straight
      // in Firestore. The Zod schema fixes both.
      expect(bookingsSrc).toMatch(/const\s+guestDetailsSchema\s*=\s*z\.object\(/);
    });

    it("guestDetailsSchema trims + length-caps firstName, lastName, email, phone, requests", () => {
      // The schema must apply `.trim()` to every string field so
      // leading / trailing whitespace is normalized, and `.max()`
      // caps to keep the data bounded. The audit called out a
      // 100KB `requests` blob specifically — that must be capped.
      const schemaMatch = bookingsSrc.match(
        /const\s+guestDetailsSchema\s*=\s*z\.object\(([\s\S]*?)\}\);/
      );
      expect(schemaMatch, "expected to find guestDetailsSchema object").toBeTruthy();
      const schemaBody = schemaMatch![1];
      // Every string field is trimmed and length-capped.
      expect(schemaBody).toMatch(/firstName:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(80\)/);
      expect(schemaBody).toMatch(/lastName:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(80\)/);
      expect(schemaBody).toMatch(/email:\s*z\.string\(\)\.trim\(\)\.toLowerCase\(\)\.email\(\)\.max\(160\)/);
      expect(schemaBody).toMatch(/phone:\s*z\.string\(\)\.trim\(\)\.min\(7\)\.max\(32\)/);
      // 1000-char cap on the free-form requests field is the
      // specific size the audit called out.
      expect(schemaBody).toMatch(/requests:\s*z\.string\(\)\.trim\(\)\.max\(1000\)/);
    });

    it("guestDetailsSchema requires consent: boolean (the only required-by-policy field)", () => {
      // The Privacy Policy consent checkbox is the only
      // legally-required field (RA 10173). It must be a
      // non-optional boolean — no default — so a missing
      // consent cannot slip through with `default(false)`.
      const schemaMatch = bookingsSrc.match(
        /const\s+guestDetailsSchema\s*=\s*z\.object\(([\s\S]*?)\}\);/
      );
      const schemaBody = schemaMatch![1];
      expect(schemaBody).toMatch(/consent:\s*z\.boolean\(\),?\s*$/m);
      // Must NOT be wrapped in `.optional()`.
      expect(schemaBody).not.toMatch(/consent:\s*z\.boolean\(\)\.optional/);
    });

    it("handleCreateBooking parses the schema and returns 400 on validation failure", () => {
      // A validation failure must short-circuit with a 400 +
      // a generic-but-actionable error message before any
      // Firestore work runs. The 400 path is shared with the
      // existing presence-check (lines just above), so the
      // branch ordering matters.
      const fnStart = bookingsSrc.indexOf("export async function handleCreateBooking");
      const fnEnd = bookingsSrc.indexOf("export async function handleCreateWalkin", fnStart);
      const createFn = bookingsSrc.slice(fnStart, fnEnd);
      expect(createFn).toMatch(/guestDetailsSchema\.safeParse\(rawGuestDetails\)/);
      // The error message must be generic (no schema leak) but
      // actionable for the guest.
      expect(createFn).toMatch(
        /Please check your guest details — a required field is missing or invalid/
      );
    });
  });
});
