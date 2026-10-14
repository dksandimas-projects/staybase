import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BedDouble,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  Loader2,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Save,
  Utensils,
  User,
  Wallet,
  XCircle
} from "lucide-react";
import type { Booking } from "../context/AdminContext";
import { useAdmin } from "../context/AdminContext";
import {
  computeBreakfastCutoffState,
  getLatestPaymentReference,
  MIN_BREAKFAST_OVERRIDE_REASON_LENGTH,
  recomputeBreakfastTotal,
  type BreakfastSelectionEntry,
  type BreakfastServedEntry,
  type PublicBreakfastConfig,
  type PublicBreakfastMeal
} from "@spark-inn/shared";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";
import { useToast } from "./Toast";
import { StatusBadge } from "./StatusBadge";
import { Modal } from "./Modal";
// Per BR-06 (decision #235, 2026-10-13): the refund
// category filter chip + the standalone "Mark as paid"
// modal for the Refunds admin surface. The categories
// match the BR-01 `OnsitePayment` extension
// (`category?: "cancellation" | "breakfast" | null`).
const REFUND_CATEGORY_OPTIONS = [
  { key: "all", label: "All" },
  { key: "cancellation", label: "Cancellation" },
  { key: "breakfast", label: "Breakfast" }
] as const;
type RefundCategoryFilterKey = (typeof REFUND_CATEGORY_OPTIONS)[number]["key"];

// Per BR-06: the standalone "Mark as paid" modal posts
// to `/api/refunds/mark-paid` (the new endpoint the
// BR-06 spec wired into the existing catch-all handler).
async function postMarkRefundPaid(input: {
  bookingId: string;
  refundId: string;
  method: string;
  transactionReference?: string | null;
  note?: string | null;
}): Promise<{ success: boolean; newBookingPaidAmount?: number; refundEntry?: any; alreadyPaid?: boolean; error?: string }> {
  // The admin-app posts to the same `apiBaseUrl` the rest
  // of the staff app uses (mirrors the existing
  // `markBreakfastRefundPaid` wrapper in AdminContext).
  const apiBaseUrl = (typeof window !== "undefined" && (window as any).__API_BASE_URL) || "/api";
  try {
    const resp = await fetch(`${apiBaseUrl}/refunds/mark-paid`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        bookingId: input.bookingId,
        refundId: input.refundId,
        method: input.method,
        transactionReference: input.transactionReference || null,
        note: input.note || null
      })
    });
    const payload = await resp.json().catch(() => ({}));
    return {
      success: Boolean(resp.ok && payload?.success),
      newBookingPaidAmount: payload?.newBookingPaidAmount,
      refundEntry: payload?.refundEntry,
      alreadyPaid: Boolean(payload?.alreadyPaid),
      error: payload?.error
    };
  } catch (err: any) {
    return { success: false, error: err?.message || "Network error." };
  }
}

export type BookingDrawerSection = "overview" | "check-in" | "folio" | "breakfast" | "more";

interface BookingDrawerWorkspaceHeaderProps {
  booking: Booking;
  activeSection: BookingDrawerSection;
  onSectionChange: (section: BookingDrawerSection) => void;
  totalPaid: number;
  balance: number;
  missingCheckInItems: string[];
  // Per WPM-06 (2026-07-31): the header used to render the raw
  // `booking.paymentMethod` key (e.g. "gcash" instead of "GCash"). The
  // parent (BookingsPage) resolves the label via the same
  // `getOnsitePaymentMethodLabel` helper the four other selectors use
  // and passes the resolved string down.
  paymentMethodLabel: string;
  // Per FOL-02 (2026-08-06, decision #198): the latest payment
  // reference for the selected booking, computed by the parent
  // (BookingsPage) from the live subcollection listener state
  // (preferred) + the booking's denormalized onsitePayments
  // array (fallback). Pre-FOL-02, the header read the
  // shared payment-reference helper directly against the
  // booking — that helper returned null for new bookings
  // because the denormalized array was empty (the server's
  // verify / add-payment handlers write to the subcollection, not the
  // array), so the staff saw "Pending verification" forever
  // even after a verified payment. Passing the computed
  // reference as a prop keeps the header a pure function of
  // its inputs; the parent owns the live-vs-persisted
  // disambiguation.
  latestPaymentReference?: string | null;
}

const sections: Array<{
  id: BookingDrawerSection;
  desktopLabel: string;
  mobileLabel: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", desktopLabel: "Overview", mobileLabel: "Summary", icon: LayoutDashboard },
  { id: "check-in", desktopLabel: "Check-in", mobileLabel: "Check-in", icon: ClipboardCheck },
  { id: "folio", desktopLabel: "Folio", mobileLabel: "Folio", icon: CreditCard },
  // Per BR-05 (2026-10-13): the staff breakfast tab
  // surfaces the per-date × per-guest meal grid +
  // served toggles + refund-liability panel. The
  // rendering lives in the `BreakfastTab` component
  // further down this file.
  { id: "breakfast", desktopLabel: "Breakfast", mobileLabel: "Breakfast", icon: Utensils },
  { id: "more", desktopLabel: "Activity & More", mobileLabel: "More", icon: MoreHorizontal }
];

