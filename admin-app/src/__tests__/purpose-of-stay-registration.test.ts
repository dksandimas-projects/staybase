// Per `plan/project/ROADMAP.md §Guest Check-in Registration (GCR)` and
// Decision #121 (2026-07-23): the admin booking drawer's guest
// registration form must capture a "Purpose of stay" field, default
// to "Leisure", and require a free-text reason when the staff picks
// "Other". This test pins the source-code shape of the form so a
// future refactor that drops the field fails loudly.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("GCR-01 — Purpose of stay in the admin guest registration form", () => {
  const form = read("admin-app/src/components/BookingRegistrationForm.tsx");
  const page = read("admin-app/src/pages/BookingsPage.tsx");
  const adminContext = read("admin-app/src/context/AdminContext.tsx");

  it("Booking.guestRegistration type carries purposeOfStay + otherPurpose", () => {
    expect(adminContext).toMatch(/purposeOfStay\?: string;/);
    expect(adminContext).toMatch(/otherPurpose\?: string;/);
  });

  it("BookingRegistrationForm renders a purpose-of-stay select with Leisure as the default", () => {
    expect(form).toMatch(/name="purposeOfStay"/);
    // Default to leisure when the registration record has no value
    expect(form).toMatch(/defaultValue=\{reg\?\.purposeOfStay \?\? "leisure"\}/);
    // All three options present
    expect(form).toMatch(/<option value="leisure">Leisure<\/option>/);
    expect(form).toMatch(/<option value="business">Business<\/option>/);
    expect(form).toMatch(/<option value="other">Other \(specify below\)<\/option>/);
  });

  it("BookingRegistrationForm renders a free-text other-purpose field with helpful placeholder", () => {
    expect(form).toMatch(/name="otherPurpose"/);
    expect(form).toMatch(/e\.g\. "wedding", "medical", "long-stay relocation"/);
  });

  it("BookingRegistrationForm's isComplete check includes purposeOfStay and the Other-reason requirement", () => {
    // The form's local "is the form complete enough to show the
    // summary view" check must match the shared readiness gate.
    expect(form).toMatch(/reg\?\.purposeOfStay/);
    expect(form).toMatch(/reg\.purposeOfStay\.trim\(\)\.toLowerCase\(\) !== "other" \|\| !!reg\?\.otherPurpose\?\.trim\(\)/);
  });

  it("BookingsPage handleRegistrationSubmit captures purposeOfStay + otherPurpose", () => {
    const submitFn = page.match(/const handleRegistrationSubmit = \(event[\s\S]*?\n\s*\};/);
    expect(submitFn, "expected to find handleRegistrationSubmit").not.toBeNull();
    expect(submitFn?.[0]).toMatch(/formData\.get\("purposeOfStay"\)/);
    expect(submitFn?.[0]).toMatch(/formData\.get\("otherPurpose"\)/);
    // Only persists otherPurpose when purposeOfStay === "other"
    expect(submitFn?.[0]).toMatch(/purposeOfStay === "other" \? otherPurpose : undefined/);
  });

  it("BookingsPage registration PDF includes Purpose of stay in the reg fields list", () => {
    const regFieldsBlock = page.match(/const regFields: \[string, string\]\[\] = \[[\s\S]*?\];/);
    expect(regFieldsBlock, "expected to find the regFields array").not.toBeNull();
    expect(regFieldsBlock?.[0]).toMatch(/Purpose of stay/);
    // The "Other — <reason>" pattern is rendered inline
    expect(regFieldsBlock?.[0]).toMatch(/reg\.purposeOfStay\.toLowerCase\(\) === "other" && reg\?\.otherPurpose/);
  });
});
