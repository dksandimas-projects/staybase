// MBUX-01 — Shared booking shell: compact mobile stepper,
// sticky-footer standardisation, and the compact hold banner.
//
// Phase 15 / decision #253 (reserved). Owning spec:
// `plan/features/BOOKING-MOBILE-UX.md §Shared Mobile Booking Shell`.
//
// WHY THIS FILE IS SOURCE-TEXT RATHER THAN DOM
// guest-app has no jsdom / testing-library dependency (see
// `guest-app/package.json`), so the established convention for
// guest-app UI contracts is source-text pinning — the same
// approach `in-flow-hold.test.ts`, `br-09-step-flow.test.ts`,
// and `dr-01-*` use. These tests pin the SHAPE, not the pixels;
// the visual acceptance matrix (320/375/390/430px, tablet,
// desktop) is MBUX-10's manual browser pass.
//
// Each block below pins one rule from the spec so a future
// refactor that regresses it fails here rather than in a
// screenshot someone has to remember to take.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf-8");
}

const stepIndicatorSrc = read("guest-app/src/components/StepIndicator.tsx");
const stickyFooterSrc = read("guest-app/src/components/BookingStickyFooter.tsx");
const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");
const corporatePageSrc = read("guest-app/src/pages/CorporateBookingPage.tsx");
const bannerSrc = read("guest-app/src/components/HoldCountdownBanner.tsx");

/**
 * Strip JS comments so an assertion about CODE cannot be tripped by
 * prose in a doc comment. Several of these components carry long
 * rationale blocks (the IMT-05 colour policy, the reduced-motion
 * note), and a naive negative regex like /motion\./ would match the
 * word "motion." inside a sentence and report a false failure.
 */
