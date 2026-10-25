// Per AI-BROWSER-QA (2026-10-25, scenario RW-02): a signed-in member
// must be CHARGED the member rate, not just quoted it.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// Per W2.2 / decision #90 the server is authoritative for the Spark
// Rewards member discount: `handleCreateBooking` reads the request's
// `Authorization: Bearer <idToken>` header, resolves `members/{uid}` and
// applies the configured member percentage to the post-voucher subtotal.
//
// The GUEST CLIENT never sent that header. It read the member profile
// from the auth context, MIRRORED the discount into the price summary
// ("Spark Rewards member rate — 10%"), and then posted the booking with
// no Authorization header at all. The server could not know who the
// guest was, applied no discount, and charged the undiscounted total.
//
//   Measured live on 2026-10-25: the review step showed PHP 2,160 and
//   the server charged PHP 2,400 — a member quoted 10% off and billed
//   full price.
//
// The client and the server have to agree on the SAME value. The repo
// states the principle itself: "whenever the client gates on a value the
// server does not validate, the gate is decorative" — and here the
// client SHOWN a value the server never applied.
//
// This file pins the WIRING (source-text guards — the guest pages are
// React components and this repo has no DOM test environment for them)
// and the SERVER's resolution rule.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");
const corporatePageSrc = read("guest-app/src/pages/CorporateBookingPage.tsx");
const bookingsHandlerSrc = read("guest-app/server/handlers/bookings.ts");

describe("RW-02 — the booking create carries the member's ID token", () => {
  it("the public booking flow attaches the Authorization header", () => {
    expect(bookingPageSrc).toMatch(/Authorization:\s*`Bearer \$\{idToken\}`/);
  });

  it("the token comes from the signed-in guest", () => {
    expect(bookingPageSrc).toMatch(/user\s*\?\s*await user\.getIdToken\(\)/);
    expect(bookingPageSrc).toMatch(/const\s*\{\s*memberProfile,\s*user\s*\}\s*=\s*useGuestAuth\(\)/);
  });

  it("the corporate booking flow attaches the Authorization header too", () => {
    expect(corporatePageSrc).toMatch(/Authorization:\s*`Bearer \$\{idToken\}`/);
    expect(corporatePageSrc).toMatch(/user\s*\?\s*await user\.getIdToken\(\)/);
  });

  it("an anonymous booking sends no Authorization header", () => {
    // The header is only attached when there is a token — an anonymous
    // booking must look exactly as it did before.
    expect(bookingPageSrc).toMatch(/\.\.\.\(idToken\s*\?\s*\{\s*Authorization/);
  });
});

describe("RW-02 — the server resolves the member from that header", () => {
  it("reads the Bearer token from the request", () => {
    expect(bookingsHandlerSrc).toMatch(/req\.headers\?\.authorization/);
    expect(bookingsHandlerSrc).toMatch(/startsWith\("Bearer "\)/);
  });

  it("resolves the member document and applies the configured percentage", () => {
    expect(bookingsHandlerSrc).toMatch(/collection\("members"\)\.doc\(decoded\.uid\)/);
    expect(bookingsHandlerSrc).toMatch(/memberDiscountPct/);
    expect(bookingsHandlerSrc).toMatch(/appliedMemberDiscountPct/);
  });

  it("writes the applied percentage onto the booking", () => {
    expect(bookingsHandlerSrc).toMatch(/memberDiscountPct:\s*appliedMemberDiscountPct/);
  });

  it("never trusts a client-supplied member percentage", () => {
    // The client cannot supply the percentage — the schema has no such
    // field, and the server hard-codes 0 before resolving it itself.
    expect(bookingsHandlerSrc).toMatch(/memberDiscountPct:\s*0,\s*\/\/ public path has no member discount/);
  });
});
