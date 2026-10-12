// Per SR-01..05 (2026-10-12): the read-only "Guest special
// requests" block rendered in the booking drawer. Shows the
// guest-set fields captured at booking time:
//
//   • bed setup per room (each booking doc carries its own
//     `bedSetup` snapshot; multi-room reservations render
//     one row per child room)
//   • additional preferences (chips keyed off the
//     admin-configured `settings/hotelConfig.bookingPreferences`
//     catalog)
//   • additional request (free-text, the guest's
//     "Any additional requests?" textarea)
//   • expected arrival time (the dropdown's
//     `HH:MM` value, or the "I don't know" sentinel)
//
// This component is intentionally read-only. The
// `BookingSpecialRequestsEditor` (separate component,
// installed per `feat/staff-special-requests-capture`) is
// the staff-only editor for the `Booking.specialRequests`
// field — the staff-captured equivalent of the guest's
// free-text payload, surfaced as a follow-up edit when the
// guest phones or emails after the booking is made.
import { useEffect, useState } from "react";
import {
  ADDITIONAL_REQUEST_MAX_LENGTH,
  type BedSetupOption,
  type BookingPreferenceOption
} from "@spark-inn/shared";
import { BedDouble, CalendarClock, MessageSquareText, ScrollText } from "lucide-react";

interface GuestSpecialRequestsBlockProps {
  // The per-room booking snapshots. The drawer
  // already shows this booking — pass the array
  // when the surface has access to the
  // multi-room shape.
  bookings: Array<{
    id: string;
    roomNumber?: string;
    roomType?: string;
    bedSetup?: string | null;
  }>;
  // The reservation-level fields.
  additionalPreferences: string[];
  additionalRequest: string;
  expectedArrivalTime: string | null;
  // The admin-configured catalogs (needed to render
  // the human-readable labels for the preference
  // chips + bed setup).
  bedSetupsCatalog: BedSetupOption[];
  bookingPreferencesCatalog: BookingPreferenceOption[];
}

// Per SR-01..05 (2026-10-12): render an `HH:MM` value
// as a 12h label matching the guest's dropdown.
function formatArrivalLabel(hhmm: string): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!match) return hhmm;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const reference = new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).format(reference);
}

export function GuestSpecialRequestsBlock({
  bookings,
  additionalPreferences,
  additionalRequest,
  expectedArrivalTime,
  bedSetupsCatalog,
  bookingPreferencesCatalog
}: GuestSpecialRequestsBlockProps) {
  // Per SR-01..05 (2026-10-12): the read-only block
  // is only rendered when the reservation carries at
  // least one of the new fields. Pre-SR reservations
  // (the staff-captured-only era) don't surface here
  // at all — the staff `BookingSpecialRequestsEditor`
  // below remains the source of truth for those.
  const hasAnyBedSetup = bookings.some(
    (booking) => typeof booking.bedSetup === "string" && booking.bedSetup.trim().length > 0
  );
  const hasPreferences = additionalPreferences.length > 0;
  const hasRequest = additionalRequest.trim().length > 0;
  const hasArrival = expectedArrivalTime !== null;
  const hasAny = hasAnyBedSetup || hasPreferences || hasRequest || hasArrival;
  const [collapsed, setCollapsed] = useState(false);

  // Hide entirely when the booking carries no
  // guest-set special-request data. Stops pre-SR
  // reservations from rendering an empty card.
  if (!hasAny) return null;

  // Per SR-01..05 (2026-10-12): re-collapsed whenever
  // the booking id changes — same pattern the staff
  // `BookingSpecialRequestsEditor` uses to reset
  // cleanly between two drawer opens.
  useEffect(() => {
    setCollapsed(false);
  }, [bookings.map((b) => b.id).join(",")]);

  return (
    <section className="rounded-card border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-xs font-semibold text-gray-700">
            <ScrollText size={14} className="text-primary" />
            Guest special requests
          </h3>
          <p className="mt-1 text-[10px] text-gray-500">
            Captured on the public booking Step 2. The staff `Special requests`
            editor below records follow-up requests from email or phone — both
            surfaces stay in sync.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((open) => !open)}
          className="text-[11px] font-semibold text-primary hover:underline"
          aria-expanded={!collapsed}
        >
          {collapsed ? "Show" : "Hide"}
        </button>
      </header>

      {collapsed ? null : (
        <div className="space-y-3 text-xs">
          {hasAnyBedSetup ? (
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-gray-700">
                <BedDouble size={12} className="text-primary" /> Bed set-up
              </p>
              <ul className="space-y-1">
                {bookings
                  .filter((booking) =>
                    typeof booking.bedSetup === "string" && booking.bedSetup.trim().length > 0
                  )
                  .map((booking) => {
                    const option = bedSetupsCatalog.find((b) => b.value === booking.bedSetup);
                    const label = option?.label ?? booking.bedSetup;
                    return (
                      <li
                        key={booking.id}
                        className="flex items-start justify-between gap-2 rounded border border-gray-100 bg-gray-50 px-2 py-1.5"
                      >
                        <span className="font-medium text-gray-800">{label}</span>
                        <span className="text-[10px] text-gray-500">
                          {booking.roomNumber
                            ? `Room ${booking.roomNumber}`
                            : booking.roomType ?? ""}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ) : null}

          {hasPreferences ? (
            <div className="space-y-1">
              <p className="flex items-center gap-1 text-[11px] font-semibold text-gray-700">
                <MessageSquareText size={12} className="text-primary" /> Additional
                preferences
              </p>
              <div className="flex flex-wrap gap-1.5">
                {additionalPreferences.map((key) => {
                  const option = bookingPreferencesCatalog.find((p) => p.value === key);
                  return (
                    <span
                      key={key}
                      className="inline-flex items-center gap-1 rounded-full bg-primary-light px-2 py-1 text-[11px] font-semibold text-gray-800"
                    >
                      {option?.label ?? key}
                      {option?.surchargeNote ? (
                        <span className="font-normal text-gray-500">
                          {option.surchargeNote}
                        </span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}

          {hasRequest ? (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-gray-700">Any additional requests</p>
              <blockquote className="rounded border border-gray-100 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-700">
                {additionalRequest.trim()}
              </blockquote>
              <p className="text-[10px] text-gray-400">
                {additionalRequest.trim().length} / {ADDITIONAL_REQUEST_MAX_LENGTH} characters
              </p>
            </div>
          ) : null}

          <p className="flex items-center gap-1 text-[11px] text-gray-600">
            <CalendarClock size={12} className="text-primary" />
            Expected arrival:{" "}
            <strong>
              {expectedArrivalTime === null ? "I don't know" : formatArrivalLabel(expectedArrivalTime)}
            </strong>
          </p>
        </div>
      )}
    </section>
  );
}