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

    it("derives companyName from the corporateCodes doc, never from the body", () => {
      // The handler must read companyName from `corpData.companyName`
      // (the document) and not from `guestDetails.companyName`.
      const fnStart = bookingsSrc.indexOf("if (corporateCode)");
      const fnEnd = bookingsSrc.indexOf("// No corporativoCode at all", fnStart);
      const corpBranch = bookingsSrc.slice(fnStart, fnEnd);
      expect(corpBranch, "expected to find the corporate branch").toBeTruthy();
      // Source of truth: the corporativoCodes doc
      expect(corpBranch).toMatch(/corpData\.companyName\s*\|\|\s*["']["']/);
      // Strip line comments before checking for body-trust patterns
      const codeOnly = corpBranch
        .split("\n")
        .filter(line => !line.trim().startsWith("//"))
        .join("\n");
      expect(codeOnly).not.toMatch(/corporateDetails\.companyName\s*=\s*[^;]*guestDetails/);
    });

    it("throws a clear error when the code fails re-validation (BI-10)", () => {
      // Per BI-10 (booking-intercom audit 2026-07-06): an
      // invalid or missing corporate code used to silently
      // downgrade the booking to the standard rate with
      // `isCorporate: false`. The guest confirmed a
      // negotiated total and got charged the full rate with
      // no error and no explanation. The new contract:
      //   * a code that fails re-validation inside the
      //     transaction (expired / cap reached / deactivated
      //     between gate and confirm) throws a distinct
      //     `Corporate code no longer valid: ...` error
      //     that the catch block maps to 409
      //   * a code that is not found at all throws the
      //     same prefix with a different reason
      // The standard `roomTypes[].pricePerNight` is *not*
      // substituted silently anymore — the booking is
      // aborted so the client can send the guest back to
      // the gate.
      const fnStart = bookingsSrc.indexOf("if (corporateCode)");
      const fnEnd = bookingsSrc.indexOf("// No corporateCode and no flat-rate flag", fnStart);
      const corpBranch = bookingsSrc.slice(fnStart, fnEnd);
      expect(corpBranch, "expected to find the corporate branch").toBeTruthy();
      // Strip line comments before checking for the throw pattern
      const codeOnly = corpBranch
        .split("\n")
        .filter(line => !line.trim().startsWith("//"))
        .join("\n");
      expect(codeOnly).toMatch(
        /throw\s+new\s+Error\(\s*`Corporate code no longer valid:/
      );
      // The catch block must map this message to a 409.
      // Check the body of `handleCreateBooking` for the prefix
      // match.
      const catchStart = bookingsSrc.indexOf("} catch (error: any) {", fnStart);
      const catchEnd = bookingsSrc.indexOf("}\n}\n", catchStart);
      const catchBlock = bookingsSrc.slice(catchStart, catchEnd);
      expect(catchBlock).toMatch(
        /error\.message\.startsWith\(\s*["']Corporate code no longer valid["']/
      );
    });

    it("no longer silently downgrades on invalid corporate code (regression)", () => {
      // Source-pattern regression guard for BI-10: a
      // future agent that re-introduces a silent fallback
      // (`activeRoomRate = typeBaseRate` inside the
      // `else` branch of the corporate-code re-validation)
      // is caught. The previous behavior of "set the rate
      // to the standard price when the code is invalid" is
      // what the audit flagged as a critical UX bug.
      const fnStart = bookingsSrc.indexOf("if (corpValidation.valid)");
      const block = bookingsSrc.slice(
        fnStart,
        fnStart + 5000
      );
      // The "valid" branch must NOT contain a
      // `activeRoomRate = typeBaseRate` reassignment. The
      // "invalid" branch must contain a `throw` (not a
      // reassignment).
      const validBranch = block.match(/if\s*\(\s*corpValidation\.valid\s*\)\s*\{[\s\S]*?\}\s*else\s*\{[\s\S]*?throw/);
      expect(validBranch, "expected to find valid/else+throw structure").toBeTruthy();
      // Inside the valid branch, the rate assignment uses
      // either `ratePerRoomType[roomType]` or
      // `typeCorporateRate`, never a fallback to
      // `typeBaseRate`.
      expect(validBranch![0]).not.toMatch(/activeRoomRate\s*=\s*typeBaseRate/);
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
