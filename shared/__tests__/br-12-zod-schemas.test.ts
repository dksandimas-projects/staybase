// BR-12 Zod schema tripwires. Pins every new schema's
// required-field + invariant contracts.

import { describe, expect, it } from "vitest";
import {
  AddOnSchema,
  OtherAddOnAuditEntrySchema,
  OtherAddOnMarkRefundPaidSchema,
  OtherAddOnMarkServedSchema,
  OtherAddOnRefundContextSchema,
  OtherAddOnSelectionEntrySchema,
  OtherAddOnUpdateSchema,
  StaffOtherAddOnUpdateSchema
} from "@spark-inn/shared";

describe("BR-12 — AddOnSchema", () => {
  it("accepts the BR-12 pre-seed shape", () => {
    const out = AddOnSchema.safeParse({
      id: "airport-transfer",
      name: "Airport transfer",
      description: "Per-guest one-way",
      price: 500,
      unit: "per-person",
      isEnabled: true,
      cutoffHoursBeforeCheckIn: 24,
      displayOrder: 10,
      updatedAt: "2026-10-14T00:00:00Z",
      updatedBy: "seed"
    });
    expect(out.success).toBe(true);
  });

  it("rejects negative price", () => {
    expect(
      AddOnSchema.safeParse({
        id: "x",
        name: "X",
        description: "",
        price: -1,
        unit: "per-person",
        isEnabled: true,
        cutoffHoursBeforeCheckIn: 24,
        displayOrder: 0
      }).success
    ).toBe(false);
  });

  it("rejects unknown unit (the BR-13 union is reserved)", () => {
    expect(
      AddOnSchema.safeParse({
        id: "x",
        name: "X",
        description: "",
        price: 0,
        unit: "per-room",
        isEnabled: true,
        cutoffHoursBeforeCheckIn: 24,
        displayOrder: 0
      }).success
    ).toBe(false);
  });

  it("clamps cutoffHoursBeforeCheckIn to 0..168", () => {
    expect(
      AddOnSchema.safeParse({
        id: "x",
        name: "X",
        description: "",
        price: 0,
        unit: "per-person",
        isEnabled: true,
        cutoffHoursBeforeCheckIn: 999,
        displayOrder: 0
      }).success
    ).toBe(false);
  });
});

describe("BR-12 — OtherAddOnSelectionEntrySchema", () => {
  it("accepts a live entry", () => {
    const r = OtherAddOnSelectionEntrySchema.safeParse({
      addOnId: "airport-transfer",
      nameSnapshot: "Airport transfer",
      priceSnapshot: 500,
      quantity: 2,
      unitSnapshot: "per-person",
      addedAt: "2026-10-14T00:00:00Z",
      addedBy: "guest",
      lastModifiedAt: "2026-10-14T00:00:00Z",
      lastModifiedBy: "guest",
      removedAt: null,
      removedBy: null,
      cutoffHoursBeforeCheckInSnapshot: 24
    });
    expect(r.success).toBe(true);
  });

  it("rejects quantity > 50 (server safety)", () => {
    expect(
      OtherAddOnSelectionEntrySchema.safeParse({
        addOnId: "x",
        nameSnapshot: "X",
        priceSnapshot: 0,
        quantity: 999,
        unitSnapshot: "per-person",
        addedAt: "x",
        addedBy: "guest",
        lastModifiedAt: "x",
        lastModifiedBy: "guest",
        removedAt: null,
        removedBy: null,
        cutoffHoursBeforeCheckInSnapshot: 24
      }).success
    ).toBe(false);
  });
});

