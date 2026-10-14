// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): handler + source-text tripwires for the new
// other-add-ons routes.
//
// This file splits into source-text tripwires (the
// load-bearing defense — a refactor that drops the
// structural invariants breaks the test) plus a small
// set of handler-level tests for the validation paths
// that don't need Firestore transactions.
//
// The combined tests cover the BR-12 spec acceptance
// criteria for the new routes:
//   1. GET /api/bookings/addons/config returns the
//      enabled add-on catalog (with admin-only fields
//      stripped).
//   2. The public endpoint falls back to the pre-seed
//      "Airport transfer" row when the catalog is empty.
//   3. The apiRouter registers the manage / update /
//      staff-update / mark-served / mark-refund-paid
//      routes under `/api/bookings/addons/*`.
//   4. Each new route is rate-limited at the
//      `apiRouter` layer per BR-12 spec.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routerSrc = readFileSync(
  resolve(__dirname, "../../server/apiRouter.ts"),
  "utf8"
);
const configSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/addons-config.ts"),
  "utf8"
);
const manageSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/addons-manage.ts"),
  "utf8"
);
const manageSaveSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/addons-manage-save.ts"),
  "utf8"
);
const staffUpdateSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/addons-staff-update.ts"),
  "utf8"
);
const markServedSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/addons-mark-served.ts"),
  "utf8"
);
const markRefundPaidSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/addons-refund-paid.ts"),
  "utf8"
);
const sharedIndexSrc = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);
const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);
const otherAddOnCutoffSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/otherAddOnCutoff.ts"),
  "utf8"
);
const otherAddOnTotalSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/otherAddOnTotal.ts"),
  "utf8"
);
const addOnsSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/addOns.ts"),
  "utf8"
);
const sharedSchemasSrc = readFileSync(
  resolve(__dirname, "../../../shared/schemas/booking.ts"),
  "utf8"
);
const refundsLibSrc = readFileSync(
  resolve(__dirname, "../../server/lib/refunds.ts"),
  "utf8"
);

describe("BR-12 — apiRouter wiring (other-add-ons routes)", () => {
  it("registers GET /api/bookings/addons/config", () => {
    expect(routerSrc).toMatch(/handleGetAddOnsConfig/);
    expect(routerSrc).toMatch(/action === "addons"/);
    expect(routerSrc).toMatch(/pathSegments\[2\] === "config"/);
  });

  it("registers GET /api/bookings/addons/manage (lookup-token gated)", () => {
    expect(routerSrc).toMatch(/handleGetAddOnsManage/);
    expect(routerSrc).toMatch(/pathSegments\[2\] === "manage"/);
  });

  it("registers POST /api/bookings/addons/update (guest save, Turnstile-gated)", () => {
    expect(routerSrc).toMatch(/handleUpdateAddOns/);
    expect(routerSrc).toMatch(/pathSegments\[2\] === "update"/);
  });

  it("registers POST /api/bookings/addons/staff-update (staff-token + Turnstile-gated)", () => {
    expect(routerSrc).toMatch(/handleStaffUpdateAddOns/);
    expect(routerSrc).toMatch(/pathSegments\[2\] === "staff-update"/);
    expect(routerSrc).toMatch(/authenticateStaff/);
  });

  it("registers POST /api/bookings/addons/mark-served (staff-token gated)", () => {
    expect(routerSrc).toMatch(/handleMarkServedAddOns/);
    expect(routerSrc).toMatch(/pathSegments\[2\] === "mark-served"/);
  });

  it("registers POST /api/bookings/addons/mark-refund-paid (staff-token gated)", () => {
    expect(routerSrc).toMatch(/handleMarkRefundPaidAddOns/);
    expect(routerSrc).toMatch(/pathSegments\[2\] === "mark-refund-paid"/);
  });

  it("rate-limits each addons route at the apiRouter layer", () => {
    expect(routerSrc).toMatch(/bookings-addons-config/);
    expect(routerSrc).toMatch(/bookings-addons-manage/);
    expect(routerSrc).toMatch(/bookings-addons-update/);
    expect(routerSrc).toMatch(/bookings-addons-staff-update/);
    expect(routerSrc).toMatch(/bookings-addons-mark-served/);
    expect(routerSrc).toMatch(/bookings-addons-mark-refund-paid/);
  });
});

