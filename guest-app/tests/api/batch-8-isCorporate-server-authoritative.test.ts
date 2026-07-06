import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 8 — two audit fixes:
//
//   S1.5 — server-authoritative isCorporate / companyName
//          (decision #79; an attacker posting isCorporate:true
//          + corporateCode:"INVALID" must NOT get the corporate rate)
//   S4.1 — client uses ratePerRoomType[chosenRoomType] for the
//          negotiated rate (decision #101; was: client always
//          used room.corporateRate)
//
// Both are source-pattern tests that prevent the regressions from
// sneaking back in.

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const corporateBookingSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/CorporateBookingPage.tsx"),
  "utf8"
);
const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/BookingPage.tsx"),
  "utf8"
);

describe("Phase 11.6 Batch 8 — server-authoritative isCorporate + ratePerRoomType", () => {
  describe("S1.5 — server-authoritative isCorporate / companyName", () => {
    it("CreateBookingBody interface no longer declares isCorporate", () => {
      // The interface must NOT have an `isCorporate: boolean;` field
      // — the server derives it from a validated corporateCode.
      const interfaceMatch = bookingsSrc.match(
        /interface\s+CreateBookingBody\s*\{[\s\S]*?\}/
      );
      expect(interfaceMatch, "expected to find CreateBookingBody interface").toBeTruthy();
      expect(interfaceMatch![0]).not.toMatch(/^\s*isCorporate\s*:/m);
    });

    it("booking handler no longer destructures isCorporate from body", () => {
      // The handleCreateBooking destructure must not pull
      // `isCorporate` out of the body. (Guarding against accidental
      // re-introduction.) We anchor on the function start + the
      // destructure to avoid false positives from the interface
      // definition or comments.
      const fnStart = bookingsSrc.indexOf("export async function handleCreateBooking");
      const destructureStart = bookingsSrc.indexOf("const {", fnStart);
      const destructureEnd = bookingsSrc.indexOf("} = body;", destructureStart);
      const destructure = bookingsSrc.slice(destructureStart, destructureEnd);
      expect(destructure).not.toMatch(/isCorporate/);
    });

    it("booking handler validates the corporate code via the shared validateCorporateCode helper", () => {
      // The corporate-rate branch must use the shared
      // `validateCorporateCode` helper (same one used by
      // /api/validate/corporate-code) so server-side validation is
      // consistent across the two entry points.
      expect(bookingsSrc).toMatch(
        /validateCorporateCode\(\s*\{[\s\S]*?isActive:\s*corpData\.isActive\s*!==\s*false[\s\S]*?usageCount:\s*corpData\.usageCount\s*\|\|\s*0\s*\}/
      );
    });

    it("derives companyName from the corporateCodes doc inside the coded branch", () => {
      // The coded branch must read companyName from
      // `corpData.companyName` (the document) and not from
      // `guestDetails.companyName`.
      //
      // Per BI-04 (booking-intercom audit 2026-07-06): the slice is
      // bounded by the flat-rate block that follows the coded
      // branch. (The previous end anchor had a typo —
      // "corporativoCode" — so indexOf returned -1 and the slice
      // silently covered the rest of the handler.) The flat-rate
      // block *is* allowed to store the guest-entered companyName:
      // it is unverified metadata with no pricing power, per
      // CORPORATE-BOOKING.md ("sourced from code validation
      // response or entered by guest"). The separate test below
      // pins the flat-rate branch's own invariants.
      const fnStart = bookingsSrc.indexOf("if (corporateCode)");
      const fnEnd = bookingsSrc.indexOf(
        "if (!corporateDetails.isCorporate && corporateFlatRate === true)",
        fnStart
      );
      expect(fnStart, "expected to find the corporate coded branch").toBeGreaterThan(-1);
      expect(fnEnd, "expected to find the flat-rate branch after the coded branch").toBeGreaterThan(fnStart);
      const corpBranch = bookingsSrc.slice(fnStart, fnEnd);
      // Source of truth: the corporateCodes doc
      expect(corpBranch).toMatch(/corpData\.companyName\s*\|\|\s*["']["']/);
      // Strip line comments before checking for body-trust patterns
      const codeOnly = corpBranch
        .split("\n")
        .filter(line => !line.trim().startsWith("//"))
        .join("\n");
      expect(codeOnly).not.toMatch(/corporateDetails\.companyName\s*=\s*[^;]*guestDetails/);
    });

    it("flat-rate branch (BI-04) prices from the server-side type entry, never from the body", () => {
      // The "Continue without code" path may flag the booking
      // corporate and store the guest-entered companyName, but the
      // RATE must come from the server-side roomTypes[] entry
      // (typeCorporateRate, falling back to typeBaseRate — never a
      // client-supplied number, never ₱0).
      const flatStart = bookingsSrc.indexOf(
        "if (!corporateDetails.isCorporate && corporateFlatRate === true)"
      );
      expect(flatStart, "expected to find the flat-rate branch").toBeGreaterThan(-1);
      const flatEnd = bookingsSrc.indexOf("}", flatStart);
      const flatBranch = bookingsSrc.slice(flatStart, flatEnd + 1);
      expect(flatBranch).toMatch(
        /activeRoomRate\s*=\s*typeCorporateRate\s*>\s*0\s*\?\s*typeCorporateRate\s*:\s*typeBaseRate/
      );
      // A validated code always wins: the branch only runs when the
      // coded branch did not already flag the booking corporate.
      expect(flatBranch).toMatch(/!corporateDetails\.isCorporate/);
      // No client-supplied rate can reach the branch.
      expect(flatBranch).not.toMatch(/body\.|ratePerNight/);
    });

    it("falls back to the standard rate when the code is invalid or missing", () => {
      // The handler must keep the booking on the standard rate when
      // no valid code is supplied — i.e. an attacker cannot
      // bypass by sending isCorporate:true + corporateCode:INVALID.
      const corpBranch = bookingsSrc.match(
        /if\s*\(\s*corporateCode\s*\)\s*\{[\s\S]*?if\s*\(\s*corpCodeDoc\.exists\s*\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?\}\s*\}/
      );
      expect(corpBranch, "expected to find the corporate branch with else fallback").toBeTruthy();
      // The else branch must set the rate to the standard price
      // (per the room-type booking refactor: the standard rate
      // now comes from the `roomType` entry in settings/hotelConfig,
      // not from the physical room doc).
      expect(corpBranch![0]).toMatch(/activeRoomRate\s*=\s*typeBaseRate/);
    });

    it("BookingPage (standard online flow) no longer sends isCorporate: false", () => {
      // The standard online booking body should not include the
      // isCorporate field at all — the server defaults to non-
      // corporate when no code is present.
      const fetchBlock = bookingPageSrc.match(
        /body:\s*JSON\.stringify\(\s*\{[\s\S]*?\}\s*\)/
      );
      expect(fetchBlock, "expected to find the booking body block").toBeTruthy();
      expect(fetchBlock![0]).not.toMatch(/isCorporate/);
    });
  });

  describe("S4.1 — client uses ratePerRoomType[chosenRoomType] for the negotiated rate", () => {
    it("CorporateBookingPage stores ratePerRoomType from the validate response", () => {
      // The validate handler must capture the ratePerRoomType map
      // returned by the server and persist it to sessionStorage so
      // the rate calculation uses the negotiated values.
      expect(corporateBookingSrc).toMatch(
        /setRatePerRoomType\(\s*(?:result\.data\.ratePerRoomType|nextRatePerRoomType)\)/
      );
      expect(corporateBookingSrc).toMatch(
        /sessionStorage\.setItem\(\s*["']corp_ratePerRoomType["']\s*,\s*JSON\.stringify\(/
      );
    });

    it("baseRate prefers ratePerRoomType[roomType] over room's flat corporateRate", () => {
      // The baseRate calculation must look up the chosen room type
      // in the ratePerRoomType map. If absent, it falls back to
      // the type's flat corporateRate (per W3.6 — `room.corporateRate`
      // is no longer a thing; pricing lives on the room type).
      const baseRateBlock = corporateBookingSrc.match(
        /const\s+negotiatedRate\s*=[\s\S]*?;\s*const\s+baseRate\s*=\s*negotiatedRate/
      );
      expect(baseRateBlock, "expected the baseRate calculation block").toBeTruthy();
      expect(baseRateBlock![0]).toMatch(/ratePerRoomType\[selectedTypeEntry\.value\]/);
      expect(baseRateBlock![0]).toMatch(/selectedRoomRates\?\.corporateRate/);
    });

    it("CorporateBookingPage booking body no longer sets isCorporate: true", () => {
      // The booking submission body should not include the
      // isCorporate field — the server derives it.
      const fetchBlock = corporateBookingSrc.match(
        /body:\s*JSON\.stringify\(\s*\{[\s\S]*?\}\s*\)/
      );
      expect(fetchBlock, "expected to find the corporate body block").toBeTruthy();
      expect(fetchBlock![0]).not.toMatch(/isCorporate\s*:/);
    });
  });
});
