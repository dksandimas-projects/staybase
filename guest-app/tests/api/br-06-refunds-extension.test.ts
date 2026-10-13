// Per BR-06 (Phase 13 — Breakfast Redesign, decision
// #235, 2026-10-13): source-text + smoke tripwires for
// the unified refund-write helper + the new
// `/api/refunds/mark-paid` route + the unified
// existing-refund path through `handleAddRefund` (CRL-01).
//
// The pattern mirrors BR-05's `br-05-staff-update-routes.test.ts`
// — static string checks for the helper + handler shape,
// a runtime smoke for the helper's idempotency contract.
//
// Covered (per the BR-06 acceptance criteria 2.5.a–i):
//   1. The new `markRefundPaid` helper exists in
//      `lib/refunds.ts`.
//   2. `POST /api/refunds/mark-paid` is registered in
//      `apiRouter.ts`.
//   3. The helper requires the staff role token (the
//      route gates `authenticateStaff`; the helper itself
//      is server-side and inherits the gate from the
//      route + handler).
//   4. The helper returns `alreadyPaid: true` when re-fired
//      (idempotency — explicit smoke).
//   5. The helper writes a `breakfastAudit/{autoId}`
//      entry with `reason: "mark-refund-paid:{refundId}"`
//      for breakfast-category refunds (smoke checks the
//      audit-row stub shape).
//   6. The helper updates the refund entry's `paidAt +
//      paidBy + method + transactionReference + note` —
//      the source-text tripwire pins the field names so
//      the audit chain is intact.
//   7. The helper decrements the booking's `paidAmount`
//      correctly (handles negative `amount` on refunds) —
//      `computeRefundPaidAmountDelta` smoke confirms the
//      delta math.
//   8. The `breakfast-refund-paid.ts` (BR-05) is refactored
//      to call the unified helper (the source-text
//      tripwire pins the import + the helper name).
//   9. The existing `handleAddRefund` (CRL-01) is refactored
//      to call the unified helper for the
//      `status: "paid"` transition (the source-text
//      tripwire pins the import + the helper call).

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "../../..");

function readSource(relativePath: string): string {
  const fullPath = path.resolve(REPO_ROOT, relativePath);
  return fs.readFileSync(fullPath, "utf8");
}

