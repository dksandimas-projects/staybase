import { Booking } from "../context/AdminContext";
import { Mail, Loader2, ChevronRight } from "lucide-react";

interface BookingEmailActionsProps {
  booking: Booking;
  resendingAction: string | null;
  onResend: (action: string) => void;
}

export function BookingEmailActions({ booking, resendingAction, onResend }: BookingEmailActionsProps) {
  const getRecommendedEmailAction = (status: Booking["status"]) => {
    if (status === "pending" || status === "payment-uploaded") return "booking-submitted";
    if (status === "payment-confirmed") return "payment-confirmed";
    if (status === "confirmed") return "booking-confirmed";
    if (status === "checked-in") return "checkin-reminder";
    if (status === "checked-out") return "payment-confirmed";
    if (status === "cancelled") return "booking-cancelled";
    return null;
  };

  const recommendedAction = getRecommendedEmailAction(booking.status);

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
        <Mail size={14} className="text-primary" />
        Resend Transactional Email
      </h3>
      <details className="group rounded-lg border border-gray-200 bg-white open:shadow-sm">
        <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-xs font-semibold text-gray-600 hover:text-gray-800 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
            Resend email to {booking.guestEmail}
          </span>
        </summary>
        <div className="border-t border-gray-200 p-5 space-y-4">
          <p className="text-[10px] leading-relaxed text-gray-500">
            Select an email template below to resend to the guest (<strong>{booking.guestEmail}</strong>).
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { action: "booking-submitted", label: "Booking Submitted" },
              { action: "booking-confirmed", label: "Booking Confirmed" },
              { action: "payment-confirmed", label: "Payment Confirmed" },
              { action: "checkin-reminder", label: "Check-in Reminder" },
              { action: "booking-cancelled", label: "Booking Cancelled" },
              { action: "discount-rejected", label: "Discount Rejected" },
            ].map(({ action, label }) => {
              const isRecommended =
                recommendedAction === action ||
                (action === "discount-rejected" && booking.discountRejected);
              const isPending = resendingAction === action;

              return (
                <button
                  key={action}
                  type="button"
                  disabled={resendingAction !== null}
                  onClick={() => onResend(action)}
                  className={`min-h-[40px] px-3 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1.5 active:scale-95 ${
                    isRecommended
                      ? "bg-primary hover:bg-primary-dark text-white border-transparent shadow-sm"
                      : "bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 disabled:opacity-50"
                  }`}
                >
                  {isPending ? <Loader2 size={12} className="animate-spin" /> : null}
                  {label}
                  {isRecommended && !isPending && (
                    <span className="ml-1 rounded bg-white/20 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white">
                      Rec
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </details>
    </div>
  );
}
