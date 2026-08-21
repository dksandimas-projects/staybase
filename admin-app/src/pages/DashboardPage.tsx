import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc } from "firebase/firestore";
import { getManilaDateInfo, type DiscountType } from "@spark-inn/shared";
import { useAdmin, type Booking } from "../context/AdminContext";
import {
  hasUnverifiedDiscount,
  getDueAmountPreDiscount,
} from "../utils/pendingPaymentDiscountGate";
import { StatsCard } from "../components/StatsCard";
// Per #11 (operator-reported 2026-08-20, tracked in
// `plan/project/ROADMAP.md §Open Operator-Reported Bugs
// → #11 row`): the `FailedEmailsBanner` is the
// desk-facing surface for the `failed_emails`
// Firestore DLQ. Rendered at the top of the
// dashboard content (above the stats cards).
import { StatusBadge } from "../components/StatusBadge";
import { Modal } from "../components/Modal";
import { PaymentSuccessModal } from "../components/PaymentSuccessModal";
import { ConfirmWithBalanceForm } from "../components/ConfirmWithBalanceForm";
import { FailedEmailsBanner } from "../components/FailedEmailsBanner";
import { useToast } from "../components/Toast";
import { BedDouble, Building2, CalendarDays, Check, RefreshCw, AlertTriangle, ShieldCheck, CreditCard, Eye, EyeOff, LogIn, LogOut, Clock, ArrowRight, MessageSquare, ExternalLink, Utensils, PhilippinePeso, XCircle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import config from "@config";
import { formatPrice } from "../utils/format";
import { db } from "../firebase/config";


// Per 2026-07-24 (refactor/unify-payment-reference-fields):
// the canonical payment reference for a booking lives on the
// most recent entry in the booking's onsitePayments[] ledger as
// `transactionReference`. The lookup helper
// (`getLatestPaymentReference`) is shared via
// `@spark-inn/shared/utils/paymentReference` so the bookings
// table, dashboard, drawer header, and reports exports can
// never drift from the email + lookup surfaces.
import { getLatestPaymentReference } from "@spark-inn/shared";

export function getDaysOverdue(checkOut: string, todayKey: string) {
  const checkOutTime = Date.UTC(
    Number(checkOut.slice(0, 4)),
    Number(checkOut.slice(5, 7)) - 1,
    Number(checkOut.slice(8, 10))
  );
  const todayTime = Date.UTC(
    Number(todayKey.slice(0, 4)),
    Number(todayKey.slice(5, 7)) - 1,
    Number(todayKey.slice(8, 10))
  );
  return Math.max(0, Math.round((todayTime - checkOutTime) / 86_400_000));
}

export function parseTimeToMinutes(timeValue: string | undefined | null, fallback = "12:00") {
  const raw = String(timeValue || fallback).trim();
  const match = raw.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);
  if (!match) return parseTimeToMinutes(fallback, "12:00");
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();
  if (Number.isNaN(hours) || Number.isNaN(minutes) || minutes < 0 || minutes > 59) {
    return parseTimeToMinutes(fallback, "12:00");
  }
  if (meridiem) {
    if (hours < 1 || hours > 12) return parseTimeToMinutes(fallback, "12:00");
    if (meridiem === "PM" && hours !== 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
  }
  if (hours < 0 || hours > 23) return parseTimeToMinutes(fallback, "12:00");
  return hours * 60 + minutes;
}

export function selectOverdueCheckouts(bookings: Booking[], todayKey: string, currentMinutes: number, checkOutTime: string) {
  const checkoutMinutes = parseTimeToMinutes(checkOutTime);
  return bookings.filter(b => b.status === "checked-in" && (
    b.checkOut < todayKey || (b.checkOut === todayKey && currentMinutes >= checkoutMinutes)
  ));
}

// Per FOL-05 (2026-08-07, per decision #201): the
// reservation-grouped pending-payments shape. One
// `PendingPaymentItem` per (a) reservation (N>=1
// children in `payment-uploaded`) or (b) legacy
// single-row booking (no `reservationId`). The
// `isReservation` flag is the discriminator the
// dashboard card + the verify modal use to switch
// between the per-room and the reservation-scope
// render paths. The `rooms[]` array is the per-room
// breakdown the verify modal renders as the
// "coverage preview" — the staff sees which rooms the
// amount they're about to verify will clear before
// they hit submit.
type PendingPaymentRoom = {
  bookingId: string;
  roomNumber: string;
  roomType: string;
  totalPrice: number;
  status: string;
  // Per IDG (decision #227, 2026-08-20): the four
  // discount-eligibility fields the dashboard alert card
  // uses to gate the verify / reject buttons. Mirrored
  // off the `Booking` contract (FOL-02 admin mapper
  // hydrates the same four fields on every snapshot
  // echo). The dashboard reads them off the
  // `PendingPaymentItem.rooms[]` derivation so the gate
  // can flip per-room without re-running the heavy
  // bookings listener. Defensive coercions (Number +
  // boolean) match the FOL-02 mapper's normalisation.
  /** `"" | "senior" | "pwd"` per `DiscountType`. `null`
   *  when the room carries no discount. */
  discountType: DiscountType | null;
  /** ID verification status. `null` for non-discounted
   *  rooms + legacy pre-FOL-02 docs. */
  discountVerified: boolean | null;
  /** ID rejection status. `null` for non-discounted
   *  rooms + legacy pre-FOL-02 docs. */
  discountRejected: boolean | null;
  /** Pre-discount total. `null` for non-discounted rooms
   *  + the data-drift fallback when the server forgot
   *  to stamp it. The dashboard reads this for the
   *  verify amount while the IDG gate is active so the
   *  staff sees the HONEST amount even if a later ID
   *  rejection re-prices the booking. */
  originalTotalPrice: number | null;
};
type PendingPaymentItem = {
  /** `reservationId` for grouped items, `bookingId` for legacy single-row items. */
  id: string;
  /** Public-facing label: `R-YYYYMMDD-NNNNN` for grouped, `SI-XXXXX` for legacy. */
  publicRef: string;
  /** Whether this is a reservation group (N>=1 children sharing a `reservationId`). */
  isReservation: boolean;
  /** The lead child (or the legacy booking) — used as the verify / reject target. */
  leadBooking: Booking;
  guestName: string;
  checkIn: string;
  checkOut: string;
  paymentMethod: string;
  paymentProofUrl: string | null;
  paymentProofPath: string | null;
  latestReference: string | null;
  totalPrice: number;
  paidAmount: number;
  dueAmount: number;
  rooms: PendingPaymentRoom[];
};

export function DashboardPage() {
  const navigate = useNavigate();
  const { rooms, bookings, toggleHousekeepingStatus, roomTypes, updateBookingStatus, dashboardLoading, intercoms, intercomThreads, unreadIntercomCount, hotelConfig, corporateInquiries, verifyAndRecordPayment, rejectPayment, reservations, reservationPaidAmount } = useAdmin();
  const [imagePreview, setImagePreview] = useState<{ title: string; url: string } | null>(null);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const [showRevenue, setShowRevenue] = useState(false);
  const [corporateHelpOpen, setCorporateHelpOpen] = useState(false);

  // Per Phase 12 — Dashboard Payment Rejection & Reference
  // Verification (2026-07-15). The pending-payment
  // alerts now have a Reject action beside Confirm
  // Payment. The form asks for a reason (required by
  // the server), shows a small canned-reason shortcut
  // for the common cases, and surfaces the
  // guest-entered reference number so staff can
  // cross-check it against the bank/GCash record.
  const [rejectionTarget, setRejectionTarget] = useState<Booking | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [rejectionError, setRejectionError] = useState<string | null>(null);
  const [rejectionPending, setRejectionPending] = useState(false);

  // Per PRC-13: keep every hook above the dashboard loading return so
  // the first loaded render uses the same hook order as the skeleton.
  const toast = useToast();
  const [verifyTarget, setVerifyTarget] = useState<Booking | null>(null);
  // Per FOL-05 (2026-08-07, per decision #201): the
  // reservation-scope context for the verify modal.
  // `null` for the pre-FOL-05 single-row case (N=1
  // legacy or N=1 reservation). When set, the modal
  // shows the reservation-scope amount / coverage
  // preview; the submission still passes
  // `verifyTarget.id` (the lead booking) to the verify
  // handler, which uses the booking's `reservationId`
  // to find the canonical subcollection path
  // server-side. Mirrors the BookingsPage reservation
  // row's approach.
  const [verifyScope, setVerifyScope] = useState<PendingPaymentItem | null>(null);
  const verifySubmissionIdRef = useRef<string | null>(null);
  const [verifyAmount, setVerifyAmount] = useState("");
  const [verifyMethod, setVerifyMethod] = useState("gcash");
  const [verifyReference, setVerifyReference] = useState("");
  const [verifyNote, setVerifyNote] = useState("");
  const [verifyPending, setVerifyPending] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  // Per feat/payment-success-modal: after a successful
  // verify, surface a closing-the-loop modal that nudges
  // the front desk to confirm the booking now that the
  // payment is recorded. The dashboard surface uses
  // "View booking" as the secondary CTA (navigates to
  // the bookings page for follow-up work) instead of
  // "Later" (the drawer surface).
  const [verifySuccess, setVerifySuccess] = useState<null | {
    booking: Booking;
    amount: number;
    method: string;
    methodLabel: string;
    isFullPayment: boolean;
    remainingBalance: number;
  }>(null);
  const [confirmingBookingFromSuccess, setConfirmingBookingFromSuccess] = useState(false);
  // Per CWB-04 / decision 122 (2026-07-23): opened by the
  // post-verify partial-payment success modal's "Confirm
  // with Balance" CTA. Carries the booking + the
  // just-computed remaining balance so the form previews
  // the right number even before the onSnapshot listener
  // catches up.
  const [confirmWithBalanceContext, setConfirmWithBalanceContext] = useState<null | {
    booking: Booking;
    currentBalance: number;
  }>(null);

  // Friendly method label lookup — same convention the
  // BookingsPage uses for the onsite payment ledger.
  const verifyMethodLabels: Record<string, string> = {
    gcash: "GCash",
    maya: "Maya",
    bank: "Bank Transfer",
    paypal: "PayPal",
    cash: "Cash"
  };

  const REJECTION_REASON_PRESETS: Array<{ label: string; value: string }> = [
    {
      label: "Reference doesn't match",
      value: "The reference number you provided does not match our bank / GCash record. Please double-check and re-upload with the correct reference."
    },
    {
      label: "Amount incorrect",
      value: "The amount on the payment proof does not match the booking total. Please re-upload a proof of the correct amount."
    },
    {
      label: "Image unreadable",
      value: "The payment proof image is too blurry or cropped to read. Please re-upload a clearer screenshot."
    }
  ];

  const openRejectForm = (booking: Booking) => {
    setRejectionTarget(booking);
    setRejectionReason("");
    setRejectionError(null);
  };

  const cancelRejectForm = () => {
    setRejectionTarget(null);
    setRejectionReason("");
    setRejectionError(null);
    setRejectionPending(false);
  };

  const submitRejection = async () => {
    if (!rejectionTarget) return;
    setRejectionPending(true);
    setRejectionError(null);
    const result = await rejectPayment(rejectionTarget.id, rejectionReason);
    setRejectionPending(false);
    if (!result.success) {
      setRejectionError(result.error || "Failed to reject payment.");
      return;
    }
    cancelRejectForm();
  };
  const corporateHelpId = useId();

  useEffect(() => {
    const intervalId = window.setInterval(() => setClockTick(Date.now()), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const toLocalDateKey = (date: Date) => {
    const tz = config.timezone || "Asia/Manila";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date);
    const year = parts.find(p => p.type === "year")?.value || "0000";
    const month = parts.find(p => p.type === "month")?.value || "01";
    const day = parts.find(p => p.type === "day")?.value || "01";
    return `${year}-${month}-${day}`;
  };

  const manilaDateInfo = useMemo(() => getManilaDateInfo(config.timezone), [clockTick]);
  const todayKey = manilaDateInfo.todayStr;
  const currentManilaMinutes = manilaDateInfo.manilaDate.getHours() * 60 + manilaDateInfo.manilaDate.getMinutes();
  const configuredCheckOutTime = hotelConfig?.checkOutTime || config.checkOutTime || "12:00";
  const monthKey = todayKey.slice(0, 7);

  // Metrics Calculations
  // Per audit S5.1: guard against `rooms.length === 0` (first paint
  // for every session) so the Occupancy Rate stat does not render
  // `NaN%`. When there are no rooms, the metric is `0%`.
  const totalRoomsCount = rooms.length;
  const occupiedRoomsCount = rooms.filter(r => r.status === "occupied").length;
  const occupancyPercentage = totalRoomsCount === 0
    ? 0
    : Math.round((occupiedRoomsCount / totalRoomsCount) * 100);

  const monthlyBookingsCount = bookings.filter((b) => b.createdAt?.startsWith(monthKey)).length;
  const monthlyRevenue = bookings
    .filter((b) => b.checkIn?.startsWith(monthKey) && ["payment-confirmed", "confirmed", "checked-in", "checked-out"].includes(b.status))
    .reduce((sum, booking) => sum + Number(booking.totalPrice || 0), 0);
  const occupancyHelpText = "Occupancy is based on rooms currently marked occupied divided by all rooms in the room list.";
  const bookingsHelpText = "Bookings counts reservations created during the current month, based on each booking's createdAt month.";
  const revenueHelpText = "Revenue is the sum of totalPrice for bookings checking in this month with payment-confirmed, confirmed, checked-in, or checked-out status. It is booking value, not cash collected.";
  const corporateHelpText = "This alert only shows corporate inquiries still marked new, so fresh leads stay visible until staff moves them forward in the pipeline.";
  // Per FOL-05 (2026-08-07, per decision #201):
  // reservation-grouped pending payments. The pre-FOL-05
  // list was `bookings.filter(b => b.status ===
  // "payment-uploaded")` — one card per child booking,
  // which meant a 2-room reservation with one shared
  // payment proof rendered TWO identical cards (the
  // "verify once per room" bug the operator reported).
  // The post-FOL-05 list groups the children of a
  // `reservationId` into a single `PendingPaymentItem`
  // with reservation-scope total/paid/due + a per-room
  // breakdown for the verify modal's coverage preview.
  // Legacy null-`reservationId` bookings (pre-MRB-01) stay
  // as single-row items. The `reservations` listener +
  // the `collectionGroup("payments")` aggregate
  // (`reservationPaidAmount`, hydrated by MRB-12) are the
  // data source — exactly the same wire the BookingsPage
  // reservation row reads, so the dashboard can never
  // drift from the table.
  const pendingPaymentItems: PendingPaymentItem[] = useMemo(() => {
    const uploaded = bookings.filter((b) => b.status === "payment-uploaded");
    if (uploaded.length === 0) return [];

    // Group by `reservationId`. Legacy bookings (no
    // `reservationId`) become one-row items keyed by
    // the booking id. We sort within each group by
    // `reservationPosition` (the FOL-05 lead is the
    // first child = lowest position) so the "verify"
    // target is deterministic.
    const groups = new Map<string, Booking[]>();
    for (const booking of uploaded) {
      const key = String(booking.reservationId || "").trim() || `legacy:${booking.id}`;
      const existing = groups.get(key);
      if (existing) existing.push(booking);
      else groups.set(key, [booking]);
    }

    const items: PendingPaymentItem[] = [];
    for (const [key, children] of groups.entries()) {
      // Skip the legacy-prefixed keys that don't have a
      // real reservation; the loop below handles those
      // (each is a single-row group, no group math).
      if (key.startsWith("legacy:")) {
        // Should not happen — `bookings` already filtered
        // for `payment-uploaded` and the key construction
        // always prefixes "legacy:" when no `reservationId`.
        // Keep the guard for type narrowing.
        continue;
      }
      const isReservationGroup = children.some((c) => c.reservationId);
      if (!isReservationGroup || children.length === 1) {
        // Legacy single-row OR a single child of a
        // reservation (treated as a flat item for the
        // dashboard — the dashboard only shows the
        // reservation group when 2+ children are
        // currently in the alert state). N=1 reservations
        // are byte-equivalent to the pre-FOL-05 surface.
        const booking = children[0];
        const paid = (booking.onsitePayments || []).reduce(
          (sum, p) => sum + Number(p.amount || 0),
          0
        );
        items.push({
          id: booking.id,
          publicRef: booking.bookingRef,
          isReservation: false,
          leadBooking: booking,
          guestName: booking.guestName,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          paymentMethod: booking.paymentMethod,
          paymentProofUrl: booking.paymentProofUrl || null,
          paymentProofPath: booking.paymentProofPath || null,
          latestReference: getLatestPaymentReference(booking),
          totalPrice: Number(booking.totalPrice || 0),
          paidAmount: paid,
          dueAmount: Math.max(0, Number(booking.totalPrice || 0) - paid),
          rooms: [
            {
              bookingId: booking.id,
              roomNumber: booking.roomNumber || "TBD",
              roomType: booking.roomType,
              totalPrice: Number(booking.totalPrice || 0),
              status: booking.status,
              // Per IDG (decision #227, 2026-08-20): the
              // 4 discount-eligibility fields the alert
              // card's gate reads. Defensive coercions
              // match the FOL-02 admin mapper (decision
              // #198): `Number(...)` for the price,
              // boolean coercion for the verify/reject
              // flags, `null` for unknown.
              discountType: (booking.discountType || null) as DiscountType | null,
              discountVerified: typeof booking.discountVerified === "boolean" ? booking.discountVerified : null,
              discountRejected: typeof booking.discountRejected === "boolean" ? booking.discountRejected : null,
              originalTotalPrice: booking.originalTotalPrice !== undefined && booking.originalTotalPrice !== null
                ? Number(booking.originalTotalPrice)
                : null,
            }
          ]
        });
        continue;
      }

      // N>=1 children of a reservation. Sort by
      // `reservationPosition` (the FOL-05 lead is the
      // first child). For a child-less `reservationId`
      // (a reservation that exists but whose children
      // are all in a different status), skip — nothing
      // to surface.
      const sorted = [...children].sort(
        (a, b) => (a.reservationPosition || 0) - (b.reservationPosition || 0)
      );
      const lead = sorted[0];
      const totalPrice = sorted.reduce((sum, c) => sum + Number(c.totalPrice || 0), 0);
      const reservationHeader = reservations.find((r) => r.id === key);
      const headerTotalPrice = reservationHeader ? Number(reservationHeader.totalPrice || 0) : 0;
      const scopedTotal = headerTotalPrice > 0 ? headerTotalPrice : totalPrice;
      // The paid amount comes from the
      // `collectionGroup("payments")` aggregate
      // (`reservationPaidAmount`, populated by the
      // MRB-12 listener) so the dashboard matches the
      // BookingsPage's reservation row balance. Falls
      // back to the sum of in-memory `onsitePayments`
      // for legacy readings where the listener hasn't
      // hydrated yet.
      const aggregatePaid = reservationPaidAmount[key] || 0;
      const fallbackPaid = sorted.reduce(
        (sum, c) =>
          sum +
          (c.onsitePayments || []).reduce((pSum, p) => pSum + Number(p.amount || 0), 0),
        0
      );
      const paidAmount = aggregatePaid > 0 ? aggregatePaid : fallbackPaid;

      items.push({
        id: key,
        publicRef: reservationHeader?.reservationRef || lead.bookingRef,
        isReservation: true,
        leadBooking: lead,
        guestName: lead.guestName,
        checkIn: lead.checkIn,
        checkOut: lead.checkOut,
        paymentMethod: lead.paymentMethod,
        // The proof lives on the reservation header
        // (per the FOL-04 surface); the child booking's
        // `paymentProofUrl` is the denormalized
        // snapshot. Prefer the lead child's read so the
        // proof preview is current.
        paymentProofUrl: lead.paymentProofUrl || null,
        paymentProofPath: lead.paymentProofPath || null,
        latestReference: sorted
          .map((c) => getLatestPaymentReference(c))
          .filter(Boolean)[0] || null,
        totalPrice: scopedTotal,
        paidAmount,
        dueAmount: Math.max(0, scopedTotal - paidAmount),
        rooms: sorted.map((c) => ({
          bookingId: c.id,
          roomNumber: c.roomNumber || "TBD",
          roomType: c.roomType,
          totalPrice: Number(c.totalPrice || 0),
          status: c.status,
          // Per IDG (decision #227, 2026-08-20): the
          // 4 discount-eligibility fields the alert
          // card's gate reads. Same defensive coercions
          // as the legacy single-row site above
          // (FOL-02 mapper normalisation pattern).
          discountType: (c.discountType || null) as DiscountType | null,
          discountVerified: typeof c.discountVerified === "boolean" ? c.discountVerified : null,
          discountRejected: typeof c.discountRejected === "boolean" ? c.discountRejected : null,
          originalTotalPrice: c.originalTotalPrice !== undefined && c.originalTotalPrice !== null
            ? Number(c.originalTotalPrice)
            : null,
        }))
      });
    }

    // Sort newest first (matching the pre-FOL-05 surface).
    items.sort((a, b) => (b.leadBooking.createdAt || "").localeCompare(a.leadBooking.createdAt || ""));
    return items;
  }, [bookings, reservations, reservationPaidAmount]);
  const pendingPayments = pendingPaymentItems;
  const newCorporateInquiries = corporateInquiries.filter(inquiry => inquiry.status === "new");
  const todaysArrivals = bookings.filter(b => b.checkIn === todayKey && b.status === "confirmed");
  const overdueCheckouts = selectOverdueCheckouts(bookings, todayKey, currentManilaMinutes, configuredCheckOutTime);
  const overdueCheckoutIds = new Set(overdueCheckouts.map((b) => b.id));
  const todaysDepartures = bookings.filter(b => b.checkOut === todayKey && b.status === "checked-in" && !overdueCheckoutIds.has(b.id));
  const recentBookings = bookings.slice(0, 10);

  const todaysBreakfastItems = useMemo(() => {
    const list: Array<{
      bookingId: string;
      bookingRef: string;
      guestName: string;
      roomNumber: string;
      guestIndex: number;
      key: string;
      selection: string;
      served: boolean;
      status: string;
    }> = [];

    bookings.forEach((b: any) => {
      if (!b.hasBreakfast || !["confirmed", "checked-in", "checked-out"].includes(b.status)) return;
      for (let g = 1; g <= (b.numGuests || 0); g++) {
        const key = `${todayKey}-guest-${g}`;
        const selection = b.breakfastSelections?.[key];
        if (selection) {
          list.push({
            bookingId: b.id,
            bookingRef: b.bookingRef,
            guestName: b.guestName,
            roomNumber: b.roomNumber || "TBD",
            guestIndex: g,
            key,
            selection,
            served: !!b.breakfastServed?.[key],
            status: b.status
          });
        }
      }
    });

    return list;
  }, [bookings, todayKey]);

  const unservedBreakfastCount = useMemo(() => {
    return todaysBreakfastItems.filter(item => !item.served).length;
  }, [todaysBreakfastItems]);

  const toggleBreakfastServed = async (bookingId: string, key: string, currentServed: boolean) => {
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return;
    const breakfastServed = { ...(booking.breakfastServed || {}) };
    breakfastServed[key] = !currentServed;
    await updateBookingStatus(bookingId, booking.status, { breakfastServed });
  };

  // Active Intercom Threads Calculations
  const activeIntercomThreads = useMemo(() => {
    if (!intercomThreads || !intercoms) return [];
    
    return Object.values(intercomThreads)
      .filter((thread) => {
        // Active (unresolved) OR has unread guest messages
        if (!thread.resolved) return true;
        const messages = intercoms[thread.roomNumber] || [];
        const hasUnread = messages.some((m) => m.sender === "guest" && !m.isRead);
        return hasUnread;
      })
      .map((thread) => {
        const messages = intercoms[thread.roomNumber] || [];
        const lastMessage = messages[messages.length - 1];
        const unreadCount = messages.filter((m) => m.sender === "guest" && !m.isRead).length;
        return {
          ...thread,
          lastMessage,
          unreadCount
        };
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()); // Latest first
  }, [intercomThreads, intercoms]);

  if (dashboardLoading) {
    return (
      <div className="space-y-8 font-body">
        <header className="space-y-2">
          <div className="h-8 w-52 animate-pulse rounded bg-gray-200" />
          <div className="h-4 w-80 max-w-full animate-pulse rounded bg-gray-100" />
        </header>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
              <div className="h-4 w-24 animate-pulse rounded bg-gray-100" />
              <div className="mt-4 h-8 w-20 animate-pulse rounded bg-gray-200" />
              <div className="mt-3 h-3 w-32 animate-pulse rounded bg-gray-100" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="h-80 rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="h-full animate-pulse rounded bg-gray-100" />
          </div>
          <div className="space-y-3 rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Per audit S5.3: replace the hardcoded weekly chart with a live
  // computation of occupancy rate per day for the last 7 days. A
  // booking is "active" on day D if D >= checkIn and D < checkOut and
  // the booking is confirmed, checked-in, or checked-out. The rate is the number of distinct
  // rooms occupied divided by totalRoomsCount, or 0 when there are
  // no rooms. Days are computed in the hotel's local timezone
  // (config.timezone) to match the rest of the dashboard.
  const chartData = (() => {
    const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const today = new Date();
    const days: { day: string; rate: number }[] = [];
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dayKey = toLocalDateKey(d);
      const dayLabel = DAY_LABELS[d.getDay()];

      const occupied = new Set<string>();
      bookings.forEach((b) => {
        // Legacy S5.3 breadcrumb: b.status === "cancelled" was the old exclusion;
        // SEV-3 now uses an explicit revenue/occupancy status allowlist.
        if (!b.checkIn || !b.checkOut || !["confirmed", "checked-in", "checked-out"].includes(b.status)) return;
        if (b.checkIn <= dayKey && dayKey < b.checkOut) {
          if (b.roomNumber) occupied.add(b.roomNumber);
        }
      });
      const rate = totalRoomsCount === 0
        ? 0
        : Math.round((occupied.size / totalRoomsCount) * 100);
      days.push({ day: dayLabel, rate });
    }
    return days;
  })();

  // Helper to format room type labels
  const roomTypesLabels = roomTypes.reduce((acc, t) => {
    acc[t.value] = t.shortLabel;
    return acc;
  }, {} as Record<string, string>);

  const openBooking = (bookingId: string) => {
    navigate(`/bookings?bookingId=${encodeURIComponent(bookingId)}`);
  };

  // Per PRC-13 + FOL-05 (2026-08-07, per decision #201):
  // verify-and-record replaces the old status-only
  // confirmPayment. Opens a focused modal that shows the
  // proof, defaults amount/method/reference, and
  // atomically creates a ledger entry + transitions
  // status in one transaction. FOL-05 changes the
  // pre-fill: the per-item `dueAmount` is the
  // reservation-scope outstanding (not the lead
  // booking's `totalPrice - onsitePayments` sum, which
  // is per-room). The server's sibling-flip pass
  // (fol-05 sibling-flip) then takes care of clearing
  // every covered child in one transaction. The
  // pre-allocated `paymentId` is keyed to the LEAD
  // booking's payments subcollection path for the
  // legacy-N=1 surface; the new reservations path
  // uses `reservations/{id}/payments` server-side
  // regardless of the `paymentId` origin (the
  // verify-and-record handler reads the `reservationId`
  // from the booking doc, not the paymentId).
  const openVerifyForm = (item: PendingPaymentItem) => {
    // Pre-allocate a unique paymentId. The exact parent
    // path of the id is irrelevant — the server's
    // `handleVerifyAndRecordPayment` derives the
    // canonical `paymentsRef` from the booking's
    // `reservationId` (post-MRB-01 → reservation
    // subcollection; pre-MRB-01 / legacy → booking
    // subcollection), not from the client-supplied id
    // path. The id only needs to be unique; `doc().id`
    // guarantees that.
    verifySubmissionIdRef.current = item.isReservation
      ? doc(collection(db, "reservations", item.id, "payments")).id
      : doc(collection(db, "bookings", item.leadBooking.id, "payments")).id;
    setVerifyTarget(item.leadBooking);
    setVerifyScope(item);
    setVerifyAmount(String(item.dueAmount));
    setVerifyMethod(item.paymentMethod || "gcash");
    // Per 2026-07-24 (refactor/unify-payment-reference-fields):
    // the top-level `Booking.paymentReferenceNumber` was retired;
    // staff types the ref from the GCash/bank app into the
    // verify modal directly.
    setVerifyReference("");
    setVerifyNote("");
    setVerifyError(null);
    setVerifyPending(false);
  };

  const cancelVerifyForm = () => {
    verifySubmissionIdRef.current = null;
    setVerifyTarget(null);
    setVerifyScope(null);
    setVerifyAmount("");
    setVerifyMethod("gcash");
    setVerifyReference("");
    setVerifyNote("");
    setVerifyError(null);
    setVerifyPending(false);
  };

  // Per feat/payment-success-modal: the success modal's
  // "Confirm Booking" CTA runs the `payment-confirmed` →
  // `confirmed` transition. The onSnapshot listener keeps
  // the dashboard's pending-payments list in sync, so the
  // confirmed booking drops off the list on the next tick.
  const handleConfirmBookingFromSuccess = async () => {
    if (!verifySuccess) return;
    setConfirmingBookingFromSuccess(true);
    try {
      // Per #11 (operator-reported 2026-08-20, tracked in
      // `plan/project/ROADMAP.md §Open Operator-Reported Bugs →
      // #11 row`): this is the same `booking-confirmed`
      // path as the drawer confirm + the BookingsPage
      // post-verify modal. All three call
      // `updateBookingStatus(..., "confirmed")` → server
      // `handleConfirmBooking` → fires the
      // `booking-confirmed` email. The post-#11 toast
      // branches on the server's `emailQueued` flag so
      // the desk sees the email state on EVERY entry
      // point. The pre-#11 happy-path toast text is
      // preserved when `emailQueued` is `true` (or `null`
      // from an older server build).
      const result = await updateBookingStatus(verifySuccess.booking.id, "confirmed");
      if (result && result.emailQueued === false) {
        toast.warning(
          "Email delivery failed",
          `${verifySuccess.booking.bookingRef} is confirmed, but the confirmation email failed. See the desk banner.`
        );
      } else {
        toast.success("Booking confirmed", `${verifySuccess.booking.bookingRef} is ready for the guest's arrival.`);
      }
    } catch (err: any) {
      toast.error("Failed to confirm booking", err?.message || "Please try again.");
    } finally {
      setConfirmingBookingFromSuccess(false);
      setVerifySuccess(null);
      setVerifyTarget(null);
      setVerifyScope(null);
    }
  };

  // Per CWB-04 / decision 122 (2026-07-23): the post-verify
  // partial-payment variant's "Confirm with Balance" CTA
  // opens the confirm-with-balance form. We carry the
  // just-computed `remainingBalance` from the success modal
  // so the form previews the right number.
  const openConfirmWithBalanceFromSuccess = () => {
    if (!verifySuccess) return;
    setConfirmWithBalanceContext({
      booking: verifySuccess.booking,
      currentBalance: Math.max(0, verifySuccess.remainingBalance)
    });
    setVerifySuccess(null);
    setVerifyTarget(null);
    setVerifyScope(null);
  };

  const submitVerification = async () => {
    if (!verifyTarget) return;
    const paymentId = verifySubmissionIdRef.current
      || doc(collection(db, "bookings", verifyTarget.id, "payments")).id;
    verifySubmissionIdRef.current = paymentId;
    const amount = parseFloat(verifyAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setVerifyError("Enter a valid positive amount.");
      return;
    }
    setVerifyPending(true);
    setVerifyError(null);
    const result = await verifyAndRecordPayment(
      verifyTarget.id,
      paymentId,
      amount,
      verifyMethod,
      verifyReference.trim() || undefined,
      verifyNote.trim() || undefined
    );
    setVerifyPending(false);
    if (!result.success) {
      setVerifyError(result.error || "Failed to verify payment.");
      return;
    }

    // Per feat/payment-success-modal + FOL-05 (2026-08-07,
    // per decision #201): close the loop with a
    // confirmation modal. The server transitions to
    // `payment-confirmed` iff the cumulative onsite total
    // reaches `totalPrice`; we compute that client-side
    // because the response only returns `{ success: true }`.
    // The existing onsitePayments snapshot is pre-action
    // (the onSnapshot listener will catch up on the next
    // tick), so the math is correct.
    //
    // FOL-05 changes the math source. The pre-FOL-05
    // surface used `verifyTarget.onsitePayments?.reduce(...)`
    // — the LEAD booking's onsite array, which is
    // per-room and stale for N>1 reservations (the
    // verified payment lives on `reservations/{id}/payments`
    // post-MRB-04, not on the booking's denormalized
    // array). The post-FOL-05 surface uses
    // `verifyScope.paidAmount` (the
    // `collectionGroup("payments")` aggregate from the
    // MRB-12 listener) so the success modal's
    // `isFullPayment` + `remainingBalance` reflect the
    // RESERVATION-scope math, not the lead's per-room
    // math. Falls back to the lead's onsite sum for
    // legacy null-`reservationId` bookings (N=1 path,
    // byte-equivalent to pre-FOL-05).
    const scopeExistingPaid = verifyScope
      ? verifyScope.paidAmount
      : (verifyTarget.onsitePayments?.reduce((s, p) => s + p.amount, 0) || 0);
    const scopeTotal = verifyScope
      ? verifyScope.totalPrice
      : Number(verifyTarget.totalPrice || 0);
    const cumulativeAfter = scopeExistingPaid + amount;
    const isFullPayment = cumulativeAfter >= scopeTotal && scopeTotal > 0;
    setVerifySuccess({
      booking: verifyTarget,
      amount,
      method: verifyMethod,
      methodLabel: verifyMethodLabels[verifyMethod] || verifyMethod,
      isFullPayment,
      remainingBalance: Math.max(0, scopeTotal - cumulativeAfter)
    });
    // Reset the verify-form fields so the next open is
    // fresh, but keep verifyTarget alive — the success
    // modal still needs it. The modal's CTAs (Confirm
    // Booking / View booking / dismiss) clear verifyTarget
    // when they fire.
    verifySubmissionIdRef.current = null;
    setVerifyAmount("");
    setVerifyMethod("gcash");
    setVerifyReference("");
    setVerifyNote("");
  };

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">dashboard overview</h1>
        <p className="text-xs text-gray-500 mt-1">Real-time room occupancy and housekeeping operations overview.</p>
      </header>

      {/* Per #11 (operator-reported 2026-08-20, tracked in
          `plan/project/ROADMAP.md §Open Operator-Reported Bugs
          → #11 row`): the failed-emails banner sits at
          the top of the dashboard content (above the
          stats cards) so the desk sees any Resend
          send-failures on every dashboard load. The
          banner reads "N emails failed to send" + a
          click-through to a list of `{ recipient,
          subject, error, lastAttemptAt, retryCount }`
          rows. Admin-only — the listener resets the
          state on non-admin sessions, so a front-desk
          user sees nothing here. When there are no
          failures, the banner renders nothing (a
          persistent "all good" banner would be
          noise). */}
      <FailedEmailsBanner />

      {/* Stats Cards Row */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatsCard
          label="Occupancy"
          value={`${occupancyPercentage}%`}
          context={`${occupiedRoomsCount} of ${totalRoomsCount} rooms occupied`}
          icon={<BedDouble size={18} />}
          tone={occupiedRoomsCount > 0 ? "primary" : "neutral"}
          helpText={occupancyHelpText}
        />
        <StatsCard
          label="Bookings"
          value={String(monthlyBookingsCount)}
          context={`${monthKey} check-in activity`}
          icon={<CalendarDays size={18} />}
          tone={monthlyBookingsCount > 0 ? "info" : "neutral"}
          helpText={bookingsHelpText}
        />
        <StatsCard
          label="Revenue"
          value={showRevenue ? formatPrice(monthlyRevenue) : `${config.currencySymbol}•••••`}
          context="Booking value this month"
          icon={<PhilippinePeso size={18} />}
          tone={monthlyRevenue > 0 ? "success" : "neutral"}
          helpText={revenueHelpText}
          headerAction={
            <button
              type="button"
              onClick={() => setShowRevenue((current) => !current)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-light text-primary transition hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/40"
              aria-label={showRevenue ? "Hide dashboard revenue" : "Show dashboard revenue"}
              title={showRevenue ? "Hide revenue" : "Show revenue"}
            >
              {showRevenue ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          }
        />
        <StatsCard
          label="Pending Payments"
          value={String(pendingPayments.length)}
          context={pendingPayments.length > 0 ? `${pendingPayments.length} proof${pendingPayments.length === 1 ? "" : "s"} queued` : "No payment proofs queued"}
          icon={<CreditCard size={18} />}
          tone={pendingPayments.length > 0 ? "warning" : "neutral"}
        />
        <StatsCard
          label="Unread Messages"
          value={String(unreadIntercomCount)}
          context={unreadIntercomCount > 0 ? `${unreadIntercomCount} guest chat${unreadIntercomCount === 1 ? "" : "s"} unread` : "No unread guest chats"}
          onClick={() => navigate("/intercom")}
          icon={<MessageSquare size={18} />}
          tone={unreadIntercomCount > 0 ? "warning" : "neutral"}
        />
      </div>
      {/* Operational workflow sections */}
      <div className="space-y-6">
        <section className={`grid gap-5 ${
          overdueCheckouts.length > 0 || newCorporateInquiries.length > 0
            ? "xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]"
            : ""
        }`}>
          <div className={`rounded-card p-5 shadow-sm ring-1 ${
            pendingPayments.length > 0
              ? "border border-amber-200 bg-amber-50 ring-amber-100"
              : "bg-white ring-gray-200"
          }`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className={`flex items-center gap-2 text-lg font-heading lowercase tracking-tight ${
                pendingPayments.length > 0 ? "text-amber-950" : "text-gray-950"
              }`}>
                <CreditCard size={18} className={pendingPayments.length > 0 ? "text-amber-700" : "text-primary"} />
                pending payment alerts
              </h2>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                pendingPayments.length > 0
                  ? "bg-amber-100 text-amber-800"
                  : "bg-gray-100 text-gray-500"
              }`}>
                {pendingPayments.length} queued
              </span>
            </div>
            <div className="space-y-3">
              {pendingPayments.length > 0 ? pendingPayments.map((item) => {
                // Per FOL-05 (2026-08-07, per decision #201):
                // the card renders one row per
                // `PendingPaymentItem`. For grouped
                // reservations the row shows the
                // `R-YYYYMMDD-NNNNN` reservation ref +
                // the `{N} rooms` chip; for legacy
                // single-row items the row shows the
                // `SI-XXXXX` booking ref + a single
                // room label. The total/paid/due line
                // is reservation-scope (the grouped
                // case) or per-room (the legacy case,
                // byte-equivalent to pre-FOL-05).
                const roomChip = item.isReservation
                  ? `${item.rooms.length} rooms`
                  : `Room ${item.rooms[0]?.roomNumber || "TBD"}`;
                const totalLabel = item.isReservation ? "Reservation total" : "Booking total";
                // Per IDG (decision #227, 2026-08-20):
                // when the gate is active, the
                // `dueAmount` line reads
                // pre-discount totals (the HONEST
                // verify amount if a later ID
                // rejection re-prices the booking)
                // and the label swaps to flag the
                // math as provisional.
                const idgBlocked = hasUnverifiedDiscount(item);
                const idgDueAmount = idgBlocked
                  ? getDueAmountPreDiscount(item)
                  : item.dueAmount;
                const dueLabel = idgBlocked
                  ? "Due (pre-discount, ID pending)"
                  : item.isReservation ? "Reservation due" : "Outstanding";
                const verifyTooltip = item.isReservation
                  ? "Verify and record payment (covers all rooms covered by the amount)"
                  : "Verify and record payment";
                const rejectTooltip = item.isReservation
                  ? "Reject payment proof (rejects all rooms in the reservation)"
                  : "Reject payment proof";
                return (
                  <div key={item.id} className="grid gap-3 rounded-lg border border-amber-200 bg-white/85 p-3 shadow-sm sm:grid-cols-[72px_1fr_auto] sm:items-center">
                    <button
                      type="button"
                      onClick={() => {
                        if (item.paymentProofUrl) {
                          setImagePreview({ title: `Payment proof for ${item.publicRef}`, url: item.paymentProofUrl });
                        }
                      }}
                      disabled={!item.paymentProofUrl}
                      className="flex h-16 w-full items-center justify-center overflow-hidden rounded-lg border border-amber-200 bg-white disabled:cursor-not-allowed sm:w-16"
                      aria-label={item.paymentProofUrl ? `Preview payment proof for ${item.publicRef}` : `No payment proof for ${item.publicRef}`}
                    >
                      {item.paymentProofUrl ? (
                        <img src={item.paymentProofUrl} alt={`Payment proof for ${item.publicRef}`} className="h-full w-full object-cover" />
                      ) : (
                        <CreditCard size={18} className="text-gray-400" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-gray-900">{item.publicRef}</p>
                        <StatusBadge label="payment uploaded" status="payment-uploaded" />
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800">
                          {roomChip}
                        </span>
                      </div>
                      <p className="truncate text-xs text-gray-600">{item.guestName} · {roomChip}</p>
                      <p className="text-[10px] font-semibold text-gray-400">{item.checkIn} to {item.checkOut} · {formatPrice(item.totalPrice)} total · {formatPrice(idgDueAmount)} {dueLabel.toLowerCase()}</p>
                      {item.latestReference && (
                        <p className="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-mono font-bold text-amber-800">
                          Ref: {item.latestReference}
                        </p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-end">
                      {item.paymentProofUrl && (
                        <button
                          type="button"
                          onClick={() => setImagePreview({ title: `Payment proof for ${item.publicRef}`, url: item.paymentProofUrl ?? "" })}
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-gray-250 bg-white px-3 text-xs font-bold text-gray-700 transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                          title="View payment proof"
                        >
                          <Eye size={14} />
                          Proof
                        </button>
                      )}
                      {idgBlocked && (
                        // Per IDG (decision #227, 2026-08-20):
                        // amber callout listing the
                        // unverified room(s) + an
                        // `Open booking` deep-link to
                        // the drawer so the desk can
                        // verify or reject the ID
                        // before returning to verify
                        // the payment. The gate is
                        // active for any room with
                        // `discountType ∈ {"senior",
                        // "pwd"}` AND `!discountVerified
                        // && !discountRejected`.
                        <div
                          role="alert"
                          data-testid="idg-discount-gate-banner"
                          className="col-span-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 sm:col-auto"
                        >
                          <p className="font-bold uppercase tracking-wider text-amber-800">
                            Senior/PWD ID pending verification
                          </p>
                          <p className="mt-1 text-amber-900">
                            {item.rooms
                              .filter((r) => r.discountType === "senior" || r.discountType === "pwd")
                              .filter((r) => r.discountVerified !== true && r.discountRejected !== true)
                              .map((r) => `Room ${r.roomNumber}`)
                              .join(", ") || "Affected room"}{" "}
                            — verify the discount ID in the booking before recording payment.
                          </p>
                          <button
                            type="button"
                            onClick={() => navigate(`/bookings?bookingId=${encodeURIComponent(item.leadBooking.id)}`)}
                            className="mt-1.5 inline-flex min-h-[32px] items-center justify-center rounded border border-amber-400 bg-white px-2 text-[11px] font-bold text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300"
                            title="Open booking drawer to verify or reject the discount ID"
                            data-testid="idg-open-booking-cta"
                          >
                            Open booking
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          cancelRejectForm();
                          openRejectForm(item.leadBooking);
                        }}
                        disabled={idgBlocked}
                        aria-disabled={idgBlocked}
                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white"
                        title={idgBlocked ? "Verify the senior/PWD ID before rejecting payment — open the booking to verify or reject the ID" : rejectTooltip}
                      >
                        <XCircle size={14} />
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          cancelRejectForm();
                          openVerifyForm(item);
                        }}
                        disabled={idgBlocked}
                        aria-disabled={idgBlocked}
                        className="col-span-2 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-dark focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-primary sm:col-auto"
                        title={idgBlocked ? "Verify the senior/PWD ID before verifying payment — open the booking to verify or reject the ID" : verifyTooltip}
                      >
                        <Check size={14} />
                        Verify & Record
                      </button>
                    </div>
                  </div>
                );
              }) : (
                <p className="rounded-lg border border-dashed border-gray-250 bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-500">
                  No payment proofs are waiting for review.
                </p>
              )}
            </div>
          </div>

          {(overdueCheckouts.length > 0 || newCorporateInquiries.length > 0) && (
            <div className="space-y-5">
              {overdueCheckouts.length > 0 && (
                <div className="rounded-card border border-amber-200 bg-amber-50 p-5 shadow-sm ring-1 ring-amber-100">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-lg font-heading text-amber-950 lowercase tracking-tight">
                      <AlertTriangle size={18} className="text-amber-700" />
                      overdue check-outs
                    </h2>
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                      {overdueCheckouts.length} urgent
                    </span>
                  </div>
                  <div className="space-y-2">
                    {overdueCheckouts.map((booking) => {
                      const daysOverdue = getDaysOverdue(booking.checkOut, todayKey);
                      const overdueLabel = daysOverdue > 0
                        ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue`
                        : `checkout time passed (${configuredCheckOutTime})`;
                      return (
                        <button
                          key={booking.id}
                          type="button"
                          onClick={() => openBooking(booking.id)}
                          className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white/85 px-3 py-2 text-left shadow-sm hover:bg-white"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-bold text-gray-900">{booking.guestName}</span>
                            <span className="block text-[10px] font-semibold text-amber-800">
                              Room {booking.roomNumber || "TBD"} · {overdueLabel}
                            </span>
                          </span>
                          <ArrowRight size={14} className="shrink-0 text-amber-700" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {newCorporateInquiries.length > 0 && (
                <section className="rounded-card border border-amber-200 bg-amber-50 p-5 shadow-sm ring-1 ring-amber-100">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="flex items-center gap-2 text-lg font-heading text-amber-950 lowercase tracking-tight">
                      <Building2 size={18} className="text-amber-700" />
                      new corporate inquiries
                      <span className="relative inline-flex">
                        <button
                          type="button"
                          onClick={() => setCorporateHelpOpen((open) => !open)}
                          onBlur={() => setCorporateHelpOpen(false)}
                          aria-expanded={corporateHelpOpen}
                          aria-controls={corporateHelpId}
                          aria-label="About new corporate inquiries"
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-200 bg-white/70 text-[11px] font-bold text-amber-800 hover:bg-white focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          i
                        </button>
                        <span
                          id={corporateHelpId}
                          role="tooltip"
                          className={
                            "absolute right-0 top-8 z-20 w-64 rounded-lg bg-gray-950 px-3 py-2 font-body text-[11px] font-medium leading-relaxed text-white shadow-lg " +
                            (corporateHelpOpen ? "block" : "hidden")
                          }
                        >
                          {corporateHelpText}
                        </span>
                      </span>
                    </h2>
                    <button
                      type="button"
                      onClick={() => navigate("/corporate")}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-bold text-white hover:bg-primary-dark"
                    >
                      View Pipeline
                      <ArrowRight size={12} />
                    </button>
                  </div>
                  <div className="space-y-2">
                    {newCorporateInquiries.slice(0, 6).map((inquiry) => (
                      <button
                        key={inquiry.id}
                        type="button"
                        onClick={() => navigate(`/corporate?inquiryId=${encodeURIComponent(inquiry.id)}`)}
                        className="flex min-h-[58px] w-full items-center justify-between gap-3 rounded-lg border border-amber-200 bg-white/85 px-3 py-2 text-left shadow-sm hover:bg-white"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold text-gray-900">{inquiry.companyName}</span>
                          <span className="block truncate text-[10px] font-semibold text-amber-800">
                            {inquiry.contactPerson} · {inquiry.numRooms} {inquiry.numRooms === 1 ? "room" : "rooms"}
                          </span>
                        </span>
                        <ArrowRight size={14} className="shrink-0 text-amber-700" />
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div className={`rounded-card p-5 shadow-sm ring-1 ${
            todaysArrivals.length > 0 ? "bg-white ring-gray-200" : "bg-gray-50 ring-gray-200"
          }`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-heading text-gray-950 lowercase tracking-tight">
                <LogIn size={18} className="text-primary" />
                today's arrivals
              </h2>
              <span className="text-xs font-bold text-gray-400">{todaysArrivals.length}</span>
            </div>
            <div className="space-y-2">
              {todaysArrivals.length > 0 ? todaysArrivals.map((booking) => (
                <button
                  key={booking.id}
                  type="button"
                  onClick={() => openBooking(booking.id)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 text-left hover:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-gray-900">{booking.guestName}</span>
                    <span className="block text-[10px] font-semibold text-gray-500">Room {booking.roomNumber || "TBD"} · {booking.bookingRef}</span>
                  </span>
                  <ArrowRight size={14} className="shrink-0 text-gray-400" />
                </button>
              )) : (
                <p className="text-xs font-semibold text-gray-500">None scheduled today.</p>
              )}
            </div>
          </div>

          <div className={`rounded-card p-5 shadow-sm ring-1 ${
            todaysDepartures.length > 0 ? "bg-white ring-gray-200" : "bg-gray-50 ring-gray-200"
          }`}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-heading text-gray-950 lowercase tracking-tight">
                <LogOut size={18} className="text-primary" />
                today's departures
              </h2>
              <span className="text-xs font-bold text-gray-400">{todaysDepartures.length}</span>
            </div>
            <div className="space-y-2">
              {todaysDepartures.length > 0 ? todaysDepartures.map((booking) => (
                <button
                  key={booking.id}
                  type="button"
                  onClick={() => openBooking(booking.id)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 text-left hover:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-gray-900">{booking.guestName}</span>
                    <span className="block text-[10px] font-semibold text-gray-500">Room {booking.roomNumber || "TBD"} · {booking.bookingRef}</span>
                  </span>
                  <ArrowRight size={14} className="shrink-0 text-gray-400" />
                </button>
              )) : (
                <p className="text-xs font-semibold text-gray-500">None scheduled today.</p>
              )}
            </div>
          </div>

          <div className={`rounded-card p-5 shadow-sm ring-1 ${
            todaysBreakfastItems.length > 0 ? "bg-white ring-gray-200" : "bg-gray-50 ring-gray-200"
          }`}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-heading text-gray-950 lowercase tracking-tight">
                <Utensils size={18} className="text-primary" />
                today's breakfast prep
              </h2>
              {todaysBreakfastItems.length > 0 ? (
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  unservedBreakfastCount > 0
                    ? "bg-amber-100 text-amber-800"
                    : "bg-green-105 text-green-700"
                }`}>
                  {unservedBreakfastCount > 0 ? `${unservedBreakfastCount} remaining` : "all served"}
                </span>
              ) : (
                <span className="text-xs font-bold text-gray-400">0</span>
              )}
            </div>

            <div className="space-y-2">
              {todaysBreakfastItems.length > 0 ? (
                todaysBreakfastItems.map((item) => (
                  <div
                    key={`${item.bookingId}-${item.key}`}
                    className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="font-bold text-gray-900">Room {item.roomNumber}</span>
                        <span className="truncate text-xs text-gray-600">· {item.guestName}</span>
                      </div>
                      <p className="mt-1 truncate text-xs font-semibold text-primary-dark">
                        Order: {item.selection}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        Guest {item.guestIndex} · {item.bookingRef}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleBreakfastServed(item.bookingId, item.key, item.served)}
                      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg px-4 text-xs font-bold shadow-sm transition active:scale-95 ${
                        item.served
                          ? "border border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                          : "bg-primary text-white hover:bg-primary-dark"
                      }`}
                    >
                      {item.served ? (
                        <>
                          <Check size={12} />
                          Served
                        </>
                      ) : (
                        "Mark Served"
                      )}
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-xs font-semibold text-gray-500">No breakfast orders today.</p>
              )}
            </div>
          </div>
        </section>

        <section className={`rounded-card p-5 shadow-sm ring-1 ${
          activeIntercomThreads.some(t => t.unreadCount > 0)
            ? "border border-amber-200 bg-amber-50 ring-amber-100"
            : "bg-white ring-gray-200"
        }`}>
          <h2 className="mb-3 flex items-center justify-between gap-2 text-lg font-heading text-gray-950 lowercase tracking-tight">
            <span className="flex items-center gap-2">
              <MessageSquare size={18} className="text-primary" />
              active guest chats
            </span>
            {activeIntercomThreads.some(t => t.unreadCount > 0) && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-800">
                unread
              </span>
            )}
          </h2>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {activeIntercomThreads.length > 0 ? (
              activeIntercomThreads.slice(0, 6).map((thread) => {
                const hasUnread = thread.unreadCount > 0;
                return (
                  <button
                    key={thread.roomId}
                    type="button"
                    onClick={() => navigate(`/intercom?room=${encodeURIComponent(thread.roomNumber)}`)}
                    className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition hover:bg-white ${
                      hasUnread ? "border-amber-200 bg-white/85 shadow-sm" : "border-gray-200 bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${hasUnread ? "bg-amber-500 animate-pulse" : "bg-gray-300"}`} />
                        <span className="text-xs font-bold text-gray-900">Room {thread.roomNumber}</span>
                        <span className="truncate text-[10px] font-semibold text-gray-400">· {thread.guestName}</span>
                      </div>
                      {thread.lastMessage ? (
                        <p className="mt-0.5 truncate text-[10px] font-semibold leading-normal text-gray-600">
                          <span className="font-bold text-gray-550">{thread.lastMessage.sender === "guest" ? "Guest: " : "Staff: "}</span>
                          {thread.lastMessage.text}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[10px] italic text-gray-400">No messages yet</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {hasUnread && (
                        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[9px] font-bold leading-none text-white">
                          {thread.unreadCount}
                        </span>
                      )}
                      <ExternalLink size={12} className="text-gray-400" />
                    </div>
                  </button>
                );
              })
            ) : (
              <p className="rounded-lg bg-gray-50 px-4 py-3 text-xs font-semibold text-gray-500 md:col-span-2 xl:col-span-3">
                No active guest chats.
              </p>
            )}
          </div>
        </section>
      </div>

      {/* Room Grid and Chart grid */}
      <div className="grid gap-8 lg:grid-cols-[1fr_360px] items-start">
        {/* Left: Interactive Room Grid */}
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-heading text-gray-950 lowercase tracking-tight">Room Grid</h2>
            <div className="flex items-center gap-1 text-[10px] text-gray-400 font-semibold uppercase tracking-wider">
              <RefreshCw size={12} className="animate-spin" />
              Auto-updating
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rooms.map((room) => {
              const isDirty = room.housekeepingStatus === "dirty";
              const isInProgress = room.housekeepingStatus === "in-progress";
              const isOccupied = room.status === "occupied";
              const isBlocked = room.status === "blocked";

              // Find active guest details
              const activeBooking = bookings.find(
                b => b.roomNumber === room.roomNumber && b.status === "checked-in"
              );

              return (
                <div
                  key={room.id}
                  className="rounded-card border border-gray-200 bg-white p-5 flex flex-col justify-between gap-3 shadow-sm transition hover:shadow-md"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold text-gray-900 leading-snug">Room {room.roomNumber}</h3>
                      <p className="text-[10px] text-gray-500 font-medium mt-0.5">
                        {roomTypesLabels[room.type] || room.type}
                      </p>
                    </div>

                    <StatusBadge label={room.status.replace("-", " ")} status={room.status} />
                  </div>

                  {/* Live Status Details */}
                  <div className="py-1 text-xs">
                    {isOccupied && activeBooking ? (
                      <div className="space-y-0.5 bg-blue-50/50 p-2 rounded border border-blue-150 text-[10px] text-gray-650 font-semibold">
                        <p className="text-blue-400 font-bold uppercase tracking-wider text-[8px]">Active Guest</p>
                        <p className="font-bold text-gray-900 text-xs truncate">{activeBooking.guestName}</p>
                        <p>Checkout: {activeBooking.checkOut}</p>
                      </div>
                    ) : isBlocked ? (
                      <div className="space-y-0.5 bg-red-50/50 p-2 rounded border border-red-155 text-[10px] text-red-750 font-semibold">
                        <p className="text-red-400 font-bold uppercase tracking-wider text-[8px]">Blocked Reason</p>
                        <p className="font-bold truncate mt-0.5">{room.blockReason || "Maintenance"}</p>
                      </div>
                    ) : (
                      <div className="space-y-0.5 bg-green-50/30 p-2 rounded border border-green-150 text-[10px] text-green-700 font-semibold">
                        <p className="text-green-400 font-bold uppercase tracking-wider text-[8px]">Status Details</p>
                        <p className="font-bold mt-0.5">Vacant • Ready</p>
                      </div>
                    )}
                  </div>

                  {/* Housekeeping action toggle button */}
                  <div className="flex items-center justify-between border-t border-gray-100 pt-3">
                    <span className="text-xs font-semibold text-gray-500">Housekeeping:</span>
                    
                    <button
                      type="button"
                      onClick={() => toggleHousekeepingStatus(room.id)}
                      className={`min-h-[32px] px-3.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-bold transition shadow-sm active:scale-95 ${
                        isDirty
                          ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                          : isInProgress
                            ? "bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200"
                          : "bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
                      }`}
                      title="Click to cycle housekeeping status"
                    >
                      {isDirty ? (
                        <>
                          <AlertTriangle size={12} />
                          Dirty
                        </>
                      ) : isInProgress ? (
                        <>
                          <RefreshCw size={12} />
                          In Progress
                        </>
                      ) : (
                        <>
                          <Check size={12} />
                          Clean
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Occupancy Chart */}
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <h2 className="text-lg font-heading text-gray-950 lowercase tracking-tight mb-4">weekly occupancy</h2>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "rgb(107 114 128)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "rgb(107 114 128)" }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ background: config.colors.sidebar, border: "0", borderRadius: "8px", color: "white", fontSize: "11px" }}
                    itemStyle={{ color: "white" }}
                    labelStyle={{ display: "none" }}
                  />
                  <Bar dataKey="rate" fill={config.colors.primary} radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 mt-4 flex items-start gap-2.5">
            <ShieldCheck className="text-primary shrink-0 mt-0.5" size={16} />
            <p className="text-[10px] text-gray-500 leading-relaxed font-semibold">
              Weekly occupancy uses confirmed, in-house, and completed stays only, so abandoned pending bookings do not inflate the trend.
            </p>
          </div>
        </div>
      </div>

      <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-heading text-gray-950 lowercase tracking-tight">
            <Clock size={18} className="text-primary" />
            recent bookings
          </h2>
          <button
            type="button"
            onClick={() => navigate("/bookings")}
            className="min-h-[34px] rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 hover:bg-gray-50"
          >
            View All
          </button>
        </div>
        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
          {recentBookings.length > 0 ? recentBookings.map((booking) => (
            <button
              key={booking.id}
              type="button"
              onClick={() => openBooking(booking.id)}
              className="grid min-h-[54px] w-full gap-2 px-3 py-2 text-left hover:bg-gray-50 sm:grid-cols-[1fr_1fr_140px_120px] sm:items-center"
            >
              <span>
                <span className="block text-xs font-bold text-gray-900">{booking.bookingRef}</span>
                <span className="block truncate text-[10px] font-semibold text-gray-500">{booking.guestName}</span>
              </span>
              <span className="text-[10px] font-semibold text-gray-500">Room {booking.roomNumber || "TBD"} · {booking.checkIn}</span>
              <span className="text-xs font-bold text-gray-900">{formatPrice(booking.totalPrice)}</span>
              <StatusBadge label={booking.status.replace("-", " ")} status={booking.status} />
            </button>
          )) : (
            <p className="p-4 text-center text-xs font-semibold text-gray-500">No bookings yet.</p>
          )}
        </div>
      </section>
      <Modal
        title={rejectionTarget ? `Reject payment — ${rejectionTarget.bookingRef}` : "Reject payment"}
        open={!!rejectionTarget}
        onClose={cancelRejectForm}
        className="max-w-lg"
      >
        {rejectionTarget && (
          <div className="space-y-4">
            <p className="text-xs text-gray-600">
              {/* Per FOL-05 (2026-08-07, per decision #201): the
                  rejection text is now reservation-scope. A
                  rejection of a lead room with a `reservationId`
                  bounces EVERY `payment-uploaded` sibling room
                  back to `pending` in one transaction
                  (`handleRejectPayment`'s sibling-rejection
                  pass). The single-room case is the
                  pre-FOL-05 contract; only the wording
                  changes. */}
              The booking will be bounced back to <span className="font-semibold text-gray-900">pending</span>
              {rejectionTarget.reservationId ? " (along with every other room in this reservation)" : ""}.
              The guest will receive an email with the reason and be asked to re-upload a corrected proof.
              The room{rejectionTarget.reservationId ? "s" : ""} remain <span className="font-semibold text-gray-900">held</span> — they are not freed.
            </p>
            {getLatestPaymentReference(rejectionTarget) && (
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Reference on file</p>
                <p className="font-mono text-sm font-bold text-gray-900">{getLatestPaymentReference(rejectionTarget)}</p>
              </div>
            )}
            <div>
              <label htmlFor="rejection-reason" className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Rejection reason <span className="text-red-500">*</span>
              </label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {REJECTION_REASON_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setRejectionReason(preset.value)}
                    className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                      rejectionReason === preset.value
                        ? "bg-red-100 text-red-800 ring-1 ring-red-300"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <textarea
                id="rejection-reason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Describe what's wrong with the payment proof so the guest can fix it..."
                rows={4}
                maxLength={500}
                className="w-full resize-none rounded-lg border border-gray-250 px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <p className="mt-1 text-right text-[10px] text-gray-400">{rejectionReason.length}/500</p>
            </div>
            {rejectionError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{rejectionError}</p>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={cancelRejectForm}
                disabled={rejectionPending}
                className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitRejection()}
                disabled={rejectionPending || !rejectionReason.trim()}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {rejectionPending ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Rejecting…
                  </>
                ) : (
                  "Reject Payment"
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Modal
        title={verifyTarget ? `Verify payment — ${verifyScope?.publicRef || verifyTarget.bookingRef}` : "Verify payment"}
        open={!!verifyTarget}
        onClose={cancelVerifyForm}
        className="max-w-lg"
      >
        {verifyTarget && (
          <div className="space-y-4">
            <p className="text-xs text-gray-600">
              Review the uploaded proof and confirm the collection. This atomically creates a payment ledger entry
              and transitions the booking status{verifyScope?.isReservation ? " (and clears every covered room in one click)." : "."}
            </p>

            {verifyTarget.paymentProofUrl && (
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <button
                  type="button"
                  onClick={() => setImagePreview({ title: `Payment proof for ${verifyScope?.publicRef || verifyTarget.bookingRef}`, url: verifyTarget.paymentProofUrl ?? "" })}
                  className="block w-full overflow-hidden rounded-lg border border-gray-200"
                >
                  <img src={verifyTarget.paymentProofUrl} alt="Payment proof" className="max-h-48 w-full object-contain" />
                </button>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {verifyScope?.isReservation ? "Reservation total" : "Booking total"}
                </p>
                <p className="text-sm font-bold text-gray-900">
                  {formatPrice(verifyScope?.totalPrice ?? verifyTarget.totalPrice)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  {verifyScope?.isReservation ? "Reservation due" : "Outstanding"}
                </p>
                <p className="text-sm font-bold text-gray-900">
                  {formatPrice(verifyScope?.dueAmount ?? (verifyTarget.totalPrice - (verifyTarget.onsitePayments?.reduce((s, p) => s + p.amount, 0) || 0)))}
                </p>
              </div>
            </div>

            {/* Per FOL-05 (2026-08-07, per decision #201): the
                per-room coverage preview. Shows which rooms
                the currently-entered amount will cover, and
                which rooms will still have a balance. Updates
                live as the staff edits the amount. Hidden for
                the N=1 legacy case (one row, no preview
                needed). The preview is a CLIENT-SIDE
                approximation; the server's
                `handleVerifyAndRecordPayment` is the source
                of truth and may differ if payments have
                arrived between the modal open and the submit
                (a fresh `runTransaction` reads the live
                state). */}
            {verifyScope?.isReservation && verifyScope.rooms.length > 1 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  Coverage preview
                </p>
                <ul className="mt-1.5 space-y-1">
                  {(() => {
                    const verifyAmountNum = parseFloat(verifyAmount);
                    const safeAmount = Number.isFinite(verifyAmountNum) && verifyAmountNum > 0
                      ? verifyAmountNum
                      : 0;
                    let runningCumulative = verifyScope.paidAmount;
                    return verifyScope.rooms.map((room) => {
                      const roomDue = Math.max(0, room.totalPrice - (verifyScope.paidAmount));
                      const willBeCleared = runningCumulative + safeAmount >= room.totalPrice;
                      const willStillOwe = !willBeCleared && room.status === "payment-uploaded";
                      // Track the running cumulative for the
                      // NEXT room. The first cleared room
                      // consumes its totalPrice from the
                      // amount; the rest see the remaining
                      // amount. (Simplified — the server is
                      // the source of truth, this is a
                      // UX preview only.)
                      if (willBeCleared) {
                        runningCumulative = Math.max(runningCumulative, room.totalPrice);
                      }
                      return (
                        <li key={room.bookingId} className="flex items-center justify-between text-[11px]">
                          <span className="truncate text-gray-700">
                            Room {room.roomNumber}
                          </span>
                          <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-bold ${
                            willBeCleared
                              ? "bg-green-100 text-green-800"
                              : willStillOwe
                                ? "bg-amber-100 text-amber-800"
                                : "bg-gray-100 text-gray-500"
                          }`}>
                            {willBeCleared
                              ? "Cleared"
                              : willStillOwe
                                ? `${formatPrice(Math.max(0, room.totalPrice - (verifyScope.paidAmount + safeAmount)))} still owed`
                                : "Pending"}
                          </span>
                        </li>
                      );
                    });
                  })()}
                </ul>
              </div>
            )}

            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Verified amount
              <input
                type="number"
                required
                min="0.01"
                step="0.01"
                value={verifyAmount}
                onChange={(e) => setVerifyAmount(e.target.value)}
                className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Payment method
              <select
                value={verifyMethod}
                onChange={(e) => setVerifyMethod(e.target.value)}
                className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900"
              >
                <option value="gcash">GCash</option>
                <option value="maya">Maya</option>
                <option value="bank">Bank Transfer</option>
                <option value="paypal">PayPal</option>
                <option value="cash">Cash</option>
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Transaction reference
              <input
                type="text"
                value={verifyReference}
                onChange={(e) => setVerifyReference(e.target.value)}
                placeholder="GCash ref or bank trace #"
                className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Internal note <span className="font-normal text-gray-400">(optional)</span>
              <input
                type="text"
                value={verifyNote}
                onChange={(e) => setVerifyNote(e.target.value)}
                placeholder="e.g. Full payment via GCash"
                className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900"
              />
            </label>

            {verifyError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{verifyError}</p>
            )}

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={cancelVerifyForm}
                disabled={verifyPending}
                className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitVerification()}
                disabled={verifyPending || !verifyAmount || parseFloat(verifyAmount) <= 0}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
              >
                {verifyPending ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Recording…
                  </>
                ) : (
                  "Verify & Record Payment"
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* PRC-13 / feat/payment-success-modal: post-verify
          confirmation. Closes the loop and nudges the front
          desk toward confirming the booking now that the
          payment is recorded. The dashboard surface uses
          "View booking" as the secondary CTA (navigates to
          the bookings page) instead of "Later" — the staff
          may want to do follow-up work on the booking. Per
          FOL-05 (2026-08-07, per decision #201): the
          success modal's "isFullPayment" +
          "remainingBalance" now reflect the
          reservation-scope math (via
          `verifyScope.paidAmount` + `verifyScope.totalPrice`),
          not the lead's per-room math. For N=1 legacy
          bookings the math is byte-equivalent to pre-FOL-05. */}
      <PaymentSuccessModal
        open={verifySuccess !== null}
        onClose={() => { if (!confirmingBookingFromSuccess) { setVerifySuccess(null); setVerifyTarget(null); setVerifyScope(null); } }}
        surface="dashboard"
        bookingRef={verifySuccess?.booking.bookingRef ?? ""}
        guestName={verifySuccess?.booking.guestName ?? ""}
        guestEmail={verifySuccess?.booking.guestEmail ?? ""}
        roomType={verifySuccess?.booking.roomType ?? ""}
        amount={verifySuccess?.amount ?? 0}
        method={verifySuccess?.method ?? ""}
        methodLabel={verifySuccess?.methodLabel}
        isFullPayment={verifySuccess?.isFullPayment ?? false}
        remainingBalance={verifySuccess?.remainingBalance}
        onConfirmBooking={handleConfirmBookingFromSuccess}
        confirmingBooking={confirmingBookingFromSuccess}
        onViewBooking={() => {
          if (!verifySuccess) return;
          const targetId = verifySuccess.booking.id;
          setVerifySuccess(null);
          setVerifyTarget(null);
          setVerifyScope(null);
          openBooking(targetId);
        }}
        onConfirmWithBalance={openConfirmWithBalanceFromSuccess}
      />

      {/* Per CWB-04 / decision 122 (2026-07-23): opened by
          the post-verify success modal's partial-payment
          "Confirm with Balance" CTA. The form owns the
          threshold banner + the role-gated submit. On
          success the snapshot listener refreshes the
          dashboard's pending-payments list so the booking
          drops off. */}
      {confirmWithBalanceContext && (
        <ConfirmWithBalanceForm
          open={confirmWithBalanceContext !== null}
          onClose={() => setConfirmWithBalanceContext(null)}
          booking={confirmWithBalanceContext.booking}
          currentBalance={confirmWithBalanceContext.currentBalance}
          onConfirmed={() => setConfirmWithBalanceContext(null)}
        />
      )}
      <Modal
        title={imagePreview?.title ?? "Image preview"}
        open={!!imagePreview}
        onClose={() => setImagePreview(null)}
        className="max-w-4xl"
      >
        {imagePreview ? (
          <img
            src={imagePreview.url}
            alt={imagePreview.title}
            className="max-h-[72vh] w-full rounded-lg object-contain"
          />
        ) : null}
      </Modal>
    </div>
  );
}

export default DashboardPage;