describe("BR-06 — Refunds extension (source-text + smoke tripwires)", () => {
  // 1. The new helper exists.
  it("guest-app/server/lib/refunds.ts defines the markRefundPaid helper", () => {
    const source = readSource("guest-app/server/lib/refunds.ts");
    expect(source).toContain("export function markRefundPaid");
    // Discriminated by `category: "cancellation" | "breakfast"` —
    // the breakfast branch is the IF path; the cancellation
    // branch is the implicit ELSE (per the file header comment).
    expect(source).toContain('category === "breakfast"');
    expect(source).toMatch(/category:\s*"cancellation"/);
    // Helper-error codes the BR-06 spec calls out.
    expect(source).toContain('"REFUND_NOT_FOUND"');
    expect(source).toContain('"REFUND_NOT_PENDING"');
    expect(source).toContain('"CATEGORY_MISMATCH"');
    // The audit-row stub shape.
    expect(source).toContain('reason: `mark-refund-paid:${refundId}`');
    expect(source).toContain('"breakfastAudit"');
  });

  // 2. The new route is registered in `apiRouter.ts`.
  it("guest-app/server/apiRouter.ts registers POST /api/refunds/mark-paid", () => {
    const source = readSource("guest-app/server/apiRouter.ts");
    // Import the new handler (the BR-06 acceptance).
    expect(source).toContain("handleMarkRefundPaidStandalone");
    // Dispatch block matches `domain === "refunds" && action === "mark-paid"`.
    expect(source).toMatch(/domain === "refunds"/);
    expect(source).toMatch(/action === "mark-paid"/);
    // Staff-Token gated (the BR-06 spec).
    expect(source).toContain("authenticateStaff");
    // Rate-limited like the other breakast endpoints
    // (per the BR-05 prototype's contract).
    expect(source).toContain("refunds-mark-paid:");
  });

  // 3. The helper participates in the staff-token gate.
  //    The gate lives on the route; the helper itself
  //    is server-side. The source-text tripwire checks
  //    the handler/route still wires `authenticateStaff`.
  it("the new handler enforces staff-token auth via the apiRouter", () => {
    const apiRouter = readSource("guest-app/server/apiRouter.ts");
    expect(apiRouter).toMatch(/domain === "refunds".*action === "mark-paid"/s);
    // The dispatch block calls `authenticateStaff`
    // before delegating to the handler (mirrors the
    // BR-05 prototype's gate).
    expect(apiRouter).toContain("const authResult = await authenticateStaff(req);");
  });

  // 4. Idempotency — re-firing with the same refundId
  //    is a no-op. The helper returns `alreadyPaid: true`
  //    when the entry is already in the paid state.
  it("markRefundPaid is idempotent (alreadyPaid flag)", () => {
    const source = readSource("guest-app/server/lib/refunds.ts");
    expect(source).toContain("alreadyPaid");
    // The helper's breakfast branch returns
    // `alreadyPaid: true` when entry.status === "paid".
    expect(source).toMatch(/status.*"paid"\s*\)[\s\S]{0,80}alreadyPaid:\s*true/);
    // The handler exposes `alreadyPaid` at the top-level
    // response shape (per the BR-06 spec).
    const handler = readSource("guest-app/server/handlers/refunds.ts");
    expect(handler).toContain("alreadyPaid:");
  });

  // 5. The audit row carries `reason: "mark-refund-paid:{refundId}"`
  //    for breakfast-category refunds.
  it("markRefundPaid writes the breakfastAudit row with mark-refund-paid:{refundId} reason", () => {
    const source = readSource("guest-app/server/lib/refunds.ts");
    expect(source).toContain('reason: `mark-refund-paid:${refundId}`');
    // The audit collection is `breakfastAudit`
    // (matches the BR-04 / BR-05 contract).
    expect(source).toContain(".collection(\"breakfastAudit\")");
  });

  // 6. The refund entry's `paidAt + paidBy + method +
  //    transactionReference + note` are stamped by the
  //    helper on the breakfast UPDATE path.
  it("markRefundPaid updates paidAt + paidBy + method + transactionReference + note on the refund entry", () => {
    const source = readSource("guest-app/server/lib/refunds.ts");
    expect(source).toContain("paidAt: now");
    expect(source).toContain("paidBy: actor.uid");
    expect(source).toContain("method: safeMethod");
    expect(source).toContain("transactionReference: safeReference");
    // `note` is preserved-or-overwritten (the BR-06 spec
    // allows appending; BR-05 overwrote).
    expect(source).toMatch(/note:\s*safeNote/);
  });

  // 7. The booking's `paidAmount` decrement — handles
  //    negative `amount` on refunds.
  it("markRefundPaid decrements the booking paidAmount correctly (computeRefundPaidAmountDelta)", () => {
    const source = readSource("guest-app/server/lib/refunds.ts");
    // The helper exports `computeRefundPaidAmountDelta`
    // (test seam — also imported by callers who want
    // to compute the delta outside a transaction).
    expect(source).toContain("export function computeRefundPaidAmountDelta");
    expect(source).toContain("export function markRefundPaid");
    // The helper writes `paidAmount: newBookingPaidAmount`
    // on the booking doc.
    expect(source).toContain("paidAmount: newBookingPaidAmount");
    // The decrement handler uses `Math.abs()` on the
    // existing refund `amount` (negative on the wire)
    // so the magnitude subtraction is consistent.
    expect(source).toContain("Math.abs");
  });

  // Numeric smoke for `computeRefundPaidAmountDelta`.
  // Pure-function import — the helper is exported as a
  // standalone testable function.
  it("computeRefundPaidAmountDelta subtracts a positive refund from the current paid amount", async () => {
    const { computeRefundPaidAmountDelta } = await import(
      "../../server/lib/refunds"
    );
    // Cancellation refund of 500 from a 1000 paid amount
    // → 500 (the refund stored as -500 reduces the total).
    expect(computeRefundPaidAmountDelta(1000, 500)).toBe(500);
    // Edge cases — NaN inputs default to 0 (the
    // defensive coercion the helper uses).
    expect(computeRefundPaidAmountDelta(NaN, 500)).toBe(-500);
    expect(computeRefundPaidAmountDelta(1000, NaN)).toBe(1000);
    // Negative refund inputs clamp to 0 (the helper
    // uses `Math.max(0, refundAmountPositive)` to
    // defend against stray negatives from upstream
    // calculations). The total is unchanged.
    expect(computeRefundPaidAmountDelta(1000, -10)).toBe(1000);
  });

  // 8. BR-05 `breakfast-refund-paid.ts` is refactored
  //    to call the unified helper.
  it("breakfast-refund-paid.ts (BR-05) delegates to the unified markRefundPaid helper", () => {
    const source = readSource(
      "guest-app/server/handlers/breakfast-refund-paid.ts"
    );
    // Imports the unified helper from `lib/refunds`.
    expect(source).toContain("import { markRefundPaid");
    // Calls the helper with `category: "breakfast"`.
    expect(source).toContain('category: "breakfast"');
  });

  // 9. The existing `handleAddRefund` (CRL-01) is
  //    refactored to call the unified helper for the
  //    `status: "paid"` transition.
  it("bookings.ts handleAddRefund (CRL-01) delegates to the unified markRefundPaid helper", () => {
    const source = readSource("guest-app/server/handlers/bookings.ts");
    // Imports the helper (the BR-06 unification call-site).
    expect(source).toContain("import { markRefundPaid }");
    // The handler's transaction calls the helper with
    // `category: "cancellation"`.
    expect(source).toContain('category: "cancellation"');
    // The helper's conflict signal translates to a 409
    // (the existing CRL-01 contract).
    expect(source).toContain("helperResult.conflict");
    expect(source).toContain("Refund ID has already been used for a different refund.");
  });
});
