// ATR-08 follow-up (2026-11-21, `plan/features/AUDIT-TRAIL.md`): the
// booking drawer's HISTORY tab.
//
// WHAT IT SHOWS: one reverse-chronological timeline of who changed
// what on THIS booking, and when. It merges four sources:
//
//   - the breakfast trail   (`bookings/{id}/breakfastAudit`)
//   - the other-add-on trail (`bookings/{id}/otherAddOnAudit`)
//   - the incidental-charge ledger (already loaded by the drawer)
//   - the booking's own milestone stamps (created / checked in /
//     checked out / cancelled / payment verified / special requests)
//
// WHO IT IS FOR: the front desk. Every row resolves its actor to a
// NAME through the ONE shared resolver (`shared/utils/staffNames.ts`) —
// a raw 28-character uid tells a desk user nothing (GOTCHAS §Security
// & PII).
//
// WHAT IT IS NOT: the ATR-02 forensic trail. The booking MUTATIONS
// (confirm / cancel / reschedule / payment verify / discount verify)
// do not write event rows yet, so this tab is a history of the
// operational changes, not a complete audit of every field write. The
// tab says so in its own copy rather than implying a completeness it
// does not have.

import { useMemo } from "react";
import { History, Receipt, Utensils, Sparkles, LogIn, LogOut, CreditCard } from "lucide-react";
import { useAdmin, type Booking, type IncidentalCharge } from "../context/AdminContext";
import {
  bookingHistoryActorLabel,
  bookingMilestoneEvents,
  buildStaffNameMap,
  incidentalChargeEvent,
  mergeBookingHistoryEvents,
  type BookingHistoryEvent
} from "@spark-inn/shared";
import { useBookingHistory } from "../hooks/useBookingHistory";
import { formatPrice } from "../utils/format";

interface BookingHistoryTabProps {
  booking: Booking;
  /** The drawer's already-loaded incidental charges (reservation-scoped). */
  charges: IncidentalCharge[];
  /** Only read the trails while the History section is actually visible. */
  active: boolean;
}

/** The icon that marks each kind of event. */
function EventIcon({ event }: { event: BookingHistoryEvent }) {
  const className = "h-3.5 w-3.5";
  switch (event.kind) {
    case "breakfast-change":
      return <Utensils size={14} className={className} aria-hidden="true" />;
    case "add-on-change":
      return <Sparkles size={14} className={className} aria-hidden="true" />;
    case "charge":
      return <Receipt size={14} className={className} aria-hidden="true" />;
    case "checked-in":
      return <LogIn size={14} className={className} aria-hidden="true" />;
    case "checked-out":
      return <LogOut size={14} className={className} aria-hidden="true" />;
    case "payment-confirmed":
    case "payment-rejected":
      return <CreditCard size={14} className={className} aria-hidden="true" />;
    default:
      return <History size={14} className={className} aria-hidden="true" />;
  }
}

/** `Nov 20, 2:14 PM` — the admin app's existing timestamp convention. */
function formatEventTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

