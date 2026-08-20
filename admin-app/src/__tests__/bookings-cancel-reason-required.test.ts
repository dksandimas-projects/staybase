import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for BK-05 / decision #221 (2026-08-19): every
// cancellation in `admin-app/src/pages/BookingsPage.tsx` (booking
// cancel + 2 store-order cancel dialogs) requires a reason at the
// UI layer (`reasonRequired={true}` + `(required)` label), and
// the server (`guest-app/server/handlers/bookings.ts`
// `handleCancelBooking`) gates staff cancellations with a 400 +
// `CANCELLATION_REASON_REQUIRED` code. Guest cancellations are
// NOT gated here — they go through `guestCancelSchema` in
// `apiRouter.ts` with their own min-length validation.
//
// These are SOURCE-TEXT pins (cheap, deterministic, no Firebase
// emulator needed). The runtime contract — that a server cancel
// without a reason returns the 400 error code — is exercised by
// the existing `guest-app/tests/api/*.test.ts` suite.

describe("BK-05 — Booking cancellation requires a reason (decision #221)", () => {
  const bookingsPage = readFileSync(
    resolve(__dirname, "../../src/pages/BookingsPage.tsx"),
    "utf8"
  );

  describe("admin-app/src/pages/BookingsPage.tsx — UI gates", () => {
    it("passes reasonRequired={true} on the booking-cancel ConfirmForm", () => {
      // The booking-cancel call site lives inside the modal that
      // branches on the MRB-13 cancel scope. Slice from the
      // `selectedBooking.status !== "checked-out"` anchor to the
      // `confirmLabel={` block that follows the reason field.
      const cancelBlock = bookingsPage.match(
        /selectedBooking\.status\s*!==\s*["']checked-out["']\s*&&\s*selectedBooking\.status\s*!==\s*["']cancelled["'][\s\S]*?confirmLabel=\{[\s\S]*?\}\s*\}/
      );
      expect(cancelBlock).not.toBeNull();
      const slice = cancelBlock![0];
      expect(slice).toMatch(/reasonRequired=\{true\}/);
      expect(slice).toMatch(
        /reasonLabel=["']Cancellation\s+reason\s+\(required\)["']/
      );
    });

    it("passes reasonRequired={true} on BOTH store-order cancel ConfirmForms", () => {
      // Two `ConfirmForm` call sites for store orders:
      //   - `selectedOrder.status === "placed"`
      //   - `selectedOrder.status === "confirmed"`
      // Both must require a reason (store cancellations are
      // audit-trail events too — same reasoning as BK-05 booking
      // cancel). Anchored on the "Cancel this order?" title since
      // it's unique to the store-order flow.
      const orderMatches = bookingsPage.match(
        /title=["']Cancel this order\?["'][\s\S]*?onCancel=\{\(\)\s*=>\s*setShowOrderCancelForm\(false\)\s*\}\s*\/\s*>/
      );
      // There are two call sites — repeat the search by stepping
      // through the file.
      const allTitles = bookingsPage.match(
        /title=["']Cancel this order\?["']/g
      );
      expect(allTitles).not.toBeNull();
      expect(allTitles!.length).toBe(2);

      // Walk through the file to find each block and verify.
      let cursor = 0;
      let foundOrderForms = 0;
      while (true) {
        const idx = bookingsPage.indexOf('title="Cancel this order?"', cursor);
        if (idx === -1) break;
        // Capture 2000 chars after the title and look for the
        // reasonRequired within it. (The two call sites differ only
        // in their surrounding `selectedOrder.status === "..."` guard.
        const slice = bookingsPage.substring(idx, idx + 2000);
        if (
          /reasonRequired=\{true\}/.test(slice) &&
          /Cancellation\s+reason\s+\(required\)/.test(slice)
        ) {
          foundOrderForms++;
        }
        cursor = idx + 1;
      }
      expect(foundOrderForms).toBe(2);
    });

    it("does NOT use the old 'Cancellation reason (optional)' string anywhere", () => {
      // The pre-#221 label was `"Cancellation reason (optional)"`.
      // A future refactor that drops the `reasonRequired` prop
      // without updating the label would be caught here.
      expect(bookingsPage).not.toMatch(/Cancellation reason \(optional\)/);
    });
  });

  describe("ConfirmForm.tsx — contract (no client regression)", () => {
    const confirmForm = readFileSync(
      resolve(__dirname, "../../src/components/ConfirmForm.tsx"),
      "utf8"
    );

    it("ConfirmForm still supports reasonRequired (prop + disable logic unchanged)", () => {
      // The component's default `reasonRequired = false` must remain
      // so the existing optional-reason callers (e.g. discount
      // reject) don't accidentally start enforcing it. The disable
      // logic is `!reasonRequired || reason.trim().length > 0`.
      expect(confirmForm).toMatch(
        /reasonRequired\s*=\s*false/
      );
      expect(confirmForm).toMatch(
        /const\s+canConfirm\s*=\s*!reasonRequired\s*\|\|\s*reason\.trim\(\)\.length\s*>\s*0/
      );
    });
  });

  describe("guest-app/server/handlers/bookings.ts — server gate (defense in depth)", () => {
    const bookingsHandler = readFileSync(
      resolve(
        __dirname,
        "../../../guest-app/server/handlers/bookings.ts"
      ),
      "utf8"
    );

    it("handleCancelBooking rejects empty-reason staff cancellations with 400", () => {
      // Sliced from the function signature to the `try` block where
      // the audit-write transaction begins. The slice uses the
      // `} catch (error: any) {` that closes the function as the
      // tail anchor — that anchor is stable across refactors.
      const cancelHandler = bookingsHandler.match(
        /export async function handleCancelBooking\(req: any, res: any\)[\s\S]*?try \{[\s\S]*?\}\s*catch\s*\(/
      );
      expect(cancelHandler).not.toBeNull();
      const slice = cancelHandler![0];
      expect(slice).toMatch(/isStaffCancellation\s*&&/);
      expect(slice).toMatch(
        /return\s+res\.status\(400\)\.json\(\{[\s\S]*?error:\s*["']CANCELLATION_REASON_REQUIRED["']/
      );
    });

    it("does NOT gate GUEST cancellations (lets guestCancelSchema handle it)", () => {
      // The condition is `if (isStaffCancellation && !validReason.trim())`
      // — guests (req.staff absent) pass through unchanged. Pin the
      // `isStaffCancellation` literal so a future refactor that
      // gates ALL cancellations would fail this test.
      expect(bookingsHandler).toMatch(
        /if\s*\(\s*isStaffCancellation\s*&&\s*!validReason\.trim\(\)/
      );
    });
  });
});
