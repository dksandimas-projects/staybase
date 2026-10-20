import type { BookingStatus } from "@spark-inn/shared";

// Per MBUX-08 (decision #260, 2026-10-15): Step 5 truth table.
//
// WHY THIS IS A PURE HELPER
// -------------------------
// The confirmation page used ONE boolean — `isOnlinePayment` — to
// decide everything the guest reads: the headline, the sub-line and
// the email note. That boolean cannot tell "you uploaded a receipt
// and we're checking it" apart from "staff already verified your
// payment", so a guest whose payment was verified still read
// "Booking submitted for review".
//
// The fix is not more copy — it is reading the status the create
// endpoint ALREADY returns. It was on the page the whole time (it
// gates the early-check-in widget) but nothing read it for copy.
//
// The rules are a truth table over two inputs, so they are asserted
// BEHAVIOURALLY, not by regex: a regex cannot express "verified wins
// over awaiting proof", and this file exists precisely because that
// precedence is the bug.

/**
 * Payment standing of a just-created booking, as the guest may
 * honestly describe it.
 *
 * - `pay-at-hotel`   — nothing to pay now; settled at the property.
 * - `awaiting-proof` — online method chosen, no receipt received yet.
 * - `proof-received` — the guest sent a receipt; nobody has checked it.
 * - `verified`       — staff confirmed the money arrived.
 * - `cancelled`      — the booking is no longer live.
 */
export type ConfirmationPaymentState =
  | "pay-at-hotel"
  | "awaiting-proof"
  | "proof-received"
  | "verified"
  | "cancelled";

export interface ConfirmationStatusInput {
  /** Raw payment-method key carried through the create redirect, e.g. `gcash`. */
  paymentMethod: string;
  /** Server-authoritative booking status carried in the URL (`status` param). */
  bookingStatus: string;
  /** Admin-editable payment-method label, already resolved for display. */
  paymentMethodLabel: string;
  /** Deploy-time brand name. Never hardcode it (white-label rule). */
  brandName: string;
}

export interface ConfirmationStatusView {
  paymentState: ConfirmationPaymentState;
  /**
   * Visual intent for the header block, so the page never renders a
   * green tick beside a cancellation notice.
   */
  tone: "success" | "pending" | "neutral";
  headline: string;
  summary: string;
  /** Short label for the payment row in the results card. */
  paymentStatusLabel: string;
  /** One sentence saying what the state means. */
  paymentStatusDetail: string;
  nextStep: string;
  emailStatus: string;
}

// Typed as `BookingStatus[]` so renaming a status in
// `shared/constants` breaks the build here instead of silently
// downgrading a guest to "awaiting proof" forever.
const VERIFIED_BOOKING_STATUSES: readonly BookingStatus[] = [
  "payment-confirmed",
  "confirmed",
  "checked-in",
  "checked-out"
];

const PROOF_RECEIVED_BOOKING_STATUSES: readonly BookingStatus[] = [
  "payment-uploaded"
];

const CANCELLED_BOOKING_STATUSES: readonly BookingStatus[] = ["cancelled"];

/**
 * Methods that require the guest to send proof before the hotel can
 * verify anything.
 *
 * Kept in sync with the pre-MBUX-08 `isOnlinePayment` pair so the
 * payment STATUS never disagrees with which methods were always
 * treated as online. Admin-configured extra methods are display-only
 * labels and do not change this answer.
 */
const ONLINE_PAYMENT_METHOD_KEYS = ["gcash", "bank"] as const;

export function isOnlinePaymentMethod(method: string): boolean {
  const key = (method ?? "").trim().toLowerCase();
  return (ONLINE_PAYMENT_METHOD_KEYS as readonly string[]).includes(key);
}

function asBookingStatus(value: string): BookingStatus {
  return (value ?? "").trim().toLowerCase() as BookingStatus;
}

