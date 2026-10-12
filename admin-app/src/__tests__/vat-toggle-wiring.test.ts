import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

// Per VAT-01 (2026-10-12, owner request): the admin Tax (VAT)
// toggle. This source-text test pins the wiring between the
// shared helper layer + the Settings UI + the four product
// surfaces that render the 12% VAT breakdown (Reports + XLSX,
// admin booking drawer, admin print-to-PDF receipt, guest
// `/book` live preview). The test guarantees the toggle is
// consulted consistently — a future surface that adds a VAT
// block without consulting `isVatEnabled(hotelConfig.vatConfig)`
// will fail this test.

const sharedVat = fs.readFileSync(
  path.resolve(__dirname, "../../../shared/utils/bookingVat.ts"),
  "utf8"
);
const sharedIndex = fs.readFileSync(
  path.resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);
const sharedVatTest = fs.readFileSync(
  path.resolve(__dirname, "../../../shared/__tests__/booking-vat.test.ts"),
  "utf8"
);

const adminContext = fs.readFileSync(
  path.resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);
const settingsPage = fs.readFileSync(
  path.resolve(__dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);
const reportsPage = fs.readFileSync(
  path.resolve(__dirname, "../pages/ReportsPage.tsx"),
  "utf8"
);
const bookingsPage = fs.readFileSync(
  path.resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);

const guestPriceBreakdown = fs.readFileSync(
  path.resolve(__dirname, "../../../guest-app/src/components/PriceBreakdown.tsx"),
  "utf8"
);
const guestPublicSiteContent = fs.readFileSync(
  path.resolve(__dirname, "../../../guest-app/src/hooks/usePublicSiteContent.ts"),
  "utf8"
);

describe("VAT-01 — admin Tax (VAT) toggle", () => {
  describe("shared helper layer", () => {
    test("isVatEnabled is the single boolean every surface consults", () => {
      expect(sharedVat).toContain("export function isVatEnabled(");
      // The export routes through `shared/index.ts → ./utils/bookingVat`
      // so the consuming app can `import { isVatEnabled } from "@spark-inn/shared"`.
      expect(sharedIndex).toMatch(/export\s+\*\s+from\s+["']\.\/utils\/bookingVat["']/);
    });

    test("getEffectiveVatRate returns 0.12 / 0 from a VatConfig", () => {
      expect(sharedVat).toContain("export function getEffectiveVatRate(");
      expect(sharedVat).toContain("return 0;");
      expect(sharedVat).toContain("return 0.12;");
    });

    test("normalizeVatConfig is the AdminContext hydration guard", () => {
      // Mirrors `normalizeDiscountScope` / `normalizePaymentHoldWindowHours`:
      // any non-boolean / missing / malformed value falls through to
      // the BIR-compliant default.
      expect(sharedVat).toContain("export function normalizeVatConfig(");
      expect(sharedVat).toContain("return { enabled: false };");
      expect(sharedVat).toContain("return { ...DEFAULT_VAT_CONFIG };");
    });

    test("shared VAT test pins the helper contract (regression guard)", () => {
      // Mirrors the IFH-01.3 / DSC-01..05 contract tests.
      expect(sharedVatTest).toContain("describe(\"isVatEnabled + getEffectiveVatRate (VAT-01");
      expect(sharedVatTest).toContain("describe(\"normalizeVatConfig — AdminContext hydration guard\"");
    });
  });

  describe("admin app — Settings UI + state hydration", () => {
    test("SettingsPage imports the helper from @spark-inn/shared", () => {
      expect(settingsPage).toMatch(/import\s*\{[^}]*\bisVatEnabled\b[^}]*\}\s*from\s+["']@spark-inn\/shared["']/);
    });

    test("SettingsPage carries the Tax (VAT) card on the Discounts tab", () => {
      // Card header (matches the existing Discounts-tab tone —
      // lowercase heading, `text-base font-heading`).
      expect(settingsPage).toContain("Tax (VAT)");
      // The toggle's data-testid lets the operator-facing test suite
      // pin the click → state → save flow.
      expect(settingsPage).toContain('data-testid="vat-toggle"');
      // Save handler persists `{ vatConfig: { enabled: vatEnabled } }`
      // to `settings/hotelConfig` via the existing updateSettings path.
      expect(settingsPage).toContain("handleSaveVat");
      expect(settingsPage).toContain('vatConfig: { enabled: vatEnabled }');
    });

    test("SettingsSaveKey includes \"vat\" so the toast footer uses a distinct save state", () => {
      expect(settingsPage).toMatch(/type\s+SettingsSaveKey\s*=\s*[^;]*\|\s*"vat"/);
    });

    test("AdminContext hydrates + normalizes vatConfig on every settings snapshot", () => {
      // Imports — same path the rest of the hotelConfig hydration uses.
      expect(adminContext).toMatch(/import\s*\{[^}]*\bnormalizeVatConfig\b[^}]*\}\s*from\s+["']@spark-inn\/shared["']/);
      // Initial state — the BIR-compliant default so a stale / missing
      // settings doc renders byte-equivalent to pre-VAT-01 behavior.
      expect(adminContext).toContain("vatConfig: { ...DEFAULT_VAT_CONFIG }");
      // onSnapshot merge — applies the same normalizeVatConfig backfill
      // the other hotelConfig fields use.
      expect(adminContext).toContain("vatConfig: normalizeVatConfig(");
    });
  });

  describe("Reports page — on-screen section + XLSX columns", () => {
    test("Reads vatConfig + computes the effective rate", () => {
      // `useAdmin()` exposes `hotelConfig` to the page (the destructure
      // spans many lines — assert against the per-line markers, not a
      // single regex over the whole block).
      expect(reportsPage).toMatch(/const\s*\{\s*$/m);
      expect(reportsPage).toContain("hotelConfig,");
      expect(reportsPage).toMatch(/^\s*\}\s*=\s*useAdmin\(\);/m);
      // `getEffectiveVatRate` is the single rate consulted — the page
      // never hardcodes 0.12.
      expect(reportsPage).toMatch(/getEffectiveVatRate\(\s*hotelConfig\.vatConfig/);
      // `vatEnabled` is the single boolean every guard below uses.
      expect(reportsPage).toMatch(/const\s+vatEnabled\s*=\s*isVatEnabled\(\s*hotelConfig\.vatConfig/);
    });

    test("On-screen VAT Breakdown section is gated on vatEnabled", () => {
      // The on-screen section is the only place a guest can see the
      // breakdown on the Reports page; when the toggle is OFF, the
      // section must be hidden (replaced by a callout).
      expect(reportsPage).toMatch(/\{vatEnabled\s+&&\s*\(/);
      // A clear callout appears in the OFF state so the operator
      // understands the block is intentionally hidden (not a bug).
      expect(reportsPage).toContain("{!vatEnabled && (");
      expect(reportsPage).toContain("VAT breakdown is disabled for this property");
    });

    test("vatEnabled is plumbed through to the SalesTab sub-component (the on-screen section lives there)", () => {
      // Regression guard — the gated JSX is inside the `SalesTab`
      // sub-component, not the top-level `ReportsPage` body. The
      // boolean must be passed as a prop, otherwise the tsc
      // "Cannot find name 'vatEnabled'" failure from 2026-10-12
      // returns. The prop is declared on the SalesTab interface
      // and passed at the call site.
      expect(reportsPage).toMatch(/function\s+SalesTab\(\s*props:\s*\{[\s\S]*?vatEnabled:\s*boolean/);
      expect(reportsPage).toContain("vatEnabled={vatEnabled}");
    });

    test("XLSX Summary sheet omits the VAT block when the toggle is OFF", () => {
      // The Summary sheet's VAT Breakdown block is gated on vatEnabled.
      expect(reportsPage).toContain("...(vatEnabled");
      expect(reportsPage).toContain("[\"VAT Breakdown (12% Philippine standard)\"");
    });

    test("XLSX Bookings sheet omits the per-booking VAT columns when the toggle is OFF", () => {
      // The per-booking VAT columns are appended conditionally via
      // `vatColumnHeaders` + `vatValues` (spread into the headers +
      // rows arrays). The empty array path keeps the column count
      // consistent.
      expect(reportsPage).toContain("const vatColumnHeaders = vatEnabled");
      expect(reportsPage).toContain("const vatValues = vatEnabled ? [");
      expect(reportsPage).toContain("...vatColumnHeaders,");
      expect(reportsPage).toContain("...vatValues,");
    });
  });

  describe("Bookings page — admin drawer + receipt PDF", () => {
    test("AdminPriceBreakdown accepts a vatEnabled prop and gates the sub-block", () => {
      // The prop is optional with a `= true` default so a future call
      // site that forgets to pass it stays BIR-compliant.
      expect(bookingsPage).toMatch(/function\s+AdminPriceBreakdown\([^)]*vatEnabled\s*=\s*true/);
      // The VAT sub-block (the three muted lines for VATable Sales,
      // VAT-Exempt Sales, VAT Amount) is hidden when the prop is false.
      expect(bookingsPage).toMatch(/\{vatEnabled\s+&&\s*\([\s\S]*?VATable Sales \(VAT-exclusive\)/);
    });

    test("The drawer call site passes vatEnabled from hotelConfig.vatConfig", () => {
      // Single-line grep — the AdminPriceBreakdown call site passes
      // `vatEnabled={isVatEnabled(hotelConfig.vatConfig)}`.
      expect(bookingsPage).toMatch(/vatEnabled=\{isVatEnabled\(hotelConfig\.vatConfig\)\}/);
    });

    test("The admin print-to-PDF receipt skips the VAT section when the toggle is OFF", () => {
      // `printBookingReceiptPDF` reads `hotelConfig` (defined in the
      // same component's `useAdmin()` destructure) and consults
      // `isVatEnabled(hotelConfig.vatConfig)` to gate the entire
      // VAT Breakdown block.
      expect(bookingsPage).toContain("if (isVatEnabled(hotelConfig.vatConfig)) {");
      // The receipt's VAT Breakdown header is rendered inside that gate
      // (the `drawPdfSectionTitle` call is on the line right after the
      // `if` opens).
      expect(bookingsPage).toMatch(/if\s+\(isVatEnabled\(hotelConfig\.vatConfig\)\)\s*\{[\s\S]*?drawPdfSectionTitle\(pdf,\s*"VAT Breakdown/);
    });
  });

  describe("guest app — `/book` live preview (PriceBreakdown + usePublicSiteContent)", () => {
    test("usePublicSiteContent surfaces vatConfig on the public site content", () => {
      // The interface field — the shape the consuming pages read.
      expect(guestPublicSiteContent).toMatch(/vatConfig:\s*VatConfig/);
      // The fallback factories seed the BIR-compliant default so a
      // cold-load window never collapses the live preview to VAT-off.
      expect(guestPublicSiteContent).toContain("vatConfig: { ...DEFAULT_VAT_CONFIG }");
      // The Firestore merge reads `hotelConfig.vatConfig` defensively
      // (missing / malformed falls back to the BIR-compliant default).
      expect(guestPublicSiteContent).toMatch(/const\s+raw\s*=\s*hc\?\.vatConfig/);
    });

    test("PriceBreakdown reads vatConfig via usePublicSiteContent and gates the sub-block", () => {
      // The hook is imported + consulted.
      expect(guestPriceBreakdown).toMatch(/import\s*\{[^}]*\busePublicSiteContent\b[^}]*\}/);
      // The hook is called inside the component body (not the helpers).
      expect(guestPriceBreakdown).toContain("const { vatConfig } = usePublicSiteContent()");
      // The toggle is consulted via the shared `isVatEnabled` helper.
      expect(guestPriceBreakdown).toMatch(/const\s+vatEnabled\s*=\s*isVatEnabled\(\s*vatConfig\s*\)/);
      // The VAT sub-block (the three muted lines) is hidden when off.
      expect(guestPriceBreakdown).toMatch(/\{vatEnabled\s+&&\s*\([\s\S]*?VATable Sales \(VAT-exclusive\)/);
    });
  });
});
