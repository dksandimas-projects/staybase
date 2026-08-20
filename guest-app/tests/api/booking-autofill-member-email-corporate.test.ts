import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Source-text guards for feature/booking-autofill-member-email-corporate:
// mirrors the public /book flow (BookingPage.tsx — see
// booking-autofill-member-email.test.ts) on the corporate /corporate/book
// page. Same contract:
//
//   1. `guestDetails.email` is seeded from `memberProfile.email`
//      when `memberProfile.isMember` is true (URL `?email=` keeps
//      precedence — the corporate personal-pay path can pass a
//      billing-email override).
//   2. The email <TextField> renders `readOnly` tied to
//      `memberProfile?.isMember`.
//   3. `updateGuestDetail("email", …)` short-circuits for a member
//      so a paste / programmatic edit cannot bypass the readOnly.
//   4. The local `TextField` component supports a `readOnly` prop
//      and renders it on the input (NOT `disabled`, which would
//      drop the field from form submission).
//   5. A small helper line tells the member why the field is locked.
//
// The corporate page's email field is labelled "Corporate Email"
// (vs. "Email" on the public flow) — the test grep keys off
// `autoComplete="email"` (shared by both), not the label.

describe("CorporateBookingPage.tsx — Step 2 email autofills + locks for members (feature/booking-autofill-member-email-corporate)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/CorporateBookingPage.tsx"),
    "utf8"
  );

  it("imports useGuestAuth from the guest auth context", () => {
    expect(src).toMatch(
      /import\s*\{\s*useGuestAuth\s*\}\s*from\s*"\.\.\/context\/GuestAuthContext"/,
    );
  });

  it("seeds guestDetails.email from memberProfile when the guest is a member", () => {
    expect(src).toMatch(
      /email:\s*\n?\s*searchParams\.get\("email"\)\s*\?\?\s*\n?\s*\(?\s*memberProfile\?\.isMember\s*&&\s*memberProfile\.email/,
    );
  });

  it("renders the email <TextField> with readOnly when the guest is a member", () => {
    const emailFieldBlock = src.match(
      /<TextField[\s\S]*?autoComplete="email"[\s\S]*?\/>/,
    );
    expect(emailFieldBlock, "email <TextField> block not found").toBeTruthy();
    expect(emailFieldBlock![0]).toContain(
      'readOnly={!!memberProfile?.isMember}',
    );
  });

  it("short-circuits updateGuestDetail for the email field when the guest is a member", () => {
    const guard = src.match(
      /function updateGuestDetail[\s\S]*?if \(field === "email"[\s\S]*?return;\s*\}/,
    );
    expect(guard, "updateGuestDetail email guard not found").toBeTruthy();
    expect(guard![0]).toMatch(/memberProfile\?\.isMember\s*&&\s*memberProfile\.email/);
  });

  it("shows a helper line below the email field for members", () => {
    expect(src).toMatch(
      /Linked to your \{config\.rewardsName\} account\./,
    );
  });

  it("the local TextField component renders readOnly (not disabled) on the input", () => {
    // Find the TextField body — it must spread a `readOnly` prop
    // onto the <input>, NOT `disabled`.
    const textFieldBody = src.match(
      /function TextField[\s\S]*?aria-readonly[\s\S]*?\n\s*\}/,
    );
    expect(textFieldBody, "TextField body not found").toBeTruthy();
    expect(textFieldBody![0]).toMatch(/readOnly=\{readOnly\}/);
    expect(textFieldBody![0]).not.toMatch(/\bdisabled\b/);
  });
});
