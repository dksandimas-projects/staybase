import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Source-text guards for feature/booking-autofill-member-name-corporate
// (extends the email-only autofill on the corporate page).
// Mirrors the public-flow contract — see
// booking-autofill-member-name.test.ts for the canonical version.
//
// Identity-anchored fields (firstName + lastName + email) are
// locked to the member's account. The phone field is autofilled
// from the member profile but stays editable (members may travel
// on a secondary phone).

describe("CorporateBookingPage.tsx — Step 2 first/last name + phone autofill for members (feature/booking-autofill-member-name-corporate)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/CorporateBookingPage.tsx"),
    "utf8"
  );

  it("seeds guestDetails.firstName from memberProfile.fullName (first token after split)", () => {
    expect(src).toMatch(
      /firstName:\s*\n?\s*searchParams\.get\("firstName"\)\s*\?\?\s*\n?\s*\(?\s*memberProfile\?\.isMember\s*&&\s*memberProfile\.fullName[\s\S]{0,80}fullName\.split\(\s*" "\s*\)\[0\]/
    );
  });

  it("seeds guestDetails.lastName from memberProfile.fullName (rest after split)", () => {
    expect(src).toMatch(
      /lastName:\s*\n?\s*searchParams\.get\("lastName"\)\s*\?\?\s*\n?\s*\(?\s*memberProfile\?\.isMember\s*&&\s*memberProfile\.fullName[\s\S]{0,80}fullName\.split\(\s*" "\s*\)\.slice\(1\)\.join\(\s*" "\s*\)/
    );
  });

  it("seeds guestDetails.phone from memberProfile.phone (no readOnly — phone stays editable)", () => {
    expect(src).toMatch(
      /phone:\s*\n?\s*searchParams\.get\("phone"\)\s*\?\?\s*\n?\s*\(?\s*memberProfile\?\.isMember\s*&&\s*memberProfile\.phone/
    );
  });

  it("first/last name <TextField>s render readOnly when the guest is a member", () => {
    const matches = src.match(/readOnly=\{!!memberProfile\?\.isMember\}/g) ?? [];
    expect(matches.length, "readOnly gate count").toBe(3);
  });

  it("updateGuestDetail short-circuits email + firstName + lastName (NOT phone)", () => {
    const guard = src.match(
      /function updateGuestDetail[\s\S]*?if \([\s\S]*?memberProfile\?\.isMember[\s\S]*?return;\s*\}/,
    );
    expect(guard, "updateGuestDetail guard not found").toBeTruthy();
    expect(guard![0]).toMatch(/field === "email"/);
    expect(guard![0]).toMatch(/field === "firstName"/);
    expect(guard![0]).toMatch(/field === "lastName"/);
    expect(guard![0]).not.toMatch(/field === "phone"/);
  });

  it("phone <TextField> does NOT have a readOnly prop", () => {
    // Same anchor trick as the public-flow test — start at the
    // immediately-preceding `<TextField` opening so we don't capture
    // the email <TextField> above (which IS readOnly).
    const phoneBlock = src.match(
      /<TextField\s+(?:(?!<TextField)[\s\S])*?id="phone"[\s\S]*?\/>/,
    );
    expect(phoneBlock, "phone <TextField> block not found").toBeTruthy();
    expect(phoneBlock![0]).not.toMatch(/readOnly/);
  });
});
