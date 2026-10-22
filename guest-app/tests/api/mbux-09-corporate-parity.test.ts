import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// MBUX-09 — Corporate parity and contracts across sibling surfaces.
//
// Phase 15 / decision #261. Owning spec:
// `plan/features/BOOKING-MOBILE-UX.md §Corporate parity`.
//
// This file is deliberately as much about what was NOT changed as
// what was. MBUX-09 is the slice where a Phase 15 change could most
// easily destroy a corporate rule that no public-flow test covers.
//
// THE TWO FINDINGS THAT MATTER MOST
// ---------------------------------
// 1. The lone "Room Only" button on the corporate Step 1 card was the
//    same vestigial single-option panel MBUX-02 deleted publicly. Its
//    own comment already admitted BR-03 (decision #232) removed
//    "Room + Breakfast" from the corporate flow TOO — so it had not
//    been a rate choice for some time. It was a "select this room
//    type" action wearing a rate option's clothes.
//
// 2. Corporate has TWO consent controls and they are NOT duplicates.
//    `guestDetails.consent` is the privacy/terms consent the server
//    validates; `termsConsent` is a separate corporate AUDIT
//    declaration ("I declare the travel information is correct… I
//    agree to … corporate audit rules"). MBUX-06 deleted a duplicate
//    on the public flow; copying that deletion here would have
//    silently removed a real compliance control. It is asserted
//    present below so nobody "finishes the parity" by deleting it.

const repoRoot = resolve(__dirname, "../../..");

const corporate = readFileSync(
  resolve(repoRoot, "guest-app/src/pages/CorporateBookingPage.tsx"),
  "utf8"
);

const publicPage = readFileSync(
  resolve(repoRoot, "guest-app/src/pages/BookingPage.tsx"),
  "utf8"
);

/** Source with comments removed, so a comment naming a deleted
 *  control cannot satisfy (or trip) a code pin. */
