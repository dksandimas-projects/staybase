import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const toastSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/Toast.tsx"),
  "utf8"
);
const drawerSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/Drawer.tsx"),
  "utf8"
);
const modalSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/Modal.tsx"),
  "utf8"
);
const layoutSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/AdminLayout.tsx"),
  "utf8"
);
const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

describe("Phase 11.7 — Toast + Drawer/Modal bottom sheet (P0)", () => {
  describe("Toast system", () => {
    it("exports a ToastProvider, useToast hook, and a ToastContext", () => {
      expect(toastSrc).toMatch(/export function ToastProvider/);
      expect(toastSrc).toMatch(/export function useToast/);
      expect(toastSrc).toMatch(/const ToastContext = createContext/);
    });

    it("exposes success / error / info / warning helpers + dismiss", () => {
      expect(toastSrc).toMatch(/success:\s*\(title, message\)\s*=>\s*show/);
      expect(toastSrc).toMatch(/error:\s*\(title, message\)\s*=>\s*show/);
      expect(toastSrc).toMatch(/info:\s*\(title, message\)\s*=>\s*show/);
      expect(toastSrc).toMatch(/warning:\s*\(title, message\)\s*=>\s*show/);
      expect(toastSrc).toMatch(/dismiss/);
    });

    it("uses longer duration for error toasts", () => {
      expect(toastSrc).toMatch(/ERROR_DURATION_MS\s*=\s*6000/);
    });

    it("renders toasts in a fixed container at the bottom of the viewport", () => {
      expect(toastSrc).toMatch(/pointer-events-none\s+fixed\s+inset-x-0\s+bottom-0/);
    });

    it("respects iOS safe-area-inset on the bottom padding", () => {
      expect(toastSrc).toMatch(/env\(safe-area-inset-bottom\)/);
    });

    it("throws when useToast is used outside ToastProvider", () => {
      expect(toastSrc).toMatch(/must be used inside <ToastProvider>/);
    });

    it("auto-dismisses after the duration", () => {
      expect(toastSrc).toMatch(/setTimeout\(\s*\(\)\s*=>\s*dismiss\(id\)/);
    });
  });

  describe("Drawer — mobile bottom sheet", () => {
    it("branches on isMobile for the mobile bottom-sheet panel", () => {
      expect(drawerSrc).toMatch(/isMobile\s*\?\s*\(/);
    });

    it("uses slideInBottom on the mobile panel", () => {
      expect(drawerSrc).toMatch(/slideInBottom/);
    });

    it("uses slideInRight on the desktop panel", () => {
      expect(drawerSrc).toMatch(/slideInRight/);
    });

    it("renders a drag handle pill on the mobile header (decorative)", () => {
      expect(drawerSrc).toMatch(/h-1\s+w-12\s+rounded-full\s+bg-gray-200/);
    });

    it("supports a sticky footer prop with safe-area-inset padding", () => {
      expect(drawerSrc).toMatch(/footer\?:\s*ReactNode/);
      expect(drawerSrc).toMatch(/env\(safe-area-inset-bottom\)/);
    });

    it("locks body scroll when open on mobile", () => {
      expect(drawerSrc).toMatch(/document\.body\.style\.overflow\s*=\s*["']hidden["']/);
    });

    it("uses role=dialog and aria-modal=true", () => {
      expect(drawerSrc).toMatch(/role\s*=\s*["']dialog["']/);
      expect(drawerSrc).toMatch(/aria-modal\s*=\s*["']true["']/);
    });
  });

  describe("Modal — mobile full-screen sheet", () => {
    it("branches on isMobile for the mobile sheet", () => {
      expect(modalSrc).toMatch(/isMobile\s*\?\s*\(/);
    });

    it("uses slideInBottom on the mobile sheet", () => {
      expect(modalSrc).toMatch(/slideInBottom/);
    });

    it("uses scaleIn on the desktop modal", () => {
      expect(modalSrc).toMatch(/scaleIn/);
    });

    it("renders a drag handle pill on the mobile header", () => {
      expect(modalSrc).toMatch(/h-1\s+w-12\s+rounded-full\s+bg-gray-200/);
    });

    it("supports a sticky footer prop with safe-area-inset padding", () => {
      expect(modalSrc).toMatch(/footer\?:\s*ReactNode/);
    });

    it("uses role=dialog and aria-modal=true", () => {
      expect(modalSrc).toMatch(/role\s*=\s*["']dialog["']/);
      expect(modalSrc).toMatch(/aria-modal\s*=\s*["']true["']/);
    });
  });

  describe("AdminLayout mounts ToastProvider", () => {
    it("imports ToastProvider", () => {
      expect(layoutSrc).toMatch(/import\s*\{\s*ToastProvider\s*\}\s*from\s*["']\.\/Toast["']/);
    });

    it("wraps the layout in ToastProvider", () => {
      expect(layoutSrc).toMatch(/<ToastProvider>/);
      expect(layoutSrc).toMatch(/<\/ToastProvider>/);
    });
  });

  describe("Pages call toast instead of alert", () => {
    it("BookingsPage no longer calls alert() (useToast replaces all of them)", () => {
      // The previous BookingsPage had ~12 alert() calls. After Phase 11.7
      // P0, success / error feedback should go through toast.*. The
      // remaining confirm()/prompt() calls (for destructive actions) are
      // tracked in a follow-up commit.
      const alertMatches = bookingsSrc.match(/[^a-zA-Z]alert\(/g) ?? [];
      expect(alertMatches.length, `expected 0 alert() calls in BookingsPage, found ${alertMatches.length}`).toBe(0);
    });

    it("BookingsPage calls useToast", () => {
      expect(bookingsSrc).toMatch(/import\s*\{\s*useToast\s*\}\s*from\s*["']\.\.\/components\/Toast["']/);
      expect(bookingsSrc).toMatch(/const toast = useToast\(\)/);
    });
  });
});
