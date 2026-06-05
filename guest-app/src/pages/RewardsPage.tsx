import { useState } from "react";
import { Star, Award, Clock, ArrowUpRight, Gift, Sparkles, Info, Calendar, CheckCircle2, ChevronRight } from "lucide-react";
import config from "@config";
import { AccountLayout } from "../components/AccountLayout";
import { PrimaryButton } from "../components/PrimaryButton";
import { Modal } from "../components/Modal";
import { GhostButton } from "../components/GhostButton";

interface PointsTransaction {
  id: string;
  date: string;
  description: string;
  points: number;
  status: "completed" | "pending";
}

const mockTransactions: PointsTransaction[] = [
  {
    id: "tx-1",
    date: "Oct 15, 2026",
    description: "Stay Checkout Earnings (SI-09214) — Pending Checkout",
    points: 480,
    status: "pending"
  },
  {
    id: "tx-2",
    date: "Aug 09, 2025",
    description: "Stay Checkout Earnings (SI-08103)",
    points: 800,
    status: "completed"
  },
  {
    id: "tx-3",
    date: "Aug 08, 2025",
    description: "Loyalty Adjustment (Front Desk credit)",
    points: 680,
    status: "completed"
  },
  {
    id: "tx-4",
    date: "Jun 02, 2025",
    description: "Welcome Rewards Registration Bonus",
    points: 1000,
    status: "completed"
  }
];