function codeOnly(src: string): string {
  return src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

const corporateCode = codeOnly(corporate);

describe("MBUX-09 — Step 1: the vestigial rate control is gone", () => {
  it("no longer renders a lone `Room Only` button", () => {
    expect(corporateCode).not.toMatch(/>\s*Room Only\s*</);
  });

  it("the card offers an honest full-width select action instead", () => {
    expect(corporate).toMatch(/data-testid="corporate-room-select"/);
    expect(corporate).toContain("Select this room");
  });

  it("the selected state is shown on the card, not as a rate highlight", () => {
    expect(corporate).toMatch(/data-testid="corporate-room-selected"/);
    expect(corporate).toMatch(/aria-current="true"/);
  });

  it("the select action meets the 44px touch-target hard rule", () => {
    expect(corporate).toMatch(
      /data-testid="corporate-room-select"[\s\S]{0,400}?min-h-\[44px\]/
    );
  });

  it("does NOT add a per-type quantity stepper", () => {
    // The corporate flow distributes guests per room in a LATER step
    // (`distributedRoomCart`). A stepper here would be a second,
    // conflicting source of truth — the exact defect MBUX-03 fixed
    // on the public flow by extraction rather than duplication.
    expect(corporateCode).not.toMatch(/updateRoomQuantity/);
  });

  it("keeps the negotiated-rate badge and the access-code gate", () => {
    expect(corporate).toContain("Negotiated rate");
    expect(corporate).toMatch(/\{activeCode && \(/);
    // Per F09 / SEC-5 (2026-10-22): the flat corporate rate is served
    // by the SERVER (`GET /api/corporate/rates`), so the guest room
    // type carries no `corporateRate` any more.
    expect(corporate).toMatch(/flatCorporateRates\[type\.value\]/);
    expect(corporate).not.toMatch(/type\.corporateRate/);
  });

  it("keeps `selectRoomType` — it owns the deep-link URL writes", () => {
    expect(corporate).toMatch(/function selectRoomType\(/);
    for (const param of ["roomType", "checkIn", "checkOut", "guests"]) {
      expect(corporate).toMatch(new RegExp(`next\\.set\\("${param}"`));
    }
    expect(corporate).toMatch(/setSearchParams\(next, \{ replace: true \}\)/);
  });

  it("keeps `rateChoice: \"room-only\"` for API and payload compatibility", () => {
    // MBUX-02 deleted the PANEL and the handler, not the value.
    expect(corporate).toContain('type RateChoice = "room-only" | "room-breakfast"');
    expect(corporate).toMatch(/selectRoomType\(type\.value, "room-only"\)/);
    expect(corporate).toMatch(/rateChoice,\s*$/m);
  });

  it("keeps the guest-distribution model", () => {
    expect(corporate).toMatch(/distributedRoomCart/);
  });
});

describe("MBUX-09 — Step 4 is summary-first, matching MBUX-07", () => {
  it("both corporate review grids put the controls after the summary below `lg:`", () => {
    const controls = corporate.match(/order-2 lg:order-1 /g) ?? [];
    // Two review steps (guest-details review + pay/review).
    expect(controls.length).toBeGreaterThanOrEqual(2);
  });

  it("the shared aside carries the summary-first order and stays sticky on desktop", () => {
    expect(corporate).toMatch(
      /<aside className="order-1 lg:order-2 lg:sticky lg:top-36 lg:self-start">/
    );
  });

  it("there is only ONE aside component, so both steps cannot drift", () => {
    expect(corporate.match(/function BookingReviewAside\(/g)?.length).toBe(1);
  });

  it("the desktop grid is untouched", () => {
    expect(corporate.match(/lg:grid-cols-\[1fr_380px\]/g)?.length).toBe(2);
  });
});

describe("MBUX-09 — the two corporate consent controls are NOT duplicates", () => {
  it("`guestDetails.consent` (privacy/terms) is still collected and still sent", () => {
    expect(corporate).toMatch(/checked=\{guestDetails\.consent\}/);
    expect(corporate).toMatch(/updateGuestDetail\("consent", event\.target\.checked\)/);
    expect(corporate).toMatch(/consent: guestDetails\.consent,/);
    expect(corporate).toMatch(/guestDetails\.consent &&/);
  });

  it("`termsConsent` (corporate AUDIT declaration) is still collected and still gates Confirm", () => {
    expect(corporate).toMatch(/const \[termsConsent, setTermsConsent\] = useState\(false\)/);
    expect(corporate).toMatch(/checked=\{termsConsent\}/);
    expect(corporate).toMatch(/const canConfirm =\s*\n?\s*termsConsent &&/);
  });

  it("the audit declaration's distinctive wording is intact", () => {
    // If this text changes, the control has become the privacy
    // consent and MBUX-06's consolidation would become legitimate.
    expect(corporate).toContain("I declare the travel information is correct");
    expect(corporate).toContain("corporate audit rules");
  });

  it("the public flow's MBUX-06 outcome is unchanged (one control, no termsConsent)", () => {
    expect(publicPage).not.toContain("termsConsent");
    expect(publicPage).toMatch(/checked=\{guestDetails\.consent\}/);
  });
});

describe("MBUX-09 — contracts that must survive parity", () => {
  it("add-on consolidation is VACUOUS on corporate — there is nothing to consolidate", () => {
    // MBUX-05 retired BR-10's dual CTAs on the public flow and
    // deferred corporate "until MBUX-09". The audit found corporate
    // has no add-on catalogue at all: the step renders a
    // "no add-ons available" placeholder and no breakfast grid.
    // Copying the public consolidation here would have been
    // rewriting a button that does not exist.
    expect(corporate).toMatch(/no add-ons available/i);
    expect(corporateCode).not.toMatch(/BreakfastMenuStrip/);
  });

  it("no breakfast grid was invented on the corporate add-ons step", () => {
    expect(corporate).not.toMatch(/copyBreakfastDateToRemaining/);
  });

  it("both flows share the MBUX-01 shell components", () => {
    for (const component of ["BookingStickyFooter", "StepIndicator"]) {
      expect(corporate).toContain(component);
      expect(publicPage).toContain(component);
    }
  });

  it("corporate has its OWN inline confirmation step — MBUX-08 parity is NOT covered here", () => {
    // Recorded honestly rather than asserted as parity. The public
    // flow redirects to the shared `/book/confirm` page, which is why
    // MBUX-08's truthful status copy reaches every public guest. The
    // corporate flow instead sets `step: "confirm"` on its own URL
    // and renders from `bookingResponse` — a second confirmation
    // implementation. So the payment PROOF vs VERIFICATION
    // distinction MBUX-08 fixed does NOT currently apply to corporate
    // bookings. Closing that gap is real outstanding work, not
    // something this slice silently claims to have done.
    expect(corporate).toMatch(/setBookingResponse\(\{ ref: result\.data\.bookingRef \}\)/);
    expect(corporate).toMatch(/step: "confirm",/);
    expect(corporate).not.toMatch(/navigate\(`\/book\/confirm/);
  });

  it("neither page imports a confirmation component directly", () => {
    // The public page only names BookingConfirmPage in a comment.
    expect(codeOnly(corporate)).not.toMatch(/BookingConfirmPage/);
    expect(codeOnly(publicPage)).not.toMatch(/BookingConfirmPage/);
  });

  it("corporate keeps its own safe-area reserve from MBUX-01", () => {
    expect(corporate).toContain("pb-[calc(8rem+env(safe-area-inset-bottom))]");
  });

  it("the corporate rate still falls back to the standard rate when no negotiated rate exists", () => {
    // Per BI-04: never render ₱0 for a type with no corporate rate.
    // Per F09 / SEC-5 (2026-10-22): the flat corporate rate comes
    // from the server-served rate card, not from the guest room type.
    expect(corporate).toMatch(
      /ratePerRoomType && ratePerRoomType\[type\.value\] !== undefined\)\s*\n?\s*\? ratePerRoomType\[type\.value\]\s*\n?\s*: \(Number\(flatCorporateRates\[type\.value\]\) \|\| type\.pricePerNight \|\| 0\)/
    );
  });

  it("member identity fields stay locked, phone stays editable", () => {
    // The existing corporate gate: email/first/last are readOnly for
    // members, phone deliberately is not.
    expect(corporate).toMatch(
      /\(field === "email" \|\|\s*\n\s*field === "firstName" \|\|\s*\n\s*field === "lastName"\)/
    );
  });
});