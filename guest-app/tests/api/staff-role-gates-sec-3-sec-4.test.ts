// Per the AI browser QA pass (2026-10-23) — the handoff's Wave 2 items
// SEC-3 and SEC-4, which the QA report itself never covered.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// Two staff-money endpoints authenticated the caller with
// `authenticateStaff`, which admits BOTH staff roles (`admin` AND
// `front-desk`):
//
//   SEC-3  POST /api/members/redeem-points      — apply a member's points
//                                                against a booking
//   SEC-4  POST /api/corporate/convert-inquiry  — turn an inquiry into a
//                                                real, priced booking
//
// The admin UI hides both surfaces from the front desk, so the buttons were
// the ONLY thing doing the work. A front-desk client could call either
// endpoint directly and get past the gate.
//
// Verified live against production on 2026-10-26: a front-desk token
// received HTTP 400 ("Booking not found." / "Please check the conversion
// details and try again.") — i.e. the request got PAST the role gate and
// into the handler, where it failed only because the probe used a
// non-existent id. The admin control (the same call, same body, admin
// token) behaved identically — which is exactly the signature of a MISSING
// role gate.
//
// This is the same failure shape as QA §3.7 (the desk's store-order
// transitions were "a raw client-side write", so the state machine existed
// only as UI buttons). The fix belongs on the SERVER, where it holds
// regardless of what the client renders.
//
// WHAT MUST STAY TRUE
// -------------------
//   * a front-desk caller is refused with 403 on BOTH endpoints
//   * an ADMIN caller still gets through (the gate must not break the desk)
//   * an ANONYMOUS caller is still refused (401, not 403)
//   * the sibling admin-only endpoints keep their existing gates — this
//     suite must not become a blanket "all staff routes are admin-only"
//   * the GUEST self-service redemption (`redeem-points-self`) is NOT
//     staff-gated and must stay reachable by a member's own token
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routerSource = readFileSync(resolve(__dirname, "../../server/apiRouter.ts"), "utf8");

/**
 * Pull the route block for `domain === "x" && action === "y"` out of the
 * router and return just that block, so an assertion cannot accidentally
 * match a DIFFERENT route's gate.
 */
function routeBlock(domain: string, action: string): string {
  const anchor = `domain === "${domain}" && action === "${action}"`;
  const start = routerSource.indexOf(anchor);
  expect(start, `route ${domain}/${action} must exist in the router`).toBeGreaterThan(-1);

  // Walk forward to the end of the `if (...) { ... }` block: the next route
  // block starts at the same indentation, so stop there.
  const rest = routerSource.slice(start);
  const nextRoute = rest.indexOf("\n  if (domain ===", 1);
  return nextRoute === -1 ? rest : rest.slice(0, nextRoute);
}

describe("SEC-3 — points redemption is admin-only", () => {
  const block = routeBlock("members", "redeem-points");

  it("refuses a front-desk caller with 403", () => {
    expect(block).toContain('authResult.role !== "admin"');
    expect(block).toMatch(/authResult\.role !== "admin"[\s\S]{0,220}403/);
  });

  it("names the reason, so the desk is told why", () => {
    expect(block).toMatch(/Only admins can apply points redemptions\./);
  });

  it("the gate sits BEFORE the handler is invoked", () => {
    const gateAt = block.indexOf('authResult.role !== "admin"');
    const handlerAt = block.indexOf("handleRedeemMemberPoints");
    expect(gateAt).toBeGreaterThan(-1);
    expect(handlerAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(handlerAt);
  });

  it("does not accidentally gate the MEMBER self-service redemption", () => {
    // `redeem-points-self` is deliberately NOT staff-authenticated — the
    // handler verifies the member's own token and the ownership guard.
    const selfBlock = routeBlock("members", "redeem-points-self");
    expect(selfBlock).not.toContain('authResult.role !== "admin"');
    expect(selfBlock).toContain("handleRedeemPointsSelf");
  });
});

describe("SEC-4 — converting a corporate inquiry is admin-only", () => {
  const block = routeBlock("corporate", "convert-inquiry");

  it("refuses a front-desk caller with 403", () => {
    expect(block).toContain('authResult.role !== "admin"');
    expect(block).toMatch(/authResult\.role !== "admin"[\s\S]{0,220}403/);
  });

  it("names the reason, so the desk is told why", () => {
    expect(block).toMatch(/Only admins can convert corporate inquiries into bookings\./);
  });

  it("the gate sits BEFORE the handler is invoked", () => {
    const gateAt = block.indexOf('authResult.role !== "admin"');
    const handlerAt = block.indexOf("handleConvertInquiryToBooking");
    expect(gateAt).toBeGreaterThan(-1);
    expect(handlerAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(handlerAt);
  });
});

describe("the existing admin-only gates are still in place", () => {
  const cases: Array<[string, string]> = [
    ["members", "link-booking"],
    ["members", "manual-adjust"],
    ["members", "set-active"],
  ];

  for (const [domain, action] of cases) {
    it(`${domain}/${action} keeps its admin-only gate`, () => {
      const block = routeBlock(domain, action);
      expect(block).toContain('authResult.role !== "admin"');
    });
  }
});

describe("the guard is not a blanket ban on staff routes", () => {
  it("a staff-wide route is NOT admin-gated", () => {
    // `reference/generate` is a desk action — it must stay reachable by the
    // front desk. If this ever gains an admin gate, the desk loses it.
    const block = routeBlock("reference", "generate");
    expect(block).not.toContain('authResult.role !== "admin"');
  });

  it("the front desk can still read its own surfaces", () => {
    // `store/update-order-status` — the desk's order actions. Staff-wide,
    // and it must stay that way (the ROLE split there is money-vs-tender,
    // not admin-vs-desk).
    const block = routeBlock("store", "update-order-status");
    expect(block).not.toContain('authResult.role !== "admin"');
  });
});
