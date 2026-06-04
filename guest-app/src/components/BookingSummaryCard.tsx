import { CalendarDays, Users } from "lucide-react";
import { formatPrice } from "../utils/format";

interface BookingSummaryCardProps {
  roomName: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  nights: number;
  ratePerNight: number;
  total: number;
}

export function BookingSummaryCard({
  roomName,
  checkIn,
  checkOut,
  guests,
  nights,
  ratePerNight,
  total
}: BookingSummaryCardProps) {
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
          {guests} guests, {nights} nights
        </div>
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
