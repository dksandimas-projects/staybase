import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Source-text guards for feature/booking-autofill-member-name
// (extends the email-only autofill in
// booking-autofill-member-email.test.ts).
//
// The autofill+lock contract (UX decision 2026-08-20):
//
//   Identity-anchored fields → autofill from member profile + lock:
//     - firstName
//     - lastName
//     - email
//
//   Contact field → autofill from member profile, stay editable:
//     - phone  (members may travel on a secondary phone)
//
// The contract pins four things at the source level on both pages:
//   1. `guestDetails.firstName` / `lastName` seed from
//      `memberProfile.fullName.split(" ")` (first token = first name,
//      the rest = last name — same split as ProfilePage.tsx).
//      `guestDetails.phone` seeds from `memberProfile.phone`.
//   2. The first/last <TextField>s render `readOnly` tied to
//      `memberProfile?.isMember`. The phone <TextField> does NOT.
//   3. `updateGuestDetail` short-circuits for `email`, `firstName`,
//      AND `lastName` when the guest is a member — but NOT for
//      `phone`.
//   4. The phone <TextField> remains plain (no readOnly prop, no
//      helper line).

describe("BookingPage.tsx — Step 2 first/last name + phone autofill for members (feature/booking-autofill-member-name)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/BookingPage.tsx"),
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
    // Both the firstName and lastName <TextField>s must include
    // `readOnly={!!memberProfile?.isMember}`. We assert that the
    // total count of readOnly attributes is exactly 3 — one each
    // for firstName, lastName, and email. Anything more and a
    // future agent silently locked a field they shouldn't have
    // (e.g. phone).
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
    // Phone must NOT appear in the guard. If a future refactor
    // adds `field === "phone"` here, the test fails so the agent
    // has to consciously decide whether to lock the phone.
    expect(guard![0]).not.toMatch(/field === "phone"/);
  });

  it("phone <TextField> does NOT have a readOnly prop", () => {
    // Anchor on the immediately-preceding `<TextField` opening so
    // we don't capture the email <TextField> above (which IS
    // readOnly). Use `id="phone"` as the closing anchor and a
    // non-greedy walk forward to the first `/>` (the closing of
    // this self-closing TextField).
    const phoneBlock = src.match(
      /<TextField\s+(?:(?!<TextField)[\s\S])*?id="phone"[\s\S]*?\/>/,
    );
    expect(phoneBlock, "phone <TextField> block not found").toBeTruthy();
    expect(phoneBlock![0]).not.toMatch(/readOnly/);
  });
});