describe("BR-12 — shared export surface", () => {
  it("re-exports otherAddOnCutoff, otherAddOnTotal, addOns from shared index", () => {
    expect(sharedIndexSrc).toMatch(/export \* from "\.\/utils\/otherAddOnCutoff"/);
    expect(sharedIndexSrc).toMatch(/export \* from "\.\/utils\/otherAddOnTotal"/);
    expect(sharedIndexSrc).toMatch(/export \* from "\.\/utils\/addOns"/);
  });
});

describe("BR-12 — types", () => {
  it("defines AddOn, OtherAddOnSelectionEntry, OtherAddOnAuditEntry, OtherAddOnRefundContext", () => {
    expect(sharedTypesSrc).toMatch(/export interface AddOn\b/);
    expect(sharedTypesSrc).toMatch(/export interface OtherAddOnSelectionEntry\b/);
    expect(sharedTypesSrc).toMatch(/export interface OtherAddOnAuditEntry\b/);
    expect(sharedTypesSrc).toMatch(/export interface OtherAddOnRefundContext\b/);
  });

  it("Booking interface carries the additive otherAddOn fields", () => {
    expect(sharedTypesSrc).toMatch(/otherAddOnSelections\?: Record<string, OtherAddOnSelectionEntry\[\]> \| null/);
    expect(sharedTypesSrc).toMatch(/otherAddOnTotal\?: number/);
    expect(sharedTypesSrc).toMatch(/hasAnyOtherAddOns\?: boolean/);
  });
});

describe("BR-12 — shared helpers", () => {
  it("computeOtherAddOnCutoffState returns isLocked + reasonOrCutoff", () => {
    expect(otherAddOnCutoffSrc).toMatch(/function computeOtherAddOnCutoffState/);
    expect(otherAddOnCutoffSrc).toMatch(/reasonOrCutoff/);
    expect(otherAddOnCutoffSrc).toMatch(/addons-disabled/);
    expect(otherAddOnCutoffSrc).toMatch(/cutoff-passed/);
  });

  it("recomputeOtherAddOnTotal + breakdown + hasAnyOtherAddOns exported", () => {
    expect(otherAddOnTotalSrc).toMatch(/function recomputeOtherAddOnTotal/);
    expect(otherAddOnTotalSrc).toMatch(/function otherAddOnBreakdownByDate/);
    expect(otherAddOnTotalSrc).toMatch(/function hasAnyOtherAddOns/);
  });

  it("normalizeAddOn + AIRPORT_TRANSFER_PRESEED exported", () => {
    expect(addOnsSrc).toMatch(/AIRPORT_TRANSFER_PRESEED/);
    expect(addOnsSrc).toMatch(/export function normalizeAddOn/);
    expect(addOnsSrc).toMatch(/export function getEnabledAddOnsByHotel/);
  });
});

describe("BR-12 — Zod schemas", () => {
  it("AddOnSchema + OtherAddOnSelectionEntrySchema + OtherAddOnUpdateSchema + StaffOtherAddOnUpdateSchema exported", () => {
    expect(sharedSchemasSrc).toMatch(/AddOnSchema = z/);
    expect(sharedSchemasSrc).toMatch(/OtherAddOnSelectionEntrySchema = z/);
    expect(sharedSchemasSrc).toMatch(/OtherAddOnUpdateSchema = z/);
    expect(sharedSchemasSrc).toMatch(/StaffOtherAddOnUpdateSchema = z/);
    expect(sharedSchemasSrc).toMatch(/OtherAddOnMarkServedSchema = z/);
    expect(sharedSchemasSrc).toMatch(/OtherAddOnMarkRefundPaidSchema = z/);
  });
});

