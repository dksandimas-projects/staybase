import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Ban, BedDouble, CalendarClock, CalendarDays, Edit3, MessageSquareText, Plus, XCircle } from "lucide-react";
// Per NBS-2026-08-08 (F1 + F8, booking-flow audit
// 2026-08-08): the calendar create-booking path preallocates
// a `bookingId` + `reservationId` pair (F1) and now threads
// the adult/child split + extra bed count (F8). The
// preallocation matches the public `/book` + admin
// New Booking modal patterns.
import {
  calculateSeasonalAwareRoomTotal,
  getNumNights,
  DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT,
  PaymentMethodConfig,
  calculateBreakfastAddOn,
  generateReservationId
} from "@spark-inn/shared";
import { collection, doc } from "firebase/firestore";
import { db } from "../firebase/config";
import { useAdmin, Booking, Room, RoomBlock } from "../context/AdminContext";
import { Drawer } from "../components/Drawer";
import { Modal } from "../components/Modal";
import { PrimaryButton } from "../components/PrimaryButton";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";

// Per WPM (2026-07-31): the walk-in + calendar "Create Calendar Booking"
// modals' Payment Term dropdown used to be hardcoded to three literal
// options. The fix sources the options from the same Settings list every
// other admin payment selector uses. `pay-at-hotel` is excluded from the
// memo (booking-time intent, not a settlement tender) but prepended back
// for walk-in since the desk needs it as a valid choice.
const NON_TENDER_ONSITE_PAYMENT_METHODS = new Set(["cod", "add-to-bill", "pay-at-hotel"]);
import { formatPrice } from "../utils/format";
import config from "@config";

const OCCUPYING_STATUSES: Booking["status"][] = [
  "pending",
  "payment-uploaded",
  "payment-confirmed",
  "confirmed",
  "checked-in"
];

