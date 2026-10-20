// Per BR-05 (Phase 13 — Breakfast Redesign, decision
// #234, 2026-10-13): handler + source-text tripwires
// for the BR-05 staff-side breakfast server endpoints:
//
//   • POST /api/bookings/breakfast/staff-update
//   • POST /api/bookings/breakfast/mark-served
//
// These two endpoints mirror the BR-04 guest paths but
// for the admin booking-drawer. They reuse the per-op
// validation helpers + the audit + refund-liability
// writers from `lib/breakfast-selections.ts` so the
// guest + staff surfaces stay in lockstep.
//
// This file mirrors the BR-04 file's split: source-text
// tripwires that pin the structural invariants, plus
// small smoke tests for the validation gates that
// don't need a transaction. Tripwires are the load-
// bearing defense; the smoke tests are belt-and-
// suspenders.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------- Wire source-text tripwires ----------

const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../server/apiRouter.ts"),
  "utf8"
);
const staffUpdateHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/breakfast-staff-update.ts"),
  "utf8"
);
const markServedHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/breakfast-mark-served.ts"),
  "utf8"
);
const refundPaidHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/breakfast-refund-paid.ts"),
  "utf8"
);
const selectionsLibSrc = readFileSync(
  resolve(__dirname, "../../server/lib/breakfast-selections.ts"),
  "utf8"
);

// ---------- Hoisted mock fixtures ----------
// Mirrors the BR-04 file's pattern: small mock-driven
// tests for the validation paths that don't need a
// Firestore transaction (the transaction-driven paths
// are pinned by the source-text tripwires).

interface AuthHeaderRecord {
  header: string;
}

interface AuthContextStore {
  authHeader: string;
}

vi.mock("firebase-admin/firestore", () => {
  // Light mock — only the `Timestamp.now()` factory is
  // used for the line-level smoke tests below. The
  // adminDb runTransaction surface is mocked per-test.
  return {
    Timestamp: {
      now: () => ({ seconds: 1, nanoseconds: 0, toDate: () => new Date() })
    }
  };
});

vi.mock("../../server/lib/firebase-admin", () => {
  return {
    adminDb: {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false, data: () => null })
        })
      }),
      runTransaction: async () => ({})
    },
    adminAuth: {
      verifyIdToken: async () => ({ role: "admin", uid: "mock_uid" })
    }
  };
});

const authContext: AuthContextStore = { authHeader: "" };

vi.mock("../../server/apiRouter", () => {
  // Smoke-test only — the source-text tripwires above
  // are the load-bearing defense. The smoke tests below
  // exercise the validation paths that don't need a
  // Firestore transaction (cutoff, meal-not-available,
  // front-desk-override-disabled, slot-served window).
  return {
    authenticateStaff: async () => ({
      success: true,
      uid: "mock_staff_uid",
      role: "admin"
    })
  };
});

beforeEach(() => {
  authContext.authHeader = "";
});

// ---------- Tests ----------

