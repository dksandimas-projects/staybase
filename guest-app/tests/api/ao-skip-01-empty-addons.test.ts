// Per AO-SKIP-01 (2026-11-18): the empty-add-ons fix + the
// Add-ons step skip.
//
// THE BUG (production, 2026-11-18): the guest booking-create path
// read the PRESENCE of the `otherAddOnSelections` key as "the guest
// selected an add-on". The guest client sends the key on every
// create — with an EMPTY map when the guest picked nothing — so on a
// hotel with the "Add-ons enabled" master switch OFF (OCT-M1) every
// booking was refused with:
//
//   "One of the selected add-ons is no longer available.
//    Please refresh and try again."
//
// The guest could not complete the booking flow at all. The
// production Spark Inn shape at the time: `otherAddOnsEnabled =
// false` AND the single catalog row (`airport-transfer`) disabled —
// so the Add-ons step was empty AND the booking was unfinishable.
//
// THE FIX (two halves):
//
//   1. The server refuses only a REAL selection (an entry with an
//      add-on id and a quantity > 0). "No add-ons" is a legitimate
//      booking and is never refused.
//   2. When the hotel has NO add-on options on sale at all, the
//      Add-ons step is SKIPPED — the guest goes straight from the
//      room picker to guest details, and the stepper shows the
//      steps the guest actually walks through.
//
// This file pins the RUNTIME rules (the two shared helpers) + the
// WIRING (the source-text guards — the pages + the handler cannot
// be mounted here because the repo has no jsdom/RTL harness for
// them). The create-path behaviour itself is pinned at runtime in
// `bookings-create.test.ts` ("AO-SKIP-01 — an empty other-add-ons
// selection is not a refusal").

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasBookableAddOns, requestsOtherAddOns } from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const bookingsHandlerSrc = read("guest-app/server/handlers/bookings.ts");
const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");
const corporateBookingPageSrc = read("guest-app/src/pages/CorporateBookingPage.tsx");
const sharedAddOnsSrc = read("shared/utils/addOns.ts");

describe("AO-SKIP-01 — what counts as an add-on REQUEST (runtime behaviour)", () => {
  it("an absent payload requests nothing", () => {
    expect(requestsOtherAddOns(undefined)).toBe(false);
    expect(requestsOtherAddOns(null)).toBe(false);
  });

  it("an EMPTY map requests nothing — the production bug's payload", () => {
    // This is the exact shape the guest client sent when the guest
    // picked no add-on. The server used to read the key's presence
    // as a request and refused the booking.
    expect(requestsOtherAddOns({})).toBe(false);
  });

  it("a map of empty arrays requests nothing", () => {
    expect(requestsOtherAddOns({ "2026-11-02": [], "2026-11-03": [] })).toBe(false);
  });

  it("entries with a quantity of 0 request nothing", () => {
    // The client sends a 0-quantity row when the guest zeroes a
    // stepper control. There is no purchase to refuse.
    expect(
      requestsOtherAddOns({
        "2026-11-02": [{ addOnId: "airport-transfer", quantity: 0 }]
      })
    ).toBe(false);
  });

  it("an entry with a quantity above 0 IS a request", () => {
    expect(
      requestsOtherAddOns({
        "2026-11-02": [{ addOnId: "airport-transfer", quantity: 2 }]
      })
    ).toBe(true);
  });

  it("a bare id with no quantity is not a request", () => {
    expect(
      requestsOtherAddOns({ "2026-11-02": [{ addOnId: "airport-transfer" }] })
    ).toBe(false);
  });

  it("an entry with a junk id is not a request", () => {
    expect(
      requestsOtherAddOns({ "2026-11-02": [{ addOnId: "   ", quantity: 2 }] })
    ).toBe(false);
  });

  it("one real request among empty groups still counts", () => {
    expect(
      requestsOtherAddOns({
        "2026-11-02": [],
        "2026-11-03": [{ addOnId: "seaport", quantity: 1 }]
      })
    ).toBe(true);
  });
});

describe("AO-SKIP-01 — is the Add-ons step worth showing? (runtime behaviour)", () => {
  it("a settled catalog with nothing on sale means the step is skipped", () => {
    expect(
      hasBookableAddOns({ breakfastEnabled: false, otherAddOnCount: 0, catalogSettled: true })
    ).toBe(false);
  });

  it("breakfast on sale keeps the step", () => {
    expect(
      hasBookableAddOns({ breakfastEnabled: true, otherAddOnCount: 0, catalogSettled: true })
    ).toBe(true);
  });

  it("another add-on on sale keeps the step", () => {
    expect(
      hasBookableAddOns({ breakfastEnabled: false, otherAddOnCount: 1, catalogSettled: true })
    ).toBe(true);
  });

  it("an UNSETTLED catalog keeps the step — 'we don't know yet' is not 'nothing'", () => {
    // Hiding the step on a guess would take away a step the guest
    // could have used (the catalog is still loading, or the fetch
    // failed).
    expect(
      hasBookableAddOns({ breakfastEnabled: false, otherAddOnCount: 0, catalogSettled: false })
    ).toBe(true);
  });
});

