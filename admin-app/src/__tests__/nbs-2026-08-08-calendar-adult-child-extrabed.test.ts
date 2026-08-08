import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per NBS-2026-08-08 (F8, booking-flow audit 2026-08-08):
// the Calendar create path previously only collected
// `guestCount` (the total). The server defaulted to
// "all adults, no extra beds" — a 3-guest booking in
// a 2-adult room silently bypassed the EXB-03
// overflow check and was priced as 3 adults in a
// 2-adult room (the server later downgraded the
// booking, but the desk never saw the
// "add an extra bed" prompt).
//
// The fix mirrors the New Booking modal: the
// Calendar create now collects the adult/child
// split + extra bed count. The form distributes
// `numAdults = guestCount, numChildren = 0` on a
// quick-set via the `Guests` field, and the split
// steppers override when the desk knows the
// actual mix. The server derives
// `numGuests = numAdults + numChildren` (CHD-04)
// and applies the EXB-03 overflow rule against
// the selected room type's `maxExtraBeds`.

const calendarPageSrc = readFileSync(
  resolve(__dirname, "../pages/CalendarPage.tsx"),
  "utf8"
);

describe("NBS-2026-08-08 — Calendar create collects adult/child + extra bed (F8)", () => {
  describe("Form state", () => {
    it("declares numAdults, numChildren, extraBedCount as state", () => {
      // Three new state vars match the New
      // Booking modal's EXB-07 contract. The
      // initial values are 1 / 0 / 0 — the
      // 1-adult default that pre-EXB-07
      // surface used.
      expect(calendarPageSrc).toMatch(
        /const \[numAdults, setNumAdults\] = useState\(1\)/
      );
      expect(calendarPageSrc).toMatch(
        /const \[numChildren, setNumChildren\] = useState\(0\)/
      );
      expect(calendarPageSrc).toMatch(
        /const \[extraBedCount, setExtraBedCount\] = useState\(0\)/
      );
    });
  });

  describe("Form UI", () => {
    it("renders Adults + Children + Extra beds inputs alongside the Guests field", () => {
      // The Calendar create modal form gains the
      // same three steppers the New Booking
      // modal has. The previous shape only
      // rendered the single Guests field.
      const formMatch = calendarPageSrc.match(
        /Guests<input[\s\S]*?onChange=\{\(e\) => \{[\s\S]*?setNumAdults\(nextTotal\)/
      );
      expect(formMatch).not.toBeNull();
      expect(calendarPageSrc).toMatch(/Adults<input type="number" min=\{1\} max=\{20\} value=\{numAdults\}/);
      expect(calendarPageSrc).toMatch(/Children<input type="number" min=\{0\} max=\{20\} value=\{numChildren\}/);
      expect(calendarPageSrc).toMatch(/Extra beds<input type="number" min=\{0\} max=\{10\} value=\{extraBedCount\}/);
    });

    it("the Guests quick-set field auto-distributes to numAdults + 0 children", () => {
      // When the desk types a total into the
      // `Guests` field, the onChange handler
      // sets `numAdults = nextTotal,
      // numChildren = 0` so the split stays in
      // sync. The split steppers override when
      // the desk knows the actual mix.
      const quickSetMatch = calendarPageSrc.match(
        /onChange=\{\(e\) => \{[\s\S]*?const nextTotal = Math\.max\(1, Number\(e\.target\.value\) \|\| 1\)[\s\S]*?setNumAdults\(nextTotal\)[\s\S]*?setNumChildren\(0\)[\s\S]*?setGuestCount\(nextTotal\)/
      );
      expect(quickSetMatch).not.toBeNull();
    });
  });

  describe("Submit handler", () => {
    it("refuses to submit when adults + children < 1 (the all-zero case)", () => {
      // The submit guards `numAdults + numChildren
      // < 1` so the desk can't send a 0-guest
      // booking. The guard is at the top of the
      // submit handler, before the wire call.
      const guardMatch = calendarPageSrc.match(
        /if \(safeNumAdults \+ safeNumChildren < 1\) \{[\s\S]*?toast\.warning\(\s*"Guest count required"/
      );
      expect(guardMatch).not.toBeNull();
    });

    it("sends the adult/child split + extra bed count to addWalkinBooking", () => {
      // The wire payload now includes
      // `numAdults`, `numChildren`,
      // `extraBedCount`. The server's
      // `WalkinBookingSchema` (already
      // optional + validated per EXB-01 /
      // EXB-12) accepts the new fields.
      const wireMatch = calendarPageSrc.match(
        /numAdults: safeNumAdults,[\s\S]*?numChildren: safeNumChildren,[\s\S]*?extraBedCount,/
      );
      expect(wireMatch).not.toBeNull();
    });

    it("derives numGuests = adults + children for the addWalkinBooking call", () => {
      // The pre-F8 path sent `numGuests:
      // guestCount` (the raw state). The
      // post-F8 path derives `numGuests =
      // safeNumAdults + safeNumChildren` so
      // the wire payload stays consistent
      // with the CHD-04 server contract.
      const deriveMatch = calendarPageSrc.match(
        /numGuests: safeNumAdults \+ safeNumChildren,/
      );
      expect(deriveMatch).not.toBeNull();
    });
  });

  describe("Post-success reset", () => {
    it("resets numAdults / numChildren / extraBedCount to 1 / 0 / 0", () => {
      // The post-success reset clears the
      // split + extra bed state so the next
      // booking starts from the common
      // single-room state. The pre-F8 reset
      // only cleared `setGuestCount(1)`.
      const resetMatch = calendarPageSrc.match(
        /setNumAdults\(1\);[\s\S]*?setNumChildren\(0\);[\s\S]*?setExtraBedCount\(0\);/
      );
      expect(resetMatch).not.toBeNull();
    });
  });
});
