import { useState, useEffect } from "react";
import { Star, Award, Clock, Info, Calendar, CheckCircle2, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { collection, doc, query, getDoc, onSnapshot, orderBy } from "firebase/firestore";
import { getDateKeyInTimezone } from "@spark-inn/shared";
import config from "@config";
import { db } from "../firebase/config";
import { AccountLayout } from "../components/AccountLayout";
import { GhostButton } from "../components/GhostButton";
import { useGuestAuth } from "../context/GuestAuthContext";
import { formatPrice } from "../utils/format";

interface UpcomingBooking {
  id: string;
  bookingRef: string;
  roomName?: string;
  checkIn: string;
  checkOut: string;
}

interface PointsTransaction {
  id: string;
  date: string;
  description: string;
  points: number;
  type: string;
}

interface RewardsConfig {
  pointsEnabled: boolean;
  earningMode: "per-booking" | "per-spend";
  pointsPerBooking: number;
  pointsPerHundred: number;
  memberDiscountEnabled: boolean;
  memberDiscountPct: number;
}

const DEFAULT_REWARDS_CONFIG: RewardsConfig = {
  pointsEnabled: true,
  earningMode: "per-spend",
  pointsPerBooking: 50,
  pointsPerHundred: 10,
  memberDiscountEnabled: true,
  memberDiscountPct: 10
};

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

export function RewardsPage() {
  const { user, memberProfile } = useGuestAuth();
  const [transactions, setTransactions] = useState<PointsTransaction[]>([]);
  const [rewardsConfig, setRewardsConfig] = useState<RewardsConfig>(DEFAULT_REWARDS_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [showEarlyCheckIn, setShowEarlyCheckIn] = useState(false);
  const [upcomingBookings, setUpcomingBookings] = useState<UpcomingBooking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [earlyCheckInError, setEarlyCheckInError] = useState<string | null>(null);
  const [earlyCheckInSent, setEarlyCheckInSent] = useState<string | null>(null);
  const [submittingEarlyCheckIn, setSubmittingEarlyCheckIn] = useState(false);

  useEffect(() => {
    if (!user?.uid) { setIsLoading(false); return; }

    let cancelled = false;
    let unsubscribeHistory: (() => void) | undefined;

    async function fetchRewardsConfig() {
      try {
        const configSnap = await getDoc(doc(db, "settings", "rewardsConfig"));
        if (cancelled) return;

        if (configSnap.exists()) {
          const data = configSnap.data();
          setRewardsConfig({
            pointsEnabled: data.pointsEnabled !== false,
            earningMode: data.earningMode === "per-booking" ? "per-booking" : "per-spend",
            pointsPerBooking: Number(data.pointsPerBooking ?? DEFAULT_REWARDS_CONFIG.pointsPerBooking),
            pointsPerHundred: Number(data.pointsPerHundred ?? DEFAULT_REWARDS_CONFIG.pointsPerHundred),
            memberDiscountEnabled: data.memberDiscountEnabled !== false,
            memberDiscountPct: Number(data.memberDiscountPct ?? DEFAULT_REWARDS_CONFIG.memberDiscountPct)
          });
        }
      } catch (err) {
        console.error("Failed to fetch rewards config:", err);
      }
    }

    fetchRewardsConfig();
    unsubscribeHistory = onSnapshot(
      query(
        collection(db, "members", user.uid, "pointsHistory"),
        orderBy("createdAt", "desc")
      ),
      (snapshot) => {
        if (cancelled) return;
        const records: PointsTransaction[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            date: toDateStr(data.createdAt),
            description: data.description || data.type || "Points transaction",
            points: data.points || 0,
            type: data.type || "earn"
          };
        });
        setTransactions(records);
        setIsLoading(false);
      },
      (err) => {
        console.error("Failed to listen to points history:", err);
        if (!cancelled) setIsLoading(false);
      }
    );

    return () => {
      cancelled = true;
      unsubscribeHistory?.();
    };
  }, [user]);

  // Per W2.4 / decision #92: load the member's upcoming bookings when
  // the early check-in modal is opened. We pick the first confirmed or
  // checked-in booking whose checkIn is >= today (in the hotel
  // timezone), sorted ascending. If 0, the modal shows an error. If
  // 1, we submit directly. If >1, the modal shows a small picker.
  useEffect(() => {
    if (!showEarlyCheckIn || !user?.uid) return;
    let cancelled = false;
    setLoadingBookings(true);
    setEarlyCheckInError(null);
    setEarlyCheckInSent(null);
    (async () => {
      try {
        const idToken = await user!.getIdToken();
        const response = await fetch("/api/members/stays", {
          method: "GET",
          headers: { Authorization: `Bearer ${idToken}` }
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.success) {
          throw new Error(result?.error || "Unable to load your bookings.");
        }
        if (cancelled) return;
        const todayStr = getDateKeyInTimezone(config.timezone);
        const upcoming: UpcomingBooking[] = (result.data?.stays || [])
          .filter((stay: any) => ["confirmed", "checked-in"].includes(stay.status) && stay.checkIn >= todayStr)
          .map((stay: any) => ({
            id: stay.id,
            bookingRef: stay.bookingRef,
            roomName: stay.roomName || stay.roomType,
            checkIn: stay.checkIn,
            checkOut: stay.checkOut
          }))
          .sort((a: UpcomingBooking, b: UpcomingBooking) => a.checkIn.localeCompare(b.checkIn));
        setUpcomingBookings(upcoming);
        if (upcoming.length === 0) {
          setEarlyCheckInError("No upcoming booking found. Book a stay first to request early check-in.");
        }
      } catch (err) {
        console.error("Failed to load upcoming bookings:", err);
        setEarlyCheckInError("Unable to load your bookings. Please try again.");
      } finally {
        if (!cancelled) setLoadingBookings(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showEarlyCheckIn, user]);

  // Per W2.4 / decision #92: submit the early check-in request for
  // the chosen booking (auto-pick the first one when count is 1).
  const handleSubmitEarlyCheckIn = async (bookingId: string) => {
    setSubmittingEarlyCheckIn(true);
    setEarlyCheckInError(null);
    try {
      const response = await fetch("/api/email/early-checkin-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${await user!.getIdToken()}`
        },
        body: JSON.stringify({ bookingId })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to submit the request.");
      }
      setEarlyCheckInSent(bookingId);
    } catch (err: any) {
      console.error("Early check-in request failed:", err);
      setEarlyCheckInError(err.message || "Unable to submit the request.");
    } finally {
      setSubmittingEarlyCheckIn(false);
    }
  };

  const pointsBalance = memberProfile?.rewardsPoints || 0;
  const pointsEnabled = rewardsConfig.pointsEnabled !== false;
  const memberDiscountEnabled = rewardsConfig.memberDiscountEnabled !== false && rewardsConfig.memberDiscountPct > 0;
  const earningCopy = rewardsConfig.earningMode === "per-booking"
    ? `Earn ${rewardsConfig.pointsPerBooking.toLocaleString()} points per completed stay.`
    : `Earn ${rewardsConfig.pointsPerHundred.toLocaleString()} points per ${formatPrice(100)} spent.`;

  return (
    <AccountLayout activeTab="rewards" title="My Rewards" subtitle={`Track your ${config.rewardsName} points and member perks.`}>
      <div className="space-y-8">
        {pointsEnabled && (
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 text-center">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-4">
              <Award size={28} className="text-primary" />
            </div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Your Points Balance</p>
            <p className="text-5xl font-heading text-gray-950 mt-2">
              {pointsBalance.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 mt-2">Standard Member</p>
          </div>
        )}

        {/* Perks */}
        <div className="grid gap-4 sm:grid-cols-2">
          {memberDiscountEnabled && (
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <Star size={16} className="text-primary" />
                <span className="text-xs font-bold text-gray-900">Member Rate</span>
              </div>
              <p className="text-xs text-gray-500">You get {rewardsConfig.memberDiscountPct}% off every booking as a member.</p>
            </div>
          )}

          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center gap-2 mb-2">
              <Clock size={16} className="text-primary" />
              <span className="text-xs font-bold text-gray-900">Early Check-In</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">Request early check-in on your next stay — subject to availability.</p>
            <GhostButton onClick={() => setShowEarlyCheckIn(true)} className="text-[10px]">
              Request Early Check-In
            </GhostButton>
          </div>
        </div>

        {/* Early Check-In Modal — per W2.4 / decision #92 */}
        {showEarlyCheckIn && (
          <div className="rounded-lg bg-primary-light border border-primary/20 p-4 text-xs text-primary-dark space-y-2">
            <p className="font-bold">Early Check-In Request</p>
            {loadingBookings ? (
              <p className="flex items-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Loading your bookings...
              </p>
            ) : earlyCheckInError ? (
              <>
                <p className="leading-relaxed text-red-600">{earlyCheckInError}</p>
                <button
                  type="button"
                  onClick={() => setShowEarlyCheckIn(false)}
                  className="mt-2 text-xs font-semibold text-primary hover:underline"
                >
                  Close
                </button>
              </>
            ) : earlyCheckInSent ? (
              <>
                <p className="leading-relaxed text-green-700">
                  Request sent. Our front desk team will email you within 24 hours to confirm availability.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowEarlyCheckIn(false);
                    setEarlyCheckInSent(null);
                  }}
                  className="mt-2 text-xs font-semibold text-primary hover:underline"
                >
                  Close
                </button>
              </>
            ) : upcomingBookings.length === 1 ? (
              <>
                <p className="leading-relaxed">
                  Send an early check-in request for your upcoming stay (Booking {upcomingBookings[0].bookingRef}, check-in {toDateStr(upcomingBookings[0].checkIn)})?
                </p>
                <button
                  type="button"
                  onClick={() => handleSubmitEarlyCheckIn(upcomingBookings[0].id)}
                  disabled={submittingEarlyCheckIn}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                >
                  {submittingEarlyCheckIn ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  Send Request
                </button>
                <button
                  type="button"
                  onClick={() => setShowEarlyCheckIn(false)}
                  className="ml-2 text-xs font-semibold text-primary hover:underline"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <p className="leading-relaxed">You have {upcomingBookings.length} upcoming bookings. Pick the one you want to request early check-in for:</p>
                <ul className="space-y-1">
                  {upcomingBookings.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2 rounded-md bg-white px-2 py-1.5">
                      <span>Booking {b.bookingRef} — check-in {toDateStr(b.checkIn)}</span>
                      <button
                        type="button"
                        onClick={() => handleSubmitEarlyCheckIn(b.id)}
                        disabled={submittingEarlyCheckIn}
                        className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
                      >
                        Request
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => setShowEarlyCheckIn(false)}
                  className="mt-2 text-xs font-semibold text-primary hover:underline"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        )}

        {pointsEnabled && (
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Points History</h2>
            <p className="text-[10px] text-gray-500 mt-0.5">Your points earning and redemption activity.</p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 size={20} className="animate-spin mr-2" />
              <span className="text-xs">Loading history...</span>
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Sparkles size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-xs font-semibold">No points activity yet.</p>
              <p className="text-[10px] mt-1">Points are earned when you check out of a stay.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {transactions.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between py-3 px-4 rounded-lg border border-gray-100 bg-gray-50/50 hover:bg-gray-50 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                      tx.points >= 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                    }`}>
                      {tx.points >= 0 ? <CheckCircle2 size={14} /> : <ChevronRight size={14} className="rotate-180" />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-gray-900">{tx.description}</p>
                      <p className="text-[10px] text-gray-400">{tx.date}</p>
                    </div>
                  </div>
                  <span className={`text-sm font-bold ${tx.points >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {tx.points >= 0 ? "+" : ""}{tx.points.toLocaleString()} pts
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        )}

        {pointsEnabled && (
        <div className="flex items-start gap-3 p-4 bg-primary-light rounded-xl border border-primary/20">
          <Info size={16} className="text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-primary-dark">How Points Work</p>
            <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">
              {earningCopy} Points are earned when you check out of a completed stay.
              Points can be redeemed by the front desk against future bookings. Contact the front desk for redemption requests.
            </p>
          </div>
        </div>
        )}
      </div>
    </AccountLayout>
  );
}
