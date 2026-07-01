import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 18 — Wave 3 batch 1 (W3.1,
// W3.2, W3.3, W3.4, W3.5, W3.6). These are UI/UX spec closures; the
// batch ships:
//
//   * W3.1 — SETTINGS.md cross-reference to Rates for payment methods.
//   * W3.2 — Spark Rewards tab is admin-only with an explicit
//     `isAdmin` guard + fallback message for non-admins.
//   * W3.3 — Room types are sourced from settings/hotelConfig.roomTypes
//     (Firestore) instead of localStorage. The save handler writes back.
//   * W3.4 — Reports "Download Full Backup" is admin-gated with a
//     page-level `isAdmin` check.
//   * W3.5 — Reports "Avg. Occupancy" + "Busiest Room Type" replace
//     "Avg. Length of Stay".
//   * W3.6 — AboutPage Brand Promise banner is kept (already shipped).

const settingsMd = readFileSync(
  resolve(__dirname, "../../../plan/features/SETTINGS.md"),
  "utf8"
);
const settingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);
const adminCtxSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);
const reportsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/ReportsPage.tsx"),
  "utf8"
);

describe("Phase 11.6 Batch 18 — Wave 3 batch 1 (settings + reports)", () => {
  describe("W3.1 — Payment methods live in Settings (per decision #108)", () => {
    // Per `DECISIONS-FEATURES.md #108` (Phase 11.7 batch 2 / payment
    // methods feature) booking payment methods moved from the
    // Rates page to a dedicated "Payment Methods" tab in
    // Settings. The old W3.1 cross-reference (payment methods in
    // Rates) was replaced with a self-reference in SETTINGS.md
    // §2 + a "Manage payment methods" deep link in RatesPage.
    it("SETTINGS.md §2 documents the dynamic payment methods UI", () => {
      expect(settingsMd).toMatch(/###\s*2\.\s*Payment Methods[\s\S]{0,200}dynamic CRUD/i);
    });
    it("SETTINGS.md no longer says payment methods are managed in Rates", () => {
      expect(settingsMd).not.toMatch(/Booking payment methods are managed in Rates/i);
    });
    it("SettingsPage renders the dynamic Payment Methods tab body", () => {
      expect(settingsPageSrc).toMatch(/PaymentMethodsTabBody/);
    });
    it("RatesPage no longer renders the Booking Payment Gateways panel", () => {
      const ratesPageSrc = readFileSync(
        resolve(__dirname, "../../../admin-app/src/pages/RatesPage.tsx"),
        "utf8"
      );
      expect(ratesPageSrc).not.toMatch(/Booking Payment Gateways/);
      expect(ratesPageSrc).toMatch(/\/settings\?tab=payment/);
    });
  });

  describe("W3.2 — Spark Rewards tab is admin-only", () => {
    it("the rewards tab JSX is wrapped in an isAdmin ternary", () => {
      const match = settingsPageSrc.match(
        /\{activeTab === ["']rewards["']\s*&&\s*\(\s*\n?\s*isAdmin\s*\?\s*\(/
      );
      expect(match, "expected to find the admin-gated rewards tab").toBeTruthy();
    });

    it("the non-admin branch renders an admin-only notice", () => {
      // Locate the else branch of the rewards tab.
      const elseMatch = settingsPageSrc.match(
        /:\s*\(\s*\n?\s*<div className="rounded-xl border border-amber-200 bg-amber-50[\s\S]*?Admin-only section[\s\S]*?<\/div>\s*\)\s*\)\s*\}/m
      );
      expect(elseMatch, "expected to find the non-admin fallback panel").toBeTruthy();
    });
  });

  describe("W3.3 — Room types come from settings/hotelConfig (Firestore)", () => {
    it("saveRoomTypes writes to settings/hotelConfig (not localStorage)", () => {
      const match = adminCtxSrc.match(
        /const\s+saveRoomTypes\s*=\s*async\s*\([\s\S]*?\}\s*;/
      );
      expect(match, "expected to find saveRoomTypes").toBeTruthy();
      const body = match![0];
      expect(body).toMatch(/updateDoc\(doc\(db,\s*["']settings["'],\s*["']hotelConfig["']\)/);
      expect(body).not.toMatch(/localStorage\.setItem/);
    });

    it("roomTypes useState no longer reads from localStorage", () => {
      expect(adminCtxSrc).not.toMatch(/sim_admin_room_types/);
    });

    it("hotelConfig default state includes roomTypes: [...DEFAULT_ROOM_TYPES]", () => {
      const block = adminCtxSrc.match(
        /const\s+\[hotelConfig,\s*setHotelConfig\]\s*=\s*useState\(\s*\{[\s\S]*?\}\s*\)/
      );
      expect(block).toBeTruthy();
      expect(block![0]).toMatch(/roomTypes:\s*\[\.\.\.DEFAULT_ROOM_TYPES\]/);
    });

    it("a useEffect syncs hotelConfig.roomTypes into local roomTypes state", () => {
      expect(adminCtxSrc).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{[\s\S]*?if\s*\(Array\.isArray\(hotelConfig\.roomTypes\)[\s\S]*?\}\s*,\s*\[hotelConfig\.roomTypes\]\)/);
    });

    it("addRoomType / updateRoomType / deleteRoomType are async (await saveRoomTypes)", () => {
      const addMatch = adminCtxSrc.match(/const\s+addRoomType\s*=\s*async/);
      const updateMatch = adminCtxSrc.match(/const\s+updateRoomType\s*=\s*async/);
      const deleteMatch = adminCtxSrc.match(/const\s+deleteRoomType\s*=\s*async/);
      expect(addMatch).toBeTruthy();
      expect(updateMatch).toBeTruthy();
      expect(deleteMatch).toBeTruthy();
    });
  });

  describe("W3.4 — Reports Download Full Backup is admin-only", () => {
    it("the Backup button is gated on currentUser?.role === 'admin'", () => {
      // Find the JSX that contains the button + the gate.
      const match = reportsPageSrc.match(
        /\{currentUser\?\.role\s*===\s*["']admin["']\s*&&\s*\(\s*[\s\S]*?Download Full Backup[\s\S]*?\}\s*\)\s*\}/
      );
      expect(match, "expected to find the admin-gated Download Full Backup button").toBeTruthy();
    });

    it("handleExportFullBackup bails when currentUser.role is not admin", () => {
      const match = reportsPageSrc.match(
        /const\s+handleExportFullBackup\s*=\s*\(\)\s*=>\s*\{[\s\S]*?\}/
      );
      expect(match, "expected to find handleExportFullBackup").toBeTruthy();
      expect(match![0]).toMatch(/if\s*\(\s*currentUser\?\.role\s*!==\s*["']admin["']\)\s*return/);
    });

    it("handleExportFullBackup exports Bookings + StoreOrders sheets", () => {
      // Walk from the function declaration to the first matching `}` at
      // brace depth 1.
      const start = reportsPageSrc.indexOf("const handleExportFullBackup");
      expect(start, "expected to find handleExportFullBackup").toBeGreaterThanOrEqual(0);
      const slice = reportsPageSrc.slice(start);
      let depth = 0;
      let i = 0;
      let found = false;
      for (; i < slice.length; i++) {
        const ch = slice[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) { found = true; break; }
        }
      }
      const body = slice.slice(0, i + 1);
      expect(found, "expected handleExportFullBackup to close").toBe(true);
      expect(body).toMatch(/XLSX\.utils\.json_to_sheet\(bookingRows\)/);
      expect(body).toMatch(/XLSX\.utils\.book_append_sheet\(wb,\s*bookingSheet,\s*["']Bookings["']\)/);
      expect(body).toMatch(/XLSX\.utils\.book_append_sheet\(wb,\s*orderSheet,\s*["']StoreOrders["']\)/);
    });
  });

  describe("W3.5 — Reports Avg. Occupancy + Busiest Room Type", () => {
    it("the Avg. Length of Stay card is gone", () => {
      // Strip comments to avoid false positives on the migration note.
      const stripped = reportsPageSrc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(stripped).not.toMatch(/Avg\.\s*Length of Stay/);
    });

    it("Avg. Occupancy card renders the percentage + room-nights breakdown", () => {
      // Strip comments to avoid false positives on the migration note.
      const stripped = reportsPageSrc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const match = stripped.match(
        /Avg\.\s*Occupancy[\s\S]{0,1500}?\{totalRoomNights\}\s+room-nights\s*\/\s*\{totalActiveRooms\}\s+rooms\s*×\s*\{daysInRange\}\s+days/
      );
      expect(match, "expected to find the Avg. Occupancy card breakdown").toBeTruthy();
    });

    it("Busiest Room Type card renders the type label + booking count", () => {
      const stripped = reportsPageSrc.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      const match = stripped.match(
        /Busiest Room Type[\s\S]{0,1500}?\{busiestCount\}\s+bookings\s+in this range/
      );
      expect(match, "expected to find the Busiest Room Type card breakdown").toBeTruthy();
    });

    it("avgOccupancyPct = totalRoomNights / (active rooms × days in range)", () => {
      expect(reportsPageSrc).toMatch(
        /totalRoomNights\s*=\s*rangeBookings\.reduce\(\(sum,\s*b\)\s*=>\s*sum\s*\+\s*b\.numNights,\s*0\)/
      );
      expect(reportsPageSrc).toMatch(
        /const\s+possibleRoomNights\s*=\s*totalActiveRooms\s*\*\s*daysInRange/
      );
      expect(reportsPageSrc).toMatch(
        /Math\.round\(\(\s*totalRoomNights\s*\/\s*possibleRoomNights\s*\)\s*\*\s*100\)/
      );
    });

    it("busiestRoomType is computed from the roomType mode of rangeBookings", () => {
      const match = reportsPageSrc.match(
        /const\s+typeCounts\s*=\s*new\s+Map<string,\s*number>\(\);[\s\S]*?busiestRoomType\s*=\s*roomTypes\.find/
      );
      expect(match, "expected to find the busiestRoomType loop").toBeTruthy();
    });
  });

  describe("W3.6 — AboutPage Brand Promise banner is kept", () => {
    it("AboutPage still renders the Brand Promise banner with config.brandPromise", () => {
      // Already shipped in earlier batches; the test just locks it.
      const aboutSrc = readFileSync(
        resolve(__dirname, "../../../guest-app/src/pages/AboutPage.tsx"),
        "utf8"
      );
      expect(aboutSrc).toMatch(/Brand Promise/);
      expect(aboutSrc).toMatch(/config\.brandPromise/);
    });
  });
});
