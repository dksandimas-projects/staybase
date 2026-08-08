import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per NBS-2026-08-08 (F2 + F5 + F11, booking-flow audit
// 2026-08-08): the public `/book` Step 3 flow now:
//   - (F2) maps every server-side 4xx to a recovery
//     action surfaced as a CTA in the sticky footer.
//     The `submitErrorAction: "back-to-step-1" | "retry" | "none"`
//     discriminator replaces the previous "only
//     auto-redirect for Room not available" pattern.
//   - (F5) ANDs `guestDetails.consent` + `termsConsent`
//     in the `canConfirm` gate so the Step 3 checkbox
//     is no longer the only consent the server
//     validates against. A guest who only ticked
//     Step 3 hit a silent server 400 "Privacy policy
//     consent is required." before the fix.
//   - (F11) holds the 5s auto-redirect timer on a
//     `useRef` so a user-initiated nav (clicking the
//     back CTA or the browser back button) cancels
//     the timer. The previous bare `setTimeout`
//     raced the manual nav and clobbered the URL
//     the user already moved to.

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("NBS-2026-08-08 — guest /book error recovery + consent wiring + auto-redirect (F2 + F5 + F11)", () => {
  describe("F2 — error recovery CTA on Step 3", () => {
    it("declares submitErrorAction state alongside submitError", () => {
      // The recovery action is its own state
      // variable (not a derived value) so the
      // catch block can update it independently
      // of the message. The initial value is
      // "none" — no recovery CTA is rendered
      // until an error sets it.
      const declMatch = bookingPageSrc.match(
        /const \[submitErrorAction, setSubmitErrorAction\] = useState<"back-to-step-1" \| "retry" \| "none">\("none"\)/
      );
      expect(declMatch).not.toBeNull();
    });

    it("maps the room-not-available error to the back-to-step-1 action", () => {
      // The previous path only auto-redirected
      // for this case. The F2 fix surfaces a
      // manual CTA alongside the auto-redirect
      // so the user can act before the 5s
      // elapses.
      const mapMatch = bookingPageSrc.match(
        /if \(err\.message === "Room no longer available"\) \{[\s\S]*?setSubmitErrorAction\("back-to-step-1"\)/
      );
      expect(mapMatch).not.toBeNull();
    });

    it("maps the MAX_STAY_NIGHTS error to back-to-step-1", () => {
      // The MAX_STAY_NIGHTS error is now
      // matched against the server's message
      // and routed to the back-to-step-1 CTA
      // — a 3-week stay hit a stranded
      // generic message before the fix. The
      // check is anchored to the JS regex
      // literal `/maximum stay length|max.*stay.*night/i`
      // (the `.*` are dot-star regex tokens
      // inside the JS regex literal).
      const mapMatch = bookingPageSrc.match(
        /\/maximum stay length\|max\..*stay\..*night\/i/
      );
      expect(mapMatch).not.toBeNull();
    });

    it("maps the MAX_ADVANCE_DAYS error to back-to-step-1", () => {
      // Same pattern as MAX_STAY_NIGHTS — a
      // far-future booking hits a stranded
      // message before the fix.
      const mapMatch = bookingPageSrc.match(
        /\/in advance\|advance\..*days\/i/
      );
      expect(mapMatch).not.toBeNull();
    });

    it("maps the past-checkin error to back-to-step-1", () => {
      // The past-checkin case (BI-12, 2026-07-06)
      // gets the same back-to-step-1 routing.
      // The check is anchored to the literal
      // `errorMessage) && /check-?in|date/i.test(errorMessage)`
      // pattern (a substring of the source's
      // `else if` arm) so the regex escape
      // quirks are sidestepped.
      const mapMatch = bookingPageSrc.includes(
        "errorMessage) && /check-?in|date/i.test(errorMessage)"
      );
      expect(mapMatch).toBe(true);
    });

    it("maps the rate-limit error to retry", () => {
      // The rate-limit error is a transient
      // case — back-to-step-1 wouldn't help,
      // so the CTA is a "Dismiss and try again"
      // button that resets the submitting
      // state. The user can re-click Confirm
      // after waiting a minute.
      const mapMatch = bookingPageSrc.match(
        /\/too many\|rate\..*limit\/i/
      );
      expect(mapMatch).not.toBeNull();
    });

    it("renders a back-to-step-1 CTA when submitErrorAction === 'back-to-step-1'", () => {
      // The CTA navigates the user back to
      // Step 1 by clearing the `step` +
      // `roomType` URL params. The handler
      // also cancels the auto-redirect timer
      // (F11) so the manual nav doesn't race
      // the auto-nav.
      const renderMatch = bookingPageSrc.match(
        /\{submitErrorAction === "back-to-step-1" && \([\s\S]*?Back to room selection/
      );
      expect(renderMatch).not.toBeNull();
    });

    it("renders a retry CTA when submitErrorAction === 'retry'", () => {
      const renderMatch = bookingPageSrc.match(
        /\{submitErrorAction === "retry" && \([\s\S]*?Dismiss and try again/
      );
      expect(renderMatch).not.toBeNull();
    });
  });

  describe("F5 — consent wiring", () => {
    it("the canConfirm gate ANDs guestDetails.consent + termsConsent", () => {
      // The previous gate only read
      // `termsConsent`; the server validates
      // `guestDetails.consent` (the Step 2
      // field). The F5 fix ANDs both so the
      // gate matches the server's expectation
      // and the guest sees the missing-consent
      // CTA on Step 3 instead of a server
      // 400.
      const gateMatch = bookingPageSrc.match(
        /const canConfirm = guestDetails\.consent && termsConsent && !isIdUploadRequired && !isPaymentProofRequired && cartIsReady && Boolean\(turnstileToken\)/
      );
      expect(gateMatch).not.toBeNull();
    });

    it("the sticky footer status line surfaces the missing Step 2 consent before Step 3 terms", () => {
      // The footer renders the
      // "Confirm your guest details consent on
      // the previous step" hint when Step 2's
      // box is unchecked. The hint is shown
      // BEFORE the Step 3 terms-unchecked
      // hint so the user sees the gate
      // they're about to trip on the server.
      const statusMatch = bookingPageSrc.match(
        /!guestDetails\.consent\s*\n\s*\? "Confirm your guest details consent on the previous step"/
      );
      expect(statusMatch).not.toBeNull();
    });
  });

  describe("F11 — auto-redirect timer is cancellable", () => {
    it("declares redirectTimerRef as a useRef<number | null>", () => {
      // The ref holds the timer id so the
      // manual-nav CTA + the cleanup effect
      // can cancel it. A bare
      // `setTimeout(...)` would not be
      // cancellable.
      const refMatch = bookingPageSrc.match(
        /const redirectTimerRef = useRef<number \| null>\(null\)/
      );
      expect(refMatch).not.toBeNull();
    });

    it("the auto-redirect setTimeout stores its id in the ref", () => {
      const setMatch = bookingPageSrc.match(
        /redirectTimerRef\.current = window\.setTimeout\(/
      );
      expect(setMatch).not.toBeNull();
    });

    it("the cleanup effect cancels the timer on unmount", () => {
      // The user navigated away from Step 3
      // manually before the 5s elapsed; the
      // cleanup cancels the pending timer so
      // it doesn't fire after unmount.
      const cleanupMatch = bookingPageSrc.match(
        /useEffect\(\(\) => \{[\s\S]*?return \(\) => \{[\s\S]*?if \(redirectTimerRef\.current !== null\) \{[\s\S]*?window\.clearTimeout\(redirectTimerRef\.current\)/
      );
      expect(cleanupMatch).not.toBeNull();
    });

    it("the manual back-to-step-1 CTA cancels the timer before navigating", () => {
      // The user clicks the back CTA before
      // the 5s elapses; the handler cancels
      // the timer so the manual nav doesn't
      // race the auto-nav.
      const cancelMatch = bookingPageSrc.match(
        /onClick=\{\(\) => \{[\s\S]*?if \(redirectTimerRef\.current !== null\) \{[\s\S]*?window\.clearTimeout\(redirectTimerRef\.current\)[\s\S]*?setSearchParams\(nextParams\)/
      );
      expect(cancelMatch).not.toBeNull();
    });

    it("a fresh handleConfirmBooking submit cancels the timer before re-firing", () => {
      // The user clicks Confirm again
      // before the 5s elapsed; the submit
      // handler cancels the pending timer
      // first so the new request's
      // navigation is the only one that
      // lands.
      const cancelMatch = bookingPageSrc.match(
        /async function handleConfirmBooking\(\) \{[\s\S]*?if \(redirectTimerRef\.current !== null\) \{[\s\S]*?window\.clearTimeout\(redirectTimerRef\.current\)/
      );
      expect(cancelMatch).not.toBeNull();
    });
  });
});