export function BookingDrawerWorkspaceHeader({
  booking,
  activeSection,
  onSectionChange,
  totalPaid,
  balance,
  missingCheckInItems,
  paymentMethodLabel,
  latestPaymentReference
}: BookingDrawerWorkspaceHeaderProps) {
  const needsPaymentReview = booking.status === "payment-uploaded";
  const needsEarlyCheckInReview = booking.earlyCheckIn?.status === "requested";
  const approvedEarlyCheckInTime = booking.earlyCheckIn?.confirmedTime || booking.earlyCheckIn?.requestedTime;
  const hasApprovedEarlyCheckIn = booking.earlyCheckIn?.status === "approved" && Boolean(approvedEarlyCheckInTime);
  const needsCheckInWork = ["confirmed", "payment-confirmed"].includes(booking.status) && missingCheckInItems.length > 0;
  const lifecycleIndex = getLifecycleIndex(booking.status);

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge label={booking.status.replace(/-/g, " ")} status={booking.status} />
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-600">
                {booking.source}
              </span>
              {hasApprovedEarlyCheckIn && (
                <span
                  data-testid="booking-drawer-approved-early-checkin-badge"
                  title={`Early check-in approved for ${approvedEarlyCheckInTime}`}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-200"
                >
                  <Check size={10} aria-hidden="true" />
                  early {approvedEarlyCheckInTime}
                </span>
              )}
            </div>
            <p className="mt-3 truncate text-base font-bold text-gray-950">
              {booking.guestName}
              {(booking as any).isTestData && (
                <span className="ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">TEST</span>
              )}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
              <span className="inline-flex items-center gap-1.5">
                <BedDouble size={14} className="text-primary" aria-hidden="true" />
                Room {booking.roomNumber} · {booking.roomType.replace(/-/g, " ")}
              </span>
              <span>{booking.checkIn} → {booking.checkOut}</span>
              <span>{booking.numNights} night{booking.numNights === 1 ? "" : "s"}</span>
              {/* Per EXB-08 (2026-08-01, per decision #156):
                  the drawer header's occupancy line now
                  shows the adult/child split when both
                  fields are present, with the extra bed
                  count appended when > 0. Legacy pre-CHD
                  bookings without the split read as a
                  single `numGuests` total (the historical
                  "all guests are adults" shape, byte-
                  equivalent to pre-EXB-08). Matches the
                  receipt PDF + the email helper + the
                  /my-booking card so the staff / guest
                  surfaces stay in lockstep. */}
              {(() => {
                const numAdults = Number((booking as any).numAdults);
                const numChildren = Number((booking as any).numChildren);
                const extraBedCount = Number((booking as any).extraBedCount);
                if (Number.isFinite(numAdults) && Number.isFinite(numChildren) && (numAdults > 0 || numChildren > 0)) {
                  const splitLabel = `${numAdults} adult${numAdults === 1 ? "" : "s"} + ${numChildren} child${numChildren === 1 ? "" : "ren"}`;
                  const extraLabel = Number.isFinite(extraBedCount) && extraBedCount > 0
                    ? ` + ${extraBedCount} extra bed${extraBedCount === 1 ? "" : "s"}`
                    : "";
                  return (
                    <span title={`${booking.numGuests || 1} guest${(booking.numGuests || 1) === 1 ? "" : "s"} total`}>
                      {splitLabel}{extraLabel}
                    </span>
                  );
                }
                return <span>{booking.numGuests} guest{booking.numGuests === 1 ? "" : "s"}</span>;
              })()}
              // Per BR-08 (decision #238, 2026-10-14 — close-out): the
                // legacy `booking.hasBreakfast: boolean` flag is
                // gone. The drawer's overview summary reads the
                // new rich `booking.breakfastSelections` map
                // directly (the meal count + the snapshotted
                // total).
                <span>
                  {(booking.breakfastSelections && Object.keys(booking.breakfastSelections).length > 0)
                    ? `${Object.keys(booking.breakfastSelections).length} meal${Object.keys(booking.breakfastSelections).length === 1 ? "" : "s"}`
                    : "No breakfast"}
                </span>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 lg:min-w-[320px]">
            <SummaryMetric label="Total" value={formatPrice(booking.totalPrice)} />
            <SummaryMetric label="Paid" value={formatPrice(totalPaid)} />
            <SummaryMetric
              label={balance > 0 ? "Balance" : balance < 0 ? "Overpaid" : "Settled"}
              value={formatPrice(Math.abs(balance))}
              tone={balance > 0 ? "danger" : "success"}
            />
          </div>
        </div>

        <div className="mt-4 grid gap-3 border-t border-gray-100 pt-4 lg:grid-cols-2">
          <div className="rounded-lg bg-gray-50 px-3 py-3">
            <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-400">
              <User size={13} className="text-primary" aria-hidden="true" />
              Guest information
            </p>
            <div className="mt-2 flex flex-col gap-1.5 text-xs text-gray-650 sm:flex-row sm:flex-wrap sm:gap-x-5">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Mail size={13} className="shrink-0 text-gray-400" aria-hidden="true" />
                <span className="truncate">{booking.guestEmail}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Phone size={13} className="shrink-0 text-gray-400" aria-hidden="true" />
                {booking.guestPhone}
              </span>
            </div>
          </div>

          <div className="grid gap-3 rounded-lg bg-gray-50 px-3 py-3 sm:grid-cols-[minmax(110px,0.7fr)_minmax(180px,1.3fr)] sm:items-end">
            <div>
              <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-400">
                <CreditCard size={13} className="text-primary" aria-hidden="true" />
                Payment method
              </p>
              <p className="mt-2 truncate text-xs font-bold uppercase text-gray-900">
                {paymentMethodLabel || "Not specified"}
              </p>
            </div>
            {/*
              Per 2026-07-24 (refactor/unify-payment-reference-fields):
              the top-level `Booking.paymentReferenceNumber` is gone.
              The canonical reference now lives on the relevant
              payment ledger entry's `transactionReference` and is
              shown in the Folio section. The sticky header keeps
              the payment-method summary only.
            */}
            <div>
              <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-gray-400">
                Reference
              </p>
              <p className="mt-2 truncate text-xs text-gray-600">
                {(latestPaymentReference ?? getLatestPaymentReference(booking)) || (
                  booking.paymentMethod === "pay-at-hotel" ? (
                    <span className="italic text-gray-400">Pay at hotel — no ref needed</span>
                  ) : (
                    <span className="italic text-gray-400">Pending verification</span>
                  )
                )}
              </p>
            </div>
          </div>
        </div>

        {(needsPaymentReview || needsEarlyCheckInReview || needsCheckInWork) && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3" aria-label="Booking alerts">
            {needsPaymentReview && <AlertChip label="Payment proof awaiting verification" onClick={() => onSectionChange("folio")} />}
            {needsEarlyCheckInReview && <AlertChip label="Early check-in needs a decision" onClick={() => onSectionChange("overview")} />}
            {needsCheckInWork && (
              <AlertChip
                label={`${missingCheckInItems.length} check-in item${missingCheckInItems.length === 1 ? "" : "s"} missing`}
                onClick={() => onSectionChange("check-in")}
              />
            )}
          </div>
        )}

        <div className="mt-4 border-t border-gray-100 pt-3" aria-label="Booking lifecycle">
          {booking.status === "cancelled" ? (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-red-700">
              Booking cancelled
            </div>
          ) : (
            <ol className="grid grid-cols-4 gap-1">
              {["Pending", "Confirmed", "Checked in", "Checked out"].map((label, index) => {
                const complete = index < lifecycleIndex;
                const current = index === lifecycleIndex;
                return (
                  <li key={label} className="relative text-center">
                    <div className={cn(
                      "mx-auto flex h-6 w-6 items-center justify-center rounded-full border text-[9px] font-bold",
                      complete && "border-primary bg-primary text-white",
                      current && "border-primary bg-primary-light text-primary-dark",
                      !complete && !current && "border-gray-200 bg-white text-gray-400"
                    )}>
                      {complete ? <Check size={12} aria-hidden="true" /> : index + 1}
                    </div>
                    <p className={cn(
                      "mt-1 text-[9px] font-semibold",
                      current ? "text-primary-dark" : complete ? "text-gray-700" : "text-gray-400"
                    )}>
                      {label}
                    </p>
                    {index < 3 && (
                      <span className={cn(
                        "absolute left-[calc(50%+0.9rem)] right-[calc(-50%+0.9rem)] top-3 h-px",
                        index < lifecycleIndex ? "bg-primary" : "bg-gray-200"
                      )} aria-hidden="true" />
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      <nav
        className="sticky top-0 z-10 -mx-5 overflow-x-auto border-y border-gray-200 bg-white px-5 py-2 sm:mx-0 sm:rounded-card sm:border"
        aria-label="Booking drawer sections"
      >
        <div className="grid min-w-[420px] grid-cols-5 gap-1" role="tablist">
          {sections.map(({ id, desktopLabel, mobileLabel, icon: Icon }) => {
            const active = activeSection === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`booking-drawer-panel-${id}`}
                id={`booking-drawer-tab-${id}`}
                onClick={() => onSectionChange(id)}
                className={cn(
                  "inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] font-bold transition sm:text-xs",
                  active ? "bg-primary text-white shadow-sm" : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                )}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="sm:hidden">{mobileLabel}</span>
                <span className="hidden sm:inline">{desktopLabel}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

// Per feat/staff-special-requests-capture (2026-08-21):
// the staff-only closed-loop editor for the booking's
// `specialRequests` field. The field is captured by the
// front desk after the guest contacts them by email or
// phone (see feat/special-requests-redirect, commit
// 78a79f7 — the public /book form no longer collects
// this). The editor lives in the Overview section of the
// drawer so the staff sees the request alongside guest
// identity. Save posts to the server endpoint which
// stamps the value + the last-edit metadata in a single
// transaction; the local state optimistically reflects the
// saved value on success.
const SPECIAL_REQUESTS_MAX_LENGTH = 1000;

function formatUpdatedAt(value: string | null | undefined): string {
  if (!value) return "Not yet captured";
  // The server writes a Firestore Timestamp which the
  // Firestore SDK normalizes to a `toDate()`-able object
  // on read; a pre-existing ISO string from before this
  // PR ships just passes through Date() parsing.
  const date = typeof (value as any)?.toDate === "function"
    ? (value as any).toDate()
    : new Date(value);
  if (isNaN(date.getTime())) return "Not yet captured";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

interface BookingSpecialRequestsEditorProps {
  booking: Booking;
}

export function BookingSpecialRequestsEditor({ booking }: BookingSpecialRequestsEditorProps) {
  const { updateBookingSpecialRequests } = useAdmin();
  const toast = useToast();
  // Local state mirrors the booking's stored value; the
  // input is uncontrolled while the user is editing but
  // the source of truth is always the booking doc. We
  // re-sync on booking change so two drawers opening in
  // succession (e.g. drawer A closes, drawer B opens with
  // a different booking) reset cleanly.
  const [draft, setDraft] = useState<string>(booking.specialRequests ?? "");
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => {
    setDraft(booking.specialRequests ?? "");
  }, [booking.id, booking.specialRequests]);

  const trimmed = draft.trim();
  const isDirty = trimmed !== (booking.specialRequests ?? "").trim();
  const isOverLimit = trimmed.length > SPECIAL_REQUESTS_MAX_LENGTH;
  const canSave = isDirty && !isOverLimit && !isSaving;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    const result = await updateBookingSpecialRequests(booking.id, trimmed);
    setIsSaving(false);
    if (result.success) {
      toast.success("Special requests saved", "The booking now reflects the latest staff-captured request.");
      return;
    }
    toast.error("Could not save special requests", result.error || "Please try again in a moment.");
  };

  return (
    <section
      data-testid="special-requests-editor"
      className="rounded-lg border border-amber-200 bg-amber-50/40 p-4"
    >
      <div className="flex items-center gap-2">
        <MessageSquareText size={14} className="text-amber-700" aria-hidden="true" />
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
          Special requests (staff-captured)
        </h4>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-amber-900/80">
        Captured from email or phone by the front desk. Guests never see this field.
      </p>
      <textarea
        data-testid="special-requests-editor-input"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={SPECIAL_REQUESTS_MAX_LENGTH}
        rows={3}
        placeholder="e.g. Late check-in ~11pm, extra pillows, vegetarian breakfast"
        className="mt-3 w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-light"
      />
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
        <span className={cn(
          "font-semibold",
          isOverLimit ? "text-red-700" : "text-gray-500"
        )}>
          {trimmed.length} / {SPECIAL_REQUESTS_MAX_LENGTH}
        </span>
        <span className="text-gray-500">
          {booking.specialRequestsUpdatedAt || booking.specialRequestsUpdatedBy ? (
            <>
              Last edited by{" "}
              <span className="font-bold text-gray-700">
                {booking.specialRequestsUpdatedBy ?? "staff"}
              </span>
              {" · "}
              {formatUpdatedAt(booking.specialRequestsUpdatedAt)}
            </>
          ) : (
            "Not yet captured"
          )}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setDraft(booking.specialRequests ?? "")}
          disabled={!isDirty || isSaving}
          className="min-h-[36px] rounded-lg border border-gray-250 bg-white px-3 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          data-testid="special-requests-editor-save"
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-primary px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? (
            <>
              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              Saving…
            </>
          ) : (
            <>
              <Save size={12} aria-hidden="true" />
              Save
            </>
          )}
        </button>
      </div>
    </section>
  );
}

interface BookingDrawerSectionPanelProps {
  section: BookingDrawerSection;
  activeSection: BookingDrawerSection;
  children: ReactNode;
  className?: string;
  primary?: boolean;
}

export function BookingDrawerSectionPanel({
  section,
  activeSection,
  children,
  className,
  primary = false
}: BookingDrawerSectionPanelProps) {
  return (
    <section
      id={primary ? `booking-drawer-panel-${section}` : undefined}
      role={primary ? "tabpanel" : undefined}
      aria-labelledby={primary ? `booking-drawer-tab-${section}` : undefined}
      hidden={activeSection !== section}
      className={cn("space-y-6", activeSection !== section && "!hidden", className)}
    >
      {children}
    </section>
  );
}

interface BookingCheckInReadinessProps {
  ready: boolean;
  missingItems: string[];
}

export function BookingCheckInReadiness({ ready, missingItems }: BookingCheckInReadinessProps) {
  return (
    <div className={cn(
      "rounded-card border p-4",
      ready ? "border-status-green-text/20 bg-status-green-bg" : "border-amber-200 bg-amber-50"
    )}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-gray-950">Check-in readiness</p>
          <p className="mt-1 text-[11px] text-gray-600">
            {ready ? "Required guest records are complete." : "Complete these items before checking in the guest."}
          </p>
        </div>
        <span className={cn(
          "rounded-full px-2.5 py-1 text-[10px] font-bold",
          ready ? "bg-white text-status-green-text" : "bg-white text-amber-700"
        )}>
          {ready ? "Ready" : `${missingItems.length} missing`}
        </span>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {ready ? (
          <div className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2 text-[11px] font-semibold text-status-green-text">
            <Check size={14} aria-hidden="true" />
            Guest ID, registration, and signature saved
          </div>
        ) : missingItems.map((item) => (
          <div key={item} className="flex items-center gap-2 rounded-lg bg-white/80 px-3 py-2 text-[11px] font-semibold text-amber-800">
            <XCircle size={14} className="shrink-0" aria-hidden="true" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

interface BookingDrawerActionFooterProps {
  primaryAction: ReactNode;
  onMoreActions: () => void;
  moreActionsActive: boolean;
}

export function BookingDrawerActionFooter({ primaryAction, onMoreActions, moreActionsActive }: BookingDrawerActionFooterProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div>{primaryAction}</div>
      <button
        type="button"
        onClick={onMoreActions}
        aria-pressed={moreActionsActive}
        className={cn(
          "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-4 text-xs font-bold transition",
          moreActionsActive
            ? "border-primary bg-primary-light text-primary-dark"
            : "border-gray-250 bg-white text-gray-700 hover:bg-gray-50"
        )}
      >
        <MoreHorizontal size={16} aria-hidden="true" />
        More actions
      </button>
    </div>
  );
}

function SummaryMetric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "danger" | "success" }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <p className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className={cn(
        "mt-1 truncate text-xs font-bold",
        tone === "danger" ? "text-red-700" : tone === "success" ? "text-status-green-text" : "text-gray-900"
      )}>
        {value}
      </p>
    </div>
  );
}

function AlertChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-[36px] items-center rounded-full bg-amber-50 px-3 text-[10px] font-bold text-amber-800 ring-1 ring-inset ring-amber-200 transition hover:bg-amber-100"
    >
      {label}
    </button>
  );
}

function getLifecycleIndex(status: Booking["status"]) {
  if (status === "checked-out") return 3;
  if (status === "checked-in") return 2;
  if (status === "confirmed" || status === "payment-confirmed") return 1;
  return 0;
}

// ============================================================================
// BR-05 (2026-10-13, decision #234): the staff breakfast tab.
//
// The tab mirrors the BR-03 Step 2 grid + the BR-04 manage page, but for the
// admin booking drawer. It surfaces:
//
//   - A per-date × per-guest meal dropdown grid (per BookingBreakfastSelections).
//   - A served toggle per slot (extends BSP-01) with the
//     `BreakfastConfig.servedGraceMinutes` window for in-grace un-serves.
//   - A per-date cutoff-status badge (locked vs ordering open) with a
//     red warning banner + override modal for staff changes past the
//     cutoff.
//   - A refund-liability panel that lists pending breakfast refunds with
//     a "Mark as paid" action mapped to the dedicated staff endpoint.
//   - A header summary: total breakfast amount + count + last-modified
//     timestamp + a "Manage meals" focus button.
//
// The tab reads the live `breakfastConfig` from the existing BR-03 public
// `/api/bookings/breakfast/config` GET endpoint — it doesn't depend on
// `useAdmin().breakfastConfig` (which still carries the legacy
// `ratePerPersonPerNight` shape) so the drawer reflects every change the
// settings tab saves without further admin-context plumbing.
//
// All edits are batched locally + flushed through the staff-token-gated
// `/api/bookings/breakfast/staff-update` endpoint in one transaction. The
// override gate (front-desk vs admin) is enforced server-side; the
// client only surfaces the "Mark as paid" + override flows.
// ============================================================================

import { Modal as BreakfastTabModal } from "./Modal";

interface PendingBatchOp {
  add: Array<{ slotKey: string; mealId: string; mealName: string; price: number }>;
  change: Array<{ slotKey: string; mealId: string; mealName: string; price: number }>;
  remove: Array<{ slotKey: string }>;
}

interface PendingServeAction {
  slotKey: string;
  action: "serve" | "unserve";
  reason: string | null;
}

interface PendingRefundPaid {
  refundId: string;
  method: string;
  transactionReference: string | null;
  note: string | null;
}

interface BookingDrawerBreakfastTabProps {
  booking: Booking;
  onAfterSave?: () => void | Promise<void>;
}

export function BookingDrawerBreakfastTab({
  booking,
  onAfterSave
}: BookingDrawerBreakfastTabProps) {
  const {
    staffUpdateBreakfast,
    markBreakfastServed,
    markBreakfastRefundPaid,
    currentUser
  } = useAdmin();
  const toast = useToast();

  // Live `PublicBreakfastConfig` (from the BR-03 endpoint).
  // Re-fetched on mount + after save so the staff sees the latest
  // meal catalog (a meal hidden by Settings doesn't keep a stale
  // dropdown option visible).
  const [config, setConfig] = useState<PublicBreakfastConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);

  // Local batch edits (slotKey -> { mealId: string, mealName: string,
  // price: number } | null). Null means "remove this slot".
  const [pendingOp, setPendingOp] = useState<PendingBatchOp>({
    add: [],
    change: [],
    remove: []
  });

  // Immediate-fire actions (the kitchen marking a meal served flips the
  // served entry without waiting for the next save — same shape as the
  // BR-04 manage page's per-slot server-side commit).
  const [pendingServe, setPendingServe] = useState<PendingServeAction[]>([]);
  const [pendingRefundPaid, setPendingRefundPaid] = useState<
    PendingRefundPaid[]
  >([]);

  // Override modal — opened when any locked-date op needs an
  // override reason before save proceeds.
  const [overrideModal, setOverrideModal] = useState<{
    open: boolean;
    lockedDates: string[];
    reason: string;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [serveBusySlot, setServeBusySlot] = useState<string | null>(null);
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null);
  // Per BR-06 (#235, 2026-10-13): the Refunds admin
  // view's category filter chip + the standalone "Mark
  // as paid" modal state. Default is "all" — back-compat
  // with the pre-BR-06 view (which rendered every
  // refund row regardless of category).
  const [refundCategoryFilter, setRefundCategoryFilter] =
    useState<RefundCategoryFilterKey>("all");
  const [markRefundPaidModal, setMarkRefundPaidModal] = useState<{
    open: boolean;
    refundId: string | null;
    amount: number;
  }>({ open: false, refundId: null, amount: 0 });

  const firstDropdownRef = useRef<HTMLSelectElement | null>(null);

  // Config fetch on mount.
  useEffect(() => {
    let cancelled = false;
    setConfigLoading(true);
    (async () => {
      try {
        const baseUrl = (typeof window !== "undefined" ? window.location.origin : "");
        const res = await fetch(`${baseUrl}/api/bookings/breakfast/config`, {
          method: "GET"
        });
        const data: any = await res.json();
        if (!cancelled) {
          if (data?.success && data?.data) setConfig(data.data as PublicBreakfastConfig);
          else setConfig((prev) => prev);
        }
      } catch {
        // silent — keep null
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------- Derived: dates × slots × per-date lock state ----------

  const breakfastDates = useMemo(() => {
    const startMs = Date.parse(
      `${(booking.checkIn || "").slice(0, 10)}T00:00:00Z`
    );
    const endMs = Date.parse(
      `${(booking.checkOut || "").slice(0, 10)}T00:00:00Z`
    );
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
    const dates: string[] = [];
    for (let ms = startMs, i = 0; ms < endMs && i < 60; ms += 86_400_000, i += 1) {
      const d = new Date(ms);
      dates.push(
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
      );
    }
    return dates;
  }, [booking.checkIn, booking.checkOut]);

  const guestSlots = useMemo(() => {
    const n = Math.max(1, Number(booking.numGuests || 1));
    const slots: Array<{ id: string; label: string }> = [];
    for (let i = 1; i <= n; i += 1) {
      slots.push({ id: `guest-${i}`, label: `Guest ${i}` });
    }
    return slots;
  }, [booking.numGuests]);

  const mealsById = useMemo(() => {
    const map = new Map<string, PublicBreakfastMeal>();
    if (!config?.meals) return map;
    // `normalizeBreakfastConfig` already filters to
    // `isActive === true`, so we don't re-check here.
    for (const meal of config.meals) {
      if (meal && meal.id) map.set(meal.id, meal);
    }
    return map;
  }, [config]);

  const sortedMeals = useMemo(() => {
    const list = config?.meals || [];
    // Display-order sort — the spec says meals render in
    // `displayOrder`, falling back to name asc. The
    // public config already strips admin-only fields
    // but keeps `displayOrder` + `name` intact.
    return [...list].sort((a, b) => {
      const ao = Number(a.displayOrder ?? Number.MAX_SAFE_INTEGER);
      const bo = Number(b.displayOrder ?? Number.MAX_SAFE_INTEGER);
      if (ao !== bo) return ao - bo;
      return String(a.name).localeCompare(String(b.name));
    });
  }, [config]);

  const perDayLocked = useMemo(() => {
    if (!config) return {} as Record<string, boolean>;
    const cutoffTime = String(config.cutoffTime || "20:00");
    const tz = String(config.cutoffTimezone || "Asia/Manila");
    const out: Record<string, boolean> = {};
    for (const d of breakfastDates) {
      const c = computeBreakfastCutoffState({
        serviceDate: d,
        now: new Date(),
        cutoffTime,
        timezone: tz
      });
      out[d] = Boolean(c.isLocked);
    }
    return out;
  }, [breakfastDates, config]);

  // Locked-date lookup when computing pending + active op list.
  const lockedDates = useMemo(
    () => Object.entries(perDayLocked).filter(([, v]) => v).map(([k]) => k),
    [perDayLocked]
  );

  // ---------- Existing data ----------

  // Existing selection per slot, mirrored from booking.
  // The admin-context booking type is a union of the
  // legacy `Record<string, string>` shape + the BR-01
  // rich shape. We detect the rich shape by inspecting
  // a single value's `mealId` (string-key-only legacy
  // values stay in their own shape — the drawer
  // gracefully shows empty slots for those bookings).
  const existingSelections: Record<string, BreakfastSelectionEntry> = useMemo(() => {
    const src: any = booking.breakfastSelections;
    if (!src || typeof src !== "object") return {};
    const out: Record<string, BreakfastSelectionEntry> = {};
    for (const [key, value] of Object.entries(src)) {
      if (value && typeof value === "object" && "mealId" in (value as any)) {
        out[key] = value as BreakfastSelectionEntry;
      }
    }
    return out;
  }, [booking.breakfastSelections]);

  const existingServed: Record<string, BreakfastServedEntry> = useMemo(() => {
    const src: any = booking.breakfastServed;
    if (!src || typeof src !== "object") return {};
    const out: Record<string, BreakfastServedEntry> = {};
    for (const [key, value] of Object.entries(src)) {
      if (value && typeof value === "object" && "servedAt" in (value as any)) {
        out[key] = value as BreakfastServedEntry;
      }
    }
    return out;
  }, [booking.breakfastServed]);

  // Pending refund liabilities (BR-01 `category: "breakfast"`).
  // Walk the booking's `refunds[]` (the existing OnsitePayment shape
  // — the staff UI already loads the full booking via the drawer).
  const pendingRefunds = useMemo(() => {
    const list = Array.isArray((booking as any).refunds)
      ? (booking as any).refunds
      : [];
    return list.filter((r: any) => r && r.category === "breakfast" && r.status === "pending");
  }, [booking]);

  // ---------- Diff (pending vs existing) for total + count ----------
  const diff = useMemo(() => {
    // Build a "next" map by applying pending ops + pending serves onto
    // existing selections.
    const next: Record<string, BreakfastSelectionEntry> = { ...existingSelections };
    for (const op of pendingOp.remove) {
      if (next[op.slotKey]) {
        next[op.slotKey] = {
          ...next[op.slotKey],
          removedAt: next[op.slotKey].removedAt ?? new Date().toISOString() as any,
          removedBy: "staff"
        };
      }
    }
    for (const op of pendingOp.add) {
      const meal = mealsById.get(op.mealId);
      if (!meal) continue;
      next[op.slotKey] = {
        mealId: meal.id,
        mealName: meal.name,
        price: meal.price,
        addedAt: new Date().toISOString() as any,
        addedBy: currentUser?.uid || "staff",
        lastModifiedAt: new Date().toISOString() as any,
        lastModifiedBy: currentUser?.uid || "staff",
        removedAt: null,
        removedBy: null,
        overrideCutoff: false,
        overrideReason: null
      };
    }
    for (const op of pendingOp.change) {
      const meal = mealsById.get(op.mealId);
      if (!meal || !next[op.slotKey]) continue;
      next[op.slotKey] = {
        ...next[op.slotKey],
        mealId: meal.id,
        mealName: meal.name,
        price: meal.price
      };
    }
    return next;
  }, [existingSelections, pendingOp, mealsById, currentUser]);

  const pendingTotal = useMemo(() => recomputeBreakfastTotal(diff as any), [diff]);
  const pendingCount = useMemo(
    () => Object.values(diff).filter((e) => !e.removedAt).length,
    [diff]
  );

  const dirty =
    pendingOp.add.length +
      pendingOp.change.length +
      pendingOp.remove.length >
    0;

  // ---------- Edit handlers ----------

  const handleSelectMeal = (slotKey: string, mealId: string) => {
    const prior = existingSelections[slotKey];
    const meal = mealId ? mealsById.get(mealId) : null;
    if (mealId && !meal) return; // ignore unknown
    if (!prior || prior.removedAt) {
      // Was empty (or removed) — fresh add
      if (!meal) return; // can't add "no meal"
      setPendingOp((p) => ({
        ...p,
        add: [
          ...p.add.filter((op) => op.slotKey !== slotKey),
          {
            slotKey,
            mealId: meal.id,
            mealName: meal.name,
            price: meal.price
          }
        ],
        change: p.change.filter((op) => op.slotKey !== slotKey),
        remove: p.remove.filter((op) => op.slotKey !== slotKey)
      }));
    } else {
      // Had a live entry — change (set to new meal) or remove (no meal)
      if (!meal) {
        setPendingOp((p) => ({
          ...p,
          add: p.add.filter((op) => op.slotKey !== slotKey),
          change: p.change.filter((op) => op.slotKey !== slotKey),
          remove: [...p.remove.filter((op) => op.slotKey !== slotKey), { slotKey }]
        }));
      } else if (prior.mealId === meal.id) {
        // Same meal — drop any pending
        setPendingOp((p) => ({
          ...p,
          add: p.add.filter((op) => op.slotKey !== slotKey),
          change: p.change.filter((op) => op.slotKey !== slotKey),
          remove: p.remove.filter((op) => op.slotKey !== slotKey)
        }));
      } else {
        setPendingOp((p) => ({
          ...p,
          add: p.add.filter((op) => op.slotKey !== slotKey),
          remove: p.remove.filter((op) => op.slotKey !== slotKey),
          change: [
            ...p.change.filter((op) => op.slotKey !== slotKey),
            {
              slotKey,
              mealId: meal.id,
              mealName: meal.name,
              price: meal.price
            }
          ]
        }));
      }
    }
  };

  // ---------- Serve toggle handlers ----------

  const handleToggleServe = async (slotKey: string, wasServed: boolean) => {
    const entry = existingSelections[slotKey];
    if (!entry || entry.removedAt) {
      toast.error(
        "No meal to mark served",
        "Add a meal to this slot first."
      );
      return;
    }
    setServeBusySlot(slotKey);
    const action: "serve" | "unserve" = wasServed ? "unserve" : "serve";
    const reason = null;
    const res = await markBreakfastServed({
      bookingId: booking.id,
      slotKey,
      action,
      reason
    });
    setServeBusySlot(null);
    if (!res.success) {
      // The beyond-grace un-serve surfaces a specific
      // human message — let the staff click into the
      // modal-style flow rather than via the inline
      // quick-reason prompt.
      toast.error(action === "serve" ? "Failed to mark served" : "Failed to un-mark served", res.error || "Please try again.");
      return;
    }
    setPendingServe((p) => [
      ...p.filter((x) => x.slotKey !== slotKey),
      { slotKey, action, reason }
    ]);
    // Also optimistically drop any pending remove on
    // this slot (the kitchen already plated it).
    if (action === "serve") {
      setPendingOp((p) => ({
        ...p,
        remove: p.remove.filter((op) => op.slotKey !== slotKey)
      }));
    }
    toast.success(
      action === "serve" ? "Marked served" : "Marked un-served",
      action === "serve"
        ? "The kitchen has plated this meal."
        : "Status reset to not-served."
    );
  };

  // ---------- Mark refund as paid handler ----------

  const handleMarkRefundPaid = async (refundId: string) => {
    setRefundBusyId(refundId);
    const res = await markBreakfastRefundPaid({
      bookingId: booking.id,
      refundId,
      method: "cash",
      transactionReference: null,
      note: null
    });
    setRefundBusyId(null);
    if (!res.success) {
      toast.error("Failed to mark refund paid", res.error || "Please try again.");
      return;
    }
    setPendingRefundPaid((p) => [...p, { refundId, method: "cash", transactionReference: null, note: null }]);
    toast.success("Refund marked paid", "Recorded against the booking's refund ledger.");
  };

  // ---------- Save handlers ----------

  const prepareSave = () => {
    if (saving) return;
    if (pendingOp.add.length + pendingOp.change.length + pendingOp.remove.length === 0) {
      toast.info("No changes to save", "You haven't edited any meal yet.");
      return;
    }
    if (lockedDates.length > 0) {
      // Open the override modal so the staff can supply a
      // free-text reason + we collect the locked-date list
      // for the banner.
      setOverrideModal({
        open: true,
        lockedDates,
        reason: ""
      });
      return;
    }
    void doSave(false, null);
  };

  const doSave = async (overrideCutoff: boolean, overrideReason: string | null) => {
    setSaving(true);
    try {
      const res = await staffUpdateBreakfast({
        bookingId: booking.id,
        add: pendingOp.add,
        change: pendingOp.change,
        remove: pendingOp.remove,
        overrideCutoff,
        overrideReason
      });
      if (!res.success) {
        toast.error("Failed to save breakfast changes", res.error || "Please try again.");
        return;
      }
      toast.success("Breakfast changes saved", `${res.data?.opsApplied || 0} op(s) applied.`);
      setPendingOp({ add: [], change: [], remove: [] });
      if (overrideModal?.open) {
        setOverrideModal(null);
      }
      if (onAfterSave) await onAfterSave();
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmOverride = () => {
    const reason = (overrideModal?.reason || "").trim();
    if (reason.length < MIN_BREAKFAST_OVERRIDE_REASON_LENGTH) {
      toast.error(
        "Reason too short",
        `Minimum ${MIN_BREAKFAST_OVERRIDE_REASON_LENGTH} characters — explain the late change.`
      );
      return;
    }
    setOverrideModal(null);
    void doSave(true, reason);
  };

  // ---------- Render ----------

  if (configLoading) {
    return (
      <div className="space-y-4" data-testid="booking-drawer-breakfast-loading">
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading breakfast catalog…
        </div>
      </div>
    );
  }

  if (!config || !config.isEnabled) {
    return (
      <div className="rounded-card border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800" data-testid="booking-drawer-breakfast-disabled">
        <p className="font-bold">Breakfast is not enabled</p>
        <p className="mt-1 text-amber-700">
          Ask an admin to enable the breakfast service in Settings before editing meals.
        </p>
      </div>
    );
  }

  const lastModified = (booking as any).updatedAt
    ? (() => {
        const v = (booking as any).updatedAt;
        const d =
          typeof v?.toDate === "function" ? v.toDate() : new Date(v);
        return Number.isFinite(d.getTime()) ? d.toLocaleString() : "Not yet edited";
      })()
    : "Not yet edited";

  return (
    <div className="space-y-4" data-testid="booking-drawer-breakfast-tab">
      {/* Header */}
      <div className="flex flex-col gap-2 rounded-card border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-bold text-gray-950">
            Total: <span className="text-primary-dark">{formatPrice(pendingTotal)}</span>
          </p>
          <p className="text-[11px] text-gray-500">
            {pendingCount} meal{pendingCount === 1 ? "" : "s"} · Last edit {lastModified}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => firstDropdownRef.current?.focus()}
            className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-lg border border-gray-250 bg-white px-3 text-[11px] font-bold text-gray-700 hover:bg-gray-50"
          >
            Manage meals
          </button>
          <button
            type="button"
            onClick={prepareSave}
            disabled={saving || !dirty}
            className="inline-flex min-h-[36px] items-center justify-center gap-1 rounded-lg bg-primary px-3 text-[11px] font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Saving…
              </>
            ) : (
              "Save changes"
            )}
          </button>
        </div>
      </div>

      {/* Per-date × per-guest grid */}
      {breakfastDates.length === 0 ? (
        <div className="rounded-card border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500">
          No breakfast dates for this booking — check the check-in / check-out fields.
        </div>
      ) : (
        <div className="space-y-4">
          {breakfastDates.map((date) => {
            const locked = perDayLocked[date] === true;
            return (
              <section
                key={date}
                className={cn(
                  "rounded-card border p-4",
                  locked
                    ? "border-red-200 bg-red-50/40"
                    : "border-gray-200 bg-white"
                )}
                data-testid={`booking-drawer-breakfast-day-${date}`}
              >
                <header className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-bold text-gray-950">{date}</p>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                      locked
                        ? "bg-red-100 text-red-800"
                        : "bg-status-green-bg text-status-green-text"
                    )}
                  >
                    {locked ? (
                      <>
                        <AlertTriangle size={12} aria-hidden="true" /> Cutoff passed — late changes logged
                      </>
                    ) : (
                      <>Order by {date}, {String(config.cutoffTime || "20:00")}</>
                    )}
                  </span>
                </header>

                {locked && (
                  <div className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-[11px] text-red-700">
                    Cutoff has passed. Continuing will mark this as a late order/change for the kitchen and is logged.
                  </div>
                )}

                <ul className="mt-3 space-y-2">
                  {guestSlots.map((slot, slotIdx) => {
                    const slotKey = `${date}-${slot.id}`;
                    const existing = existingSelections[slotKey];
                    const served = existingServed[slotKey];
                    const hasMeal = existing && !existing.removedAt;
                    const isRemoved = existing && existing.removedAt;
                    const selectedMealId = pendingOp.change.find((op) => op.slotKey === slotKey)?.mealId
                      ?? pendingOp.add.find((op) => op.slotKey === slotKey)?.mealId
                      ?? existing?.mealId
                      ?? "";
                    const pendingRemove = pendingOp.remove.some((op) => op.slotKey === slotKey);
                    return (
                      <li
                        key={slotKey}
                        className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_auto] sm:items-center"
                        data-testid={`booking-drawer-breakfast-slot-${slotKey}`}
                      >
                        <p className="text-xs font-semibold text-gray-700">{slot.label}</p>
                        <div>
                          <select
                            ref={slotIdx === 0 ? firstDropdownRef : undefined}
                            value={selectedMealId}
                            onChange={(e) => handleSelectMeal(slotKey, e.target.value)}
                            className="min-h-[36px] w-full rounded-lg border border-gray-200 bg-white px-2 text-xs text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                          >
                            <option value="">No meal — skip</option>
                            {sortedMeals.map((meal) => (
                              <option key={meal.id} value={meal.id}>
                                {meal.name} — {formatPrice(meal.price)}
                              </option>
                            ))}
                          </select>
                          {(existing || pendingRemove) && (
                            <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-gray-500">
                              {pendingRemove ? (
                                "Will be removed on save."
                              ) : (
                                <>
                                  {selectedMealId
                                    ? `${mealsById.get(selectedMealId)?.name || "Meal"} · ${formatPrice(mealsById.get(selectedMealId)?.price || 0)}`
                                    : "Will be removed on save."}
                                </>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleServe(slotKey, Boolean(served))}
                            disabled={!hasMeal || serveBusySlot === slotKey}
                            className={cn(
                              "inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-3 text-[11px] font-bold",
                              served
                                ? "border-status-green-text/40 bg-status-green-bg text-status-green-text"
                                : "border-gray-250 bg-white text-gray-600 hover:border-gray-300",
                              !hasMeal && "cursor-not-allowed opacity-60"
                            )}
                          >
                            {serveBusySlot === slotKey ? (
                              <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                            ) : served ? (
                              <CheckCircle2 size={12} aria-hidden="true" />
                            ) : (
                              <Check size={12} aria-hidden="true" />
                            )}
                            {served ? "Served" : "Served"}
                          </button>
                          {served && (
                            <span className="text-[10px] text-gray-500">
                              {typeof (served as any).servedAt?.toDate === "function"
                                ? (served as any).servedAt.toDate().toLocaleTimeString()
                                : "served"}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {/* Refund liability panel (BR-05 + BR-06 extension) */}
      {/* Per BR-06 (#235, 2026-10-13): the BR-05 "Refunds due"
          panel is now the Refunds admin surface. It renders
          every refund row for the booking (any category, any
          status), with a category filter chip at the top
          ("All" / "Cancellation" / "Breakfast") + a
          "Breakfast" badge on breakfast-category rows. The
          legacy one-click "Mark as paid" handler is
          preserved for breakfast pending rows (the existing
          BR-05 button) + a new "Mark as paid (advanced)"
          link opens the modal that posts to the new
          `/api/refunds/mark-paid` endpoint. */}
      {pendingRefunds.length > 0 && (
        <section
          className="rounded-card border border-amber-200 bg-amber-50/50 p-4"
          data-testid="booking-drawer-breakfast-refunds"
        >
          <header className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-amber-700" aria-hidden="true" />
              <p className="text-xs font-bold uppercase tracking-wider text-amber-900">
                Refunds due
              </p>
            </div>
            {/* Category filter chip — per BR-06.
                Default "All" for back-compat with the
                pre-BR-06 view. */}
            <div
              className="inline-flex rounded-lg border border-amber-300 bg-white p-0.5 text-[10px] font-bold"
              role="group"
              aria-label="Filter refunds by category"
              data-testid="refund-category-filter"
            >
              {REFUND_CATEGORY_OPTIONS.map((option) => {
                const active = option.key === refundCategoryFilter;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setRefundCategoryFilter(option.key)}
                    aria-pressed={active}
                    data-testid={`refund-filter-${option.key}`}
                    className={
                      "min-h-[32px] rounded-md px-3 py-1 transition " +
                      (active
                        ? "bg-amber-700 text-white"
                        : "text-amber-800 hover:bg-amber-50")
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </header>
          <ul className="mt-3 space-y-2">
            {pendingRefunds
              .filter((r: any) => !pendingRefundPaid.some((p) => p.refundId === r.id))
              .filter((r: any) => {
                if (refundCategoryFilter === "all") return true;
                const category = String(r.category || "cancellation");
                return category === refundCategoryFilter;
              })
              .map((r: any) => {
                const category = String(r.category || "cancellation");
                const isBreakfast = category === "breakfast";
                const isPending = String(r.status || "pending") === "pending";
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-[11px]"
                    data-testid={`refund-row-${r.id}`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-gray-900">
                          {formatPrice(Math.abs(Number(r.amount || 0)))} refund due
                        </p>
                        {/* Category badge — per BR-06.
                            "Breakfast" badge in primary color
                            (amber to match the existing card);
                            "Cancellation" in gray. Legacy
                            `null` category reads as
                            "Cancellation" per BR-01. */}
                        <span
                          className={
                            isBreakfast
                              ? "rounded-full bg-amber-700 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
                              : "rounded-full bg-gray-200 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-gray-700"
                          }
                          data-testid={`refund-category-badge-${r.id}`}
                        >
                          {isBreakfast ? "Breakfast" : "Cancellation"}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-500">
                        Recorded by {r.recordedBy || "staff"} on{" "}
                        {r.recordedAt
                          ? (typeof r.recordedAt?.toDate === "function"
                              ? r.recordedAt.toDate()
                              : new Date(r.recordedAt)
                            ).toLocaleDateString()
                          : "—"}{" "}
                        · category: {category}
                      </p>
                    </div>
                    {/* Mark-as-paid actions. Two flavors:
                        (a) one-click "Mark as paid" — the
                        BR-05 prototype, hardcoded cash, posts
                        to the booking drawer's endpoint.
                        (b) "Mark as paid (advanced)" — opens
                        a modal that collects method + ref +
                        note + posts to the new `/api/refunds/mark-paid`
                        endpoint via the BR-06 unified
                        `markRefundPaid` helper. Both flows
                        exist so back-compat with the existing
                        BR-05 UI is preserved. */}
                    {isBreakfast && isPending && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleMarkRefundPaid(r.id)}
                          disabled={refundBusyId === r.id}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 text-[11px] font-bold text-amber-800 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {refundBusyId === r.id ? (
                            <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                          ) : (
                            <CheckCircle2 size={12} aria-hidden="true" />
                          )}
                          Mark as paid
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setMarkRefundPaidModal({
                              open: true,
                              refundId: r.id,
                              amount: Math.abs(Number(r.amount || 0))
                            })
                          }
                          data-testid={`refund-mark-paid-advanced-${r.id}`}
                          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-300 bg-amber-700 px-3 text-[11px] font-bold text-white transition hover:bg-amber-800"
                        >
                          Mark as paid (advanced)
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
          </ul>
          {/* Standalone Mark-as-paid modal (BR-06).
              Posts to `/api/refunds/mark-paid`. On
              success the row updates in place (the
              `pendingRefundPaid` optimistic list drops
              the entry from the visible list). */}
          <Modal
            open={markRefundPaidModal.open}
            onClose={() => setMarkRefundPaidModal({ open: false, refundId: null, amount: 0 })}
            title="Mark breakfast refund as paid"
            footer={null}
          >
            {markRefundPaidModal.open && markRefundPaidModal.refundId && (
              <MarkRefundPaidAdvancedForm
                bookingId={booking.id}
                refundId={markRefundPaidModal.refundId}
                amount={markRefundPaidModal.amount}
                onSuccess={() => {
                  setMarkRefundPaidModal({ open: false, refundId: null, amount: 0 });
                  setPendingRefundPaid((p) => [
                    ...p.filter((x) => x.refundId !== markRefundPaidModal.refundId),
                    {
                      refundId: markRefundPaidModal.refundId as string,
                      method: "cash",
                      transactionReference: null,
                      note: null
                    }
                  ]);
                  toast.success("Refund marked paid", "Recorded against the booking's refund ledger.");
                }}
                onCancel={() => setMarkRefundPaidModal({ open: false, refundId: null, amount: 0 })}
              />
            )}
          </Modal>
        </section>
      )}

      {/* Override modal — locked-date late changes */}
      <BreakfastTabModal
        title="Late breakfast change"
        open={Boolean(overrideModal?.open)}
        onClose={() => setOverrideModal(null)}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setOverrideModal(null)}
              className="inline-flex min-h-[40px] items-center rounded-lg border border-gray-250 px-4 text-xs font-bold text-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmOverride}
              disabled={(overrideModal?.reason || "").trim().length < MIN_BREAKFAST_OVERRIDE_REASON_LENGTH}
              className="inline-flex min-h-[40px] items-center rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save with override
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-xs text-gray-700">
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800">
            These dates have already crossed the breakfast cutoff:{" "}
            <strong>{overrideModal?.lockedDates.join(", ")}</strong>. Continuing will
            mark every op as a late change; the kitchen list's "Late
            changes" column (BR-07) will surface them. A reason is required.
          </p>
          <label className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              Override reason (min {MIN_BREAKFAST_OVERRIDE_REASON_LENGTH} characters)
            </span>
            <textarea
              value={overrideModal?.reason || ""}
              onChange={(e) =>
                setOverrideModal((p) => (p ? { ...p, reason: e.target.value } : null))
              }
              rows={3}
              className="min-h-[80px] w-full rounded-lg border border-gray-250 bg-white px-3 py-2 text-xs"
              placeholder="e.g. Guest checked in late and asked for tomorrow's breakfast."
            />
          </label>
        </div>
      </BreakfastTabModal>
    </div>
  );
}

// Per BR-06 (decision #235, 2026-10-13): the standalone
// "Mark as paid" modal body used by the Refunds admin
// surface. Collects the payment method + transaction
// reference + note and posts to the unified
// `/api/refunds/mark-paid` endpoint (which delegates
// to `markRefundPaid` in `server/lib/refunds.ts`).
// Mirrors the existing `markBreakfastRefundPaid` context
// helper's URL contract but routes through the BR-06
// public route (so the staff drawer doesn't have to
// reach into the staff-app fetch wrapper).
//
// Payment method options are sourced from the same
// `storePaymentMethods` utility the calendar +
// settings surface use; the BR-06 spec defers the
// server-side method validation to the existing
// per-method catalog at `paymentMethodLabel.ts`.
const REFUND_PAID_METHODS = ["cash", "gcash", "bank-transfer", "card"] as const;

interface MarkRefundPaidAdvancedFormProps {
  bookingId: string;
  refundId: string;
  amount: number;
  onSuccess: () => void;
  onCancel: () => void;
}

function MarkRefundPaidAdvancedForm({
  bookingId,
  refundId,
  amount,
  onSuccess,
  onCancel
}: MarkRefundPaidAdvancedFormProps) {
  const toast = useToast();
  const [method, setMethod] = useState<string>("cash");
  const [transactionReference, setTransactionReference] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    const result = await postMarkRefundPaid({
      bookingId,
      refundId,
      method,
      transactionReference: transactionReference.trim() || null,
      note: note.trim() || null
    });
    setSubmitting(false);
    if (!result.success) {
      toast.error("Failed to mark refund paid", result.error || "Please try again.");
      return;
    }
    onSuccess();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-testid="mark-refund-paid-advanced-form">
      <p className="text-[11px] text-gray-500">
        Recording a payment of {formatPrice(amount)} against the breakfast refund liability.
      </p>
      <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        Method
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-3 text-xs text-gray-900 outline-none"
          data-testid="mark-refund-paid-method"
        >
          {REFUND_PAID_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        Transaction reference (optional)
        <input
          value={transactionReference}
          onChange={(e) => setTransactionReference(e.target.value)}
          maxLength={200}
          className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-3 text-xs text-gray-900 outline-none"
          placeholder="e.g. bank slip number"
        />
      </label>
      <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        Note (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          rows={2}
          className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-3 py-2 text-xs text-gray-900 outline-none"
          placeholder="e.g. refunded via bank transfer"
        />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-gray-250 bg-white px-3 text-[11px] font-bold text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-amber-700 px-4 text-[11px] font-bold text-white hover:bg-amber-800 disabled:opacity-60"
        >
          {submitting ? "Submitting..." : "Mark as paid"}
        </button>
      </div>
    </form>
  );
}
