import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const toastSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/Toast.tsx"),
  "utf8"
);
const confirmFormSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/ConfirmForm.tsx"),
  "utf8"
);
const twoClickConfirmSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/utils/useTwoClickConfirm.ts"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);
const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

describe("Phase 11.7 — confirm/prompt → inline forms + AdminContext migration (P0)", () => {
  describe("notify.* module-level toast helpers", () => {
    it("exports a notify object with success / error / info / warning", () => {
      expect(toastSrc).toMatch(/export const notify\s*=/);
      expect(toastSrc).toMatch(/success:\s*\(title[^)]*\)\s*=>\s*externalShow/);
      expect(toastSrc).toMatch(/error:\s*\(title[^)]*\)\s*=>\s*externalShow/);
      expect(toastSrc).toMatch(/info:\s*\(title[^)]*\)\s*=>\s*externalShow/);
      expect(toastSrc).toMatch(/warning:\s*\(title[^)]*\)\s*=>\s*externalShow/);
    });

    it("ToastProvider registers the external show ref on mount and clears on unmount", () => {
      expect(toastSrc).toMatch(/externalShow = show/);
      expect(toastSrc).toMatch(/externalShow = null/);
    });
  });

  describe("ConfirmForm component", () => {
    it("exists at admin-app/src/components/ConfirmForm.tsx", () => {
      expect(confirmFormSrc).toMatch(/export function ConfirmForm/);
    });

    it("renders a reason textarea (optional or required)", () => {
      expect(confirmFormSrc).toMatch(/<textarea/);
      expect(confirmFormSrc).toMatch(/reasonLabel/);
      expect(confirmFormSrc).toMatch(/reasonRequired/);
    });

    it("disables the confirm button when reason is required but empty", () => {
      expect(confirmFormSrc).toMatch(/canConfirm\s*=\s*!reasonRequired/);
      expect(confirmFormSrc).toMatch(/disabled=\{!canConfirm\}/);
    });

    it("supports a danger variant for destructive actions", () => {
      expect(confirmFormSrc).toMatch(/variant\?:\s*["']primary["']\s*\|\s*["']danger["']/);
      expect(confirmFormSrc).toMatch(/bg-red-600/);
    });

    it("uses role=alertdialog + aria-label for screen reader announcements", () => {
      expect(confirmFormSrc).toMatch(/role\s*=\s*["']alertdialog["']/);
      expect(confirmFormSrc).toMatch(/aria-label=\{title\}/);
    });
  });

  describe("useTwoClickConfirm hook", () => {
    it("exists at admin-app/src/utils/useTwoClickConfirm.ts", () => {
      expect(twoClickConfirmSrc).toMatch(/export function useTwoClickConfirm/);
    });

    it("returns { pending, arm, cancel, isPending }", () => {
      const returnType = twoClickConfirmSrc.match(/return\s*\{[\s\S]*?\};/);
      expect(returnType).toBeTruthy();
      expect(returnType![0]).toMatch(/pending/);
      expect(returnType![0]).toMatch(/arm/);
      expect(returnType![0]).toMatch(/cancel/);
      expect(returnType![0]).toMatch(/isPending/);
    });

    it("auto-cancels the pending state after a timeout (3s default)", () => {
      expect(twoClickConfirmSrc).toMatch(/setTimeout\(\(\)\s*=>\s*setPending\(null\)/);
      expect(twoClickConfirmSrc).toMatch(/DEFAULT_RESET_MS\s*=\s*3000/);
    });
  });

  describe("AdminContext migrated from alert() to notify.error()", () => {
    it("imports notify from the Toast module", () => {
      expect(adminContextSrc).toMatch(/import\s*\{\s*notify\s*\}\s*from\s*["']\.\.\/components\/Toast["']/);
    });

    it("has zero remaining alert() calls in the context", () => {
      const alertMatches = adminContextSrc.match(/[^a-zA-Z]alert\(/g) ?? [];
      expect(alertMatches.length, `expected 0 alert() in AdminContext, found ${alertMatches.length}`).toBe(0);
    });

    it("uses notify.error in updateBookingStatus, addStoreItem, updateStoreItem, disableStoreItem, and the settings save", () => {
      const notifyErrorCount = (adminContextSrc.match(/notify\.error\(/g) ?? []).length;
      expect(notifyErrorCount, "expected 5 notify.error calls in AdminContext").toBeGreaterThanOrEqual(5);
    });
  });

  describe("BookingsPage no longer uses confirm() or prompt()", () => {
    it("has zero confirm() calls", () => {
      const matches = bookingsSrc.match(/[^a-zA-Z]confirm\(/g) ?? [];
      expect(matches.length, `expected 0 confirm() in BookingsPage, found ${matches.length}`).toBe(0);
    });

    it("has zero prompt() calls", () => {
      const matches = bookingsSrc.match(/[^a-zA-Z]prompt\(/g) ?? [];
      expect(matches.length, `expected 0 prompt() in BookingsPage, found ${matches.length}`).toBe(0);
    });

    it("uses useTwoClickConfirm for destructive confirmations", () => {
      expect(bookingsSrc).toMatch(/const\s+discountApproveConfirm\s*=\s*useTwoClickConfirm/);
      // Per CLS-01 (2026-08-09, decision #208): the
      // check-out confirmation modal was renamed
      // `showUnpaidCheckoutForm` → `showConfirmCheckOut`
      // (the unified check-out modal in the lifecycle
      // transition pattern). The other two lifecycle
      // transitions (Confirm booking, Verify & check
      // in) live in `showConfirmBooking` and
      // `showConfirmCheckIn`. Any of the three flags
      // satisfies the "modal-based confirmation,
      // no window.confirm()" invariant.
      expect(bookingsSrc).toMatch(/showConfirmCheckOut/);
      expect(bookingsSrc).toMatch(/showConfirmCheckIn/);
      expect(bookingsSrc).toMatch(/showConfirmBooking/);
    });

    it("uses ConfirmForm for the destructive forms that need a reason", () => {
      expect(bookingsSrc).toMatch(/import\s*\{\s*ConfirmForm\s*\}\s*from\s*["']\.\.\/components\/ConfirmForm["']/);
    });
  });

  // Per CLS-01 (2026-08-09, decision #208): the three
  // lifecycle transition confirmation modals in the booking
  // drawer (Confirm booking / Verify & check in / Review
  // folio & check out) all use the shared `ConfirmStatusModal`
  // shell instead of firing `handleStatusTransition` directly.
  // The shell owns the focus trap + ESC + backdrop dismiss +
  // mobile bottom-sheet + framer animations (inherited from
  // the existing `<Modal>`), so each call site only has to
  // supply the transition-specific context (children) and a
  // confirm handler.
  describe("CLS-01 — lifecycle transition confirmation modals", () => {
    const confirmStatusModalSrc = readFileSync(
      resolve(__dirname, "../../../admin-app/src/components/ConfirmStatusModal.tsx"),
      "utf8"
    );

    it("imports the shared ConfirmStatusModal shell", () => {
      expect(bookingsSrc).toMatch(
        /import\s*\{\s*ConfirmStatusModal\s*\}\s*from\s*["']\.\.\/components\/ConfirmStatusModal["']/
      );
    });

    it("Confirm booking button opens the confirm modal (no naked transition)", () => {
      // The "Confirm booking" button in `renderBookingPrimaryAction`
      // must call `setShowConfirmBooking(true)`, NOT
      // `handleStatusTransition("confirmed")` directly. The pre-
      // CLS-01 shape was the naked direct call; the regression
      // guard catches a re-introduction.
      const confirmBookingBlock = bookingsSrc.match(
        /selectedBooking\.status\s*===\s*["']payment-confirmed["'][\s\S]{0,1200}?<\/button>/
      );
      expect(confirmBookingBlock, "expected to find the Confirm booking button block").not.toBeNull();
      expect(confirmBookingBlock?.[0]).toMatch(/setShowConfirmBooking\(true\)/);
      expect(confirmBookingBlock?.[0]).not.toMatch(/handleStatusTransition\(\s*["']confirmed["']\s*\)/);
    });

    it("Verify & check-in button opens the confirm modal (no naked transition)", () => {
      const checkInBlock = bookingsSrc.match(
        /selectedBooking\.status\s*===\s*["']confirmed["'][\s\S]{0,1500}?<\/button>/
      );
      expect(checkInBlock, "expected to find the Verify & check-in button block").not.toBeNull();
      expect(checkInBlock?.[0]).toMatch(/setShowConfirmCheckIn\(true\)/);
      expect(checkInBlock?.[0]).not.toMatch(/handleStatusTransition\(\s*["']checked-in["']\s*\)/);
    });

    it("Check-out button always opens the unified modal (no naked zero-balance path)", () => {
      // Pre-CLS-01: the check-out button branched inside its
      // onClick — balance > 0 opened a modal, balance = 0 fired
      // `handleStatusTransition("checked-out")` directly with NO
      // modal at all. Post-CLS-01: the unified modal always opens;
      // the modal body decides whether to render the UCO-02/03
      // reason form inline.
      const checkOutBlock = bookingsSrc.match(
        /selectedBooking\.status\s*===\s*["']checked-in["'][\s\S]{0,2000}?<\/button>/
      );
      expect(checkOutBlock, "expected to find the Review folio & check-out button block").not.toBeNull();
      expect(checkOutBlock?.[0]).toMatch(/setShowConfirmCheckOut\(true\)/);
      expect(checkOutBlock?.[0]).not.toMatch(/handleStatusTransition\(\s*["']checked-out["']\s*\)/);
    });

    it("wires a confirm handler for each of the three lifecycle transitions", () => {
      expect(bookingsSrc).toMatch(/const\s+handleConfirmBooking\s*=\s*async\s*\(/);
      expect(bookingsSrc).toMatch(/const\s+handleConfirmCheckIn\s*=\s*async\s*\(/);
      expect(bookingsSrc).toMatch(/const\s+handleConfirmCheckOut\s*=\s*async\s*\(/);
    });

    it("renders the UCO-02/03 reason form inline inside the unified check-out modal when balance > 0", () => {
      // The reason form must remain reachable when balance > 0 —
      // just rendered as children of the new shell, not in a
      // separate modal. The unified modal is the only
      // `showConfirmCheckOut` mount in the file, so the captured
      // body is the full modal definition (start to the
      // `</ConfirmStatusModal>` close tag).
      const checkOutModalBlock = bookingsSrc.match(
        /open=\{showConfirmCheckOut\}[\s\S]*?<\/ConfirmStatusModal>/
      );
      expect(checkOutModalBlock, "expected to find the unified check-out modal body").not.toBeNull();
      expect(checkOutModalBlock?.[0]).toMatch(/Reason for unpaid checkout/);
      expect(checkOutModalBlock?.[0]).toMatch(/UNPAID_REASON_SHORTCUTS/);
      expect(checkOutModalBlock?.[0]).toMatch(/unpaidCheckoutReason/);
    });

    it("zero-balance check-out does not require a reason", () => {
      // The "Reason for unpaid checkout" field must be hidden
      // when balance = 0; the folio summary is enough. The
      // children body renders the green "Folio fully paid"
      // callout in that branch.
      const checkOutModalBlock = bookingsSrc.match(
        /open=\{showConfirmCheckOut\}[\s\S]*?<\/ConfirmStatusModal>/
      );
      expect(checkOutModalBlock).not.toBeNull();
      expect(checkOutModalBlock?.[0]).toMatch(/Folio fully paid/);
    });

    it("the shared shell wraps the existing Modal so it inherits the focus trap, ESC, backdrop, and mobile bottom-sheet", () => {
      // The shell must NOT re-implement the focus trap or the
      // ESC handler — those live in `<Modal>`. CLS-01 is purely
      // a UI shell that composes `<Modal>`.
      expect(confirmStatusModalSrc).toMatch(/import\s*\{\s*Modal\s*\}\s*from\s*["']\.\/Modal["']/);
      expect(confirmStatusModalSrc).toMatch(/<Modal\b/);
      expect(confirmStatusModalSrc).not.toMatch(/useFocusTrap/);
    });
  });
});
