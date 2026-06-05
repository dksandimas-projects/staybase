import { useAdmin } from "../context/AdminContext";
import { StatsCard } from "../components/StatsCard";
import { StatusBadge } from "../components/StatusBadge";
import { BedDouble, Check, RefreshCw, AlertTriangle, ShieldCheck } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export function DashboardPage() {
  const { rooms, bookings, toggleHousekeepingStatus, roomTypes } = useAdmin();

  // Metrics Calculations
  const totalRoomsCount = rooms.length;
  const occupiedRoomsCount = rooms.filter(r => r.status === "occupied").length;
  const occupancyPercentage = Math.round((occupiedRoomsCount / totalRoomsCount) * 100);

  const activeBookingsCount = bookings.filter(b => b.status === "confirmed" || b.status === "checked-in").length;
  const checkedInToday = bookings.filter(b => b.status === "checked-in").length;
  const dirtyRoomsCount = rooms.filter(r => r.housekeepingStatus === "dirty").length;

  const chartData = [
    { day: "Mon", rate: 60 },
    { day: "Tue", rate: 65 },
    { day: "Wed", rate: 70 },
    { day: "Thu", rate: 68 },
    { day: "Fri", rate: 85 },
    { day: "Sat", rate: 90 },
    { day: "Sun", rate: 80 }
  ];

  // Helper to format room type labels
  const roomTypesLabels = roomTypes.reduce((acc, t) => {
    acc[t.value] = t.shortLabel;
    return acc;
  }, {} as Record<string, string>);

  return (
    <div className="space-y-8 font-body">
      <header>
        <h1 className="font-heading text-3xl text-gray-950 lowercase">dashboard overview</h1>
        <p className="text-xs text-gray-500 mt-1">Real-time room occupancy and housekeeping operations overview.</p>
      </header>

      {/* Stats Cards Row */}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard label="Occupancy Rate" value={`${occupancyPercentage}%`} trend="+8% from last week" />
        <StatsCard label="Active Bookings" value={String(activeBookingsCount)} />
        <StatsCard label="Checked In Today" value={String(checkedInToday)} />
        <StatsCard label="Dirty Rooms" value={String(dirtyRoomsCount)} trend={`${dirtyRoomsCount} urgent`} />
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
                          : "bg-green-50 text-green-700 hover:bg-green-100 border border-green-200"
                      }`}
                      title="Click to toggle Clean/Dirty status"
                    >
                      {isDirty ? (
                        <>
                          <AlertTriangle size={12} />
                          Dirty
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
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                    itemStyle={{ color: "#fff" }}
                    labelStyle={{ display: "none" }}
                  />
                  <Bar dataKey="rate" fill="#EA8A1A" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4 mt-4 flex items-start gap-2.5">
            <ShieldCheck className="text-primary shrink-0 mt-0.5" size={16} />
            <p className="text-[10px] text-gray-500 leading-relaxed font-semibold">
              Weekly benchmarks verify an average occupancy of 75% for Tagbilaran City. Target goals set at 80% for summer peak ranges.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
