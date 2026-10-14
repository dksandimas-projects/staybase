// BR-12.1 (Phase 14 — Other Add-Ons admin UI surfaces,
// decision #247 reserved, 2026-10-15): the new
// "Other Add-Ons" tab CRUD UI on
// `admin-app/src/pages/SettingsPage.tsx`. Source-text
// tripwires that pin the implementation contracts:
//
//   1. The tab + group + whitelist entry are wired
//      (`addons` is a valid TabId, the SETTINGS_GROUPS
//      includes it, the deep-link whitelist accepts it).
//   2. The pre-seed runs once when the catalog is
//      empty (writes AIRPORT_TRANSFER_PRESEED to
//      `addOns/airport-transfer` if the collection is
//      empty).
//   3. The catalog CRUD blocks render: the
//      "Add add-on" button, the per-row enabled
//      toggle, the edit + delete buttons.
//   4. The add/edit modal exposes every spec field
//      (name, description, price, unit, cutoff, display
//      order, enabled).
//   5. The delete confirmation modal shows the
//      "Existing bookings will retain their snapshots"
//      copy.
//   6. The audit-log writer hits `auditLogs/{auditId}`
//      with action ∈ {addons.create, addons.update,
//      addons.delete}, targetCollection: "addOns".

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const settingsPage = read("admin-app/src/pages/SettingsPage.tsx");
const sharedBookingSchema = read("shared/schemas/booking.ts");
const sharedAddOnsUtil = read("shared/utils/addOns.ts");
const adminContext = read("admin-app/src/context/AdminContext.tsx");

