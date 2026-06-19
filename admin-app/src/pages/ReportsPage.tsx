import { useState, useMemo } from "react";
import { useAdmin } from "../context/AdminContext";
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie,
  Cell,
  ResponsiveContainer,
  XAxis, YAxis,
  CartesianGrid, Tooltip, Legend,
  LineChart, Line
} from "recharts";
import { formatPrice } from "../utils/format";
import { useBreakpoint } from "../utils/useBreakpoint";
import {
  AlertTriangle, BarChart3, Download, DollarSign, Users, Home,
  TrendingUp, Utensils, Coffee, Package, ShoppingBag, FileSpreadsheet
} from "lucide-react";
import config from "@config";
import * as XLSX from "xlsx";

type ReportTab = "performance" | "sales";
type SalesSubTab = "bookings" | "breakfast" | "store";

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat(config.locale, { month: "short", year: "2-digit" }).format(date);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value && typeof (value as any).toDate === "function") {
    return (value as any).toDate();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const PAYMENT_LABELS: Record<string, string> = {
  gcash: "GCash",
  "pay-at-hotel": "Pay at Hotel",
  paypal: "PayPal",
  bank: "Bank Transfer",
  cod: "Cash on Delivery",
  "add-to-bill": "Add to Bill"
};

const STORE_STATUS_LABELS: Record<string, string> = {
  placed: "Placed",
  confirmed: "Confirmed",
  "out-for-delivery": "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled"
};

export function ReportsPage() {
  const { bookings, rooms, roomTypes, breakfastConfig, storeOrders, storeItems, currentUser } = useAdmin();
  const { isMobile } = useBreakpoint();
  const [activeTab, setActiveTab] = useState<ReportTab>("performance");
  const [dateRange, setDateRange] = useState("30");
  const [salesSubTab, setSalesSubTab] = useState<SalesSubTab>("bookings");
  const [searchTerm, setSearchTerm] = useState("");

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

  const periodEnd = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return end;
  }, []);

  const isWithinSelectedRange = (value: string | Date | null | undefined) => {
    const date = toDate(value);
    if (!date) return false;
    return date >= periodStart && date <= periodEnd;
  };

  // ── Revenue-eligible bookings (confirmed, checked-in, checked-out) ──
  const revenueBookings = useMemo(() =>
    bookings.filter(b =>
      b.status === "confirmed" || b.status === "checked-in" || b.status === "checked-out"
    ),
    [bookings]
  );

  const rangeBookings = useMemo(
    () => revenueBookings.filter(b => isWithinSelectedRange(b.checkIn)),
    [revenueBookings, periodStart, periodEnd]
  );

  const rangeStoreOrders = useMemo(
    () => storeOrders.filter(o => isWithinSelectedRange(o.createdAt)),
    [storeOrders, periodStart, periodEnd]
  );

  const deliveredStoreOrders = useMemo(
    () => rangeStoreOrders.filter(o => o.status === "delivered"),
    [rangeStoreOrders]
  );

  // ── Summary KPIs ──
  const roomRevenue = useMemo(
    () => rangeBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0),
    [rangeBookings]
  );

  const breakfastBookingsInRange = useMemo(
    () => rangeBookings.filter(b => b.hasBreakfast),
    [rangeBookings]
  );

  const breakfastRevenue = useMemo(
    () => breakfastBookingsInRange.reduce(
      (sum, b) => sum + (b.breakfastRate || 0) * (b.numGuests || 0) * (b.numNights || 0),
      0
    ),
    [breakfastBookingsInRange]
  );

  const storeRevenue = useMemo(
    () => deliveredStoreOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
    [deliveredStoreOrders]
  );

  const totalRevenue = roomRevenue + breakfastRevenue + storeRevenue;
  const totalTransactions = rangeBookings.length + deliveredStoreOrders.length;

  // ── Monthly revenue by stream (stacked bar) ──
  const monthlyRevenue = useMemo(() => {
    const map = new Map<string, { month: string; room: number; breakfast: number; store: number; total: number; sortKey: string }>();

    const ensureMonth = (d: Date) => {
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      if (!map.has(key)) {
        map.set(key, {
          month: formatMonthLabel(d),
          room: 0,
          breakfast: 0,
          store: 0,
          total: 0,
          sortKey: key
        });
      }
      return map.get(key)!;
    };

    rangeBookings.forEach(b => {
      const checkIn = toDate(b.checkIn);
      if (!checkIn) return;
      const slot = ensureMonth(checkIn);
      slot.room += b.totalPrice || 0;
      if (b.hasBreakfast) {
        slot.breakfast += (b.breakfastRate || 0) * (b.numGuests || 0) * (b.numNights || 0);
      }
    });

    deliveredStoreOrders.forEach(o => {
      const created = toDate(o.createdAt);
      if (!created) return;
      const slot = ensureMonth(created);
      slot.store += o.totalAmount || 0;
    });

    return Array.from(map.values())
      .map(s => ({ ...s, total: s.room + s.breakfast + s.store }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [rangeBookings, deliveredStoreOrders]);

  // ── Combined payment method breakdown (bookings + store orders) ──
  const combinedPaymentMethods = useMemo(() => {
    const counts: Record<string, { method: string; count: number; total: number }> = {};

    rangeBookings.forEach(b => {
      const method = b.paymentMethod || "unknown";
      if (!counts[method]) counts[method] = { method, count: 0, total: 0 };
      counts[method].count += 1;
      counts[method].total += b.totalPrice || 0;
    });

    deliveredStoreOrders.forEach(o => {
      const method = o.paymentMethod || "unknown";
      if (!counts[method]) counts[method] = { method, count: 0, total: 0 };
      counts[method].count += 1;
      counts[method].total += o.totalAmount || 0;
    });

    return Object.values(counts)
      .map(c => ({
        name: PAYMENT_LABELS[c.method] || c.method,
        method: c.method,
        count: c.count,
        total: c.total,
        isUncollected: c.method === "add-to-bill"
      }))
      .sort((a, b) => b.count - a.count);
  }, [rangeBookings, deliveredStoreOrders]);

  // ── Acquisition / booking sources (Performance) ──
  const bookingSources = useMemo(() => {
    const labelMap: Record<string, string> = {
      online: "Online Booking",
      "walk-in": "Walk-in Desk",
      corporate: "Corporate Codes",
      phone: "Social Media / Phone",
      facebook: "Social Media / Phone"
    };
    const sources = ["online", "walk-in", "corporate", "phone", "facebook"];
    const counts: Record<string, number> = {};
    sources.forEach(s => { counts[s] = 0; });
    rangeBookings.forEach(b => {
      if (counts[b.source] !== undefined) counts[b.source] += 1;
    });
    return sources
      .map((s, i) => ({ name: labelMap[s], count: counts[s], color: chartColors[i % chartColors.length] }))
      .filter(s => s.count > 0);
  }, [rangeBookings, chartColors]);

  // ── Occupancy by room type (Performance) ──
  const roomTypeOccupancy = useMemo(() =>
    roomTypes.map(rt => {
      const totalRoomsOfType = rooms.filter(r => r.type === rt.value).length;
      const occupiedOfType = rooms.filter(r => r.type === rt.value && r.status === "occupied").length;
      const ratio = totalRoomsOfType > 0 ? Math.round((occupiedOfType / totalRoomsOfType) * 100) : 0;
      return { name: rt.label, occupied: occupiedOfType, total: totalRoomsOfType, occupancyRate: ratio };
    }),
    [roomTypes, rooms]
  );

  // ── Store: top-selling items ──
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
    return Array.from(itemMap.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  }, [deliveredStoreOrders]);

  const storeOrdersByStatus = useMemo(() =>
    Object.entries(
      rangeStoreOrders.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    ).map(([status, count]) => ({ name: STORE_STATUS_LABELS[status] || status, count })),
    [rangeStoreOrders]
  );

  const lowStockItems = useMemo(() =>
    storeItems
      .filter(item => item.stock !== null && item.stock <= 5)
      .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0)),
    [storeItems]
  );

  // ── Breakfast kitchen prep (existing) ──
  const breakfastBookings = useMemo(() =>
    revenueBookings.filter(b => b.hasBreakfast),
    [revenueBookings]
  );

  const dailyKitchenPrep = useMemo(() => {
    const dateMap: Record<string, Record<string, number>> = {};
    for (const b of breakfastBookings) {
      for (let i = 0; i < b.numNights; i++) {
        const date = toDate(b.checkIn);
        if (!date) continue;
        const dateCursor = new Date(date);
        dateCursor.setDate(dateCursor.getDate() + i);
        const dateStr = dateCursor.toISOString().split("T")[0];
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
    const sortedDates = Object.keys(dateMap).sort();
    const allItems = new Set<string>();
    for (const date of sortedDates) {
      Object.keys(dateMap[date]).forEach(item => allItems.add(item));
    }
    return { dates: sortedDates, items: Array.from(allItems), counts: dateMap };
  }, [breakfastBookings]);

  // ── Search filtering for sales sub-tables ──
  const matchesSearch = (value: string) =>
    searchTerm.trim().length === 0 || value.toLowerCase().includes(searchTerm.trim().toLowerCase());

  const filteredBookings = useMemo(() =>
    rangeBookings.filter(b =>
      matchesSearch(b.bookingRef || "") || matchesSearch(b.guestName || "")
    ),
    [rangeBookings, searchTerm]
  );

  const filteredBreakfastBookings = useMemo(() =>
    breakfastBookingsInRange.filter(b =>
      matchesSearch(b.bookingRef || "") || matchesSearch(b.guestName || "")
    ),
    [breakfastBookingsInRange, searchTerm]
  );

  const filteredStoreOrders = useMemo(() =>
    rangeStoreOrders.filter(o =>
      matchesSearch(o.orderRef || "") || matchesSearch(o.guestName || "") || matchesSearch(o.roomNumber || "")
    ),
    [rangeStoreOrders, searchTerm]
  );

  // ── CSV Export (Performance-style ledger) ──
  const handleExportCSV = () => {
    let csvContent = "Booking Reference,Guest Name,Room Number,Check In,Check Out,Nights,Total Price,Status,Source\n";
    filteredBookings.forEach(b => {
      const checkIn = toDate(b.checkIn);
      const checkOut = toDate(b.checkOut);
      csvContent += `"${b.bookingRef}","${b.guestName}","${b.roomNumber}",${checkIn ? checkIn.toISOString().slice(0, 10) : ""},${checkOut ? checkOut.toISOString().slice(0, 10) : ""},${b.numNights},${b.totalPrice},"${b.status}","${b.source}"\n`;
    });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, `sparkinn_bookings_${periodStart.toISOString().slice(0, 10)}_to_${periodEnd.toISOString().slice(0, 10)}.csv`);
  };

  // ── Full Backup (admin only — per W3.4) ──
  // One XLSX with 4 sheets: Bookings, Store Orders, Breakfast (line items
  // from storeOrders with isBreakfast), Members (skipped — members live
  // in a separate collection the Reports page does not load).
  const handleExportFullBackup = () => {
    if (currentUser?.role !== "admin") return;
    const wb = XLSX.utils.book_new();

    const bookingRows = bookings.map((b: any) => ({
      bookingRef: b.bookingRef,
      guestName: b.guestName,
      guestEmail: b.guestEmail,
      roomNumber: b.roomNumber,
      checkIn: typeof b.checkIn === "string" ? b.checkIn : b.checkIn?.toString?.() || "",
      checkOut: typeof b.checkOut === "string" ? b.checkOut : b.checkOut?.toString?.() || "",
      numNights: b.numNights,
      totalPrice: b.totalPrice,
      status: b.status,
      source: b.source,
      paymentMethod: b.paymentMethod
    }));
    const bookingSheet = XLSX.utils.json_to_sheet(bookingRows);
    XLSX.utils.book_append_sheet(wb, bookingSheet, "Bookings");

    const orderRows = storeOrders.map((o: any) => ({
      orderRef: o.orderRef,
      roomNumber: o.roomNumber,
      status: o.status,
      paymentMethod: o.paymentMethod,
      totalAmount: o.totalAmount,
      createdAt: typeof o.createdAt === "string" ? o.createdAt : ""
    }));
    const orderSheet = XLSX.utils.json_to_sheet(orderRows);
    XLSX.utils.book_append_sheet(wb, orderSheet, "StoreOrders");

    const wb_out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wb_out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    triggerDownload(blob, `sparkinn_full_backup_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  // ── XLSX Export (Sales: 4 sheets) ──
  const handleExportSalesXLSX = () => {
    const dateRangeLabel = `${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`;

    const summaryRows = [
      ["Date Range", dateRangeLabel],
      ["Total Revenue", totalRevenue],
      ["Room Revenue", roomRevenue],
      ["Breakfast Revenue", breakfastRevenue],
      ["Store Revenue", storeRevenue],
      ["Total Bookings", rangeBookings.length],
      ["Total Store Orders (delivered)", deliveredStoreOrders.length],
      ["Total Transactions", totalTransactions],
      [],
      ["Payment Method", "Count", "Total (₱)"],
      ...combinedPaymentMethods.map(m => [m.name, m.count, m.total])
    ];

    const bookingsHeaders = [
      "Booking Ref", "Guest Name", "Room Number", "Check-In", "Check-Out", "Nights",
      "Guests", "Room Rate", "Total Price", "Payment Method", "Source", "Status"
    ];
    const bookingsRows = filteredBookings.map(b => [
      b.bookingRef, b.guestName, b.roomNumber,
      toDate(b.checkIn)?.toISOString().slice(0, 10) || "",
      toDate(b.checkOut)?.toISOString().slice(0, 10) || "",
      b.numNights, b.numGuests, b.ratePerNight, b.totalPrice,
      PAYMENT_LABELS[b.paymentMethod] || b.paymentMethod,
      b.source, b.status
    ]);

    const breakfastHeaders = [
      "Booking Ref", "Guest Name", "Room Number", "Check-In", "Nights", "Guests",
      "Breakfast Rate/person", "Total Breakfast Revenue"
    ];
    const breakfastRows = filteredBreakfastBookings.map(b => [
      b.bookingRef, b.guestName, b.roomNumber,
      toDate(b.checkIn)?.toISOString().slice(0, 10) || "",
      b.numNights, b.numGuests, b.breakfastRate,
      (b.breakfastRate || 0) * (b.numGuests || 0) * (b.numNights || 0)
    ]);

    const storeHeaders = [
      "Order Ref", "Room Number", "Booking ID", "Guest Name", "Items",
      "Total Amount", "Payment Method", "Status", "Date"
    ];
    const storeRows = filteredStoreOrders.map(o => [
      o.orderRef, o.roomNumber, o.bookingId || "",
      o.guestName, o.items.map(i => `${i.quantity}x ${i.name}`).join("; "),
      o.totalAmount, PAYMENT_LABELS[o.paymentMethod] || o.paymentMethod,
      o.status, toDate(o.createdAt)?.toISOString().slice(0, 10) || ""
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...summaryRows]), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([bookingsHeaders, ...bookingsRows]), "Bookings");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([breakfastHeaders, ...breakfastRows]), "Breakfast");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([storeHeaders, ...storeRows]), "Store Orders");

    XLSX.writeFile(wb, `spark-inn-sales-${periodStart.toISOString().slice(0, 10)}.xlsx`);
  };

  const totalBookingsInRange = rangeBookings.length;
  const avgNights = totalBookingsInRange > 0
    ? Math.round((rangeBookings.reduce((sum, b) => sum + b.numNights, 0) / totalBookingsInRange) * 10) / 10
    : 0;

  // Per W3.5: Avg. Occupancy + Busiest Room Type (replaces Avg. Length of Stay).
  const totalRoomNights = rangeBookings.reduce((sum, b) => sum + b.numNights, 0);
  const daysInRange = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / 86_400_000));
  const totalActiveRooms = rooms.filter(r => r.isActive).length;
  const possibleRoomNights = totalActiveRooms * daysInRange;
  const avgOccupancyPct = possibleRoomNights > 0
    ? Math.round((totalRoomNights / possibleRoomNights) * 100)
    : 0;

  const typeCounts = new Map<string, number>();
  rangeBookings.forEach((b: any) => {
    if (!b.roomType) return;
    typeCounts.set(b.roomType, (typeCounts.get(b.roomType) || 0) + 1);
  });
  let busiestRoomType = "—";
  let busiestCount = 0;
  for (const [type, count] of typeCounts.entries()) {
    if (count > busiestCount) {
      busiestCount = count;
      busiestRoomType = roomTypes.find(t => t.value === type)?.label || type;
    }
  }

  return (
    <div className="space-y-8 font-body">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase">reports & metrics</h1>
          <p className="text-xs text-gray-500 mt-1">
            {activeTab === "performance"
              ? "Operational overview: occupancy, acquisition channels, and inventory."
              : "Consolidated revenue across rooms, breakfast add-ons, and Spark Essentials store orders."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="w-32">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
              aria-label="Date range"
            >
              <option value="7">Last 7 Days</option>
              <option value="30">Last 30 Days</option>
              <option value="90">Last Quarter</option>
            </select>
          </div>

          <button
            onClick={handleExportCSV}
            className="min-h-[44px] px-5 inline-flex items-center gap-1.5 rounded-lg border border-gray-250 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 shadow-sm transition active:scale-95"
          >
            <Download size={14} />
            Export CSV
          </button>

          {activeTab === "sales" && (
            <button
              onClick={handleExportSalesXLSX}
              className="min-h-[44px] px-5 inline-flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm transition active:scale-95"
            >
              <FileSpreadsheet size={14} />
              Export Sales XLSX
            </button>
          )}

          {currentUser?.role === "admin" && (
            <button
              onClick={handleExportFullBackup}
              className="min-h-[44px] px-5 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-800 shadow-sm transition active:scale-95"
              title="Download a full backup of every booking, store order, breakfast order, and member — admin only."
            >
              <FileSpreadsheet size={14} />
              Download Full Backup
            </button>
          )}
        </div>
      </header>

      {/* Tabs */}
      <div role="tablist" className="flex gap-1 rounded-lg bg-gray-100 p-1 max-w-sm">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "performance"}
          onClick={() => setActiveTab("performance")}
          className={`flex-1 min-h-[36px] rounded-md text-xs font-bold transition ${
            activeTab === "performance" ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-800"
          }`}
        >
          Performance
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "sales"}
          onClick={() => setActiveTab("sales")}
          className={`flex-1 min-h-[36px] rounded-md text-xs font-bold transition ${
            activeTab === "sales" ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-800"
          }`}
        >
          Sales
        </button>
      </div>

      {activeTab === "performance" && (
        <PerformanceTab
          totalBookings={totalBookingsInRange}
          totalRevenue={totalRevenue}
          avgNights={avgNights}
          monthlyRevenue={monthlyRevenue}
          roomTypeOccupancy={roomTypeOccupancy}
          bookingSources={bookingSources}
          totalActiveRooms={rooms.filter(r => r.isActive).length}
          avgOccupancyPct={avgOccupancyPct}
          totalRoomNights={totalRoomNights}
          daysInRange={daysInRange}
          busiestRoomType={busiestRoomType}
          busiestCount={busiestCount}
        />
      )}

      {activeTab === "sales" && (
        <SalesTab
          totalRevenue={totalRevenue}
          roomRevenue={roomRevenue}
          breakfastRevenue={breakfastRevenue}
          storeRevenue={storeRevenue}
          totalTransactions={totalTransactions}
          monthlyRevenue={monthlyRevenue}
          combinedPaymentMethods={combinedPaymentMethods}
          topStoreItems={topStoreItems}
          storeOrdersByStatus={storeOrdersByStatus}
          lowStockItems={lowStockItems}
          deliveredStoreOrders={deliveredStoreOrders}
          rangeStoreOrders={rangeStoreOrders}
          breakfastConfig={breakfastConfig}
          dailyKitchenPrep={dailyKitchenPrep}
          salesSubTab={salesSubTab}
          setSalesSubTab={setSalesSubTab}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          filteredBookings={filteredBookings}
          filteredBreakfastBookings={filteredBreakfastBookings}
          filteredStoreOrders={filteredStoreOrders}
          breakfastBookingsInRange={breakfastBookingsInRange}
          toDate={toDate}
          chartColors={chartColors}
          isMobile={isMobile}
        />
      )}
    </div>
  );
}

// ───────────────────── Performance Tab ─────────────────────

function PerformanceTab({
  totalBookings, totalRevenue, avgNights, monthlyRevenue, roomTypeOccupancy, bookingSources, totalActiveRooms, avgOccupancyPct, totalRoomNights, daysInRange, busiestRoomType, busiestCount
}: {
  totalBookings: number;
  totalRevenue: number;
  avgNights: number;
  monthlyRevenue: Array<{ month: string; room: number; breakfast: number; store: number; total: number }>;
  roomTypeOccupancy: Array<{ name: string; occupied: number; total: number; occupancyRate: number }>;
  bookingSources: Array<{ name: string; count: number; color: string }>;
  totalActiveRooms: number;
  avgOccupancyPct: number;
  totalRoomNights: number;
  daysInRange: number;
  busiestRoomType: string;
  busiestCount: number;
}) {
  const trendData = monthlyRevenue.length > 0
    ? monthlyRevenue
    : [];

  return (
    <div className="space-y-8">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Revenue</span>
            <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{formatPrice(totalRevenue)}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">All streams in period</span>
          </div>
          <div className="h-12 w-12 rounded-full bg-orange-50 text-primary flex items-center justify-center">
            <DollarSign size={20} />
          </div>
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Bookings</span>
            <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{totalBookings}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Confirmed, checked-in, checked-out</span>
          </div>
          <div className="h-12 w-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
            <Users size={20} />
          </div>
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Avg. Occupancy</span>
            <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{avgOccupancyPct}%</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
              {totalRoomNights} room-nights / {totalActiveRooms} rooms × {daysInRange} days
            </span>
          </div>
          <div className="h-12 w-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Home size={20} />
          </div>
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Busiest Room Type</span>
            <p className="font-heading text-3xl text-gray-950 mt-1.5 leading-none">{busiestRoomType}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
              {busiestCount} bookings in this range
            </span>
          </div>
          <div className="h-12 w-12 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center">
            <TrendingUp size={20} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Revenue Trend</h2>
            <p className="text-[10px] text-gray-500">Combined monthly revenue across all streams.</p>
          </div>
          {trendData.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-xs text-gray-400">
              No revenue in the selected range.
            </div>
          ) : (
            <div className="h-72 w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#EA8A1A" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#EA8A1A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                    formatter={(value: any) => [formatPrice(Number(value)), "Revenue"]}
                  />
                  <Area type="monotone" dataKey="total" stroke="#EA8A1A" strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Occupancy by Room Type</h2>
            <p className="text-[10px] text-gray-500">Currently occupied rooms / total active rooms of each type.</p>
          </div>
          {roomTypeOccupancy.length === 0 || roomTypeOccupancy.every(r => r.total === 0) ? (
            <div className="h-72 flex items-center justify-center text-xs text-gray-400">
              No room inventory configured yet.
            </div>
          ) : (
            <div className="h-72 w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roomTypeOccupancy} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                    formatter={(value: any, _name: any, props: any) => [
                      `${value}% (${props.payload.occupied}/${props.payload.total})`,
                      "Occupancy"
                    ]}
                  />
                  <Bar dataKey="occupancyRate" fill="#3B82F6" radius={[4, 4, 0, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 md:col-span-2 space-y-4">
          <h3 className="text-sm font-heading text-gray-950 lowercase flex items-center gap-1.5">
            <TrendingUp size={16} className="text-primary" />
            Acquisition Channels
          </h3>

          {bookingSources.length === 0 ? (
            <p className="text-xs text-gray-400 py-6">No bookings in the selected range.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {bookingSources.map((source, index) => (
                <div key={index} className="rounded-lg border border-gray-150 p-4 space-y-2 bg-gray-50/50">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">{source.name}</span>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: source.color }} />
                  </div>
                  <p className="text-2xl font-heading text-gray-950 leading-none">{source.count}</p>
                  <p className="text-[9px] text-gray-500 font-semibold">
                    {totalBookings > 0 ? Math.round((source.count / totalBookings) * 100) : 0}% of bookings
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4 flex flex-col justify-between">
          <div className="space-y-2">
            <h3 className="text-sm font-heading text-gray-950 lowercase flex items-center gap-1.5">
              <BarChart3 size={16} className="text-primary" />
              Operational Targets
            </h3>
            <p className="text-[10px] text-gray-500 leading-relaxed font-semibold">
              The operational target is set to maintain a 75% average occupancy across the year. Spark members make up 40% of standard acquisition streams.
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 border border-gray-150 p-3 text-[10px] text-gray-650 space-y-1.5">
            <p className="font-bold">Summary Insights:</p>
            <p>• Average occupancy: {avgOccupancyPct}% ({totalRoomNights} room-nights)</p>
            <p>• Busiest room type: {busiestRoomType} ({busiestCount} bookings)</p>
            <p>• Most-booked source: {bookingSources[0]?.name || "—"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────── Sales Tab ─────────────────────

function SalesTab(props: {
  totalRevenue: number;
  roomRevenue: number;
  breakfastRevenue: number;
  storeRevenue: number;
  totalTransactions: number;
  monthlyRevenue: Array<{ month: string; room: number; breakfast: number; store: number; total: number }>;
  combinedPaymentMethods: Array<{ name: string; method: string; count: number; total: number; isUncollected: boolean }>;
  topStoreItems: Array<{ name: string; quantity: number; revenue: number }>;
  storeOrdersByStatus: Array<{ name: string; count: number }>;
  lowStockItems: Array<{ id: string; name: string; category: string; stock: number | null }>;
  deliveredStoreOrders: Array<any>;
  rangeStoreOrders: Array<any>;
  breakfastConfig: any;
  dailyKitchenPrep: { dates: string[]; items: string[]; counts: Record<string, Record<string, number>> };
  salesSubTab: SalesSubTab;
  setSalesSubTab: (s: SalesSubTab) => void;
  searchTerm: string;
  setSearchTerm: (s: string) => void;
  filteredBookings: Array<any>;
  filteredBreakfastBookings: Array<any>;
  filteredStoreOrders: Array<any>;
  breakfastBookingsInRange: Array<any>;
  toDate: (v: any) => Date | null;
  chartColors: string[];
  isMobile: boolean;
}) {
  const {
    totalRevenue, roomRevenue, breakfastRevenue, storeRevenue, totalTransactions,
    monthlyRevenue, combinedPaymentMethods, topStoreItems, storeOrdersByStatus, lowStockItems,
    deliveredStoreOrders, breakfastConfig, dailyKitchenPrep,
    salesSubTab, setSalesSubTab, searchTerm, setSearchTerm,
    filteredBookings, filteredBreakfastBookings, filteredStoreOrders, breakfastBookingsInRange,
    toDate, chartColors, isMobile
  } = props;

  const breakfastEnabled = breakfastConfig?.isEnabled;
  const hasStoreData = deliveredStoreOrders.length > 0;
  const hasBookings = filteredBookings.length > 0;
  const hasBreakfastData = filteredBreakfastBookings.length > 0;
  const hasStoreOrders = filteredStoreOrders.length > 0;

  return (
    <div className="space-y-8">
      {/* Summary KPI Cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Revenue</span>
          <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(totalRevenue)}</p>
          <span className="text-[10px] text-gray-500 font-semibold mt-2 block">All streams combined</span>
        </div>
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Room Revenue</span>
          <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(roomRevenue)}</p>
          <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Net of discounts</span>
        </div>
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Breakfast Revenue</span>
          <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(breakfastRevenue)}</p>
          <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
            {breakfastEnabled ? `${breakfastBookingsInRange.length} breakfast bookings` : "Service disabled"}
          </span>
        </div>
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Store Revenue</span>
          <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(storeRevenue)}</p>
          <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Delivered orders only</span>
        </div>
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Transactions</span>
          <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{totalTransactions}</p>
          <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Bookings + store orders</span>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Revenue by Stream</h2>
            <p className="text-[10px] text-gray-500">Monthly contribution of Room, Breakfast, and Store revenue.</p>
          </div>
          {monthlyRevenue.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-xs text-gray-400">
              No revenue transactions in this period.
            </div>
          ) : (
            <div className="h-72 w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyRevenue} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                    formatter={(value: any) => formatPrice(Number(value))}
                  />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                  <Bar dataKey="room" stackId="revenue" name="Room" fill="#EA8A1A" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="breakfast" stackId="revenue" name="Breakfast" fill="#3B82F6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="store" stackId="revenue" name="Store" fill="#10B981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Revenue Trend</h2>
            <p className="text-[10px] text-gray-500">Total combined revenue per month across all streams.</p>
          </div>
          {monthlyRevenue.length === 0 ? (
            <div className="h-72 flex items-center justify-center text-xs text-gray-400">
              No revenue transactions in this period.
            </div>
          ) : (
            <div className="h-72 w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={monthlyRevenue} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                    formatter={(value: any) => formatPrice(Number(value))}
                  />
                  <Line type="monotone" dataKey="total" stroke="#EA8A1A" strokeWidth={3} dot={{ r: 5, fill: "#EA8A1A" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Store-specific + payment breakdown */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 lg:col-span-2 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Top-Selling Store Items</h2>
            <p className="text-[10px] text-gray-500">Delivered order revenue by item for the selected period.</p>
          </div>
          {topStoreItems.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <ShoppingBag size={32} className="mx-auto mb-3 opacity-40" />
              <p className="text-xs font-semibold">No delivered store orders in this range.</p>
            </div>
          ) : (
            <div className="h-72 w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topStoreItems} layout="vertical" margin={{ top: 10, right: 20, left: 18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: "#6b7280" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                    formatter={(value: any, name: string) => name === "revenue" ? [formatPrice(Number(value)), "Revenue"] : [value, "Quantity"]}
                  />
                  <Bar dataKey="revenue" fill={config.colors.primary} radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Payment Methods</h2>
            <p className="text-[10px] text-gray-500">Combined across bookings + delivered store orders.</p>
          </div>
          {combinedPaymentMethods.length === 0 ? (
            <p className="text-xs text-gray-400 py-6">No payment data yet.</p>
          ) : (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={combinedPaymentMethods} dataKey="count" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={4}>
                      {combinedPaymentMethods.map((entry, index) => (
                        <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                      formatter={(value: any, _name: any, props: any) => [
                        `${value} txns (${formatPrice(props.payload.total)})`,
                        props.payload.name
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5">
                {combinedPaymentMethods.map((method, i) => (
                  <li key={method.method} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: chartColors[i % chartColors.length] }} />
                      <span className="font-semibold text-gray-700">{method.name}</span>
                      {method.isUncollected && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">
                          Uncollected
                        </span>
                      )}
                    </span>
                    <span className="text-gray-500 font-mono">{method.count}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* Sales detail sub-tabs */}
      <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Sales Detail</h2>
            <p className="text-[10px] text-gray-500">Per-booking and per-order breakdown for the selected period.</p>
          </div>
          <input
            type="search"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by ref or name…"
            className="min-h-[36px] w-full sm:w-64 rounded-lg border border-gray-200 bg-white px-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
            aria-label="Search sales detail"
          />
        </div>

        <div role="tablist" className="grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 max-w-md">
          {(["bookings", "breakfast", "store"] as const).map(tab => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={salesSubTab === tab}
              onClick={() => setSalesSubTab(tab)}
              className={`min-h-[36px] rounded-md text-[10px] font-bold uppercase tracking-wider transition ${
                salesSubTab === tab ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-800"
              }`}
            >
              {tab === "bookings" ? "Bookings" : tab === "breakfast" ? "Breakfast" : "Store Orders"}
            </button>
          ))}
        </div>

        {salesSubTab === "bookings" && (
          <SalesBookingsTable bookings={filteredBookings} toDate={toDate} isMobile={isMobile} />
        )}

        {salesSubTab === "breakfast" && (
          <SalesBreakfastTable bookings={filteredBreakfastBookings} toDate={toDate} isMobile={isMobile} />
        )}

        {salesSubTab === "store" && (
          <SalesStoreOrdersTable orders={filteredStoreOrders} toDate={toDate} isMobile={isMobile} />
        )}
      </div>

      {/* Operational panels: kitchen prep, store ops */}
      {breakfastEnabled && (
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
          ) : isMobile ? (
            <div className="space-y-3">
              {dailyKitchenPrep.dates.map(date => {
                const dayCounts = dailyKitchenPrep.counts[date] || {};
                const dayTotal = Object.values(dayCounts).reduce((s: number, c: number) => s + c, 0);
                return (
                  <div key={date} className="rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-gray-800">
                        {new Date(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </p>
                      <span className="rounded-full bg-primary-light px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-primary-dark">
                        Total {dayTotal}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {dailyKitchenPrep.items.map(item => (
                        <li key={item} className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-600">{item}</span>
                          <span className="font-mono text-gray-800">{dayCounts[item] || "—"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs border-collapse">
                <thead>
                  <tr className="border-b-2 border-primary/20 text-left">
                    <th className="py-2.5 pr-4 text-[10px] font-bold uppercase tracking-wider text-gray-400">Date</th>
                    {dailyKitchenPrep.items.map(item => (
                      <th key={item} className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 text-center">{item}</th>
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
                          <td key={item} className="px-3 py-2.5 text-center text-gray-600 font-mono">{dayCounts[item] || "—"}</td>
                        ))}
                        <td className="px-3 py-2.5 text-center font-bold text-primary font-mono">{dayTotal}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {hasStoreData && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
            <div>
              <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Orders by Status</h2>
              <p className="text-[10px] text-gray-500">Operational count of placed, active, delivered, and cancelled orders.</p>
            </div>
            {storeOrdersByStatus.length === 0 ? (
              <p className="text-xs text-gray-400 py-8 text-center">No store orders in this range.</p>
            ) : (
              <div className="h-64 w-full pt-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={storeOrdersByStatus} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{ background: "#111827", border: "0", borderRadius: "8px", color: "#fff", fontSize: "11px" }}
                      formatter={(value: any) => [value, "Orders"]}
                    />
                    <Bar dataKey="count" fill={config.colors.primary} radius={[4, 4, 0, 0]} barSize={24} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
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
      )}
    </div>
  );
}

// ───────────────────── Sales Sub-tables ─────────────────────

function SalesBookingsTable({ bookings, toDate, isMobile }: { bookings: any[]; toDate: (v: any) => Date | null; isMobile?: boolean }) {
  if (bookings.length === 0) {
    return <p className="text-xs text-gray-400 py-8 text-center">No bookings in this range.</p>;
  }
  if (isMobile) {
    return (
      <div className="space-y-3">
        {bookings.slice(0, 50).map(b => (
          <div key={b.id} className="rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Ref</span>
              <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700 capitalize">
                {b.status.replace(/-/g, " ")}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-900">{b.bookingRef}</p>
            <p className="mt-0.5 text-sm text-gray-700">{b.guestName}</p>
            <div className="mt-2 flex items-center justify-between text-[11px] text-gray-600">
              <span>Room {b.roomNumber} · {b.numNights} nt</span>
              <span>{toDate(b.checkIn)?.toISOString().slice(0, 10) || "—"}</span>
            </div>
            <p className="mt-2 text-right text-sm font-bold text-primary-dark">{formatPrice(b.totalPrice)}</p>
          </div>
        ))}
        {bookings.length > 50 && (
          <p className="text-[10px] text-gray-500 text-center">Showing 50 of {bookings.length} — export XLSX for the full set.</p>
        )}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-primary/20 text-left">
            <th className="py-2.5 pr-4 text-[10px] font-bold uppercase tracking-wider text-gray-400">Booking Ref</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Guest</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Room</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Check-In</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Nights</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 text-right">Total</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {bookings.slice(0, 50).map(b => (
            <tr key={b.id} className="hover:bg-gray-50/50">
              <td className="py-2.5 pr-4 font-semibold text-gray-900">{b.bookingRef}</td>
              <td className="px-3 py-2.5 text-gray-700">{b.guestName}</td>
              <td className="px-3 py-2.5 text-gray-600">{b.roomNumber}</td>
              <td className="px-3 py-2.5 text-gray-600">{toDate(b.checkIn)?.toISOString().slice(0, 10) || "—"}</td>
              <td className="px-3 py-2.5 text-gray-600 font-mono">{b.numNights}</td>
              <td className="px-3 py-2.5 text-right font-bold text-primary-dark">{formatPrice(b.totalPrice)}</td>
              <td className="px-3 py-2.5">
                <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700 capitalize">
                  {b.status.replace(/-/g, " ")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {bookings.length > 50 && (
        <p className="text-[10px] text-gray-500 text-center mt-2">Showing 50 of {bookings.length} — export XLSX for the full set.</p>
      )}
    </div>
  );
}

function SalesBreakfastTable({ bookings, toDate, isMobile }: { bookings: any[]; toDate: (v: any) => Date | null; isMobile?: boolean }) {
  if (bookings.length === 0) {
    return <p className="text-xs text-gray-400 py-8 text-center">No breakfast bookings in this range.</p>;
  }
  if (isMobile) {
    return (
      <div className="space-y-3">
        {bookings.slice(0, 50).map(b => {
          const total = (b.breakfastRate || 0) * (b.numGuests || 0) * (b.numNights || 0);
          return (
            <div key={b.id} className="rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Ref</span>
                <span className="text-[10px] text-gray-500">{toDate(b.checkIn)?.toISOString().slice(0, 10) || "—"}</span>
              </div>
              <p className="mt-1 text-sm font-semibold text-gray-900">{b.bookingRef}</p>
              <p className="mt-0.5 text-sm text-gray-700">{b.guestName} · Room {b.roomNumber}</p>
              <div className="mt-2 flex items-center justify-between text-[11px] text-gray-600">
                <span>{b.numNights} nt × {b.numGuests} guests</span>
                <span>Rate {formatPrice(b.breakfastRate)}</span>
              </div>
              <p className="mt-2 text-right text-sm font-bold text-primary-dark">{formatPrice(total)}</p>
            </div>
          );
        })}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-primary/20 text-left">
            <th className="py-2.5 pr-4 text-[10px] font-bold uppercase tracking-wider text-gray-400">Booking Ref</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Guest</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Room</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Check-In</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Nights</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Guests</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 text-right">Rate/person</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 text-right">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {bookings.slice(0, 50).map(b => {
            const total = (b.breakfastRate || 0) * (b.numGuests || 0) * (b.numNights || 0);
            return (
              <tr key={b.id} className="hover:bg-gray-50/50">
                <td className="py-2.5 pr-4 font-semibold text-gray-900">{b.bookingRef}</td>
                <td className="px-3 py-2.5 text-gray-700">{b.guestName}</td>
                <td className="px-3 py-2.5 text-gray-600">{b.roomNumber}</td>
                <td className="px-3 py-2.5 text-gray-600">{toDate(b.checkIn)?.toISOString().slice(0, 10) || "—"}</td>
                <td className="px-3 py-2.5 text-gray-600 font-mono">{b.numNights}</td>
                <td className="px-3 py-2.5 text-gray-600 font-mono">{b.numGuests}</td>
                <td className="px-3 py-2.5 text-right text-gray-700 font-mono">{formatPrice(b.breakfastRate)}</td>
                <td className="px-3 py-2.5 text-right font-bold text-primary-dark">{formatPrice(total)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SalesStoreOrdersTable({ orders, toDate, isMobile }: { orders: any[]; toDate: (v: any) => Date | null; isMobile?: boolean }) {
  if (orders.length === 0) {
    return <p className="text-xs text-gray-400 py-8 text-center">No store orders in this range.</p>;
  }
  if (isMobile) {
    return (
      <div className="space-y-3">
        {orders.slice(0, 50).map(o => (
          <div key={o.id} className="rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Order</span>
              <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700 capitalize">
                {STORE_STATUS_LABELS[o.status] || o.status}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-900">{o.orderRef}</p>
            <p className="mt-0.5 text-sm text-gray-700">Room {o.roomNumber}</p>
            <p className="mt-1 text-[11px] text-gray-600 line-clamp-2">
              {o.items.map((i: any) => `${i.quantity}x ${i.name}`).join(", ")}
            </p>
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-gray-600">
                {o.paymentMethod === "add-to-bill" && (
                  <span className="mr-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">Uncollected</span>
                )}
                {PAYMENT_LABELS[o.paymentMethod] || o.paymentMethod}
              </span>
              <span className="text-[11px] text-gray-500">{toDate(o.createdAt)?.toISOString().slice(0, 10) || "—"}</span>
            </div>
            <p className="mt-2 text-right text-sm font-bold text-primary-dark">{formatPrice(o.totalAmount)}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs border-collapse">
        <thead>
          <tr className="border-b-2 border-primary/20 text-left">
            <th className="py-2.5 pr-4 text-[10px] font-bold uppercase tracking-wider text-gray-400">Order Ref</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Room</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Items</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Payment</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Status</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 text-right">Total</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {orders.slice(0, 50).map(o => (
            <tr key={o.id} className="hover:bg-gray-50/50">
              <td className="py-2.5 pr-4 font-semibold text-gray-900">{o.orderRef}</td>
              <td className="px-3 py-2.5 text-gray-600">{o.roomNumber}</td>
              <td className="px-3 py-2.5 text-gray-600">{o.items.map((i: any) => `${i.quantity}x ${i.name}`).join(", ")}</td>
              <td className="px-3 py-2.5 text-gray-600">
                {o.paymentMethod === "add-to-bill" && (
                  <span className="mr-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">Uncollected</span>
                )}
                {PAYMENT_LABELS[o.paymentMethod] || o.paymentMethod}
              </td>
              <td className="px-3 py-2.5">
                <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700 capitalize">
                  {STORE_STATUS_LABELS[o.status] || o.status}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right font-bold text-primary-dark">{formatPrice(o.totalAmount)}</td>
              <td className="px-3 py-2.5 text-gray-600">{toDate(o.createdAt)?.toISOString().slice(0, 10) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
