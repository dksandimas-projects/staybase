// Per FOL-05 (2026-08-07, per decision #201):
// dashboard "pending payment alerts" — one card per
// RESERVATION, not one card per room. The operator-
// reported bug was "for reservations with multiple
// rooms, I see 1 row for verification per room".
// The pre-FOL-05 list was `bookings.filter(b =>
// b.status === "payment-uploaded")` — flat per-booking,
// no reservation grouping. The post-FOL-05 list
// groups children of a `reservationId` into a single
// `PendingPaymentItem` (the reservation-scope
// contract), with reservation-scope total/paid/due
// (read from the `reservations` listener + the
// `collectionGroup("payments")` aggregate, the same
// data the BookingsPage reservation row reads) +
// a per-room coverage preview in the verify modal
// (the staff sees which rooms the amount they're
// about to verify will clear before they hit
// submit). The verify amount pre-fills to the
// reservation's outstanding balance (not one
// child's price).
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md
// §Testing`): cheap, deterministic, <5s. The
// behavioural round-trip is the live
// `DashboardPage` — the source-text guards below
// pin the FOL-05 contract at the source level so a
// future "I'll just revert to per-booking" refactor
// breaks the test instead of silently regressing.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dashboardSrc = readFileSync(
  resolve(__dirname, "../pages/DashboardPage.tsx"),
  "utf8"
);

