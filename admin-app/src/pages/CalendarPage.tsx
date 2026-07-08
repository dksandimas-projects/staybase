import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Ban, BedDouble, CalendarDays, Edit3, Plus, XCircle } from "lucide-react";
import { calculateSeasonalAwareRoomTotal, getNumNights } from "@spark-inn/shared";
import { useAdmin, Booking, Room, RoomBlock } from "../context/AdminContext";
import { Drawer } from "../components/Drawer";
import { Modal } from "../components/Modal";
import { PrimaryButton } from "../components/PrimaryButton";
import { StatusBadge } from "../components/StatusBadge";
import { useToast } from "../components/Toast";
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
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestCount, setGuestCount] = useState(1);
  const [hasBreakfast, setHasBreakfast] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("pay-at-hotel");
  const [cancelReason, setCancelReason] = useState("");
  const [moveRoomId, setMoveRoomId] = useState("");
  const [moveCheckIn, setMoveCheckIn] = useState("");
  const [moveCheckOut, setMoveCheckOut] = useState("");
  const [moveReason, setMoveReason] = useState("");

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
    if (!selection || !selectedRoom || !selectedRoomType || !guestName.trim()) return;
    const breakfastRate = hasBreakfast ? Number(breakfastConfig.ratePerPersonPerNight || 300) : 0;
    const totalPrice = selectedRoomTotal + (hasBreakfast ? breakfastRate * guestCount * selectedNights : 0);
    const result = await addWalkinBooking({
      roomId: selectedRoom.id,
      roomNumber: selectedRoom.roomNumber,
      roomType: selectedRoom.type,
      guestName: guestName.trim(),
      guestEmail: guestEmail.trim() || `calendar-${Date.now()}@example.invalid`,
      guestPhone: guestPhone.trim() || "n/a",
      numGuests: guestCount,
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
      specialRequests: "Created from booking calendar.",
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
    toast.success("Booking created", `${guestName.trim()} is booked for Room ${selectedRoom.roomNumber}.`);
    setIsBookingModalOpen(false);
    setSelection(null);
    setGuestName("");
    setGuestEmail("");
    setGuestPhone("");
    setGuestCount(1);
    setHasBreakfast(false);
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
                    return (
                      <button key={`${room.id}-${dateKey}`} type="button" onClick={() => openBookingDrawer(booking)} className="relative min-h-[78px] border-l border-gray-100 bg-white px-0 py-3 text-left">
                        <div className={`flex min-h-[46px] flex-col justify-center bg-gray-950 px-3 text-white shadow-sm ${left ? "ml-2 rounded-l-full" : ""} ${right ? "mr-2 rounded-r-full" : ""}`}>
                          <span className="truncate text-[11px] font-bold">{booking.guestName}</span>
                          <span className="truncate text-[10px] text-white/70">{booking.isCorporate && booking.companyName ? booking.companyName : booking.bookingRef}</span>
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
          <label className="flex flex-col gap-2 font-semibold text-gray-700">Guest name<input required value={guestName} onChange={(e) => setGuestName(e.target.value)} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
          <label className="flex flex-col gap-2 font-semibold text-gray-700">Email<input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
          <label className="flex flex-col gap-2 font-semibold text-gray-700">Phone<input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
          <label className="flex flex-col gap-2 font-semibold text-gray-700">Guests<input type="number" min={1} value={guestCount} onChange={(e) => setGuestCount(Number(e.target.value) || 1)} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm" /></label>
          <label className="flex items-center gap-2 font-semibold text-gray-700"><input type="checkbox" checked={hasBreakfast} onChange={(e) => setHasBreakfast(e.target.checked)} /> Include breakfast</label>
          <label className="flex flex-col gap-2 font-semibold text-gray-700">Payment method<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="min-h-[44px] rounded border border-gray-250 px-3 text-sm"><option value="pay-at-hotel">Pay at Hotel</option><option value="cash">Cash</option><option value="card">Card</option></select></label>
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
              <StatusBadge label={selectedBooking.status.replace("-", " ")} status={selectedBooking.status} />
            </div>
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
