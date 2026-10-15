// MBUX-06 — Step 3 reduced to essential guest details.
//
// Phase 15 / decision #258. Owning spec:
// `plan/features/BOOKING-MOBILE-UX.md §Step 3 — Guest Details`.
//
// The centre of this slice is the CONSENT CONSOLIDATION. Two
// checkboxes asked the same question on two consecutive steps; the
// server validated one of them. That was not a cosmetic duplication —
// it produced a genuine failure mode (tick the wrong box, pass the
// UI, get a server 400), which is why the fix in MBUX-06 makes ONE
// value authoritative rather than merely hiding a box.
//
// Already shipped by earlier work and therefore asserted as PRESERVED
// rather than implemented here:
//   - the four contact fields' `autoComplete` tokens;
//   - the collapsed-by-default special-requests accordion (SR-01..05);
//   - member prefill + `readOnly` on the identity fields;
//   - inline `guestErrors` validation with touched-field reveal.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("MBUX-06 — ONE authoritative consent control", () => {
  it("the duplicate Step 4 terms checkbox is gone", () => {
    expect(bookingPageSrc).not.toMatch(/id="termsConsent"/);
    expect(bookingPageSrc).not.toMatch(/name="termsConsent"/);
    expect(bookingPageSrc).not.toMatch(/setTermsConsent/);
  });

  it("the `termsConsent` state no longer exists anywhere", () => {
    expect(bookingPageSrc).not.toMatch(/termsConsent/);
  });

  it("Step 3's checkbox survives and is labelled as the authoritative one", () => {
    expect(bookingPageSrc).toMatch(/id="consentStep2"/);
    expect(bookingPageSrc).toMatch(/SINGLE\s+authoritative booking consent control/);
  });

  it("it links BOTH policy documents", () => {
    const block = bookingPageSrc.slice(
      bookingPageSrc.indexOf('id="consentStep2"') - 800,
      bookingPageSrc.indexOf('id="consentStep2"') + 1400
    );
    expect(block).toMatch(/to="\/privacy"/);
    expect(block).toMatch(/to="\/terms"/);
  });

  it("the Confirm gate, the create payload, and the server all read ONE value", () => {
    // The defect F5 was filed against was a gate reading a different
    // field than the payload/server. All three must agree.
    expect(bookingPageSrc).toMatch(
      /const canConfirm = guestDetails\.consent && !isIdUploadRequired/
    );
    expect(bookingPageSrc).toMatch(/consent: guestDetails\.consent/);
  });

  it("the missing-consent CTA copy still points at the Step 3 checkbox", () => {
    expect(bookingPageSrc).toMatch(
      /!guestDetails\.consent\s*\n\s*\? "Confirm your guest details consent on the previous step"/
    );
  });

  it("no 'Agree to terms and conditions' branch remains in the Confirm CTA", () => {
    // That branch only existed to satisfy the deleted second box.
    expect(bookingPageSrc).not.toMatch(/"Agree to terms and conditions"/);
  });

  it("the cancellation-policy line the deleted checkbox carried is not lost", () => {
    // The policy disclosure is always rendered on Step 4; the guest
    // READS it there instead of ticking it a second time.
    expect(bookingPageSrc).toMatch(/cancellationPolicy/);
  });
});

describe("MBUX-06 — compact secure-handling line replaces the large explanation", () => {
  it("the RA 10173 reference is retained", () => {
    expect(bookingPageSrc).toMatch(/Data Privacy Act of 2012/);
  });

  it("it is a single inline line, not a boxed paragraph", () => {
    expect(bookingPageSrc).toMatch(/data-testid="booking-secure-handling-note"/);
    expect(bookingPageSrc).toMatch(
      /className="mt-4 flex items-center gap-2 text-xs text-gray-600"/
    );
  });

  it("the shield icon is decorative there — the sentence carries the meaning", () => {
    const note = bookingPageSrc.slice(
      bookingPageSrc.indexOf('data-testid="booking-secure-handling-note"') - 400,
      bookingPageSrc.indexOf('data-testid="booking-secure-handling-note"')
    );
    expect(note).toMatch(/ShieldCheck/);
    expect(note).toMatch(/aria-hidden/);
  });
});