describe("FOL-05 — dashboard pending payments are reservation-grouped", () => {
  describe("the grouped `PendingPaymentItem` shape", () => {
    it("declares the `PendingPaymentItem` type at module scope (above the component)", () => {
      // The type is declared OUTSIDE the component (so
      // the `useState<PendingPaymentItem | null>(null)`
      // declaration in the verify-target state can
      // reference it without an import dance). The
      // placement is part of the contract.
      const typeIndex = dashboardSrc.indexOf("type PendingPaymentItem = {");
      const componentIndex = dashboardSrc.indexOf("export function DashboardPage()");
      expect(typeIndex).toBeGreaterThan(-1);
      expect(componentIndex).toBeGreaterThan(-1);
      expect(typeIndex).toBeLessThan(componentIndex);
    });

    it("the type carries reservation-scope fields (`totalPrice`, `paidAmount`, `dueAmount`, `rooms[]`)", () => {
      // The post-FOL-05 surface reads the
      // reservation-scope total / paid / due from
      // the `reservations` listener + the
      // `collectionGroup("payments")` aggregate —
      // NOT the per-booking sum. The type exposes
      // these as the card-render's primary inputs.
      expect(dashboardSrc).toMatch(/type PendingPaymentItem = \{[\s\S]{0,2000}?totalPrice: number;/);
      expect(dashboardSrc).toMatch(/paidAmount: number;/);
      expect(dashboardSrc).toMatch(/dueAmount: number;/);
      expect(dashboardSrc).toMatch(/rooms: PendingPaymentRoom\[\];/);
    });
  });

  describe("the grouped `useMemo` computation", () => {
    it("groups children by `reservationId` (the FOL-05 grouping key)", () => {
      // The pre-FOL-05 surface was a flat
      // `bookings.filter(b => b.status === "payment-uploaded")`.
      // The post-FOL-05 surface builds a
      // `Map<string, Booking[]>` keyed by
      // `reservationId` (with a `legacy:` prefix for
      // null-`reservationId` bookings) + iterates
      // over the groups to build `PendingPaymentItem`s.
      expect(dashboardSrc).toMatch(
        /const groups = new Map<string, Booking\[\]>\(\);/
      );
      expect(dashboardSrc).toMatch(
        /const key = String\(booking\.reservationId \|\| ""\)\.trim\(\) \|\| `legacy:\$\{booking\.id\}`;/
      );
    });

    it("sorts grouped children by `reservationPosition` (the FOL-05 lead is the first child)", () => {
      // The lead booking is the FOL-05 verify /
      // reject target. The MRB-07 contract pins
      // `reservationPosition` to the per-child
      // ordinal (1-indexed); the lowest position
      // is the first child = the lead.
      expect(dashboardSrc).toMatch(
        /const sorted = \[\.\.\.children\]\.sort\(\s*\(a, b\) => \(a\.reservationPosition \|\| 0\) - \(b\.reservationPosition \|\| 0\)\s*\)/
      );
    });

    it("reads the paid amount from the `collectionGroup(\"payments\")` aggregate (the MRB-12 wire)", () => {
      // The post-FOL-05 surface reads the
      // reservation-scope paid total from
      // `reservationPaidAmount[reservationId]` —
      // the same wire the BookingsPage reservation
      // row reads (per MRB-12). The fallback to
      // the in-memory `onsitePayments` sum is
      // for cold-start races (the listener hasn't
      // hydrated yet).
      expect(dashboardSrc).toMatch(
        /const aggregatePaid = reservationPaidAmount\[key\] \|\| 0;/
      );
      expect(dashboardSrc).toMatch(
        /const paidAmount = aggregatePaid > 0 \? aggregatePaid : fallbackPaid;/
      );
    });

    it("falls back to the children-sum for the total when the header hasn't hydrated (the cold-start race)", () => {
      // The reservation-scope total prefers the
      // `Reservation.totalPrice` from the
      // `reservations` listener. Falls back to the
      // children-sum for the cold-start race
      // (the listener hydrates on the first
      // snapshot; the post-FOL-05 first paint
      // byte-matches the pre-FOL-05 surface for
      // the duration of that race).
      expect(dashboardSrc).toMatch(
        /const scopedTotal = headerTotalPrice > 0 \? headerTotalPrice : totalPrice;/
      );
    });
  });

  describe("the dashboard card render — one card per `PendingPaymentItem`", () => {
    it("renders `{N} rooms` chip for grouped items (the FOL-05 affordance)", () => {
      // The card shows the room count as a chip
      // for grouped items. The pre-FOL-05 surface
      // showed the per-room `roomNumber`; the
      // post-FOL-05 surface shows the count for
      // the grouped case (a single room is the
      // legacy / N=1 case, treated as
      // byte-equivalent to pre-FOL-05).
      expect(dashboardSrc).toMatch(
        /item\.isReservation\s*\?\s*`\$\{item\.rooms\.length\} rooms`\s*:\s*`Room \$\{item\.rooms\[0\]\?\.roomNumber \|\| "TBD"\}`/
      );
    });

    it("renders reservation-scope `Reservation total` + `Reservation due` labels for grouped items", () => {
      // The pre-FOL-05 surface used "Booking
      // total" + "Outstanding" — per-room labels.
      // The post-FOL-05 surface uses "Reservation
      // total" + "Reservation due" for grouped
      // items (the labels match the wire contract
      // the BookingsPage reservation row already
      // uses).
      expect(dashboardSrc).toMatch(
        /item\.isReservation \? "Reservation total" : "Booking total"/
      );
      expect(dashboardSrc).toMatch(
        /item\.isReservation \? "Reservation due" : "Outstanding"/
      );
    });

    it("calls `openVerifyForm(item)` (not `openVerifyForm(booking)`) — the FOL-05 item-level wiring", () => {
      // The verify button hands the WHOLE item
      // (not the lead booking) to the verify
      // form. The form derives the
      // reservation-scope `dueAmount` from the
      // item + opens the coverage preview.
      expect(dashboardSrc).toMatch(
        /onClick=\{\(\) => \{[\s\S]{0,100}?cancelRejectForm\(\);[\s\S]{0,100}?openVerifyForm\(item\);/
      );
      // The pre-FOL-05 call site used the
      // `booking` variable name; the post-FOL-05
      // site uses `item`. Pinned at the source
      // level so a future "let me just revert to
      // per-booking" refactor breaks the test.
      expect(dashboardSrc).not.toMatch(
        /onClick=\{\(\) => \{[\s\S]{0,100}?cancelRejectForm\(\);[\s\S]{0,100}?openVerifyForm\(booking\);/
      );
    });
  });

  describe("the verify modal — reservation-scope amount + per-room coverage preview", () => {
    it("declares a `verifyScope` state (the FOL-05 reservation-scope context)", () => {
      // The verify modal needs the
      // reservation-scope context (`PendingPaymentItem`)
      // SEPARATE from the verify target
      // (`Booking | null`). The `verifyScope` is
      // `null` for the N=1 / legacy case; set
      // when the staff opens the verify form on
      // a grouped card.
      expect(dashboardSrc).toMatch(
        /const \[verifyScope, setVerifyScope\] = useState<PendingPaymentItem \| null>\(null\);/
      );
    });

    it("the verify form pre-fills the amount to the reservation-scope `dueAmount` (NOT the per-room `totalPrice`)", () => {
      // The pre-FOL-05 form pre-filled to
      // `booking.totalPrice - onsitePayments.reduce(...)`
      // — the lead room's outstanding balance, NOT
      // the reservation's. The post-FOL-05 form
      // pre-fills to `item.dueAmount` (the
      // reservation-scope outstanding).
      expect(dashboardSrc).toMatch(/setVerifyAmount\(String\(item\.dueAmount\)\);/);
    });

    it("the verify modal renders a per-room coverage preview when `verifyScope.isReservation`", () => {
      // The coverage preview is a CLIENT-SIDE
      // approximation: for each room, it shows
      // "Cleared" / "{N} still owed" / "Pending"
      // based on the entered amount. The server's
      // `handleVerifyAndRecordPayment` is the
      // source of truth; the preview is a UX
      // hint that updates live as the staff
      // edits the amount.
      expect(dashboardSrc).toMatch(
        /verifyScope\?\.isReservation && verifyScope\.rooms\.length > 1/
      );
      expect(dashboardSrc).toMatch(/Coverage preview/);
      expect(dashboardSrc).toMatch(/willBeCleared/);
    });

    it("the verify modal uses the reservation ref (NOT the lead's booking ref) for the title when grouped", () => {
      // The pre-FOL-05 title used
      // `verifyTarget.bookingRef` (the lead
      // booking's `SI-XXXXX` ref). The
      // post-FOL-05 title uses
      // `verifyScope?.publicRef || verifyTarget.bookingRef`
      // — the `R-YYYYMMDD-NNNNN` reservation ref
      // for grouped items, the lead's `SI-XXXXX`
      // for legacy / N=1.
      expect(dashboardSrc).toMatch(
        /title=\{verifyTarget \? `Verify payment — \$\{verifyScope\?\.publicRef \|\| verifyTarget\.bookingRef\}` : "Verify payment"\}/
      );
    });

    it("the verify success modal uses the reservation-scope math (NOT the per-room math) for `isFullPayment` + `remainingBalance`", () => {
      // The pre-FOL-05 success modal math used
      // `verifyTarget.onsitePayments?.reduce(...)` —
      // the lead's per-room onsite array. The
      // post-FOL-05 success modal math uses
      // `verifyScope.paidAmount` (the
      // `collectionGroup("payments")` aggregate)
      // so the `isFullPayment` + `remainingBalance`
      // reflect the RESERVATION-scope math, not
      // the lead's per-room math.
      expect(dashboardSrc).toMatch(
        /const scopeExistingPaid = verifyScope\s*\?\s*verifyScope\.paidAmount\s*:/
      );
      expect(dashboardSrc).toMatch(
        /const scopeTotal = verifyScope\s*\?\s*verifyScope\.totalPrice\s*:/
      );
    });
  });

  describe("the rejection modal — reservation-scope wording (FOL-05 clarification)", () => {
    it("the rejection copy toggles between per-room and reservation-scope wording", () => {
      // A grouped rejection bounces EVERY
      // `payment-uploaded` sibling room back to
      // `pending` (the
      // `handleRejectPayment` sibling-rejection
      // pass). The modal text surfaces this
      // ("along with every other room in this
      // reservation" + "rooms ... remain held")
      // so the staff knows the scope.
      expect(dashboardSrc).toMatch(
        /rejectionTarget\.reservationId \? " \(along with every other room in this reservation\)" : ""/
      );
      expect(dashboardSrc).toMatch(/rejectionTarget\.reservationId \? "s" : ""/);
    });
  });
});
