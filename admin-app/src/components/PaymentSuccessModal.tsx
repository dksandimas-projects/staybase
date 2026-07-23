import { AlertTriangle, CheckCircle2, Mail } from "lucide-react";
import { Modal } from "./Modal";
import { formatPrice } from "../utils/format";

interface PaymentSuccessModalProps {
  open: boolean;
  onClose: () => void;
  // Booking context (for the success summary)
  bookingRef: string;
  guestName: string;
  guestEmail: string;
  roomType: string;
  // Payment summary
  amount: number;
  method: string;
  // Per the surface where the modal is rendered:
  // - "drawer": the BookingsPage booking drawer. The staff
  //   is already viewing the booking, so the secondary CTA
  //   is "Later" (just dismiss).
  // - "dashboard": the dashboard's pending-payments list. The
  //   staff is acting from a list, so the secondary CTA is
  //   "View booking" (navigate to the bookings page) so they
  //   can do further work if needed.
  surface: "drawer" | "dashboard";
  // "Confirm Booking" CTA — only enabled for a full payment,
  // because a partial payment keeps the booking in
  // `payment-uploaded` and the front desk can't advance it
  // until the rest is collected.
  isFullPayment: boolean;
  remainingBalance?: number;
  onConfirmBooking?: () => void;
  confirmingBooking?: boolean;
  // Optional secondary CTA on the dashboard surface.
  onViewBooking?: () => void;
  // Optional human-readable method label, e.g. "GCash" or
  // "Bank Transfer". Falls back to the raw method key.
  methodLabel?: string;
}

// Per feat/payment-success-modal: closes the loop after
// "Verify & Record Payment" succeeds. Three jobs in one
// modal:
//   1. Confirm what just happened (amount + method + guest)
//   2. Tell the staff what the system did automatically
//      (the payment-confirmed email was sent)
//   3. Nudge the front desk to the natural next step —
//      confirming the booking. The "Confirm Booking" CTA
//      is only available for a full payment, because a
//      partial payment leaves the booking in
//      `payment-uploaded` and confirming it would skip
//      the balance check entirely. A future "confirm
//      with balance owed" feature would add a second CTA
//      here for the partial case.
export function PaymentSuccessModal({
  open,
  onClose,
  bookingRef,
  guestName,
  guestEmail,
  roomType,
  amount,
  method,
  methodLabel,
  surface,
  isFullPayment,
  remainingBalance,
  onConfirmBooking,
  confirmingBooking,
  onViewBooking,
}: PaymentSuccessModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isFullPayment ? "Payment confirmed" : "Payment recorded"}
      className="max-w-md"
    >
      <div className="space-y-4">
        {/* Hero — celebratory on full, neutral on partial */}
        <div className="flex flex-col items-center text-center pt-2">
          <div
            className={
              isFullPayment
                ? "rounded-full bg-emerald-100 p-3"
                : "rounded-full bg-amber-100 p-3"
            }
          >
            {isFullPayment ? (
              <CheckCircle2 className="h-8 w-8 text-emerald-600" />
            ) : (
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            )}
          </div>
          <h3 className="mt-3 font-heading text-xl text-gray-950">
            {isFullPayment ? "Payment confirmed" : "Partial payment recorded"}
          </h3>
        </div>

        {/* Payment summary card — the staff's receipt */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm space-y-1.5">
          <div className="flex justify-between">
            <span className="text-gray-600">Amount</span>
            <span className="font-bold text-gray-900">{formatPrice(amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Method</span>
            <span className="font-semibold text-gray-900">
              {methodLabel || method}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Booking</span>
            <span className="font-mono font-semibold text-gray-900">
              {bookingRef}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Guest</span>
            <span className="font-semibold text-gray-900">{guestName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600">Room</span>
            <span className="font-semibold text-gray-900">{roomType}</span>
          </div>
        </div>

        {/* Email-sent confirmation — closes the "did the system
            actually notify the guest?" loop that used to be silent. */}
        <div className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          <Mail className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            A payment-confirmed email has been sent to{" "}
            <span className="font-semibold">{guestEmail}</span>.
          </span>
        </div>

        {/* Partial-payment balance warning — the staff needs to
            know the booking isn't ready to confirm yet. */}
        {!isFullPayment && remainingBalance !== undefined && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">Balance remaining</span>
              <span className="font-bold text-amber-900">
                {formatPrice(remainingBalance)}
              </span>
            </div>
            <p className="mt-1 text-amber-800">
              Collect the remaining balance before the booking can be
              confirmed.
            </p>
          </div>
        )}

        {/* CTAs */}
        <div className="flex items-center justify-end gap-2 pt-2">
          {/* Surface-specific secondary: "View booking" on the
              dashboard (jump to the bookings page), nothing on
              the drawer (the booking is already visible). */}
          {surface === "dashboard" && onViewBooking && (
            <button
              type="button"
              onClick={onViewBooking}
              className="min-h-11 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
            >
              View booking
            </button>
          )}

          {/* Full payment: "Later" + "Confirm Booking" (the natural
              next status transition). Partial payment: just
              "Got it" — no confirm CTA because the booking
              isn't ready. */}
          {isFullPayment ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={confirmingBooking}
                className="min-h-11 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                Later
              </button>
              <button
                type="button"
                onClick={onConfirmBooking}
                disabled={confirmingBooking || !onConfirmBooking}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
              >
                {confirmingBooking ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Confirming…
                  </>
                ) : (
                  "Confirm Booking"
                )}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="min-h-11 rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark"
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