// Pull the `activeTab === "addons"` JSX block so the
// per-block assertions don't false-positive against
// other Settings tabs (e.g. the breakfast CRUD).
const extractAddOnsBlock = (): string => {
  const start = settingsPage.match(/\{activeTab === "addons" && \(/);
  if (!start || start.index === undefined) return "";
  let depth = 0;
  let i = start.index;
  while (i < settingsPage.length) {
    const ch = settingsPage[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const close = settingsPage.indexOf(")}", i);
        return close > -1 ? settingsPage.slice(start.index, close + 2) : settingsPage.slice(start.index);
      }
    }
    i++;
  }
  return settingsPage.slice(start.index);
};
const addOnsBlock = extractAddOnsBlock();

// Pull the add/edit modal block by anchoring on the
// `<Modal` opener that follows the addons block.
const extractAddOnEditModal = (): string => {
  const start = settingsPage.indexOf("ADD/EDIT ADD-ON MODAL");
  if (start === -1) return "";
  // Read 12,000 chars (well past the modal's end).
  return settingsPage.slice(start, start + 12000);
};
const addOnEditModal = extractAddOnEditModal();

const extractAddOnDeleteModal = (): string => {
  const start = settingsPage.indexOf("DELETE ADD-ON CONFIRMATION MODAL");
  if (start === -1) return "";
  return settingsPage.slice(start, start + 4000);
};
const addOnDeleteModal = extractAddOnDeleteModal();

// Pull the add-on catalog state hook block by
// anchoring on the comment `4b. Other Add-Ons catalog
// states` and reading 14,000 chars (covers the
// state hooks + the audit-log writer + the
// handleSaveAddOn + handleToggleAddOnEnabled +
// handleConfirmDeleteAddOn handlers).
const extractAddOnsState = (): string => {
  const start = settingsPage.indexOf("4b. Other Add-Ons catalog states");
  if (start === -1) return "";
  return settingsPage.slice(start, start + 14000);
};
const addOnsState = extractAddOnsState();

describe("BR-12.1 — Admin Settings: Other Add-Ons tab", () => {
  describe("wiring (tab + group + whitelist)", () => {
    it("the TabId type union includes 'addons'", () => {
      expect(settingsPage).toMatch(/type TabId = .*"addons"/);
    });

    it("the deep-link VALID_TAB_IDS whitelist accepts 'addons'", () => {
      expect(settingsPage).toMatch(/^\s*"addons"\s*$/m);
    });

    it("the SETTINGS_GROUPS includes the 'addons' tab in the 'Guest Experience' group", () => {
      expect(settingsPage).toMatch(/tabs:\s*\["rewards",\s*"breakfast",\s*"addons",\s*"store",\s*"intercom"\]/);
    });

    it("the activeTab === 'addons' JSX block renders", () => {
      expect(addOnsBlock).toContain("Other Add-Ons");
      expect(addOnsBlock).toContain("data-testid=\"addons-enabled-toggle\"");
      expect(addOnsBlock).toContain("data-testid=\"add-addon-button\"");
    });
  });

  describe("pre-seed", () => {
    it("the pre-seed hooks the AIRPORT_TRANSFER_PRESEED constant", () => {
      expect(addOnsState).toContain("AIRPORT_TRANSFER_PRESEED");
      expect(addOnsState).toContain('"airport-transfer"');
    });

    it("the pre-seed guard checks getDocs(addOns).empty before writing", () => {
      expect(addOnsState).toMatch(/getDocs\(query\(collection\(db, "addOns"\)\)\)/);
      expect(addOnsState).toMatch(/snap\.empty/);
    });
  });

  describe("catalog CRUD blocks", () => {
    it("the catalog table renders the per-row enabled toggle + edit + delete buttons", () => {
      expect(addOnsBlock).toMatch(/addons-toggle-\$\{row\.id\}/);
      expect(addOnsBlock).toMatch(/addons-edit-\$\{row\.id\}/);
      expect(addOnsBlock).toMatch(/addons-delete-\$\{row\.id\}/);
    });

    it("the catalog empty-state shows the 'No add-ons yet' copy", () => {
      expect(addOnsBlock).toContain("No add-ons yet");
    });

    it("the table columns are Name + Price + Unit + Cutoff + Status + Actions", () => {
      expect(addOnsBlock).toContain("Name");
      expect(addOnsBlock).toContain("Price");
      expect(addOnsBlock).toContain("Unit");
      expect(addOnsBlock).toContain("Cutoff");
      expect(addOnsBlock).toContain("Status");
      expect(addOnsBlock).toContain("Actions");
    });
  });

  describe("add/edit modal", () => {
    it("the add/edit modal exposes every required field (name + description + price + unit + cutoff + displayOrder + enabled)", () => {
      expect(addOnEditModal).toContain("data-testid=\"addon-name-input\"");
      expect(addOnEditModal).toContain("data-testid=\"addon-description-input\"");
      expect(addOnEditModal).toContain("data-testid=\"addon-price-input\"");
      expect(addOnEditModal).toContain("data-testid=\"addon-unit-input\"");
      expect(addOnEditModal).toContain("data-testid=\"addon-cutoff-input\"");
      expect(addOnEditModal).toContain("data-testid=\"addon-display-order-input\"");
      expect(addOnEditModal).toContain("data-testid=\"addon-enabled-toggle\"");
    });

    it("the save button calls handleSaveAddOn with the AddOnSchema-validated payload", () => {
      expect(addOnEditModal).toContain("data-testid=\"addon-save-button\"");
      expect(addOnsState).toContain("AddOnSchema.safeParse");
    });

    it("the Zod AddOnSchema + AddOnCatalogAuditLogSchema live in shared", () => {
      expect(sharedBookingSchema).toContain("export const AddOnSchema");
      expect(sharedBookingSchema).toContain("export const AddOnCatalogAuditLogSchema");
      expect(sharedBookingSchema).toContain("addons.create");
      expect(sharedBookingSchema).toContain("addons.update");
      expect(sharedBookingSchema).toContain("addons.delete");
    });
  });

  describe("delete confirmation modal", () => {
    it("the delete confirmation surfaces the 'Existing bookings will retain their snapshots' copy", () => {
      expect(addOnDeleteModal).toContain("Existing bookings with this add-on will retain their snapshots");
      expect(addOnDeleteModal).toContain("data-testid=\"addon-delete-confirm\"");
      expect(addOnDeleteModal).toContain("data-testid=\"addon-delete-confirm-button\"");
    });

    it("the delete handler calls deleteDoc + writeAddOnAuditLog", () => {
      expect(addOnsState).toContain("deleteDoc(doc(db, \"addOns\"");
      expect(addOnsState).toContain('action: "addons.delete"');
    });
  });

  describe("audit log writes", () => {
    it("every CRUD action writes a row to the top-level auditLogs collection with targetCollection: 'addOns'", () => {
      expect(addOnsState).toContain("addDoc(collection(db, \"auditLogs\")");
      expect(addOnsState).toContain("targetCollection: \"addOns\"");
      // The writeAddOnAuditLog helper accepts the
      // three BR-12.1 action enum values — we look
      // for the union type declaration in the file
      // (the call sites pass the action by name).
      expect(settingsPage).toMatch(/"addons\.create"\s*\|\s*"addons\.update"\s*\|\s*"addons\.delete"/);
    });

    it("the delete handler calls writeAddOnAuditLog with action: addons.delete", () => {
      expect(addOnsState).toContain('action: "addons.delete"');
    });

    it("the audit entry persists actor + actorName + before + after", () => {
      expect(addOnsState).toContain("actor: currentUser?.uid");
      expect(addOnsState).toContain("actorName:");
      expect(addOnsState).toContain("before:");
      expect(addOnsState).toContain("after:");
    });
  });

  describe("shared helpers used by the tab", () => {
    it("the shared AddOn + AIRPORT_TRANSFER_PRESEED live in shared/utils/addOns.ts", () => {
      expect(sharedAddOnsUtil).toContain("export const AIRPORT_TRANSFER_PRESEED");
      expect(sharedAddOnsUtil).toContain('name: "Airport transfer"');
      expect(sharedAddOnsUtil).toContain("cutoffHoursBeforeCheckIn: 24");
    });

    it("the admin-context exposes the new staff-update wrappers used by the booking-drawer tab", () => {
      expect(adminContext).toContain("staffUpdateOtherAddOns");
      expect(adminContext).toContain("markOtherAddOnServed");
    });
  });
});
