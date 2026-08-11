// Per CRL-06 (2026-08-02): the cancellation preview
// panel. Renders the per-scope financial effect the
// new `POST /api/bookings/cancel-preview` endpoint
// returns — guest + admin cancel modals mount this in
// the `ConfirmForm`'s `additionalFields` slot (added
// in MRB-13) so the user sees the breakdown BEFORE
// tapping confirm. The destructive cancel never
// auto-refunds (CRL-04); the panel makes that
// explicit by surfacing the "staff processing still
// required" callout when the policy refunds money AND
// the guest has paid.

import type { CancellationPreview } from "@spark-inn/shared";
import { CalendarPlus, History, Info, ShieldCheck } from "lucide-react";
import { formatPrice } from "../utils/format";
import { cn } from "../utils/cn";

interface CancellationPreviewPanelProps {
  preview: CancellationPreview | null;
  isLoading?: boolean;
  error?: string | null;
  className?: string;
  // Per CRL-08 (2026-08-11, per decision #213): the
  // booking's "Booked on" + "Originally for" dates.
  // Both ISO strings; `null` / undefined when the
  // booking has never been rescheduled (the panel
  // suppresses "Originally for" in that case). The
  // "Booked on" line always renders when present.
  bookedOn?: string | null;
  originallyFor?: string | null;
}

