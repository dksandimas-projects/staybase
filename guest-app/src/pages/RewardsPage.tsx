import { useState, useEffect } from "react";
import { Star, Award, Clock, Info, Calendar, CheckCircle2, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { collection, query, getDocs, orderBy } from "firebase/firestore";
import config from "@config";
import { db } from "../firebase/config";
import { AccountLayout } from "../components/AccountLayout";
import { GhostButton } from "../components/GhostButton";
import { useGuestAuth } from "../context/GuestAuthContext";
import { formatPrice } from "../utils/format";

interface PointsTransaction {
  id: string;
  date: string;
  description: string;
  points: number;
  type: string;
}

function toDateStr(value: any): string {
  if (!value) return "";
  if (value instanceof Date) return value.toLocaleDateString(config.locale, { month: "short", day: "numeric", year: "numeric" });
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().toLocaleDateString(config.locale, { month: "short", day: "numeric", year: "numeric" });
  }
  return String(value);
}

export function RewardsPage() {
  const { user, memberProfile } = useGuestAuth();
  const [transactions, setTransactions] = useState<PointsTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showEarlyCheckIn, setShowEarlyCheckIn] = useState(false);

  useEffect(() => {
    if (!user?.uid) { setIsLoading(false); return; }

    let cancelled = false;
    async function fetchHistory() {
      try {
        const q = query(
          collection(db, "members", user!.uid, "pointsHistory"),
          orderBy("createdAt", "desc")
        );
        const snapshot = await getDocs(q);
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
      } catch (err) {
        console.error("Failed to fetch points history:", err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchHistory();
    return () => { cancelled = true; };
  }, [user]);

  const pointsBalance = memberProfile?.rewardsPoints || 0;

  return (
    <AccountLayout activeTab="rewards" title="My Rewards" subtitle="Track your Spark Rewards points and member perks.">
      <div className="space-y-8">
        {/* Points Balance Card */}
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

        {/* Perks */}
        <div className="grid gap-4 sm:grid-cols-2">
          {memberProfile?.memberNumber && (
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <Star size={16} className="text-primary" />
                <span className="text-xs font-bold text-gray-900">Member Rate</span>
              </div>
              <p className="text-xs text-gray-500">You get exclusive member pricing on direct bookings.</p>
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

        {/* Early Check-In Modal */}
        {showEarlyCheckIn && (
          <div className="rounded-lg bg-primary-light border border-primary/20 p-4 text-xs text-primary-dark">
            <p className="font-bold mb-1">Early Check-In Request</p>
            <p className="leading-relaxed">
              To request early check-in, open the Intercom chat for your room (scan the QR code in your room) and send a quick request. The front desk will check availability and confirm. You can also call the front desk directly at {config.frontDeskPhone}.
            </p>
            <button
              type="button"
              onClick={() => setShowEarlyCheckIn(false)}
              className="mt-3 text-xs font-semibold text-primary hover:underline"
            >
              Got it
            </button>
          </div>
        )}

        {/* Points History */}
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

        {/* Info */}
        <div className="flex items-start gap-3 p-4 bg-primary-light rounded-xl border border-primary/20">
          <Info size={16} className="text-primary shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-primary-dark">How Points Work</p>
            <p className="text-[10px] text-gray-600 mt-1 leading-relaxed">
              Points are earned when you check out of a completed stay. The earning rate is configured by the hotel.
              Points can be redeemed by the front desk against future bookings. Contact the front desk for redemption requests.
            </p>
          </div>
        </div>
      </div>
    </AccountLayout>
  );
}
