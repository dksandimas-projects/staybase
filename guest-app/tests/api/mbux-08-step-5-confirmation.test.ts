import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveConfirmationStatus,
  isOnlinePaymentMethod,
  type ConfirmationPaymentState
} from "../../src/utils/confirmationStatus";

// MBUX-08 — Step 5 confirmation hierarchy and truthful status copy.
//
// Phase 15 / decision #260. Owning spec:
// `plan/features/BOOKING-MOBILE-UX.md §Step 5 — Confirmation`.
//
// THE DEFECT THIS FILE EXISTS TO PIN
// ----------------------------------
// Step 5 derived every line of status copy from ONE boolean —
// `isOnlinePayment`. That boolean answers "which METHOD was chosen",
// not "what STATE is the payment in", so it could not distinguish
// proof-uploaded from payment-verified. Consequences that shipped:
//
//   1. A guest whose payment staff had ALREADY verified still read
//      "Booking submitted for review".
//   2. The email line told every online guest "official confirmation
//      will follow after payment verification" — including those
//      already verified.
//   3. Nothing on the page ever said whether anything was still owed
//      OF the guest.
//
// The `status` the create endpoint already returns was on the page
// the whole time (it gates the early-check-in widget). Only the COPY
// refused to read it.
//
// TWO KINDS OF TEST, deliberately (see
// `plan/docs/CONTRIBUTING.md §Testing`):
//
//   - `resolveConfirmationStatus` is asserted BEHAVIOURALLY. The rule
//     that matters is a PRECEDENCE ("verified beats awaiting proof",
//     "proof received beats online"), and a regex cannot express
//     precedence. A source-text pin here would pass happily while the
//     headline kept lying.
//   - The page surfaces are pinned source-text.

const repoRoot = resolve(__dirname, "../../..");

const confirmPage = readFileSync(
  resolve(repoRoot, "guest-app/src/pages/BookingConfirmPage.tsx"),
  "utf8"
);

/**
 * The page source with comments removed.
 *
 * MBUX-08 adds comments that NAME the things it deleted ("isOnlinePayment
 * is gone", "usePublicSiteContent was dead"). Absence-assertions run
 * against this, not the raw file, so the documentation of a removal can
 * never be mistaken for the removal failing.
 */