describe("AO-SKIP-01 — the server refuses only a REAL selection (wiring)", () => {
  it("the create path gates the validation block on the REQUEST rule", () => {
    expect(bookingsHandlerSrc).toMatch(/if \(requestsOtherAddOns\(rawOtherAddOns\)\)/);
    // The old guard — presence of the key — must be gone.
    expect(bookingsHandlerSrc).not.toMatch(
      /if \(rawOtherAddOns && typeof rawOtherAddOns === "object"\)/
    );
  });

  it("the refusal for a REAL selection is intact", () => {
    // The fix must not turn the price-authority rule into a no-op:
    // an add-on that is not on sale is still refused.
    expect(bookingsHandlerSrc).toMatch(
      /if \(live\.isEnabled === false\) \{\s*throw new Error\(OTHER_ADDON_NOT_AVAILABLE_ERROR\)/
    );
    expect(bookingsHandlerSrc).toMatch(
      /normalizeOtherAddOnsEnabled\(hotelConfig\.otherAddOnsEnabled\)/
    );
  });

  it("the shared helper lives in the shared utils (one rule, both apps)", () => {
    expect(sharedAddOnsSrc).toMatch(/export function requestsOtherAddOns/);
    expect(sharedAddOnsSrc).toMatch(/export function hasBookableAddOns/);
  });
});

describe("AO-SKIP-01 — the guest client (wiring)", () => {
  it("an EMPTY draft is omitted from the create payload", () => {
    // The key must not be on the wire when it carries no selection.
    expect(bookingPageSrc).toMatch(
      /\.\.\.\(Object\.keys\(otherAddOnDraft\)\.length > 0\s*\?\s*\{\s*otherAddOnSelections: otherAddOnDraft\s*\}\s*:\s*\{\}\)/
    );
  });

  it("the Add-ons step is skipped when the hotel has no add-on options on sale", () => {
    expect(bookingPageSrc).toMatch(/const hideAddOnsStep = !hasBookableAddOns\(\{/);
    expect(bookingPageSrc).toMatch(/breakfastEnabled: breakfastConfig\.isEnabled/);
    expect(bookingPageSrc).toMatch(/otherAddOnCount: otherAddOnsCatalog\.addOns\.length/);
    // The catalog must have settled before the step is hidden.
    expect(bookingPageSrc).toMatch(/const otherAddOnsCatalogSettled =\s*!otherAddOnsCatalog\.isLoading && !otherAddOnsCatalog\.error/);
  });

  it("a guest who lands on the skipped step is moved on to guest details", () => {
    expect(bookingPageSrc).toMatch(/if \(!isAddOnsStep \|\| !hideAddOnsStep\) return;/);
    expect(bookingPageSrc).toMatch(/next\.set\("step", STEP_KEYS\.guestDetails\)/);
  });

  it("the step list is DERIVED, so the stepper cannot show a step that is not there", () => {
    expect(bookingPageSrc).toMatch(/const visibleStepKeys = hideAddOnsStep/);
    expect(bookingPageSrc).toMatch(/const steps = visibleStepKeys\.map/);
    expect(bookingPageSrc).toMatch(/const currentStepNumber = Math\.max\(/);
    expect(bookingPageSrc).toMatch(/const totalStepCount = visibleStepKeys\.length/);
    // The eyebrow + the stepper both read the derived numbers.
    expect(bookingPageSrc).toMatch(/Step \{currentStepNumber\} of \{totalStepCount\}/);
    expect(bookingPageSrc).toMatch(/<StepIndicator steps=\{steps\} currentStep=\{currentStepNumber\} \/>/);
  });

  it("the Step 1 CTA goes straight to guest details when the step is skipped", () => {
    expect(bookingPageSrc).toMatch(/const stepOneContinueParams = new URLSearchParams\(continueParams\)/);
    expect(bookingPageSrc).toMatch(/stepOneContinueParams\.set\("step", STEP_KEYS\.guestDetails\)/);
    expect(bookingPageSrc).toMatch(/hideAddOnsStep \? "Continue to guest details" : "Continue to add-ons"/);
  });

  it("back from guest details returns to the room picker when the step is skipped", () => {
    // Otherwise back would land on a step the guest never saw.
    expect(bookingPageSrc).toMatch(/if \(hideAddOnsStep\) \{\s*const step1Params = new URLSearchParams\(continueParams\)/);
  });
});

describe("AO-SKIP-01 — the corporate client (wiring)", () => {
  it("the corporate flow is a 4-step model (the Add-ons step is skipped)", () => {
    expect(corporateBookingPageSrc).toMatch(
      /\[\s*"Select Room"\s*,\s*"Guest Details"\s*,\s*"Review & Pay"\s*,\s*"Confirmation"\s*\]/
    );
    expect(corporateBookingPageSrc).not.toMatch(
      /\[\s*"Select Room"\s*,\s*"Add-ons"\s*,\s*"Guest Details"\s*,\s*"Review & Pay"\s*,\s*"Confirmation"\s*\]/
    );
  });

  it("the corporate Step 1 goes straight to guest details", () => {
    expect(corporateBookingPageSrc).toMatch(/const continueParams = new URLSearchParams\(\{\s*step: "guest-details"/);
  });

  it("a corporate guest who lands on the old Add-ons step is moved on", () => {
    expect(corporateBookingPageSrc).toMatch(/if \(currentStepKey !== "add-ons"\) return;/);
    expect(corporateBookingPageSrc).toMatch(/next\.set\("step", "guest-details"\)/);
  });
});