export function resolveConfirmationStatus(
  input: ConfirmationStatusInput
): ConfirmationStatusView {
  const { paymentMethod, bookingStatus, paymentMethodLabel, brandName } = input;
  const brand = (brandName ?? "").trim() || "the hotel";
  const status = asBookingStatus(bookingStatus);
  const online = isOnlinePaymentMethod(paymentMethod);
  const methodLabel = (paymentMethodLabel ?? "").trim() || "your payment";

  // Precedence matters and is the whole point:
  //   1. A cancellation beats everything — a cancelled booking is
  //      never described as confirmed.
  //   2. A NON-online method outranks the status. This ordering looks
  //      backwards until you say it out loud: a pay-at-hotel booking
  //      that reaches `confirmed` has had its *stay* confirmed, but
  //      no money has moved and none could have been checked. Labelling
  //      it "Payment verified" (the bug this ordering prevents) tells
  //      a guest staff cleared a transfer that never happened.
  //   3. Only for online methods does the status separate a received
  //      receipt from a verified payment — which is exactly the
  //      distinction the old `isOnlinePayment` boolean could not make.
  let paymentState: ConfirmationPaymentState;
  if (CANCELLED_BOOKING_STATUSES.includes(status)) {
    paymentState = "cancelled";
  } else if (!online) {
    paymentState = "pay-at-hotel";
  } else if (VERIFIED_BOOKING_STATUSES.includes(status)) {
    paymentState = "verified";
  } else if (PROOF_RECEIVED_BOOKING_STATUSES.includes(status)) {
    paymentState = "proof-received";
  } else {
    paymentState = "awaiting-proof";
  }

  switch (paymentState) {
    case "cancelled":
      return {
        paymentState,
        tone: "neutral",
        headline: "This booking was cancelled.",
        summary: `It is no longer reserved at ${brand}. Nothing further is needed from you.`,
        paymentStatusLabel: "Cancelled",
        paymentStatusDetail: "No payment is being collected for this booking.",
        nextStep: "If you did not cancel, contact the front desk with your reference.",
        emailStatus: "A cancellation email has been sent to your booking contact."
      };

    case "verified":
      return {
        paymentState,
        tone: "success",
        headline: "Your booking is confirmed.",
        summary: `You're all set — we're looking forward to hosting you at ${brand}.`,
        paymentStatusLabel: "Payment verified",
        paymentStatusDetail: "Our team has confirmed your payment arrived. Nothing further to send.",
        nextStep: "Keep your reference handy — you'll need it at check-in.",
        emailStatus: "A confirmation email has been sent to your booking contact."
      };

    case "proof-received":
      return {
        paymentState,
        tone: "pending",
        headline: "We have your payment proof.",
        summary: `Your booking is reserved. Our team is verifying the payment now — that check is ours to finish, not yours.`,
        paymentStatusLabel: "Proof received — not yet verified",
        paymentStatusDetail: `Your ${methodLabel} receipt reached us. It has not been checked by our team yet, so the booking is not confirmed until they do.`,
        nextStep: "Nothing to send. We'll email you as soon as the payment is verified.",
        emailStatus: "An acknowledgment email has been sent. A confirmation follows once your payment is verified."
      };

    case "awaiting-proof":
      return {
        paymentState,
        tone: "pending",
        headline: "Booking submitted for review.",
        summary: `We have received your details at ${brand}. Your booking is held while the payment is checked.`,
        paymentStatusLabel: "Awaiting payment proof",
        paymentStatusDetail: `We have not received a ${methodLabel} receipt yet, so there is nothing to verify.`,
        nextStep: `Reply to your acknowledgment email with your ${methodLabel} receipt.`,
        emailStatus: "An acknowledgment email has been sent with instructions for sending your receipt."
      };

    case "pay-at-hotel":
    default:
      return {
        paymentState,
        tone: "success",
        headline: "Your booking is confirmed.",
        summary: `You're looking forward to hosting you at ${brand}.`,
        paymentStatusLabel: "Pay at the property",
        paymentStatusDetail: `Nothing to pay now — settle with ${methodLabel} when you check in.`,
        nextStep: "Just arrive at check-in time. Your reference is all you need.",
        emailStatus: "A confirmation email has been sent to your booking contact."
      };
  }
}