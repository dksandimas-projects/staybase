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
      expect(bookingsSrc).toMatch(/showUnpaidCheckoutForm/);
    });

    it("uses ConfirmForm for the destructive forms that need a reason", () => {
      expect(bookingsSrc).toMatch(/import\s*\{\s*ConfirmForm\s*\}\s*from\s*["']\.\.\/components\/ConfirmForm["']/);
    });
  });
});
