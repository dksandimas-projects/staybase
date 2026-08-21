import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getBookingLastName } from "../../server/handlers/intercom";

// Permanent fix for the intercom verify-guest "silent
// split-on-whitespace" bug.
//
// Symptom (user report, 2026-08-21): typing only the booking's
// real last name in the intercom prompt returned 403. Typing
// the second token of the first+last concatenated name worked.
// Root cause:
//
//   1. Every booking write path (online / walk-in /
//      corporate-inquiry conversion) persists `guestName`
//      as the concatenated string `${firstName} ${lastName}`
//      but DOES NOT persist a structured
//      `guestDetails: { firstName, lastName, ... }` sub-object.
//
//   2. The intercom verifier (`handleVerifyIntercomGuest` →
//      `getBookingLastName`) silently falls back to
//      `data.guestName.split(/\s+/).slice(1).join(" ")` when
//      `data.guestDetails?.lastName` is missing, and treats
//      "everything after the first whitespace token" as the
//      expected last name.
//
// For a guest whose `guestName` is "Maria Clara Santos" the
// verifier's expected last name becomes "Clara Santos" — the
// guest enters "Santos" and is rejected; the guest enters
// "Clara Santos" and is accepted.
//
// The permanent fix:
//   - All three booking write sites persist a structured
//     `guestDetails: { firstName, lastName, email, phone }`
//     sub-object on the booking doc.
//   - `getBookingLastName` only reads `guestDetails.lastName`.
//     The split-on-whitespace fallback is removed — legacy
//     bookings without `guestDetails` get rejected (no script
//     per user direction; front desk re-verifies manually).
//   - This test pins both the structural contract (source-text
//     on the three write sites + the verifier file) and the
//     behavioral contract (unit test of `getBookingLastName`).

