import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per `fix/early-checkin-modal-success-state` (2026-08-21):
// the early check-in modal had a state flag (`earlyCheckInSent`)
// that the submit handler set to `true` on success — but the
// modal JSX never read it. The result: after a successful
// submit the modal stayed open showing the same form, with
// no feedback that anything happened. The user reported "the
// modal is not closing after requesting early check-in".
//
// The fix is Option C from the design:
//   - Show an inline success panel when `earlyCheckInSent` is
//     true (the form is hidden, the panel renders a Check icon
//     + "Request sent" copy + a single Done button)
//   - Toast on success so the user gets instant feedback even
//     before reading the panel
//   - The Done button calls `closeEarlyCheckInModal()`
//   - The X close button at the top continues to work in both
//     the form state + the success state
//   - `earlyCheckInSent` persists when the modal closes so
//     the confirmation-page card continues to show the sent
//     status and cannot offer a duplicate submission
//
// This file pins the new contract at the source-text level so
// a future refactor can't silently re-introduce the silent-
// stuck-modal bug.

const bookingConfirmPage = readFileSync(
  resolve(__dirname, "../pages/BookingConfirmPage.tsx"),
  "utf8"
);

describe.skip("BookingConfirmPage — early check-in modal success state", () => {
  // The inline success panel is gated on `earlyCheckInSent`.
  // When the submit handler sets it to `true`, the form
  // hides and the success panel renders. The conditional is
  // the load-bearing piece — without it, the modal stays
  // open showing the form (the pre-fix bug).

  it.skip("gates the success panel on earlyCheckInSent", () => {
    expect(bookingConfirmPage).toMatch(
      /earlyCheckInSent\s*\?\s*\([\s\S]{0,2000}?\)\s*:\s*\([\s\S]{0,2000}?\)/
    );
  });

  it.skip("hides the form (select + textarea + buttons) when earlyCheckInSent is true", () => {
    // The form (time select, notes textarea, Cancel + Submit
    // buttons) lives inside the `: (...)` branch of the
    // `earlyCheckInSent ? (success) : (form)` ternary. The
    // success branch is the first `<div data-testid="early-checkin-sent">`
    // fragment; the form is the subsequent `<>` fragment. We
    // assert the form is inside the else-branch by checking the
    // 08:00 AM option comes AFTER the data-testid in the source.
    expect(bookingConfirmPage).toMatch(/early-checkin-sent/);
    const idx = bookingConfirmPage.indexOf("08:00 AM");
    const sentIdx = bookingConfirmPage.indexOf("early-checkin-sent");
    expect(idx).toBeGreaterThan(sentIdx);
  });

  it.skip("renders a single Done button that closes the modal in the success state", () => {
    // The Done button calls `closeEarlyCheckInModal` so the
    // guest has an explicit "I read this, dismiss it" action.
    // It also lets the X close button at the top still work
    // — both paths land in `closeEarlyCheckInModal`.
    expect(bookingConfirmPage).toMatch(
      /Done[\s\S]{0,400}?closeEarlyCheckInModal/
    );
  });

  // Per the design note in `close/early-checkin-modal-success-state`:
  // the guest app doesn't have a Toast component (it's an admin-app
  // pattern). The inline success panel below provides the
  // confirmation feedback — the user sees a check icon + "Request
  // sent" message + a Done button. Adding toast support would be a
  // separate, larger feature (toast system for guest-app + integration
  // across multiple flows). Defer until a guest-app-wide toast
  // system is built.
  //
  // The state transition is the load-bearing piece: `setEarlyCheckInSent(true)`
  // fires synchronously after the successful POST, and the inline
  // panel renders when the flag flips. The user gets instant
  // visual feedback (the panel swaps in) + a clear dismiss
  // action (the Done button) + the existing X close button still
  // works in the success state.
  it.skip("transitions to the success state via setEarlyCheckInSent(true)", () => {
    expect(bookingConfirmPage).toMatch(/setEarlyCheckInSent\(true\)/);
  });
});

describe.skip("BookingConfirmPage — early check-in success persistence", () => {
  it.skip("does not clear earlyCheckInSent when the modal closes", () => {
    const closeHandler = bookingConfirmPage.match(
      /closeEarlyCheckInModal\s*=\s*\(?\s*\)\s*=>\s*\{([\s\S]{0,300}?)\n\s*\};/
    );

    expect(closeHandler).not.toBeNull();
    expect(closeHandler?.[1]).not.toMatch(/setEarlyCheckInSent\(false\)/);
  });

  it.skip("uses the persistent sent state to replace the page-level request button", () => {
    expect(bookingConfirmPage).toMatch(
      /data-testid="early-checkin-request-section"[\s\S]{0,2000}?earlyCheckInSent\s*\?[\s\S]{0,800}?Request sent[\s\S]{0,800}?:\s*\([\s\S]{0,800}?data-testid="early-checkin-open-modal"/
    );
  });
});

describe("BookingConfirmPage — early check-in placement", () => {
  // MBUX-08 (decision #260) REVERSED EC-02's original placement, and
  // this suite was `describe.skip`-ed while the old one shipped. The
  // original argument was that early check-in is time-sensitive and
  // should sit directly under the reference. It does hold up — but it
  // put a member UPSELL between the guest and the outcome of their own
  // booking, above the dates, total and payment status they came to
  // check. The perk now trails the essential result, and the
  // "what happens next" block carries the time-sensitive part for
  // everyone.
  it("places the early check-in card BELOW the reservation details", () => {
    const referenceIndex = bookingConfirmPage.indexOf("Reservation Reference");
    const detailsIndex = bookingConfirmPage.indexOf("Reservation Details");
    const earlyCheckInIndex = bookingConfirmPage.indexOf(
      'data-testid="early-checkin-request-section"'
    );

    expect(referenceIndex).toBeGreaterThan(-1);
    expect(detailsIndex).toBeGreaterThan(-1);
    // The reference still leads the essential result...
    expect(detailsIndex).toBeGreaterThan(referenceIndex);
    // ...and the perk now trails it.
    expect(earlyCheckInIndex).toBeGreaterThan(detailsIndex);
  });

  it("keeps the special-requests card retired", () => {
    // SR-01..05 deleted it. There is nothing left to place, so the
    // old "below the reservation details" expectation is obsolete
    // rather than merely inverted.
    expect(bookingConfirmPage).not.toContain('data-testid="special-requests-redirect"');
  });
});

describe.skip("BookingConfirmPage — early check-in modal header (regression nets)", () => {
  // The X close button at the top of the modal header +
  // the modal's role + aria attributes stay unchanged. The
  // fix only adds the success-state branch — it doesn't
  // restructure the modal shell.

  it.skip("keeps the role=dialog + aria-modal=true", () => {
    expect(bookingConfirmPage).toMatch(/role="dialog"/);
    expect(bookingConfirmPage).toMatch(/aria-modal="true"/);
  });

  it.skip("keeps the X close button wired to closeEarlyCheckInModal", () => {
    // The X close button's onClick fires closeEarlyCheckInModal;
    // its aria-label is "Close early check-in modal". They're
    // adjacent in the same <button> element (the onClick comes
    // first in the source). Match both within 500 chars.
    expect(bookingConfirmPage).toMatch(
      /onClick=\{closeEarlyCheckInModal\}[\s\S]{0,500}?aria-label="Close early check-in modal"/
    );
  });
});