function parseDate(value: string) {
  return new Date(value.includes("T") ? value : `${value}T00:00:00Z`);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDay(value: Date) {
  return new Intl.DateTimeFormat(config.locale, {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(value);
}

function formatCalendarDetailDate(value: unknown) {
  if (!value) return "";
  const date = typeof (value as { toDate?: () => Date })?.toDate === "function"
    ? (value as { toDate: () => Date }).toDate()
    : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(config.locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function overlapsDate(startDate: string, endDate: string, date: Date) {
  return parseDate(startDate) < addDays(date, 1) && parseDate(endDate) > date;
}

function rangeIncludesDate(range: { startDate: string; endDate: string } | null, date: Date) {
  if (!range) return false;
  return parseDate(range.startDate) <= date && parseDate(range.endDate) > date;
}

function isRangeStart(startDate: string, date: Date) {
  return startDate === toDateKey(date);
}

function isRangeEnd(endDate: string, date: Date) {
  return toDateKey(addDays(date, 1)) === endDate;
}

export function CalendarPage() {
  const {
    bookings,
    rooms,
    roomTypes,
    seasonalRateOverrides,
    breakfastConfig,
    dashboardLoading,
    roomBlocks,
    createRoomBlock,
    updateRoomBlock,
    cancelRoomBlock,
    addWalkinBooking,
    updateBookingStatus,
    paymentMethods,
    rescheduleBooking
  } = useAdmin();
  const toast = useToast();

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

  const todayKey = toLocalDateKey(new Date());
  const [startDate, setStartDate] = useState(todayKey);
  const [selection, setSelection] = useState<{ roomId: string; startDate: string; endDate: string } | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<RoomBlock | null>(null);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [blockReason, setBlockReason] = useState("Maintenance");
  const [blockNotes, setBlockNotes] = useState("");
  // Per fix/walkin-split-name (2026-07-25): the calendar's
  // "Create Calendar Booking" modal now mirrors the guest
  // `/book` page — firstName + lastName are collected
  // separately. The server combines them into
  // `Booking.guestName` for storage, matching the new
  // AdminContext.addWalkinBooking contract.
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestCount, setGuestCount] = useState(1);
  // Per NBS-2026-08-08 (F8, booking-flow audit 2026-08-08):
  // the calendar-create path now collects the adult/child
  // split + extra bed count the same way the New Booking
  // modal does. The pre-F8 path only collected `guestCount`
  // (the total), so the server defaulted to "all adults, no
  // extra beds" — a 3-guest booking in a 2-adult room
  // silently fell through the EXB-03 overflow check. The
  // server still derives `numGuests = numAdults + numChildren`
  // (CHD-04), so the form just needs to surface the split.
  const [numAdults, setNumAdults] = useState(1);
  const [numChildren, setNumChildren] = useState(0);
  const [extraBedCount, setExtraBedCount] = useState(0);
  const [hasBreakfast, setHasBreakfast] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("pay-at-hotel");
  // Per feat/staff-special-requests-capture (2026-08-21):
  // the calendar-create modal captures requests at booking
  // time when the desk is taking the booking in person. The
  // state flows into the addWalkinBooking call which posts
  // to /api/bookings/create-walkin with `requests` inside
  // guestDetails; the server writes it to
  // `Booking.specialRequests` on the doc.
  const [calendarSpecialRequests, setCalendarSpecialRequests] = useState("");
  // Per NBS-2026-08-08 (F1): the modal-session preallocation
  // of the `bookingId` + `reservationId` for the calendar
  // create path. Same shape as the BookingsPage modal —
  // the pair is recomputed via `useMemo` when
  // `calendarPreallocKey` changes. The key rotates when the
  // modal opens so a second booking in the same page
  // session gets a fresh pair.
  const [calendarPreallocKey, setCalendarPreallocKey] = useState(0);
  const calendarPreallocatedIds = useMemo(() => ({
    bookingId: doc(collection(db, "bookings")).id,
    reservationId: generateReservationId()
  }), [calendarPreallocKey]);
  const calendarPreallocatedBookingId = calendarPreallocatedIds.bookingId;
  const calendarPreallocatedReservationId = calendarPreallocatedIds.reservationId;
  const wasCalendarModalOpenRef = useRef(false);
  useEffect(() => {
    if (isBookingModalOpen && !wasCalendarModalOpenRef.current) {
      wasCalendarModalOpenRef.current = true;
      setCalendarPreallocKey((key) => key + 1);
    } else if (!isBookingModalOpen) {
      wasCalendarModalOpenRef.current = false;
    }
  }, [isBookingModalOpen]);
  const [cancelReason, setCancelReason] = useState("");
  const [moveRoomId, setMoveRoomId] = useState("");
  const [moveCheckIn, setMoveCheckIn] = useState("");
  const [moveCheckOut, setMoveCheckOut] = useState("");
  const [moveReason, setMoveReason] = useState("");

  // Per WPM-01/02: walk-in + calendar-create memos for the onsite payment
  // options. Same shape as BookingsPage's onsitePaymentMethodOptions; the
  // duplication is the cost of the quick fix — extract to a shared hook
  // when a third caller appears.
  const onsitePaymentMethodOptions = useMemo<PaymentMethodConfig[]>(() => {
    return (paymentMethods || []).filter((method) => {
      const key = method.method.trim();
      return key && !NON_TENDER_ONSITE_PAYMENT_METHODS.has(key);
    });
  }, [paymentMethods]);

  const days = useMemo(() => {
    const start = parseDate(startDate);
    return Array.from({ length: 14 }, (_, index) => addDays(start, index));
  }, [startDate]);

  const sortedRooms = useMemo(() => {
    return [...rooms]
      .filter((room) => room.isActive)
      .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
  }, [rooms]);

  const roomTypeLabels = useMemo(() => {
    return roomTypes.reduce<Record<string, string>>((acc, type) => {
      acc[type.value] = type.shortLabel || type.label;
      return acc;
    }, {});
  }, [roomTypes]);

  const bookingsByRoom = useMemo(() => {
    return bookings
      .filter((booking) => OCCUPYING_STATUSES.includes(booking.status))
      .reduce<Record<string, Booking[]>>((acc, booking) => {
        acc[booking.roomId] = acc[booking.roomId] || [];
        acc[booking.roomId].push(booking);
        return acc;
      }, {});
  }, [bookings]);

  const activeBlocksByRoom = useMemo(() => {
    return roomBlocks
      .filter((block) => block.status === "active")
      .reduce<Record<string, RoomBlock[]>>((acc, block) => {
        acc[block.roomId] = acc[block.roomId] || [];
        acc[block.roomId].push(block);
        return acc;
      }, {});
  }, [roomBlocks]);

  const selectedRoom = selection ? rooms.find((room) => room.id === selection.roomId) || null : null;
  const selectedRoomType = selectedRoom ? roomTypes.find((type) => type.value === selectedRoom.type) || null : null;
  const selectedNights = selection ? getNumNights(selection.startDate, selection.endDate) : 0;

  const selectedRoomTotal = selection && selectedRoomType
    ? calculateSeasonalAwareRoomTotal({
        checkIn: `${selection.startDate}T00:00:00Z`,
        checkOut: `${selection.endDate}T00:00:00Z`,
        roomType: selectedRoomType.value,
        baseRate: selectedRoomType.pricePerNight,
        weekendRate: selectedRoomType.weekendRate,
        seasonalRateOverrides
      })
    : 0;

  const moveWindow = (daysToMove: number) => {
    setStartDate(toDateKey(addDays(parseDate(startDate), daysToMove)));
    setSelection(null);
  };

  const handleOpenDateClick = (room: Room, day: Date) => {
    const dayKey = toDateKey(day);
    const nextDayKey = toDateKey(addDays(day, 1));
    if (!selection || selection.roomId !== room.id) {
      setSelection({ roomId: room.id, startDate: dayKey, endDate: nextDayKey });
      return;
    }

    if (rangeIncludesDate(selection, day)) {
      setSelection(null);
      return;
    }

    const start = parseDate(selection.startDate) < day ? selection.startDate : dayKey;
    const end = parseDate(selection.endDate) > addDays(day, 1) ? selection.endDate : nextDayKey;
    setSelection({ roomId: room.id, startDate: start, endDate: end });
  };

  const handleBlockSelection = async () => {
    if (!selection || !blockReason.trim()) return;
    const result = await createRoomBlock({
      roomId: selection.roomId,
      startDate: selection.startDate,
      endDate: selection.endDate,
      reason: blockReason.trim(),
      notes: blockNotes.trim()
    });
    if (!result.success) {
      toast.error("Dates not blocked", result.error || "Please try another range.");
      return;
    }
    toast.success("Dates blocked", `${selection.startDate} to ${selection.endDate}`);
    setSelection(null);
    setBlockNotes("");
  };

  const handleCreateBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedFirst = firstName.trim();
    const trimmedLast = lastName.trim();
    const trimmedEmail = guestEmail.trim();
    const trimmedPhone = guestPhone.trim();
    if (!selection || !selectedRoom || !selectedRoomType || !trimmedFirst || !trimmedLast) return;
    // Per NBS-2026-08-08 (F4): require a real email + phone
    // before submit. The pre-F4 path wrote
    // `calendar-${Date.now()}@example.invalid` + the literal
    // string `"n/a"` to Firestore when the desk left the
    // fields blank — a fake email that silently occupied
    // the match-by-email field for every later
    // link / lookup / reply. Same fix as the BookingsPage
    // New Booking modal.
    if (!trimmedEmail) {
      toast.warning(
        "Email required",
        "Please enter a valid email for the guest — it's required for the booking confirmation and receipt."
      );
      return;
    }
    if (!trimmedPhone) {
      toast.warning(
        "Phone required",
        "Please enter a phone number for the guest — it's required for check-in coordination."
      );
      return;
    }
    // Per NBS-2026-08-08 (F8): the desk's adult/child split
    // + extra bed count. The server (CHD-04 + EXB-03)
    // validates `numAdults + numChildren === numGuests` and
    // applies the overflow rule, so a 3-guest booking in a
    // 2-adult room without enough extra beds is rejected
    // before the transaction (the previous pre-F8 silent
    // default priced it as 3 adults in a 2-adult room).
    const safeNumAdults = Math.max(0, Math.floor(Number(numAdults) || 0));
    const safeNumChildren = Math.max(0, Math.floor(Number(numChildren) || 0));
    if (safeNumAdults + safeNumChildren < 1) {
      toast.warning(
        "Guest count required",
        "Please set at least one adult or child guest."
      );
      return;
    }
    const breakfastRate = hasBreakfast ? Number(breakfastConfig.ratePerPersonPerNight || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT) : 0;
    // Per EXB-02 (2026-07-31): the historical inline
    // `hasBreakfast ? breakfastRate * guestCount * selectedNights : 0`
    // now routes through the shared `calculateBreakfastAddOn` helper.
    // Byte-equivalent output — the helper's defensive coercion matches
    // the ternary's `hasBreakfast` gate and the `Number(x) || 0`
    // pattern this site uses. The `numGuests` for the
    // breakfast add-on is the total (adults + children) per
    // the CHD-10 helper's contract.
    const totalPrice = selectedRoomTotal + calculateBreakfastAddOn({
      hasBreakfast,
      breakfastRate,
      numGuests: safeNumAdults + safeNumChildren,
      numNights: selectedNights
    });
    const result = await addWalkinBooking({
      // Per NBS-2026-08-08 (F1): the modal-session preallocations.
      preallocatedBookingId: calendarPreallocatedBookingId,
      preallocatedReservationId: calendarPreallocatedReservationId,
      roomId: selectedRoom.id,
      roomNumber: selectedRoom.roomNumber,
      roomType: selectedRoom.type,
      firstName: trimmedFirst,
      lastName: trimmedLast,
      guestEmail: trimmedEmail,
      guestPhone: trimmedPhone,
      numGuests: safeNumAdults + safeNumChildren,
      // Per NBS-2026-08-08 (F8): the adult/child split + extra
      // bed count. The server derives `numGuests` from the
      // split (CHD-04) and validates the EXB-03 overflow
      // rule against the selected room type's `maxExtraBeds`.
      numAdults: safeNumAdults,
      numChildren: safeNumChildren,
      extraBedCount,
      checkIn: selection.startDate,
      checkOut: selection.endDate,
      numNights: selectedNights,
      ratePerNight: selectedRoomType.pricePerNight,
      totalPrice,
      originalTotalPrice: totalPrice,
      discountType: "",
      discountPct: 0,
      discountIdPhotoUrl: null,
      discountVerified: false,
      discountVerifiedBy: null,
      discountRejected: false,
      discountRejectedBy: null,
      discountRejectionReason: "",
      voucherCode: "",
      voucherDiscount: 0,
      isCorporate: false,
      corporateCode: "",
      companyName: "",
      // Per feat/special-requests-redirect (2026-08-21):
      // the previous literal "Created from booking calendar."
      // placeholder is replaced with an empty string. The
      // Per feat/staff-special-requests-capture (2026-08-21):
      // the staff-captured request from the calendar-create
      // modal (front desk types on the guest's behalf when
      // the booking is taken in person). The previous
      // PR (feat/special-requests-redirect) left this
      // empty as part of the no-guest-input rule; this
      // PR restores a captured value via the textarea on
      // the modal below. Truncated at 1000 chars; the
      // WalkinGuestDetailsSchema caps at 1000 too.
      specialRequests: calendarSpecialRequests.trim().slice(0, 1000),
      status: "confirmed",
      paymentMethod,
      paymentProofUrl: null,
      lookupToken: "",
      source: "walk-in",
      notes: "",
      memberId: null,
      pointsRedeemed: 0,
      pointsRedeemedValue: 0,
      pointsRedeemedBy: null,
      pointsRedeemedAt: null,
      hasBreakfast,
      breakfastRate,
      reminderSentAt: null,
      guestIdPhotoUrl: null,
      handledBy: "",
      cancellationReason: ""
    });
    if (!result.success) {
      toast.error("Booking not created", result.error || "Please try another range.");
      return;
    }
    toast.success("Booking created", `${trimmedFirst} ${trimmedLast} is booked for Room ${selectedRoom.roomNumber}.`);
    setIsBookingModalOpen(false);
    setSelection(null);
    setFirstName("");
    setLastName("");
    setGuestEmail("");
    setGuestPhone("");
    setGuestCount(1);
    // Per NBS-2026-08-08 (F8): reset the adult/child split
    // + extra bed count alongside the guest count.
    setNumAdults(1);
    setNumChildren(0);
    setExtraBedCount(0);
    setHasBreakfast(false);
    // Per feat/staff-special-requests-capture (2026-08-21):
    // reset the staff-captured special request alongside the
    // other fields so the next modal open starts clean.
    setCalendarSpecialRequests("");
    // Per NBS-2026-08-08 (F1): rotate the preallocation
    // key so the next modal open generates a fresh
    // `bookingId` + `reservationId` pair. The current
    // pair is bound to the just-committed booking —
    // reusing it for the next one would collide with
    // the existing reservation header.
    setCalendarPreallocKey((key) => key + 1);
  };

  const openBookingDrawer = (booking: Booking) => {
    setSelectedBooking(booking);
    setMoveRoomId(booking.roomId);
    setMoveCheckIn(booking.checkIn);
    setMoveCheckOut(booking.checkOut);
    setMoveReason("");
    setCancelReason("");
  };

  const handleCancelBooking = async () => {
    if (!selectedBooking) return;
    await updateBookingStatus(selectedBooking.id, "cancelled", { cancellationReason: cancelReason });
    setSelectedBooking(null);
  };

  const handleMoveBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking) return;
    const result = await rescheduleBooking({
      bookingId: selectedBooking.id,
      roomId: moveRoomId,
      checkIn: moveCheckIn,
      checkOut: moveCheckOut,
      reason: moveReason
    });
    if (!result.success) {
      toast.error("Booking not moved", result.error || "Please choose another room or date range.");
      return;
    }
    toast.success("Booking moved", "Calendar dates updated.");
    setSelectedBooking(null);
  };

  const openBlockDrawer = (block: RoomBlock) => {
    setSelectedBlock(block);
    setBlockReason(block.reason);
    setBlockNotes(block.notes || "");
  };

  const handleUpdateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBlock) return;
    const result = await updateRoomBlock({
      blockId: selectedBlock.id,
      startDate: selectedBlock.startDate,
      endDate: selectedBlock.endDate,
      reason: blockReason,
      notes: blockNotes
    });
    if (!result.success) {
      toast.error("Block not updated", result.error || "Please try another range.");
      return;
    }
    toast.success("Block updated", "Calendar block saved.");
    setSelectedBlock(null);
  };

  if (dashboardLoading) {
    return (
      <div className="space-y-6">
        <div className="h-9 w-56 animate-pulse rounded bg-gray-200" />
        <div className="h-[520px] animate-pulse rounded-card bg-white shadow-sm ring-1 ring-gray-200" />
      </div>
    );
  }

  return (
    <div className="space-y-6 font-body">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase">booking calendar</h1>
          <p className="mt-1 text-xs text-gray-500">Click a start date and end date on one room, then block or book the selected range.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => moveWindow(-14)} className="inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-white px-3 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50">
            <ArrowLeft size={14} /> Previous
          </button>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || todayKey)} className="min-h-[40px] rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-800" />
          <button type="button" onClick={() => setStartDate(todayKey)} className="min-h-[40px] rounded-lg bg-white px-3 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50">Today</button>
          <button type="button" onClick={() => moveWindow(14)} className="inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-white px-3 text-xs font-semibold text-gray-700 shadow-sm ring-1 ring-gray-200 hover:bg-gray-50">
            Next <ArrowRight size={14} />
          </button>
        </div>
      </header>

      {selection && selectedRoom && (
        <section className="rounded-card bg-white p-4 shadow-sm ring-1 ring-primary/20">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-bold text-gray-900">Room {selectedRoom.roomNumber} · {selection.startDate} to {selection.endDate}</p>
              <p className="mt-1 text-[11px] text-gray-500">{selectedNights} night{selectedNights === 1 ? "" : "s"} · estimated room charge {formatPrice(selectedRoomTotal)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} className="min-h-[40px] rounded-lg border border-gray-200 px-3 text-xs font-semibold text-gray-800" placeholder="Block reason" />
              <button type="button" onClick={handleBlockSelection} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-gray-900 px-4 text-xs font-semibold text-white hover:bg-gray-800">
                <Ban size={14} /> Block dates
              </button>
              <button type="button" onClick={() => setIsBookingModalOpen(true)} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-white hover:bg-primary-dark">
                <Plus size={14} /> Book dates
              </button>
              <button type="button" onClick={() => setSelection(null)} className="min-h-[40px] rounded-lg border border-gray-200 px-4 text-xs font-semibold text-gray-700 hover:bg-gray-50">Clear</button>
            </div>
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-600">
            <CalendarDays size={15} className="text-primary" />
            {formatDay(days[0])} to {formatDay(days[days.length - 1])}
          </div>
          <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">Available</span>
            <span className="rounded-full bg-gray-950 px-2 py-1 text-white">Booked</span>
            <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-700 line-through">Blocked</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[1180px]">
            <div className="grid border-b border-gray-100 bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-500" style={{ gridTemplateColumns: `150px repeat(${days.length}, minmax(72px, 1fr))` }}>
              <div className="sticky left-0 z-10 bg-gray-50 px-3 py-3">Room</div>
              {days.map((day) => <div key={toDateKey(day)} className="border-l border-gray-100 px-2 py-3 text-center">{formatDay(day)}</div>)}
            </div>

            {sortedRooms.map((room) => (
              <div key={room.id} className="grid min-h-[78px] border-b border-gray-100 last:border-b-0" style={{ gridTemplateColumns: `150px repeat(${days.length}, minmax(72px, 1fr))` }}>
                <div className="sticky left-0 z-10 flex flex-col justify-center gap-1 bg-white px-3 py-3 shadow-[1px_0_0_#f3f4f6]">
                  <span className="inline-flex items-center gap-1 text-sm font-bold text-gray-900"><BedDouble size={14} className="text-primary" />{room.roomNumber}</span>
                  <span className="text-[10px] font-semibold text-gray-500">{roomTypeLabels[room.type] || room.type}</span>
                </div>
                {days.map((day) => {
                  const dateKey = toDateKey(day);
                  const booking = (bookingsByRoom[room.id] || []).find((item) => overlapsDate(item.checkIn, item.checkOut, day));
                  const block = (activeBlocksByRoom[room.id] || []).find((item) => overlapsDate(item.startDate, item.endDate, day));
                  const selected = selection?.roomId === room.id && rangeIncludesDate(selection, day);

                  if (booking) {
                    const left = isRangeStart(booking.checkIn, day);
                    const right = isRangeEnd(booking.checkOut, day);
                    const earlyCheckInTime = booking.earlyCheckIn?.confirmedTime || booking.earlyCheckIn?.requestedTime;
                    const hasApprovedEarlyCheckIn = booking.earlyCheckIn?.status === "approved" && Boolean(earlyCheckInTime);
                    // Per feat/staff-special-requests-capture (2026-08-21):
                    // render a small icon + hover tooltip when the
                    // booking has a non-empty `specialRequests`
                    // value (staff-captured from email or phone).
                    // The icon is a MessageSquareText glyph in
                    // amber so it reads as an action hint, not a
                    // status pill; the tooltip carries the raw
                    // text (truncated at 80 chars to keep the cell
                    // tidy).
                    const hasSpecialRequest = (booking.specialRequests ?? "").trim().length > 0;
                    return (
                      <button key={`${room.id}-${dateKey}`} type="button" onClick={() => openBookingDrawer(booking)} className="relative min-h-[78px] border-l border-gray-100 bg-white px-0 py-3 text-left">
                        <div className={`flex min-h-[46px] flex-col justify-center bg-gray-950 px-3 text-white shadow-sm ${left ? "ml-2 rounded-l-full" : ""} ${right ? "mr-2 rounded-r-full" : ""}`}>
                          <span className="truncate text-[11px] font-bold">{booking.guestName}</span>
                          <span className="truncate text-[10px] text-white/70">{booking.isCorporate && booking.companyName ? booking.companyName : booking.bookingRef}</span>
                          {(hasSpecialRequest || (left && hasApprovedEarlyCheckIn)) && (
                            <span
                              data-testid="calendar-booking-indicators"
                              className="absolute right-1 top-1 flex flex-col items-center gap-1"
                            >
                              {hasSpecialRequest && (
                                <span
                                  data-testid="calendar-special-request-icon"
                                  title={(booking.specialRequests ?? "").length > 80
                                    ? `${booking.specialRequests!.trim().slice(0, 80)}…`
                                    : booking.specialRequests}
                                  aria-label="Has special request — click booking to view details"
                                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-amber-950 shadow-sm ring-1 ring-inset ring-amber-500/40"
                                >
                                  <MessageSquareText size={9} aria-hidden="true" />
                                </span>
                              )}
                              {left && hasApprovedEarlyCheckIn && (
                                <span
                                  data-testid="calendar-approved-early-checkin-icon"
                                  title="Early check-in approved — click booking to view details"
                                  aria-label="Early check-in approved — click booking to view details"
                                  className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 shadow-sm ring-1 ring-inset ring-emerald-300"
                                >
                                  <CalendarClock size={9} aria-hidden="true" />
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  }

                  if (block || roomBlockedOnLegacy(room, day)) {
                    return (
                      <button key={`${room.id}-${dateKey}`} type="button" onClick={() => block && openBlockDrawer(block)} className="relative flex min-h-[78px] items-center justify-center border-l border-gray-100 bg-gray-50 px-2 py-2 text-gray-500">
                        <span className="absolute left-2 right-2 top-1/2 h-px bg-gray-500" />
                        <span className="relative z-10 rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wider">{block?.reason || "Blocked"}</span>
                      </button>
                    );
                  }

                  return (
                    <button key={`${room.id}-${dateKey}`} type="button" onClick={() => handleOpenDateClick(room, day)} className={`flex min-h-[78px] flex-col items-center justify-center border-l border-gray-100 px-2 py-2 transition hover:bg-emerald-50 ${selected ? "bg-primary/10 ring-1 ring-inset ring-primary" : "bg-white"}`}>
                      <span className="text-xs font-bold text-gray-900">{dateKey.slice(8)}</span>
                      <span className="mt-1 text-[10px] font-semibold text-gray-500">Open</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      <Modal title="Create Calendar Booking" open={isBookingModalOpen} onClose={() => setIsBookingModalOpen(false)}>
        <form onSubmit={handleCreateBooking} className="space-y-4 text-xs">
          {/* Per fix/walkin-split-name (2026-07-25): the
              calendar booking modal now mirrors the guest
              `/book` page. First + last name are collected
              separately (autoComplete hints are the same
              standard browser-driven fill flow). */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-2 font-semibold text-gray-700">First name<input required value={firstName} onChange={(e) => setFirstName(e.target.value)} autoComplete="given-name" placeholder="Maria" className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
            <label className="flex flex-col gap-2 font-semibold text-gray-700">Last name<input required value={lastName} onChange={(e) => setLastName(e.target.value)} autoComplete="family-name" placeholder="Santos" className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
          </div>
          <label className="flex flex-col gap-2 font-semibold text-gray-700">Email<input type="email" required value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
          <label className="flex flex-col gap-2 font-semibold text-gray-700">Phone<input required value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>

          <label className="flex flex-col gap-2 font-semibold text-gray-700">
            Special requests (optional)
            <textarea
              value={calendarSpecialRequests}
              onChange={(e) => setCalendarSpecialRequests(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="e.g. Late check-in ~11pm, extra pillows, vegetarian breakfast"
              className="min-h-[80px] rounded border border-gray-250 px-3 py-2 text-sm font-normal placeholder:text-gray-400"
            />
            <span className="text-[10px] font-normal text-gray-500">
              Captured from email or phone by the front desk. Guests never see this field.
            </span>
          </label>
          {/* Per NBS-2026-08-08 (F8): the calendar-create
              modal now collects the adult/child split +
              extra bed count the same way the New Booking
              modal does. The single `guestCount` field is
              kept for the desk's quick-set habit (it
              distributes `numAdults = guestCount,
              numChildren = 0` on change), and the split
              steppers below it override when the desk
              knows the actual mix. The server derives
              `numGuests = numAdults + numChildren` (CHD-04)
              and applies the EXB-03 overflow rule against
              the room type's `maxExtraBeds`. */}
          <label className="flex flex-col gap-2 font-semibold text-gray-700">Guests<input type="number" min={1} value={numAdults + numChildren} onChange={(e) => {
            const nextTotal = Math.max(1, Number(e.target.value) || 1);
            setNumAdults(nextTotal);
            setNumChildren(0);
            setGuestCount(nextTotal);
          }} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-2 font-semibold text-gray-700">Adults<input type="number" min={1} max={20} value={numAdults} onChange={(e) => setNumAdults(Math.max(1, Number(e.target.value) || 1))} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
            <label className="flex flex-col gap-2 font-semibold text-gray-700">Children<input type="number" min={0} max={20} value={numChildren} onChange={(e) => setNumChildren(Math.max(0, Number(e.target.value) || 0))} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
          </div>
          <label className="flex flex-col gap-2 font-semibold text-gray-700">Extra beds<input type="number" min={0} max={10} value={extraBedCount} onChange={(e) => setExtraBedCount(Math.max(0, Number(e.target.value) || 0))} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
          <label className="flex items-center gap-2 font-semibold text-gray-700"><input type="checkbox" checked={hasBreakfast} onChange={(e) => setHasBreakfast(e.target.checked)} /> Include breakfast</label>
          <label className="flex flex-col gap-2 font-semibold text-gray-700">Payment method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm">
            {[
              { method: "pay-at-hotel", label: "Pay at Hotel" },
              ...onsitePaymentMethodOptions
            ].map((m) => (
              <option key={m.method} value={m.method}>{m.label || m.method}</option>
            ))}
          </select></label>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setIsBookingModalOpen(false)} className="min-h-[44px] rounded-lg border border-gray-250 px-5 text-xs font-semibold text-gray-700">Cancel</button>
            <PrimaryButton type="submit">Create booking</PrimaryButton>
          </div>
        </form>
      </Modal>

      <Drawer title="Booking" open={!!selectedBooking} onClose={() => setSelectedBooking(null)}>
        {selectedBooking && (
          <div className="space-y-5 text-xs">
            <div className="rounded-lg bg-gray-50 p-4">
              <p className="text-base font-bold text-gray-950">{selectedBooking.guestName}</p>
              <p className="mt-1 text-gray-500">Room {selectedBooking.roomNumber} · {selectedBooking.checkIn} to {selectedBooking.checkOut}</p>
              {selectedBooking.isCorporate && selectedBooking.companyName && <p className="mt-1 font-semibold text-primary-dark">{selectedBooking.companyName}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge label={selectedBooking.status.replace("-", " ")} status={selectedBooking.status} />
              </div>
            </div>
            {selectedBooking.earlyCheckIn?.status === "approved" && (() => {
              const earlyCheckIn = selectedBooking.earlyCheckIn;
              const approvedTime = earlyCheckIn.confirmedTime || earlyCheckIn.requestedTime;
              const approvedAt = formatCalendarDetailDate(earlyCheckIn.resolvedAt);
              const timeWasChanged = Boolean(
                earlyCheckIn.confirmedTime &&
                earlyCheckIn.confirmedTime !== earlyCheckIn.requestedTime
              );
              return (
                <section
                  data-testid="calendar-drawer-early-checkin-details"
                  className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-4"
                >
                  <div className="flex items-center gap-2">
                    <CalendarClock size={15} className="text-emerald-700" aria-hidden="true" />
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                      Approved early check-in
                    </h3>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <dt className="text-[9px] font-bold uppercase tracking-wide text-emerald-700/70">Approved arrival</dt>
                      <dd className="mt-0.5 text-sm font-bold text-emerald-950">{approvedTime}</dd>
                    </div>
                    {timeWasChanged && (
                      <div>
                        <dt className="text-[9px] font-bold uppercase tracking-wide text-emerald-700/70">Originally requested</dt>
                        <dd className="mt-0.5 text-xs font-semibold text-emerald-900">{earlyCheckIn.requestedTime}</dd>
                      </div>
                    )}
                  </dl>
                  {earlyCheckIn.notes?.trim() && (
                    <div className="mt-3 border-t border-emerald-200 pt-3">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-700/70">Guest note</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-emerald-950">{earlyCheckIn.notes.trim()}</p>
                    </div>
                  )}
                  {earlyCheckIn.staffNote?.trim() && (
                    <div className="mt-3 border-t border-emerald-200 pt-3">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-emerald-700/70">Staff note</p>
                      <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-emerald-950">{earlyCheckIn.staffNote.trim()}</p>
                    </div>
                  )}
                  {(earlyCheckIn.resolvedBy || approvedAt) && (
                    <p className="mt-3 text-[10px] text-emerald-800/70">
                      Approved by {earlyCheckIn.resolvedBy || "staff"}{approvedAt ? ` · ${approvedAt}` : ""}
                    </p>
                  )}
                </section>
              );
            })()}
            {(selectedBooking.specialRequests ?? "").trim() && (
              <section
                data-testid="calendar-drawer-special-request-details"
                className="rounded-lg border border-amber-200 bg-amber-50/70 p-4"
              >
                <div className="flex items-center gap-2">
                  <MessageSquareText size={15} className="text-amber-700" aria-hidden="true" />
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
                    Special request
                  </h3>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-amber-950">
                  {selectedBooking.specialRequests.trim()}
                </p>
                {(selectedBooking.specialRequestsUpdatedAt || selectedBooking.specialRequestsUpdatedBy) && (
                  <p className="mt-3 text-[10px] text-amber-800/70">
                    Last edited by {selectedBooking.specialRequestsUpdatedBy || "staff"}
                    {formatCalendarDetailDate(selectedBooking.specialRequestsUpdatedAt)
                      ? ` · ${formatCalendarDetailDate(selectedBooking.specialRequestsUpdatedAt)}`
                      : ""}
                  </p>
                )}
              </section>
            )}
            <Link to={`/bookings?bookingId=${selectedBooking.id}`} className="inline-flex min-h-[40px] items-center rounded-lg bg-primary px-4 text-xs font-semibold text-white">Open full booking</Link>
            <form onSubmit={handleMoveBooking} className="space-y-3 border-t border-gray-100 pt-4">
              <p className="font-bold text-gray-900">Move booking</p>
              <select value={moveRoomId} onChange={(e) => setMoveRoomId(e.target.value)} className="min-h-[44px] w-full rounded border border-gray-250 px-3">
                {sortedRooms.map((room) => <option key={room.id} value={room.id}>Room {room.roomNumber} ({roomTypeLabels[room.type] || room.type})</option>)}
              </select>
              <input type="date" value={moveCheckIn} onChange={(e) => setMoveCheckIn(e.target.value)} className="min-h-[44px] w-full rounded border border-gray-250 px-3" />
              <input type="date" value={moveCheckOut} onChange={(e) => setMoveCheckOut(e.target.value)} className="min-h-[44px] w-full rounded border border-gray-250 px-3" />
              <textarea value={moveReason} onChange={(e) => setMoveReason(e.target.value)} placeholder="Reason / note" className="w-full rounded border border-gray-250 p-3" />
              <button type="submit" className="inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-gray-900 px-4 text-xs font-semibold text-white"><Edit3 size={13} /> Move booking</button>
            </form>
            <div className="space-y-3 border-t border-gray-100 pt-4">
              <p className="font-bold text-red-700">Cancel booking</p>
              <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Cancellation reason" className="w-full rounded border border-gray-250 p-3" />
              <button type="button" onClick={handleCancelBooking} className="inline-flex min-h-[40px] items-center gap-1 rounded-lg bg-red-600 px-4 text-xs font-semibold text-white"><XCircle size={13} /> Cancel booking</button>
            </div>
          </div>
        )}
      </Drawer>

      <Drawer title="Blocked Dates" open={!!selectedBlock} onClose={() => setSelectedBlock(null)}>
        {selectedBlock && (
          <form onSubmit={handleUpdateBlock} className="space-y-4 text-xs">
            <p className="rounded-lg bg-gray-50 p-3 font-semibold text-gray-700">Room {selectedBlock.roomNumber} · {selectedBlock.startDate} to {selectedBlock.endDate}</p>
            <label className="flex flex-col gap-2 font-semibold text-gray-700">Reason<input value={blockReason} onChange={(e) => setBlockReason(e.target.value)} className="min-h-[44px] rounded border border-gray-250 px-3" /></label>
            <label className="flex flex-col gap-2 font-semibold text-gray-700">Notes<textarea value={blockNotes} onChange={(e) => setBlockNotes(e.target.value)} className="rounded border border-gray-250 p-3" /></label>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="min-h-[40px] rounded-lg bg-gray-900 px-4 text-xs font-semibold text-white">Save block</button>
              <button type="button" onClick={async () => {
                const result = await cancelRoomBlock(selectedBlock.id);
                if (!result.success) toast.error("Block not cancelled", result.error || "Please try again.");
                else {
                  toast.success("Dates unblocked", "Calendar block cancelled.");
                  setSelectedBlock(null);
                }
              }} className="min-h-[40px] rounded-lg bg-red-50 px-4 text-xs font-semibold text-red-700">Unblock dates</button>
            </div>
          </form>
        )}
      </Drawer>
    </div>
  );
}

function roomBlockedOnLegacy(room: Room, date: Date) {
  if (room.status !== "blocked") return false;
  if (!room.blockedFrom || !room.blockedTo) return true;
  return parseDate(room.blockedFrom) < addDays(date, 1) && parseDate(room.blockedTo) > date;
}
