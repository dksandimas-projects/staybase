import { useEffect, useState, type ReactNode } from "react";
import {
  BedDouble,
  Check,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  Loader2,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Save,
  User,
  XCircle
} from "lucide-react";
import type { Booking } from "../context/AdminContext";
import { useAdmin } from "../context/AdminContext";
import { getLatestPaymentReference } from "@spark-inn/shared";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";
import { useToast } from "./Toast";
import { StatusBadge } from "./StatusBadge";

export type BookingDrawerSection = "overview" | "check-in" | "folio" | "more";

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
              <span>{booking.hasBreakfast ? "Breakfast included" : "No breakfast"}</span>
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
        <div className="grid min-w-[340px] grid-cols-4 gap-1" role="tablist">
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
