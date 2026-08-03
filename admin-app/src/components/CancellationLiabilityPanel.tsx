// Per CRL-07 (2026-08-03, per decision #173): the
// post-cancellation liability panel. Renders the live
// state of a cancelled booking's (or reservation's)
// refund liability — the `policyResult` snapshot
// (immutable, stamped at cancel time), the
// admin-controlled `approvedAmount`, the live
// `processedAmount` (cumulative from the refunds
// subcollection), the derived `outstandingAmount`
// + `retentionAmount`, and the state badge (one of
// the five states `computeCancellationLiabilityState`
// returns). Mounted inside the booking drawer's
// Folio section when the selected booking (or its
// reservation header, for reservation-scope cancels)
// has a `cancellationLiability` field.
//
// The two action buttons — "Record processed refund"
// and "Apply exception" — are gated on
// `currentUser?.role === "admin"`. Front-desk staff
// can see the panel but the buttons are hidden (the
// spec body: "only Admin may approve an exception or
// record a processed refund"). The "Record processed
// refund" button opens the existing refund modal
// (delegated to the parent); the "Apply exception"
// button opens a small inline form.

import { useEffect, useState } from "react";
import type {
  CancellationLiability,
  CancellationLiabilityState
} from "@spark-inn/shared";
import { computeCancellationLiabilityState } from "@spark-inn/shared";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Clock, ShieldAlert, Wallet } from "lucide-react";
import { formatPrice } from "../utils/format";
import { cn } from "../utils/cn";
import { getApiBaseUrl } from "../utils/apiBaseUrl";
import { auth } from "../firebase/auth";

interface CancellationLiabilityPanelProps {
  /** The booking's `cancellationLiability` field. Null/undefined → render the pre-CRL-07 "no liability recorded" view. */
  liability: CancellationLiability | null | undefined;
  /** The booking id (for per-child + legacy cancels). */
  bookingId: string;
  /** The reservation id when applicable (for reservation-scope cancels). The reservation header carries the liability, not the booking doc. */
  reservationId?: string | null;
  /** Whether the current user is an admin. Gates the action buttons. */
  isAdmin: boolean;
  /** Open the existing refund modal pre-filled with the outstanding amount. */
  onOpenRefundModal: (suggestedAmount: number) => void;
  /** Open the exception modal — the parent renders the form + the API call. */
  onOpenExceptionModal: () => void;
  /**
   * Optional parent-controlled refresh trigger. Bump
   * after a successful refund or exception submit so the
   * panel re-projects immediately (without waiting for
   * the Firestore onSnapshot to land the new value). The
   * panel re-fetches on every change to this counter.
   */
  refreshKey?: number;
}

interface LiabilityProjection {
  state: CancellationLiabilityState;
  liability: CancellationLiability | null;
  processedAmount: number;
  outstandingAmount: number;
  retentionAmount: number;
  stateLabel: string;
}