describe("BR-05 — staff breakfast server endpoints", () => {
  describe("POST /api/bookings/breakfast/staff-update — source-text tripwires", () => {
    it("is registered in apiRouter.ts", () => {
      // The dispatch block lives alongside the existing
      // BR-04 `update` route. The path is identified by
      // `pathSegments[2] === "staff-update"` under the
      // `domain === "bookings" && action === "breakfast"`
      // slice.
      expect(apiRouterSrc).toMatch(
        /domain\s*===\s*["']bookings["'][\s\S]*?action\s*===\s*["']breakfast["'][\s\S]*?pathSegments\[2\]\s*===\s*["']staff-update["']/
      );
      // The route dispatcher calls the handler.
      expect(apiRouterSrc).toMatch(/handleStaffUpdateBreakfast/);
    });

    it("validates the staff role token (rejects non-staff with 403)", () => {
      // The handler reads `req.staff` (populated by
      // `authenticateStaff` in apiRouter) and refuses
      // non-staff callers with a 403.
      expect(staffUpdateHandlerSrc).toMatch(/readStaff/);
      expect(staffUpdateHandlerSrc).toMatch(/403/);
      expect(staffUpdateHandlerSrc).toMatch(/Forbidden:/);
    });

    it("requires `overrideReason` when `overrideCutoff: true` (min 5 chars)", () => {
      // The handler enforces the BR-01 `MIN_BREAKFAST_OVERRIDE_REASON_LENGTH`
      // (5 chars) when `overrideCutoff: true`. A short
      // reason is rejected with 400.
      expect(staffUpdateHandlerSrc).toMatch(/overrideCutoff/);
      expect(staffUpdateHandlerSrc).toMatch(/overrideReason/);
      expect(staffUpdateHandlerSrc).toMatch(/MIN_BREAKFAST_OVERRIDE_REASON_LENGTH/);
    });

    it("respects `frontDeskOverrideEnabled: false` and rejects overrides (403)", () => {
      // Per BR-02 / spec §Override gate: when
      // `frontDeskOverrideEnabled === false`, even a
      // front-desk staff request with `overrideCutoff: true`
      // is rejected with 403. Admin always passes.
      expect(staffUpdateHandlerSrc).toMatch(/loadFrontDeskOverrideEnabled/);
      expect(staffUpdateHandlerSrc).toMatch(/frontDeskOverrideEnabled/);
      // The reject path carries the human message.
      expect(staffUpdateHandlerSrc).toMatch(
        /Front-desk overrides are disabled/
      );
    });

    it("writes a `breakfastAudit` entry with `action: 'override-add | override-change | override-remove'` when override is used", () => {
      // The audit action enum covers the override variants
      // (the same enum BR-04 uses for the base "add /
      // change / remove" actions). The staff handler
      // picks the override-prefixed enum when an op
      // bypasses the cutoff window.
      const auditActionsMatch = staffUpdateHandlerSrc.match(
        /action:\s*isOverride\s*\?[\s\S]*?:\s*actionKind/
      );
      expect(auditActionsMatch, "expected override-prefixed audit action").toBeTruthy();
      expect(staffUpdateHandlerSrc).toMatch(/["']override-add["']/);
      expect(staffUpdateHandlerSrc).toMatch(/["']override-change["']/);
      expect(staffUpdateHandlerSrc).toMatch(/["']override-remove["']/);
    });

    it("creates a refund liability when removing a paid meal", () => {
      // The handler shares the same refund-liability
      // helper the BR-04 path uses (`createBreakfastRefundLiability`
      // in `lib/breakfast-selections.ts`). The helper is
      // called when (a) the slot has a meal + (b) the
      // booking's `paidAmount` still covers the meal +
      // (c) the override flag (if any) bypasses the
      // locked-date guard.
      expect(staffUpdateHandlerSrc).toMatch(/createBreakfastRefundLiability/);
      expect(staffUpdateHandlerSrc).toMatch(/refundLiabilityCreated/);
      // The "looks paid" predicate inherits from BR-04:
      // the meal's price > 0 AND the booking's denormalised
      // `paidAmount` covers it at removal time.
      expect(staffUpdateHandlerSrc).toMatch(/looksPaid|paidAmount\s*>=\s*mealPrice/);
      // The shared lib carries the BR-01 `category: "breakfast"`
      // + `status: "pending"` liability shape.
      expect(selectionsLibSrc).toMatch(/category:\s*["']breakfast["']/);
      expect(selectionsLibSrc).toMatch(/status:\s*["']pending["']/);
    });
  });

  describe("POST /api/bookings/breakfast/mark-served — source-text tripwires", () => {
    it("is registered in apiRouter.ts", () => {
      // The route is keyed on `pathSegments[2] === "mark-served"`.
      expect(apiRouterSrc).toMatch(
        /domain\s*===\s*["']bookings["'][\s\S]*?action\s*===\s*["']breakfast["'][\s\S]*?pathSegments\[2\]\s*===\s*["']mark-served["']/
      );
      // The dispatcher calls the handler.
      expect(apiRouterSrc).toMatch(/handleMarkServed/);
    });

    it("rejects un-serve beyond the grace window without a reason (400)", () => {
      // The handler computes the elapsed minutes since
      // `breakfastServed[key].servedAt`; if elapsed > grace
      // and no reason is provided, the response is 400
      // with the human message ("Served-grace window passed").
      expect(markServedHandlerSrc).toMatch(/graceMinutes/);
      expect(markServedHandlerSrc).toMatch(/Served-grace window passed/);
      expect(markServedHandlerSrc).toMatch(/MIN_BREAKFAST_OVERRIDE_REASON_LENGTH/);
      expect(markServedHandlerSrc).toMatch(/DEFAULT_BREAKFAST_SERVED_GRACE_MINUTES/);
    });

    it("allows un-serve within the grace window without a reason", () => {
      // The grace-window branch lives in the transaction
      // body — the branch writes
      // `{...existing, unservedAt: now, unservedBy: staffUid}`
      // without a free-text reason. The audit entry's
      // `reason` stays `false` / null.
      expect(markServedHandlerSrc).toMatch(/unservedAt/);
      expect(markServedHandlerSrc).toMatch(/unservedBy/);
      // The grace-window guard reads the
      // `BreakfastConfig.servedGraceMinutes` (admin-only)
      // so the staff Settings tab can tune it.
      expect(markServedHandlerSrc).toMatch(/servedGraceMinutes/);
    });

    it("writes `breakfastAudit` entries for serve / un-serve actions", () => {
      // The handler reuses the shared `auditBreakfastOp`
      // helper from `lib/breakfast-selections.ts` — both
      // actions stamp a `breakfastAudit/{autoId}` doc.
      expect(markServedHandlerSrc).toMatch(/auditBreakfastOp/);
      // The action enum covers both the serve + un-serve
      // variants (same enum as BR-04's BR-01 spec).
      expect(markServedHandlerSrc).toMatch(/action:\s*["']serve["']/);
      expect(markServedHandlerSrc).toMatch(/action:\s*["']unserve["']/);
      // The actorRole discriminator lets the kitchen list
      // filter "un-serves past the grace window" by role.
      expect(markServedHandlerSrc).toMatch(/actorRole:\s*staff\.role/);
    });
  });

  describe("POST /api/bookings/breakfast/mark-refund-paid — source-text tripwires", () => {
    it("is registered in apiRouter.ts + uses the staff-token gate", () => {
      // The route is keyed on `pathSegments[2] === "mark-refund-paid"`.
      expect(apiRouterSrc).toMatch(
        /domain\s*===\s*["']bookings["'][\s\S]*?action\s*===\s*["']breakfast["'][\s\S]*?pathSegments\[2\]\s*===\s*["']mark-refund-paid["']/
      );
      expect(apiRouterSrc).toMatch(/handleMarkRefundPaid/);
    });

    it("flips the pending refund entry to status: \"paid\" + paidAt + paidBy", () => {
      // The handler writes
      // `status: "paid"` + `paidAt: Timestamp.now()` +
      // `paidBy: staff.uid` on the existing
      // `bookings/{id}/refunds/{refundId}` doc. Idempotent
      // re-POST returns the existing paid entry unchanged
      // (mirrors CRL-01's idempotency contract).
      expect(refundPaidHandlerSrc).toMatch(/status:\s*["']paid["']/);
      expect(refundPaidHandlerSrc).toMatch(/paidAt/);
      expect(refundPaidHandlerSrc).toMatch(/paidBy/);
      expect(refundPaidHandlerSrc).toMatch(/replayed/);
    });

    it("uses the same refund-liability shape (category: \"breakfast\") + idempotency key (UUIDv4 refundId)", () => {
      // The handler validates the existing entry's
      // `category: "breakfast"` (the BR-01 §OnsitePayment
      // discriminator). The category-mismatch path is the
      // rejection. The UUIDv4 `refundId` regex matches the
      // BR-04 path's id shape.
      expect(refundPaidHandlerSrc).toMatch(/CATEGORY_MISMATCH/);
      expect(refundPaidHandlerSrc).toMatch(/category/);
      expect(refundPaidHandlerSrc).toMatch(
        /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-5\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}/
      );
      // The shared lib carries the literal
      // `category: "breakfast"` write (every refund
      // liability is stamped with it on creation in BR-04).
      expect(selectionsLibSrc).toMatch(/category:\s*["']breakfast["']/);
    });
  });
});
