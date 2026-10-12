import { useState, useEffect } from "react";
import { Star, Award, Clock, Info, Calendar, CheckCircle2, ChevronRight, Loader2, Sparkles, Gift } from "lucide-react";
import { collection, doc, query, getDoc, onSnapshot, orderBy, where } from "firebase/firestore";
import { getDateKeyInTimezone } from "@spark-inn/shared";
// Per Phase 7 of the Spark Rewards tier system (2026-10-13,
// decision pending): the member portal reads the cached
// `currentLevel` from the `MemberProfile` (refreshed at checkout
// + register) and the live `rewardsConfig.levels[]` array to
// compute the tier badge + progress-to-next bar. The
// `resolveCurrentLevel` helper is defensive (null on no tier /
// legacy docs) so a pre-Phase-2 deployment falls back to
// "Member" + a friendly "stay to unlock perks" prompt instead
// of crashing the render.
import type { LevelDef } from "@spark-inn/shared";
import config from "@config";
import { db } from "../firebase/config";
import { AccountLayout } from "../components/AccountLayout";
import { GhostButton } from "../components/GhostButton";
import { EmailVerifyBanner } from "../components/EmailVerifyBanner";
import { useGuestAuth } from "../context/GuestAuthContext";
import { formatPrice } from "../utils/format";

interface UpcomingBooking {
  id: string;
  bookingRef: string;
  roomName?: string;
  checkIn: string;
  checkOut: string;
  earlyCheckIn?: any;
}

interface PointsTransaction {
  id: string;
  date: string;
  description: string;
  points: number;
  type: string;
}

// Per Phase 7 (2026-10-13): the shape we read for reward
// vouchers (free-night etc). Only the fields the portal needs
// are typed — the full shape lives at
// `shared/utils/vouchers.ts → VoucherLike`. We coerce
// `expiresAt` to a string on the server side (the admin list
// does the same — see AdminContext) so the portal doesn't need
// to know about Firestore timestamps.
interface RewardVoucher {
  id: string;
  code: string;
  valueType: "percent" | "flat" | "free-night";
  discountValue: number;
  usageCount: number;
  usageCap: number | null;
  expiresAt: string | null;
  isActive: boolean;
}

interface RewardsConfig {
  pointsEnabled: boolean;
  earningMode: "per-booking" | "per-spend";
  pointsPerBooking: number;
  pointsPerHundred: number;
  memberDiscountEnabled: boolean;
  memberDiscountPct: number;
  // Per EC-02 (2026-08-21): the admin toggle that hides
  // the "Request Early Check-In" button on both the
  // RewardsPage and the booking confirmation flow. The
  // default value of `true` in DEFAULT_REWARDS_CONFIG means
  // pre-EC-02 deployments keep the perk on until the
  // admin explicitly turns it off via Settings → Rewards.
  earlyCheckInEnabled: boolean;
  // Phase 2 (2026-10-12): the new scalars + levels array. All
  // optional for backward compat with pre-Phase-2 deployments
  // (the `levels` array can be absent → tier display falls back
  // to "Member" + a friendly "stay to unlock perks" prompt).
  welcomePoints?: number;
  minPointsToRedeem?: number;
  pointsCanPayUpToBillPct?: number;
  freeNightEvery?: number;
  levels?: LevelDef[];
}

