import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per VPM-01 (2026-11-19, decision #322): the admin verify-booking
// modals — the verify form, the post-verify success modal and the
// confirm-booking confirmation — shipped with four money/label
// defects that only surfaced when the desk actually used them:
//
//   1. The DRAWER's "Verify & Record Payment" button had no IDG
//      gate. The dashboard's pending-payments card had blocked
//      that action on an unverified Senior / PWD ID since decision
//      #227 — the drawer was a one-click bypass of the very gap
//      the gate exists to close ("verify money, reject ID later").
//   2. BOTH verify modals hardcoded their payment-method options
//      (gcash / maya / bank / paypal / cash) instead of sourcing
//      the hotel's CONFIGURED methods. The live deployment keys its
//      bank transfer as `bpi`, so a bank transfer was recorded
//      under `bank` — a key the hotel never configured. This was
//      a regression of the WPM-01 contract (decision #216), whose
//      own test comment says the verify selector already mapped
//      `onsitePaymentMethodOptions`.
//   3. The two surfaces computed "did this payment settle the
//      booking?" with DIFFERENT denominators (the drawer used the
//      folio grand total, the dashboard used the scope's
//      `totalPrice`), so the same payment produced two different
//      headlines AND two different CTAs. The dashboard's "Confirm
//      Booking" CTA also had no balance gate, so a booking that
//      still owed an other add-on could be confirmed with no
//      reason and no four-eyes approval.
//   4. The FOL-05 "X more rooms cleared" breadcrumb was computed
//      by the server, parsed by the admin context, and then
//      dropped by both call sites.
//
// These are source-text guards (the repo's convention for admin
// surfaces) plus behavioural tests for the pure helpers.

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);
const dashboardPageSrc = readFileSync(
  resolve(__dirname, "../pages/DashboardPage.tsx"),
  "utf8"
);
const paymentSuccessModalSrc = readFileSync(
  resolve(__dirname, "../components/PaymentSuccessModal.tsx"),
  "utf8"
);
const confirmWithBalanceSrc = readFileSync(
  resolve(__dirname, "../components/ConfirmWithBalanceForm.tsx"),
  "utf8"
);
const discountGateSrc = readFileSync(
  resolve(__dirname, "../utils/pendingPaymentDiscountGate.ts"),
  "utf8"
);

