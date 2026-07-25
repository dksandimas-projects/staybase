import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Calendar, Sparkles, ArrowRight, HelpCircle, Loader2, AlertCircle } from "lucide-react";
import config from "@config";
import { AccountLayout } from "../components/AccountLayout";
import { StatusBadge } from "../components/StatusBadge";
import { EmailVerifyBanner } from "../components/EmailVerifyBanner";
import { formatPrice } from "../utils/format";
import { useGuestAuth } from "../context/GuestAuthContext";

interface StayRecord {
  id: string;
  bookingRef: string;
  // Per H2 (hardening batch 2026-06-26): the lookup
  // deep-link URL param. See `BookingLookupPage` +
  // `handleLookupBooking` for the matching server
  // changes.
  lookupToken: string;
  roomNumber: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  numNights: number;
  totalPrice: number;
  status: string;
  hasBreakfast: boolean;
}

function toDateStr(value: any): string {
  if (!value) return "";
  if (value instanceof Date) return value.toLocaleDateString(config.locale, { month: "short", day: "numeric", year: "numeric" });
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().toLocaleDateString(config.locale, { month: "short", day: "numeric", year: "numeric" });
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`).toLocaleDateString(config.locale, { month: "short", day: "numeric", year: "numeric" });
  }
  return String(value);
}

export function StaysPage() {
  const { user } = useGuestAuth();
  const [stays, setStays] = useState<StayRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!user) { setIsLoading(false); return; }

    let cancelled = false;
    async function fetchStays() {
      try {
        setLoadError("");
        const idToken = await user!.getIdToken();
        const response = await fetch("/api/members/stays", {
          method: "GET",
          headers: { Authorization: `Bearer ${idToken}` }
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || "We could not load your stays right now.");
        }
        if (cancelled) return;
        const records: StayRecord[] = (result.data?.stays || []).map((stay: StayRecord) => ({
          ...stay,
          checkIn: toDateStr(stay.checkIn),
          checkOut: toDateStr(stay.checkOut)
        }));
        setStays(records);
      } catch (err: any) {
        console.error("Failed to fetch stays:", err);
        if (!cancelled) setLoadError(err?.message || "We could not load your stays right now.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchStays();
    return () => { cancelled = true; };
  }, [user]);

  const upcomingStays = stays.filter((s) => ["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"].includes(s.status));
  const pastStays = stays.filter((s) => s.status === "checked-out");
  const cancelledStays = stays.filter((s) => s.status === "cancelled");

  return (
    <AccountLayout activeTab="stays" title="My Stays" subtitle={`Your booking history at ${config.brandName}.`}>
      {/*
        Per Spark Rewards audit 2026-07-18 HIGH-1: an
        unverified email/password user can't see their
        past-booking list (the server returns 403 on
        /api/members/stays). The banner explains why and
        offers a Resend action.
      */}
      {user?.emailVerified === false && (
        <div className="mb-6">
          <EmailVerifyBanner reason="past-stays" />
        </div>
      )}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <Loader2 size={24} className="animate-spin mr-2" />
          <span className="text-sm">Loading your stays...</span>
        </div>
      ) : loadError ? (
        <div className="rounded-card bg-white p-8 shadow-sm ring-1 ring-red-100">
          <div className="flex items-start gap-3 text-red-700">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold">Unable to load your stays.</p>
              <p className="mt-1 text-xs text-red-600">{loadError} Please refresh or contact the front desk if this continues.</p>
            </div>
          </div>
        </div>
      ) : stays.length === 0 ? (
        <div className="rounded-card bg-white p-12 shadow-sm ring-1 ring-gray-200 text-center">
          <Calendar size={40} className="mx-auto text-gray-300 mb-4" />
          <p className="text-sm font-semibold text-gray-600">No stays yet.</p>
          <p className="text-xs text-gray-400 mt-1">Your bookings will appear here after your first stay.</p>
          <Link to="/book" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline mt-4">
            Book your first stay <ArrowRight size={12} />
          </Link>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Upcoming stays */}
          {upcomingStays.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Sparkles size={14} className="text-primary" />
                Upcoming Stays
              </h2>
              <div className="space-y-4">
                {upcomingStays.map((stay) => (
                  <StayCard key={stay.id} stay={stay} />
                ))}
              </div>
            </section>
          )}

          {/* Past stays */}
          {pastStays.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Calendar size={14} className="text-gray-400" />
                Past Stays
              </h2>
              <div className="space-y-4">
                {pastStays.map((stay) => (
                  <StayCard key={stay.id} stay={stay} />
                ))}
              </div>
            </section>
          )}

          {/* Cancelled */}
          {cancelledStays.length > 0 && (
            <section>
              <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4">Cancelled</h2>
              <div className="space-y-4">
                {cancelledStays.map((stay) => (
                  <StayCard key={stay.id} stay={stay} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </AccountLayout>
  );
}

function StayCard({ stay }: { stay: StayRecord }) {
  return (
    <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 flex flex-col sm:flex-row sm:items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-mono font-bold text-primary">{stay.bookingRef}</span>
          <StatusBadge label={stay.status.replace(/-/g, " ")} status={stay.status} />
        </div>
        <p className="text-sm font-semibold text-gray-900">
          {/* Per the refactor/room-number-visibility change: only
              surface the assigned room number once the stay is
              checked-in or checked-out. For pre-check-in stays the
              front desk can still reshuffle rooms, so the number
              is hidden until the assignment is firm. */}
          {stay.roomNumber &&
          (stay.status === "checked-in" || stay.status === "checked-out")
            ? `Room ${stay.roomNumber} — ${stay.roomType}`
            : stay.roomType}
        </p>
        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Calendar size={12} />
            {stay.checkIn} → {stay.checkOut}
          </span>
          <span>{stay.numNights} night{stay.numNights !== 1 ? "s" : ""}</span>
          {stay.hasBreakfast && <span className="text-amber-600 font-semibold">+ Breakfast</span>}
        </div>
      </div>
      <div className="text-right">
        <p className="text-lg font-bold text-primary-dark">{formatPrice(stay.totalPrice)}</p>
        <Link
          // Per H2 (hardening batch 2026-06-26): the
          // lookup deep-link now carries the per-booking
          // `lookupToken` instead of the (currently
          // empty) `email` URL param. The `lookupToken`
          // is part of `StayRecord` because the StaysPage
          // already hydrates the full booking record
          // (member view of their own bookings).
          to={`/my-booking?ref=${stay.bookingRef}&token=${stay.lookupToken}`}
          className="text-[10px] font-semibold text-primary hover:underline mt-1 inline-flex items-center gap-0.5"
        >
          View details <ArrowRight size={10} />
        </Link>
      </div>
    </div>
  );
}
