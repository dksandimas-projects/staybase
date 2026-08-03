// Per CRL-08 (2026-08-03, per decision #174): the
// Reports "Liability" tab. Reads every
// `cancellationLiability` snapshot the destructive
// cancel stamped + sums the refunds subcollection
// per liability to project the live state via the
// pure `computeCancellationLiabilityState` helper.
// The metrics surfaced (per the spec body):
//
//   - **Pending count** — liabilities in
//     `pending-processing` or `partially-processed`
//     state (the desk's "money to process" list).
//   - **Pending amount** — sum of `outstandingAmount`
//     for the pending items.
//   - **Partials** — count of `partially-processed`
//     liabilities (the "we owe more" subset).
//   - **Age distribution** — bucketed days-since-
//     cancel for pending items (`<7d` / `7-30d` /
//     `30d+`).
//   - **Processed total** — sum of `processedAmount`
//     for liabilities in the report date range (the
//     period when the cancel was committed).
//   - **Retained cancellation revenue** — sum of
//     `retentionAmount` for liabilities with a
//     positive retention (the "extra we kept beyond
//     the policy" via the CRL-07 exception path).
//
// The dual-source read (reservation header for new
// reservations, booking doc for legacy null-
// `reservationId` + per-child cancels in a multi-
// room reservation) is the same shape the
// `handleAddRefund` + the CRL-07 projection
// endpoint use. The subscription reads the live
// refunds subcollection on mount + after every
// relevant mutation (the parent passes a
// `refreshKey` to force a re-fetch when a refund
// commits).
//
// Exports + Daily Close continue to derive actual
// cash movement from the payment ledger, never
// from `approvedAmount` (per #173's "derived from
// immutable ledger entries" rule). The liability
// queue is a separate surface that surfaces the
// lifecycle state.

