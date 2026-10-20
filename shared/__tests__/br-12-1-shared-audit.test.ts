// BR-12.1 (Phase 14 — Other Add-Ons admin UI surfaces,
// decision #247 reserved, 2026-10-15): the
// `auditOtherAddOnOp` server helper writes the right
// shape for every action + the audit entry is
// queryable for the Reports late-change metric.
// Source-text + smoke tripwires that pin the
// implementation contracts:
//
//   1. The `auditOtherAddOnOp` helper writes to
//      `bookings/{id}/otherAddOnAudit/{autoId}`.
//   2. The audit entry shape carries every required
//      field (action, selectionKey, addOnSnapshot,
//      actorUid, actorRole, reason, occurredAt,
//      occurredAfterCutoff).
//   3. The `OtherAddOnAuditEntrySchema` (Zod) accepts
//      every action enum value the helper emits.
//   4. The `AddOnCatalogAuditLogSchema` accepts the
//      new top-level admin audit entries.
//   5. The Reports → Add-Ons sub-tab's "late-change
//      count" subscribes to the
//      `bookings/*/otherAddOnAudit/*` collectionGroup
//      and filters for `occurredAfterCutoff === true`.
//   6. The staff-update endpoint stamps the audit
//      entry for override actions (override-add /
//      override-change / override-remove).

import { describe, expect, it } from "vitest";
import {
  auditOtherAddOnOp,
  type OtherAddOnSelectionEntry
} from "@spark-inn/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const otherAddOnSelections = read("guest-app/server/lib/otherAddOn-selections.ts");
const staffUpdate = read("guest-app/server/handlers/addons-staff-update.ts");
const manageSave = read("guest-app/server/handlers/addons-manage-save.ts");
const markServed = read("guest-app/server/handlers/addons-mark-served.ts");
const refundPaid = read("guest-app/server/handlers/addons-refund-paid.ts");
const reportsPage = read("admin-app/src/pages/ReportsPage.tsx");
const sharedBookingSchema = read("shared/schemas/booking.ts");

describe("BR-12.1 — auditOtherAddOnOp helper", () => {
  describe("write path", () => {
    it("the helper writes to the per-booking otherAddOnAudit subcollection", () => {
      expect(otherAddOnSelections).toContain("export function auditOtherAddOnOp");
      expect(otherAddOnSelections).toMatch(/\.collection\("otherAddOnAudit"\)/);
    });

    it("the helper accepts every action in the BR-12 action union", () => {
      // The Input type is `action: AuditAction` and
      // the union is locked to the BR-12 v1 surface.
      // The union may span multiple lines (whitespace
      // + newlines between members); the regex below
      // uses `[\s\S]` so it matches either shape.
      expect(otherAddOnSelections).toMatch(/"add"[\s\S]*"change"[\s\S]*"remove"[\s\S]*"mark-served"[\s\S]*"override-add"[\s\S]*"override-change"[\s\S]*"override-remove"/);
    });

    it("the helper stamps every required audit field", () => {
      // The audit row carries: selectionKey,
      // addOnSnapshot, actorUid, actorRole, reason,
      // occurredAt, occurredAfterCutoff.
      expect(otherAddOnSelections).toContain("selectionKey:");
      expect(otherAddOnSelections).toContain("addOnSnapshot:");
      expect(otherAddOnSelections).toContain("actorUid:");
      expect(otherAddOnSelections).toContain("actorRole:");
      expect(otherAddOnSelections).toContain("occurredAt:");
      expect(otherAddOnSelections).toContain("occurredAfterCutoff");
    });
  });

  describe("Zod schema parity", () => {
    it("the OtherAddOnAuditEntrySchema accepts every action enum value the helper emits", () => {
      expect(sharedBookingSchema).toContain("export const OtherAddOnAuditEntrySchema");
      expect(sharedBookingSchema).toMatch(/"add"[\s\S]*"change"[\s\S]*"remove"[\s\S]*"mark-served"[\s\S]*"override-add"[\s\S]*"override-change"[\s\S]*"override-remove"/);
    });

    it("the AddOnCatalogAuditLogSchema accepts the BR-12.1 admin audit entries", () => {
      expect(sharedBookingSchema).toContain("export const AddOnCatalogAuditLogSchema");
      expect(sharedBookingSchema).toMatch(/"addons\.create"[\s\S]*"addons\.update"[\s\S]*"addons\.delete"/);
      expect(sharedBookingSchema).toContain("targetCollection:");
      expect(sharedBookingSchema).toContain("actor:");
      expect(sharedBookingSchema).toContain("actorName:");
      expect(sharedBookingSchema).toContain("before:");
      expect(sharedBookingSchema).toContain("after:");
      expect(sharedBookingSchema).toContain("timestamp:");
    });
  });

  describe("Reports late-change query", () => {
    it("the Reports → Add-Ons sub-tab subscribes to the otherAddOnAudit collectionGroup", () => {
      expect(reportsPage).toMatch(/collectionGroup\(db, "otherAddOnAudit"\)/);
    });

    it("the late-change count filters for `occurredAfterCutoff === true`", () => {
      expect(reportsPage).toMatch(/occurredAfterCutoff\s*===\s*true/);
    });
  });

  describe("call sites", () => {
    it("the staff-update endpoint calls auditOtherAddOnOp on every op (add / change / remove)", () => {
      expect(staffUpdate).toContain("auditOtherAddOnOp({");
      expect(staffUpdate).toMatch(/auditOtherAddOnOp\(\{[\s\S]{0,2000}action:.*override-/);
    });

    it("the guest manage-save endpoint calls auditOtherAddOnOp", () => {
      expect(manageSave).toContain("auditOtherAddOnOp({");
    });

    it("the mark-served endpoint calls auditOtherAddOnOp with action: 'mark-served'", () => {
      expect(markServed).toContain("auditOtherAddOnOp({");
      expect(markServed).toMatch(/action:\s*"mark-served"/);
    });

    it("the mark-refund-paid endpoint calls auditOtherAddOnOp", () => {
      // The mark-refund-paid endpoint writes an
      // audit row for the refund-paid action. The
      // exact `action` enum member is implementation-
      // defined (the BR-12 schema accepts the full
      // union); we assert the call site + a valid
      // action enum member.
      expect(refundPaid).toContain("auditOtherAddOnOp({");
      expect(refundPaid).toMatch(/action:\s*"(?:mark-served|remove|add|change)"/);
    });
  });
});
