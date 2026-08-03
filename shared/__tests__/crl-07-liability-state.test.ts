// Per CRL-07 (2026-08-03, per decision #173): characterization
// tests for the liability state machine. The five states +
// the breakdown fields are a single-pass pure function —
// these tests pin the contract so the UI + Reports + the
// destructive cancel handler all agree on the same
// transitions. The helper is in `shared/utils/cancellation.ts`
// (the same module CRL-05/CRL-06 added the policy evaluator +
// the cancel preview to). Importing the type from `shared/types`
// keeps the type contract in lock-step with the runtime.

import { describe, it, expect } from "vitest";
import {
  computeCancellationLiabilityState,
  buildCancellationLiabilitySnapshot
} from "../utils/cancellation";
import type {
  CancellationLiability,
  CancellationPolicyResult
} from "../types";

function makeLiability(overrides: Partial<{
  refundPct: number;
  policyRefund: number;
  netCollected: number;
  retainedAmount: number;
  approvedAmount: number;
  exception: CancellationLiability["exception"];
}> = {}): CancellationLiability {
  const policyResult: CancellationPolicyResult = {
    refundPct: overrides.refundPct ?? 100,
    policyRefund: overrides.policyRefund ?? 5000,
    netCollected: overrides.netCollected ?? 5000,
    retainedAmount: overrides.retainedAmount ?? 0,
    cutoffHours: 48,
    source: "settings",
    snapshottedAt: new Date("2026-08-03T10:00:00.000Z")
  };
  return {
    policyResult,
    approvedAmount: overrides.approvedAmount ?? overrides.policyRefund ?? 5000,
    exception: overrides.exception ?? null
  };
}

describe("CRL-07 — computeCancellationLiabilityState", () => {
  describe("null / undefined liability (pre-CRL-07 fall-through)", () => {
    it("returns not-required when liability is null", () => {
      const out = computeCancellationLiabilityState({ liability: null, processedAmount: 0 });
      expect(out.state).toBe("not-required");
      expect(out.liability).toBeNull();
      expect(out.outstandingAmount).toBe(0);
      expect(out.retentionAmount).toBe(0);
      expect(out.stateLabel).toBe("No refund owed");
    });

    it("returns not-required when liability is undefined", () => {
      const out = computeCancellationLiabilityState({ liability: undefined, processedAmount: 0 });
      expect(out.state).toBe("not-required");
    });

    it("ignores processedAmount when liability is missing (no double-counting)", () => {
      const out = computeCancellationLiabilityState({ liability: null, processedAmount: 5000 });
      expect(out.state).toBe("not-required");
      expect(out.outstandingAmount).toBe(0);
    });
  });

  describe("not-required — policyRefund === 0", () => {
    it("returns not-required when policy refunds nothing", () => {
      const liability = makeLiability({ policyRefund: 0, netCollected: 0, retainedAmount: 0, approvedAmount: 0 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 0 });
      expect(out.state).toBe("not-required");
      expect(out.stateLabel).toBe("No refund owed");
      expect(out.outstandingAmount).toBe(0);
      expect(out.retentionAmount).toBe(0);
    });
  });

  describe("pending-processing — full refund approved, none processed", () => {
    it("returns pending-processing when approved = policy and processed = 0", () => {
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 5000 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 0 });
      expect(out.state).toBe("pending-processing");
      expect(out.stateLabel).toBe("Pending refund");
      expect(out.outstandingAmount).toBe(5000);
      expect(out.retentionAmount).toBe(0);
    });
  });

  describe("partially-processed — some refunded, more pending", () => {
    it("returns partially-processed when 0 < processed < approved", () => {
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 5000 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 2000 });
      expect(out.state).toBe("partially-processed");
      expect(out.stateLabel).toBe("Partially refunded");
      expect(out.outstandingAmount).toBe(3000);
    });

    it("preserves the partial semantics with an exception (reduced approved)", () => {
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 3000 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 1000 });
      // An exception (approved < policy) takes precedence over
      // the partial-processed classification — the state is
      // "retained" because the story is "we're keeping some",
      // not just "we're partway through refunding".
      expect(out.state).toBe("retained");
      expect(out.outstandingAmount).toBe(2000);
      expect(out.retentionAmount).toBe(2000);
    });
  });

  describe("processed — fully refunded", () => {
    it("returns processed when processed >= approved (exact match)", () => {
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 5000 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 5000 });
      expect(out.state).toBe("processed");
      expect(out.stateLabel).toBe("Refunded");
      expect(out.outstandingAmount).toBe(0);
    });

    it("returns processed when processed > approved (over-refund tolerated)", () => {
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 5000 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 5500 });
      expect(out.state).toBe("processed");
      expect(out.outstandingAmount).toBe(0);
    });
  });

  describe("retained — admin applied an exception", () => {
    it("returns retained when approved < policy and nothing processed", () => {
      const liability = makeLiability({
        policyRefund: 5000,
        netCollected: 5000,
        retainedAmount: 2000,
        approvedAmount: 3000
      });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 0 });
      expect(out.state).toBe("retained");
      expect(out.outstandingAmount).toBe(3000);
      expect(out.retentionAmount).toBe(2000);
      expect(out.stateLabel).toBe("Exception applied · refund in progress");
    });

    it("returns retained with fully-refunded label when exception fully paid out", () => {
      const liability = makeLiability({
        policyRefund: 5000,
        approvedAmount: 3000
      });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 3000 });
      expect(out.state).toBe("retained");
      expect(out.stateLabel).toBe("Exception applied · fully refunded");
      expect(out.outstandingAmount).toBe(0);
      expect(out.retentionAmount).toBe(2000);
    });

    it("returns retained with exception audit shape preserved", () => {
      const liability = makeLiability({
        policyRefund: 5000,
        approvedAmount: 2000,
        exception: {
          approvedAmount: 2000,
          reason: "Guest was a no-show on a prior stay",
          approvedBy: "admin-uid-1",
          approvedAt: new Date("2026-08-03T11:00:00.000Z")
        }
      });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 1500 });
      expect(out.state).toBe("retained");
      expect(out.liability?.exception?.reason).toBe("Guest was a no-show on a prior stay");
      expect(out.liability?.exception?.approvedBy).toBe("admin-uid-1");
    });
  });

  describe("defensive coercion — malformed inputs", () => {
    it("clamps negative processedAmount to 0", () => {
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 5000 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: -100 });
      expect(out.processedAmount).toBe(0);
      expect(out.outstandingAmount).toBe(5000);
      expect(out.state).toBe("pending-processing");
    });

    it("clamps the math when stored approvedAmount > policyRefund (writer-bug guard, read-only)", () => {
      // The helper is read-only — the stored `liability.approvedAmount`
      // is preserved (the writer's job to fix). The downstream math
      // (outstandingAmount, state) is clamped so a corrupted snapshot
      // cannot leak a > policy refund into Reports.
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 9999 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 0 });
      expect(out.liability?.approvedAmount).toBe(9999); // original stored value
      expect(out.outstandingAmount).toBe(5000); // clamped to policyRefund
      expect(out.state).toBe("pending-processing");
    });

    it("clamps NaN inputs to 0 (no throw)", () => {
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 5000 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: NaN });
      expect(out.processedAmount).toBe(0);
      expect(out.state).toBe("pending-processing");
    });
  });

  describe("breakdown invariants", () => {
    it("outstandingAmount === approvedAmount - processedAmount (clamped ≥ 0)", () => {
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 5000 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 3500 });
      expect(out.outstandingAmount).toBe(1500);
    });

    it("retentionAmount === policyRefund - approvedAmount (clamped ≥ 0)", () => {
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 3000 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 0 });
      expect(out.retentionAmount).toBe(2000);
    });

    it("retentionAmount is 0 when no exception (approved === policy)", () => {
      const liability = makeLiability({ policyRefund: 5000, approvedAmount: 5000 });
      const out = computeCancellationLiabilityState({ liability, processedAmount: 0 });
      expect(out.retentionAmount).toBe(0);
    });
  });
});

