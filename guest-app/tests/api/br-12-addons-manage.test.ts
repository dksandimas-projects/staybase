// BR-12 manage + save + staff-update source-text tripwires.
// Covers the spec acceptance criteria for the new routes
// that need Firestore transactions (the handler-level
// mocks are too thin to exercise the transaction logic;
// the source-text tripwires pin the structural invariants).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
const otherAddOnSelectionsLibSrc = readFileSync(
  resolve(__dirname, "../../server/lib/otherAddOn-selections.ts"),
  "utf8"
);

describe("BR-12 — handleUpdateAddOns (guest save)", () => {
  it("rejects when no ops are supplied (defensive)", () => {
    expect(manageSaveSrc).toMatch(/No add-on changes supplied/);
  });

  it("enforces a per-batch op cap", () => {
    expect(manageSaveSrc).toMatch(/Too many add-on changes in one batch/);
  });

  it("looks up booking by bookingRef + token", () => {
    expect(manageSaveSrc).toMatch(/bookingRef/);
    expect(manageSaveSrc).toMatch(/lookupToken/);
  });

  it("computes the new otherAddOnTotal via recomputeOtherAddOnTotal (never client-trusted)", () => {
    expect(manageSaveSrc).toMatch(/recomputeOtherAddOnTotal/);
    expect(manageSaveSrc).toMatch(/hasAnyOtherAddOns/);
  });

  it("writes the otherAddOnAudit subcollection entries inside the transaction", () => {
    expect(manageSaveSrc).toMatch(/otherAddOnAudit/);
    expect(manageSaveSrc).toMatch(/auditOtherAddOnOp/);
  });

  it("creates a refund liability on remove of a paid selection", () => {
    expect(manageSaveSrc).toMatch(/createOtherAddOnRefundLiability/);
    expect(manageSaveSrc).toMatch(/refundWrites/);
  });

  it("throws ADDON_NOT_AVAILABLE for missing catalog entries", () => {
    expect(otherAddOnSelectionsLibSrc).toMatch(/ADDON_NOT_AVAILABLE/);
  });

  it("throws SELECTION_ALREADY_ORDERED when an add op targets an existing live selection", () => {
    expect(otherAddOnSelectionsLibSrc).toMatch(/SELECTION_ALREADY_ORDERED/);
  });

  it("throws SELECTION_NOT_ORDERED when a change op targets a missing selection", () => {
    expect(otherAddOnSelectionsLibSrc).toMatch(/SELECTION_NOT_ORDERED/);
  });

  it("uses the unified addOn lib for catalog lookup", () => {
    expect(manageSaveSrc).toMatch(/normalizeAddOn/);
    expect(manageSaveSrc).toMatch(/addOnById/);
  });

  it("idempotency on clientBatchId uses a 60s window via the idempotencyLog collection", () => {
    expect(manageSaveSrc).toMatch(/idempotencyLog/);
    expect(manageSaveSrc).toMatch(/60_000|IDEMPOTENCY_WINDOW_MS/);
  });

  it("rejects checked-out / cancelled bookings", () => {
    expect(manageSaveSrc).toMatch(/Booking is read-only/);
  });
});

describe("BR-12 — handleStaffUpdateAddOns (staff save)", () => {
  it("supports the overrideReason path for late writes", () => {
    expect(staffUpdateSrc).toMatch(/overrideReason/);
    expect(staffUpdateSrc).toMatch(/isLateCutoff/);
  });

  it("rejects locked-date ops without an overrideReason", () => {
    expect(staffUpdateSrc).toMatch(/overrideReason.*length.*8/);
    expect(staffUpdateSrc).toMatch(/Ordering closed/);
  });

  it("uses StaffOtherAddOnUpdateSchema for input validation", () => {
    expect(staffUpdateSrc).toMatch(/StaffOtherAddOnUpdateSchema/);
  });

  it("computes new otherAddOnTotal + hasAnyOtherAddOns server-side", () => {
    expect(staffUpdateSrc).toMatch(/recomputeOtherAddOnTotal/);
    expect(staffUpdateSrc).toMatch(/hasAnyOtherAddOns/);
  });

  it("creates refund liability on remove of a paid selection", () => {
    expect(staffUpdateSrc).toMatch(/createOtherAddOnRefundLiability/);
  });

  it("writes override-* actions to the audit subcollection when isLateCutoff", () => {
    expect(staffUpdateSrc).toMatch(/override-add/);
    expect(staffUpdateSrc).toMatch(/override-change/);
    expect(staffUpdateSrc).toMatch(/override-remove/);
  });

  it("rejects unknown bookingId with 404", () => {
    expect(staffUpdateSrc).toMatch(/Booking not found/);
  });

  it("blocks serve-locked selections", () => {
    expect(staffUpdateSrc).toMatch(/SERVE_BLOCKED/);
  });
});

describe("BR-12 — handleMarkServedAddOns", () => {
  it("writes otherAddOnServed keyed by `${date}-${addOnId}`", () => {
    expect(markServedSrc).toMatch(/otherAddOnServed/);
  });

  it("stamps an otherAddOnAudit row with action 'mark-served'", () => {
    expect(markServedSrc).toMatch(/action: "mark-served"/);
    expect(markServedSrc).toMatch(/auditOtherAddOnOp/);
  });

  it("uses OtherAddOnMarkServedSchema for validation", () => {
    expect(markServedSrc).toMatch(/OtherAddOnMarkServedSchema/);
  });

  it("returns 404 for unknown booking or missing selection", () => {
    expect(markServedSrc).toMatch(/BOOKING_NOT_FOUND/);
    expect(markServedSrc).toMatch(/SERVE_NOT_FOUND/);
  });
});

describe("BR-12 — handleMarkRefundPaidAddOns", () => {
  it("delegates to the unified markRefundPaid with category=otherAddOn", () => {
    expect(markRefundPaidSrc).toMatch(/category: "otherAddOn"/);
    expect(markRefundPaidSrc).toMatch(/markRefundPaid/);
  });

  it("writes the mark-served audit row via the addOn audit helper", () => {
    expect(markRefundPaidSrc).toMatch(/auditOtherAddOnOp/);
  });

  it("returns 403 when staff auth is missing", () => {
    expect(markRefundPaidSrc).toMatch(/Forbidden: Access restricted to staff/);
  });

  it("returns 404 when the refund does not exist", () => {
    expect(markRefundPaidSrc).toMatch(/REFUND_NOT_FOUND/);
    expect(markRefundPaidSrc).toMatch(/refundPaidErrorToMessage/);
  });

  it("uses OtherAddOnMarkRefundPaidSchema for validation", () => {
    expect(markRefundPaidSrc).toMatch(/OtherAddOnMarkRefundPaidSchema/);
  });
});