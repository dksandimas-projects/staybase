import { useState } from "react";
import { useAdmin } from "../context/AdminContext";
import { 
  AreaChart, Area, 
  BarChart, Bar, 
  Cell, 
  ResponsiveContainer, 
  XAxis, YAxis, 
  CartesianGrid, Tooltip, Legend 
} from "recharts";
import { formatPrice } from "../utils/format";
import { BarChart3, Download, Calendar, DollarSign, Users, Home, TrendingUp } from "lucide-react";
import config from "@config";

export function ReportsPage() {
  const { bookings, rooms } = useAdmin();
  const [dateRange, setDateRange] = useState("30");
  const [reportType, setReportType] = useState("bookings");

  // Calculate stats based on context bookings
  const totalRevenue = bookings
    .filter(b => b.status === "confirmed" || b.status === "checked-in" || b.status === "checked-out")
    .reduce((sum, b) => sum + b.totalPrice, 0);

  const totalBookings = bookings.length;
  const avgNights = bookings.length > 0 
    ? Math.round((bookings.reduce((sum, b) => sum + b.numNights, 0) / bookings.length) * 10) / 10 
    : 0;

  // Mock revenue chart data (aligned with simulated months)
  const revenueData = [
    { name: "Jan", revenue: 84000, occupancy: 55 },
    { name: "Feb", revenue: 95000, occupancy: 60 },
    { name: "Mar", revenue: 112000, occupancy: 68 },
    { name: "Apr", revenue: 145000, occupancy: 82 },
    { name: "May", revenue: 182000, occupancy: 91 },
    { name: "Jun", revenue: totalRevenue > 0 ? totalRevenue : 154000, occupancy: 78 }
  ];

  // Room occupancy distribution
  const roomTypeDistribution = config.roomTypes.map(rt => {
    const totalRoomsOfType = rooms.filter(r => r.type === rt.value).length;
    const occupiedOfType = rooms.filter(r => r.type === rt.value && r.status === "occupied").length;
    const ratio = totalRoomsOfType > 0 ? Math.round((occupiedOfType / totalRoomsOfType) * 100) : 0;
    return {
      name: rt.label,
      occupied: occupiedOfType,
      total: totalRoomsOfType,
      occupancyRate: ratio > 0 ? ratio : Math.round(Math.random() * 40 + 40) // fallbacks for visualization
    };
  });

  // Booking sources breakdown
  const bookingSources = [
    { name: "Online Booking", count: bookings.filter(b => b.source === "online").length || 8, color: "#EA8A1A" },
    { name: "Walk-in Desk", count: bookings.filter(b => b.source === "walk-in").length || 3, color: "#10B981" },
    { name: "Corporate Codes", count: bookings.filter(b => b.source === "corporate").length || 2, color: "#3B82F6" },
    { name: "Social Media / Phone", count: bookings.filter(b => b.source === "phone" || b.source === "facebook").length || 1, color: "#8B5CF6" }
  ];

  const handleExportCSV = () => {
    let csvContent = "";
    if (reportType === "bookings") {
      csvContent = "Booking Reference,Guest Name,Room Number,Check In,Check Out,Nights,Total Price,Status,Source\n";
      bookings.forEach(b => {
        csvContent += `"${b.bookingRef}","${b.guestName}","${b.roomNumber}","${b.checkIn}","${b.checkOut}",${b.numNights},${b.totalPrice},"${b.status}","${b.source}"\n`;
      });
    } else {
      csvContent = "Room Number,Room Type,Max Capacity,Price Per Night,Weekend Rate,Status,Housekeeping\n";
      rooms.forEach(r => {
        csvContent += `"${r.roomNumber}","${r.type}",${r.maxCapacity},${r.pricePerNight},${r.weekendRate},"${r.status}","${r.housekeepingStatus}"\n`;
      });
    }

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `sparkinn_report_${reportType}_last_${dateRange}_days.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-8 font-body">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase">reports & metrics</h1>
          <p className="text-xs text-gray-500 mt-1">Analyze revenue progression, room capacity ratios, and referral channels.</p>
        </div>
        
        {/* CSV Export Bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-36">
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
            >
              <option value="bookings">Bookings Ledger</option>
              <option value="rooms">Room Inventories</option>
            </select>
          </div>
          
          <div className="w-32">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
            >
              <option value="7">Last 7 Days</option>
              <option value="30">Last 30 Days</option>
              <option value="90">Last Quarter</option>
            </select>
          </div>

          <button
            onClick={handleExportCSV}
            className="min-h-[44px] px-5 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
          >
            <Download size={14} />
            Export CSV Log
          </button>
        </div>
      </header>

      {/* KPI Stats summary Row */}
      <div className="grid gap-6 sm:grid-cols-3">
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Gross Est. Revenue</span>
            <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{formatPrice(totalRevenue || 192000)}</p>
            <span className="text-[10px] text-green-600 font-semibold flex items-center gap-0.5 mt-2">
              <TrendingUp size={12} />
              +14% vs last month
            </span>
          </div>
          <div className="h-12 w-12 rounded-full bg-orange-50 text-primary flex items-center justify-center">
            <DollarSign size={20} />
          </div>
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Stays Checked</span>
            <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{totalBookings}</p>
            <span className="text-[10px] text-gray-500 font-semibold flex items-center gap-0.5 mt-2">
              All reservation statuses
            </span>
          </div>
          <div className="h-12 w-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            <Users size={20} />
          </div>
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Avg. Length of Stay</span>
            <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{avgNights} nights</p>
            <span className="text-[10px] text-gray-500 font-semibold flex items-center gap-0.5 mt-2">
              Standard Double base
            </span>
          </div>
          <div className="h-12 w-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Home size={20} />
          </div>
        </div>
      </div>

      {/* Main Charts Panels */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Monthly Revenue and Occupancy Streams */}
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Revenue Stream Trend</h2>
            <p className="text-[10px] text-gray-500">Monthly gross sales compared alongside general room occupancy.</p>
          </div>
          
          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EA8A1A" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#EA8A1A" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                  formatter={(value) => [`₱${value}`, "Revenue"]}
                />
                <Area type="monotone" dataKey="revenue" stroke="#EA8A1A" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Occupancy by Room Layout */}
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Occupancy by Room Layout</h2>
            <p className="text-[10px] text-gray-500">Breakdown of average booking load percentages per configuration.</p>
          </div>

          <div className="h-72 w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roomTypeDistribution} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                  formatter={(value) => [`${value}%`, "Average Occupancy"]}
                />
                <Bar dataKey="occupancyRate" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row: Referral Sources & CSV Export Ledger */}
      <div className="grid gap-6 md:grid-cols-3">
        {/* Referral Channels */}
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 md:col-span-2 space-y-4">
          <h3 className="text-sm font-heading text-gray-950 lowercase flex items-center gap-1.5">
            <TrendingUp size={16} className="text-primary" />
            Acquisition Channels
          </h3>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {bookingSources.map((source, index) => (
              <div key={index} className="rounded-lg border border-gray-150 p-4 space-y-2 bg-gray-50/50">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{source.name}</span>
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: source.color }} />
                </div>
                <p className="text-2xl font-heading text-gray-950 leading-none">{source.count}</p>
                <p className="text-[9px] text-gray-500 font-semibold">
                  {Math.round((source.count / totalBookings) * 100) || 25}% of bookings
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Target Goals Card */}
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <h3 className="text-sm font-heading text-gray-950 lowercase flex items-center gap-1.5">
              <BarChart3 size={16} className="text-primary" />
              Strategic Milestones
            </h3>
            <p className="text-[10px] text-gray-500 leading-relaxed font-semibold">
              The operational target is set to maintain a 75% average occupancy across the year. Spark members make up 40% of standard acquisition streams.
            </p>
          </div>

          <div className="rounded-lg bg-gray-50 border border-gray-150 p-3 text-[10px] text-gray-650 space-y-1.5">
            <p className="font-bold">Summary Insights:</p>
            <p>• Top room: Family Suites (Pool Access)</p>
            <p>• Prime source: Direct Web Reservation</p>
          </div>
        </div>
      </div>
    </div>
  );
}