import { useEffect, useState, useMemo } from "react";
import { collection, collectionGroup, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { Wallet, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { db } from "../firebase/config";
import { useAdmin } from "../context/AdminContext";
import { computeCancellationLiabilityState } from "@spark-inn/shared";
import { formatPrice } from "../utils/format";
import { cn } from "../utils/cn";

interface LiabilityRow {
  id: string;
  kind: "reservation" | "booking";
  bookingRef: string | null;
  reservationRef: string | null;
  roomNumber: string | null;
  roomType: string | null;
  guestName: string | null;
  cancelledAt: Date | null;
  liability: any;
  processedAmount: number;
  outstandingAmount: number;
  retentionAmount: number;
  state: string;
  stateLabel: string;
  policyRefund: number;
  approvedAmount: number;
}

interface LiabilityTabProps {
  /** Report date range — used for the "processed total" + "retained" period metrics. */
  rangeStart: Date;
  rangeEnd: Date;
  /** Optional parent-controlled refresh key. The tab refetches when this changes. */
  refreshKey?: number;
}

export function LiabilityTab({ rangeStart, rangeEnd, refreshKey = 0 }: LiabilityTabProps) {
  const { bookings } = useAdmin();
  const [rows, setRows] = useState<LiabilityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch every liability + its live `processedAmount`.
  // The fetch is async + per-document; for a 14-room
  // property at small scale this is well within budget.
  // The collectionGroup on `refunds` is the
  // batched-optimisation path if/when the property
  // grows — the spec explicitly defers the "bound the
  // listeners" follow-up to FLR-03 (the 1-year-of-
  // operation trigger).
  useEffect(() => {
    let cancelled = false;
    const fetchRows = async () => {
      setLoading(true);
      setError(null);
      try {
        const result: LiabilityRow[] = [];
        // 1. New reservations with `cancellationLiability`.
        // Reads every reservation doc; the property
        // never has more than a few hundred reservations
        // at any time, so a full collection read is
        // fine. (The reservationId index exists for
        // per-room reads; this is the per-reservation
        // read.)
        const reservationsSnap = await getDocs(collection(db, "reservations"));
        // Build a Map<reservationId, processedAmount>
        // from the collectionGroup refunds read so
        // every reservation's `processedAmount` is
        // one O(1) lookup, not one per-document
        // subcollection read.
        const refundsGroup = await getDocs(collectionGroup(db, "refunds"));
        const processedByReservation = new Map<string, number>();
        for (const refundDoc of refundsGroup.docs) {
          // The collectionGroup path is
          // `reservations/{reservationId}/refunds/{refundId}`
          // for new reservations (the writer
          // MRB-04 Phase 2.x shipped). Legacy null-
          // `reservationId` refunds live at
          // `bookings/{id}/payments/{refundId}` —
          // they do NOT match the reservation
          // pattern, so the Map skip is correct.
          const match = refundDoc.ref.path.match(/^reservations\/([^/]+)\/refunds\//);
          if (!match) continue;
          const reservationId = match[1];
          const amount = Math.abs(Number(refundDoc.data()?.amount || 0));
          processedByReservation.set(reservationId, (processedByReservation.get(reservationId) || 0) + amount);
        }
        for (const resDoc of reservationsSnap.docs) {
          const data = resDoc.data();
          if (!data.cancellationLiability) continue;
          const liability = data.cancellationLiability;
          if (!liability || !liability.policyResult) continue;
          const processedAmount = processedByReservation.get(resDoc.id) || 0;
          const projection = computeCancellationLiabilityState({ liability, processedAmount });
          result.push({
            id: resDoc.id,
            kind: "reservation",
            bookingRef: null,
            reservationRef: String(data.reservationRef || ""),
            roomNumber: null,
            roomType: null,
            guestName: String(data.leadGuestName || ""),
            cancelledAt: toDate(data.updatedAt),
            liability,
            processedAmount: projection.processedAmount,
            outstandingAmount: projection.outstandingAmount,
            retentionAmount: projection.retentionAmount,
            state: projection.state,
            stateLabel: projection.stateLabel,
            policyRefund: Number(liability.policyResult?.policyRefund || 0),
            approvedAmount: projection.liability?.approvedAmount || 0
          });
        }
        // 2. Per-child + legacy null-`reservationId`
        // bookings with `cancellationLiability`. The
        // admin context's `bookings` array already
        // carries the snapshot (CRL-07 hydration);
        // the per-booking refund subcollection is
        // the legacy path. A collectionGroup on
        // `payments` filtered for negative entries
        // would also work, but a per-booking read is
        // simpler and well within budget for the
        // few per-cancelled-child snapshots that
        // ever exist.
        const perChildBookings = bookings.filter((b: any) => b.cancellationLiability);
        for (const booking of perChildBookings) {
          // Skip the per-child path when the
          // reservation header already has the
          // snapshot (the reservation-scope cancel
          // path stamps the header, not the
          // children). The per-child snapshot only
          // matters when the cancel was per-child
          // (one of N rooms) OR when the booking
          // is legacy null-`reservationId`.
          const isNewPath = Boolean(booking.reservationId);
          if (isNewPath) continue;
          const liability = booking.cancellationLiability;
          if (!liability || !liability.policyResult) continue;
          const paymentsSnap = await getDocs(collection(db, "bookings", booking.id, "payments"));
          const processedAmount = paymentsSnap.docs
            .filter((d) => Number(d.data()?.amount || 0) < 0)
            .reduce((sum, d) => sum + Math.abs(Number(d.data()?.amount || 0)), 0);
          const projection = computeCancellationLiabilityState({ liability, processedAmount });
          result.push({
            id: booking.id,
            kind: "booking",
            bookingRef: booking.bookingRef || null,
            reservationRef: booking.reservationRef || null,
            roomNumber: booking.roomNumber || null,
            roomType: booking.roomType || null,
            guestName: booking.guestName || null,
            cancelledAt: toDate(booking.cancelledAt),
            liability,
            processedAmount: projection.processedAmount,
            outstandingAmount: projection.outstandingAmount,
            retentionAmount: projection.retentionAmount,
            state: projection.state,
            stateLabel: projection.stateLabel,
            policyRefund: Number(liability.policyResult?.policyRefund || 0),
            approvedAmount: projection.liability?.approvedAmount || 0
          });
        }
        if (!cancelled) setRows(result);
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Unable to load liability queue.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchRows();
    return () => { cancelled = true; };
  }, [bookings, refreshKey]);

  // The five headline metrics. The pending list
  // (count + amount) uses the LIVE state, not a
  // period filter — the desk cares about every
  // open item regardless of when the cancel was
  // committed. The processed + retained totals use
  // the report date range (when the cancel was
  // committed falls in the range) so the figures
  // line up with the rest of the Reports.
  const metrics = useMemo(() => {
    const pending = rows.filter((r) => r.state === "pending-processing" || r.state === "partially-processed");
    const pendingAmount = pending.reduce((sum, r) => sum + r.outstandingAmount, 0);
    const partials = rows.filter((r) => r.state === "partially-processed").length;
    const inRange = rows.filter((r) => r.cancelledAt && r.cancelledAt >= rangeStart && r.cancelledAt <= rangeEnd);
    const processedTotal = inRange.reduce((sum, r) => sum + r.processedAmount, 0);
    const retainedRevenue = inRange
      .filter((r) => r.retentionAmount > 0)
      .reduce((sum, r) => sum + r.retentionAmount, 0);
    // Age distribution for pending items. The
    // bucket thresholds are intentional: a
    // pending refund older than 30 days is a
    // red-flag for the desk to chase.
    const ageBuckets = { "under-7d": 0, "7-30d": 0, "over-30d": 0 };
    const now = new Date();
    for (const r of pending) {
      if (!r.cancelledAt) continue;
      const days = (now.getTime() - r.cancelledAt.getTime()) / (1000 * 60 * 60 * 24);
      if (days < 7) ageBuckets["under-7d"] += 1;
      else if (days < 30) ageBuckets["7-30d"] += 1;
      else ageBuckets["over-30d"] += 1;
    }
    return {
      pendingCount: pending.length,
      pendingAmount,
      partials,
      ageBuckets,
      processedTotal,
      retainedRevenue
    };
  }, [rows, rangeStart, rangeEnd]);

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        {error}
      </div>
    );
  }
  if (loading && rows.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-500" aria-busy="true">
        Loading liability queue…
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="liability-tab-content">
      {/* Headline metrics */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="liability-headline-metrics">
        <MetricCard
          icon={Clock}
          label="Pending refunds"
          value={metrics.pendingCount}
          sublabel={formatPrice(metrics.pendingAmount)}
          accent="amber"
        />
        <MetricCard
          icon={AlertTriangle}
          label="Partially refunded"
          value={metrics.partials}
          sublabel="bookings with refund in progress"
          accent="amber"
        />
        <MetricCard
          icon={CheckCircle2}
          label="Processed (in range)"
          value={formatPrice(metrics.processedTotal)}
          sublabel="Total returned to guests"
          accent="emerald"
        />
        <MetricCard
          icon={Wallet}
          label="Retained (in range)"
          value={formatPrice(metrics.retainedRevenue)}
          sublabel="Extra kept beyond policy"
          accent="violet"
        />
      </div>

      {/* Age distribution — single row of three buckets */}
      <div className="rounded-lg border border-gray-200 bg-white p-4" data-testid="liability-age-buckets">
        <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Pending age distribution</h3>
        <div className="grid grid-cols-3 gap-3">
          <AgeBucket label="Under 7 days" count={metrics.ageBuckets["under-7d"]} accent="emerald" />
          <AgeBucket label="7–30 days" count={metrics.ageBuckets["7-30d"]} accent="amber" />
          <AgeBucket label="Over 30 days" count={metrics.ageBuckets["over-30d"]} accent="rose" />
        </div>
      </div>

      {/* The pending list. The desk's primary
          action surface — every item here needs
          a refund to be recorded (or an exception
          applied) before it ages into the >30d
          red-flag bucket. Sorted by age (oldest
          first) so the most urgent items rise to
          the top. */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <header className="border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-900">Pending refunds</h3>
          <p className="text-[11px] text-gray-500">
            {metrics.pendingCount === 0
              ? "All caught up — no pending refunds."
              : `${metrics.pendingCount} pending · ${formatPrice(metrics.pendingAmount)} outstanding`}
          </p>
        </header>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400">No cancellation liability recorded.</p>
        ) : (
          <ul className="divide-y divide-gray-100" data-testid="liability-pending-list">
            {rows
              .filter((r) => r.state === "pending-processing" || r.state === "partially-processed")
              .sort((a, b) => {
                const aTime = a.cancelledAt?.getTime() || 0;
                const bTime = b.cancelledAt?.getTime() || 0;
                return aTime - bTime; // oldest first
              })
              .map((r) => (
                <PendingRow key={`${r.kind}-${r.id}`} row={r} />
              ))}
          </ul>
        )}
      </div>

      {/* The full liability list (every snapshot,
          sorted by cancelledAt desc) for audit +
          reference. The desk usually works the
          pending list above; this is the
          historical view. */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <header className="border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-bold text-gray-900">All cancellations with liability</h3>
          <p className="text-[11px] text-gray-500">
            {rows.length} {rows.length === 1 ? "entry" : "entries"} · all states
          </p>
        </header>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-gray-400">No cancellation liability recorded.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" data-testid="liability-all-table">
              <thead className="bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Ref</th>
                  <th className="px-3 py-2 text-left">Guest</th>
                  <th className="px-3 py-2 text-left">State</th>
                  <th className="px-3 py-2 text-right">Policy</th>
                  <th className="px-3 py-2 text-right">Approved</th>
                  <th className="px-3 py-2 text-right">Processed</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2 text-right">Retained</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows
                  .sort((a, b) => (b.cancelledAt?.getTime() || 0) - (a.cancelledAt?.getTime() || 0))
                  .map((r) => (
                    <tr key={`${r.kind}-all-${r.id}`} className="text-gray-700">
                      <td className="px-3 py-2 font-semibold text-gray-900">
                        {r.reservationRef || r.bookingRef || r.id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-2">{r.guestName || "—"}</td>
                      <td className="px-3 py-2">
                        <StateBadge state={r.state} stateLabel={r.stateLabel} />
                      </td>
                      <td className="px-3 py-2 text-right">{formatPrice(r.policyRefund)}</td>
                      <td className="px-3 py-2 text-right">{formatPrice(r.approvedAmount)}</td>
                      <td className="px-3 py-2 text-right">{formatPrice(r.processedAmount)}</td>
                      <td className="px-3 py-2 text-right">{formatPrice(r.outstandingAmount)}</td>
                      <td className="px-3 py-2 text-right">{formatPrice(r.retentionAmount)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === "function") return value.toDate();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function MetricCard({ icon: Icon, label, value, sublabel, accent }: {
  icon: any;
  label: string;
  value: string | number;
  sublabel: string;
  accent: "amber" | "emerald" | "violet" | "rose";
}) {
  const accentClass = {
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
    rose: "bg-rose-50 text-rose-700"
  }[accent];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <div className={cn("flex h-8 w-8 items-center justify-center rounded-md", accentClass)}>
          <Icon size={14} aria-hidden="true" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <p className="mt-1.5 text-lg font-bold text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-500">{sublabel}</p>
    </div>
  );
}

function AgeBucket({ label, count, accent }: { label: string; count: number; accent: "emerald" | "amber" | "rose" }) {
  const accentClass = {
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    rose: "text-rose-700"
  }[accent];
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50/60 p-3 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold", accentClass)}>{count}</p>
    </div>
  );
}

function StateBadge({ state, stateLabel }: { state: string; stateLabel: string }) {
  const map: Record<string, string> = {
    "not-required": "bg-gray-100 text-gray-700 border-gray-200",
    "retained": "bg-amber-100 text-amber-800 border-amber-200",
    "pending-processing": "bg-blue-100 text-blue-800 border-blue-200",
    "partially-processed": "bg-amber-100 text-amber-800 border-amber-200",
    "processed": "bg-emerald-100 text-emerald-800 border-emerald-200"
  };
  return (
    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold", map[state] || map["not-required"])}>
      {stateLabel}
    </span>
  );
}

function PendingRow({ row }: { row: LiabilityRow }) {
  const ageLabel = row.cancelledAt
    ? `${Math.max(0, Math.floor((Date.now() - row.cancelledAt.getTime()) / (1000 * 60 * 60 * 24)))}d ago`
    : "—";
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-gray-900">
            {row.reservationRef || row.bookingRef || row.id.slice(0, 8)}
            {row.roomNumber ? ` · Room ${row.roomNumber}` : ""}
          </p>
          <p className="text-[11px] text-gray-500">
            {row.guestName || "—"}
            {row.cancelledAt ? ` · cancelled ${row.cancelledAt.toLocaleDateString()}` : ""}
            {" · "}
            <span className="text-gray-400">{ageLabel}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-gray-900">{formatPrice(row.outstandingAmount)}</p>
          <p className="text-[10px] text-gray-500">outstanding · {formatPrice(row.processedAmount)} of {formatPrice(row.approvedAmount)} processed</p>
          <div className="mt-1">
            <StateBadge state={row.state} stateLabel={row.stateLabel} />
          </div>
        </div>
      </div>
    </li>
  );
}
