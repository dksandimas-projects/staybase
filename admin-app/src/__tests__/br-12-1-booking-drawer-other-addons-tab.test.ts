// BR-12.1 (Phase 14 — Other Add-Ons admin UI surfaces,
// decision #247 reserved, 2026-10-15): the
// booking-drawer "Other Add-Ons" tab full edit UI
// on `admin-app/src/components/BookingDrawerWorkspace.tsx`.
// Source-text tripwires that pin the implementation
// contracts:
//
//   1. The tab's `BookingDrawerOtherAddOnsTab` is
//      exported and pulls from `useAdmin()` for
//      `staffUpdateOtherAddOns` + `markOtherAddOnServed`.
//   2. The per-day × per-add-on grid mounts
//      (`data-testid="booking-drawer-addons-${date}"` +
//      `data-testid="booking-drawer-addons-row-${date}-${addOnId}"`).
//   3. The save button calls
//      `staffUpdateOtherAddOns({ bookingId, add, change, remove, overrideReason })`.
//   4. The refund-due banner shows when a paid entry
//      is queued for removal.
//   5. The override modal opens when a locked-date op
//      is queued (>=8 char reason required).
//   6. The per-row "Mark served" / "Served" badge
//      mirrors the existing read-only tab.
//   7. The Add row at the bottom of each date surfaces
//      the enabled catalog not already on the day.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const drawer = read("admin-app/src/components/BookingDrawerWorkspace.tsx");
const adminContext = read("admin-app/src/context/AdminContext.tsx");

// Pull the `BookingDrawerOtherAddOnsTab` function so
// the per-function assertions don't false-positive
// against the existing `BookingDrawerBreakfastTab`.
// Also pull the interface declaration just above
// (anchored by the comment header).
const extractTab = (): string => {
  // Anchor on the interface declaration so the props
  // shape is included in the extract.
  const ifaceMatch = drawer.match(/interface BookingDrawerOtherAddOnsTabProps \{/);
  if (!ifaceMatch || ifaceMatch.index === undefined) return "";
  const from = ifaceMatch.index;
  // Read 30,000 chars (covers the helper component
  // `OtherAddOnAddRow` at the bottom too — the file
  // has ~570 lines of UI for the new tab).
  return drawer.slice(from, from + 30000);
};
const tab = extractTab();

describe("BR-12.1 — Booking drawer Other Add-Ons tab (full edit UI)", () => {
  describe("component shape", () => {
    it("the tab is exported as a named function", () => {
      expect(drawer).toMatch(/export function BookingDrawerOtherAddOnsTab\(/);
    });

    it("the tab accepts { booking, onAfterSave } props", () => {
      expect(tab).toMatch(/interface BookingDrawerOtherAddOnsTabProps/);
      expect(tab).toMatch(/booking: Booking/);
      expect(tab).toMatch(/onAfterSave\?: \(\) => void \| Promise<void>/);
    });

    it("the tab destructures staffUpdateOtherAddOns + markOtherAddOnServed from useAdmin()", () => {
      expect(tab).toContain("staffUpdateOtherAddOns");
      expect(tab).toContain("markOtherAddOnServed");
    });
  });

  describe("grid + per-row UI", () => {
    it("per-day section renders with the BR-12.1 testid", () => {
      expect(tab).toContain('data-testid={`booking-drawer-addons-${date}`}');
    });

    it("per-row testid matches the `${date}-${addOnId}` composite key", () => {
      expect(tab).toContain('data-testid={`booking-drawer-addons-row-${key}`}');
    });

    it("the locked-date badge renders for past cutoffs", () => {
      expect(tab).toContain('data-testid={`booking-drawer-addons-locked-${key}`}');
      expect(tab).toContain("Cut-off was");
    });

    it("the per-row 'Mark served' / 'Served' badge is wired", () => {
      expect(tab).toContain('data-testid={`booking-drawer-addons-serve-${key}`}');
      expect(tab).toContain('data-testid={`booking-drawer-addons-served-${key}`}');
    });

    it("the 'Add' row at the bottom of each date filters out already-added add-ons", () => {
      expect(tab).toContain("OtherAddOnAddRow");
      expect(tab).toContain("available = catalog.filter");
    });
  });

  describe("save flow", () => {
    it("the Save changes button writes through staffUpdateOtherAddOns", () => {
      expect(tab).toContain('data-testid="booking-drawer-addons-save"');
      expect(tab).toContain("await staffUpdateOtherAddOns({");
    });

    it("the save payload carries bookingId + add + change + remove + overrideReason", () => {
      expect(tab).toContain("bookingId: booking.id");
      expect(tab).toMatch(/add,\s*change,\s*remove/);
      expect(tab).toContain("overrideReason");
    });

    it("the post-save toast + onAfterSave refresh pattern matches the breakfast tab", () => {
      expect(tab).toContain('toast.success("Saved"');
      expect(tab).toContain("await onAfterSave?.()");
    });
  });

  describe("refund-due banner", () => {
    it("the refund-due banner surfaces the BR-12.1 testid + a positive amount", () => {
      expect(tab).toContain('data-testid="booking-drawer-addons-refund-due"');
      expect(tab).toMatch(/refundDueAmount\s*>\s*0/);
      expect(tab).toContain("Refund due");
    });

    it("the refund-due calc walks `pending` + checks `prior.priceSnapshot * quantity > 0` + `paidAmount > 0`", () => {
      expect(tab).toMatch(/op\.kind\s*!==\s*"remove"/);
      expect(tab).toMatch(/price\s*\*\s*qty\s*>\s*0\s*&&\s*paidAmount\s*>\s*0/);
    });
  });

  describe("override modal", () => {
    it("the override modal opens when a locked-date op is queued", () => {
      expect(tab).toMatch(/perSelectionLocked\[key\]/);
      expect(tab).toContain("setOverrideModal");
    });

    it("the override reason input requires >= 8 chars", () => {
      // The v1 reason min-length is 8 chars (the
      // `addons-staff-update.ts` server enforces
      // `overrideReason.length < 8`); we mirror the
      // same threshold client-side so the modal's
      // Save-with-override button disables on the
      // same edge.
      expect(tab).toMatch(/reason\.trim\(\)\.length\s*<\s*8/);
    });

    it("the override modal's confirm button calls flushSave(overrideReason)", () => {
      expect(tab).toContain('data-testid="booking-drawer-addons-override-confirm"');
      expect(tab).toMatch(/flushSave\(overrideModal\.reason\.trim\(\)\)/);
    });
  });

  describe("admin context (call site)", () => {
    it("the admin-context exposes `staffUpdateOtherAddOns` with the BR-12.1 input shape", () => {
      expect(adminContext).toContain("staffUpdateOtherAddOns: (input:");
      expect(adminContext).toContain("bookingId: string");
      expect(adminContext).toContain("add: Array<");
      expect(adminContext).toContain("change: Array<");
      expect(adminContext).toContain("remove: Array<");
      expect(adminContext).toContain("overrideReason: string | null");
    });

    it("the admin-context exposes `markOtherAddOnServed` with the BR-12.1 input shape", () => {
      expect(adminContext).toContain("markOtherAddOnServed: (input:");
      expect(adminContext).toContain("selectionKey: string");
    });

    it("the staff-update wrapper hits /api/bookings/addons/staff-update with the staff Bearer token", () => {
      expect(adminContext).toContain("/api/bookings/addons/staff-update");
      expect(adminContext).toContain("Bearer ${token}");
    });

    it("the mark-served wrapper hits /api/bookings/addons/mark-served", () => {
      expect(adminContext).toContain("/api/bookings/addons/mark-served");
    });
  });
});
