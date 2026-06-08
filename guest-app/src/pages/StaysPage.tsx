import { Link } from "react-router-dom";
import { Calendar, MapPin, Sparkles, ArrowRight, History, HelpCircle } from "lucide-react";
import config from "@config";
import { AccountLayout } from "../components/AccountLayout";
import { StatusBadge } from "../components/StatusBadge";
import { formatPrice } from "../utils/format";
import { GhostButton } from "../components/GhostButton";

interface StayRecord {
  id: string;
  bookingRef: string;
  roomName: string;
  roomNumber: string;
  checkIn: string;
  checkOut: string;
  numNights: number;
  totalPrice: number;
  points: number;
  status: "confirmed" | "checked-out" | "cancelled";
  statusLabel: string;
  imageUrl: string;
}

const mockStays: StayRecord[] = [
  {
    id: "stay-1",
    bookingRef: "SI-09214",
    roomName: "The Riverview Suite",
    roomNumber: "305",
    checkIn: "Oct 12, 2026",
    checkOut: "Oct 15, 2026",
    numNights: 3,
    totalPrice: 13500,
    points: 480,
    status: "confirmed",
    statusLabel: "Confirmed",
    imageUrl: "https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&q=80&w=600&h=400"
  },
  {
    id: "stay-2",
    bookingRef: "SI-08103",
    roomName: "Garden Sanctuary Villa",
    roomNumber: "102",
    checkIn: "Aug 05, 2025",
    checkOut: "Aug 09, 2025",
    numNights: 4,
    totalPrice: 30000,
    points: 800,
    status: "checked-out",
    statusLabel: "Checked Out",
    imageUrl: "https://images.unsplash.com/photo-1582719508461-905c673771fd?auto=format&fit=crop&q=80&w=600&h=400"
  },
  {
    id: "stay-3",
    bookingRef: "SI-07524",
    roomName: "Sky Loft",
    roomNumber: "401",
    checkIn: "Jul 10, 2025",
    checkOut: "Jul 12, 2025",
    numNights: 2,
    totalPrice: 11000,
    points: 0,
    status: "cancelled",
    statusLabel: "Cancelled",
    imageUrl: "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=600&h=400"
  }
];