export function CancellationLiabilityPanel({
  liability,
  bookingId,
  reservationId,
  isAdmin,
  onOpenRefundModal,
  onOpenExceptionModal,
  refreshKey = 0
}: CancellationLiabilityPanelProps) {
  const [projection, setProjection] = useState<LiabilityProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  // Fetch the live projection from the server. The
  // server reads the stored liability + the
  // cumulative `processedAmount` (from the refunds
  // subcollection) + computes the state. Refetch
  // when the booking/reservation id changes or
  // when the parent's `liability` changes (a fresh
  // cancel or a fresh exception both stamp the
  // field, the panel re-projects to show the new
  // state).
  useEffect(() => {
    if (!liability) {
      setProjection(null);
      return;
    }
    let cancelled = false;
    const fetchProjection = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = await auth.currentUser?.getIdToken(true);
        const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/cancellation-liability`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: token ? `Bearer ${token}` : ""
          },
          body: JSON.stringify(reservationId ? { reservationId } : { bookingId })
        });
        const payload = await response.json();
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load liability state.");
        }
        if (!cancelled) {
          setProjection(payload.data as LiabilityProjection);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Unable to load liability state.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchProjection();
    return () => { cancelled = true; };
  }, [bookingId, reservationId, liability, refreshKey]);

  if (!liability) {
    return (
      <div
        data-testid="cancellation-liability-panel-empty"
        className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-600"
      >
        No cancellation liability recorded. The destructive cancel never auto-refunds — if a
        refund is owed, record it through the Folio → Refund action.
      </div>
    );
  }

  // The state drives the badge colour + the icon.
  // The five states map to: gray (not-required),
  // amber (retained + partially-processed + the
  // "exception applied" cases), blue
  // (pending-processing — the staff needs to do
  // work), green (processed — lifecycle complete).
  const stateBadge = (() => {
    const state = projection?.state || "not-required";
    const label = projection?.stateLabel || "No refund owed";
    if (state === "processed") {
      return { color: "bg-emerald-100 text-emerald-800 border-emerald-200", icon: CheckCircle2, label };
    }
    if (state === "retained") {
      return { color: "bg-amber-100 text-amber-800 border-amber-200", icon: ShieldAlert, label };
    }
    if (state === "pending-processing") {
      return { color: "bg-blue-100 text-blue-800 border-blue-200", icon: Clock, label };
    }
    if (state === "partially-processed") {
      return { color: "bg-amber-100 text-amber-800 border-amber-200", icon: Wallet, label };
    }
    return { color: "bg-gray-100 text-gray-700 border-gray-200", icon: CheckCircle2, label };
  })();
  const StateIcon = stateBadge.icon;

  return (
    <div
      data-testid="cancellation-liability-panel"
      className="rounded-lg border border-gray-200 bg-white"
    >
      {/* Header — collapsible for the drawer real estate */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-t-lg border-b border-gray-100 bg-gray-50/60 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-700 hover:bg-gray-50"
        data-testid="cancellation-liability-panel-header"
      >
        <span className="flex items-center gap-2">
          <Wallet size={14} aria-hidden="true" />
          Cancellation liability
        </span>
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold", stateBadge.color)}>
          <StateIcon size={11} aria-hidden="true" />
          {stateBadge.label}
        </span>
        {expanded ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
      </button>

      {expanded && (
        <div className="space-y-3 p-3 text-[11px] text-gray-700">
          {error && (
            <div
              data-testid="cancellation-liability-panel-error"
              className="rounded border border-red-200 bg-red-50 p-2 text-[10px] text-red-700"
            >
              {error}
            </div>
          )}
          {loading && !projection && (
            <div data-testid="cancellation-liability-panel-loading" className="text-[10px] text-gray-500">
              Loading liability state…
            </div>
          )}

          {/* The four-row breakdown. The state is the
              derived badge above; the rows are the
              numbers the staff sees. `policyRefund` is
              immutable; `approvedAmount` is
              admin-controlled; `processedAmount` is
              live from the refunds subcollection;
              `outstandingAmount` is the next refund
              the admin should record. */}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2" data-testid="cancellation-liability-breakdown">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Policy refund</dt>
              <dd className="mt-0.5 text-sm font-semibold text-gray-900" data-testid="liab-policy-refund">
                {formatPrice(liability.policyResult.policyRefund)}
              </dd>
              <p className="mt-0.5 text-[10px] text-gray-500">
                {liability.policyResult.refundPct}% · {liability.policyResult.source} · {liability.policyResult.cutoffHours}h cutoff
              </p>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Approved</dt>
              <dd className="mt-0.5 text-sm font-semibold text-gray-900" data-testid="liab-approved-amount">
                {formatPrice(projection?.liability?.approvedAmount ?? liability.approvedAmount)}
              </dd>
              {liability.exception && (
                <p className="mt-0.5 text-[10px] text-amber-700" data-testid="liab-exception-note">
                  Exception applied: {liability.exception.reason}
                </p>
              )}
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Processed</dt>
              <dd className="mt-0.5 text-sm font-semibold text-gray-900" data-testid="liab-processed-amount">
                {formatPrice(projection?.processedAmount ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Outstanding</dt>
              <dd className="mt-0.5 text-sm font-semibold text-gray-900" data-testid="liab-outstanding-amount">
                {formatPrice(projection?.outstandingAmount ?? 0)}
              </dd>
            </div>
          </dl>

          {/* Retention callout (only when an exception reduced the approved amount below the policy). */}
          {projection && projection.retentionAmount > 0 && (
            <div
              data-testid="liab-retention-callout"
              className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800"
            >
              <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-[10px] leading-relaxed">
                Exception retains <strong>{formatPrice(projection.retentionAmount)}</strong> beyond the policy refund.
                The hotel keeps this amount in addition to the standard policy.
              </p>
            </div>
          )}

          {/* Net-collected + retained-at-cancel callout (the policy result's "money story" line). */}
          <div className="rounded border border-gray-100 bg-gray-50/60 p-2 text-[10px] text-gray-600">
            <p>
              At cancel: collected <strong>{formatPrice(liability.policyResult.netCollected)}</strong>,
              policy refunded <strong>{formatPrice(liability.policyResult.policyRefund)}</strong>,
              retained <strong>{formatPrice(liability.policyResult.retainedAmount)}</strong>.
            </p>
          </div>

          {/* Action buttons — admin-only. Front-desk
              staff can see the breakdown but cannot
              record a refund or apply an exception
              (CRL-07's "only Admin may approve an
              exception or record a processed refund"). */}
          {isAdmin && (
            <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-2" data-testid="liab-actions">
              <button
                type="button"
                onClick={() => onOpenRefundModal(projection?.outstandingAmount ?? 0)}
                disabled={(projection?.outstandingAmount ?? 0) <= 0}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="liab-open-refund"
              >
                <Wallet size={11} aria-hidden="true" />
                Record processed refund
              </button>
              <button
                type="button"
                onClick={onOpenExceptionModal}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                data-testid="liab-open-exception"
              >
                <ShieldAlert size={11} aria-hidden="true" />
                Apply exception
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Per CRL-07 (2026-08-03, per decision #173): the
// exception modal. Small form — an amount input
// (must be `0 ≤ amount ≤ policyRefund`) + a
// required reason input (≤500 chars). On submit,
// calls `POST /api/bookings/cancellation-exception`
// with the right id (`reservationId` or
// `bookingId`). Admin-only — the parent gates the
// modal open on `currentUser?.role === "admin"`.
interface CancellationExceptionModalProps {
  open: boolean;
  onClose: () => void;
  /** The stored liability's policy result. The amount input is bounded by `policyRefund`. */
  liability: CancellationLiability | null | undefined;
  /** The booking id (per-child / legacy cancels). */
  bookingId: string;
  /** The reservation id (reservation-scope cancels). */
  reservationId?: string | null;
  /** Optional callback after a successful exception. The parent can use it to refresh the snapshot. */
  onSuccess?: (newLiability: CancellationLiability) => void;
}

export function CancellationExceptionModal({
  open,
  onClose,
  liability,
  bookingId,
  reservationId,
  onSuccess
}: CancellationExceptionModalProps) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const policyRefund = Math.max(Number(liability?.policyResult?.policyRefund) || 0, 0);

  // Reset the form when the modal opens. The
  // default amount is the current `approvedAmount`
  // — a common case is "the admin reviewed the
  // exception and wants to adjust it" (a
  // pre-filled value saves a keystroke). The
  // server still validates `0 ≤ amount ≤
  // policyRefund`, so a client-supplied value
  // outside the bound is rejected at the API
  // boundary.
  useEffect(() => {
    if (open) {
      setAmount(String(liability?.approvedAmount ?? policyRefund));
      setReason("");
      setError(null);
    }
  }, [open, liability, policyRefund]);

  if (!open || !liability) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0 || numericAmount > policyRefund) {
      setError(`Amount must be between 0 and ${formatPrice(policyRefund)}.`);
      return;
    }
    if (!reason.trim()) {
      setError("A reason is required for the exception.");
      return;
    }
    setSubmitting(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/cancellation-exception`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          ...(reservationId ? { reservationId } : { bookingId }),
          approvedAmount: numericAmount,
          reason: reason.trim()
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.error || "Unable to record exception.");
      }
      onSuccess?.(payload.data.cancellationLiability as CancellationLiability);
      onClose();
    } catch (err: any) {
      setError(err.message || "Unable to record exception.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      data-testid="cancellation-exception-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold text-gray-900">Apply cancellation exception</h2>
        <p className="mt-1 text-[11px] text-gray-600">
          Reduces the approved refund from <strong>{formatPrice(policyRefund)}</strong> (the policy result)
          to a lower amount. The policy result is read-only — only the approved amount changes. A reason
          is required for the audit trail.
        </p>
        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Approved amount
            </label>
            <input
              type="number"
              min={0}
              max={policyRefund}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
              data-testid="exception-amount-input"
              required
            />
            <p className="mt-0.5 text-[10px] text-gray-500">
              Maximum {formatPrice(policyRefund)} (the policy refund). The exception can only reduce, never increase.
            </p>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
              Reason (required, ≤500 chars)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value.slice(0, 500))}
              rows={3}
              className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
              placeholder="Why is the approved amount being reduced?"
              data-testid="exception-reason-input"
              required
            />
            <p className="mt-0.5 text-right text-[10px] text-gray-500">{reason.length} / 500</p>
          </div>
          {error && (
            <div
              data-testid="exception-error"
              className="rounded border border-red-200 bg-red-50 p-2 text-[10px] text-red-700"
            >
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
              disabled={submitting}
              data-testid="exception-cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md border border-amber-300 bg-amber-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              disabled={submitting}
              data-testid="exception-submit"
            >
              {submitting ? "Recording…" : "Record exception"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