describe("BR-12 — OtherAddOnUpdateSchema (guest manage batch)", () => {
  it("accepts a minimal valid payload", () => {
    const r = OtherAddOnUpdateSchema.safeParse({
      bookingRef: "BK-1234",
      lookupToken: "abcd1234",
      clientBatchId: "batch-1234",
      selections: {
        "2026-12-01": []
      },
      removedKeys: []
    });
    expect(r.success).toBe(true);
  });

  it("rejects malformed date keys in selections", () => {
    expect(
      OtherAddOnUpdateSchema.safeParse({
        bookingRef: "BK-1234",
        lookupToken: "abcd1234",
        clientBatchId: "batch-1234",
        selections: { "garbage": [] },
        removedKeys: []
      }).success
    ).toBe(false);
  });

  it("requires clientBatchId (idempotency token)", () => {
    expect(
      OtherAddOnUpdateSchema.safeParse({
        bookingRef: "BK-1234",
        lookupToken: "abcd1234",
        selections: {},
        removedKeys: []
      }).success
    ).toBe(false);
  });
});

describe("BR-12 — StaffOtherAddOnUpdateSchema", () => {
  it("accepts a valid payload with overrideReason", () => {
    const r = StaffOtherAddOnUpdateSchema.safeParse({
      bookingId: "abc123def456",
      selections: {},
      removedKeys: [],
      overrideReason: "Late arrival per front-desk"
    });
    expect(r.success).toBe(true);
  });

  it("accepts a payload without overrideReason (in-window write)", () => {
    const r = StaffOtherAddOnUpdateSchema.safeParse({
      bookingId: "abc123def456",
      selections: {},
      removedKeys: []
    });
    expect(r.success).toBe(true);
  });
});

describe("BR-12 — OtherAddOnAuditEntrySchema", () => {
  it("accepts an add action", () => {
    const r = OtherAddOnAuditEntrySchema.safeParse({
      action: "add",
      selectionKey: "2026-12-01-airport-transfer",
      addOnSnapshot: { addOnId: "a", name: "A", price: 500, quantity: 2 },
      actorUid: "guest",
      actorRole: "guest",
      reason: null,
      occurredAt: "2026-10-14T00:00:00Z",
      occurredAfterCutoff: false
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown action (the BR-12 enum is closed)", () => {
    expect(
      OtherAddOnAuditEntrySchema.safeParse({
        action: "unknown",
        selectionKey: "2026-12-01-a",
        addOnSnapshot: null,
        actorUid: "guest",
        actorRole: "guest",
        reason: null,
        occurredAt: "x",
        occurredAfterCutoff: false
      }).success
    ).toBe(false);
  });
});

describe("BR-12 — OtherAddOnRefundContextSchema", () => {
  it("accepts a refund-context blob", () => {
    const r = OtherAddOnRefundContextSchema.safeParse({
      addOnId: "a",
      selectionKey: "2026-12-01-a",
      addOnName: "Airport transfer",
      priceSnapshot: 500,
      quantitySnapshot: 2
    });
    expect(r.success).toBe(true);
  });
});

describe("BR-12 — OtherAddOnMarkServedSchema", () => {
  it("accepts a 1-key batch", () => {
    const r = OtherAddOnMarkServedSchema.safeParse({
      bookingId: "abc123def456",
      selectionKeys: ["2026-12-01-airport-transfer"]
    });
    expect(r.success).toBe(true);
  });
  it("rejects empty selectionKeys", () => {
    expect(
      OtherAddOnMarkServedSchema.safeParse({
        bookingId: "abc123def456",
        selectionKeys: []
      }).success
    ).toBe(false);
  });
});

describe("BR-12 — OtherAddOnMarkRefundPaidSchema", () => {
  it("requires a UUIDv4 refundId", () => {
    expect(
      OtherAddOnMarkRefundPaidSchema.safeParse({
        bookingId: "abc123def456",
        refundId: "not-a-uuid",
        method: "cash"
      }).success
    ).toBe(false);
  });

  it("accepts a minimal valid payload", () => {
    const r = OtherAddOnMarkRefundPaidSchema.safeParse({
      bookingId: "abc123def456",
      refundId: "12345678-1234-4231-8234-123456789012",
      method: "cash"
    });
    expect(r.success).toBe(true);
  });
});