/** `Nov 20` — the service date a breakfast / add-on change applies to. */
function formatServiceDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function BookingHistoryTab({ booking, charges, active }: BookingHistoryTabProps) {
  const { staff } = useAdmin();
  const staffNameMap = useMemo(() => buildStaffNameMap(staff), [staff]);
  const { events: trailEvents, loading, error } = useBookingHistory(booking.id, active);

  const chargeEvents = useMemo(
    () =>
      charges
        .map((charge) => incidentalChargeEvent(charge, charge.id))
        .filter((event): event is BookingHistoryEvent => Boolean(event)),
    [charges]
  );

  const milestoneEvents = useMemo(() => bookingMilestoneEvents(booking), [booking]);

  const timeline = useMemo(
    () => mergeBookingHistoryEvents(trailEvents, chargeEvents, milestoneEvents),
    [trailEvents, chargeEvents, milestoneEvents]
  );

  /**
   * The role chip for an event.
   *
   * The trail rows carry their OWN `actorRole` (guest / front-desk /
   * admin) — that is the authoritative discriminator, because a guest's
   * row says "guest" even though the guest is not on the staff list.
   * For the charges and the milestones, which carry only a uid, the
   * role comes from the staff record.
   */
  const roleLabel = (event: BookingHistoryEvent): string => {
    if (event.actorRole) {
      return event.actorRole === "front-desk"
        ? "Front Desk"
        : event.actorRole.charAt(0).toUpperCase() + event.actorRole.slice(1);
    }
    if (event.actorUid) {
      const member = staff.find((entry) => entry.uid === event.actorUid);
      if (member) return member.role === "front-desk" ? "Front Desk" : "Admin";
    }
    return "Staff";
  };

  // The undated stamps the drawer header's provenance line does not
  // cover. They are shown as a caption, NOT as timeline rows — a row
  // with no date would read as "the most recent thing that happened",
  // which is a lie.
  const discountVerifier = booking.discountVerified
    ? booking.discountVerifiedBy
      ? staffNameMap.get(booking.discountVerifiedBy) || "Staff"
      : null
    : null;

  return (
    <section
      data-testid="booking-history-tab"
      className="rounded-card border border-gray-200 bg-white p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
            <History size={14} className="text-primary" />
            Activity history
          </h3>
          <p className="mt-1 text-[11px] text-gray-500">
            Who changed this booking, and when.
          </p>
        </div>
        {!loading && timeline.length > 0 && (
          <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-600">
            {timeline.length} {timeline.length === 1 ? "entry" : "entries"}
          </span>
        )}
      </div>

      {discountVerifier && (
        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-600">
          Discount verified by{" "}
          <span className="font-semibold text-gray-800">{discountVerifier}</span>
        </p>
      )}

      {error && (
        <p
          data-testid="booking-history-error"
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800"
        >
          {error}
        </p>
      )}

      {loading && (
        <div data-testid="booking-history-skeleton" className="mt-4 space-y-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="flex gap-3">
              <span className="mt-1 h-2 w-2 shrink-0 animate-pulse rounded-full bg-gray-200" />
              <div className="flex-1 space-y-1.5">
                <span className="block h-2.5 w-1/3 animate-pulse rounded bg-gray-100" />
                <span className="block h-2.5 w-2/3 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && timeline.length === 0 && (
        <p
          data-testid="booking-history-empty"
          className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-4 text-[11px] leading-relaxed text-gray-500"
        >
          Nothing recorded yet. Breakfast changes, add-on changes, incidental
          charges and check-ins appear here as they happen.
        </p>
      )}

      {!loading && timeline.length > 0 && (
        <ol data-testid="booking-history-list" className="mt-4 space-y-0">
          {timeline.map((event, index) => {
            const actor = bookingHistoryActorLabel(event, staffNameMap);
            const isGuest = event.actorRole === "guest";
            const details: string[] = [];
            if (event.subject) details.push(event.subject);
            if (event.serviceDate) details.push(formatServiceDate(event.serviceDate));
            if (event.guestIndex !== null) details.push(`Guest ${event.guestIndex + 1}`);
            if (event.quantity !== null && event.quantity > 1) {
              details.push(`×${event.quantity}`);
            }

            return (
              <li
                key={`${event.kind}-${event.id}-${index}`}
                data-testid="booking-history-row"
                className="relative flex gap-3 pb-4 last:pb-0"
              >
                <span
                  aria-hidden="true"
                  className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    isGuest ? "bg-gray-100 text-gray-500" : "bg-primary-light text-primary"
                  }`}
                >
                  <EventIcon event={event} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
                    <span className="font-semibold text-gray-900">{actor}</span>
                    <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-gray-500">
                      {roleLabel(event)}
                    </span>
                    {event.lateChange && (
                      <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700">
                        Late change
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-gray-800">
                    {event.summary}
                    {event.kind === "charge" && event.amount !== null && (
                      <span
                        className={`ml-1.5 font-bold ${
                          event.amount < 0 ? "text-red-600" : "text-gray-900"
                        }`}
                      >
                        {formatPrice(event.amount)}
                      </span>
                    )}
                  </p>
                  {details.length > 0 && (
                    <p className="mt-0.5 text-[11px] text-gray-500">
                      {details.join(" · ")}
                    </p>
                  )}
                  {event.reason && (
                    <p className="mt-0.5 text-[11px] italic text-gray-500">
                      “{event.reason}”
                    </p>
                  )}
                  {event.note && !event.reason && (
                    <p className="mt-0.5 text-[11px] text-gray-500">{event.note}</p>
                  )}
                  {event.at && (
                    <p className="mt-1 text-[10px] text-gray-400">
                      {formatEventTime(event.at)}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
