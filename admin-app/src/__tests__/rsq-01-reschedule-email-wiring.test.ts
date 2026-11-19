// Per RSQ-01 (2026-11-19): the desk-facing wiring for the
// reschedule guest-notification email.
//
// THE DEFECT (pre-fix): the admin app had no way to see that a
// room/date-change notification failed, and no way to re-send it.
//   (a) `handleMoveSubmit` / `handleExtendSubmit` showed a green
//       "Booking moved" / "Stay extended" toast unconditionally —
//       the server swallowed the Resend failure (per #11 the DLQ
//       row exists, but the desk never learned of it inline);
//   (b) the drawer's "Resend Transactional Email" panel offered
//       six templates and NOT `booking-rescheduled`, so even a
//       desk that KNEW the email failed had no button — and the
//       server route answered 404 anyway (pinned on the server
//       side at `guest-app/tests/api/rsq-01-reschedule-email-
//       queued.test.ts`).
//
// THE FIX: both handlers branch on the server's `emailQueued`
// flag and raise a `toast.warning` that points at the drawer's
// email panel; the panel gains a "Booking Updated" button.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The runtime contract for the resend
// route is pinned at `guest-app/tests/api/rsq-01-reschedule-email-
// resend.test.ts`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const adminContextSrc = read("admin-app/src/context/AdminContext.tsx");
const bookingsPageSrc = read("admin-app/src/pages/BookingsPage.tsx");
const bookingEmailActionsSrc = read("admin-app/src/components/BookingEmailActions.tsx");

// Slice a function body by brace counting, anchored on its
// declaration line (the FOL-02 / #11 source-text pattern). The
// admin handlers nest arrow functions, so a naive `};` search
// finds the wrong close.
function sliceFunction(src: string, declaration: string): string {
  const start = src.indexOf(declaration);
  if (start < 0) return "";
  const openIdx = src.indexOf("{", start + declaration.length - 1);
  if (openIdx < 0) return "";
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return src.slice(start, i);
}

describe("RSQ-01 — the desk sees + can re-send a failed reschedule notification", () => {
  describe("BookingEmailActions — the resend panel offers the template", () => {
    it("the panel lists the `booking-rescheduled` action", () => {
      // Without this button the desk cannot re-send a failed
      // "your booking changed" email at all.
      expect(bookingEmailActionsSrc).toMatch(/action:\s*"booking-rescheduled"/);
    });

    it("the button carries a human label", () => {
      expect(bookingEmailActionsSrc).toMatch(
        /action:\s*"booking-rescheduled",\s*label:\s*"Booking Updated"/
      );
    });

    it("the panel still offers the pre-existing templates", () => {
      // A refactor that rewrites the list must not drop the
      // other six resend paths.
      for (const action of [
        "booking-submitted",
        "booking-confirmed",
        "payment-confirmed",
        "checkin-reminder",
        "booking-cancelled",
        "discount-rejected"
      ]) {
        expect(bookingEmailActionsSrc).toMatch(new RegExp(`action:\\s*"${action}"`));
      }
    });
  });

  describe("AdminContext — the reschedule + extend return the email flag", () => {
    it("`rescheduleBooking` declares `emailQueued` on its response data", () => {
      expect(adminContextSrc).toMatch(
        /rescheduleBooking: \([\s\S]*?\) => Promise<\{ success: boolean; error\?: string; data\?: Partial<Booking> & \{ emailQueued\?: boolean \} \}>;/
      );
    });

    it("`extendStayBooking` declares `emailQueued` on its response data", () => {
      expect(adminContextSrc).toMatch(
        /extendStayBooking: \([\s\S]*?\) => Promise<\{ success: boolean; error\?: string; data\?: Partial<Booking> & \{ emailQueued\?: boolean \} \}>;/
      );
    });
  });

  describe("BookingsPage — the move / extend / add-room toasts branch on the flag", () => {
    it("handleMoveSubmit raises a warning when the guest email failed", () => {
      const block = sliceFunction(bookingsPageSrc, "const handleMoveSubmit = async (e: React.FormEvent) => {");
      expect(block.length).toBeGreaterThan(0);
      expect(block).toMatch(/result\.data\?\.emailQueued === false/);
      expect(block).toMatch(/toast\.warning\(/);
      // The happy path is preserved.
      expect(block).toMatch(/toast\.success\("Booking moved"/);
    });

    it("handleExtendSubmit raises a warning when the guest email failed", () => {
      const block = sliceFunction(bookingsPageSrc, "const handleExtendSubmit = async (e: React.FormEvent) => {");
      expect(block.length).toBeGreaterThan(0);
      expect(block).toMatch(/result\.data\?\.emailQueued === false/);
      expect(block).toMatch(/toast\.warning\(/);
      expect(block).toMatch(/toast\.success\("Stay extended"/);
    });

    it("the add-room modal raises a warning when the guest email failed", () => {
      // The add-room modal is an inline `onClick` arrow, not a
      // named handler — anchor on the fetch and read the window
      // that follows it.
      const start = bookingsPageSrc.indexOf("/api/bookings/add-room");
      expect(start).toBeGreaterThan(-1);
      const block = bookingsPageSrc.slice(start, start + 2500);
      expect(block).toMatch(/payload\.data\?\.emailQueued === false/);
      expect(block).toMatch(/toast\.warning\(/);
      expect(block).toMatch(/toast\.success\(\s*"Room added"/);
    });
  });
});
