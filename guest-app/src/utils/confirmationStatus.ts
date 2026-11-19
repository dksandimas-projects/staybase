import type { BookingStatus } from "@spark-inn/shared";
import { isOnlinePaymentMethod } from "@spark-inn/shared";

// Which methods require the guest to send proof before the hotel can
// verify anything.
//
// Per 2026-11-19 (decision #318) this is NO LONGER a hardcoded
// allowlist of method keys (`["gcash", "bank"]`). The allowlist could
// not survive admin-configured methods: the live deployment stores its
// bank transfer under the key `bpi` (label "Bank Transfer"), so the
// allowlist classified a receipt-required method as "not online" and
// this page told a guest who had ALREADY uploaded a bank-transfer
// receipt that "nothing is due now — pay at the property".
//
// The rule now lives in `shared/utils/paymentMethodSemantics.ts` and
// matches the rest of the platform (booking Step 4's proof gate, the
// create endpoint's status derivation, the booking-submitted email):
// only the settle-at-the-property methods defer the money; EVERY
// other method — including custom admin keys — is paid online with
// proof.
//
// Re-exported so the guest app's existing import sites (and the
// MBUX-08 suite) keep one entry point for "is this method paid
// online?".
export { isOnlinePaymentMethod };

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

/**
 * The icon in the header medallion.
 *
 * - `check` — the guest's request was RECEIVED and the page is a
 *   success screen for the booking request.
 * - `clock` — the page is waiting on something the GUEST still owes.
 *
 * Per 2026-11-19 (decision #319): the medallion used to follow the
 * tone alone, so a pending state always drew a clock. A guest whose
 * receipt was already on file read "we are waiting on you" at the top
 * of the page. The icon is now part of the STATUS, decided per state
 * alongside the copy.
 */
export type ConfirmationHeaderIcon = "check" | "clock";

export interface ConfirmationStatusInput {
  /**
   * Raw payment-method KEY carried through the create redirect, e.g.
   * `gcash`. This is the admin-configured key (`bpi` on the live
   * deployment), never the display label — the key is what decides
   * whether the money is settled at the property or owed now.
   */
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
  /** Icon for the header medallion — see `ConfirmationHeaderIcon`. */
  headerIcon: ConfirmationHeaderIcon;
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
        headerIcon: "clock",
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
        headerIcon: "check",
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
        // Per 2026-11-19 (decision #319): the header medallion carries a
        // CHECK, not a clock. The guest's REQUEST was received
        // successfully — that is the headline fact — while the payment
        // status box below carries the "still being verified" part. A
        // clock in the hero said "we are waiting on you" and made a
        // received request look like a queue.
        headerIcon: "check",
        headline: "Booking request received!",
        summary:
          "Thanks! Your room is on hold while we verify your payment. This usually takes a few hours and no more than 24 hours.",
        paymentStatusLabel: "Payment proof received — verification in progress",
        paymentStatusDetail: `We've received your ${methodLabel} receipt and our team is reviewing it. Your booking is confirmed once it's verified, usually within 24 hours.`,
        nextStep:
          "You're all set for now. Once your payment is verified, we'll email your booking confirmation. You can also check your status anytime on this page or under Manage.",
        emailStatus:
          "We've emailed you a copy of this request. Your confirmation will follow as soon as your payment is verified."
      };

    case "awaiting-proof":
      return {
        paymentState,
        tone: "pending",
        headerIcon: "clock",
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
        headerIcon: "check",
        headline: "Your booking is confirmed.",
        summary: `We look forward to hosting you at ${brand}.`,
        paymentStatusLabel: "Pay at the property",
        paymentStatusDetail: `Nothing to pay now — settle with ${methodLabel} when you check in.`,
        nextStep: "Just arrive at check-in time. Your reference is all you need.",
        emailStatus: "A confirmation email has been sent to your booking contact."
      };
  }
}