export function StaysPage() {
  const memberEmail = "member@sparkinn.com";
  const upcomingStays = mockStays.filter(stay => stay.status === "confirmed");
  const pastStays = mockStays.filter(stay => stay.status !== "confirmed");

  return (
    <AccountLayout
      activeTab="stays"
      title="My Stays"
      subtitle={`Review your upcoming check-ins and past stays at ${config.brandName}.`}
    >
      <div className="space-y-10">
        {/* Upcoming Stays Section */}
        <div>
          <h2 className="text-xl font-heading text-gray-950 mb-5 flex items-center gap-2">
            <Sparkles className="text-primary" size={20} />
            Upcoming Trips
          </h2>

          {upcomingStays.length > 0 ? (
            <div className="space-y-6">
              {upcomingStays.map((stay) => (
                <div
                  key={stay.id}
                  className="rounded-card bg-white overflow-hidden shadow-sm ring-1 ring-gray-200 grid md:grid-cols-[240px_1fr] transition hover:shadow-md"
                >
                  {/* Left Column: Image */}
                  <div className="relative h-48 md:h-full min-h-[160px] overflow-hidden bg-gray-100">
                    <img
                      src={stay.imageUrl}
                      alt={stay.roomName}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute top-3 left-3">
                      <StatusBadge label={stay.statusLabel} status={stay.status} />
                    </div>
                  </div>

                  {/* Right Column: Content */}
                  <div className="p-6 flex flex-col justify-between gap-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                            Booking Ref: {stay.bookingRef}
                          </p>
                          <h3 className="font-heading text-2xl text-gray-950 mt-0.5 lowercase tracking-tight">
                            {stay.roomName}
                          </h3>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-500">Total Price</p>
                          <p className="text-lg font-bold text-gray-900">{formatPrice(stay.totalPrice)}</p>
                        </div>
                      </div>

                      {/* Stay details */}
                      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 text-sm text-gray-600">
                        <p className="flex items-center gap-2">
                          <Calendar size={16} className="text-primary shrink-0" />
                          <span>{stay.checkIn} — {stay.checkOut} ({stay.numNights} nights)</span>
                        </p>
                        <p className="flex items-center gap-2">
                          <MapPin size={16} className="text-primary shrink-0" />
                          <span>Room No. {stay.roomNumber}</span>
                        </p>
                      </div>
                    </div>

                    {/* Bottom row: Points & Action buttons */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-t border-gray-100 pt-4 gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-gray-600 bg-primary-light px-3 py-1.5 rounded-lg w-fit">
                        <Sparkles size={14} className="text-primary-dark" />
                        <span>Earns <strong className="font-bold text-primary-dark">{stay.points}</strong> Spark Rewards points</span>
                      </div>

                      <div className="flex gap-2 flex-wrap">
                        <GhostButton
                          to={`/my-booking?ref=${stay.bookingRef}&email=${memberEmail}`}
                          className="text-xs font-semibold border-gray-200 text-gray-700 hover:bg-gray-50 min-h-[44px]"
                        >
                          Modify / Cancel
                        </GhostButton>
                        <Link
                          to={`/my-booking?ref=${stay.bookingRef}&email=${memberEmail}`}
                          className="min-h-[44px] px-4 inline-flex items-center justify-center rounded-lg bg-primary text-xs font-semibold text-white hover:bg-primary-dark active:scale-[0.98] transition-all shadow-sm"
                        >
                          View Details
                          <ArrowRight size={14} className="ml-1.5" />
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-card bg-white border border-gray-200 p-8 text-center text-gray-500">
              <p>No upcoming stays booked. Ready for your next getaway?</p>
              <Link
                to="/rooms"
                className="mt-4 min-h-[44px] px-6 inline-flex items-center justify-center rounded-lg bg-primary text-sm font-semibold text-white hover:bg-primary-dark active:scale-[0.98] transition-all"
              >
                Book a Room
              </Link>
            </div>
          )}
        </div>

        {/* Past Stays Section */}
        <div>
          <h2 className="text-xl font-heading text-gray-950 mb-5 flex items-center gap-2 border-t border-gray-150 pt-8">
            <History className="text-primary" size={20} />
            Past Stays & History
          </h2>

          <div className="grid gap-6 sm:grid-cols-2">
            {pastStays.map((stay) => (
              <div
                key={stay.id}
                className="rounded-card bg-white overflow-hidden shadow-sm ring-1 ring-gray-200 flex flex-col justify-between transition hover:shadow-md"
              >
                {/* Top Image & Badge */}
                <div className="relative h-44 overflow-hidden bg-gray-100">
                  <img
                    src={stay.imageUrl}
                    alt={stay.roomName}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute top-3 left-3">
                    <StatusBadge label={stay.statusLabel} status={stay.status} />
                  </div>
                  {stay.points > 0 && (
                    <div className="absolute bottom-3 right-3 bg-gray-950/80 backdrop-blur-sm px-2.5 py-1 rounded text-[10px] font-bold text-white tracking-wide">
                      +{stay.points} pts
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-5 space-y-4 flex-1 flex flex-col justify-between">
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-mono text-gray-400">
                      Ref: {stay.bookingRef}
                    </p>
                    <h3 className="font-heading text-xl text-gray-950 lowercase tracking-tight">
                      {stay.roomName}
                    </h3>
                    <p className="text-xs text-gray-500">
                      {stay.checkIn} — {stay.checkOut} • {stay.numNights} nights
                    </p>
                  </div>

                  <div className="flex items-center justify-between border-t border-gray-100 pt-4 mt-auto">
                    <span className="text-sm font-bold text-gray-900">
                      {formatPrice(stay.totalPrice)}
                    </span>
                    <div className="flex gap-2">
                      <GhostButton
                        to={`/my-booking?ref=${stay.bookingRef}&email=${memberEmail}`}
                        className="text-xs font-semibold border-gray-200 text-gray-700 hover:bg-gray-50 min-h-[38px] px-3 py-1"
                      >
                        Receipt
                      </GhostButton>
                      {stay.status !== "cancelled" ? (
                        <Link
                          to="/rooms"
                          className="min-h-[38px] px-3.5 inline-flex items-center justify-center rounded-lg bg-primary text-xs font-semibold text-white hover:bg-primary-dark active:scale-[0.98] transition-all"
                        >
                          Rebook
                        </Link>
                      ) : (
                        <Link
                          to="/rooms"
                          className="min-h-[38px] px-3.5 inline-flex items-center justify-center rounded-lg bg-primary text-xs font-semibold text-white hover:bg-primary-dark active:scale-[0.98] transition-all"
                        >
                          Book Again
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Support Section */}
        <div className="rounded-card bg-gray-100/70 p-5 flex items-start gap-3.5 border border-gray-200/50">
          <HelpCircle size={20} className="text-primary shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-bold text-gray-900">Need help with a booking?</p>
            <p className="text-xs text-gray-600 leading-relaxed">
              If a reservation is missing from this list, or you booked with a different email, please contact our Front Desk at <span className="font-semibold text-gray-800">{config.frontDeskPhone}</span> or support email <span className="font-semibold text-gray-800">{config.supportEmail}</span> to link it to your rewards account.
            </p>
          </div>
        </div>
      </div>
    </AccountLayout>
  );
}
