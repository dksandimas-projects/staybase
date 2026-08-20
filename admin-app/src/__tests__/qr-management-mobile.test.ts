import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Q-03 + #22 / decision #225 (2026-08-19):
// the QR Management page used two browser-API paths that
// Safari iOS blocks — `window.open(...)` for the popup-based
// print, and `<a download>` with a detached `<a>` for the PNG
// download (Safari silently ignores the click unless the
// element is in the DOM). The fix has three parts:
//
//   1. `handleDownloadPng` (`QRManagementPage.tsx:256-308`)
//      splits on iOS user-agent: for iOS it fires
//      `navigator.share` + shows a long-press hint; for
//      desktop it appendChild → click → removeChild around
//      the `<a>` (mirroring the working pattern at
//      `ReportsPage.tsx:3957-3962`).
//   2. `handlePrintRoom` + `handlePrintAll` (`:245-280`)
//      drop the `window.open` popup in favour of `window.print()`
//      on the current page, gated by a `printMode` state that
//      renders a printable card row.
//   3. The `@media print { ... }` block in `admin-app/src/styles.css`
//      scopes `visibility: hidden` to pages that have the
//      printable row in the DOM (uses `:has()` to avoid the
//      pre-#225 risk of hiding every admin page on print).
//   4. `data-testid="qr-download-mobile-fallback"` on the iOS
//      hint banner + `data-testid="qr-print-mode"` on the
//      printable card row give the e2e suite stable locators.

describe("Q-03 + #22 — QR management mobile fallback (decision #225)", () => {
  describe("QRManagementPage.tsx — iOS detection + share path", () => {
    const src = readFileSync(
      resolve(__dirname, "../../src/pages/QRManagementPage.tsx"),
      "utf8"
    );

    // Slice the WHOLE handleDownloadPng function. The pre-#225
    // version had only one `} catch {` so a single regex match
    // was sufficient. The #225 fix added an inner try/catch
    // around `navigator.share`, so we need the FULL function —
    // from the `const handleDownloadPng = async` anchor to the
    // outer `};` close (the assignment's terminator). Use the
    // `= async (` signature + balanced `};` close via
    // counting braces OR a stable anchor: the next
    // `const handlePrint` sibling. Here we use a slash-g
    // anchor + a depth counter.
    function sliceHandleDownloadPng() {
      const idx = src.indexOf("const handleDownloadPng = async");
      if (idx === -1) throw new Error("handleDownloadPng not found");
      // Walk forward, tracking { and } depth (excluding braces
      // inside strings/comments). When we hit a `};` at depth 0
      // after the function body, that's the end.
      let depth = 0;
      let i = idx;
      while (i < src.length) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") {
          depth--;
          if (depth === 0) {
            // Found the matching closing brace of the function
            // expression. Step past it + the `;` to include the
            // full assignment.
            return src.substring(idx, i + 2);
          }
        }
        i++;
      }
      throw new Error("handleDownloadPng never closed");
    }

    it("splits on iOS user-agent before the download click", () => {
      const handleSlice = sliceHandleDownloadPng();
      expect(handleSlice).toMatch(/iPad\|iPhone\|iPod/);
    });

    it("iOS branch calls `navigator.share` (graceful fallback if unavailable)", () => {
      const handleSlice = sliceHandleDownloadPng();
      expect(handleSlice).toMatch(/navigator\.share\s*\(/);
      expect(handleSlice).toMatch(/setIosShareHintRoomId/);
    });

    it("desktop branch uses appendChild → click → removeChild", () => {
      const handleSlice = sliceHandleDownloadPng();
      expect(handleSlice).toMatch(/document\.body\.appendChild\(link\)/);
      expect(handleSlice).toMatch(/link\.click\(\)/);
      expect(handleSlice).toMatch(/document\.body\.removeChild\(link\)/);
    });
  });

  describe("QRManagementPage.tsx — print on current page", () => {
    const src = readFileSync(
      resolve(__dirname, "../../src/pages/QRManagementPage.tsx"),
      "utf8"
    );

    it("handlePrintRoom uses window.print() (no window.open popup)", () => {
      // The pre-#225 `handlePrintRoom` opened a popup window via
      // `openPrintWindow(...)` which Safari iOS blocks. The
      // #225 fix uses `window.print()` on the current page
      // (works on every modern browser) gated by the
      // `printMode` state. Pin BOTH: no more `window.open`
      // and the `window.print()` call IS present.
      const printSlice = src.match(
        /const handlePrintRoom[\s\S]*?\};/
      );
      expect(printSlice).not.toBeNull();
      expect(printSlice![0]).not.toMatch(/window\.open/);
      expect(printSlice![0]).toMatch(/window\.print\(\)/);
    });

    it("handlePrintAll gates on selectedRooms and uses window.print()", () => {
      // Same as above for the multi-room print path.
      const printAllSlice = src.match(
        /const handlePrintAll[\s\S]*?\};/
      );
      expect(printAllSlice).not.toBeNull();
      expect(printAllSlice![0]).toMatch(
        /Select at least one room before printing QR sheets/
      );
      expect(printAllSlice![0]).not.toMatch(/window\.open/);
      expect(printAllSlice![0]).toMatch(/window\.print\(\)/);
    });

    it("renders a print-mode card row when printMode is true", () => {
      // The printable card row carries the
      // `data-testid="qr-print-mode"` e2e hook AND uses Tailwind
      // `print:break-inside-avoid` per card so the print engine
      // doesn't orphan half a card across page boundaries.
      const printBlock = src.match(
        /\{printMode\s*&&\s*\([\s\S]*?\)\s*\}/
      );
      expect(printBlock).not.toBeNull();
      expect(printBlock![0]).toMatch(/data-testid\s*=\s*["']qr-print-mode["']/);
      expect(printBlock![0]).toMatch(/print:break-inside-avoid/);
    });

    it("iOS hint banner carries data-testid=\"qr-download-mobile-fallback\"", () => {
      const hintBlock = src.match(
        /\{iosShareHintRoomId\s*&&\s*\([\s\S]*?\)\s*\}/
      );
      expect(hintBlock).not.toBeNull();
      expect(hintBlock![0]).toMatch(
        /data-testid\s*=\s*["']qr-download-mobile-fallback["']/
      );
    });
  });

  describe("admin-app/src/styles.css — scoped @media print block", () => {
    const styles = readFileSync(
      resolve(__dirname, "../../src/styles.css"),
      "utf8"
    );

    it("print block uses :has() to scope hide-everything-else", () => {
      // The pre-#225 plan was a global
      // `body * { visibility: hidden }` — which would have
      // hidden every admin page on print, not just the QR
      // page. The #225 fix scopes via `:has()` so only pages
      // that have the printable row in the DOM get the
      // visibility scrub. Pin the selector so a refactor
      // that drops `:has()` (and accidentally makes the rule
      // global) is caught at source-text.
      expect(styles).toMatch(
        /@media\s+print[\s\S]*?body:has\(\[data-testid="qr-print-mode"\]\)/m
      );
    });

    it("print block sets the @page size to A4 with 12mm margin", () => {
      // The pre-#225 popup window's print stylesheet used
      // `@page { size: A4; margin: 12mm; }` for an A4 4-up
      // grid. The #225 fix on-current-page stylesheet preserves
      // the same dimension so operators don't see a layout
      // change between the old popup path and the new
      // direct-page path.
      expect(styles).toMatch(
        /@page\s*\{\s*size:\s*A4\s*;?\s*margin:\s*12mm\s*;?\s*\}/
      );
    });
  });
});
