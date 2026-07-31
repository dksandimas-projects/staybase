import type { ReactNode } from "react";
import {
  BedDouble,
  Check,
  ClipboardCheck,
  CreditCard,
  LayoutDashboard,
  Mail,
  MoreHorizontal,
  Phone,
  User,
  XCircle
} from "lucide-react";
import type { Booking } from "../context/AdminContext";
import { getLatestPaymentReference } from "@spark-inn/shared";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";
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
  paymentMethodLabel
}: BookingDrawerWorkspaceHeaderProps) {
  const needsPaymentReview = booking.status === "payment-uploaded";
  const needsEarlyCheckInReview = booking.earlyCheckIn?.status === "requested";
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
              <span>{booking.numGuests} guest{booking.numGuests === 1 ? "" : "s"}</span>
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
                {getLatestPaymentReference(booking) || (
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
