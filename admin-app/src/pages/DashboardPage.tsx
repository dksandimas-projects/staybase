import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAdmin } from "../context/AdminContext";
import { StatsCard } from "../components/StatsCard";
import { StatusBadge } from "../components/StatusBadge";
import { Check, RefreshCw, AlertTriangle, ShieldCheck, CreditCard, Eye, LogIn, LogOut, Clock, ArrowRight, MessageSquare, ExternalLink, Utensils } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import config from "@config";
import { formatPrice } from "../utils/format";

export function DashboardPage() {
  const navigate = useNavigate();
  const { rooms, bookings, toggleHousekeepingStatus, roomTypes, updateBookingStatus, dashboardLoading, intercoms, intercomThreads, unreadIntercomCount } = useAdmin();

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
    .filter((b) => b.checkIn?.startsWith(monthKey) && ["confirmed", "checked-in", "checked-out"].includes(b.status))
    .reduce((sum, booking) => sum + Number(booking.totalPrice || 0), 0);
  const pendingPayments = bookings.filter(b => b.status === "payment-uploaded");
  const todaysArrivals = bookings.filter(b => b.checkIn === todayKey && b.status === "confirmed");
  const todaysDepartures = bookings.filter(b => b.checkOut === todayKey && b.status === "checked-in");
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

  const confirmPayment = async (bookingId: string) => {
    // Legacy SEV-2 breadcrumb: updateBookingStatus(bookingId, "confirmed")
    // SEV-3 restores the intermediate payment-confirmed state.
    await updateBookingStatus(bookingId, "payment-confirmed");
  };

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">dashboard overview</h1>
        <p className="text-xs text-gray-500 mt-1">Real-time room occupancy and housekeeping operations overview.</p>
      </header>

      {/* Stats Cards Row */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatsCard label="Occupancy Rate" value={`${occupancyPercentage}%`} />
        <StatsCard label="Total Bookings" value={String(monthlyBookingsCount)} />
        <StatsCard label="Revenue" value={formatPrice(monthlyRevenue)} />
        <StatsCard label="Pending Payments" value={String(pendingPayments.length)} />
        <StatsCard
          label="Unread Messages"
          value={String(unreadIntercomCount)}
          onClick={() => navigate("/intercom")}
          icon={<MessageSquare size={18} />}
        />
      </div>
      {/* Operational workflow sections */}
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-heading text-gray-950 lowercase tracking-tight">
                <CreditCard size={18} className="text-primary" />
                pending payment alerts
              </h2>
              <span className="rounded-full bg-primary-light px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-dark">
                {pendingPayments.length} queued
              </span>
            </div>
            <div className="space-y-3">
              {pendingPayments.length > 0 ? pendingPayments.map((booking) => (
                <div key={booking.id} className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-[72px_1fr_auto] sm:items-center">
                  <a
                    href={booking.paymentProofUrl || undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex h-16 w-full items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-white sm:w-16"
                    aria-label={`Open payment proof for ${booking.bookingRef}`}
                  >
                    {booking.paymentProofUrl ? (
                      <img src={booking.paymentProofUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <CreditCard size={18} className="text-gray-400" />
                    )}
                  </a>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold text-gray-900">{booking.bookingRef}</p>
                      <StatusBadge label="payment uploaded" status="payment-uploaded" />
                    </div>
                    <p className="truncate text-xs text-gray-600">{booking.guestName} · Room {booking.roomNumber || "TBD"}</p>
                    <p className="text-[10px] font-semibold text-gray-400">{booking.checkIn} to {booking.checkOut} · {formatPrice(booking.totalPrice)}</p>
                  </div>
                  <div className="flex flex-col gap-2 sm:w-36">
                    {booking.paymentProofUrl && (
                      <a
                        href={booking.paymentProofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[34px] items-center justify-center gap-1.5 rounded-lg border border-gray-250 bg-white px-3 text-[10px] font-bold text-gray-700 hover:bg-gray-50"
                      >
                        <Eye size={12} />
                        View Proof
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => void confirmPayment(booking.id)}
                      className="inline-flex min-h-[34px] items-center justify-center rounded-lg bg-primary px-3 text-[10px] font-bold text-white hover:bg-primary-dark"
                    >
                      Confirm Payment
                  </button>
                  </div>
                </div>
              )) : (
                <p className="rounded-lg border border-dashed border-gray-250 bg-gray-50 p-4 text-center text-xs font-semibold text-gray-500">
                  No payment proofs are waiting for review.
                </p>
              )}
            </div>
          </section>

          {/* Today's Breakfast Prep */}
          <section className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-lg font-heading text-gray-950 lowercase tracking-tight">
                <Utensils size={18} className="text-primary" />
                today's breakfast prep
              </h2>
              {todaysBreakfastItems.length > 0 && (
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                  unservedBreakfastCount > 0
                    ? "bg-amber-100 text-amber-800"
                    : "bg-green-105 text-green-700"
                }`}>
                  {unservedBreakfastCount > 0 ? `${unservedBreakfastCount} remaining` : "all served"}
                </span>
              )}
            </div>

            <div className="space-y-3">
              {todaysBreakfastItems.length > 0 ? (
                todaysBreakfastItems.map((item) => (
                  <div
                    key={`${item.bookingId}-${item.key}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900">Room {item.roomNumber}</span>
                        <span className="text-xs text-gray-600">· {item.guestName}</span>
                      </div>
                      <p className="mt-1 text-xs font-semibold text-primary-dark">
                        Order: {item.selection}
                      </p>
                      <p className="text-[10px] font-semibold text-gray-400">
                        Guest {item.guestIndex} · {item.bookingRef}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleBreakfastServed(item.bookingId, item.key, item.served)}
                      className={`min-h-[34px] px-4 rounded-lg text-xs font-bold transition shadow-sm active:scale-95 flex items-center gap-1.5 ${
                        item.served
                          ? "bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
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
                <div className="rounded-lg border border-dashed border-gray-250 bg-gray-50 p-6 text-center">
                  <Utensils size={24} className="mx-auto text-gray-300 mb-2" />
                  <p className="text-xs font-semibold text-gray-500">No breakfast orders today.</p>
                </div>
              )}
            </div>
          </section>
        </div>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-1">
          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-heading text-gray-950 lowercase tracking-tight">
              <LogIn size={18} className="text-primary" />
              today's arrivals
            </h2>
            <div className="space-y-2">
              {todaysArrivals.length > 0 ? todaysArrivals.map((booking) => (
                <button
                  key={booking.id}
                  type="button"
                  onClick={() => openBooking(booking.id)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 text-left hover:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-gray-900">{booking.guestName}</span>
                    <span className="block text-[10px] font-semibold text-gray-500">Room {booking.roomNumber || "TBD"} · {booking.bookingRef}</span>
                  </span>
                  <ArrowRight size={14} className="shrink-0 text-gray-400" />
                </button>
              )) : (
                <p className="rounded-lg bg-gray-50 p-3 text-xs font-semibold text-gray-500">No arrivals today.</p>
              )}
            </div>
          </div>

          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-heading text-gray-950 lowercase tracking-tight">
              <LogOut size={18} className="text-primary" />
              today's departures
            </h2>
            <div className="space-y-2">
              {todaysDepartures.length > 0 ? todaysDepartures.map((booking) => (
                <button
                  key={booking.id}
                  type="button"
                  onClick={() => openBooking(booking.id)}
                  className="flex min-h-[44px] w-full items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 text-left hover:bg-gray-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold text-gray-900">{booking.guestName}</span>
                    <span className="block text-[10px] font-semibold text-gray-500">Room {booking.roomNumber || "TBD"} · {booking.bookingRef}</span>
                  </span>
                  <ArrowRight size={14} className="shrink-0 text-gray-400" />
                </button>
              )) : (
                <p className="rounded-lg bg-gray-50 p-3 text-xs font-semibold text-gray-500">No departures today.</p>
              )}
            </div>
          </div>

          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <h2 className="mb-3 flex items-center justify-between gap-2 text-lg font-heading text-gray-950 lowercase tracking-tight">
              <span className="flex items-center gap-2">
                <MessageSquare size={18} className="text-primary" />
                Active Guest Chats
              </span>
              {activeIntercomThreads.some(t => t.unreadCount > 0) && (
                <span className="rounded-full bg-green-105 px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-green-700">
                  Unread
                </span>
              )}
            </h2>
            <div className="space-y-2">
              {activeIntercomThreads.length > 0 ? (
                activeIntercomThreads.slice(0, 5).map((thread) => {
                  const hasUnread = thread.unreadCount > 0;
                  return (
                    <button
                      key={thread.roomId}
                      type="button"
                      onClick={() => navigate(`/intercom?room=${encodeURIComponent(thread.roomNumber)}`)}
                      className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-lg border px-3 text-left transition hover:bg-gray-50 ${
                        hasUnread ? "border-green-300 bg-green-50/20 shadow-sm" : "border-gray-200"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${hasUnread ? "bg-green-500 animate-pulse" : "bg-gray-300"}`} />
                          <span className="text-xs font-bold text-gray-900">Room {thread.roomNumber}</span>
                          <span className="text-[10px] font-semibold text-gray-400">· {thread.guestName}</span>
                        </div>
                        {thread.lastMessage ? (
                          <p className="truncate mt-0.5 text-[10px] text-gray-600 font-semibold leading-normal">
                            <span className="font-bold text-gray-550">{thread.lastMessage.sender === "guest" ? "Guest: " : "Staff: "}</span>
                            {thread.lastMessage.text}
                          </p>
                        ) : (
                          <p className="mt-0.5 text-[10px] text-gray-400 italic">No messages yet</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {hasUnread && (
                          <span className="rounded-full bg-green-500 px-2 py-0.5 text-[9px] font-bold text-white leading-none">
                            {thread.unreadCount}
                          </span>
                        )}
                        <ExternalLink size={12} className="text-gray-400" />
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-6 text-center text-gray-400 rounded-lg bg-gray-50 border border-dashed border-gray-200">
                  <MessageSquare size={24} className="text-gray-300 mb-1.5" />
                  <p className="text-xs font-semibold text-gray-500">No active guest chats.</p>
                </div>
              )}
            </div>
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
    </div>
  );
}