const DEFAULT_REWARDS_CONFIG: RewardsConfig = {
  pointsEnabled: true,
  earningMode: "per-spend",
  pointsPerBooking: 50,
  pointsPerHundred: 10,
  memberDiscountEnabled: true,
  memberDiscountPct: 10,
  earlyCheckInEnabled: true
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
  // Per Phase 7 (2026-10-13): live subscription to reward
  // vouchers owned by this member. Empty when the program is
  // off (freeNightEvery = 0) or the member has no qualifying
  // stays yet.
  const [rewardVouchers, setRewardVouchers] = useState<RewardVoucher[]>([]);
  const [rewardsConfig, setRewardsConfig] = useState<RewardsConfig>(DEFAULT_REWARDS_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [showEarlyCheckIn, setShowEarlyCheckIn] = useState(false);
  const [upcomingBookings, setUpcomingBookings] = useState<UpcomingBooking[]>([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [earlyCheckInError, setEarlyCheckInError] = useState<string | null>(null);
  const [earlyCheckInSent, setEarlyCheckInSent] = useState<string | null>(null);
  const [submittingEarlyCheckIn, setSubmittingEarlyCheckIn] = useState(false);
  const [selectedBookingId, setSelectedBookingId] = useState<string>("");
  const [requestedTime, setRequestedTime] = useState<string>("11:00 AM");
  const [guestNotes, setGuestNotes] = useState<string>("");

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
            memberDiscountPct: Number(data.memberDiscountPct ?? DEFAULT_REWARDS_CONFIG.memberDiscountPct),
            // Per EC-02 (2026-08-21): default to true when
            // absent so pre-EC-02 deployments keep the perk
            // on. The admin Settings → Rewards toggle is the
            // single source of truth for hiding the button.
            earlyCheckInEnabled: data.earlyCheckInEnabled !== false,
            // Phase 2 (2026-10-12) — defaults preserve the
            // legacy behavior for deployments that haven't
            // touched the new fields:
            //   - welcomePoints=0 = no welcome bonus
            //   - minPointsToRedeem=0 = no floor
            //   - pointsCanPayUpToBillPct=100 = no cap
            //   - freeNightEvery=0 = no free-night trigger
            //   - levels=[] = no tier program (legacy display)
            welcomePoints: Number(data.welcomePoints ?? 0),
            minPointsToRedeem: Number(data.minPointsToRedeem ?? 0),
            pointsCanPayUpToBillPct: Number(data.pointsCanPayUpToBillPct ?? 100),
            freeNightEvery: Number(data.freeNightEvery ?? 0),
            levels: Array.isArray(data.levels) ? data.levels : []
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

    // Per Phase 7 of the Spark Rewards tier system (2026-10-13,
    // decision pending): live subscription to the member's
    // active reward vouchers (Phase 5 writes these at checkout
    // for the free-night trigger). The query filters by
    // `kind === "reward"` + `memberId === current uid` so the
    // portal sees only the vouchers it owns — no shared
    // collection traversal. Firestore rules restrict the read
    // to the doc owner (see plan/docs/SECURITY.md §vouchers),
    // so a query for non-owned vouchers would 403 anyway. The
    // listener survives mid-session edits (admin deactivates,
    // member redeems) and reflects the new state on the next
    // snapshot.
    const unsubscribeVouchers = onSnapshot(
      query(
        collection(db, "vouchers"),
        where("kind", "==", "reward"),
        where("memberId", "==", user.uid)
      ),
      (snapshot) => {
        if (cancelled) return;
        const vouchers: RewardVoucher[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            code: data.code || docSnap.id,
            valueType: data.valueType === "free-night" ? "free-night" : (data.discountType || "flat"),
            discountValue: Number(data.discountValue || 0),
            usageCount: Number(data.usageCount || 0),
            usageCap: data.usageCap === null ? null : Number(data.usageCap),
            expiresAt: toDateStr(data.expiresAt) || null,
            isActive: data.isActive !== false
          };
        });
        setRewardVouchers(vouchers);
      },
      (err) => {
        // Non-fatal — fall back to empty list. The portal still
        // renders points + tier; just no free-night card.
        console.warn("Reward vouchers listener failed (non-fatal):", err);
        if (!cancelled) setRewardVouchers([]);
      }
    );

    return () => {
      cancelled = true;
      unsubscribeHistory?.();
      unsubscribeVouchers();
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
            checkOut: stay.checkOut,
            earlyCheckIn: stay.earlyCheckIn || null
          }))
          .sort((a: UpcomingBooking, b: UpcomingBooking) => a.checkIn.localeCompare(b.checkIn));
        setUpcomingBookings(upcoming);
        if (upcoming.length > 0) {
          setSelectedBookingId(upcoming[0].id);
        }
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
        body: JSON.stringify({
          bookingId,
          request: {
            requestedCheckInTime: requestedTime,
            notes: guestNotes
          }
        })
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Unable to submit the request.");
      }
      setEarlyCheckInSent(bookingId);
      setUpcomingBookings((prev) =>
        prev.map((b) =>
          b.id === bookingId
            ? {
                ...b,
                earlyCheckIn: {
                  status: "requested",
                  requestedTime,
                  notes: guestNotes,
                  requestedAt: new Date().toISOString(),
                  resolvedAt: null,
                  resolvedBy: null,
                  staffNote: null
                }
              }
            : b
        )
      );
    } catch (err: any) {
      console.error("Early check-in request failed:", err);
      setEarlyCheckInError(err.message || "Unable to submit the request.");
    } finally {
      setSubmittingEarlyCheckIn(false);
    }
  };

  useEffect(() => {
    const booking = upcomingBookings.find((b) => b.id === selectedBookingId);
    if (booking) {
      setRequestedTime(booking.earlyCheckIn?.requestedTime || "11:00 AM");
      setGuestNotes(booking.earlyCheckIn?.notes || "");
    }
  }, [selectedBookingId, upcomingBookings]);

  const pointsBalance = memberProfile?.rewardsPoints || 0;
  const pointsEnabled = rewardsConfig.pointsEnabled !== false;
  const memberDiscountEnabled = rewardsConfig.memberDiscountEnabled !== false && rewardsConfig.memberDiscountPct > 0;
  // Per Phase 7 (2026-10-13): tier badge + progress-to-next
  // computation. The `currentLevel` cache field is refreshed at
  // checkout + register (Phase 3 PR #3); the live `levels` array
  // is read from the rewardsConfig snapshot. We compute the
  // next tier as the first array entry whose `fromStays` is
  // greater than the current tier's `fromStays`. The progress
  // bar width is `(completedStays - current.fromStays) /
  // (next.fromStays - current.fromStays) × 100%`. When the
  // member is at the top tier, progress = 100% + a friendly
  // "top tier" message.
  const completedStays = Number(memberProfile?.completedStays ?? 0);
  const currentLevel: LevelDef | null = memberProfile?.currentLevel ?? null;
  const sortedLevels = (rewardsConfig.levels ?? [])
    .slice()
    .sort((a, b) => a.fromStays - b.fromStays);
  const nextLevel: LevelDef | null = (() => {
    if (!currentLevel) {
      // No tier cache — pick the base (fromStays=0) tier if
      // any exists; otherwise null. Member without a tier shows
      // a friendly prompt to unlock perks.
      return sortedLevels.find((l) => l.fromStays === 0) ?? null;
    }
    const next = sortedLevels.find((l) => l.fromStays > currentLevel.fromStays);
    return next ?? null;
  })();
  // The "tier name" rendered under the points balance. When
  // the member has no tier cache (pre-Phase-2 / free-night tier
  // not configured), fall back to the base tier name or
  // "Member".
  const tierName: string = currentLevel?.name
    ?? sortedLevels.find((l) => l.fromStays === 0)?.name
    ?? "Member";
  // Progress % — `Math.min(100, …)` caps the top-tier case so
  // the bar doesn't overflow.
  const progressPct: number = (() => {
    if (!currentLevel || !nextLevel) return 0;
    const span = nextLevel.fromStays - currentLevel.fromStays;
    if (span <= 0) return 100;
    const completed = Math.max(0, completedStays - currentLevel.fromStays);
    return Math.min(100, Math.round((completed / span) * 100));
  })();
  const remainingStays: number = (() => {
    if (!currentLevel || !nextLevel) return 0;
    return Math.max(0, nextLevel.fromStays - completedStays);
  })();
  // Per Phase 5 (2026-10-12): active free-night vouchers — we
  // filter out used / deactivated / expired entries here so the
  // render list shows only what the member can ACTUALLY apply.
  const now = Date.now();
  const activeRewardVouchers = rewardVouchers.filter((v) => {
    if (!v.isActive) return false;
    if (v.usageCap !== null && v.usageCount >= v.usageCap) return false;
    if (v.expiresAt && new Date(v.expiresAt).getTime() < now) return false;
    return true;
  });
  // Per Spark Rewards audit 2026-07-18 LOW-4: align the copy
  // with the live checkout-time formula. The previous copy
  // ("Earn N points per ₱100 spent") understated the actual
  // crediting, which is proportional
  // (`Math.floor((totalPrice/100) * pointsPerHundred)` per
  // `calculateCheckoutPoints` in `bookings.ts`). E.g. at 10
  // pts/₱100, a ₱150 stay earns 15 pts, not 10. The copy now
  // shows the per-₱100 rate and notes proportional crediting.
  const earningCopy = rewardsConfig.earningMode === "per-booking"
    ? `Earn ${rewardsConfig.pointsPerBooking.toLocaleString()} points per completed stay.`
    : `Earn ${rewardsConfig.pointsPerHundred.toLocaleString()} points per ${formatPrice(100)} spent (proportional — partial ₱100 still earn fractional points).`;

  return (
    <AccountLayout activeTab="rewards" title="My Rewards" subtitle={`Track your ${config.rewardsName} points and member perks.`}>
      <div className="space-y-8">
        {pointsEnabled && (
          <div className="rounded-card bg-white p-5 text-center shadow-sm ring-1 ring-gray-200 sm:p-6">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-4">
              <Award size={28} className="text-primary" />
            </div>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Your Points Balance</p>
            <p className="text-5xl font-heading text-gray-950 mt-2">
              {pointsBalance.toLocaleString()}
            </p>
            {/*
              Per Phase 7 (2026-10-13): tier badge + progress-to-next.
              Reads `currentLevel` from the `MemberProfile` cache
              (Phase 3 PR #3) and `levels` from the live
              `settings/rewardsConfig` snapshot. When the member has
              no tier cache (legacy doc, no levels configured), the
              tier name falls back to "Member" + no progress bar
              renders (Phase 1 backward-compat).
            */}
            <div className="mt-3 flex items-center justify-center gap-1.5">
              <Sparkles size={12} className="text-primary" aria-hidden="true" />
              <p className="text-sm font-bold text-primary" data-testid="member-tier-name">{tierName}</p>
            </div>
            {currentLevel && nextLevel && (
              <div className="mt-4 text-left">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>{currentLevel.name}</span>
                  <span>{nextLevel.name}</span>
                </div>
                <div
                  className="mt-1 h-2 w-full bg-gray-100 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={progressPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${remainingStays} more stay${remainingStays !== 1 ? "s" : ""} to ${nextLevel.name}`}
                >
                  <div
                    className="h-2 bg-primary rounded-full transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1 text-center">
                  {remainingStays} more stay{remainingStays !== 1 ? "s" : ""} to {nextLevel.name}
                </p>
              </div>
            )}
            {currentLevel && !nextLevel && (
              <p className="text-[10px] text-gray-500 mt-2">Top tier — enjoy your perks!</p>
            )}
            {!currentLevel && sortedLevels.length > 0 && (
              <p className="text-[10px] text-gray-500 mt-2">Stay with us to unlock tier perks.</p>
            )}
          </div>
        )}

        {/*
          Per Phase 5 (2026-10-12) + Phase 7 (2026-10-13): reward
          voucher card. Lists the member's active free-night
          vouchers (one per qualifying stay). The card only
          renders when the live subscription returned at least one
          active voucher — pre-Phase-2 members with no free-night
          vouchers see no card, which is the right default
          (don't surface a "you have no vouchers" empty state).
        */}
        {activeRewardVouchers.length > 0 && (
          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center gap-2 mb-3">
              <Gift size={16} className="text-primary" aria-hidden="true" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">Your Free Nights</h3>
            </div>
            <p className="text-[11px] text-gray-500 mb-3">
              Earned from your {(rewardsConfig.freeNightEvery ?? 0) > 0 ? `${rewardsConfig.freeNightEvery}-stay` : ""} milestone. Apply the code at booking Step 3 to redeem.
            </p>
            <ul className="space-y-2">
              {activeRewardVouchers.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs"
                  data-testid="reward-voucher-row"
                >
                  <div className="flex flex-col">
                    <span className="font-mono font-bold text-amber-900 tracking-wider">{v.code}</span>
                    <span className="text-[10px] text-amber-700 mt-0.5">
                      {v.valueType === "free-night" ? "100% off" : `${v.discountValue} off`}
                      {v.expiresAt ? ` · expires ${v.expiresAt}` : ""}
                    </span>
                  </div>
                  <span className="inline-flex items-center rounded-full bg-amber-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-50">
                    Free Night
                  </span>
                </li>
              ))}
            </ul>
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
            {/*
              Per Spark Rewards audit 2026-07-18 HIGH-1: an
              unverified email/password user can't submit a
              request (the server returns 403 EMAIL_NOT_VERIFIED).
              Surface the banner instead of opening the modal so
              the user gets a clear next step.
            */}
            {/*
              Per EC-02 (2026-08-21): the existing "Request
              Early Check-In" button on the RewardsPage is
              now gated on the admin toggle
              `settings/rewardsConfig.earlyCheckInEnabled`.
              When off, the entire button disappears — not
              just disabled — so the perk is not advertised
              to members at all. The toggle defaults to
              enabled (pre-EC-02 behavior) so existing
              deployments keep the perk on until the admin
              explicitly turns it off.
            */}
            {user?.emailVerified === false ? (
              <EmailVerifyBanner reason="early-checkin" />
            ) : rewardsConfig.earlyCheckInEnabled !== false ? (
              <GhostButton onClick={() => setShowEarlyCheckIn(true)} className="text-[10px]">
                Request Early Check-In
              </GhostButton>
            ) : null}
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
            ) : upcomingBookings.length > 0 ? (
              <>
                {upcomingBookings.length > 1 && (
                  <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    Select Booking
                    <select
                      value={selectedBookingId}
                      onChange={(e) => setSelectedBookingId(e.target.value)}
                      className="min-h-[38px] w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 outline-none"
                    >
                      {upcomingBookings.map((b) => (
                        <option key={b.id} value={b.id}>
                          Booking {b.bookingRef} (Check-in: {toDateStr(b.checkIn)})
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {(() => {
                  const activeBooking = upcomingBookings.find((b) => b.id === selectedBookingId) || upcomingBookings[0];
                  if (!activeBooking) return null;
                  
                  const earlyCheckIn = activeBooking.earlyCheckIn;
                  const isApproved = earlyCheckIn?.status === "approved";
                  const isRequested = earlyCheckIn?.status === "requested";
                  const isDeclined = earlyCheckIn?.status === "declined";

                  return (
                    <div className="space-y-4 pt-2">
                      {earlyCheckIn && (
                        <div className={`p-3 rounded-lg border text-xs ${
                          isApproved 
                            ? "bg-green-50 border-green-200 text-green-800" 
                            : isDeclined 
                              ? "bg-red-50 border-red-200 text-red-800" 
                              : "bg-blue-50 border-blue-200 text-blue-800"
                        }`}>
                          <p className="font-bold mb-1">
                            {earlyCheckIn.source === "staff-granted" ? "Early Check-In" : "Request Status"}: {earlyCheckIn.source === "staff-granted" && isApproved ? "GRANTED" : earlyCheckIn.status.toUpperCase()}
                          </p>
                          {isApproved && (
                            <p className="leading-relaxed">
                              {earlyCheckIn.source === "staff-granted" ? "Early check-in has been added to your stay!" : "Your request is approved!"} Room will be ready at <strong>{earlyCheckIn.confirmedTime || earlyCheckIn.requestedTime}</strong>.
                              {earlyCheckIn.staffNote && <span className="block mt-1 italic">Note: "{earlyCheckIn.staffNote}"</span>}
                            </p>
                          )}
                          {isRequested && (
                            <p className="leading-relaxed">
                              You requested check-in at <strong>{earlyCheckIn.requestedTime}</strong>. Our front desk is reviewing this request.
                              {earlyCheckIn.notes && <span className="block mt-1 italic">Your Note: "{earlyCheckIn.notes}"</span>}
                            </p>
                          )}
                          {isDeclined && (
                            <p className="leading-relaxed">
                              Unfortunately, early check-in is unavailable for this date. 
                              {earlyCheckIn.staffNote && <span className="block mt-1 italic">Reason: "{earlyCheckIn.staffNote}"</span>}
                              You may submit a new request below if you'd like to adjust details.
                            </p>
                          )}
                        </div>
                      )}

                      {!isApproved && (
                        <div className="space-y-3">
                          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                            Requested Check-In Time
                            <select
                              value={requestedTime}
                              onChange={(e) => setRequestedTime(e.target.value)}
                              className="min-h-[38px] w-full rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-900 outline-none"
                            >
                              <option value="08:00 AM">08:00 AM</option>
                              <option value="09:00 AM">09:00 AM</option>
                              <option value="10:00 AM">10:00 AM</option>
                              <option value="11:00 AM">11:00 AM</option>
                              <option value="12:00 PM">12:00 PM</option>
                              <option value="01:00 PM">01:00 PM</option>
                            </select>
                          </label>

                          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                            Special Requests / Notes
                            <textarea
                              value={guestNotes}
                              onChange={(e) => setGuestNotes(e.target.value)}
                              placeholder="e.g. Traveling with kids, requesting quiet side of building..."
                              rows={2}
                              className="w-full rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-900 outline-none resize-none"
                            />
                          </label>

                          <div className="flex flex-wrap gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => handleSubmitEarlyCheckIn(activeBooking.id)}
                              disabled={submittingEarlyCheckIn}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-50 min-h-[38px]"
                            >
                              {submittingEarlyCheckIn ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                              {isRequested ? "Update Request" : isDeclined ? "Re-submit Request" : "Submit Request"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setShowEarlyCheckIn(false)}
                              className="rounded-lg border border-gray-250 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 min-h-[38px]"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {isApproved && (
                        <button
                          type="button"
                          onClick={() => setShowEarlyCheckIn(false)}
                          className="inline-flex items-center justify-center rounded-lg border border-gray-250 px-4 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 min-h-[38px]"
                        >
                          Close
                        </button>
                      )}
                    </div>
                  );
                })()}
              </>
            ) : null}
          </div>
        )}

        {pointsEnabled && (
        <div className="space-y-4 rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 sm:p-6">
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
                  className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-3 transition hover:bg-gray-50 sm:px-4"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${
                      tx.points >= 0 ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                    }`}>
                      {tx.points >= 0 ? <CheckCircle2 size={14} /> : <ChevronRight size={14} className="rotate-180" />}
                    </div>
                    <div className="min-w-0">
                      <p className="break-words text-xs font-semibold text-gray-900">{tx.description}</p>
                      <p className="text-[10px] text-gray-400">{tx.date}</p>
                    </div>
                  </div>
                  <span className={`shrink-0 text-sm font-bold ${tx.points >= 0 ? "text-green-600" : "text-red-600"}`}>
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
