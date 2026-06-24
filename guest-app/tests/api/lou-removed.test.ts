import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 (Phase 2 W2.11 #99): the corporate chargeback
// booking flow had a fake LOU upload — the file picker stored only the
// filename in state and the server never received any file. Per
// W2.11 / decision #99, LOU is not collected in Phase 1; the file picker
// has been replaced with a note saying the accounts team will email
// the guest for the LOU.

describe("CorporateBookingPage.tsx — LOU removed (decision #99)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../src/pages/CorporateBookingPage.tsx"),
    "utf8"
  );

  it("does not show 'Upload LOU / Authorization PDF' anymore", () => {
    expect(src).not.toMatch(/Upload LOU \/ Authorization PDF/);
  });

  it("does not show 'Upload Authorization / LOU Document' anymore", () => {
    expect(src).not.toMatch(/Upload Authorization \/ LOU Document/);
  });

  it("does not require isFileUploaded for the canConfirm check", () => {
    // The canConfirm must not depend on the (now removed) file upload
    expect(src).not.toMatch(/canConfirm\s*=\s*termsConsent\s*&&\s*isFileUploaded/);
  });

  it("shows the new 'No LOU upload needed' note", () => {
    expect(src).toMatch(/No LOU upload needed/);
  });

  it("the new copy references 'accounts team will email you'", () => {
    expect(src).toMatch(/accounts team will email you within 24 hours/);
  });
});