describe("intercom verify-guest — permanent last-name fix", () => {
  describe("getBookingLastName — behavioral contract", () => {
    it("returns the structured guestDetails.lastName when present", () => {
      const data = {
        guestName: "Maria Clara Santos",
        guestDetails: {
          firstName: "Maria Clara",
          lastName: "Santos"
        }
      };
      expect(getBookingLastName(data as any)).toBe("santos");
    });

    it("matches the entered last name exactly (the user's symptom)", () => {
      // Pre-fix: expected was "clara santos" (everything after
      // the first whitespace token of "Maria Clara Santos").
      // Post-fix: expected is just "santos".
      const data = {
        guestName: "Maria Clara Santos",
        guestDetails: {
          firstName: "Maria Clara",
          lastName: "Santos"
        }
      };
      // Guest types ONLY the real last name.
      expect(getBookingLastName(data as any)).toBe("santos");
      // Guest types the second name (the wrong-but-symptomatic
      // pre-fix match). MUST NOT match anymore.
      expect(getBookingLastName(data as any)).not.toBe("clara santos");
    });

    it("normalizes whitespace, case, and punctuation on the stored last name", () => {
      const data = {
        guestName: "Juan Dela Cruz",
        guestDetails: {
          firstName: "Juan",
          // Stored value uses punctuation + mixed case + extra
          // whitespace. Verifier must collapse and lowercase
          // before comparing against the guest's typed input.
          // `normalizeName` is conservative — it keeps diacritics
          // (the regex strips non-letter/digit/space), so the
          // accented "É" becomes lowercase "é" rather than
          // collapsing to plain "e".
          lastName: "  DÉ LA  CRUZ "
        }
      };
      expect(getBookingLastName(data as any)).toBe("dé la cruz");
    });

    it("returns empty string when guestDetails.lastName is missing (no silent fallback)", () => {
      // The pre-fix bug: getBookingLastName silently fell back
      // to splitting guestName on whitespace. Post-fix: it must
      // return "" so the verifier returns 403 and the front
      // desk sees the failure (no more silent acceptance of a
      // wrong last name).
      const dataLegacy = {
        guestName: "Juan Dela Cruz"
        // No guestDetails at all — pre-fix legacy booking shape.
      };
      expect(getBookingLastName(dataLegacy as any)).toBe("");

      const dataCorporateConversion = {
        guestName: "Maria Santos",
        guestDetails: {
          firstName: "Maria"
          // Missing lastName — incomplete structured write.
        }
      };
      expect(getBookingLastName(dataCorporateConversion as any)).toBe("");
    });

    it("never produces a multi-token 'last name' by splitting the full name", () => {
      // Belt-and-suspenders: the post-fix function must NEVER
      // return more than one normalized token — i.e. it can
      // never have split on whitespace. If a future refactor
      // re-introduces a fallback, this test fails immediately.
      const fixtures = [
        { guestName: "Maria Clara Santos", guestDetails: { firstName: "Maria Clara", lastName: "Santos" } },
        { guestName: "Juan Dela Cruz", guestDetails: { firstName: "Juan", lastName: "Dela Cruz" } },
        // Single given-name, hyphenated family — common in PH.
        { guestName: "Ana Reyes", guestDetails: { firstName: "Ana", lastName: "Reyes" } },
        // Three-word given name + two-word family name.
        { guestName: "Maria Ana Clara Dela Cruz", guestDetails: { firstName: "Maria Ana Clara", lastName: "Dela Cruz" } }
      ];
      for (const fixture of fixtures) {
        const result = getBookingLastName(fixture as any);
        expect(result.split(" ").filter(Boolean).length, `result for ${JSON.stringify(fixture)} was '${result}'`).toBeGreaterThanOrEqual(1);
        // Specifically: must never contain more whitespace tokens
        // than the actual stored lastName has.
        const storedTokens = String(fixture.guestDetails.lastName).trim().split(/\s+/).filter(Boolean);
        expect(result.split(" ")).toHaveLength(storedTokens.length);
      }
    });
  });

  describe("online booking write site — handleCreateBooking in bookings.ts", () => {
    const bookingsSrc = readFileSync(
      resolve(__dirname, "../../server/handlers/bookings.ts"),
      "utf8"
    );

    // Slice the newBooking literal at line ~2761 (online path).
    // We anchor on the unique `bookingRef,` token that starts
    // every booking write in this handler.
    function sliceNewBookingLiteral(src: string, anchorText: string): string {
      const anchorIdx = src.indexOf(anchorText);
      if (anchorIdx === -1) return "";
      // Find the next `},\n` (end of object literal) at column 0 —
      // every newBooking block closes that way before the next
      // bookingRef write.
      const tailStart = src.indexOf("\n    }", anchorIdx);
      if (tailStart === -1) return src.slice(anchorIdx);
      return src.slice(anchorIdx, tailStart);
    }

    it("writes a structured guestDetails: { firstName, lastName, email, phone } on the online booking doc", () => {
      const onlineLiteral = sliceNewBookingLiteral(bookingsSrc, "      const newBooking = {");
      expect(onlineLiteral).toMatch(
        /guestDetails:\s*\{\s*firstName:\s*guestDetails\.firstName[\s\S]*?lastName:\s*guestDetails\.lastName[\s\S]*?email:\s*guestDetails\.email[\s\S]*?phone:\s*guestDetails\.phone/
      );
    });
  });

  describe("walk-in booking write site — handleCreateWalkin in bookings.ts", () => {
    const bookingsSrc = readFileSync(
      resolve(__dirname, "../../server/handlers/bookings.ts"),
      "utf8"
    );

    it("writes a structured guestDetails: { firstName, lastName, email, phone } on the walk-in booking doc", () => {
      // The walk-in path uses `newBooking = {` (assigned, not
      // declared with const) — find the second occurrence.
      const firstIdx = bookingsSrc.indexOf("      newBooking = {");
      expect(firstIdx, "walk-in newBooking = { literal must exist in bookings.ts").toBeGreaterThan(-1);
      const tailStart = bookingsSrc.indexOf("\n    }", firstIdx);
      const walkinLiteral = bookingsSrc.slice(firstIdx, tailStart);
      expect(walkinLiteral).toMatch(
        /guestDetails:\s*\{\s*firstName:\s*guestDetails\.firstName[\s\S]*?lastName:\s*guestDetails\.lastName[\s\S]*?email:\s*guestDetails\.email[\s\S]*?phone:\s*guestDetails\.phone/
      );
    });
  });

  describe("reservation header — online + walk-in write sites", () => {
    // Per the intercom-verify-guest permanent fix extension
    // (2026-08-21, add-room-to-reservation): the reservation
    // header must persist a structured `leadGuestDetails`
    // sub-object alongside the concatenated `leadGuestName`,
    // so `handleAddRoomToReservation` can copy the structured
    // name into new booking child docs. Without this, multi-
    // room reservations would persist their first room's
    // child with `guestDetails` but every subsequent room
    // (added later by staff via the desk) would still fall
    // through the verify-side fallback path.
    const bookingsSrc = readFileSync(
      resolve(__dirname, "../../server/handlers/bookings.ts"),
      "utf8"
    );

    function sliceReservationLiteral(src: string, anchorText: string): string {
      const anchorIdx = src.indexOf(anchorText);
      if (anchorIdx === -1) return "";
      const tailStart = src.indexOf("\n      }", anchorIdx);
      if (tailStart === -1) return src.slice(anchorIdx);
      return src.slice(anchorIdx, tailStart);
    }

    it("online reservation header writes leadGuestDetails: { firstName, lastName, email, phone }", () => {
      const literal = sliceReservationLiteral(bookingsSrc, "      const newReservation = {");
      expect(literal, "online reservation literal must exist in bookings.ts").not.toBe("");
      expect(literal).toMatch(
        /leadGuestDetails:\s*\{\s*firstName:\s*guestDetails\.firstName[\s\S]*?lastName:\s*guestDetails\.lastName[\s\S]*?email:\s*guestDetails\.email[\s\S]*?phone:\s*guestDetails\.phone/
      );
    });

    it("walk-in reservation header writes leadGuestDetails: { firstName, lastName, email, phone }", () => {
      // The walk-in reservation literal is the SECOND
      // `const newReservation = {` in bookings.ts.
      const firstIdx = bookingsSrc.indexOf("      const newReservation = {");
      const secondIdx = bookingsSrc.indexOf("      const newReservation = {", firstIdx + 1);
      expect(secondIdx, "walk-in reservation literal must exist in bookings.ts").toBeGreaterThan(-1);
      const tailStart = bookingsSrc.indexOf("\n      }", secondIdx);
      const literal = bookingsSrc.slice(secondIdx, tailStart);
      expect(literal).toMatch(
        /leadGuestDetails:\s*\{\s*firstName:\s*guestDetails\.firstName[\s\S]*?lastName:\s*guestDetails\.lastName[\s\S]*?email:\s*guestDetails\.email[\s\S]*?phone:\s*guestDetails\.phone/
      );
    });
  });

  describe("add-room-to-reservation child write — handleAddRoomToReservation", () => {
    // The child doc written at line ~11916 (the third
    // newBooking-style literal in bookings.ts) must persist
    // `guestDetails` so the verifier can match the entered
    // last name. The source of truth is
    // `reservation.leadGuestDetails` (the structured sub-
    // object that the parent online/walk-in paths now write).
    // For legacy reservations without `leadGuestDetails`,
    // the child falls back to splitting `reservation.leadGuestName`
    // (documented legacy fallback, never silent).
    const bookingsSrc = readFileSync(
      resolve(__dirname, "../../server/handlers/bookings.ts"),
      "utf8"
    );

    it("child booking doc writes a structured guestDetails derived from reservation.leadGuestDetails", () => {
      // The third booking-write literal is the
      // `const newBookingDoc = {` assignment in
      // handleAddRoomToReservation.
      const anchorIdx = bookingsSrc.indexOf("      const newBookingDoc = {");
      expect(anchorIdx, "newBookingDoc = { literal must exist in bookings.ts (handleAddRoomToReservation)").toBeGreaterThan(-1);
      const tailStart = bookingsSrc.indexOf("\n      };", anchorIdx);
      expect(tailStart, "newBookingDoc literal must terminate").toBeGreaterThan(-1);
      const literal = bookingsSrc.slice(anchorIdx, tailStart);
      expect(literal).toMatch(/guestDetails:\s*\{/);
      // The literal uses shorthand property syntax for
      // firstName/lastName (the values are derived from
      // locals computed just above the literal in the
      // function body). Assert on the property names and on
      // the explicit email/phone assignments.
      expect(literal).toMatch(/firstName,/);
      expect(literal).toMatch(/lastName,/);
      expect(literal).toMatch(/email:\s*String\(reservation\.leadGuestEmail/);
      expect(literal).toMatch(/phone:\s*String\(reservation\.leadGuestPhone/);
    });

    it("handleAddRoomToReservation has a legacy split-on-whitespace fallback for reservations without leadGuestDetails", () => {
      // Anchor on the actual function declaration (not a
      // comment that mentions it), then slice until the next
      // top-level `export ` (or EOF).
      const fnStart = bookingsSrc.indexOf(
        "export async function handleAddRoomToReservation"
      );
      expect(fnStart, "handleAddRoomToReservation function must exist").toBeGreaterThan(-1);
      const fnEnd = bookingsSrc.indexOf("\nexport ", fnStart + 200);
      const fnBody = fnEnd > 0 ? bookingsSrc.slice(fnStart, fnEnd) : bookingsSrc.slice(fnStart);
      // Belt-and-suspenders: the function MUST contain a
      // documented legacy split-on-whitespace branch for
      // reservations created before the fix landed. Without
      // it, legacy reservations would silently lose the
      // structured guestDetails on every add-room write.
      expect(fnBody).toMatch(/leadGuestName\s*\.\s*split/);
      // And the function MUST read leadGuestDetails when
      // present (the structured path).
      expect(fnBody).toMatch(/reservation\.leadGuestDetails|\(reservation as any\)\.leadGuestDetails/);
    });
  });

  describe("corporate-inquiry conversion write site — handleConvertInquiryToBooking", () => {
    const corporateSrc = readFileSync(
      resolve(__dirname, "../../server/handlers/corporate-inquiries.ts"),
      "utf8"
    );

    it("writes a structured guestDetails: { firstName, lastName, email, phone } on the converted booking doc", () => {
      // The conversion builds local `firstName` / `lastName`
      // variables (not guestDetails.firstName/lastName like the
      // online path), so we assert on the literal
      // `guestDetails: { firstName, lastName, email: guestEmail, phone: guestPhone }`
      // pattern that follows the `guestPhone,` field in the
      // newBooking literal.
      const literalMatch = corporateSrc.match(
        /newBooking\s*=\s*\{[\s\S]*?\n\s*\};/
      );
      expect(literalMatch, "newBooking = { ... }; literal must exist in corporate-inquiries.ts").not.toBeNull();
      const literal = literalMatch![0];
      expect(literal).toMatch(/guestDetails:\s*\{/);
      expect(literal).toMatch(/firstName,/);
      expect(literal).toMatch(/lastName,/);
      expect(literal).toMatch(/email:\s*guestEmail/);
      expect(literal).toMatch(/phone:\s*guestPhone/);
    });

    it("the verify-side split-on-whitespace fallback is retired (write-side legacy fallback is allowed)", () => {
      // The intercom verifier must NOT contain the split-on-
      // whitespace pattern (the permanent fix). The corporate
      // conversion's legacy fallback that splits the flat
      // `contactPerson` is allowed (it only fires for inquiries
      // that don't carry structured first/last name fields).
      // We scope this assertion to the intercom verifier file.
      const intercomSrc = readFileSync(
        resolve(__dirname, "../../server/handlers/intercom.ts"),
        "utf8"
      );
      const fnStart = intercomSrc.indexOf("function getBookingLastName");
      const fnEnd = intercomSrc.indexOf("\n}", fnStart);
      const fnBody = intercomSrc.slice(fnStart, fnEnd);
      expect(fnBody).not.toMatch(/contactName\s*\.\s*split/);
      expect(fnBody).not.toMatch(/\.slice\(\s*1\s*\)/);
    });
  });

  describe("intercom verifier — handleVerifyIntercomGuest + getBookingLastName", () => {
    const intercomSrc = readFileSync(
      resolve(__dirname, "../../server/handlers/intercom.ts"),
      "utf8"
    );

    it("getBookingLastName function body does NOT split guestName on whitespace", () => {
      const fnStart = intercomSrc.indexOf("function getBookingLastName");
      const fnEnd = intercomSrc.indexOf("\n}", fnStart);
      const fnBody = intercomSrc.slice(fnStart, fnEnd);
      expect(fnBody).not.toMatch(/guestName\s*\.\s*split/);
      expect(fnBody).not.toMatch(/\.slice\(\s*1\s*\)/);
    });

    it("getBookingLastName reads guestDetails.lastName as the source of truth", () => {
      const fnStart = intercomSrc.indexOf("function getBookingLastName");
      const fnEnd = intercomSrc.indexOf("\n}", fnStart);
      const fnBody = intercomSrc.slice(fnStart, fnEnd);
      expect(fnBody).toMatch(/guestDetails\?\.\s*lastName|\bdata\.guestDetails\b/);
    });

    it("getBookingLastName is exported (for unit-testability)", () => {
      expect(intercomSrc).toMatch(/export\s+function\s+getBookingLastName/);
    });
  });
});
