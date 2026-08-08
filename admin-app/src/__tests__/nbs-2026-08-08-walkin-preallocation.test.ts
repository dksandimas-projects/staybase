import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per NBS-2026-08-08 (F1, booking-flow audit 2026-08-08):
// the admin walk-in create path now preallocates the
// `bookingId` + `reservationId` in a `useState` lazy init
// at the modal level. The pair is reused across retries
// inside the same modal session, so a
// retry-after-uncertain-response hits the server's
// idempotency replay path (MRB-02 / decision #164)
// instead of creating a duplicate booking. The
// `addWalkinBooking` helper in AdminContext accepts the
// preallocated pair as optional parameters; absent =
// auto-mint (the historical default, preserved for
// back-compat with the Calendar create path).
//
// The Calendar create modal has the same pattern (the
// `calendarPreallocatedBookingId` + `calendarPreallocatedReservationId`
// preallocation + key rotation). This test file pins
// both surfaces at the source-text level.

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);
const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);
const calendarPageSrc = readFileSync(
  resolve(__dirname, "../pages/CalendarPage.tsx"),
  "utf8"
);

describe("NBS-2026-08-08 — admin walk-in create preallocates bookingId + reservationId (F1)", () => {
  describe("AdminContext.addWalkinBooking accepts the preallocations", () => {
    it("imports generateReservationId from @spark-inn/shared (the shared reservation id helper)", () => {
      // The same helper the public /book flow uses to
      // mint the reservationId. The shape is guaranteed
      // to pass the shared `RESERVATION_ID_REGEX` on
      // the server side.
      expect(adminContextSrc).toMatch(
        /generateReservationId,\s*\n\s*normalizeDiscountScope/
      );
    });

    it("declares preallocatedBookingId + preallocatedReservationId as optional input parameters", () => {
      // The interface extension lives on the
      // `addWalkinBooking` input type. Both are
      // optional so the historical auto-mint
      // behavior is preserved for any caller that
      // doesn't preallocate.
      const inputMatch = adminContextSrc.match(
        /addWalkinBooking:\s*\([\s\S]*?preallocatedBookingId\?:\s*string;[\s\S]*?preallocatedReservationId\?:\s*string;[\s\S]*?\) =>/
      );
      expect(inputMatch).not.toBeNull();
    });

    it("uses the preallocated bookingId when supplied, otherwise auto-mints via doc(collection)", () => {
      // The preallocation is the preferred path; absent,
      // the historical `doc(collection(db, "bookings")).id`
      // auto-mint stays as the back-compat default. The
      // exact OR form (`input.preallocatedBookingId ||`)
      // ensures an empty string falls through to the
      // auto-mint (a defensive read against an accidental
      // empty-string preallocation).
      const preallocMatch = adminContextSrc.match(
        /const bookingId = input\.preallocatedBookingId \|\| doc\(collection\(db, "bookings"\)\)\.id/
      );
      expect(preallocMatch).not.toBeNull();
    });

    it("uses the preallocated reservationId when supplied, otherwise auto-mints via generateReservationId()", () => {
      const preallocMatch = adminContextSrc.match(
        /const reservationId = input\.preallocatedReservationId \|\| generateReservationId\(\)/
      );
      expect(preallocMatch).not.toBeNull();
    });

    it("threads reservationId into the create-walkin request body (when present)", () => {
      // The body only carries the field when present —
      // server-side schema accepts both shapes
      // (decision #164 / MRB-02.x). The `...(reservationId ? { reservationId } : {})`
      // spread is the back-compat pattern: absent the
      // server auto-mints, just like the historical
      // pre-NBS-2026-08-08 path.
      const bodyMatch = adminContextSrc.match(
        /\.\.\.\(reservationId \? \{ reservationId \} : \{\}\)/
      );
      expect(bodyMatch).not.toBeNull();
    });
  });

  describe("BookingsPage New Booking modal — preallocation + rotation", () => {
    it("imports generateReservationId from @spark-inn/shared (the preallocation contract)", () => {
      expect(bookingsPageSrc).toMatch(
        /generateReservationId\s*\n\} from "@spark-inn\/shared"/
      );
    });

    it("declares walkinPreallocKey + walkinPreallocatedIds as a useMemo on the key", () => {
      // The pair is recomputed via `useMemo` when
      // `walkinPreallocKey` changes — a `useState`
      // lazy init would only run once on mount and
      // can't be rotated without a remount. The
      // `useMemo` keyed on the rotation counter is
      // the React-idiomatic way to re-derive on
      // demand.
      const memoMatch = bookingsPageSrc.match(
        /const walkinPreallocatedIds = useMemo\(\(\) => \(\{[\s\S]*?bookingId: doc\(collection\(db, "bookings"\)\)\.id,[\s\S]*?reservationId: generateReservationId\(\)[\s\S]*?\}\), \[walkinPreallocKey\]\)/
      );
      expect(memoMatch).not.toBeNull();
    });

    it("rotates the preallocation key when the modal opens (one fresh pair per open)", () => {
      // A `useRef` flag guards the rotation so a
      // re-render while the modal is already open
      // doesn't mint a new pair mid-submit. The
      // pre-MRB-02 effect (without the ref guard)
      // would rotate on every render of the parent.
      const effectMatch = bookingsPageSrc.match(
        /if \(isModalOpen && !wasModalOpenRef\.current\) \{[\s\S]*?setWalkinPreallocKey\(\(key\) => key \+ 1\)/
      );
      expect(effectMatch).not.toBeNull();
    });

    it("threads the preallocations into the addWalkinBooking call inside the submit handler", () => {
      // The submit handler passes both fields
      // explicitly so the helper can use the same
      // pair across retries. A comment in the
      // source documents the contract.
      const callMatch = bookingsPageSrc.match(
        /preallocatedBookingId: walkinPreallocatedBookingId,[\s\S]*?preallocatedReservationId: walkinPreallocatedReservationId,/
      );
      expect(callMatch).not.toBeNull();
    });

    it("rotates the preallocation key after a successful submit (the next booking gets a fresh pair)", () => {
      // A successful commit rotates the key so the
      // next modal open generates a fresh pair.
      // Reusing the just-committed pair would (a)
      // collide with the existing reservation
      // header on the server, and (b) cause a
      // non-idempotent replay to land a second
      // booking under the same id.
      const resetMatch = bookingsPageSrc.match(
        /setWalkinPreallocKey\(\(key\) => key \+ 1\);[\s\S]*?setIsModalOpen\(false\)/
      );
      expect(resetMatch).not.toBeNull();
    });
  });

  describe("CalendarPage create modal — preallocation + rotation (F1 Calendar mirror)", () => {
    it("imports generateReservationId from @spark-inn/shared", () => {
      expect(calendarPageSrc).toMatch(
        /generateReservationId\s*\n\} from "@spark-inn\/shared"/
      );
    });

    it("imports collection + doc + db for the preallocation contract", () => {
      // The Calendar's preallocation pattern mirrors
      // the BookingsPage modal — needs the same
      // firebase/firestore primitives + the shared db
      // instance.
      expect(calendarPageSrc).toMatch(
        /import \{ collection, doc \} from "firebase\/firestore"/
      );
      expect(calendarPageSrc).toMatch(
        /import \{ db \} from "\.\.\/firebase\/config"/
      );
    });

    it("declares calendarPreallocKey + calendarPreallocatedIds as a useMemo on the key", () => {
      const memoMatch = calendarPageSrc.match(
        /const calendarPreallocatedIds = useMemo\(\(\) => \(\{[\s\S]*?bookingId: doc\(collection\(db, "bookings"\)\)\.id,[\s\S]*?reservationId: generateReservationId\(\)[\s\S]*?\}\), \[calendarPreallocKey\]\)/
      );
      expect(memoMatch).not.toBeNull();
    });

    it("rotates the preallocation key when the booking modal opens", () => {
      const effectMatch = calendarPageSrc.match(
        /if \(isBookingModalOpen && !wasCalendarModalOpenRef\.current\) \{[\s\S]*?setCalendarPreallocKey\(\(key\) => key \+ 1\)/
      );
      expect(effectMatch).not.toBeNull();
    });

    it("threads the preallocations into the addWalkinBooking call + rotates after success", () => {
      // The submit handler passes both fields; the
      // success branch rotates the key. The pattern
      // is the same as the BookingsPage modal — the
      // test asserts both halves.
      const callMatch = calendarPageSrc.match(
        /preallocatedBookingId: calendarPreallocatedBookingId,[\s\S]*?preallocatedReservationId: calendarPreallocatedReservationId,/
      );
      expect(callMatch).not.toBeNull();
      const resetMatch = calendarPageSrc.match(
        /setCalendarPreallocKey\(\(key\) => key \+ 1\);/
      );
      expect(resetMatch).not.toBeNull();
    });
  });
});