describe("MBUX-06 — incomplete states name the first correction and take focus there", () => {
  it("the Continue button is NOT permanently disabled", () => {
    // A disabled button is unfocusable and does nothing when tapped,
    // so it is invisible to keyboard and screen-reader users.
    // Scoped to the button element itself — a wide window would match
    // the word "disabled" in an unrelated nearby comment.
    const buttonStart = bookingPageSrc.indexOf(
      "data-testid=\"booking-guest-details-continue\""
    );
    const openTagStart = bookingPageSrc.lastIndexOf("<PrimaryButton", buttonStart);
    const openTagEnd = bookingPageSrc.indexOf(">", buttonStart);
    const openTag = bookingPageSrc.slice(openTagStart, openTagEnd);
    expect(openTagStart).toBeGreaterThan(-1);
    expect(openTag).toMatch(/onClick=\{focusFirstGuestDetailCorrection\}/);
    expect(openTag).not.toMatch(/\bdisabled\b/);
  });

  it("it marks the offending field touched so its inline error appears", () => {
    expect(bookingPageSrc).toMatch(/markTouched\(firstBadField\.field\)/);
  });

  it("it scrolls the field into view and focuses it", () => {
    expect(bookingPageSrc).toMatch(
      /el\?\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/
    );
    expect(bookingPageSrc).toMatch(/el\?\.focus\(\{ preventScroll: true \}\)/);
  });

  it("field order matches visual order, with consent last", () => {
    const helper = bookingPageSrc.slice(
      bookingPageSrc.indexOf("function focusFirstGuestDetailCorrection"),
      bookingPageSrc.indexOf("const getBackToPath")
    );
    const order = ["firstName", "lastName", "email", "phone", "guestCount"];
    let cursor = -1;
    for (const field of order) {
      const idx = helper.indexOf(`field: "${field}"`);
      expect(idx, `${field} missing from the candidate list`).toBeGreaterThan(-1);
      expect(idx, `${field} out of visual order`).toBeGreaterThan(cursor);
      cursor = idx;
    }
    // Consent is reached only after every field is valid.
    expect(helper.indexOf('document.getElementById("consentStep2")')).toBeGreaterThan(cursor);
  });

  it("falls back to the consent checkbox when every field is valid", () => {
    expect(bookingPageSrc).toMatch(
      /Every field is valid, so the blocker must be consent\./
    );
    expect(bookingPageSrc).toMatch(/consentEl\?\.focus\(\{ preventScroll: true \}\)/);
  });

  it("the footer summary names the FIRST correction, not a generic instruction", () => {
    expect(bookingPageSrc).toMatch(/const firstGuestDetailCorrectionLabel = \(\(\) => \{/);
    expect(bookingPageSrc).toMatch(/firstGuestDetailCorrectionLabel/);
    expect(bookingPageSrc).toMatch(/if \(guestErrors\.firstName\) return "First name is required"/);
    expect(bookingPageSrc).toMatch(
      /if \(!guestDetails\.consent\) return "Accept the privacy and terms consent below"/
    );
  });

  it("the summary order and the focus order cannot disagree", () => {
    // Both are derived from the same `guestErrors` object in the same
    // order; this pins that the summary is not independently authored.
    const summary = bookingPageSrc.slice(
      bookingPageSrc.indexOf("const firstGuestDetailCorrectionLabel"),
      bookingPageSrc.indexOf("const firstGuestDetailCorrectionLabel") + 800
    );
    const order = ["firstName", "lastName", "email", "phone", "guestCount"];
    let cursor = -1;
    for (const field of order) {
      const idx = summary.indexOf(`guestErrors.${field}`);
      expect(idx, `${field} missing from the summary chain`).toBeGreaterThan(-1);
      expect(idx, `${field} out of order in the summary`).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });
});

describe("MBUX-06 — preserved essentials (shipped earlier, must not regress)", () => {
  it("the four primary contact fields keep their autofill tokens", () => {
    expect(bookingPageSrc).toMatch(/autoComplete="given-name"/);
    expect(bookingPageSrc).toMatch(/autoComplete="family-name"/);
    expect(bookingPageSrc).toMatch(/autoComplete="email"/);
    expect(bookingPageSrc).toMatch(/autoComplete="tel"/);
  });

  it("inline validation stays touched-field gated", () => {
    expect(bookingPageSrc).toMatch(
      /error=\{touchedFields\.firstName \? guestErrors\.firstName : ""\}/
    );
    expect(bookingPageSrc).toMatch(/onBlur=\{\(\) => markTouched\("firstName"\)\}/);
  });

  it("signed-in member identity fields stay prefilled and read-only", () => {
    expect(bookingPageSrc).toMatch(/readOnly=\{!!memberProfile\?\.isMember\}/);
  });

  it("special requests stay collapsed by default (SR-01..05)", () => {
    const blockSrc = readFileSync(
      resolve(__dirname, "../../src/components/SpecialRequestsBlock.tsx"),
      "utf8"
    );
    expect(blockSrc).toMatch(/const \[accordionOpen, setAccordionOpen\] = useState\(false\)/);
  });

  it("the guest-detail fields remain a two-column grid that collapses to one", () => {
    expect(bookingPageSrc).toMatch(/className="mt-4 grid gap-5 sm:grid-cols-2"/);
  });

  it("the cart-readiness gate still gates Continue to review", () => {
    expect(bookingPageSrc).toMatch(
      /Object\.values\(guestErrors\)\.every\(\(error\) => !error\) && guestDetails\.consent && cartIsReady/
    );
  });
});