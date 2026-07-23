// Per CWB-03 / decision #122 (2026-07-23): confirm-with-balance
// focused modal. Mirrors the unpaid-checkout confirmation flow's
// shape (Total/Paid/Balance preview + required reason) but lives
// in its own component so the threshold banner, role-based
// submit-disable, and shortcut chips are self-contained.
//
// Key UX:
// - Persistent **threshold info banner** at the top — the user
//   is guided/reminded by the configured approval limit *before*
//   they type the reason (not a hidden tooltip).
// - Submit button is disabled when the current balance exceeds
//   the threshold AND the operator is `front-desk`. Admins see
//   the same banner but the button stays enabled.
// - Reason is required, ≤500 chars, with live counter.
// - Shortcut chips for the common case copy (the same set the
//   unpaid-checkout form uses; keeps the audit-log language
//   consistent across the two flows).

import { useMemo, useState } from "react";
import { AlertCircle, Info, ShieldCheck } from "lucide-react";
import { Modal } from "./Modal";
import { useAdmin } from "../context/AdminContext";
import { useToast } from "./Toast";
import { formatPrice } from "../utils/format";
import { cn } from "../utils/cn";

const REASON_MAX_LENGTH = 500;
// Same shortcut language as the unpaid-checkout form so the
// audit log reads uniformly across the two flows.
const REASON_SHORTCUTS: { label: string; value: string }[] = [
  { label: "Company billing", value: "Company billing — to be invoiced." },
  { label: "Bank transfer pending", value: "Bank transfer pending; balance to be collected at check-in." },
  { label: "Payment failure", value: "Payment failure — to be retried at check-in." },
  { label: "Disputed charge", value: "Disputed charge — balance to be settled at check-in." },
  { label: "Other", value: "" }
];

interface ConfirmWithBalanceFormProps {
  open: boolean;
  onClose: () => void;
  booking: {
    id: string;
    bookingRef: string;
    guestName: string;
    totalPrice: number;
    onsitePayments?: Array<{ amount: number }>;
  };
  // Current charge-inclusive balance (post-verify state). The
  // caller is the only one with the live payments + charges
  // + add-to-bill totals, so we accept the value rather than
  // recomputing it here.
  currentBalance: number;
  onConfirmed?: () => void;
}

export function ConfirmWithBalanceForm({
  open,
  onClose,
  booking,
  currentBalance,
  onConfirmed
}: ConfirmWithBalanceFormProps) {
  const { currentUser, hotelConfig, confirmBookingWithBalance } = useAdmin();
  const toast = useToast();

  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const role = currentUser?.role || "front-desk";
  const isAdmin = role === "admin";
  const threshold = Number(
    (hotelConfig as Record<string, unknown> | null | undefined)?.unpaidCheckoutApprovalThreshold
  ) || 5000;

  const overThreshold = currentBalance > threshold;
  const canSubmit = useMemo(() => {
    if (submitting) return false;
    if (!reason.trim()) return false;
    if (overThreshold && !isAdmin) return false;
    return true;
  }, [submitting, reason, overThreshold, isAdmin]);

  const close = () => {
    if (submitting) return;
    setReason("");
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError("A reason is required when confirming a booking with a balance owed.");
      return;
    }
    if (overThreshold && !isAdmin) {
      setError(
        `This balance (${formatPrice(currentBalance)}) exceeds your ${formatPrice(threshold)} approval limit. An admin must approve.`
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await confirmBookingWithBalance(booking.id, trimmed);
    setSubmitting(false);
    if (!result.success) {
      if (result.thresholdExceeded) {
        // Server is authoritative. If the threshold changed
        // between snapshot and submit, surface the server's
        // current values so the staff can re-open with the
        // right admin.
        setError(
          result.error ||
            `The outstanding balance (${formatPrice(result.balance ?? currentBalance)}) exceeds the Front Desk approval limit (${formatPrice(result.threshold ?? threshold)}).`
        );
      } else {
        setError(result.error || "Failed to confirm with balance.");
      }
      return;
    }
    toast.success("Booking confirmed with balance", `${booking.bookingRef} is confirmed. The guest will be notified by email.`);
    setReason("");
    setError(null);
    onConfirmed?.();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={booking.bookingRef ? `Confirm with balance — ${booking.bookingRef}` : "Confirm with balance"}
      className="max-w-lg"
    >
      <div className="space-y-4">
        {/* Persistent threshold info banner — the staff are
            guided/reminded by the configured approval limit
            before they type the reason. Always visible, not
            a hidden tooltip. Color is role-conditional:
            blue/info when the operator is allowed, amber when
            they are not. */}
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs",
            overThreshold && !isAdmin
              ? "border-amber-300 bg-amber-50 text-amber-900"
              : "border-blue-200 bg-blue-50 text-blue-900"
          )}
          role="status"
        >
          {overThreshold && !isAdmin ? (
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <div className="space-y-1">
            <p className="font-semibold">
              Approval limit: {formatPrice(threshold)}
            </p>
            <p className="leading-relaxed">
              {isAdmin
                ? "Admins may confirm balances up to any amount. The limit above is what Front Desk can approve without escalation."
                : overThreshold
                  ? `This balance (${formatPrice(currentBalance)}) is over the Front Desk limit. Ask an admin to confirm, or collect the balance first.`
                  : "Front Desk may confirm balances up to this amount without escalation."}
            </p>
          </div>
        </div>

        {/* Total / Paid / Balance preview. Mirrors the
            unpaid-checkout form for consistency. */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Total</p>
            <p className="text-sm font-bold text-gray-900">{formatPrice(booking.totalPrice)}</p>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Collected</p>
            <p className="text-sm font-bold text-gray-900">
              {formatPrice(
                (booking.onsitePayments || []).reduce((sum, p) => sum + (p.amount || 0), 0)
              )}
            </p>
          </div>
          <div className="rounded-lg bg-amber-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Balance</p>
            <p className="text-sm font-bold text-amber-900">{formatPrice(currentBalance)}</p>
          </div>
        </div>

        {/* Contextual warning under the balance preview when
            the current balance exceeds the threshold and the
            operator is front-desk. Mirrors the banner above
            so the staff cannot miss it before typing. */}
        {overThreshold && !isAdmin && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              Submit is disabled because this balance is over the Front Desk limit. An admin must confirm, or the
              remaining {formatPrice(currentBalance)} can be collected first.
            </p>
          </div>
        )}

        <p className="text-xs text-gray-600">
          Confirming with a balance will email the guest a confirmation that includes the balance and the reason you
          enter below. The remaining amount will be collected at check-in.
        </p>

        <div>
          <label htmlFor="confirm-with-balance-reason" className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            Reason <span className="text-red-500">*</span>
          </label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {REASON_SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut.label}
                type="button"
                onClick={() => setReason(shortcut.value)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
                  reason === shortcut.value
                    ? "bg-primary/10 text-primary ring-1 ring-primary/30"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                )}
              >
                {shortcut.label}
              </button>
            ))}
          </div>
          <textarea
            id="confirm-with-balance-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Describe why the balance will be settled at check-in..."
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            disabled={submitting}
            className="w-full resize-none rounded-lg border border-gray-250 px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
          />
          <p className="mt-1 text-right text-[10px] text-gray-400">{reason.length}/{REASON_MAX_LENGTH}</p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{error}</p>
        )}

        <div className="flex items-center justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Confirming…
              </>
            ) : (
              "Confirm with Balance"
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
