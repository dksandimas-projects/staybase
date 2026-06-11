import { useState, useMemo } from "react";
import { useAdmin } from "../context/AdminContext";
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie,
  Cell,
  ResponsiveContainer,
  XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from "recharts";
import { formatPrice } from "../utils/format";
import { AlertTriangle, BarChart3, Download, DollarSign, Users, Home, TrendingUp, Utensils, Coffee, Package, ShoppingBag } from "lucide-react";
import config from "@config";

export function ReportsPage() {
  const { bookings, rooms, roomTypes, breakfastConfig, storeOrders, storeItems } = useAdmin();
  const [dateRange, setDateRange] = useState("30");
  const [reportType, setReportType] = useState("bookings");
  const chartColors = [
    config.colors.primary,
    config.colors.primaryDark,
    config.colors.primaryLight,
    config.colors.sidebar,
    config.colors.sectionBg
  ];

  const periodStart = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (Number(dateRange) - 1));
    return start;
  }, [dateRange]);

  const isWithinSelectedRange = (value: string | Date | null | undefined) => {
    if (!value) return false;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    return date >= periodStart;
  };

  // Calculate stats based on context bookings
  const totalRevenue = bookings
    .filter(b => b.status === "confirmed" || b.status === "checked-in" || b.status === "checked-out")
    .reduce((sum, b) => sum + b.totalPrice, 0);

  const totalBookings = bookings.length;
  const avgNights = bookings.length > 0
    ? Math.round((bookings.reduce((sum, b) => sum + b.numNights, 0) / bookings.length) * 10) / 10
    : 0;

  // ── Breakfast report data ──
  const breakfastBookings = useMemo(() =>
    bookings.filter(b =>
      b.hasBreakfast &&
      (b.status === "confirmed" || b.status === "checked-in" || b.status === "checked-out")
    ), [bookings]
  );

  const totalBreakfastRevenue = useMemo(() =>
    breakfastBookings.reduce((sum, b) =>
      sum + ((b.breakfastRate || 0) * b.numGuests * b.numNights), 0
    ), [breakfastBookings]
  );

  // Daily kitchen prep: aggregate silog counts per date across all breakfast bookings
  const dailyKitchenPrep = useMemo(() => {
    const dateMap: Record<string, Record<string, number>> = {};

    for (const b of breakfastBookings) {
      for (let i = 0; i < b.numNights; i++) {
        const date = new Date(b.checkIn);
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split("T")[0];

        if (!dateMap[dateStr]) dateMap[dateStr] = {};

        for (let g = 1; g <= b.numGuests; g++) {
          const key = `${dateStr}-guest-${g}`;
          const selection = b.breakfastSelections?.[key];
          if (selection) {
            dateMap[dateStr][selection] = (dateMap[dateStr][selection] || 0) + 1;
          }
        }
      }
    }

    // Convert to sorted array
    const sortedDates = Object.keys(dateMap).sort();
    const allItems = new Set<string>();
    for (const date of sortedDates) {
      Object.keys(dateMap[date]).forEach(item => allItems.add(item));
    }

    return { dates: sortedDates, items: Array.from(allItems), counts: dateMap };
  }, [breakfastBookings]);

  // Breakfast daily covers (total selections per day)
  const breakfastDailyCovers = useMemo(() => {
    return dailyKitchenPrep.dates.map(date => {
      const dayCounts = dailyKitchenPrep.counts[date] || {};
      const total = Object.values(dayCounts).reduce((s, c) => s + c, 0);
      return { name: date.slice(5), covers: total }; // "MM-DD" format
    });
  }, [dailyKitchenPrep]);

  // Breakfast revenue by booking (for chart)
  const breakfastRevenueData = useMemo(() => {
    return breakfastBookings.map(b => ({
      name: b.bookingRef,
      revenue: (b.breakfastRate || 0) * b.numGuests * b.numNights,
      guests: b.numGuests,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [breakfastBookings]);

  // Spark Essentials store reports
  const storeOrdersInRange = useMemo(() =>
    storeOrders.filter(order => isWithinSelectedRange(order.createdAt)),
    [storeOrders, periodStart]
  );

  const deliveredStoreOrders = useMemo(() =>
    storeOrdersInRange.filter(order => order.status === "delivered"),
    [storeOrdersInRange]
  );

  const storeRevenue = useMemo(() =>
    deliveredStoreOrders.reduce((sum, order) => sum + order.totalAmount, 0),
    [deliveredStoreOrders]
  );

  const topStoreItems = useMemo(() => {
    const itemMap = new Map<string, { name: string; quantity: number; revenue: number }>();

    deliveredStoreOrders.forEach(order => {
      order.items.forEach(item => {
        const current = itemMap.get(item.itemId) || { name: item.name, quantity: 0, revenue: 0 };
        current.quantity += item.quantity;
        current.revenue += item.price * item.quantity;
        itemMap.set(item.itemId, current);
      });
    });

    return Array.from(itemMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);
  }, [deliveredStoreOrders]);

  const storeOrdersByPayment = useMemo(() => {
    const labels: Record<string, string> = {
      cod: "Cash on Delivery",
      "add-to-bill": "Add to Bill",
      gcash: "GCash"
    };

    return Object.entries(
      storeOrdersInRange.reduce((methods, order) => {
        methods[order.paymentMethod] = (methods[order.paymentMethod] || 0) + 1;
        return methods;
      }, {} as Record<string, number>)
    ).map(([method, count]) => ({
      name: labels[method] || method,
      count
    }));
  }, [storeOrdersInRange]);

  const storeOrdersByStatus = useMemo(() => {
    const labels: Record<string, string> = {
      placed: "Placed",
      confirmed: "Confirmed",
      "out-for-delivery": "Out for Delivery",
      delivered: "Delivered",
      cancelled: "Cancelled"
    };

    return Object.entries(
      storeOrdersInRange.reduce((statuses, order) => {
        statuses[order.status] = (statuses[order.status] || 0) + 1;
        return statuses;
      }, {} as Record<string, number>)
    ).map(([status, count]) => ({
      name: labels[status] || status,
      count
    }));
  }, [storeOrdersInRange]);

  const lowStockItems = useMemo(() =>
    storeItems
      .filter(item => item.stock !== null && item.stock <= 5)
      .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0)),
    [storeItems]
  );

  const getStayDates = (booking: typeof bookings[0]) => {
    return Array.from({ length: booking.numNights }, (_, index) => {
      const date = new Date(booking.checkIn);
      date.setDate(date.getDate() + index);
      return date.toISOString().split("T")[0];
    });
  };

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
  const roomTypeDistribution = roomTypes.map(rt => {
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
    } else if (reportType === "breakfast") {
      // Daily kitchen prep CSV: each row is one date with silog counts
      const items = dailyKitchenPrep.items;
      csvContent = `Date,${items.join(",")},Total Covers\n`;
      for (const date of dailyKitchenPrep.dates) {
        const dayCounts = dailyKitchenPrep.counts[date] || {};
        const rowTotal = Object.values(dayCounts).reduce((s: number, c: number) => s + c, 0);
        const cellValues = items.map(item => dayCounts[item] || 0);
        csvContent += `${date},${cellValues.join(",")},${rowTotal}\n`;
      }
    } else if (reportType === "store") {
      csvContent = "Order Ref,Room,Items,Quantity,Total,Payment Method,Status,Date\n";
      storeOrdersInRange.forEach(order => {
        const itemNames = order.items.map(item => `${item.quantity}x ${item.name}`).join("; ");
        const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
        csvContent += `"${order.orderRef}","${order.roomNumber}","${itemNames}",${quantity},${order.totalAmount},"${order.paymentMethod}","${order.status}","${order.createdAt}"\n`;
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
              <option value="breakfast">Breakfast & Dining</option>
              <option value="store">Store Reports</option>
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

      {/* ════════════════════════════════════════════════════════════════════
          BREAKFAST & DINING REPORTS
          ════════════════════════════════════════════════════════════════════ */}
      {reportType === "breakfast" && (
        <div className="space-y-8">
          {/* Breakfast KPI Row */}
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Breakfast Revenue</span>
                <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{formatPrice(totalBreakfastRevenue)}</p>
                <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
                  {breakfastBookings.length} breakfast bookings
                </span>
              </div>
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Coffee size={20} />
              </div>
            </div>

            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Rate Per Person</span>
                <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{formatPrice(breakfastConfig.ratePerPersonPerNight || 0)}</p>
                <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
                  Per guest / per night
                </span>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                <DollarSign size={20} />
              </div>
            </div>

            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Active Silog Items</span>
                <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">
                  {breakfastConfig.silogItems.filter((i: any) => i.isActive).length}
                </p>
                <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
                  Service: {breakfastConfig.isEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="h-12 w-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <Utensils size={20} />
              </div>
            </div>
          </div>

          {/* Daily Kitchen Prep Report */}
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
            <div>
              <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Daily Kitchen Prep Report</h2>
              <p className="text-[10px] text-gray-500">Aggregated silog counts per date — what the kitchen needs to prepare each morning.</p>
            </div>

            {dailyKitchenPrep.dates.length === 0 ? (
              <div className="text-center py-12 text-gray-400">
                <Utensils size={32} className="mx-auto mb-3 opacity-40" />
                <p className="text-xs font-semibold">No breakfast selections recorded yet.</p>
                <p className="text-[10px] mt-1">Selections are entered at check-in from the booking detail drawer.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b-2 border-primary/20 text-left">
                      <th className="py-2.5 pr-4 text-[10px] font-bold uppercase tracking-wider text-gray-400">Date</th>
                      {dailyKitchenPrep.items.map(item => (
                        <th key={item} className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 text-center">
                          {item}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-primary text-center">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {dailyKitchenPrep.dates.map(date => {
                      const dayCounts = dailyKitchenPrep.counts[date] || {};
                      const dayTotal = Object.values(dayCounts).reduce((s: number, c: number) => s + c, 0);
                      return (
                        <tr key={date} className="hover:bg-gray-50/50">
                          <td className="py-2.5 pr-4 font-semibold text-gray-800">
                            {new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                          </td>
                          {dailyKitchenPrep.items.map(item => (
                            <td key={item} className="px-3 py-2.5 text-center text-gray-600 font-mono">
                              {dayCounts[item] || "—"}
                            </td>
                          ))}
                          <td className="px-3 py-2.5 text-center font-bold text-primary font-mono">{dayTotal}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-gray-200 bg-gray-50/70">
                      <td className="py-2.5 pr-4 text-[10px] font-bold text-gray-500 uppercase">Totals</td>
                      {dailyKitchenPrep.items.map(item => {
                        const total = dailyKitchenPrep.dates.reduce(
                          (s, d) => s + ((dailyKitchenPrep.counts[d] || {})[item] || 0), 0
                        );
                        return (
                          <td key={item} className="px-3 py-2.5 text-center font-bold text-gray-700 font-mono">{total}</td>
                        );
                      })}
                      <td className="px-3 py-2.5 text-center font-bold text-primary-dark font-mono">
                        {dailyKitchenPrep.dates.reduce(
                          (s, d) => s + Object.values(dailyKitchenPrep.counts[d] || {}).reduce((a: number, c: number) => a + c, 0), 0
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Breakfast Revenue per Booking */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
              <div>
                <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Breakfast Revenue by Booking</h2>
                <p className="text-[10px] text-gray-500">Top breakfast bookings ranked by revenue contribution.</p>
              </div>
              {breakfastRevenueData.length === 0 ? (
                <p className="text-xs text-gray-400 py-8 text-center">No breakfast bookings yet.</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {breakfastRevenueData.slice(0, 15).map((item, i) => (
                    <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg border border-gray-100 bg-gray-50/50">
                      <div>
                        <p className="text-xs font-semibold text-gray-800">{item.name}</p>
                        <p className="text-[10px] text-gray-400">{item.guests} guest{item.guests > 1 ? "s" : ""}</p>
                      </div>
                      <span className="text-xs font-bold text-primary-dark">{formatPrice(item.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Daily Covers Chart */}
            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
              <div>
                <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Daily Breakfast Covers</h2>
                <p className="text-[10px] text-gray-500">Total silog selections per day across all guests.</p>
              </div>
              {breakfastDailyCovers.length === 0 ? (
                <p className="text-xs text-gray-400 py-8 text-center">No breakfast data yet.</p>
              ) : (
                <div className="h-72 w-full pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={breakfastDailyCovers} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                        formatter={(value) => [value, "Covers"]}
                      />
                      <Bar dataKey="covers" fill="#EA8A1A" radius={[4, 4, 0, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Spark Essentials store reports */}
      {reportType === "store" && (
        <div className="space-y-8">
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Store Revenue</span>
                <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{formatPrice(storeRevenue)}</p>
                <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
                  Delivered orders only
                </span>
              </div>
              <div className="h-12 w-12 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <ShoppingBag size={20} />
              </div>
            </div>

            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Orders in Range</span>
                <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{storeOrdersInRange.length}</p>
                <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
                  {deliveredStoreOrders.length} delivered
                </span>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                <Package size={20} />
              </div>
            </div>

            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
              <div>
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Low Stock Items</span>
                <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{lowStockItems.length}</p>
                <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
                  Finite stock at or below 5
                </span>
              </div>
              <div className="h-12 w-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
                <AlertTriangle size={20} />
              </div>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
              <div>
                <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Top-Selling Store Items</h2>
                <p className="text-[10px] text-gray-500">Delivered order revenue by item for the selected period.</p>
              </div>
              {topStoreItems.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  <ShoppingBag size={32} className="mx-auto mb-3 opacity-40" />
                  <p className="text-xs font-semibold">No delivered store orders in this range.</p>
                  <p className="text-[10px] mt-1">Delivered orders will appear here after front desk completes them.</p>
                </div>
              ) : (
                <div className="h-72 w-full pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topStoreItems} layout="vertical" margin={{ top: 10, right: 20, left: 18, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                        formatter={(value, name) => [name === "revenue" ? formatPrice(Number(value)) : value, name === "revenue" ? "Revenue" : "Quantity"]}
                      />
                      <Bar dataKey="revenue" fill={config.colors.primary} radius={[0, 4, 4, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
              <div>
                <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Orders by Status</h2>
                <p className="text-[10px] text-gray-500">Operational count of placed, active, delivered, and cancelled orders.</p>
              </div>
              {storeOrdersByStatus.length === 0 ? (
                <p className="text-xs text-gray-400 py-8 text-center">No store orders in this range.</p>
              ) : (
                <div className="h-72 w-full pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={storeOrdersByStatus} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                        formatter={(value) => [value, "Orders"]}
                      />
                      <Bar dataKey="count" fill={config.colors.primary} radius={[4, 4, 0, 0]} barSize={24} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
              <div>
                <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Payment Methods</h2>
                <p className="text-[10px] text-gray-500">Store order mix by guest payment choice.</p>
              </div>
              {storeOrdersByPayment.length === 0 ? (
                <p className="text-xs text-gray-400 py-8 text-center">No payment data yet.</p>
              ) : (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={storeOrdersByPayment} dataKey="count" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={4}>
                        {storeOrdersByPayment.map((entry, index) => (
                          <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                        formatter={(value) => [value, "Orders"]}
                      />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: "10px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4 lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Low Stock Alerts</h2>
                  <p className="text-[10px] text-gray-500">Items with finite stock at or below the default threshold of 5.</p>
                </div>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Inventory
                </span>
              </div>

              {lowStockItems.length === 0 ? (
                <div className="rounded-lg border border-gray-150 bg-gray-50/70 p-6 text-center">
                  <p className="text-xs font-semibold text-gray-600">No low-stock items right now.</p>
                  <p className="text-[10px] text-gray-400 mt-1">Finite stock items will appear here as they approach zero.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {lowStockItems.slice(0, 8).map(item => (
                    <div key={item.id} className="rounded-lg border border-gray-150 bg-gray-50/60 p-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold text-gray-900">{item.name}</p>
                        <p className="text-[10px] text-gray-500 capitalize">{item.category}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-[10px] font-bold ${item.stock === 0 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                        {item.stock === 0 ? "Out" : `${item.stock} left`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
            <div>
              <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Store Order Ledger</h2>
              <p className="text-[10px] text-gray-500">All store orders in the selected period, including non-revenue statuses for operational review.</p>
            </div>

            {storeOrdersInRange.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">No store orders in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b-2 border-primary/20 text-left">
                      <th className="py-2.5 pr-4 text-[10px] font-bold uppercase tracking-wider text-gray-400">Order</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Room</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Items</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Payment</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Status</th>
                      <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {storeOrdersInRange.slice(0, 20).map(order => (
                      <tr key={order.id} className="hover:bg-gray-50/50">
                        <td className="py-2.5 pr-4 font-semibold text-gray-900">{order.orderRef}</td>
                        <td className="px-3 py-2.5 text-gray-600">{order.roomNumber}</td>
                        <td className="px-3 py-2.5 text-gray-600">
                          {order.items.map(item => `${item.quantity}x ${item.name}`).join(", ")}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600">{order.paymentMethod}</td>
                        <td className="px-3 py-2.5">
                          <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700">
                            {order.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-bold text-primary-dark">{formatPrice(order.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
