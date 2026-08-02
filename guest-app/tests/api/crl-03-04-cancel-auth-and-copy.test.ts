import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const shared = readFileSync(resolve(__dirname, "../../../shared/utils/bookingOccupancy.ts"), "utf8");
const handler = readFileSync(resolve(__dirname, "../../server/handlers/bookings.ts"), "utf8");
const email = readFileSync(resolve(__dirname, "../../server/handlers/email.ts"), "utf8");
const store = readFileSync(resolve(__dirname, "../../server/handlers/store.ts"), "utf8");
const guestLookup = readFileSync(resolve(__dirname, "../../src/pages/BookingLookupPage.tsx"), "utf8");
const adminBookings = readFileSync(resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"), "utf8");

function isolateHandleCancelBooking() {
  const start = handler.indexOf("export async function handleCancelBooking");
  expect(start).toBeGreaterThanOrEqual(0);
  const next = handler.indexOf("export async function handleAddPayment", start);
  expect(next).toBeGreaterThan(start);
  return handler.slice(start, next);
}

function isolateHandleCancelStoreOrder() {
  const start = store.indexOf("export async function handleCancelStoreOrder");
  expect(start).toBeGreaterThanOrEqual(0);
  const next = store.indexOf("export async function handleGetStoreOrderStatus", start);
  expect(next).toBeGreaterThan(start);
  return store.slice(start, next);
}

describe("CRL-03 server-side cancellation status matrix", () => {
  describe("shared status constants (pinned by CRL-03)", () => {
    it("GUEST_CANCELLABLE_STATUSES is the 2-value guest self-service list", () => {
      expect(shared).toMatch(/GUEST_CANCELLABLE_STATUSES = \["pending", "payment-uploaded"\] as const/);
    });

    it("STAFF_CANCELLABLE_STATUSES covers every pre-arrival status (4 values)", () => {
      expect(shared).toMatch(/STAFF_CANCELLABLE_STATUSES = \[\s*"pending",\s*"payment-uploaded",\s*"payment-confirmed",\s*"confirmed"\s*\] as const/);
    });

    it("TERMINAL_CANCELLATION_STATUSES is the universal reject list (3 values)", () => {
      expect(shared).toMatch(/TERMINAL_CANCELLATION_STATUSES = \[\s*"checked-in",\s*"checked-out",\s*"cancelled"\s*\] as const/);
    });
  });

  describe("handleCancelBooking — the new dual-gate check", () => {
    it("rejects every terminal status with the existing universal 400", () => {
      const body = isolateHandleCancelBooking();
      expect(body).toMatch(/bookingData\.status === "checked-in"/);
      expect(body).toMatch(/bookingData\.status === "checked-out"/);
      expect(body).toMatch(/bookingData\.status === "cancelled"/);
    });

    it("adds a guest-specific 400 keyed off GUEST_CANCELLABLE_STATUSES (not the staff set)", () => {
      const body = isolateHandleCancelBooking();
      // The guest-path check uses the guest set, not the staff set.
      expect(body).toMatch(/!isStaffCancellation\s*\n\s*&& !\(GUEST_CANCELLABLE_STATUSES as readonly string\[\]\)\.includes/);
    });

    it("the staff path does NOT consult GUEST_CANCELLABLE_STATUSES (a pre-arrival booking is always cancellable)", () => {
      // The dual-gate is the universal terminal check + a guest-only
      // extension. A staff cancel of a `confirmed` booking is valid.
      const body = isolateHandleCancelBooking();
      // The boolean negation only gates the guest extension; the
      // universal terminal check runs for both.
      const guestOnlyExtension = body.match(/!\s*isStaffCancellation\s*\n\s*&&\s*!\(GUEST_CANCELLABLE_STATUSES as readonly string\[\]\)\.includes/);
      expect(guestOnlyExtension).toBeTruthy();
    });

    it("in-transaction check mirrors the pre-transaction dual-gate", () => {
      // The transaction re-reads the booking to catch concurrent
      // status flips; the same source-specific check must run
      // against `freshBooking.status` to keep the contract honest.
      const body = isolateHandleCancelBooking();
      expect(body).toMatch(/GUEST_PAST_SELF_SERVICE_WINDOW/);
      expect(body).toMatch(/!\(GUEST_CANCELLABLE_STATUSES as readonly string\[\]\)\.includes\(String\(freshBooking\.status \|\| ""\)\)/);
    });

    it("GUEST_PAST_SELF_SERVICE_WINDOW is mapped to a 400 in the catch block", () => {
      const body = isolateHandleCancelBooking();
      expect(body).toMatch(/error\?\.message === "GUEST_PAST_SELF_SERVICE_WINDOW"/);
      expect(body).toMatch(/return res\.status\(400\)\.json\(\{\s*success: false,\s*error: "Your booking is past the self-service cancellation window/);
    });
  });
});

describe("CRL-04 truthful cancellation copy + paid store-cancel staff notification", () => {
  describe("bookingCancelledEmail — the new explicit 'no refund is automatic' callout", () => {
    it("renders the 'What happens next' warm callout with the no-refund rule", () => {
      // The CRL-04 copy is the explicit `No refund is issued
      // automatically` sentence inside a warm callout, distinct
      // from the existing red `Cancellation recorded` callout.
      expect(email).toMatch(/callout\("warm", "What happens next"/);
      expect(email).toMatch(/No refund is issued automatically/);
    });

    it("the intro line switches on cancellationSource (guest / staff / system)", () => {
      // The email is source-aware so it reads naturally regardless
      // of who initiated the cancellation. The `system` branch is
      // the PEX auto-expiry (payment-hold-expired); `guest` and
      // `staff` cover the other two CRL-02 sources.
      expect(email).toMatch(/cancellationSource \|\| "staff"/);
      expect(email).toMatch(/source === "guest"/);
      expect(email).toMatch(/source === "system"/);
      expect(email).toMatch(/at your request/);
      expect(email).toMatch(/cancelled by our team/);
      expect(email).toMatch(/the payment hold expired/);
    });
  });

  describe("admin confirm modal — the new explicit 'no refund' line", () => {
    it("the message tells the operator that no refund is automatic and points to the Folio action", () => {
      expect(adminBookings).toMatch(/Cancellation is permanent and the guest will be notified by email[\s\S]+?record a refund separately through the Folio → Refund action/);
    });
  });

  describe("guest confirm modal — the new explicit 'no refund' line", () => {
    it("the message tells the guest that no refund is automatic and the team will reach out", () => {
      expect(guestLookup).toMatch(/No refund is issued automatically[\s\S]+?our team will review your booking and reach out/);
    });
  });

  describe("paid GCash store order cancellation — the new staff refund-review alert", () => {
    it("sendStaffRefundReviewTrigger is exported from email.ts", () => {
      expect(email).toMatch(/export async function sendStaffRefundReviewTrigger/);
    });

    it("staffRefundReviewEmail renders the 'Action required' warm callout + the order details card", () => {
      // The alert mirrors the shape of staffNewPaymentEmail: a
      // warm callout describing the action + a card with the
      // order's identifying fields + a CTA to the linked booking.
      expect(email).toMatch(/function staffRefundReviewEmail/);
      expect(email).toMatch(/callout\("warm", "Action required"/);
      expect(email).toMatch(/No refund is issued automatically by the cancellation/);
      expect(email).toMatch(/row\("Order ref"/);
      expect(email).toMatch(/row\("Amount"/);
      expect(email).toMatch(/row\("Method"/);
      expect(email).toMatch(/row\("Payment proof"/);
    });

    it("handleCancelStoreOrder imports the new trigger", () => {
      expect(store).toMatch(/import \{[\s\S]+?sendStaffRefundReviewTrigger[\s\S]+?\} from "\.\/email"/);
    });

    it("the staff alert fires only when the cancelled order was paid via GCash with a payment proof", () => {
      // The if-guard is the precise CRL-04 contract: paymentMethod
      // === "gcash" AND paymentProofUrl truthy. COD and Add-to-Bill
      // orders do not need a refund review (the money has either
      // not been collected yet, or rolls into the booking folio).
      const body = isolateHandleCancelStoreOrder();
      expect(body).toMatch(/fresh\.paymentMethod === "gcash" && fresh\.paymentProofUrl/);
    });

    it("the staff alert is best-effort: a failure is logged but does not block the cancellation", () => {
      const body = isolateHandleCancelStoreOrder();
      expect(body).toMatch(/Failed to send staff refund-review alert/);
    });
  });
});