function stripComments(source: string): string {
  // LINE comments first, THEN block comments. The order matters.
  //
  // A `//` comment may contain `/*` — the booking page literally has
  // one ("Guest clients cannot read `bookings/*` directly"). Stripping
  // blocks FIRST treated that as a block opener and swallowed the next
  // ~170 lines of REAL code, which made every source-text pin inside
  // that window silently vacuous — and made a new pin fail for no
  // visible reason.
  return source.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

const stepIndicatorCode = stripComments(stepIndicatorSrc);
const bannerCode = stripComments(bannerSrc);

/** The pre-MBUX-01 footer wrapper string, verbatim. Must not survive. */
const LEGACY_FOOTER_WRAPPER =
  'className="fixed bottom-0 left-0 z-40 w-full border-t border-gray-200 bg-white/95 px-4 py-4 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur"';

describe("MBUX-01 — StepIndicator: compact mobile stepper", () => {
  it("keeps ordered-list semantics (`<ol>` / `<li>`)", () => {
    expect(stepIndicatorSrc).toMatch(/<ol\b/);
    expect(stepIndicatorSrc).toMatch(/<li\b/);
  });

  it("marks the current step with aria-current=\"step\"", () => {
    expect(stepIndicatorSrc).toMatch(/aria-current=\{active \? "step" : undefined\}/);
  });

  it("gives every step an accessible name even when the label is visually hidden", () => {
    // The label element must stay in the accessibility tree on
    // mobile (`sr-only`) and become visible from `sm:` up
    // (`sm:not-sr-only`). If someone "cleans this up" to
    // `hidden sm:inline`, the label disappears from the a11y
    // tree entirely on phones.
    expect(stepIndicatorSrc).toMatch(/"sr-only text-sm font-medium sm:not-sr-only"/);
  });

  it("hides the visible caption from assistive tech (it would restate the aria-current step)", () => {
    expect(stepIndicatorSrc).toMatch(/<p\s+aria-hidden/);
    expect(stepIndicatorSrc).toMatch(/data-testid="step-indicator-caption"/);
  });

  it("renders the mobile caption as `Step N of 5 · Current step name` from the arrays, not a literal", () => {
    expect(stepIndicatorSrc).toMatch(/Step \{currentStep\} of \{total\} · \{currentLabel\}/);
    expect(stepIndicatorSrc).toMatch(/const total = steps\.length/);
    expect(stepIndicatorSrc).toMatch(/const currentLabel = steps\[currentStep - 1\] \?\? ""/);
  });

  it("never hardcodes a step count — BR-09's variable-count contract still holds", () => {
    expect(stepIndicatorCode).not.toMatch(/Step 5 of/);
    expect(stepIndicatorCode).not.toMatch(/steps\.length === 5|steps\.length > 4|steps\.length === 4/);
  });

  it("completes a step with a check AND an sr-only word (never colour alone)", () => {
    expect(stepIndicatorSrc).toMatch(/<Check/);
    expect(stepIndicatorSrc).toMatch(/sr-only">Completed</);
  });

  it("keeps the CURRENT step numbered rather than checked", () => {
    // Rejected alternative in BOOKING-MOBILE-UX.md: checks-only
    // circles make the current position ambiguous.
    expect(stepIndicatorSrc).toMatch(/\{complete \? \(/);
    expect(stepIndicatorSrc).toMatch(/\) : \(\s*number\s*\)/);
  });

  it("draws a connector between positions on mobile only", () => {
    expect(stepIndicatorSrc).toMatch(/aria-hidden\s+className="absolute inset-x-0 top-\[13\.5px\] h-px bg-gray-200 sm:hidden"/);
  });

  it("renders five evenly distributed positions on mobile (flex-1 per step)", () => {
    expect(stepIndicatorSrc).toMatch(/flex min-w-0 flex-1 flex-col items-center/);
  });

  it("retains full labels at sm: and up", () => {
    expect(stepIndicatorSrc).toMatch(/sm:not-sr-only/);
    expect(stepIndicatorSrc).toMatch(/sm:flex-row sm:items-center/);
  });

  it("adds no animation, so reduced-motion is respected by construction", () => {
    // A connector transition would need a useReducedMotion() guard.
    // The shipped connector is a static rule, so there is nothing
    // to suppress and nothing to forget.
    expect(stepIndicatorCode).not.toMatch(/framer-motion|motion\./);
    expect(stepIndicatorCode).not.toMatch(/transition-|animate-/);
    expect(stepIndicatorCode).not.toMatch(/useReducedMotion/);
  });
});

describe("MBUX-01 — Step eyebrows are redundant on mobile", () => {
  it.each([
    ["BookingPage", bookingPageSrc],
    ["CorporateBookingPage", corporatePageSrc]
  ])("%s hides the `Step N of 5` eyebrow below sm:", (_name, src) => {
    expect(src).toMatch(/hidden text-sm font-semibold uppercase tracking-wide text-primary sm:block/);
  });

  it.each([
    ["BookingPage", bookingPageSrc],
    ["CorporateBookingPage", corporatePageSrc]
  ])("%s keeps all four eyebrows (none was deleted)", (_name, src) => {
    expect(src.match(/sm:block">Step \d of 5<\/p>/g)).toHaveLength(4);
  });

  it.each([
    ["BookingPage", bookingPageSrc],
    ["CorporateBookingPage", corporatePageSrc]
  ])("%s keeps the StepIndicator call sites", (_name, src) => {
    expect(src.match(/<StepIndicator steps=\{steps\} currentStep=\{\d\} \/>/g)).toHaveLength(4);
  });
});

describe("MBUX-01 — BookingStickyFooter", () => {
  it("applies iOS safe-area bottom padding (the pre-MBUX-01 bug)", () => {
    expect(stickyFooterSrc).toMatch(/pb-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/);
  });

  it("gives the action slot a full-width mobile target so 44px clears", () => {
    expect(stickyFooterSrc).toMatch(/w-full sm:w-auto sm:min-w-56/);
  });

  it("renders exactly one action slot and one optional detail slot", () => {
    expect(stickyFooterSrc).toMatch(/\{detail\}/);
    expect(stickyFooterSrc.match(/<div className="w-full sm:w-auto sm:min-w-56">\{children\}<\/div>/)).toHaveLength(1);
  });

  it.each([
    ["BookingPage", bookingPageSrc, 4],
    ["CorporateBookingPage", corporatePageSrc, 4]
  ])("%s routes all %i footers through the shared component", (_name, src, count) => {
    expect(src.match(/<BookingStickyFooter/g) ?? []).toHaveLength(count);
    expect(src.match(/<\/BookingStickyFooter>/g) ?? []).toHaveLength(count);
  });

  it.each([
    ["BookingPage", bookingPageSrc],
    ["CorporateBookingPage", corporatePageSrc]
  ])("%s has zero legacy hand-rolled footers left", (_name, src) => {
    expect(src).not.toMatch(/fixed bottom-0 left-0 z-40 w-full border-t border-gray-200/);
  });

  it("no page defines the fixed-footer bar locally any more", () => {
    for (const src of [bookingPageSrc, corporatePageSrc]) {
      expect(src).not.toContain(LEGACY_FOOTER_WRAPPER);
    }
  });

  it.each([
    ["BookingPage", bookingPageSrc],
    ["CorporateBookingPage", corporatePageSrc]
  ])("%s reserves matching bottom space so the footer never covers content", (_name, src) => {
    expect(src).toMatch(/pb-\[calc\(8rem\+env\(safe-area-inset-bottom\)\)\]/);
    // The flat pb-32 is gone — it cannot express the inset.
    expect(src).not.toMatch(/bg-gray-50 pb-32 font-body/);
  });

  it.each([
    ["BookingPage", bookingPageSrc],
    ["CorporateBookingPage", corporatePageSrc]
  ])("%s imports the shared footer", (_name, src) => {
    expect(src).toMatch(/import \{ BookingStickyFooter \} from "\.\.\/components\/BookingStickyFooter"/);
  });

  it("Step 1's occupancy recovery survives the extraction as the `detail` slot", () => {
    expect(bookingPageSrc).toMatch(/detail=\{/);
    expect(bookingPageSrc).toMatch(/data-testid="adjust-room-cta"/);
    expect(bookingPageSrc).toMatch(/id="step-one-occupancy-error"/);
  });
});

describe("MBUX-01 — HoldCountdownBanner compact active state", () => {
  it("renders the one-line mobile state `Room held · MM:SS remaining`", () => {
    expect(bannerSrc).toMatch(/Room held · \{formatCountdown\(secondsLeft\)\} remaining/);
    expect(bannerSrc).toMatch(/className="min-w-0 flex-1 text-sm font-semibold text-gray-900 sm:hidden"/);
  });

  it("puts the full explanation behind an information affordance on mobile", () => {
    expect(bannerSrc).toMatch(/data-testid="hold-info-toggle"/);
    expect(bannerSrc).toMatch(/aria-expanded=\{isHelpOpen\}/);
    expect(bannerSrc).toMatch(/aria-controls="hold-help-text"/);
    expect(bannerSrc).toMatch(/id="hold-help-text"/);
    expect(bannerSrc).toMatch(/const \[isHelpOpen, setIsHelpOpen\] = useState\(false\)/);
  });

  it("keeps the explanation unconditionally visible from sm: up", () => {
    expect(bannerSrc).toMatch(/className=\{cn\("min-w-0 sm:flex-1 sm:block", isHelpOpen \? "block w-full" : "hidden"\)\}/);
  });

  it("never shows the countdown twice — the pill is sm:-only", () => {
    // Both regions are in the DOM at every width; `display:none` is
    // what keeps exactly one of them in the accessibility tree.
    expect(bannerSrc).toMatch(/hidden rounded-full bg-white px-3 py-1 text-sm font-semibold tabular-nums ring-1 ring-inset sm:inline-flex/);
  });

  it("keeps the honest copy — the 'If it goes through' escape hatch still ships", () => {
    // HCT-01 (decision #270) tightened the banner's escape-hatch
    // sentence from "if another guest books first, we'll let you
    // know and you can pick a new room" to "If it goes through,
    // you're set" — shorter copy, same honesty signal. A future
    // copy change that drops the conditional must update
    // decision #270 alongside it.
    expect(bannerSrc).toMatch(/If it goes through/);
  });

  it("never hides an extend failure behind the collapsed explanation", () => {
    // Scoped to the ACTIVE branch — the expired branch has its own
    // `hold-extend-error` that predates MBUX-01. The contract is
    // that the error element is a SIBLING of the collapsible div,
    // not a descendant: a guest who expanded nothing must still see
    // a failed extend.
    const activeStart = bannerCode.indexOf('data-state="active"');
    expect(activeStart).toBeGreaterThan(-1);
    const branch = bannerCode.slice(activeStart);

    const helpAttr = branch.indexOf('id="hold-help-text"');
    expect(helpAttr).toBeGreaterThan(-1);
    // The collapsible div contains no nested <div>, so the first
    // </div> after its opening tag is its own close.
    const helpOpen = branch.indexOf(">", helpAttr);
    const helpClose = branch.indexOf("</div>", helpOpen);
    const errIdx = branch.indexOf('data-testid="hold-extend-error"');
    expect(errIdx).toBeGreaterThan(helpClose);
  });

  it("gives the info affordance a 44px touch target", () => {
    expect(bannerSrc).toMatch(/inline-flex min-h-11 items-center gap-1\.5 rounded-lg border border-primary\/40/);
  });

  it("keeps the expired state's explicit next actions untouched", () => {
    // Warning/expired states retain explicit next actions per spec.
    expect(bannerSrc).toMatch(/data-testid="hold-pick-new-room-cta"/);
    expect(bannerSrc).toMatch(/\{canExtend \? \(/);
    expect(bannerSrc).toMatch(/Your hold has expired\./);
  });

  it("keeps the single sr-only live region (no per-second announcement flood)", () => {
    // Three live regions in code: the loading skeleton, the error
    // state, and the one sr-only announcement.
    expect(bannerCode.match(/aria-live="polite"/g) ?? []).toHaveLength(3);
    // The ACTIVE branch carries exactly ONE live region, and it is
    // the sr-only announcement — never the ticking MM:SS container.
    // Per IMT-03 the banner itself is `role="region"`, so the
    // per-second re-render is silent.
    expect(bannerCode).toMatch(/role="region"\s+aria-label="Room hold status"/);
    const branch = bannerCode.slice(bannerCode.indexOf('aria-label="Room hold status"'));
    expect(branch.match(/aria-live="polite"/g) ?? []).toHaveLength(1);
    expect(branch).toMatch(/className="sr-only" role="status" aria-live="polite" data-testid="hold-announcement"/);
  });

  it("preserves the IMT-05 colour policy comment", () => {
    expect(bannerSrc).toMatch(/COLOR POLICY \(IMT-05\)/);
  });
});