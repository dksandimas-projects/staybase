import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 audit S5.2 — "SettingsPage has no Staff Accounts
// tab." The /api/admin/create-staff and /api/admin/disable-staff routes
// already exist (per AUDIT-6c / decision #6c) and the existing
// guest-app/api/__tests__/admin-staff.test.ts covers the handler
// authorization + Firestore mirror logic. This test guards the *UI* side:
//
//   1. AdminContext exposes a live staff listener (so the tab is reactive).
//   2. AdminContext exposes createStaff + disableStaff that hit the API
//      with a Bearer token (matching the pattern used by other admin
//      authenticated calls like addOnsitePayment / addWalkinBooking).
//   3. SettingsPage renders a "Staff Accounts" tab on the tabs list.
//   4. SettingsPage enforces the admin-only guard on the tab body, matching
//      the SETTINGS.md §4 spec ("Admin-only — front desk cannot see or
//      access this tab").

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

const settingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);

describe("Admin Staff Accounts (audit S5.2)", () => {
  describe("AdminContext — staff listener + methods", () => {
    it("initializes staff as an empty array (replaced by onSnapshot)", () => {
      expect(adminContextSrc).toMatch(
        /const\s+\[staff\s*,\s*setStaff\]\s*=\s*useState<StaffMember\[\]>\(\[\]\)/
      );
    });

    it("subscribes to the guests collection filtered by staff roles", () => {
      expect(adminContextSrc).toMatch(
        /collection\(db\s*,\s*["']guests["']\)/
      );
      expect(adminContextSrc).toMatch(
        /where\(\s*["']role["']\s*,\s*["']in["']\s*,\s*\[\s*["']front-desk["']\s*,\s*["']admin["']\s*\]\s*\)/
      );
    });

    it("wires the staff listener inside useEffect with proper cleanup", () => {
      expect(adminContextSrc).toMatch(
        /useEffect\(\(\)\s*=>\s*\{[\s\S]*?onSnapshot\([\s\S]*?staffRef[\s\S]*?return\s+unsubscribe;\s*\}\s*,\s*\[currentUser\]\)/
      );
    });

    it("exposes createStaff that calls /api/admin/create-staff with Bearer token", () => {
      expect(adminContextSrc).toMatch(
        /const\s+createStaff\s*=\s*async\s*\(/
      );
      // Path may appear inside a template literal: `${base}/api/admin/create-staff`
      expect(adminContextSrc).toMatch(/api\/admin\/create-staff/);
      expect(adminContextSrc).toMatch(
        /getIdToken\(true\)/
      );
      expect(adminContextSrc).toMatch(
        /Authorization["']:\s*token\s*\?\s*`Bearer\s+\$\{token\}`\s*:\s*["']["']/
      );
    });

    it("exposes disableStaff that calls /api/admin/disable-staff with Bearer token", () => {
      expect(adminContextSrc).toMatch(
        /const\s+disableStaff\s*=\s*async\s*\(/
      );
      expect(adminContextSrc).toMatch(/api\/admin\/disable-staff/);
      expect(adminContextSrc).toMatch(
        /JSON\.stringify\(\{\s*uid\s*\}\s*\)/
      );
    });
  });

  describe("SettingsPage — Staff Accounts tab", () => {
    it("includes staff in the TabId union", () => {
      expect(settingsPageSrc).toMatch(
        /type\s+TabId\s*=\s*[^;]*["']staff["']/
      );
    });

    it("adds a Staff Accounts entry to the tabs array with the UserCog icon", () => {
      expect(settingsPageSrc).toMatch(
        /\{\s*id:\s*["']staff["']\s*as\s+const\s*,\s*label:\s*["']Staff Accounts["']\s*,\s*icon:\s*UserCog\s*\}/
      );
    });

    it("renders a Staff Accounts tab panel", () => {
      expect(settingsPageSrc).toMatch(
        /\{\s*activeTab\s*===\s*["']staff["']\s*&&/
      );
    });

    it("guards the tab body on the admin role (admin-only per SETTINGS.md §4)", () => {
      // The tab body should branch on `isAdmin` (which is the boolean
      // computed at the top of the component as `currentUser?.role ===
      // "admin"`). The non-admin branch must show an access-denied message;
      // the admin branch contains the create form + table. We anchor on
      // the start of the staff tab and the next `</Modal>` to bound the
      // slice so the test is not fooled by other tabs.
      const tabStart = settingsPageSrc.indexOf('{activeTab === "staff"');
      expect(tabStart, "expected to find the staff tab block start").toBeGreaterThan(-1);
      const tabEnd = settingsPageSrc.indexOf("</Modal>", tabStart);
      const tabBlock = settingsPageSrc.slice(tabStart, tabEnd > -1 ? tabEnd : undefined);
      expect(tabBlock).toMatch(/isAdmin/);
      expect(tabBlock).toMatch(/Only admin accounts can create or disable staff/);
    });

    it("computes isAdmin from the current user's role (admin guard source)", () => {
      // Companion check: the boolean is computed from the role claim at the
      // top of the component, not hardcoded.
      expect(settingsPageSrc).toMatch(
        /const\s+isAdmin\s*=\s*currentUser\?\.role\s*===\s*["']admin["'];/
      );
    });

    it("renders the create-staff form with required fields and role radios", () => {
      const tabStart = settingsPageSrc.indexOf('{activeTab === "staff"');
      const tabEnd = settingsPageSrc.indexOf("</Modal>", tabStart);
      const tabBlock = settingsPageSrc.slice(tabStart, tabEnd > -1 ? tabEnd : undefined);
      expect(tabBlock).toMatch(/handleCreateStaffSubmit/);
      expect(tabBlock).toMatch(/newStaffName/);
      expect(tabBlock).toMatch(/newStaffEmail/);
      expect(tabBlock).toMatch(/newStaffPassword/);
      expect(tabBlock).toMatch(/name="newStaffRole"/);
      expect(tabBlock).toMatch(/value="front-desk"/);
      expect(tabBlock).toMatch(/value="admin"/);
    });

    it("renders the staff table with role + status badges and a Disable action", () => {
      const tabStart = settingsPageSrc.indexOf('{activeTab === "staff"');
      const tabEnd = settingsPageSrc.indexOf("</Modal>", tabStart);
      const tabBlock = settingsPageSrc.slice(tabStart, tabEnd > -1 ? tabEnd : undefined);
      expect(tabBlock).toMatch(/staff\.map\(/);
      expect(tabBlock).toMatch(/Current Staff \(/);
      expect(tabBlock).toMatch(/openDisableStaffConfirm/);
      expect(tabBlock).toMatch(/You cannot disable your own account/);
    });

    it("renders a confirmation modal for the disable action", () => {
      expect(settingsPageSrc).toMatch(
        /open=\{Boolean\(disablingStaff\)\}/
      );
      expect(settingsPageSrc).toMatch(
        /handleConfirmDisableStaff/
      );
      expect(settingsPageSrc).toMatch(/Disable staff account\?/);
    });
  });
});