function codeOnly(src: string): string {
  return src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

const confirmCode = codeOnly(confirmPage);

const base = {
  paymentMethod: "gcash",
  paymentMethodLabel: "GCash",
  brandName: "Spark Inn"
} as const;

function stateFor(paymentMethod: string, bookingStatus: string): ConfirmationPaymentState {
  return resolveConfirmationStatus({ ...base, paymentMethod, bookingStatus }).paymentState;
}

describe("MBUX-08 — isOnlinePaymentMethod", () => {
  it("treats gcash and bank as the online methods", () => {
    expect(isOnlinePaymentMethod("gcash")).toBe(true);
    expect(isOnlinePaymentMethod("bank")).toBe(true);
  });

  it("is case- and whitespace-insensitive, because the value is a URL param", () => {
    expect(isOnlinePaymentMethod(" GCash ")).toBe(true);
    expect(isOnlinePaymentMethod("BANK")).toBe(true);
  });

  it("does not treat pay-at-hotel methods as online", () => {
    expect(isOnlinePaymentMethod("cash")).toBe(false);
    expect(isOnlinePaymentMethod("hotel")).toBe(false);
    expect(isOnlinePaymentMethod("")).toBe(false);
  });
});

describe("MBUX-08 — payment proof vs payment verification (the shipped bug)", () => {
  it("a RECEIPT is not a VERIFICATION: `payment-uploaded` reads as proof only", () => {
    const view = resolveConfirmationStatus({ ...base, bookingStatus: "payment-uploaded" });

    expect(view.paymentState).toBe("proof-received");
    // The two facts must never be collapsed into one word. The word
    // "verified" may appear ONLY as part of "not yet verified".
    expect(view.paymentStatusLabel).toBe("Proof received — not yet verified");
    expect(view.paymentStatusLabel).not.toBe("Payment verified");
    expect(view.paymentStatusDetail.toLowerCase()).toContain("not been checked");
  });

  it("VERIFIED wins over the online method — the exact case the boolean could not express", () => {
    // Same online method as the test above, opposite truth. Before
    // MBUX-08 this rendered "Booking submitted for review" for BOTH.
    expect(stateFor("gcash", "payment-uploaded")).toBe("proof-received");
    expect(stateFor("gcash", "payment-confirmed")).toBe("verified");
    expect(stateFor("gcash", "confirmed")).toBe("verified");
  });

  it("every VERIFIED status produces the same honest label", () => {
    for (const status of ["payment-confirmed", "confirmed", "checked-in", "checked-out"]) {
      const view = resolveConfirmationStatus({ ...base, bookingStatus: status });
      expect(view.paymentState).toBe("verified");
      expect(view.paymentStatusLabel).toBe("Payment verified");
      expect(view.headline).toBe("Your booking is confirmed.");
      expect(view.nextStep).not.toMatch(/receipt|send|reply/i);
    }
  });

  it("an ONLINE method with no receipt yet says the receipt is still owed", () => {
    const view = resolveConfirmationStatus({ ...base, bookingStatus: "pending" });

    expect(view.paymentState).toBe("awaiting-proof");
    expect(view.paymentStatusLabel).toBe("Awaiting payment proof");
    // This is the line that tells the guest something is still on THEM.
    expect(view.nextStep.toLowerCase()).toContain("receipt");
  });

  it("a MISSING status on an online method is treated as awaiting proof, not verified", () => {
    // A hand-edited or truncated deep link must never read as confirmed.
    for (const status of ["", "   ", "garbage"]) {
      expect(stateFor("gcash", status)).toBe("awaiting-proof");
    }
  });

  it("a NON-online method outranks a `confirmed` status — nothing was verified", () => {
    // The subtle one. A pay-at-hotel booking that reaches `confirmed`
    // has had its STAY confirmed, but no money moved and none could
    // have been checked. Ranking the status first would tell a guest
    // staff cleared a transfer that never happened.
    const view = resolveConfirmationStatus({
      ...base,
      paymentMethod: "cash",
      paymentMethodLabel: "Pay at Hotel",
      bookingStatus: "confirmed"
    });

    expect(view.paymentState).toBe("pay-at-hotel");
    expect(view.paymentStatusLabel).toBe("Pay at the property");
    expect(view.paymentStatusDetail).not.toMatch(/receipt/i);
    // The stay itself is still confirmed — only the money is deferred.
    expect(view.headline).toBe("Your booking is confirmed.");
  });

  it("a cancelled booking beats even a verified status", () => {
    expect(stateFor("gcash", "cancelled")).toBe("cancelled");
    expect(stateFor("cash", "cancelled")).toBe("cancelled");
  });
});

describe("MBUX-08 — every state tells the guest what happens next", () => {
  const states: Array<[ConfirmationPaymentState, string, string]> = [
    ["pay-at-hotel", "cash", ""],
    ["awaiting-proof", "gcash", "pending"],
    ["proof-received", "gcash", "payment-uploaded"],
    ["verified", "gcash", "confirmed"],
    ["cancelled", "gcash", "cancelled"]
  ];

  it("nextStep is non-empty and status-specific for all five states", () => {
    const seen = new Set<string>();
    for (const [expected, method, status] of states) {
      const view = resolveConfirmationStatus({ ...base, paymentMethod: method, bookingStatus: status });
      expect(view.paymentState).toBe(expected);
      expect(view.nextStep.trim().length).toBeGreaterThan(10);
      seen.add(view.nextStep);
    }
    // Five states must not collapse onto one line of copy.
    expect(seen.size).toBe(states.length);
  });

  it("`proof-received` tells the guest the verification is OUR job, not theirs", () => {
    const view = resolveConfirmationStatus({ ...base, bookingStatus: "payment-uploaded" });
    expect(view.nextStep.toLowerCase()).toContain("nothing to send");
  });

  it("a CANCELLED booking is never presented as confirmed", () => {
    const view = resolveConfirmationStatus({ ...base, bookingStatus: "cancelled" });

    expect(view.paymentState).toBe("cancelled");
    expect(view.tone).toBe("neutral");
    expect(view.headline.toLowerCase()).toContain("cancelled");
    expect(view.headline).not.toMatch(/confirmed/i);
    expect(view.emailStatus.toLowerCase()).toContain("cancellation");
  });

  it("verified and proof-received carry different tones, so the header cannot look identical", () => {
    expect(resolveConfirmationStatus({ ...base, bookingStatus: "confirmed" }).tone).toBe("success");
    expect(resolveConfirmationStatus({ ...base, bookingStatus: "payment-uploaded" }).tone).toBe("pending");
  });
});

describe("MBUX-08 — brand name and method label are never hardcoded", () => {
  it("uses the supplied brand name in the summary", () => {
    const view = resolveConfirmationStatus({
      ...base,
      brandName: "Bohol Highlands",
      bookingStatus: "confirmed"
    });
    expect(view.summary).toContain("Bohol Highlands");
  });

  it("falls back to a neutral phrase when the brand name is blank", () => {
    const view = resolveConfirmationStatus({ ...base, brandName: "   ", bookingStatus: "confirmed" });
    expect(view.summary).toContain("the hotel");
  });

  it("names the admin-configured method label rather than the raw key", () => {
    const view = resolveConfirmationStatus({
      ...base,
      paymentMethodLabel: "Maya",
      bookingStatus: "payment-uploaded"
    });
    expect(view.paymentStatusDetail).toContain("Maya");
    expect(view.paymentStatusDetail).not.toContain("gcash");
  });
});

describe("MBUX-08 — the page reads status for COPY, not just for the early-check-in gate", () => {
  it("calls the helper once and feeds it the URL status", () => {
    expect(confirmPage).toMatch(
      /const confirmationStatus = resolveConfirmationStatus\(\{[\s\S]{0,400}?bookingStatus,[\s\S]{0,400}?brandName: config\.brandName/
    );
  });

  it("renders the headline, summary, next step, payment status and email status from that one object", () => {
    for (const field of [
      "confirmationStatus.headline",
      "confirmationStatus.summary",
      "confirmationStatus.nextStep",
      "confirmationStatus.paymentStatusLabel",
      "confirmationStatus.paymentStatusDetail",
      "confirmationStatus.emailStatus"
    ]) {
      expect(confirmPage).toContain(field);
    }
  });

  it("the old method-only boolean is gone from the render", () => {
    // `isOnlinePayment` chose the headline. If it reappears it will
    // re-divide status copy from status truth.
    expect(confirmCode).not.toMatch(/isOnlinePayment\b/);
    expect(confirmCode).not.toMatch(/rawPaymentMethod === "gcash"/);
  });

  it("keeps the hardcoded 'submitted for review' / 'confirmation will follow' strings out of the page", () => {
    expect(confirmCode).not.toMatch(/Booking submitted for review\s*"\s*:/);
    expect(confirmCode).not.toContain(
      "Official confirmation will follow after payment verification."
    );
  });

  it("still exposes the URL status to the early-check-in allowlist (regression net)", () => {
    // The status was already threaded through the URL for the EC-02
    // gate. MBUX-08 adds a second reader; it must not remove the first.
    expect(confirmPage).toMatch(/useState<string>\(\(\)\s*=>\s*searchParams\.get\(\s*["']status["']\s*\)\s*\?\?/);
    expect(confirmPage).toMatch(/isRewardsMember\s*&&\s*earlyCheckInEnabled\s*&&/);
    expect(confirmPage).toMatch(/\.includes\(bookingStatus\)/);
  });
});

describe("MBUX-08 — the reference is copyable", () => {
  it("renders a copy control wired to a clipboard write", () => {
    expect(confirmPage).toMatch(/data-testid="copy-booking-reference"/);
    expect(confirmPage).toMatch(/navigator\.clipboard\?\.writeText/);
    expect(confirmPage).toMatch(/await navigator\.clipboard\.writeText\(bookingRef\)/);
  });

  it("has a fallback, so a blocked Clipboard API is not a dead button", () => {
    // Insecure contexts and denied permissions both throw here.
    expect(confirmPage).toMatch(/catch\s*\{[\s\S]{0,600}?selectNodeContents/);
  });

  it("the reference text itself stays selectable as a last resort", () => {
    expect(confirmPage).toMatch(/id="booking-reference-value"[\s\S]{0,200}?select-all/);
  });

  it("announces the copy result in a live region (no toast system in guest-app)", () => {
    expect(confirmPage).toMatch(/role="status"/);
    expect(confirmPage).toMatch(/Booking reference copied to clipboard/);
  });

  it("keeps the 'Reservation Reference' label other suites anchor on", () => {
    expect(confirmPage).toContain("Reservation Reference");
  });
});

describe("MBUX-08 — essential result leads, everything else is below it", () => {
  it("early check-in sits BELOW the reservation details", () => {
    // Reversed from EC-02's original placement, which put a member
    // perk directly under the reference and above the stay summary.
    const detailsIndex = confirmPage.indexOf("Reservation Details");
    const earlyCheckInIndex = confirmPage.indexOf('data-testid="early-checkin-request-section"');

    expect(detailsIndex).toBeGreaterThan(-1);
    expect(earlyCheckInIndex).toBeGreaterThan(detailsIndex);
  });

  it("the early check-in section is still gated and still rendered", () => {
    expect(confirmPage).toMatch(/\{showEarlyCheckInButton && \(/);
    expect(confirmPage).toContain('data-testid="early-checkin-open-modal"');
  });

  it("the rewards prompt stays below the actions", () => {
    const manageIndex = confirmPage.indexOf("Manage booking");
    const rewardsIndex = confirmPage.indexOf("{showRewardsJoinPrompt && (");
    expect(manageIndex).toBeGreaterThan(-1);
    expect(rewardsIndex).toBeGreaterThan(manageIndex);
  });

  it("the full breakdown is collapsed by default and kept one tap away", () => {
    expect(confirmPage).toMatch(/data-testid="confirmation-full-breakdown"[\s\S]{0,300}?<details/);
    // A collapsed <details> has no `open` attribute by default.
    expect(confirmPage).not.toMatch(/<details[^>]*\bopen\b/);
    expect(confirmPage).toMatch(/See the full price breakdown/);
  });

  it("PriceBreakdown still renders, now inside the disclosure", () => {
    expect(confirmPage).toMatch(/<PriceBreakdown breakdown=\{rateBreakdown\} total=\{total\} \/>/);
  });
});

describe("MBUX-08 — actions: calendar and manage booking are primary", () => {
  it("Manage booking routes to /my-booking", () => {
    expect(confirmPage).toMatch(/<PrimaryButton to="\/my-booking"/);
    expect(confirmPage).toContain("Manage booking");
  });

  it("Add to calendar is a primary-coloured control", () => {
    expect(confirmPage).toMatch(
      /data-testid="add-to-google-calendar"[\s\S]{0,400}?bg-primary/
    );
    // Both actions in the first row, with the secondary row demoted.
    const calendarIndex = confirmPage.indexOf('data-testid="add-to-google-calendar"');
    const manageIndex = confirmPage.indexOf("<PrimaryButton to=\"/my-booking\"");
    const homeIndex = confirmPage.indexOf("Return to Homepage", manageIndex);
    expect(calendarIndex).toBeGreaterThan(-1);
    expect(manageIndex).toBeGreaterThan(calendarIndex);
    expect(homeIndex).toBeGreaterThan(manageIndex);
  });

  it("Return to Homepage is demoted to a GhostButton, not the primary action", () => {
    // Scoped to the success render. The `!hasAllParams` empty state
    // earlier in the file legitimately keeps a PrimaryButton "Return to
    // Homepage" — with no booking there is nothing else to offer, and
    // demoting it there would be a UX regression, not a fix.
    const successRender = confirmCode.slice(
      confirmCode.indexOf('data-testid="add-to-google-calendar"')
    );

    expect(successRender).toMatch(/<GhostButton to="\/"[\s\S]{0,200}?Return to Homepage/);
    expect(successRender).not.toMatch(
      /<PrimaryButton to="\/"[\s\S]{0,200}?Return to Homepage/
    );
  });

  it("keeps the .ics download", () => {
    expect(confirmPage).toContain("Download .ics");
    expect(confirmPage).toContain("handleAddToCalendar");
  });

  it("keeps the Google Calendar link's safe rel/target", () => {
    expect(confirmPage).toMatch(/target="_blank"\s*\n?\s*rel="noopener noreferrer"/);
  });
});

describe("MBUX-08 — collateral cleanup", () => {
  it("the dead `contact` binding and its stale comment are gone", () => {
    // The import note claimed an "Email the staff card" panel existed
    // "further in the JSX". SR-01..05 had deleted it long ago.
    expect(confirmCode).not.toMatch(/usePublicSiteContent/);
    expect(confirmCode).not.toMatch(/const \{ contact \} =/);
  });

  it("decorative icons are aria-hidden in the new controls", () => {
    expect(confirmPage).toMatch(/data-testid="copy-booking-reference"[\s\S]{0,400}?aria-label=/);
  });

  it("touch targets on the new controls stay at 44px (hard rule)", () => {
    const newControls = confirmPage.match(/<button[\s\S]{0,500}?className="[^"]*min-h-\[44px\][^"]*"/g) ?? [];
    expect(newControls.length).toBeGreaterThan(0);
  });
});