// Per AI-BROWSER-QA (2026-10-25, XCC-05): a payment-proof rejection must
// email the guest EXACTLY ONCE.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// The route decided whether to email the guest from a PRE-READ of the
// booking's status:
//
//   const wasEligible = preRejectSnapshot?.status === "payment-uploaded";
//   const result = await handleRejectPayment(req, res);
//   if (wasEligible) { await sendBookingTrigger("payment-rejected", …) }
//
// That is a read-then-write race. The pre-read happens BEFORE the
// handler's transaction, so two rejections of the same proof (or a retry
// after a dropped response) both read `payment-uploaded` — and the losing
// call still emailed the guest, even though the handler had already
// refused it (its transaction re-read the doc and saw `pending`).
//
// The provider's log caught it: TWO "payment proof rejected" emails for
// SI-20261021-00046, 1.25 s apart, for ONE rejection.
//
// THE FIX
// -------
// The side effects moved INTO the handler, gated on the transition flag
// the transaction itself computes (`transitioned`, read inside the
// transaction, so it is the committed truth).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const routerSrc = readFileSync(resolve(repoRoot, "guest-app/server/apiRouter.ts"), "utf8");
const handlerSrc = readFileSync(resolve(repoRoot, "guest-app/server/handlers/bookings.ts"), "utf8");

describe("XCC-05 — the rejection email fires once, from the transaction's own truth", () => {
  it("the route no longer decides from a pre-read of the status", () => {
    expect(routerSrc).not.toMatch(/wasEligible/);
    expect(routerSrc).not.toMatch(/preRejectSnapshot/);
  });

  it("the route returns the handler's result directly", () => {
    const route = routerSrc.slice(
      routerSrc.indexOf('action === "reject-payment"'),
      routerSrc.indexOf('action === "reject-payment"') + 3000
    );
    expect(route).toMatch(/return await handleRejectPayment\(req, res\)/);
    expect(route).not.toMatch(/sendBookingTrigger\("payment-rejected"/);
  });

  it("the handler owns the email and the notification", () => {
    const handler = handlerSrc.slice(
      handlerSrc.indexOf("export async function handleRejectPayment"),
      handlerSrc.indexOf("export async function handleRejectPayment") + 30000
    );
    expect(handler).toMatch(/sendBookingTrigger\("payment-rejected"/);
    expect(handler).toMatch(/writeNotification\(/);
  });

  it("the side effects are gated on the transaction's transition flag", () => {
    const handler = handlerSrc.slice(
      handlerSrc.indexOf("export async function handleRejectPayment"),
      handlerSrc.indexOf("export async function handleRejectPayment") + 30000
    );
    expect(handler).toMatch(/if \(transitioned \|\| siblingRejectedCount > 0\)/);
    // The flag is read INSIDE the transaction, from the same read that
    // decides the flip.
    expect(handler).toMatch(/transitioned = isTargetInPaymentUploaded/);
  });

  it("the handler reports the transition to its caller", () => {
    const handler = handlerSrc.slice(
      handlerSrc.indexOf("export async function handleRejectPayment"),
      handlerSrc.indexOf("export async function handleRejectPayment") + 30000
    );
    expect(handler).toMatch(/transitioned/);
    expect(handler).toMatch(/siblingRejectedCount,\s*\n\s*\/\/ Per XCC-05[\s\S]{0,200}transitioned/);
  });
});