export function CancellationPreviewPanel({
  preview,
  isLoading = false,
  error = null,
  className,
  bookedOn = null,
  originallyFor = null
}: CancellationPreviewPanelProps) {
  if (error) {
    return (
      <div
        data-testid="cancellation-preview-panel-error"
        className={cn(
          "rounded-lg border border-red-200 bg-red-50 p-3",
          className
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-red-700">
          Could not load the cancellation preview
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-red-700">
          {error}
        </p>
        <p className="mt-1 text-[11px] text-red-600">
          The cancellation will still proceed if you tap confirm — the financial breakdown is unavailable.
        </p>
      </div>
    );
  }
  if (isLoading || !preview) {
    return (
      <div
        data-testid="cancellation-preview-panel-loading"
        className={cn(
          "rounded-lg border border-gray-200 bg-gray-50 p-3",
          className
        )}
      >
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Cancellation preview
        </p>
        <p className="mt-1 text-[11px] text-gray-500">
          Loading the financial breakdown…
        </p>
        <div className="skeleton mt-3 h-14 rounded-lg" aria-hidden="true" />
      </div>
    );
  }
  return (
    <div
      data-testid="cancellation-preview-panel"
      className={cn(
        "rounded-lg border border-gray-200 bg-white p-3 shadow-sm",
        className
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Cancellation preview
      </p>
      <p className="mt-0.5 text-[11px] text-gray-600">
        {preview.kind === "reservation"
          ? `Reservation ${preview.reservationRef || "—"} — ${preview.rooms?.length || 0} cancellable room${preview.rooms?.length === 1 ? "" : "s"}`
          : `Booking ${preview.bookingRef}`}
      </p>
      {/* Per CRL-08 (2026-08-11, per decision #213):
          the booking's "Booked on" + "Originally for"
          metadata. The two dates make a recent reschedule
          visible at a glance — when "Originally for" is
          before the current stay dates, the booking was
          moved. Rendered as a small two-line block under
          the booking ref so the staff can see the snapshot
          age + the original schedule before reading the
          policy verdict. The "Originally for" line is
          hidden when the booking has never been rescheduled
          (the helper returns `null` in that case). */}
      {(bookedOn || originallyFor) && (
        <dl
          data-testid="cancellation-preview-booking-dates"
          className="mt-2 grid grid-cols-1 gap-1 rounded-md bg-gray-50 px-2 py-1.5 text-[10px] sm:grid-cols-2"
        >
          {bookedOn && (
            <div className="flex items-center gap-1.5">
              <CalendarPlus size={11} className="shrink-0 text-gray-500" aria-hidden="true" />
              <dt className="font-semibold uppercase tracking-wider text-gray-500">Booked on</dt>
              <dd className="font-medium text-gray-700" data-testid="cancellation-preview-booked-on">
                {formatBookedOnDate(bookedOn)}
              </dd>
            </div>
          )}
          {originallyFor && (
            <div className="flex items-center gap-1.5">
              <History size={11} className="shrink-0 text-gray-500" aria-hidden="true" />
              <dt className="font-semibold uppercase tracking-wider text-gray-500">Originally for</dt>
              <dd className="font-medium text-gray-700" data-testid="cancellation-preview-originally-for">
                {formatBookedOnDate(originallyFor)}
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* Per-room projections (only on reservation scope). */}
      {preview.kind === "reservation" && preview.rooms && preview.rooms.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-left text-[11px]">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-2 py-1.5 font-semibold">Room</th>
                <th className="px-2 py-1.5 text-right font-semibold">Subtotal</th>
                <th className="px-2 py-1.5 text-right font-semibold">Refund</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {preview.rooms.map((r) => (
                <tr key={r.bookingId} data-testid="cancellation-preview-room-row">
                  <td className="px-2 py-1.5 text-gray-800">
                    <span className="block font-semibold">
                      Room {r.position ?? "?"} · {r.bookingRef}
                    </span>
                    <span className="block text-[10px] text-gray-500">
                      {r.roomType || "Room"} · {r.refundPct}% refund
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-800">
                    {formatPrice(r.subtotal)}
                  </td>
                  <td className={cn(
                    "px-2 py-1.5 text-right font-semibold",
                    r.policyRefund > 0 ? "text-emerald-700" : "text-gray-500"
                  )}>
                    {formatPrice(r.policyRefund)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Aggregate breakdown. */}
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg bg-gray-50 px-2 py-1.5">
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Subtotal</dt>
          <dd className="mt-0.5 font-semibold text-gray-900" data-testid="cancellation-preview-subtotal">
            {formatPrice(preview.subtotal)}
          </dd>
        </div>
        <div className="rounded-lg bg-gray-50 px-2 py-1.5">
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Net collected</dt>
          <dd className="mt-0.5 font-semibold text-gray-900" data-testid="cancellation-preview-net-collected">
            {formatPrice(preview.netCollected)}
          </dd>
        </div>
        <div className="rounded-lg bg-emerald-50 px-2 py-1.5">
          <dt className="text-[10px] uppercase tracking-wider text-emerald-700">Policy refund</dt>
          <dd className="mt-0.5 font-semibold text-emerald-700" data-testid="cancellation-preview-policy-refund">
            {formatPrice(preview.policyRefund)}
          </dd>
        </div>
        <div className="rounded-lg bg-gray-50 px-2 py-1.5">
          <dt className="text-[10px] uppercase tracking-wider text-gray-500">Retained by hotel</dt>
          <dd className="mt-0.5 font-semibold text-gray-900" data-testid="cancellation-preview-retained">
            {formatPrice(preview.retainedAmount)}
          </dd>
        </div>
      </dl>

      {/* Policy callout (CRL-04's "no refund is issued automatically"). */}
      <div
        className={cn(
          "mt-3 flex items-start gap-2 rounded-lg p-2",
          preview.staffProcessingRequired
            ? "border border-amber-200 bg-amber-50"
            : "border border-gray-200 bg-gray-50/60"
        )}
        data-testid="cancellation-preview-callout"
      >
        {preview.staffProcessingRequired ? (
          <ShieldCheck size={14} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
        ) : (
          <Info size={14} className="mt-0.5 shrink-0 text-gray-500" aria-hidden="true" />
        )}
        <p className={cn(
          "text-[11px] leading-relaxed",
          preview.staffProcessingRequired ? "text-amber-800" : "text-gray-700"
        )}>
          {preview.staffProcessingRequired
            ? `Staff processing is still required after the cancel commits — the guest will need a refund of up to ${formatPrice(preview.policyRefund)}. No refund is issued automatically.`
            : preview.retainedAmount > 0
              ? `${formatPrice(preview.retainedAmount)} of the collected payment is retained under the cancellation policy.`
              : "No collected payment needs to be refunded or retained."}
        </p>
      </div>

      {/* Policy text (the same one the guest sees in the email + the lookup card). */}
      <div className="mt-3 border-t border-gray-100 pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
          Cancellation policy
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-gray-700">
          {preview.policyText}
        </p>
        <p className="mt-1 text-[10px] text-gray-500">
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

// Per CRL-08 (2026-08-11, per decision #213): the
// booking-date formatter. Renders the ISO string as
// a friendly "Aug 7, 2026" label using the existing
// `Intl.DateTimeFormat` API. The same helper is shared
// with the admin booking drawer's "Booked on" line
// and the guest /my-booking card; the admin panel
// uses the local copy because the import is local to
// the admin app + the formatting is identical.
function formatBookedOnDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}
