import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per `fix/booking-autofill-member-profile-race` (2026-08-22):
// the booking autofill feature used a `useState` lazy initializer
// to pre-fill Step 2 from `memberProfile`. The initializer ran
// ONCE on mount — but `memberProfile` arrives asynchronously via
// `onAuthStateChanged` + Firestore `onSnapshot` (typically 200–500ms
// after mount). The result: the initializer always saw
// `memberProfile = null` and every autofill branch fell through
// to `""`. The form fields stayed empty even for signed-in
// members.
//
// This was invisible to the existing source-text autofill tests
// because they pin the source code has the autofill logic —
// none of them pin the *timing* (a `useEffect` that re-syncs
// when `memberProfile` arrives). The fix adds the re-sync.
//
// This file pins the new contract at the source-text level:
//
//   1. A `useEffect` exists in `BookingPage.tsx` that depends on
//      the relevant member-profile fields. The effect re-applies
//      the autofill when the profile arrives (or when it changes).
//   2. The effect ONLY fires when `memberProfile?.isMember` is
//      true (signed-in members only; non-members don't trigger).
//   3. The effect ONLY fills empty fields (preserves user edits).
//   4. The same pattern is mirrored in `CorporateBookingPage.tsx`
//      so the corporate /corporate/book flow gets the fix too.
//   5. The existing autofill logic (initializer + readOnly +
//      updateGuestDetail short-circuit) stays intact — the new
//      useEffect is additive.
//
// The pre-fix source has no such useEffect, so these tests are
// red until the fix lands.

const bookingPage = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

const corporateBookingPage = readFileSync(
  resolve(__dirname, "../../src/pages/CorporateBookingPage.tsx"),
  "utf8"
);

describe("BookingPage.tsx — autofill re-sync when memberProfile arrives", () => {
  // The new contract: a `useEffect` watches the member profile
  // and re-applies the autofill when it lands. The dependencies
  // are the four member-profile fields used by autofill
  // (fullName, email, phone, isMember) so the effect re-runs
  // on any change.

  it("declares a useEffect that depends on the member-profile fields", () => {
    // Match the new effect: it must be a `useEffect(...)` whose
    // dependency array contains `memberProfile?.isMember` and the
    // three profile fields. Without these deps the effect won't
    // re-run when the snapshot lands.
    expect(bookingPage).toMatch(
      /useEffect\([\s\S]{0,1500}?\[\s*(?:[\s\S]{0,80}?memberProfile\?\.isMember[\s\S]{0,500}?)\][\s\S]{0,200}?\)/
    );
  });

  it("the autofill re-sync effect only runs when memberProfile.isMember is true", () => {
    // The effect must early-return when `!memberProfile?.isMember`
    // so non-members don't accidentally trigger an autofill branch
    // (their profile is `null` so the current autofill returns ""
    // — but the early-return makes the intent explicit and
    // protects against future profile-shape changes).
    expect(bookingPage).toMatch(
      /useEffect\([\s\S]{0,1500}?!\s*memberProfile\?\.isMember[\s\S]{0,200}?return/
    );
  });

  it("the autofill re-sync only fills empty fields (preserves user edits)", () => {
    // The "user typed before snapshot landed" edge case: a
    // signed-in member lands on /book, starts typing in the
    // first-name field within 200ms before the snapshot lands,
    // then the snapshot arrives. Pre-fix this would have left
    // the field empty (snapshot is async). Post-fix the effect
    // only fills empty fields — if the user already typed
    // something, their value wins. The test pins the guard
    // `prev.firstName || derivedFirstName` shape.
    expect(bookingPage).toMatch(
      /guestDetails\?\.firstName\s*\|\|\s*memberProfile\.fullName\.split\(["']\s*["']\)|setGuestDetails[\s\S]{0,500}?prev\.firstName\s*\|\|/
    );
  });
});

describe("BookingPage.tsx — autofill timing contract (regression net)", () => {
  // The pre-fix autofill (initializer + readOnly + updateGuestDetail
  // short-circuit) must stay intact. The fix is ADDITIVE — it
  // adds a useEffect on top of the existing logic, doesn't
  // replace it.

  it("keeps the existing guestDetails initializer that reads memberProfile at mount", () => {
    // The initializer stays so the first render (when
    // memberProfile happens to be already in cache from a
    // previous session — e.g. sign-in-then-navigate-fast) is
    // still populated immediately. The new useEffect handles
    // the case where the profile is NOT yet cached.
    // Match the full firstName initializer block: the
    // `memberProfile?.isMember && memberProfile.fullName`
    // check followed (within the same initializer) by the
    // `.split(" ")[0]` derivation.
    expect(bookingPage).toMatch(
      /memberProfile\?\.isMember\s*&&\s*memberProfile\.fullName\s*\n\s*\?\s*memberProfile\.fullName\.split\(\s*["']\s*["']\s*\)\[0\]/
    );
  });

  it("keeps the existing email <TextField> readOnly wiring", () => {
    // The lock pattern (readOnly + updateGuestDetail short-circuit)
    // is unchanged. The fix only adds the re-sync, doesn't
    // touch the locking logic.
    const emailFieldBlock = bookingPage.match(
      /<TextField[\s\S]*?autoComplete="email"[\s\S]*?\/>/,
    );
    expect(emailFieldBlock, "email <TextField> block not found").toBeTruthy();
    expect(emailFieldBlock![0]).toContain(
      'readOnly={!!memberProfile?.isMember}'
    );
  });

  it("keeps the existing name <TextField> readOnly wiring", () => {
    const firstNameFieldBlock = bookingPage.match(
      /<TextField[\s\S]*?autoComplete="given-name"[\s\S]*?\/>/,
    );
    expect(firstNameFieldBlock, "firstName <TextField> block not found").toBeTruthy();
    expect(firstNameFieldBlock![0]).toContain(
      'readOnly={!!memberProfile?.isMember}'
    );
  });
});

describe("CorporateBookingPage.tsx — autofill re-sync when memberProfile arrives", () => {
  // Corporate booking has the identical bug + identical fix.
  // These tests mirror the BookingPage.tsx tests above.

  it("declares a useEffect that depends on the member-profile fields", () => {
    expect(corporateBookingPage).toMatch(
      /useEffect\([\s\S]{0,1500}?\[\s*(?:[\s\S]{0,80}?memberProfile\?\.isMember[\s\S]{0,500}?)\][\s\S]{0,200}?\)/
    );
  });

  it("the autofill re-sync effect only runs when memberProfile.isMember is true", () => {
    expect(corporateBookingPage).toMatch(
      /useEffect\([\s\S]{0,1500}?!\s*memberProfile\?\.isMember[\s\S]{0,200}?return/
    );
  });

  it("the autofill re-sync only fills empty fields (preserves user edits)", () => {
    expect(corporateBookingPage).toMatch(
      /guestDetails\?\.firstName\s*\|\|\s*memberProfile\.fullName\.split\(["']\s*["']\)|setGuestDetails[\s\S]{0,500}?prev\.firstName\s*\|\|/
    );
  });
});
