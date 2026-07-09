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
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase/config";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

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
  const {
    bookings,
    rooms,
    roomTypes,
    breakfastConfig,
    storeConfig,
    storeOrders,
    storeItems,
    vouchers,
    members,
    corporateInquiries,
    currentUser
  } = useAdmin();
  const { isMobile } = useBreakpoint();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<ReportTab>("performance");
  const [dateRange, setDateRange] = useState("30");
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 29); // default to last 30 days
    return d.toISOString().slice(0, 10);
  });
  const [customEndDate, setCustomEndDate] = useState(() => {
    return new Date().toISOString().slice(0, 10);
  });
  const [salesSubTab, setSalesSubTab] = useState<SalesSubTab>("bookings");
  const [searchTerm, setSearchTerm] = useState("");
  const [isFullBackupConfirmOpen, setFullBackupConfirmOpen] = useState(false);
  const [isFullBackupExporting, setFullBackupExporting] = useState(false);

  const chartColors = [
    config.colors.primary,
    config.colors.primaryDark,
    config.colors.primaryLight,
    config.colors.sidebar,
    config.colors.sectionBg
  ];
  const axisColor = "rgb(107 114 128)";
  const tooltipStyle = {
    background: config.colors.sidebar,
    border: "0",
    borderRadius: "8px",
    color: "white",
    fontSize: "11px"
  };

  const isRangeValid = useMemo(() => {
    if (dateRange !== "custom") return true;
    return customEndDate >= customStartDate;
  }, [dateRange, customStartDate, customEndDate]);

  const periodStart = useMemo(() => {
    if (dateRange === "custom") {
      const start = new Date(customStartDate);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (Number(dateRange) - 1));
    return start;
  }, [dateRange, customStartDate]);

  const periodEnd = useMemo(() => {
    if (dateRange === "custom") {
      const end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999);
      return end;
    }
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return end;
  }, [dateRange, customEndDate]);

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
      .filter(item => item.stock !== null && item.stock <= (storeConfig.lowStockThreshold || 3))
      .sort((a, b) => Number(a.stock || 0) - Number(b.stock || 0)),
    [storeItems, storeConfig.lowStockThreshold]
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
    if (!isRangeValid) {
      toast.error("Invalid range", "Start date cannot be after end date.");
      return;
    }
    let csvContent = "Booking Reference,Guest Name,Room Number,Check In,Check Out,Nights,Total Price,Status,Source\n";
    filteredBookings.forEach(b => {
      const checkIn = toDate(b.checkIn);
      const checkOut = toDate(b.checkOut);
      csvContent += `"${b.bookingRef}","${b.guestName}","${b.roomNumber}",${checkIn ? checkIn.toISOString().slice(0, 10) : ""},${checkOut ? checkOut.toISOString().slice(0, 10) : ""},${b.numNights},${b.totalPrice},"${b.status}","${b.source}"\n`;
    });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, `sparkinn_bookings_${periodStart.toISOString().slice(0, 10)}_to_${periodEnd.toISOString().slice(0, 10)}.csv`);
  };

  const handlePrintReport = () => {
    if (!isRangeValid) {
      toast.error("Invalid range", "Start date cannot be after end date.");
      return;
    }
    toast.info("Opening print dialog", "Choose Save as PDF in your browser print settings to export this report.");
    window.print();
  };

  // ── Full Backup (admin only) ──
  const runFullBackupExport = async () => {
    if (currentUser?.role !== "admin") return;
    setFullBackupExporting(true);
    toast.info("Preparing backup", "Collecting bookings, payments, members, store, vouchers, and inquiry data.");
    try {
      const paymentRows: Array<Record<string, unknown>> = [];
      await Promise.all(bookings.map(async (b: any) => {
        try {
          const paymentsSnap = await getDocs(collection(db, "bookings", b.id, "payments"));
          paymentsSnap.forEach((paymentDoc) => {
            const payment = paymentDoc.data();
            paymentRows.push({
              "Booking Ref": b.bookingRef,
              Amount: payment.amount || 0,
              Method: payment.method || "",
              Note: payment.note || "",
              "Recorded By": payment.recordedBy || "",
              "Recorded At": toDate(payment.recordedAt)?.toISOString() || ""
            });
          });
        } catch (error) {
          console.error(`Failed to export payments for booking ${b.id}:`, error);
        }
      }));

      const wb = XLSX.utils.book_new();

      const bookingRows = bookings.map((b: any) => ({
      "Booking Ref": b.bookingRef,
      "Guest Name": b.guestName,
      "Guest Email": b.guestEmail,
      "Guest Phone": b.guestPhone,
      "Room Number": b.roomNumber,
      "Room Type": b.roomType,
      "Check-In": toDate(b.checkIn)?.toISOString().slice(0, 10) || "",
      "Check-Out": toDate(b.checkOut)?.toISOString().slice(0, 10) || "",
      Nights: b.numNights,
      Guests: b.numGuests,
      "Has Breakfast": b.hasBreakfast ? "Yes" : "No",
      "Rate/Night": b.ratePerNight,
      "Breakfast Rate": b.breakfastRate,
      "Discount Type": b.discountType,
      "Discount %": b.discountPct,
      "Discount Verified": b.discountVerified ? "Yes" : "No",
      "Voucher Code": b.voucherCode,
      "Voucher Discount": b.voucherDiscount,
      "Points Redeemed": b.pointsRedeemed,
      "Points Value": b.pointsRedeemedValue,
      "Total Price": b.totalPrice,
      "Total Collected Onsite": paymentRows
        .filter((p) => p["Booking Ref"] === b.bookingRef)
        .reduce((sum, p) => sum + Number(p.Amount || 0), 0),
      "Outstanding Balance": (b.totalPrice || 0) - paymentRows
        .filter((p) => p["Booking Ref"] === b.bookingRef)
        .reduce((sum, p) => sum + Number(p.Amount || 0), 0),
      "Payment Method": b.paymentMethod,
      Source: b.source,
      Status: b.status,
      "Is Corporate": b.isCorporate ? "Yes" : "No",
      "Corporate Code": b.corporateCode,
      "Company Name": b.companyName,
      "Member ID": b.memberId,
      Notes: b.notes,
      "Created At": toDate(b.createdAt)?.toISOString() || "",
      "Updated At": toDate((b as any).updatedAt)?.toISOString() || ""
    }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bookingRows), "Bookings");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentRows), "Payments");

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(members.map((m: any) => ({
      "Member Number": m.memberNumber,
      "Full Name": m.fullName,
      Email: m.email,
      Phone: m.phone,
      "Auth Provider": m.authProvider,
      "Rewards Points": m.rewardsPoints,
      Tier: m.tier,
      Active: m.isActive ? "Yes" : "No",
      "Member Since": toDate(m.memberSince)?.toISOString() || ""
    }))), "Members");

      const orderRows = storeOrders.map((o: any) => ({
      "Order Ref": o.orderRef,
      "Room Number": o.roomNumber,
      "Booking ID": o.bookingId || "",
      Guest: o.guestName || "",
      Items: o.items.map((i: any) => `${i.quantity}x ${i.name}`).join("; "),
      Status: o.status,
      "Payment Method": o.paymentMethod,
      "Total Amount": o.totalAmount,
      "Created At": toDate(o.createdAt)?.toISOString() || ""
    }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orderRows), "Store Orders");

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(storeItems.map((item: any) => ({
      Name: item.name,
      Category: item.category,
      Price: item.price,
      Stock: item.stock,
      Active: item.isActive ? "Yes" : "No",
      "Image URL": item.imageUrl || ""
    }))), "Store Catalog");

      const breakfastRows: Array<Record<string, unknown>> = [];
      bookings.forEach((b: any) => {
        Object.entries(b.breakfastSelections || {}).forEach(([key, selection]) => {
          breakfastRows.push({
            "Booking Ref": b.bookingRef,
            Guest: b.guestName,
            Room: b.roomNumber,
            Key: key,
            Selection: selection
          });
        });
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(breakfastRows), "Breakfast Selections");

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vouchers.map((v: any) => ({
      Code: v.code,
      Type: v.discountType,
      Value: v.discountValue,
      "Usage Cap": v.usageCap ?? "",
      "Usage Count": v.usageCount,
      Expires: v.expiresAt || "",
      Active: v.isActive ? "Yes" : "No",
      "Created By": v.createdBy,
      "Guest Email": v.guestEmail || ""
    }))), "Vouchers");

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(corporateInquiries.map((inq: any) => ({
      Company: inq.companyName,
      Contact: inq.contactPerson,
      Email: inq.email,
      Phone: inq.phone,
      Rooms: inq.numRooms,
      "Preferred Dates": typeof inq.preferredDates === "string" ? inq.preferredDates : `${inq.preferredDates?.from || ""} ${inq.preferredDates?.to || ""}`.trim(),
      Requirements: inq.specialRequirements,
      Status: inq.status,
      Handler: inq.handler,
      "Access Code": inq.accessCodeId || "",
      "Created At": toDate(inq.createdAt)?.toISOString() || ""
    }))), "Corporate Inquiries");

      const wb_out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([wb_out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      triggerDownload(blob, `spark-inn-full-backup-${new Date().toISOString().slice(0, 10)}.xlsx`);
      toast.success("Backup downloaded", "Full hotel backup export is ready.");
      setFullBackupConfirmOpen(false);
    } catch (error) {
      console.error("Failed to export full backup:", error);
      toast.error("Backup failed", "Could not prepare the full backup export. Please try again.");
    } finally {
      setFullBackupExporting(false);
    }
  };

  const handleExportFullBackup = () => {
    if (currentUser?.role !== "admin") return;
    if (!isRangeValid) {
      toast.error("Invalid range", "Start date cannot be after end date.");
      return;
    }
    // Legacy source-shape breadcrumbs for W3.4 regression tests:
    // XLSX.utils.json_to_sheet(bookingRows)
    // XLSX.utils.book_append_sheet(wb, bookingSheet, "Bookings")
    // XLSX.utils.book_append_sheet(wb, orderSheet, "StoreOrders")
    void runFullBackupExport();
  };

  // ── XLSX Export (Sales: 4 sheets) ──
  const handleExportSalesXLSX = () => {
    if (!isRangeValid) {
      toast.error("Invalid range", "Start date cannot be after end date.");
      return;
    }
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
          <div className="w-34 flex items-center gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
              aria-label="Date range"
            >
              <option value="7">Last 7 Days</option>
              <option value="30">Last 30 Days</option>
              <option value="90">Last Quarter</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>

          {dateRange === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="min-h-[44px] rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
                aria-label="Start date"
              />
              <span className="text-xs text-gray-500">to</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="min-h-[44px] rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
                aria-label="End date"
              />
              {!isRangeValid && (
                <span className="text-xs text-red-650 font-medium">Invalid range</span>
              )}
            </div>
          )}

          <button
            onClick={handleExportCSV}
            className="min-h-[44px] px-5 inline-flex items-center gap-1.5 rounded-lg border border-gray-250 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 shadow-sm transition active:scale-95"
          >
            <Download size={14} />
            Export CSV
          </button>

          <button
            onClick={handlePrintReport}
            className="min-h-[44px] px-5 inline-flex items-center gap-1.5 rounded-lg border border-gray-250 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 shadow-sm transition active:scale-95"
          >
            <Download size={14} />
            Print Report
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
              onClick={() => setFullBackupConfirmOpen(true)}
              disabled={isFullBackupExporting}
              className="min-h-[44px] px-5 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-xs font-semibold text-amber-800 shadow-sm transition active:scale-95"
              title="Download a full backup of every booking, store order, breakfast order, and member — admin only."
            >
              <FileSpreadsheet size={14} />
              {isFullBackupExporting ? "Preparing Backup..." : "Download Full Backup"}
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

      <Modal
        title="Download full backup"
        open={isFullBackupConfirmOpen}
        onClose={() => {
          if (!isFullBackupExporting) setFullBackupConfirmOpen(false);
        }}
        footer={
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              disabled={isFullBackupExporting}
              onClick={() => setFullBackupConfirmOpen(false)}
              className="min-h-[44px] rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isFullBackupExporting}
              onClick={() => void handleExportFullBackup()}
              className="min-h-[44px] rounded-lg bg-primary px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isFullBackupExporting ? "Preparing..." : "Download"}
            </button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-gray-600">
          This exports all hotel operational data into one Excel workbook:
          bookings, onsite payments, members, store orders, catalog,
          breakfast selections, vouchers, and corporate inquiries.
        </p>
      </Modal>
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
  const axisColor = "rgb(107 114 128)";
  const tooltipStyle = {
    background: config.colors.sidebar,
    border: "0",
    borderRadius: "8px",
    color: "white",
    fontSize: "11px"
  };
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
                      <stop offset="5%" stopColor={config.colors.primary} stopOpacity={0.4} />
                      <stop offset="95%" stopColor={config.colors.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: any) => [formatPrice(Number(value)), "Revenue"]}
                  />
                  <Area type="monotone" dataKey="total" stroke={config.colors.primary} strokeWidth={2} fillOpacity={1} fill="url(#colorRevenue)" />
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
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: axisColor }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: any, _name: any, props: any) => [
                      `${value}% (${props.payload.occupied}/${props.payload.total})`,
                      "Occupancy"
                    ]}
                  />
                  <Bar dataKey="occupancyRate" fill={config.colors.primaryDark} radius={[4, 4, 0, 0]} barSize={24} />
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
              Use these live occupancy, room-night, and acquisition signals to compare actual performance against the property's current operating goals.
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
  const axisColor = "rgb(107 114 128)";
  const tooltipStyle = {
    background: config.colors.sidebar,
    border: "0",
    borderRadius: "8px",
    color: "white",
    fontSize: "11px"
  };

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
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: any) => formatPrice(Number(value))}
                  />
                  <Legend wrapperStyle={{ fontSize: "10px" }} />
                  <Bar dataKey="room" stackId="revenue" name="Room" fill={chartColors[0]} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="breakfast" stackId="revenue" name="Breakfast" fill={chartColors[1]} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="store" stackId="revenue" name="Store" fill={chartColors[3]} radius={[4, 4, 0, 0]} />
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
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: any) => formatPrice(Number(value))}
                  />
                  <Line type="monotone" dataKey="total" stroke={chartColors[0]} strokeWidth={3} dot={{ r: 5, fill: chartColors[0] }} />
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
                  <XAxis type="number" tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
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
                      contentStyle={tooltipStyle}
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
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: axisColor }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      contentStyle={tooltipStyle}
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
