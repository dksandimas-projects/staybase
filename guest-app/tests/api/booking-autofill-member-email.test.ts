import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Source-text guards for feature/booking-autofill-member-email:
// when a guest is signed in as a Spark Rewards member, the Step 2
// email field on /book must pre-fill from the member profile AND
// be rendered as non-editable. The booking is always filed under
// the member's account email — guests cannot type a different one
// and accidentally split the booking from their account.
//
// The contract pins four things at the source level so a future
// refactor breaks the test instead of silently regressing:
//
//   1. `guestDetails.email` is seeded from `memberProfile.email`
//      when `memberProfile.isMember` is true (and no `?email=`
//      URL param overrides it).
//   2. The email <TextField> is rendered with `readOnly` tied to
//      `memberProfile?.isMember`.
//   3. `updateGuestDetail("email", …)` short-circuits for a member
//      so a paste / programmatic edit cannot bypass the readOnly.
//   4. A small helper line tells the member why the field is locked
//      (FRONTEND.md §7 — every "why" deserves context, no dead
//      ends).

describe("BookingPage.tsx — Step 2 email autofills + locks for members (feature/booking-autofill-member-email)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/BookingPage.tsx"),
    "utf8"
  );

  it("seeds guestDetails.email from memberProfile when the guest is a member", () => {
    // The init expression must check `memberProfile?.isMember` and
    // fall back to the URL param when an explicit ?email= was
    // passed (e.g. the Step 4 → re-book flow pins the email).
    expect(src).toMatch(
      /email:\s*\n?\s*searchParams\.get\("email"\)\s*\?\?\s*\n?\s*\(?\s*memberProfile\?\.isMember\s*&&\s*memberProfile\.email/
    );
  });

  it("renders the email <TextField> with readOnly when the guest is a member", () => {
    // The exact readOnly attribute wiring lives on the email input
    // — find the `<TextField ... autoComplete="email" ... readOnly=`
    // run and assert the gate.
    const emailFieldBlock = src.match(
      /<TextField[\s\S]*?autoComplete="email"[\s\S]*?\/>/,
    );
    expect(emailFieldBlock, "email <TextField> block not found").toBeTruthy();
    expect(emailFieldBlock![0]).toContain(
      'readOnly={!!memberProfile?.isMember}',
    );
  });

  it("short-circuits updateGuestDetail for the email field when the guest is a member", () => {
    // The early-return guard inside updateGuestDetail must mention
    // the `email` field and `memberProfile.isMember` so a paste,
    // dev-tools edit, or future programmatic caller cannot bypass
    // the readOnly. The guard is now an OR-list covering
    // email/firstName/lastName (per feature/booking-autofill-member-name)
    // — we anchor on the function body and assert both fields
    // appear inside.
    const guard = src.match(
      /function updateGuestDetail[\s\S]*?\n\s*\}/,
    );
    expect(guard, "updateGuestDetail function body not found").toBeTruthy();
    expect(guard![0]).toMatch(/field === "email"/);
    expect(guard![0]).toMatch(/memberProfile\?\.isMember\s*&&\s*memberProfile\.email/);
  });

  it("shows a helper line below the email field for members", () => {
    // The helper uses config.rewardsName so the brand name stays
    // dynamic (per WHITE-LABEL.md / DECISIONS-FEATURES.md — never
    // hardcode "Spark Rewards").
    expect(src).toMatch(
      /Linked to your \{config\.rewardsName\} account\./,
    );
  });

  it("does not render the email field as `disabled` (which would drop it from form submission)", () => {
    // Sanity guard against an easy refactor mistake. `disabled`
    // removes the field from the submitted form payload; we must
    // use `readOnly` so /api/bookings/create still receives
    // `guestDetails.email` for the member.
    const emailFieldBlock = src.match(
      /<TextField[\s\S]*?autoComplete="email"[\s\S]*?\/>/,
    );
    expect(emailFieldBlock).toBeTruthy();
    expect(emailFieldBlock![0]).not.toMatch(/\bdisabled\s*=\{/);
  });
});