describe("CRL-07 — buildCancellationLiabilitySnapshot", () => {
  const now = new Date("2026-08-03T10:00:00.000Z");

  it("rounds the policy refund / netCollected / retainedAmount to 2dp", () => {
    const snap = buildCancellationLiabilitySnapshot({
      now,
      policyRefund: 1234.5678,
      netCollected: 5555.4321,
      retainedAmount: 4320.8643,
      refundPct: 100,
      cutoffHours: 48,
      source: "settings"
    });
    expect(snap.policyResult.policyRefund).toBe(1234.57);
    expect(snap.policyResult.netCollected).toBe(5555.43);
    expect(snap.policyResult.retainedAmount).toBe(4320.86);
  });

  it("defaults approvedAmount to policyRefund and exception to null", () => {
    const snap = buildCancellationLiabilitySnapshot({
      now,
      policyRefund: 5000,
      netCollected: 5000,
      retainedAmount: 0,
      refundPct: 100,
      cutoffHours: 48,
      source: "settings"
    });
    expect(snap.approvedAmount).toBe(5000);
    expect(snap.exception).toBeNull();
  });

  it("preserves the snapshottedAt timestamp from input.now (no clock skew with cancelledAt)", () => {
    const snap = buildCancellationLiabilitySnapshot({
      now,
      policyRefund: 0,
      netCollected: 0,
      retainedAmount: 0,
      refundPct: 0,
      cutoffHours: 48,
      source: "legacy-fallback"
    });
    expect(snap.policyResult.snapshottedAt).toBe(now);
  });

  it("clamps negative numeric inputs to 0", () => {
    const snap = buildCancellationLiabilitySnapshot({
      now,
      policyRefund: -100,
      netCollected: -50,
      retainedAmount: -25,
      refundPct: -10,
      cutoffHours: -48,
      source: "settings"
    });
    expect(snap.policyResult.policyRefund).toBe(0);
    expect(snap.policyResult.netCollected).toBe(0);
    expect(snap.policyResult.retainedAmount).toBe(0);
    expect(snap.policyResult.refundPct).toBe(0);
    expect(snap.policyResult.cutoffHours).toBe(0);
  });

  it("preserves the policy source discriminator", () => {
    const settingsSnap = buildCancellationLiabilitySnapshot({
      now, policyRefund: 1000, netCollected: 1000, retainedAmount: 0,
      refundPct: 100, cutoffHours: 48, source: "settings"
    });
    const corporateSnap = buildCancellationLiabilitySnapshot({
      now, policyRefund: 1000, netCollected: 1000, retainedAmount: 0,
      refundPct: 100, cutoffHours: 72, source: "corporate-override"
    });
    const legacySnap = buildCancellationLiabilitySnapshot({
      now, policyRefund: 0, netCollected: 0, retainedAmount: 0,
      refundPct: 0, cutoffHours: 48, source: "legacy-fallback"
    });
    expect(settingsSnap.policyResult.source).toBe("settings");
    expect(corporateSnap.policyResult.source).toBe("corporate-override");
    expect(legacySnap.policyResult.source).toBe("legacy-fallback");
  });
});