describe("VPM-01 §1 — the drawer's verify action is gated on the senior/PWD ID", () => {
  it("the drawer imports the room-level IDG gate helpers", () => {
    expect(bookingsPageSrc).toMatch(
      /import\s*\{\s*getDueAmountPreDiscountInRooms,\s*hasUnverifiedDiscountInRooms\s*\}\s*from\s*"\.\.\/utils\/pendingPaymentDiscountGate";/
    );
  });

  it("the drawer derives the gate from the whole verify scope (selected booking + reservation siblings)", () => {
    expect(bookingsPageSrc).toMatch(
      /const selectedVerifyScopeIdgBlocked = hasUnverifiedDiscountInRooms\(selectedVerifyScopeRooms\);/
    );
    // The scope must be the reservation's rooms, not just the
    // selected booking — the server's sibling-flip pass acts on
    // every covered room in the same transaction.
    expect(bookingsPageSrc).toMatch(/const selectedVerifyScopeRooms = useMemo\(/);
    expect(bookingsPageSrc).toMatch(/selectedFolioBookingIds\.length > 0 \? selectedFolioBookingIds : \[selectedBooking\.id\]/);
  });

  it("the drawer's Verify & Record Payment button is disabled + aria-disabled while the gate is active", () => {
    const button = bookingsPageSrc.match(
      /onClick=\{openVerifyPaymentModal\}[\s\S]*?Verify & Record Payment/
    );
    expect(button, "the drawer verify button must exist").toBeTruthy();
    expect(button![0]).toMatch(/disabled=\{selectedVerifyScopeIdgBlocked\}/);
    expect(button![0]).toMatch(/aria-disabled=\{selectedVerifyScopeIdgBlocked\}/);
  });

  it("the drawer names the affected room in an amber banner while the gate is active", () => {
    expect(bookingsPageSrc).toMatch(/Senior\/PWD ID pending verification/);
    expect(bookingsPageSrc).toMatch(/verify the discount ID in the check-in section below before recording/);
  });

  it("the gate's room-level primitives are exported for both surfaces", () => {
    expect(discountGateSrc).toMatch(/export function hasUnverifiedDiscountInRooms\(/);
    expect(discountGateSrc).toMatch(/export function getDueAmountPreDiscountInRooms\(/);
    // The item-level helpers stay as thin wrappers (the dashboard
    // keeps using them).
    expect(discountGateSrc).toMatch(
      /export function hasUnverifiedDiscount\(item: PendingPaymentItemLike\): boolean \{\s*return hasUnverifiedDiscountInRooms\(item\.rooms\);/
    );
  });
});

describe("VPM-01 §2 — the verify modals source their method options from the hotel config", () => {
  it("BookingsPage's verify modal maps the configured onsite methods", () => {
    const verifyModal = bookingsPageSrc.match(
      /Verify payment — \$\{selectedBooking\.bookingRef\}[\s\S]*?<\/Modal>/
    );
    expect(verifyModal, "the drawer verify modal must exist").toBeTruthy();
    expect(verifyModal![0]).toMatch(
      /onsitePaymentMethodOptions\.map\(\(m\) => \(<option key=\{m\.method\} value=\{m\.method\}>\{m\.label \|\| m\.method\}<\/option>\)\)/
    );
  });

  it("DashboardPage's verify modal maps the configured onsite methods", () => {
    const verifyModal = dashboardPageSrc.match(
      /Review the uploaded proof and confirm the collection[\s\S]*?<\/Modal>/
    );
    expect(verifyModal, "the dashboard verify modal must exist").toBeTruthy();
    expect(verifyModal![0]).toMatch(/onsitePaymentMethodOptions\.map\(\(m\) => \(/);
  });

  it("neither admin surface hardcodes a payment-method option list any more", () => {
    // The regression the WPM-01 fix had already removed everywhere
    // else. A hardcoded list here records methods the hotel never
    // configured.
    for (const src of [bookingsPageSrc, dashboardPageSrc]) {
      expect(src).not.toMatch(/<option value="bank">/);
      expect(src).not.toMatch(/<option value="paypal">/);
      expect(src).not.toMatch(/<option value="maya">/);
    }
  });

  it("DashboardPage builds its own configured-methods memo and always keeps Cash selectable", () => {
    expect(dashboardPageSrc).toMatch(
      /const onsitePaymentMethodOptions = useMemo\(\(\) => \{/
    );
    expect(dashboardPageSrc).toMatch(
      /NON_TENDER_ONSITE_PAYMENT_METHODS\.has\(key\)/
    );
    expect(dashboardPageSrc).toMatch(/const hasCash = configured\.some\(/);
    expect(dashboardPageSrc).toMatch(/method: "cash", label: "Cash"/);
  });
});

describe("VPM-01 §3 — both surfaces resolve the money verdict through ONE shared function", () => {
  it("both pages import the shared resolver", () => {
    expect(bookingsPageSrc).toMatch(/resolveVerifyPaymentOutcome/);
    expect(dashboardPageSrc).toMatch(
      /import \{ resolveVerifyPaymentOutcome \} from "@spark-inn\/shared";/
    );
  });

  it("the drawer resolves the verdict from the scope's booking total + other add-ons", () => {
    expect(bookingsPageSrc).toMatch(
      /const outcome = resolveVerifyPaymentOutcome\(\{\s*collectedBefore: selectedVerifyScopeMoney\.collected,/
    );
    expect(bookingsPageSrc).toMatch(
      /bookingTotal: selectedVerifyScopeMoney\.bookingTotal,/
    );
    expect(bookingsPageSrc).toMatch(
      /otherAddOnTotal: selectedVerifyScopeMoney\.otherAddOnTotal,/
    );
  });

  it("the dashboard resolves the verdict from the scope's booking total + other add-ons", () => {
    expect(dashboardPageSrc).toMatch(
      /const outcome = resolveVerifyPaymentOutcome\(\{\s*collectedBefore: scopeExistingPaid,/
    );
    expect(dashboardPageSrc).toMatch(/bookingTotal: scopeTotal,/);
    expect(dashboardPageSrc).toMatch(/otherAddOnTotal: scopeOtherAddOnTotal,/);
  });

  it("the dashboard scope carries the other add-ons so the two surfaces see the same money", () => {
    expect(dashboardPageSrc).toMatch(/otherAddOnTotal: number;/);
    expect(dashboardPageSrc).toMatch(/const folioTotal = scopedTotal \+ otherAddOnTotal;/);
    expect(dashboardPageSrc).toMatch(/dueAmount: Math\.max\(0, folioTotal - paidAmount\),/);
  });

  it("neither surface keeps its own ad-hoc cumulative-vs-total comparison", () => {
    // The pre-VPM-01 expressions that produced the divergence.
    expect(bookingsPageSrc).not.toMatch(
      /const cumulativeAfter = existingPaid \+ amount;/
    );
    expect(dashboardPageSrc).not.toMatch(
      /const cumulativeAfter = scopeExistingPaid \+ amount;/
    );
  });
});

describe("VPM-01 §4 — the success modal's CTA follows the FOLIO balance, not the booking total", () => {
  it("the CTA is chosen by whether money is still outstanding", () => {
    expect(paymentSuccessModalSrc).toMatch(
      /const hasOutstandingBalance = Number\(remainingBalance \|\| 0\) > 0;/
    );
    expect(paymentSuccessModalSrc).toMatch(
      /const showConfirmWithBalance = hasOutstandingBalance;/
    );
  });

  it("'Confirm Booking' only renders when nothing is outstanding", () => {
    expect(paymentSuccessModalSrc).toMatch(
      /\{showConfirmWithBalance \? \([\s\S]*?Confirm with Balance[\s\S]*?\) : \([\s\S]*?Confirm Booking/
    );
  });

  it("the outstanding panel renders for ANY outstanding balance, not only a partial booking total", () => {
    expect(paymentSuccessModalSrc).toMatch(/\{hasOutstandingBalance && \(/);
    expect(paymentSuccessModalSrc).toMatch(/Still owing on the folio/);
    expect(paymentSuccessModalSrc).toMatch(/Balance remaining/);
  });

  it("a failed confirmation keeps the modal open with the reason inline", () => {
    expect(paymentSuccessModalSrc).toMatch(/error\?: string \| null;/);
    expect(paymentSuccessModalSrc).toMatch(/\{error \? \(/);
    // The drawer + dashboard handlers must NOT clear the success
    // state in a `finally` block any more.
    expect(bookingsPageSrc).not.toMatch(
      /finally \{\s*setConfirmingBookingFromSuccess\(false\);\s*setVerifySuccess\(null\);/
    );
    expect(dashboardPageSrc).not.toMatch(
      /finally \{\s*setConfirmingBookingFromSuccess\(false\);\s*setVerifySuccess\(null\);/
    );
    expect(bookingsPageSrc).toMatch(/setVerifySuccessError\(err\?\.message/);
    expect(dashboardPageSrc).toMatch(/setVerifySuccessError\(err\?\.message/);
  });

  it("the confirm-with-balance form shows the caller's canonical collected figure", () => {
    expect(confirmWithBalanceSrc).toMatch(/collectedAmount\?: number;/);
    expect(confirmWithBalanceSrc).toMatch(/typeof collectedAmount === "number"/);
  });
});

describe("VPM-01 §5 — the confirm-booking modal is gated on an outstanding balance", () => {
  it("the CLS-01 confirm modal disables its confirm button while money is outstanding", () => {
    expect(bookingsPageSrc).toMatch(
      /confirmDisabled=\{\(selectedBookingFolio\?\.balance \?\? 0\) > 0\}/
    );
  });

  it("the modal shows the collected + outstanding money state", () => {
    const confirmModal = bookingsPageSrc.match(
      /title="Confirm this booking\?"[\s\S]*?<\/ConfirmStatusModal>/
    );
    expect(confirmModal, "the confirm-booking modal must exist").toBeTruthy();
    expect(confirmModal![0]).toMatch(/Collected/);
    expect(confirmModal![0]).toMatch(/Outstanding/);
    expect(confirmModal![0]).toMatch(/is still owing on this folio/);
    expect(confirmModal![0]).toMatch(/Confirm with balance instead/);
  });

  it("the confirm handler refuses a plain confirm while money is outstanding", () => {
    // The server's plain `handleConfirmBooking` has NO balance
    // check — the threshold + reason live only in the
    // confirm-with-balance path. This guard is the second line.
    expect(bookingsPageSrc).toMatch(
      /const outstanding = Math\.max\(0, selectedBookingFolio\?\.balance \?\? 0\);/
    );
    expect(bookingsPageSrc).toMatch(/if \(outstanding > 0\) \{/);
    expect(bookingsPageSrc).toMatch(/confirm with a balance so the reason is recorded/);
  });
});

describe("VPM-01 §6 — the FOL-05 sibling-flip count reaches the success modal", () => {
  it("the success modal renders the 'rooms cleared' breadcrumb", () => {
    expect(paymentSuccessModalSrc).toMatch(/siblingFlippedCount\?: number;/);
    expect(paymentSuccessModalSrc).toMatch(/more room\{siblingFlippedCount === 1 \? "" : "s"\} cleared/);
    expect(paymentSuccessModalSrc).toMatch(/reservationRef \? ` — \$\{reservationRef\}` : ""/);
  });

  it("both surfaces pass the server-computed count through", () => {
    expect(bookingsPageSrc).toMatch(/siblingFlippedCount: result\.siblingFlippedCount \?\? 0,/);
    expect(dashboardPageSrc).toMatch(/siblingFlippedCount: result\.siblingFlippedCount \?\? 0,/);
    expect(bookingsPageSrc).toMatch(/siblingFlippedCount=\{verifySuccess\?\.siblingFlippedCount\}/);
    expect(dashboardPageSrc).toMatch(/siblingFlippedCount=\{verifySuccess\?\.siblingFlippedCount\}/);
  });
});

describe("VPM-01 §7 — the verify modal identifies whose money is on screen", () => {
  it("the drawer's verify modal shows the guest, the room and the stay", () => {
    const verifyModal = bookingsPageSrc.match(
      /Verify payment — \$\{selectedBooking\.bookingRef\}[\s\S]*?<\/Modal>/
    );
    expect(verifyModal![0]).toMatch(/\{selectedBooking\.guestName\}/);
    expect(verifyModal![0]).toMatch(/\{selectedBooking\.roomNumber\} · \{String\(selectedBooking\.roomType/);
    expect(verifyModal![0]).toMatch(/\{selectedBooking\.checkIn\} → \{selectedBooking\.checkOut\}/);
  });

  it("the drawer's verify modal names each money component instead of one ambiguous 'Booking total'", () => {
    const verifyModal = bookingsPageSrc.match(
      /Verify payment — \$\{selectedBooking\.bookingRef\}[\s\S]*?<\/Modal>/
    );
    expect(verifyModal![0]).toMatch(/Other add-ons/);
    expect(verifyModal![0]).toMatch(/Collected so far/);
    // The pre-VPM-01 tile showed the folio grand total under the
    // label "Booking total" — the same words the dashboard used
    // for a DIFFERENT number.
    expect(verifyModal![0]).not.toMatch(
      /Booking total<\/p>\s*<p className="text-sm font-bold text-gray-900">\{formatPrice\(selectedBookingFolio\?\.grandTotal/
    );
  });

  it("the drawer's verify modal shows the per-room coverage preview for a multi-room scope", () => {
    const verifyModal = bookingsPageSrc.match(
      /Verify payment — \$\{selectedBooking\.bookingRef\}[\s\S]*?<\/Modal>/
    );
    expect(verifyModal![0]).toMatch(/Coverage preview/);
    expect(verifyModal![0]).toMatch(/still owed/);
    expect(verifyModal![0]).toMatch(/selectedVerifyScopeRooms\.length > 1/);
  });
});

describe("VPM-01 §8 — the verify entry points meet the 44px touch target", () => {
  it("the drawer's Verify & Record Payment button is 44px tall", () => {
    const button = bookingsPageSrc.match(
      /onClick=\{openVerifyPaymentModal\}[\s\S]*?Verify & Record Payment/
    );
    expect(button![0]).toMatch(/min-h-\[44px\]/);
    expect(button![0]).not.toMatch(/min-h-\[36px\]/);
  });

  it("the drawer's View proof button next to it is 44px tall", () => {
    // `FRONTEND.md §Spacing` + `ADMIN-MOBILE.md`: every
    // interactive element is minimum 44×44px. The verify flow's
    // entry buttons were 36px.
    const shortProofButtons = Array.from(
      bookingsPageSrc.matchAll(/<button[^>]*min-h-\[36px\][\s\S]{0,600}?View proof/g)
    );
    expect(
      shortProofButtons.map((m) => m[0]),
      "a \"View proof\" button is still 36px tall"
    ).toEqual([]);
  });
});