describe("BR-12 — handlers (source-text tripwires)", () => {
  it("handleGetAddOnsConfig falls back to the pre-seed when addOns collection is empty", () => {
    expect(configSrc).toMatch(/AIRPORT_TRANSFER_PRESEED/);
    expect(configSrc).toMatch(/getEnabledAddOnsByHotel/);
  });

  it("handleGetAddOnsManage returns dateLockByAddOn + otherAddOnSelections + otherAddOnServed", () => {
    expect(manageSrc).toMatch(/dateLockByAddOn/);
    expect(manageSrc).toMatch(/otherAddOnSelections/);
    expect(manageSrc).toMatch(/otherAddOnServed/);
  });

  it("handleUpdateAddOns uses clientBatchId idempotency + recomputeOtherAddOnTotal", () => {
    expect(manageSaveSrc).toMatch(/clientBatchId/);
    expect(manageSaveSrc).toMatch(/IDEMPOTENCY_WINDOW_MS/);
    expect(manageSaveSrc).toMatch(/recomputeOtherAddOnTotal/);
    expect(manageSaveSrc).toMatch(/hasAnyOtherAddOns/);
  });

  it("handleUpdateAddOns writes otherAddOnAudit subcollection entries", () => {
    expect(manageSaveSrc).toMatch(/otherAddOnAudit/);
    expect(manageSaveSrc).toMatch(/auditOtherAddOnOp/);
  });

  it("handleUpdateAddOns creates a refund liability with category=otherAddOn", () => {
    expect(manageSaveSrc).toMatch(/createOtherAddOnRefundLiability/);
    expect(manageSaveSrc).toMatch(/category.*otherAddOn|"otherAddOn"/);
  });

  it("handleStaffUpdateAddOns supports the overrideReason path for late writes", () => {
    expect(staffUpdateSrc).toMatch(/overrideReason/);
    expect(staffUpdateSrc).toMatch(/isLateCutoff/);
    expect(staffUpdateSrc).toMatch(/override-add|override-change|override-remove/);
  });

  it("handleMarkServedAddOns writes to otherAddOnServed map + otherAddOnAudit", () => {
    expect(markServedSrc).toMatch(/otherAddOnServed/);
    expect(markServedSrc).toMatch(/auditOtherAddOnOp/);
    expect(markServedSrc).toMatch(/action: "mark-served"/);
  });

  it("handleMarkRefundPaidAddOns delegates to unified markRefundPaid with category=otherAddOn", () => {
    expect(markRefundPaidSrc).toMatch(/category: "otherAddOn"/);
    expect(markRefundPaidSrc).toMatch(/markRefundPaid/);
    expect(markRefundPaidSrc).toMatch(/auditOtherAddOnOp/);
  });
});

describe("BR-12 — refunds helper extension", () => {
  it("RefundCategory union gained the 'otherAddOn' discriminator", () => {
    expect(refundsLibSrc).toMatch(/export type RefundCategory = "cancellation" \| "breakfast" \| "otherAddOn"/);
  });

  it("markRefundPaid handles category === 'otherAddOn' (UPDATE existing pending entry path)", () => {
    expect(refundsLibSrc).toMatch(/category === "breakfast" \|\| category === "otherAddOn"/);
  });

  it("markRefundPaid writes to otherAddOnAudit subcollection for the newAddOn path", () => {
    expect(refundsLibSrc).toMatch(/otherAddOnAudit/);
  });
});

describe("BR-12 — handler-level: handleGetAddOnsConfig pre-seed fallback", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns the AIRPORT_TRANSFER_PRESEED row when the catalog is empty", async () => {
    vi.doMock("../../server/lib/firebase-admin", () => ({
      adminDb: {
            collection: () => ({
              get: async () => ({ docs: [] })
            })
          }
    }));
    const { handleGetAddOnsConfig } = await import("../../server/handlers/addons-config");
    const req: any = { method: "GET" };
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res: any = { status, setHeader: vi.fn() };
    await handleGetAddOnsConfig(req, res);
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", expect.any(String));
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        preSeeded: true,
        addOns: expect.arrayContaining([
          expect.objectContaining({ id: "airport-transfer", name: "Airport transfer" })
        ])
      })
    );
  });

  it("returns 405 on non-GET", async () => {
    const { handleGetAddOnsConfig } = await import("../../server/handlers/addons-config");
    const req: any = { method: "POST" };
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res: any = { status, setHeader: vi.fn() };
    await handleGetAddOnsConfig(req, res);
    expect(status).toHaveBeenCalledWith(405);
  });
});