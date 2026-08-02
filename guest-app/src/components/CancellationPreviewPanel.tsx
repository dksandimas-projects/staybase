// Per CRL-06 (2026-08-02): the cancellation preview
// panel (guest variant). Renders the per-scope financial
// effect the new `POST /api/bookings/cancel-preview`
// endpoint returns. The guest `/my-booking` page mounts
// this inside the cancel modal so the guest sees the
// breakdown BEFORE tapping confirm. The destructive
// cancel never auto-refunds (CRL-04); the panel makes
// that explicit by surfacing the "staff processing
// still required" callout when the policy refunds
// money AND the guest has paid.
//
// This is the guest-app mirror of the admin-app
// `CancellationPreviewPanel` (`admin-app/src/components/
// CancellationPreviewPanel.tsx`). The two share the
// same response shape (the `CancellationPreview`
// interface in `shared/types/index.ts`); the layout
// is tuned for the guest modal's wider card.

import type { CancellationPreview } from "@spark-inn/shared";
import { Info, ShieldCheck } from "lucide-react";
import { formatPrice } from "../utils/format";

interface CancellationPreviewPanelProps {
  preview: CancellationPreview | null;
  isLoading?: boolean;
  error?: string | null;
}

export function CancellationPreviewPanel({
  preview,
  isLoading = false,
  error = null
}: CancellationPreviewPanelProps) {
  if (error) {
    return (
      <div
        data-testid="cancellation-preview-panel-error"
        className="rounded-lg border border-amber-200 bg-amber-50 p-3"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
          Cancellation preview unavailable
        </p>
        <p className="mt-1 text-xs leading-relaxed text-amber-800">
          {error}
        </p>
        <p className="mt-1 text-[11px] text-amber-700">
          You can still proceed with the cancellation. The financial breakdown will be unavailable, but our team will follow up if a refund applies.
        </p>
      </div>
    );
  }
  if (isLoading || !preview) {
    return (
      <div
        data-testid="cancellation-preview-panel-loading"
        className="rounded-lg border border-gray-200 bg-gray-50 p-3"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Cancellation preview
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Loading the financial breakdown…
        </p>
        <div className="skeleton mt-3 h-16 rounded-lg" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div
      data-testid="cancellation-preview-panel"
      className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Cancellation preview
      </p>
      <p className="mt-0.5 text-xs text-gray-600">
        {preview.kind === "reservation"
          ? `Reservation ${preview.reservationRef || "—"} — ${preview.rooms?.length || 0} room${preview.rooms?.length === 1 ? "" : "s"}`
          : `Booking ${preview.bookingRef}`}
      </p>

      {/* Per-room projections (only on reservation scope). */}
      {preview.kind === "reservation" && preview.rooms && preview.rooms.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Room</th>
                <th className="px-3 py-2 text-right font-semibold">Subtotal</th>
                <th className="px-3 py-2 text-right font-semibold">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {preview.rooms.map((r) => (
                <tr key={r.bookingId} data-testid="cancellation-preview-room-row">
                  <td className="px-3 py-2 text-gray-800">
                    <span className="block font-semibold">
                      Room {r.position ?? "?"} · {r.bookingRef}
                    </span>
                    <span className="block text-[11px] text-gray-500">
                      {r.roomType || "Room"} · {r.refundPct}% refund
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-gray-800">
                    {formatPrice(r.subtotal)}
                  </td>
                  <td className={r.policyRefund > 0 ? "px-3 py-2 text-right font-semibold text-emerald-700" : "px-3 py-2 text-right text-gray-500"}>
                    {formatPrice(r.policyRefund)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Aggregate breakdown. */}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Subtotal</dt>
          <dd className="mt-0.5 font-semibold text-gray-900" data-testid="cancellation-preview-subtotal">
            {formatPrice(preview.subtotal)}
          </dd>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Net collected</dt>
          <dd className="mt-0.5 font-semibold text-gray-900" data-testid="cancellation-preview-net-collected">
            {formatPrice(preview.netCollected)}
          </dd>
        </div>
        <div className="rounded-lg bg-emerald-50 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-wider text-emerald-700">Policy refund</dt>
          <dd className="mt-0.5 font-semibold text-emerald-700" data-testid="cancellation-preview-policy-refund">
            {formatPrice(preview.policyRefund)}
          </dd>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2">
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Retained</dt>
          <dd className="mt-0.5 font-semibold text-gray-900" data-testid="cancellation-preview-retained">
            {formatPrice(preview.retainedAmount)}
          </dd>
        </div>
      </dl>

      {/* Staff-processing callout (CRL-04's "no refund is issued automatically"). */}
      <div
        className={
          preview.staffProcessingRequired
            ? "mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3"
            : "mt-3 flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3"
        }
        data-testid="cancellation-preview-callout"
      >
        {preview.staffProcessingRequired ? (
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
        ) : (
          <Info size={14} className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
        )}
        <p className={preview.staffProcessingRequired ? "text-xs leading-relaxed text-amber-800" : "text-xs leading-relaxed text-gray-700"}>
          {preview.staffProcessingRequired
            ? `Our team will review your cancellation and reach out about a refund of up to ${formatPrice(preview.policyRefund)}. No refund is issued automatically — a staff member will contact you.`
            : preview.retainedAmount > 0
              ? `${formatPrice(preview.retainedAmount)} of the collected payment is retained under the cancellation policy.`
              : "No collected payment needs to be refunded or retained."}
        </p>
      </div>

      {/* Policy text + cutoff summary. */}
      <div className="mt-3 border-t border-gray-100 pt-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Cancellation policy
        </p>
        <p className="mt-1 text-xs leading-relaxed text-gray-700">
          {preview.policyText}
        </p>
        <p className="mt-1 text-[11px] text-gray-500">
          {preview.isBeforeCutoff
            ? `${preview.hoursRemaining.toFixed(1)} hours before check-in (before the ${preview.cutoffHours}h cutoff).`
            : preview.hoursRemaining >= 0
              ? `Within the ${preview.cutoffHours}h cutoff window — ${preview.hoursRemaining.toFixed(1)} hours before check-in.`
              : `${Math.abs(preview.hoursRemaining).toFixed(1)} hours after scheduled check-in.`}
        </p>
      </div>
    </div>
  );
}
