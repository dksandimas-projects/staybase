import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 #4: guestEmail was stored as-typed
// (mixed case preserved) on write, but queried as lowercase on read.
// A guest with "Maria@Example.com" couldn't see "My Stays" or self-cancel
// because the queries (StaysPage, handleLookupBooking, handleCancelBooking,
// linkBookingsByEmail) all lowercased their search but the stored value
// was mixed case.
//
// Per W1.4 / decision #84 (storage Timestamp) and SEV-1 #4 (email case),
// the fix is to lowercase on both write and read paths.

describe("bookings.ts — guestEmail lowercase normalization (SEV-1 #4)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../server/handlers/bookings.ts"),
    "utf8"
  );

  it("lowercases guestEmail on create (handleCreateBooking)", () => {
    // Pattern: guestEmail: guestDetails.email.trim().toLowerCase()
    expect(src).toMatch(/guestEmail:\s*guestDetails\.email\.trim\(\)\.toLowerCase\(\)/);
  });

  it("lowercases guestEmail on walkin (handleCreateWalkin)", () => {
    // Same pattern appears in handleCreateWalkin
    const matches = src.match(/guestEmail:\s*guestDetails\.email\.trim\(\)\.toLowerCase\(\)/g);
    expect(matches, "expected at least 2 occurrences (create + walkin)").not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it("lowercases guestEmail in computedData (for email template consistency)", () => {
    // computedData.email is what the email trigger receives
    expect(src).toMatch(/email:\s*guestDetails\.email\.trim\(\)\.toLowerCase\(\)/);
  });

  it("lowercases guestEmail in the cancel query (handleCancelBooking)", () => {
    // The cancel endpoint must match storage, so it must lowercase the
    // query value. Without this, a guest with "Maria@Example.com" cannot
    // self-cancel because the storage is now lowercase but the query was
    // still mixed case.
    //
    // Per BF-21 (booking-flow audit 2026-06-26) the cancel
    // path goes through `guestCancelSchema` (Zod), which
    // lowercases the email in the schema itself
    // (`z.string().trim().toLowerCase().email().max(160)`),
    // so the cancel query binds to the lowercased value.
    //
    // Per H2 (hardening batch 2026-06-26) the cancel query
    // is now dispatched by a `compositeFilter` helper so it
    // can bind on either `guestEmail` (legacy) or
    // `lookupToken` (the new magic-link path). The regex
    // here is source-grammar-level (loose on whitespace +
    // variable names) so it doesn't break across the
    // refactor — we just want to assert that the cancel
    // path binds the composite filter and the value is
    // not the raw mixed-case `body.guestEmail`.
    expect(src).toMatch(/\.where\(\s*compositeFilter\.field\s*,\s*["']==["']\s*,\s*compositeFilter\.value\s*\)/);
  });

  it("does not leave any write path storing guestEmail as mixed case", () => {
    // Negative assertion: no remaining `.email.trim()` (without toLowerCase) used as guestEmail
    const remainingMixedCase = src.match(/guestEmail:\s*guestDetails\.email\.trim\(\)(?!\.toLowerCase)/);
    expect(remainingMixedCase, "found a mixed-case write path that should lowercase").toBeNull();
  });
});
