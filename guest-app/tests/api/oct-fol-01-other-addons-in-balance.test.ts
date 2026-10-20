// Per OCT-FOL-01 (2026-10-20, decision #298): the BR-12 other
// add-ons are part of the folio BALANCE.
//
// The bug: the other add-ons are NOT inside `booking.totalPrice`
// (per `plan/features/OTHER-ADD-ONS.md` decision 2 — "added on top
// of it for the balance"), but the folio ignored them entirely. A
// booking with a ₱2,000 airport transfer the guest had not paid for
// showed a ₱0 balance: the hotel was owed the money and every
// balance surface said the guest was settled.
//
// The guest's post-booking Manage page has ALWAYS computed it
// correctly (`totalPrice + otherAddOnTotal - paidAmount`,
// `guest-app/server/handlers/addons-manage.ts`) — so the admin +
// server folio now agrees with the guest's own view.
//
// The runtime behaviour of the shared helpers is pinned in
// `shared/__tests__/booking-folio.test.ts`. This file pins the
// WIRING — that the value actually reaches every surface.
//
// It also pins the two consequences that would otherwise leave the
// desk with numbers that contradict each other:
//   - the admin table's payment-state filter must use the folio's
//     denominator (a booking with an unpaid transfer must not be
//     classified "paid" while the drawer shows a balance), and
//   - the folio breakdown + the receipt PDF must itemise the
//     add-ons, so the lines add up to the total.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const folioSrc = read("shared/utils/bookingFolio.ts");
const bookingsHandlerSrc = read("guest-app/server/handlers/bookings.ts");
const bookingsPageSrc = read("admin-app/src/pages/BookingsPage.tsx");
const drawerSrc = read("admin-app/src/components/BookingDrawerWorkspace.tsx");
const manageOtherAddOnsSrc = read("guest-app/server/handlers/addons-manage.ts");

describe("OCT-FOL-01 — the shared folio includes the other add-ons (wiring)", () => {
  it("the shared booking shape carries the field", () => {
    expect(folioSrc).toMatch(
      /interface FolioBooking \{[\s\S]*?otherAddOnTotal\?: number \| null;/
    );
  });

  it("the grand total adds the other add-ons", () => {
    expect(folioSrc).toMatch(
      /const grandTotal = totalPrice \+ otherAddOnTotal \+ storeTotal \+ chargesTotal;/
    );
  });

  it("the server helper adds them too", () => {
    expect(folioSrc).toMatch(
      /const folioTotal =\s*\n?\s*totalPrice \+ otherAddOnTotal \+ incidentalTotal \+ addToBillTotal;/
    );
  });

  it("the folio result exposes the line so the UI can itemise it", () => {
    expect(folioSrc).toMatch(/otherAddOnTotal: number;\s*\n\s*grandTotal: number;/);
  });
});

describe("OCT-FOL-01 — the server passes the field through (wiring)", () => {
  it("the folio snapshot carries it", () => {
    expect(bookingsHandlerSrc).toMatch(
      /interface TransactionalFolioSnapshot \{[\s\S]*?otherAddOnTotal: number;/
    );
  });

  it("the legacy single-booking path passes the booking's own total", () => {
    expect(bookingsHandlerSrc).toMatch(
      /const otherAddOnTotal = Math\.max\(\s*0,\s*Number\(\(bookingData as any\)\.otherAddOnTotal\) \|\| 0\s*\);/
    );
  });

  it("the reservation path SUMS the children's totals", () => {
    // The reservation header's `totalPrice` IS the sum of the
    // children's `totalPrice`, so the other add-ons must be summed
    // the same way — the child's value alone would under-count a
    // multi-room reservation.
    expect(bookingsHandlerSrc).toMatch(
      /const otherAddOnTotal = childBookingsSnapshot\.docs\.reduce\([\s\S]{0,220}?otherAddOnTotal/
    );
  });

  it("both `computeServerFolioTotals` call sites pass the term", () => {
    const calls = bookingsHandlerSrc.match(
      /computeServerFolioTotals\(\{[\s\S]*?\}\)/g
    ) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call).toMatch(/otherAddOnTotal/);
    }
  });

  it("the guest's Manage page formula is unchanged — the folio now agrees with it", () => {
    // The reference implementation. If this drifts, the guest's view
    // and the desk's view of the same booking disagree again.
    expect(manageOtherAddOnsSrc).toMatch(
      /const balance = Math\.max\(0, totalPrice \+ otherAddOnTotal - paidAmount\);/
    );
  });
});

describe("OCT-FOL-01 — the admin app passes and shows the field (wiring)", () => {
  it("the admin folio call passes the booking's total", () => {
    // The SELECTED branch overrides the field with the reservation's
    // sum (exactly like it overrides `totalPrice`); every other
    // booking passes the whole object, which already carries its own
    // `otherAddOnTotal`.
    expect(bookingsPageSrc).toMatch(/otherAddOnTotal: selectedFolioOtherAddOnTotal/);
    expect(bookingsPageSrc).toMatch(
      /booking: isSelected\s*\n?\s*\? \{[\s\S]{0,260}?otherAddOnTotal: selectedFolioOtherAddOnTotal/
    );
  });

  it("the multi-room reservation total is the SUM of the children's", () => {
    expect(bookingsPageSrc).toMatch(
      /const selectedFolioOtherAddOnTotal = useMemo\([\s\S]{0,700}?reduce\(\(sum, booking\) => sum \+ Math\.max\(0, Number\(booking\.otherAddOnTotal\) \|\| 0\), 0\)/
    );
  });

  it("the payment-state filter uses the FOLIO's denominator, not `booking.totalPrice`", () => {
    // Otherwise a booking with an unpaid ₱2,000 transfer is
    // classified "paid" while the drawer shows a ₱2,000 balance.
    expect(bookingsPageSrc).toMatch(/const folioBase = folio\.grandTotal;/);
    expect(bookingsPageSrc).toMatch(
      /bPayState === "paid" && totalPayments < folioBase/
    );
    expect(bookingsPageSrc).not.toMatch(
      /bPayState === "paid" && totalPayments < booking\.totalPrice/
    );
  });

  it("the folio breakdown itemises the other add-ons", () => {
    // Without the line the breakdown's rows do not add up to the
    // folio total shown beneath them.
    expect(bookingsPageSrc).toMatch(/<span>Other add-ons<\/span>/);
  });

  it("the receipt PDF itemises the other add-ons", () => {
    expect(bookingsPageSrc).toMatch(
      /drawAmountRow\("Other add-ons", formatAmount\(receiptOtherAddOnTotal\)\)/
    );
  });

  it("the receipt's Folio Charges section prints when the booking has other add-ons only", () => {
    // A transfer with no store charges and no incidental charges
    // would otherwise be silently folded into the total with no
    // line item at all.
    expect(bookingsPageSrc).toMatch(
      /receiptOtherAddOnTotal > 0\s*\n?\s*\)\s*\{/
    );
  });

  it("the drawer's summary strip uses the folio's total", () => {
    // Total / Paid / Balance must share one denominator.
    expect(drawerSrc).toMatch(/folioTotal\?: number \| null;/);
    expect(drawerSrc).toMatch(/formatPrice\(folioTotal \?\? booking\.totalPrice\)/);
    expect(bookingsPageSrc).toMatch(
      /folioTotal=\{selectedBookingFolio\?\.grandTotal \?\? selectedFolioBaseTotal\}/
    );
  });
});
