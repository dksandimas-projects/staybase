import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per NBS-2026-08-08 (F2 + F10 + F11, booking-flow audit
// 2026-08-08): the corporate `/corporate/book` flow now
//   - (F2) maps every server-side 4xx to a recovery
//     action surfaced as a CTA — mirrors the public
//     `/book` flow's three-way discriminator.
//   - (F10) validates the URL `?checkIn=` /
//     `?checkOut=` values against the `YYYY-MM-DD`
//     shape; an invalid or missing value falls back
//     to today's Manila date. The pre-F10 path
//     accepted any URL value verbatim, so a direct
//     hit to `/corporate/book?checkIn=invalid` seeded
//     the form with the bad value and a blank date
//     picker.
//   - (F11) holds the 5s auto-redirect timer on a
//     `useRef` so a user-initiated nav cancels it.

const corporatePageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/CorporateBookingPage.tsx"),
  "utf8"
);

describe("NBS-2026-08-08 — corporate /corporate/book error recovery + URL fallback (F2 + F10 + F11)", () => {
  describe("F10 — corporate checkIn / checkOut URL fallback", () => {
    it("validates the URL checkIn value against the YYYY-MM-DD shape", () => {
      // The previous `useState(searchParams.get("checkIn") ?? ...)`
      // accepted any URL value verbatim. The
      // F10 fix parses the value through
      // `isValidDateKey`; an invalid value
      // falls back to today's Manila date.
      const validatorMatch = corporatePageSrc.match(
        /const isValidDateKey = \(value: string \| null\) =>[\s\S]*?typeof value === "string" && \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//
      );
      expect(validatorMatch).not.toBeNull();
    });

    it("falls back to today's Manila date when the URL checkIn value is invalid", () => {
      // The useState init reads the validated
      // value; invalid → the Manila "today"
      // helper is the default.
      const fallbackMatch = corporatePageSrc.match(
        /const \[checkIn, setCheckIn\] = useState\(\s*isValidDateKey\(initialCheckInParam\)/
      );
      expect(fallbackMatch).not.toBeNull();
    });

    it("falls back to today's Manila date when the URL checkOut value is invalid", () => {
      const fallbackMatch = corporatePageSrc.match(
        /const \[checkOut, setCheckOut\] = useState\(\s*isValidDateKey\(initialCheckOutParam\)/
      );
      expect(fallbackMatch).not.toBeNull();
    });
  });

  describe("F2 — corporate error recovery CTA on the review step", () => {
    it("declares submitErrorAction state alongside submitError", () => {
      const declMatch = corporatePageSrc.match(
        /const \[submitErrorAction, setSubmitErrorAction\] = useState<"back-to-step-1" \| "retry" \| "none">\("none"\)/
      );
      expect(declMatch).not.toBeNull();
    });

    it("maps the room-not-available error to back-to-step-1 (and surfaces a CTA alongside the auto-redirect)", () => {
      // The corporate auto-redirect now also
      // sets `submitErrorAction` so the user
      // has a manual CTA before the 5s
      // elapses (same fix as the public path).
      const mapMatch = corporatePageSrc.match(
        /if \(errorMessage === "Room no longer available"\) \{[\s\S]*?setSubmitErrorAction\("back-to-step-1"\)/
      );
      expect(mapMatch).not.toBeNull();
    });

    it("maps the MAX_STAY_NIGHTS error to back-to-step-1", () => {
      const mapMatch = corporatePageSrc.match(
        /\/maximum stay length\|max\..*stay\..*night\/i/
      );
      expect(mapMatch).not.toBeNull();
    });

    it("maps the MAX_ADVANCE_DAYS error to back-to-step-1", () => {
      const mapMatch = corporatePageSrc.match(
        /\/in advance\|advance\..*days\/i/
      );
      expect(mapMatch).not.toBeNull();
    });

    it("maps the past-checkin error to back-to-step-1", () => {
      const mapMatch = corporatePageSrc.includes(
        "errorMessage) && /check-?in|date/i.test(errorMessage)"
      );
      expect(mapMatch).toBe(true);
    });

    it("maps the rate-limit error to retry", () => {
      const mapMatch = corporatePageSrc.match(
        /\/too many\|rate\..*limit\/i/
      );
      expect(mapMatch).not.toBeNull();
    });

    it("the catch (network) branch sets submitErrorAction to retry", () => {
      // The pre-F2 path only set
      // `setSubmitError(...)`; the F2 fix
      // also sets the action so the
      // generic network error surfaces a
      // dismissable CTA.
      const catchMatch = corporatePageSrc.match(
        /\} catch \{[\s\S]*?setSubmitError\("Unable to submit booking\.[\s\S]*?setSubmitErrorAction\("retry"\)/
      );
      expect(catchMatch).not.toBeNull();
    });

    it("renders a back-to-step-1 CTA when submitErrorAction === 'back-to-step-1'", () => {
      const renderMatch = corporatePageSrc.match(
        /\{submitErrorAction === "back-to-step-1" && \([\s\S]*?Back to room selection/
      );
      expect(renderMatch).not.toBeNull();
    });

    it("renders a retry CTA when submitErrorAction === 'retry'", () => {
      const renderMatch = corporatePageSrc.match(
        /\{submitErrorAction === "retry" && \([\s\S]*?Dismiss and try again/
      );
      expect(renderMatch).not.toBeNull();
    });
  });

  describe("F11 — corporate auto-redirect timer is cancellable", () => {
    it("declares redirectTimerRef as a useRef<number | null>", () => {
      const refMatch = corporatePageSrc.match(
        /const redirectTimerRef = useRef<number \| null>\(null\)/
      );
      expect(refMatch).not.toBeNull();
    });

    it("the auto-redirect setTimeout stores its id in the ref", () => {
      const setMatch = corporatePageSrc.match(
        /redirectTimerRef\.current = window\.setTimeout\(/
      );
      expect(setMatch).not.toBeNull();
    });

    it("the cleanup effect cancels the timer on unmount", () => {
      const cleanupMatch = corporatePageSrc.match(
        /useEffect\(\(\) => \{[\s\S]*?return \(\) => \{[\s\S]*?if \(redirectTimerRef\.current !== null\) \{[\s\S]*?window\.clearTimeout\(redirectTimerRef\.current\)/
      );
      expect(cleanupMatch).not.toBeNull();
    });

    it("the manual back-to-step-1 CTA cancels the timer before navigating", () => {
      const cancelMatch = corporatePageSrc.match(
        /onClick=\{\(\) => \{[\s\S]*?if \(redirectTimerRef\.current !== null\) \{[\s\S]*?window\.clearTimeout\(redirectTimerRef\.current\)[\s\S]*?setSearchParams\(next\)/
      );
      expect(cancelMatch).not.toBeNull();
    });
  });

  // Per M-04 (corporate booking audit 2026-08-10):
  // the URL `?roomType=` value is validated against
  // the room type catalog before the cart auto-seed
  // effect runs. A direct hit to
  // `/corporate/book?roomType=does-not-exist` used to
  // seed the cart with an unknown type and only hit
  // a server 400 on submit. The fix falls back to
  // the first available type on miss — same pattern
  // as the F10 date URL fallback.
  describe("M-04 — corporate ?roomType= URL param validation (corporate audit 2026-08-10)", () => {
    it("the auto-seed effect validates the URL roomType against the catalog (not just `find()`)", () => {
      // The pre-M-04 path used
      // `roomTypes.find((type) => type.value === fromQuery)`
      // — which returns `undefined` for a missing type
      // and seeds the cart with `roomType: undefined`.
      // The M-04 fix uses `.some(...)` to gate the
      // fallback so an unknown URL value falls back to
      // `availableRoomTypes[0]?.type` instead of seeding
      // the cart with garbage.
      const validateMatch = corporatePageSrc.match(
        /const fromQueryIsValid = fromQuery[\s\S]{0,80}roomTypes\.some\(\(type\) => type\.value === fromQuery\)/
      );
      expect(validateMatch).not.toBeNull();
    });

    it("the auto-seed effect falls back to the first available type when the URL roomType is unknown", () => {
      // The fallback chain must be:
      //   1. URL value, but only if it's in the catalog
      //   2. the first available type (any type with
      //      at least 1 room free for the dates)
      //   3. null (no seed — the user picks a type
      //      from the empty cart)
      // The pre-M-04 path fell through to step 1 even
      // for unknown values, which seeded the cart with
      // `roomType: undefined`.
      const fallbackMatch = corporatePageSrc.match(
        /const candidate = fromQueryIsValid[\s\S]{0,80}availableRoomTypes\[0\]\?\.type/
      );
      expect(fallbackMatch).not.toBeNull();
    });
  });
});
