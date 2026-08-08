import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per MRB-08 (2026-08-02, per decision #167): the
// corporate `/corporate/book` page mirrors the public
// `/book` room cart from MRB-06 so a corporate group can
// book a block of rooms. The server (`handleCreateBooking`)
// resolves the negotiated rate PER STAY (from
// `corporateCodes/{code}.ratePerRoomType`), increments
// the corporate code's `usageCount` by N rooms, and the
// cap check rejects when `usageCount + N > usageCap`.
//
// These are source-text guards. The helper tests
// (`shared/__tests__/corporate-codes.test.ts`) cover the
// cap-check arithmetic; the end-to-end contract is the
// responsibility of MRB-15 (the remaining-tests item).

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const sharedHelperSrc = readFileSync(
  resolve(__dirname, "../../../shared/utils/corporate-codes.ts"),
  "utf8"
);

const corporatePageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/CorporateBookingPage.tsx"),
  "utf8"
);

describe("MRB-08 — Corporate multi-room: per-stay rate + N-room usage cap", () => {
  it("threads the per-stay negotiated rate lookup through the create transaction", () => {
    // The server captures the entire `ratePerRoomType` map
    // (not just the primary type's entry) so the
    // per-stay branch can resolve the negotiated rate
    // for any room type in the cart.
    expect(handlerSrc).toMatch(/perStayNegotiatedRate = \{ \.\.\.corpData\.ratePerRoomType \}/);
  });

  it("resolves the negotiated rate per stay type, not per primary type", () => {
    // The per-stay rate lookup checks the stay's own
    // `roomType` against the negotiated map, not the
    // reservation's primary type. The pre-MRB-08 code
    // priced every non-primary stay with the flat
    // type's `corporateRate` (a silent over/under-charge
    // for mixed-type corporate blocks).
    const perStayLookup = handlerSrc.match(
      /const negotiatedForThisStay = perStayNegotiatedRate[\s\S]{0,200}/
    );
    expect(perStayLookup, "expected the per-stay negotiated rate lookup").toBeTruthy();
    expect(perStayLookup![0]).toMatch(/perStayNegotiatedRate\[stayType\.value\]/);
  });

  it("increments corporate code usageCount by the assigned room count, not by 1", () => {
    // The N=1 hardcoded `+ 1` was the pre-MRB-08 bug.
    // A capped code turned effectively unlimited when
    // each reservation carried 2+ rooms. The fix
    // records the actual number of rooms the
    // transaction has successfully claimed.
    const increment = handlerSrc.match(
      /usageCount: \(corpData\.usageCount \|\| 0\) \+ assignedRooms\.length/
    );
    expect(increment, "expected the + assignedRooms.length increment").toBeTruthy();
  });

  it("validates the corporate cap with the requested-uses count, not the raw usageCount", () => {
    // The cap check inside the create transaction
    // accepts the `requestedUses` option so a 5-room
    // block against a cap of 6 with `usageCount: 4`
    // is correctly rejected (4 + 5 > 6). The
    // pre-MRB-08 check (`usageCount >= usageCap`)
    // would have allowed the over-cap reservation
    // to slip through.
    const validateCall = handlerSrc.match(
      /validateCorporateCode\(\{[\s\S]*?usageCount: corpData\.usageCount \|\| 0\s*\}, \{ requestedUses: assignedRooms\.length \}/
    );
    expect(validateCall, "expected the per-room cap check").toBeTruthy();
  });

  it("preserves the historical single-room contract via the default `requestedUses: 1`", () => {
    // The shared `validateCorporateCode` helper
    // defaults `requestedUses` to 1 when no options
    // are passed, preserving every existing call site
    // (the gate validator, the create transaction's
    // flat-rate path, the existing tests). The new
    // option only activates when the caller passes
    // it.
    expect(sharedHelperSrc).toMatch(
      /requestedUses = options\.requestedUses \?\? 1/
    );
    // And the no-options path is preserved: when the
    // call site passes only the code object, the
    // helper accepts the historical single-room call.
    const capCheck = sharedHelperSrc.match(
      /if \(code\.usageCap !== null && code\.usageCount \+ requestedUses > code\.usageCap\)/
    );
    expect(capCheck, "expected the + requestedUses cap check").toBeTruthy();
  });
});

describe("MRB-08 — Corporate /corporate/book page: room cart", () => {
  it("imports the shared room cart helpers and rebalancer", () => {
    // The corporate page uses the same room cart
    // primitives as the public /book flow
    // (MRB-06) so the UX + the rebalance logic
    // are byte-equivalent across the two paths.
    expect(corporatePageSrc).toMatch(
      /import \{[\s\S]*?parseBookingRoomCart,[\s\S]*?rebalanceGuestDistribution,[\s\S]*?serializeBookingRoomCart,[\s\S]*?type BookingRoomCartItem[\s\S]*?\} from "\.\.\/utils\/bookingRoomCart"/
    );
  });

  it("hydrates the cart from ?rooms= and round-trips it through the continue URL", () => {
    expect(corporatePageSrc).toMatch(
      /const \[roomCart, setRoomCart\] = useState<BookingRoomCartItem\[\]>\(\(\) => \{[\s\S]*?parseBookingRoomCart\(searchParams\.get\("rooms"\)\)/
    );
    expect(corporatePageSrc).toMatch(
      /rooms: serializeBookingRoomCart\(distributedRoomCart\.length > 0 \? distributedRoomCart : roomCart\)/
    );
  });

  it("auto-seeds an empty cart with one stay of the first available type", () => {
    // The pre-MRB-08 "one stay of the first type"
    // default is preserved so a corporate guest
    // landing on /corporate/book?step=select-room
    // with no ?rooms= still sees a populated cart.
    expect(corporatePageSrc).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?if \(roomCart\.length > 0\) return;[\s\S]*?setRoomCart\(\[\{[\s\S]*?\}\]\);/
    );
  });

  it("exposes add / remove cart helpers and a per-stay type setter", () => {
    expect(corporatePageSrc).toMatch(/function addRoomToCart\(typeValue: string\)/);
    expect(corporatePageSrc).toMatch(/function removeRoomFromCart\(index: number\)/);
    expect(corporatePageSrc).toMatch(/function setRoomTypeAt\(index: number, typeValue: string\)/);
  });

  it("sends roomSelections[] to the create endpoint on submit", () => {
    // The submit body carries the multi-room
    // `roomCount` + `roomSelections[]` so the
    // server's `handleCreateBooking` can price
    // each stay against its own type and increment
    // the corporate code `usageCount` by N.
    // The match anchors on the `roomSelections`
    // opening so the assertion is unaffected by
    // unrelated body fields above.
    const roomSelections = corporatePageSrc.match(
      /roomSelections: distributedRoomCart\.map\(\(stay, index\) => \(\{[\s\S]*?\}\)\)/
    );
    expect(roomSelections, "expected the roomSelections[] array").toBeTruthy();
    expect(roomSelections![0]).toMatch(/bookingId: index === 0 \? bookingId : stay\.bookingId/);
    expect(roomSelections![0]).toMatch(/roomType: stay\.roomType/);
    expect(roomSelections![0]).toMatch(/numAdults: stay\.numAdults/);
    expect(roomSelections![0]).toMatch(/numChildren: stay\.numChildren/);
    expect(roomSelections![0]).toMatch(/extraBedCount: stay\.extraBedCount/);
    // And the legacy single-room fields at the
    // top of the body are the first stay's
    // values — back-compat with the server's
    // pre-MRB-06 single-room shape.
    //
    // Per BAR-02 (2026-08-08, per decision #203):
    // the `roomCount` field is no longer written
    // to the reservation header and is no longer
    // sent in the create request body — the
    // server reads the children list directly to
    // compute the count. The negative match pins
    // the dead-data cleanup.
    expect(corporatePageSrc).not.toMatch(/roomCount: distributedRoomCart\.length,/);
    expect(corporatePageSrc).toMatch(/numAdults: firstStay\.numAdults/);
    expect(corporatePageSrc).toMatch(/numChildren: firstStay\.numChildren/);
    expect(corporatePageSrc).toMatch(/extraBedCount: firstStay\.extraBedCount/);
  });

  it("hides the page-level extra-bed stepper when the cart has more than one stay", () => {
    // The per-page extra beds stepper is the
    // single-room overflow hint (per EXB-07). For
    // N>1 the rebalance helper handles overflow per
    // stay; the cart shows the result. The page-level
    // stepper would mislead the user.
    const stepper = corporatePageSrc.match(
      /\{corpExtraBedsAllowed > 0 && distributedRoomCart\.length <= 1/
    );
    expect(stepper, "expected the N<=1-gated extra-bed stepper").toBeTruthy();
  });

  it("hides the page-level overflow hint when the cart has more than one stay", () => {
    // Same reason as the stepper: the EXB-07
    // overflow hint is single-room only.
    expect(corporatePageSrc).toMatch(
      /const corpShowOverflowHint =[\s\S]*?distributedRoomCart\.length <= 1/
    );
  });

  it("renders the cart list with per-stay subtotals and a remove button when N>1", () => {
    expect(corporatePageSrc).toMatch(/Your block \({distributedRoomCart\.length}/);
    expect(corporatePageSrc).toMatch(/removeRoomFromCart\(index\)/);
  });

  it("renders the per-room negotiated rate label in the cart when a code unlocks it", () => {
    expect(corporatePageSrc).toMatch(/activeCode && stayNegotiated !== null/);
  });

  it("sums the per-stay subtotals into the aggregate total when N>1", () => {
    // The aggregate `total` switches from the
    // legacy `calculateBookingTotal` derivation
    // (used for the single-room case) to the
    // per-stay sum when the cart has more than one
    // stay. The two paths produce the same number
    // for N=1.
    const total = corporatePageSrc.match(
      /const total = distributedRoomCart\.length <= 1[\s\S]*?;/
    );
    expect(total, "expected the dual-path total").toBeTruthy();
    expect(total![0]).toMatch(/calculateBookingTotal/);
    expect(total![0]).toMatch(
      /perStayPricing\.reduce\(\(sum, line\) => sum \+ line\.staySubtotal, 0\)/
    );
  });
});