export function RewardsPage() {
  // States
  const [showEarlyCheckinModal, setShowEarlyCheckinModal] = useState(false);
  const [checkInTime, setCheckInTime] = useState("12:00 PM");
  const [selectedBooking, setSelectedBooking] = useState("SI-09214");
  const [isSubmittingCheckin, setIsSubmittingCheckin] = useState(false);
  const [showCheckinSuccessAlert, setShowCheckinSuccessAlert] = useState(false);

  // Rewards Configuration (mock settings/rewardsConfig)
  const rewardsConfig = {
    pointsEnabled: true,
    memberDiscountEnabled: true,
    discountRate: 10, // 10% member discount
    pointsRuleText: "Earn 10 points per ₱100 spent on booking stays"
  };

  const handleRequestEarlyCheckin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingCheckin(true);

    setTimeout(() => {
      setIsSubmittingCheckin(false);
      setShowEarlyCheckinModal(false);
      setShowCheckinSuccessAlert(true);
      
      // Auto-hide alert after 5 seconds
      setTimeout(() => setShowCheckinSuccessAlert(false), 5000);
    }, 1200);
  };

  const currentPointsBalance = 2480;

  return (
    <AccountLayout
      activeTab="rewards"
      title="My Rewards"
      subtitle={`Unlock member benefits, track your points balance, and request premium check-in perks.`}
    >
      <div className="space-y-8 font-body">
        {/* Success Alert for Early Check-In */}
        {showCheckinSuccessAlert && (
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-xs font-medium text-green-700 flex gap-2.5 items-start animate-fade-in">
            <CheckCircle2 size={16} className="shrink-0 text-green-600 mt-0.5" />
            <div>
              <p className="font-bold">Early Check-In Requested</p>
              <p className="mt-0.5">
                Your request for check-in at <span className="font-semibold">{checkInTime}</span> has been logged and sent to the Front Desk (simulated). We will notify you once room status is confirmed.
              </p>
            </div>
          </div>
        )}

        {rewardsConfig.pointsEnabled ? (
          <div className="grid gap-6 md:grid-cols-[1fr_340px]">
            {/* Left: Points History Ledger */}
            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
              <h2 className="text-lg font-heading text-gray-950 mb-4 flex items-center gap-2">
                <Clock className="text-primary" size={18} />
                Points Ledger
              </h2>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-150 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      <th className="pb-3 pr-4">Date</th>
                      <th className="pb-3 pr-4">Description</th>
                      <th className="pb-3 text-right">Points</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {mockTransactions.map((tx) => (
                      <tr key={tx.id} className="group hover:bg-gray-50/50 transition">
                        <td className="py-3.5 pr-4 text-gray-500 whitespace-nowrap">
                          {tx.date}
                        </td>
                        <td className="py-3.5 pr-4">
                          <p className="font-semibold text-gray-800">{tx.description}</p>
                          {tx.status === "pending" && (
                            <span className="inline-flex items-center gap-1 mt-1 rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200/50">
                              Pending Checkout
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 text-right font-semibold whitespace-nowrap">
                          <span className={tx.status === "pending" ? "text-amber-600" : "text-green-600"}>
                            +{tx.points.toLocaleString()} pts
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Points Summary & Perks */}
            <div className="space-y-6">
              {/* Points Card */}
              <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between relative overflow-hidden">
                <div className="absolute right-[-10%] top-[-10%] opacity-5 text-primary">
                  <Star size={120} fill="currentColor" />
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Available Points</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-gray-900 tracking-tight">
                      {currentPointsBalance.toLocaleString()}
                    </span>
                    <span className="text-sm font-semibold text-gray-500">pts</span>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between">
                  <div className="inline-flex items-center gap-1.5 bg-primary-light px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-primary-dark">
                    <Award size={12} />
                    Standard Tier
                  </div>
                  <span className="text-xs text-gray-500">520 pts to Silver</span>
                </div>

                {/* Progress bar to next tier */}
                <div className="mt-3 w-full bg-gray-100 rounded-full h-1.5">
                  <div 
                    className="bg-primary h-1.5 rounded-full" 
                    style={{ width: `${(currentPointsBalance / 3000) * 100}%` }}
                  />
                </div>
              </div>

              {/* Discount perks */}
              {rewardsConfig.memberDiscountEnabled && (
                <div className="rounded-card bg-gradient-to-br from-primary-light/50 to-primary-light/10 p-5 ring-1 ring-primary/20 space-y-2">
                  <div className="flex items-center gap-2 text-primary-dark">
                    <Gift size={18} />
                    <h3 className="text-sm font-bold">Member Rate Activated</h3>
                  </div>
                  <p className="text-xs text-gray-700 leading-relaxed">
                    You get <strong className="font-bold text-primary-dark">{rewardsConfig.discountRate}% off</strong> room rates auto-applied at booking checkout.
                  </p>
                </div>
              )}

              {/* Early Check-In Perk Box */}
              <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 space-y-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                    <Sparkles className="text-primary shrink-0" size={16} />
                    Early Check-In Perk
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed">
                    Members are entitled to request early check-in (subject to housekeeping availability). Normal check-in is 2:00 PM.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setShowEarlyCheckinModal(true)}
                  className="w-full min-h-[44px] inline-flex items-center justify-center rounded-lg bg-primary text-xs font-semibold text-white hover:bg-primary-dark active:scale-[0.98] transition-all shadow-sm"
                >
                  Request Early Check-In
                </button>
              </div>

              {/* Loyalty rules details */}
              <div className="rounded-card bg-gray-50 p-4 border border-gray-150 flex gap-2.5 items-start">
                <Info size={16} className="text-gray-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-xs font-bold text-gray-700">Points Accumulation</p>
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    {rewardsConfig.pointsRuleText}. Points are automatically updated in your wallet after you check out of the hotel.
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-card bg-white p-8 text-center text-gray-500 border border-gray-200">
            <p>Spark Rewards point collection is currently paused. Enjoy other exclusive member benefits.</p>
          </div>
        )}
      </div>

      {/* Early Check-In Request Modal */}
      <Modal
        open={showEarlyCheckinModal}
        onClose={() => setShowEarlyCheckinModal(false)}
        title="Request Early Check-In"
      >
        <form onSubmit={handleRequestEarlyCheckin} className="space-y-5 font-body">
          <p className="text-sm text-gray-600 leading-relaxed">
            Submit a request to check-in early for your upcoming booking. Our front desk staff will prioritize preparing your room, but please note this is subject to availability.
          </p>

          <label className="grid gap-2 text-xs font-semibold text-gray-700">
            Select Upcoming Booking
            <select
              value={selectedBooking}
              onChange={(e) => setSelectedBooking(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white py-2 px-3 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
            >
              <option value="SI-09214">SI-09214 — The Riverview Suite (Oct 12–15, 2026)</option>
            </select>
          </label>

          <label className="grid gap-2 text-xs font-semibold text-gray-700">
            Requested Arrival Time
            <select
              value={checkInTime}
              onChange={(e) => setCheckInTime(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-200 bg-white py-2 px-3 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
            >
              <option value="10:00 AM">10:00 AM (4 hrs early)</option>
              <option value="11:00 AM">11:00 AM (3 hrs early)</option>
              <option value="12:00 PM">12:00 PM (2 hrs early)</option>
              <option value="1:00 PM">1:00 PM (1 hr early)</option>
            </select>
          </label>

          <div className="rounded-lg bg-blue-50 border border-blue-200 p-3.5 text-xs text-blue-800 flex gap-2">
            <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />
            <p>
              Your request will be sent to the front desk. Since this room is currently occupied by guests checking out at 12:00 PM, preparing it by your requested time depends on clean schedules.
            </p>
          </div>

          <div className="flex gap-3 pt-2 justify-end">
            <GhostButton 
              type="button"
              onClick={() => setShowEarlyCheckinModal(false)} 
              className="text-sm font-semibold border-gray-200 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </GhostButton>
            <PrimaryButton
              type="submit"
              disabled={isSubmittingCheckin}
              className="min-w-[150px]"
            >
              {isSubmittingCheckin ? "Submitting..." : "Submit Request"}
            </PrimaryButton>
          </div>
        </form>
      </Modal>
    </AccountLayout>
  );
}
