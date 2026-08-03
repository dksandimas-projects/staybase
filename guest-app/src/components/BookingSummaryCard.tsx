import { BedDouble, CalendarDays, Users } from "lucide-react";
import { formatPrice } from "../utils/format";

interface BookingSummaryCardProps {
  roomName: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  // Per EXB-08 (2026-08-01, per decision #156): the
  // orphan card now accepts the adult/child split
  // + the extra bed count. The shape is optional +
  // nullable so legacy callers (e.g. older
  // pre-EXB-08 imports) keep working unchanged. When
  // both fields are present, the guests line shows
  // the split ("2 adults + 1 child (3 total)") + the
  // extra bed count when > 0 ("+ 1 extra bed"). When
  // absent, the line degrades to the historical
  // "{guests} guests" form (byte-equivalent to the
  // pre-EXB-08 shape).
  numAdults?: number;
  numChildren?: number;
  extraBedCount?: number;
  extraBedRate?: number;
  nights: number;
  ratePerNight: number;
  total: number;
}

export function BookingSummaryCard({
  roomName,
  checkIn,
  checkOut,
  guests,
  numAdults,
  numChildren,
  extraBedCount,
  extraBedRate,
  nights,
  ratePerNight,
  total
}: BookingSummaryCardProps) {
  // Per EXB-08 (2026-08-01, per decision #156): the
  // guest line below uses the same split + extra bed
  // shape as the live /my-booking card in
  // `BookingLookupPage.tsx` (the orphan's sibling).
  // The card stays a "summary" — no rate breakdown,
  // no email, no extra bed total — but the
  // occupancy breakdown is byte-equivalent to the
  // live card so a future page that imports the
  // orphan gets the same EXB-08 UX for free.
  const numAdultsIsValid = Number.isFinite(Number(numAdults));
  const numChildrenIsValid = Number.isFinite(Number(numChildren));
  const showSplit = numAdultsIsValid && numChildrenIsValid
    && (Number(numAdults) > 0 || Number(numChildren) > 0);
  const extraBedCountValue = Number(extraBedCount) || 0;
  const showExtraBeds = Number.isFinite(extraBedCountValue) && extraBedCountValue > 0;
  return (
    <aside className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <h2 className="text-lg font-semibold text-gray-950">Booking summary</h2>
      <div className="mt-5 space-y-4 text-sm text-gray-600">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500">Room</p>
          <p className="mt-1 font-medium text-gray-950">{roomName}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <span className="flex gap-2 rounded-lg bg-gray-50 p-3">
            <CalendarDays size={16} className="mt-0.5 text-primary" />
            <span>
              <span className="block text-xs text-gray-500">Check-in</span>
              {checkIn}
            </span>
          </span>
          <span className="flex gap-2 rounded-lg bg-gray-50 p-3">
            <CalendarDays size={16} className="mt-0.5 text-primary" />
            <span>
              <span className="block text-xs text-gray-500">Check-out</span>
              {checkOut}
            </span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Users size={16} className="text-primary" />
          {showSplit ? (
            <span title={`${guests} guest${guests === 1 ? "" : "s"} total`}>
              {Number(numAdults)} adult{Number(numAdults) === 1 ? "" : "s"} + {Number(numChildren)} child{Number(numChildren) === 1 ? "" : "ren"} ({guests} total)
            </span>
          ) : (
            <span>{guests} guests, {nights} nights</span>
          )}
        </div>
        {showSplit && showExtraBeds ? (
          <div className="flex items-center gap-2 text-xs text-gray-600">
            <BedDouble size={14} className="text-primary" />
            <span>
              + {extraBedCountValue} extra bed{extraBedCountValue === 1 ? "" : "s"}
              {Number.isFinite(Number(extraBedRate)) && Number(extraBedRate) > 0
                ? ` (${formatPrice(Number(extraBedRate))} / bed / night)`
                : ""}
            </span>
          </div>
        ) : null}
        <div className="border-t border-gray-200 pt-4">
          <div className="flex justify-between">
            <span>Rate per night</span>
            <span>{formatPrice(ratePerNight)}</span>
          </div>
          <div className="mt-3 flex justify-between text-base font-semibold text-gray-950">
            <span>Total</span>
            <span>{formatPrice(total)}</span>
          </div>
        </div>
      </div>
    </aside>
  );
}
