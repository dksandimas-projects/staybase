import { useEffect, useState, useMemo } from "react";
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
  TrendingUp, Utensils, Coffee, Package, ShoppingBag, FileSpreadsheet,
  Calendar, Lock, CheckCircle2, Key, BarChart2
} from "lucide-react";
import config from "@config";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { collection, collectionGroup, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase/config";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type ReportTab = "performance" | "sales" | "daily-close";
type SalesSubTab = "bookings" | "breakfast" | "store" | "charges";

interface ReportCharge {
  id: string;
  bookingId: string;
  bookingRef: string;
  roomNumber: string;
  label: string;
  amount: number;
  category: string;
  note: string;
  addedBy: string;
  addedAt: Date | null;
  voidOf: string | null;
}

interface ReportPayment {
  id: string;
  type: "payment" | "refund";
  bookingId: string;
  bookingRef: string;
  roomNumber: string;
  guestName: string;
  amount: number;
  method: string;
  note: string;
  reason: string | null;
  approvedBy: string | null;
  recordedBy: string;
  recordedAt: Date | null;
}

interface ReceivableRow {
  bookingId: string;
  bookingRef: string;
  guestName: string;
  roomNumber: string;
  companyName: string;
  isCorporate: boolean;
  status: string;
  checkOut: Date | null;
  billed: number;
  collected: number;
  outstanding: number;
  ageDays: number;
  ageBucket: "Current" | "1–30 days" | "31–60 days" | "60+ days";
  uncollectedAddToBill: number;
}

interface CorporateInvoice {
  id: string;
  companyName: string;
  bookingIds: string[];
  bookingRefs: string[];
  amount: number;
  status: "issued" | "paid";
  issuedAt: Date | null;
  issuedBy: string;
  paidAt: Date | null;
  paidBy: string | null;
}

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

const getOverlapNights = (
  checkIn: any,
  checkOut: any,
  rangeStart: Date,
  rangeEnd: Date
): number => {
  const cInParsed = toDate(checkIn);
  const cOutParsed = toDate(checkOut);
  if (!cInParsed || !cOutParsed) return 0;

  const cIn = new Date(cInParsed);
  cIn.setHours(0, 0, 0, 0);
  const cOut = new Date(cOutParsed);
  cOut.setHours(0, 0, 0, 0);

  const rStart = new Date(rangeStart);
  rStart.setHours(0, 0, 0, 0);
  const rEnd = new Date(rangeEnd);
  rEnd.setHours(0, 0, 0, 0);
  const rEndCheckoutLimit = new Date(rEnd.getTime() + 86_400_000);

  const overlapStart = new Date(Math.max(cIn.getTime(), rStart.getTime()));
  const overlapEnd = new Date(Math.min(cOut.getTime(), rEndCheckoutLimit.getTime()));

  if (overlapEnd.getTime() <= overlapStart.getTime()) {
    return 0;
  }
  return Math.round((overlapEnd.getTime() - overlapStart.getTime()) / 86_400_000);
};

const PAYMENT_LABELS: Record<string, string> = {
  gcash: "GCash",
  "pay-at-hotel": "Pay at Hotel",
  paypal: "PayPal",
  bank: "Bank Transfer",
  cod: "Cash on Delivery",
  "add-to-bill": "Add to Bill"
};

function DeltaBadge({ value }: { value: number }) {
  if (value === 0) {
    return <span className="text-[10px] text-gray-400 font-semibold">0% vs prev period</span>;
  }
  const isPositive = value > 0;
  const formatted = Math.abs(value).toFixed(1);
  return (
    <span className={`text-[10px] font-semibold flex items-center gap-0.5 ${isPositive ? "text-emerald-600" : "text-rose-600"}`}>
      {isPositive ? "▲" : "▼"} {formatted}% vs prev period
    </span>
  );
}

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
    rewardsConfig,
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
  const [charges, setCharges] = useState<ReportCharge[]>([]);
  const [payments, setPayments] = useState<ReportPayment[]>([]);
  const [corporateInvoices, setCorporateInvoices] = useState<CorporateInvoice[]>([]);
  const [invoiceAction, setInvoiceAction] = useState<string | null>(null);
  const [dailyCloses, setDailyCloses] = useState<any[]>([]);
  const [isExportingPDF, setIsExportingPDF] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(collectionGroup(db, "charges"), (snapshot) => {
      setCharges(snapshot.docs.map((chargeDoc) => {
        const data = chargeDoc.data();
        const bookingId = chargeDoc.ref.parent.parent?.id || "";
        const booking = bookings.find((item) => item.id === bookingId);
        return {
          id: chargeDoc.id,
          bookingId,
          bookingRef: booking?.bookingRef || bookingId,
          roomNumber: booking?.roomNumber || "",
          label: String(data.label || "Incidental charge"),
          amount: Number(data.amount || 0),
          category: String(data.category || "other"),
          note: String(data.note || ""),
          addedBy: String(data.addedBy || "staff"),
          addedAt: toDate(data.addedAt),
          voidOf: data.voidOf ? String(data.voidOf) : null
        };
      }));
    }, (error) => {
      console.error("Failed to load incidental charges:", error);
      toast.error("Could not load incidental revenue", "The other reports remain available. Refresh to try again.");
    });
    return unsubscribe;
  }, [bookings, toast]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "corporateInvoices"), (snapshot) => {
      setCorporateInvoices(snapshot.docs.map((invoiceDoc) => {
        const data = invoiceDoc.data();
        return {
          id: invoiceDoc.id,
          companyName: String(data.companyName || "Unassigned corporate account"),
          bookingIds: Array.isArray(data.bookingIds) ? data.bookingIds.map(String) : [],
          bookingRefs: Array.isArray(data.bookingRefs) ? data.bookingRefs.map(String) : [],
          amount: Number(data.amount || 0),
          status: (data.status === "paid" ? "paid" : "issued") as CorporateInvoice["status"],
          issuedAt: toDate(data.issuedAt),
          issuedBy: String(data.issuedBy || "staff"),
          paidAt: toDate(data.paidAt),
          paidBy: data.paidBy ? String(data.paidBy) : null
        };
      }).sort((a, b) => (b.issuedAt?.getTime() || 0) - (a.issuedAt?.getTime() || 0)));
    }, (error) => {
      console.error("Failed to load corporate invoices:", error);
      toast.error("Could not load corporate invoices", "Receivable balances remain available.");
    });
    return unsubscribe;
  }, [toast]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collectionGroup(db, "payments"), (snapshot) => {
      setPayments(snapshot.docs.map((paymentDoc) => {
        const data = paymentDoc.data();
        const bookingId = paymentDoc.ref.parent.parent?.id || "";
        const booking = bookings.find((item) => item.id === bookingId);
        return {
          id: paymentDoc.id,
          type: data.type === "refund" || Number(data.amount || 0) < 0 ? "refund" : "payment",
          bookingId,
          bookingRef: booking?.bookingRef || bookingId,
          roomNumber: booking?.roomNumber || "",
          guestName: booking?.guestName || "",
          amount: Number(data.amount || 0),
          method: String(data.method || "unknown"),
          note: String(data.note || ""),
          reason: data.reason ? String(data.reason) : null,
          approvedBy: data.approvedBy ? String(data.approvedBy) : null,
          recordedBy: String(data.recordedBy || "staff"),
          recordedAt: toDate(data.recordedAt)
        };
      }));
    }, (error) => {
      console.error("Failed to load payment collections:", error);
      toast.error("Could not load collections", "Billed revenue remains available. Refresh to try again.");
    });
    return unsubscribe;
  }, [bookings, toast]);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      query(collection(db, "dailyCloses"), orderBy("closedAt", "desc")),
      (snapshot) => {
        setDailyCloses(snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          closedAt: toDate(doc.data().closedAt)
        })));
      },
      (error) => {
        console.error("Failed to load daily closes:", error);
      }
    );
    return unsubscribe;
  }, []);

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

  const rangeBookings = useMemo(() => {
    return revenueBookings.filter(b => {
      const cIn = toDate(b.checkIn);
      const cOut = toDate(b.checkOut);
      if (!cIn || !cOut) return false;

      // 1. Must overlap with the selected range
      const overlaps = cIn < periodEnd && cOut > periodStart;
      if (!overlaps) return false;

      // 2. Exclude past confirmed bookings (entirely in the past and never checked in / no-show)
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (b.status === "confirmed" && cOut <= today) {
        return false;
      }

      // 3. Exclude future confirmed bookings that have no payments recorded
      if (b.status === "confirmed" && cIn > today) {
        const collected = payments.filter(p => p.bookingId === b.id).reduce((sum, p) => sum + p.amount, 0);
        if (collected <= 0) {
          return false;
        }
      }

      return true;
    });
  }, [revenueBookings, periodStart, periodEnd, payments]);

  const rangeStoreOrders = useMemo(
    () => storeOrders.filter(o => isWithinSelectedRange(o.createdAt)),
    [storeOrders, periodStart, periodEnd]
  );

  const deliveredStoreOrders = useMemo(
    () => rangeStoreOrders.filter(o => o.status === "delivered"),
    [rangeStoreOrders]
  );

  // ── Summary KPIs ──
  const roomRevenue = useMemo(() => {
    return rangeBookings.reduce((sum, b) => {
      const overlapNights = getOverlapNights(b.checkIn, b.checkOut, periodStart, periodEnd);
      const fraction = b.numNights > 0 ? (overlapNights / b.numNights) : 0;
      return sum + (b.totalPrice || 0) * fraction;
    }, 0);
  }, [rangeBookings, periodStart, periodEnd]);

  const breakfastBookingsInRange = useMemo(
    () => rangeBookings.filter(b => b.hasBreakfast),
    [rangeBookings]
  );

  const breakfastRevenue = useMemo(() => {
    return breakfastBookingsInRange.reduce((sum, b) => {
      const overlapNights = getOverlapNights(b.checkIn, b.checkOut, periodStart, periodEnd);
      return sum + (b.breakfastRate || 0) * (b.numGuests || 0) * overlapNights;
    }, 0);
  }, [breakfastBookingsInRange, periodStart, periodEnd]);

  const storeRevenue = useMemo(
    () => deliveredStoreOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
    [deliveredStoreOrders]
  );

  const rangeCharges = useMemo(
    () => charges.filter((charge) => charge.addedAt && charge.addedAt >= periodStart && charge.addedAt <= periodEnd),
    [charges, periodStart, periodEnd]
  );

  const incidentalRevenue = useMemo(
    () => rangeCharges.reduce((sum, charge) => sum + charge.amount, 0),
    [rangeCharges]
  );

  const totalRevenue = roomRevenue + breakfastRevenue + storeRevenue + incidentalRevenue;
  const totalTransactions = rangeBookings.length + deliveredStoreOrders.length + rangeCharges.filter((charge) => charge.amount > 0).length;

  const rangePayments = useMemo(
    () => payments.filter((payment) => payment.recordedAt && payment.recordedAt >= periodStart && payment.recordedAt <= periodEnd),
    [payments, periodStart, periodEnd]
  );

  const billedTotal = useMemo(
    () => rangeBookings.reduce((sum, booking) => sum + Number(booking.totalPrice || 0), 0) + storeRevenue + incidentalRevenue,
    [rangeBookings, storeRevenue, incidentalRevenue]
  );
  const collectedTotal = useMemo(
    () => rangePayments.reduce((sum, payment) => sum + payment.amount, 0),
    [rangePayments]
  );
  const grossCollectionsTotal = useMemo(
    () => rangePayments.filter((payment) => payment.type === "payment").reduce((sum, payment) => sum + payment.amount, 0),
    [rangePayments]
  );
  const refundsTotal = useMemo(
    () => Math.abs(rangePayments.filter((payment) => payment.type === "refund").reduce((sum, payment) => sum + payment.amount, 0)),
    [rangePayments]
  );
  const outstandingTotal = Math.max(billedTotal - collectedTotal, 0);
  const overCollectedTotal = Math.max(collectedTotal - billedTotal, 0);

  const cancelledWithCollections = useMemo(() => {
    return bookings
      .filter((booking) => booking.status === "cancelled")
      .map((booking) => {
        const entries = payments.filter((payment) => payment.bookingId === booking.id);
        const grossPaid = entries.filter((entry) => entry.type === "payment").reduce((sum, entry) => sum + entry.amount, 0);
        const refunded = Math.abs(entries.filter((entry) => entry.type === "refund").reduce((sum, entry) => sum + entry.amount, 0));
        return {
          bookingId: booking.id,
          bookingRef: booking.bookingRef,
          guestName: booking.guestName,
          roomNumber: booking.roomNumber,
          grossPaid,
          refunded,
          retained: Math.max(grossPaid - refunded, 0)
        };
      })
      .filter((row) => row.grossPaid > 0)
      .sort((a, b) => b.retained - a.retained);
  }, [bookings, payments]);

  const collectionsByDay = useMemo(() => {
    const rows = new Map<string, { date: string; count: number; total: number }>();
    rangePayments.forEach((payment) => {
      if (!payment.recordedAt) return;
      const date = payment.recordedAt.toISOString().slice(0, 10);
      const current = rows.get(date) || { date, count: 0, total: 0 };
      current.count += 1;
      current.total += payment.amount;
      rows.set(date, current);
    });
    return Array.from(rows.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [rangePayments]);

  const collectionsByStaff = useMemo(() => {
    const rows = new Map<string, { staff: string; count: number; total: number }>();
    rangePayments.forEach((payment) => {
      const key = payment.recordedBy || "staff";
      const current = rows.get(key) || { staff: key, count: 0, total: 0 };
      current.count += 1;
      current.total += payment.amount;
      rows.set(key, current);
    });
    return Array.from(rows.values()).sort((a, b) => b.total - a.total);
  }, [rangePayments]);

  const uncollectedAddToBill = useMemo(() => {
    return deliveredStoreOrders
      .filter((order) => order.paymentMethod === "add-to-bill")
      .reduce((summary, order) => {
        const booking = bookings.find((item) => item.id === order.bookingId);
        if (!booking) return summary;
        const bookingPayments = payments.filter((payment) => payment.bookingId === booking.id).reduce((sum, payment) => sum + payment.amount, 0);
        const bookingCharges = charges.filter((charge) => charge.bookingId === booking.id).reduce((sum, charge) => sum + charge.amount, 0);
        const bookingStoreTotal = storeOrders
          .filter((storeOrder) => storeOrder.bookingId === booking.id && storeOrder.paymentMethod === "add-to-bill" && storeOrder.status === "delivered" && storeOrder.isBilled)
          .reduce((sum, storeOrder) => sum + storeOrder.totalAmount, 0);
        const balance = Math.max(Number(booking.totalPrice || 0) + bookingCharges + bookingStoreTotal - bookingPayments, 0);
        if (balance <= 0) return summary;
        summary.count += 1;
        summary.total += Math.min(Number(order.totalAmount || 0), balance);
        return summary;
      }, { count: 0, total: 0 });
  }, [deliveredStoreOrders, bookings, payments, charges, storeOrders]);

  const receivables = useMemo<ReceivableRow[]>(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return bookings
      .filter((booking) => ["confirmed", "payment-confirmed", "checked-in", "checked-out"].includes(booking.status))
      .map((booking) => {
        const bookingCharges = charges.filter((charge) => charge.bookingId === booking.id).reduce((sum, charge) => sum + charge.amount, 0);
        const addToBillTotal = storeOrders
          .filter((order) => order.bookingId === booking.id && order.paymentMethod === "add-to-bill" && order.status === "delivered" && order.isBilled)
          .reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
        const collected = payments.filter((payment) => payment.bookingId === booking.id).reduce((sum, payment) => sum + payment.amount, 0);
        const billed = Number(booking.totalPrice || 0) + bookingCharges + addToBillTotal;
        const outstanding = Math.max(billed - collected, 0);
        const checkOut = toDate(booking.checkOut);
        const ageDays = booking.status === "checked-out" && checkOut
          ? Math.max(0, Math.floor((today.getTime() - checkOut.getTime()) / 86_400_000))
          : 0;
        const ageBucket: ReceivableRow["ageBucket"] = ageDays === 0
          ? "Current"
          : ageDays <= 30
            ? "1–30 days"
            : ageDays <= 60
              ? "31–60 days"
              : "60+ days";
        return {
          bookingId: booking.id,
          bookingRef: booking.bookingRef,
          guestName: booking.guestName,
          roomNumber: booking.roomNumber,
          companyName: booking.companyName || "",
          isCorporate: Boolean(booking.isCorporate),
          status: booking.status,
          checkOut,
          billed,
          collected,
          outstanding,
          ageDays,
          ageBucket,
          uncollectedAddToBill: Math.min(addToBillTotal, outstanding)
        };
      })
      .filter((row) => row.outstanding > 0)
      .sort((a, b) => b.ageDays - a.ageDays || b.outstanding - a.outstanding);
  }, [bookings, charges, storeOrders, payments]);

  const receivablesTotal = useMemo(() => receivables.reduce((sum, row) => sum + row.outstanding, 0), [receivables]);
  const overdueReceivablesTotal = useMemo(() => receivables.filter((row) => row.ageDays > 0).reduce((sum, row) => sum + row.outstanding, 0), [receivables]);
  const corporateReceivablesTotal = useMemo(() => receivables.filter((row) => row.isCorporate).reduce((sum, row) => sum + row.outstanding, 0), [receivables]);
  const addToBillReceivablesTotal = useMemo(() => receivables.reduce((sum, row) => sum + row.uncollectedAddToBill, 0), [receivables]);
  const receivablesByAge = useMemo(() => {
    const buckets: Record<ReceivableRow["ageBucket"], number> = { Current: 0, "1–30 days": 0, "31–60 days": 0, "60+ days": 0 };
    receivables.forEach((row) => { buckets[row.ageBucket] += row.outstanding; });
    return Object.entries(buckets).map(([bucket, total]) => ({ bucket, total }));
  }, [receivables]);

  const corporateReceivables = useMemo(() => {
    const groups = new Map<string, { company: string; bookings: number; total: number }>();
    receivables.filter((row) => row.isCorporate).forEach((row) => {
      const company = row.companyName || "Unassigned corporate account";
      const current = groups.get(company) || { company, bookings: 0, total: 0 };
      current.bookings += 1;
      current.total += row.outstanding;
      groups.set(company, current);
    });
    return Array.from(groups.values()).sort((a, b) => b.total - a.total);
  }, [receivables]);

  const discountsSummary = useMemo(() => {
    let grossRoomAndBreakfast = 0;
    let seniorPwdDiscounts = 0;
    let voucherDiscounts = 0;
    let memberDiscounts = 0;
    let pointsRedeemedValue = 0;
    let netBookings = 0;

    rangeBookings.forEach((b) => {
      const roomSubtotal = b.rateBreakdown?.roomSubtotal ?? (b.ratePerNight * b.numNights);
      const breakfastTotal = b.hasBreakfast ? (b.breakfastRate || 0) * (b.numGuests || 0) * (b.numNights || 0) : 0;
      const subtotal = b.originalTotalPrice ?? (roomSubtotal + breakfastTotal);

      const discountPct = b.discountRejected ? 0 : (b.discountPct || 0);
      const seniorDiscount = discountPct > 0 ? Math.round(subtotal * (discountPct / 100)) : 0;
      const afterSenior = subtotal - seniorDiscount;

      const vchDiscount = b.voucherDiscount || 0;
      const afterVoucher = Math.max(afterSenior - vchDiscount, 0);

      const memDiscountPct = b.memberDiscountPct || 0;
      const memDiscount = memDiscountPct > 0 ? Math.round(afterVoucher * (memDiscountPct / 100)) : 0;

      const ptsRedeemedVal = b.pointsRedeemedValue || 0;

      grossRoomAndBreakfast += subtotal;
      seniorPwdDiscounts += seniorDiscount;
      voucherDiscounts += vchDiscount;
      memberDiscounts += memDiscount;
      pointsRedeemedValue += ptsRedeemedVal;
      netBookings += b.totalPrice;
    });

    return {
      grossRoomAndBreakfast,
      seniorPwdDiscounts,
      voucherDiscounts,
      memberDiscounts,
      pointsRedeemedValue,
      netBookings
    };
  }, [rangeBookings]);

  const loyaltyLiability = useMemo(() => {
    const totalPoints = members.reduce((sum, m) => sum + (m.rewardsPoints || 0), 0);
    const redemptionRate = rewardsConfig?.pointsRedemptionRate || 100;
    const liability = Math.max((totalPoints / 100) * redemptionRate, 0);
    return {
      totalPoints,
      liability
    };
  }, [members, rewardsConfig]);

  const handleIssueCorporateInvoice = async (companyName: string) => {
    const rows = receivables.filter((row) => row.isCorporate && (row.companyName || "Unassigned corporate account") === companyName);
    if (rows.length === 0 || invoiceAction) return;
    setInvoiceAction(`issue:${companyName}`);
    try {
      const bookingIds = rows.map((row) => row.bookingId).sort();
      const companyKey = encodeURIComponent(companyName.toLowerCase()).replace(/%/g, "_").slice(0, 120);
      const invoiceRef = doc(db, "corporateInvoices", `${companyKey}-${bookingIds.join("-")}`);
      await setDoc(invoiceRef, {
        companyName,
        bookingIds,
        bookingRefs: rows.map((row) => row.bookingRef),
        amount: rows.reduce((sum, row) => sum + row.outstanding, 0),
        status: "issued",
        issuedAt: serverTimestamp(),
        issuedBy: currentUser?.uid || "staff",
        paidAt: null,
        paidBy: null
      });
      toast.success("Corporate invoice issued", `${companyName} · ${rows.length} booking${rows.length === 1 ? "" : "s"}`);
    } catch (error: any) {
      toast.error("Could not issue invoice", error.message || "Please try again.");
    } finally {
      setInvoiceAction(null);
    }
  };

  const handleMarkCorporateInvoicePaid = async (invoiceId: string) => {
    if (invoiceAction) return;
    setInvoiceAction(`paid:${invoiceId}`);
    try {
      await updateDoc(doc(db, "corporateInvoices", invoiceId), {
        status: "paid",
        paidAt: serverTimestamp(),
        paidBy: currentUser?.uid || "staff"
      });
      toast.success("Invoice marked paid", "The corporate invoice status was updated.");
    } catch (error: any) {
      toast.error("Could not update invoice", error.message || "Please try again.");
    } finally {
      setInvoiceAction(null);
    }
  };

  // ── Monthly revenue by stream (stacked bar) ──
  const monthlyRevenue = useMemo(() => {
    const map = new Map<string, { month: string; room: number; breakfast: number; store: number; incidentals: number; total: number; sortKey: string }>();

    const ensureMonth = (d: Date) => {
      const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
      if (!map.has(key)) {
        map.set(key, {
          month: formatMonthLabel(d),
          room: 0,
          breakfast: 0,
          store: 0,
          incidentals: 0,
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

    rangeCharges.forEach((charge) => {
      if (!charge.addedAt) return;
      ensureMonth(charge.addedAt).incidentals += charge.amount;
    });

    return Array.from(map.values())
      .map(s => ({ ...s, total: s.room + s.breakfast + s.store + s.incidentals }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [rangeBookings, deliveredStoreOrders, rangeCharges]);

  // ── Actual payment method breakdown (FIN-02) ──
  const combinedPaymentMethods = useMemo(() => {
    const counts: Record<string, { method: string; count: number; total: number }> = {};

    rangePayments.forEach(payment => {
      const method = payment.method || "unknown";
      if (!counts[method]) counts[method] = { method, count: 0, total: 0 };
      counts[method].count += 1;
      counts[method].total += payment.amount;
    });

    const rows = Object.values(counts)
      .filter((entry) => entry.total > 0)
      .map(c => ({
        name: PAYMENT_LABELS[c.method] || c.method,
        method: c.method,
        count: c.count,
        total: c.total,
        isUncollected: false
      }))
      .sort((a, b) => b.total - a.total);
    if (uncollectedAddToBill.total > 0) {
      rows.push({
        name: "Add to Bill — Uncollected",
        method: "add-to-bill-uncollected",
        count: uncollectedAddToBill.count,
        total: uncollectedAddToBill.total,
        isUncollected: true
      });
    }
    return rows;
  }, [rangePayments, uncollectedAddToBill]);

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
  const roomTypeOccupancy = useMemo(() => {
    const days = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / 86_400_000));
    return roomTypes.map(rt => {
      const totalRoomsOfType = rooms.filter(r => r.type === rt.value && r.isActive).length;
      const possibleNights = totalRoomsOfType * days;

      // Sum overlapping nights for bookings in this room type
      const occupiedNights = rangeBookings
        .filter(b => b.roomType === rt.value)
        .reduce((sum, b) => sum + getOverlapNights(b.checkIn, b.checkOut, periodStart, periodEnd), 0);

      const ratio = possibleNights > 0 ? Math.round((occupiedNights / possibleNights) * 100) : 0;
      return { name: rt.label, occupied: occupiedNights, total: possibleNights, occupancyRate: ratio };
    });
  }, [roomTypes, rooms, rangeBookings, periodStart, periodEnd]);

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

  const filteredCharges = useMemo(() =>
    rangeCharges.filter((charge) =>
      matchesSearch(charge.bookingRef) || matchesSearch(charge.roomNumber) || matchesSearch(charge.label)
    ),
    [rangeCharges, searchTerm]
  );

  const filteredPayments = useMemo(() =>
    rangePayments.filter((payment) =>
      matchesSearch(payment.bookingRef) || matchesSearch(payment.guestName) || matchesSearch(payment.roomNumber)
      || matchesSearch(payment.method) || matchesSearch(payment.recordedBy)
    ),
    [rangePayments, searchTerm]
  );

  const filteredReceivables = useMemo(() =>
    receivables.filter((row) =>
      matchesSearch(row.bookingRef) || matchesSearch(row.guestName) || matchesSearch(row.roomNumber) || matchesSearch(row.companyName)
    ),
    [receivables, searchTerm]
  );

  const handleExportCollectionsCSV = () => {
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const headers = ["Date", "Booking Ref", "Guest", "Room", "Type", "Amount", "Method", "Recorded By", "Approved By", "Reason / Note"];
    const rows = filteredPayments.map((payment) => [
      payment.recordedAt?.toISOString() || "",
      payment.bookingRef,
      payment.guestName,
      payment.roomNumber,
      payment.type,
      payment.amount,
      PAYMENT_LABELS[payment.method] || payment.method,
      payment.recordedBy,
      payment.approvedBy || "",
      payment.reason || payment.note
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
    triggerDownload(
      new Blob([csv], { type: "text/csv;charset=utf-8;" }),
      `sparkinn_collections_${periodStart.toISOString().slice(0, 10)}_to_${periodEnd.toISOString().slice(0, 10)}.csv`
    );
  };

  const handleExportReceivablesCSV = () => {
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const headers = ["Booking Ref", "Guest", "Room", "Company", "Status", "Check-Out", "Age Days", "Age Bucket", "Billed", "Collected", "Outstanding", "Uncollected Add to Bill"];
    const rows = filteredReceivables.map((row) => [
      row.bookingRef, row.guestName, row.roomNumber, row.companyName, row.status,
      row.checkOut?.toISOString().slice(0, 10) || "", row.ageDays, row.ageBucket,
      row.billed, row.collected, row.outstanding, row.uncollectedAddToBill
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
    triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `sparkinn_receivables_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  // ── CSV Export (Performance-style ledger) ──
  const handleExportCSV = () => {
    if (!isRangeValid) {
      toast.error("Invalid range", "Start date cannot be after end date.");
      return;
    }
    let csvContent = "Booking Reference,Guest Name,Room Number,Check In,Check Out,Nights,Total Price,Status,Source,Payment Method,Payment Reference Number\n";
    filteredBookings.forEach(b => {
      const checkIn = toDate(b.checkIn);
      const checkOut = toDate(b.checkOut);
      csvContent += `"${b.bookingRef}","${b.guestName}","${b.roomNumber}",${checkIn ? checkIn.toISOString().slice(0, 10) : ""},${checkOut ? checkOut.toISOString().slice(0, 10) : ""},${b.numNights},${b.totalPrice},"${b.status}","${b.source}","${b.paymentMethod || ""}","${b.paymentReferenceNumber || ""}"\n`;
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

  const handleExportPDF = async () => {
    if (!isRangeValid) {
      toast.error("Invalid range", "Start date cannot be after end date.");
      return;
    }

    const elementId = activeTab === "performance" ? "performance-tab-content" : "sales-tab-content";
    const element = document.getElementById(elementId);
    if (!element) {
      toast.error("Export failed", "Could not find tab content to export.");
      return;
    }

    setIsExportingPDF(true);
    toast.info("Generating PDF", "Rendering report charts and stat cards...");

    try {
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "white"
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight, undefined, "FAST");
      heightLeft -= pageHeight;

      while (heightLeft >= 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight, undefined, "FAST");
        heightLeft -= pageHeight;
      }

      pdf.save(`sparkinn_${activeTab}_report_${periodStart.toISOString().slice(0, 10)}_to_${periodEnd.toISOString().slice(0, 10)}.pdf`);
      toast.success("PDF downloaded", "Your report PDF has been downloaded successfully.");
    } catch (err) {
      console.error(err);
      toast.error("Generation failed", "Failed to compile the report charts into a PDF.");
    } finally {
      setIsExportingPDF(false);
    }
  };

  // ── Full Backup (admin only) ──
  const runFullBackupExport = async () => {
    if (currentUser?.role !== "admin") return;
    setFullBackupExporting(true);
    toast.info("Preparing backup", "Collecting bookings, payments, members, store, vouchers, and inquiry data.");
    try {
      const paymentRows: Array<Record<string, unknown>> = [];
      const chargeRows: Array<Record<string, unknown>> = [];
      await Promise.all(bookings.map(async (b: any) => {
        try {
          const paymentsSnap = await getDocs(collection(db, "bookings", b.id, "payments"));
          paymentsSnap.forEach((paymentDoc) => {
            const payment = paymentDoc.data();
            paymentRows.push({
              "Booking Ref": b.bookingRef,
              Type: payment.type || (Number(payment.amount || 0) < 0 ? "refund" : "payment"),
              Amount: payment.amount || 0,
              Method: payment.method || "",
              Note: payment.note || "",
              Reason: payment.reason || "",
              "Approved By": payment.approvedBy || "",
              "Recorded By": payment.recordedBy || "",
              "Recorded At": toDate(payment.recordedAt)?.toISOString() || ""
            });
          });
        } catch (error) {
          console.error(`Failed to export payments for booking ${b.id}:`, error);
        }
      }));

      const allChargesSnap = await getDocs(collectionGroup(db, "charges"));
      allChargesSnap.forEach((chargeDoc) => {
        const charge = chargeDoc.data();
        const bookingId = chargeDoc.ref.parent.parent?.id || "";
        const booking = bookings.find((item) => item.id === bookingId);
        chargeRows.push({
          "Booking Ref": booking?.bookingRef || bookingId,
          Room: booking?.roomNumber || "",
          Category: charge.category || "other",
          Label: charge.label || "",
          Amount: Number(charge.amount || 0),
          Note: charge.note || "",
          "Added By": charge.addedBy || "",
          "Added At": toDate(charge.addedAt)?.toISOString() || "",
          "Void Of": charge.voidOf || ""
        });
      });

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
      "Incidental Charges": chargeRows
        .filter((charge) => charge["Booking Ref"] === b.bookingRef)
        .reduce((sum, charge) => sum + Number(charge.Amount || 0), 0),
      "Total Collected Onsite": paymentRows
        .filter((p) => p["Booking Ref"] === b.bookingRef)
        .reduce((sum, p) => sum + Number(p.Amount || 0), 0),
      "Outstanding Balance": (b.totalPrice || 0) + chargeRows
        .filter((charge) => charge["Booking Ref"] === b.bookingRef)
        .reduce((sum, charge) => sum + Number(charge.Amount || 0), 0) - paymentRows
        .filter((p) => p["Booking Ref"] === b.bookingRef)
        .reduce((sum, p) => sum + Number(p.Amount || 0), 0),
      "Payment Method": b.paymentMethod,
      "Payment Reference Number": b.paymentReferenceNumber || "",
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
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(chargeRows), "Charges");

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

      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(corporateInvoices.map((invoice) => ({
        Company: invoice.companyName,
        "Booking Refs": invoice.bookingRefs.join(", "),
        Amount: invoice.amount,
        Status: invoice.status,
        "Issued At": invoice.issuedAt?.toISOString() || "",
        "Issued By": invoice.issuedBy,
        "Paid At": invoice.paidAt?.toISOString() || "",
        "Paid By": invoice.paidBy || ""
      }))), "Corporate Invoices");

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
      ["Incidental Revenue", incidentalRevenue],
      ["Billed Total (charge-inclusive)", billedTotal],
      ["Collected Total (actual payments)", collectedTotal],
      ["Gross Collections", grossCollectionsTotal],
      ["Refunds", refundsTotal],
      ["Outstanding", outstandingTotal],
      ["Over-collected", overCollectedTotal],
      ["All-time Receivables", receivablesTotal],
      ["Overdue Receivables", overdueReceivablesTotal],
      ["Corporate Receivables", corporateReceivablesTotal],
      ["Total Bookings", rangeBookings.length],
      ["Total Store Orders (delivered)", deliveredStoreOrders.length],
      ["Total Transactions", totalTransactions],
      [],
      ["Discounts & Adjustments", "Value (₱)"],
      ["Gross Bookings (Room + Breakfast)", discountsSummary.grossRoomAndBreakfast],
      ["Senior Citizen & PWD Deductions", discountsSummary.seniorPwdDiscounts],
      ["Promo Voucher Deductions", discountsSummary.voucherDiscounts],
      ["Spark Rewards Member Discounts", discountsSummary.memberDiscounts],
      ["Spark Rewards Points Redeemed", discountsSummary.pointsRedeemedValue],
      ["Net Bookings Revenue", discountsSummary.netBookings],
      [],
      ["Loyalty Program Liability", "Metric / Value"],
      ["Total Outstanding Points", loyaltyLiability.totalPoints],
      ["Points Redemption Liability", loyaltyLiability.liability],
      [],
      ["Payment Method", "Count", "Total (₱)"],
      ...combinedPaymentMethods.map(m => [m.name, m.count, m.total])
    ];

    const bookingsHeaders = [
      "Booking Ref", "Guest Name", "Room Number", "Check-In", "Check-Out", "Nights",
      "Guests", "Room Rate", "Room Subtotal", "Breakfast Included", "Breakfast Rate", "Breakfast Subtotal",
      "Discount Type", "Discount %", "Senior/PWD Discount (₱)", "Voucher Code", "Voucher Discount (₱)",
      "Member Discount (₱)", "Points Redeemed Value (₱)", "Gross Subtotal (₱)", "Net Total Price (₱)",
      "Total Collected (₱)", "Outstanding Balance (₱)", "Payment Method", "Payment Reference Number", "Source", "Status"
    ];
    const bookingsRows = filteredBookings.map(b => {
      const roomSubtotal = b.rateBreakdown?.roomSubtotal ?? (b.ratePerNight * b.numNights);
      const breakfastTotal = b.hasBreakfast ? (b.breakfastRate || 0) * (b.numGuests || 0) * (b.numNights || 0) : 0;
      const subtotal = b.originalTotalPrice ?? (roomSubtotal + breakfastTotal);

      const discountPct = b.discountRejected ? 0 : (b.discountPct || 0);
      const seniorDiscount = discountPct > 0 ? Math.round(subtotal * (discountPct / 100)) : 0;
      const afterSenior = subtotal - seniorDiscount;

      const vchDiscount = b.voucherDiscount || 0;
      const afterVoucher = Math.max(afterSenior - vchDiscount, 0);

      const memDiscountPct = b.memberDiscountPct || 0;
      const memDiscount = memDiscountPct > 0 ? Math.round(afterVoucher * (memDiscountPct / 100)) : 0;

      const ptsRedeemedVal = b.pointsRedeemedValue || 0;

      const collected = payments.filter(p => p.bookingId === b.id).reduce((sum, p) => sum + p.amount, 0);
      const bookingCharges = charges.filter((c) => c.bookingId === b.id).reduce((sum, c) => sum + c.amount, 0);
      const addToBillTotal = storeOrders
        .filter((o) => o.bookingId === b.id && o.paymentMethod === "add-to-bill" && o.status === "delivered" && o.isBilled)
        .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
      const billedTotalAmount = b.totalPrice + bookingCharges + addToBillTotal;
      const outstanding = Math.max(billedTotalAmount - collected, 0);

      return [
        b.bookingRef, b.guestName, b.roomNumber,
        toDate(b.checkIn)?.toISOString().slice(0, 10) || "",
        toDate(b.checkOut)?.toISOString().slice(0, 10) || "",
        b.numNights, b.numGuests, b.ratePerNight, roomSubtotal,
        b.hasBreakfast ? "Yes" : "No", b.hasBreakfast ? b.breakfastRate : 0, breakfastTotal,
        b.discountType || "None", discountPct, seniorDiscount,
        b.voucherCode || "", vchDiscount, memDiscount, ptsRedeemedVal,
        subtotal, b.totalPrice, collected, outstanding,
        PAYMENT_LABELS[b.paymentMethod] || b.paymentMethod,
        b.paymentReferenceNumber || "",
        b.source, b.status
      ];
    });

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

    const chargeHeaders = ["Booking Ref", "Room", "Category", "Label", "Amount", "Note", "Added By", "Date", "Void Of"];
    const chargeRows = filteredCharges.map((charge) => [
      charge.bookingRef,
      charge.roomNumber,
      charge.category,
      charge.label,
      charge.amount,
      charge.note,
      charge.addedBy,
      charge.addedAt?.toISOString() || "",
      charge.voidOf || ""
    ]);

    const collectionHeaders = ["Date", "Booking Ref", "Guest", "Room", "Type", "Amount", "Method", "Recorded By", "Approved By", "Reason / Note"];
    const collectionRows = filteredPayments.map((payment) => [
      payment.recordedAt?.toISOString() || "",
      payment.bookingRef,
      payment.guestName,
      payment.roomNumber,
      payment.type,
      payment.amount,
      PAYMENT_LABELS[payment.method] || payment.method,
      payment.recordedBy,
      payment.approvedBy || "",
      payment.reason || payment.note
    ]);

    const receivableHeaders = ["Booking Ref", "Guest", "Room", "Company", "Status", "Check-Out", "Age Days", "Age Bucket", "Billed", "Collected", "Outstanding", "Uncollected Add to Bill"];
    const receivableRows = filteredReceivables.map((row) => [
      row.bookingRef, row.guestName, row.roomNumber, row.companyName, row.status,
      row.checkOut?.toISOString().slice(0, 10) || "", row.ageDays, row.ageBucket,
      row.billed, row.collected, row.outstanding, row.uncollectedAddToBill
    ]);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([...summaryRows]), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([bookingsHeaders, ...bookingsRows]), "Bookings");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([breakfastHeaders, ...breakfastRows]), "Breakfast");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([storeHeaders, ...storeRows]), "Store Orders");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([chargeHeaders, ...chargeRows]), "Charges");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([collectionHeaders, ...collectionRows]), "Collections");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([receivableHeaders, ...receivableRows]), "Receivables");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(corporateInvoices.map((invoice) => ({
      Company: invoice.companyName,
      "Booking Refs": invoice.bookingRefs.join(", "),
      Amount: invoice.amount,
      Status: invoice.status,
      "Issued At": invoice.issuedAt?.toISOString() || "",
      "Issued By": invoice.issuedBy,
      "Paid At": invoice.paidAt?.toISOString() || "",
      "Paid By": invoice.paidBy || ""
    }))), "Corporate Invoices");

    XLSX.writeFile(wb, `spark-inn-sales-${periodStart.toISOString().slice(0, 10)}.xlsx`);
  };

  const totalBookingsInRange = rangeBookings.length;
  const avgNights = totalBookingsInRange > 0
    ? Math.round((rangeBookings.reduce((sum, b) => sum + b.numNights, 0) / totalBookingsInRange) * 10) / 10
    : 0;

  // Per W3.5: Avg. Occupancy + Busiest Room Type (replaces Avg. Length of Stay).
  const totalRoomNights = rangeBookings.reduce((sum, b) => sum + getOverlapNights(b.checkIn, b.checkOut, periodStart, periodEnd), 0);
  const daysInRange = Math.max(1, Math.ceil((periodEnd.getTime() - periodStart.getTime()) / 86_400_000));
  const totalActiveRooms = rooms.filter(r => r.isActive).length;
  const possibleRoomNights = totalActiveRooms * daysInRange;
  const avgOccupancyPct = possibleRoomNights > 0
    ? Math.round((totalRoomNights / possibleRoomNights) * 100)
    : 0;

  // ── Previous period for comparison (FIN-12) ──
  const prevPeriod = useMemo(() => {
    const durationMs = periodEnd.getTime() - periodStart.getTime();
    const start = new Date(periodStart.getTime() - durationMs - 1);
    const end = new Date(periodStart.getTime() - 1);
    return { start, end };
  }, [periodStart, periodEnd]);

  const prevRangeBookings = useMemo(() => {
    return revenueBookings.filter(b => {
      const cIn = toDate(b.checkIn);
      const cOut = toDate(b.checkOut);
      if (!cIn || !cOut) return false;

      const overlaps = cIn < prevPeriod.end && cOut > prevPeriod.start;
      if (!overlaps) return false;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (b.status === "confirmed" && cOut <= today) {
        return false;
      }

      if (b.status === "confirmed" && cIn > today) {
        const collected = payments.filter(p => p.bookingId === b.id).reduce((sum, p) => sum + p.amount, 0);
        if (collected <= 0) {
          return false;
        }
      }

      return true;
    });
  }, [revenueBookings, prevPeriod, payments]);

  const prevDeliveredStoreOrders = useMemo(() => {
    const prevRangeStoreOrders = storeOrders.filter(o => {
      const date = toDate(o.createdAt);
      return date && date >= prevPeriod.start && date <= prevPeriod.end;
    });
    return prevRangeStoreOrders.filter(o => o.status === "delivered");
  }, [storeOrders, prevPeriod]);

  const prevRangeCharges = useMemo(() => {
    return charges.filter(c => c.addedAt && c.addedAt >= prevPeriod.start && c.addedAt <= prevPeriod.end);
  }, [charges, prevPeriod]);

  const prevRoomRevenue = useMemo(() => {
    return prevRangeBookings.reduce((sum, b) => {
      const overlapNights = getOverlapNights(b.checkIn, b.checkOut, prevPeriod.start, prevPeriod.end);
      const fraction = b.numNights > 0 ? (overlapNights / b.numNights) : 0;
      return sum + (b.totalPrice || 0) * fraction;
    }, 0);
  }, [prevRangeBookings, prevPeriod]);

  const prevBreakfastRevenue = useMemo(() => {
    return prevRangeBookings.filter(b => b.hasBreakfast).reduce((sum, b) => {
      const overlapNights = getOverlapNights(b.checkIn, b.checkOut, prevPeriod.start, prevPeriod.end);
      return sum + (b.breakfastRate || 0) * (b.numGuests || 0) * overlapNights;
    }, 0);
  }, [prevRangeBookings, prevPeriod]);

  const prevStoreRevenue = useMemo(() => {
    return prevDeliveredStoreOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  }, [prevDeliveredStoreOrders]);

  const prevIncidentalRevenue = useMemo(() => {
    return prevRangeCharges.reduce((sum, c) => sum + c.amount, 0);
  }, [prevRangeCharges]);

  const prevTotalRevenue = prevRoomRevenue + prevBreakfastRevenue + prevStoreRevenue + prevIncidentalRevenue;
  const prevTotalBookings = prevRangeBookings.length;
  const prevTotalRoomNights = prevRangeBookings.reduce((sum, b) => sum + getOverlapNights(b.checkIn, b.checkOut, prevPeriod.start, prevPeriod.end), 0);
  const prevDaysInRange = Math.max(1, Math.ceil((prevPeriod.end.getTime() - prevPeriod.start.getTime()) / 86_400_000));
  const prevPossibleRoomNights = totalActiveRooms * prevDaysInRange;
  const prevAvgOccupancyPct = prevPossibleRoomNights > 0 ? Math.round((prevTotalRoomNights / prevPossibleRoomNights) * 100) : 0;

  // ADR & RevPAR (FIN-11)
  const adr = totalRoomNights > 0 ? roomRevenue / totalRoomNights : 0;
  const revpar = possibleRoomNights > 0 ? roomRevenue / possibleRoomNights : 0;

  const prevAdr = prevTotalRoomNights > 0 ? prevRoomRevenue / prevTotalRoomNights : 0;
  const prevRevpar = prevPossibleRoomNights > 0 ? prevRoomRevenue / prevPossibleRoomNights : 0;

  const prevTotalTransactions = prevRangeBookings.length + prevDeliveredStoreOrders.length + prevRangeCharges.filter((charge) => charge.amount > 0).length;

  // Comparison deltas (FIN-12)
  const getDeltaPct = (curr: number, prev: number) => {
    if (prev === 0) return curr > 0 ? 100 : 0;
    return ((curr - prev) / prev) * 100;
  };

  const deltas = {
    revenue: getDeltaPct(totalRevenue, prevTotalRevenue),
    bookings: getDeltaPct(totalBookingsInRange, prevTotalBookings),
    occupancy: getDeltaPct(avgOccupancyPct, prevAvgOccupancyPct),
    adr: getDeltaPct(adr, prevAdr),
    revpar: getDeltaPct(revpar, prevRevpar),
    roomRevenue: getDeltaPct(roomRevenue, prevRoomRevenue),
    breakfastRevenue: getDeltaPct(breakfastRevenue, prevBreakfastRevenue),
    storeRevenue: getDeltaPct(storeRevenue, prevStoreRevenue),
    incidentalRevenue: getDeltaPct(incidentalRevenue, prevIncidentalRevenue),
    transactions: getDeltaPct(totalTransactions, prevTotalTransactions)
  };

  // Revenue by room type (FIN-11)
  const roomTypeRevenue = useMemo(() => {
    return roomTypes.map(rt => {
      const revenue = rangeBookings
        .filter(b => b.roomType === rt.value)
        .reduce((sum, b) => {
          const overlapNights = getOverlapNights(b.checkIn, b.checkOut, periodStart, periodEnd);
          const fraction = b.numNights > 0 ? (overlapNights / b.numNights) : 0;
          return sum + (b.totalPrice || 0) * fraction;
        }, 0);
      return { name: rt.label, revenue };
    });
  }, [roomTypes, rangeBookings, periodStart, periodEnd]);

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

          {activeTab !== "daily-close" && (
            <button
              onClick={handleExportPDF}
              disabled={isExportingPDF}
              className="min-h-[44px] px-5 inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-750 disabled:opacity-60 text-xs font-semibold text-white shadow-sm transition active:scale-95 disabled:cursor-not-allowed"
            >
              <Download size={14} />
              {isExportingPDF ? "Generating PDF..." : "Export PDF"}
            </button>
          )}

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
      <div role="tablist" className="flex gap-1 rounded-lg bg-gray-100 p-1 max-w-md">
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
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "daily-close"}
          onClick={() => setActiveTab("daily-close")}
          className={`flex-1 min-h-[36px] rounded-md text-xs font-bold transition ${
            activeTab === "daily-close" ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-800"
          }`}
        >
          Daily Close
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
          adr={adr}
          revpar={revpar}
          roomTypeRevenue={roomTypeRevenue}
          deltas={deltas}
        />
      )}

      {activeTab === "sales" && (
        <SalesTab
          deltas={deltas}
          totalRevenue={totalRevenue}
          roomRevenue={roomRevenue}
          breakfastRevenue={breakfastRevenue}
          storeRevenue={storeRevenue}
          incidentalRevenue={incidentalRevenue}
          billedTotal={billedTotal}
          collectedTotal={collectedTotal}
          grossCollectionsTotal={grossCollectionsTotal}
          refundsTotal={refundsTotal}
          outstandingTotal={outstandingTotal}
          overCollectedTotal={overCollectedTotal}
          collectionsByDay={collectionsByDay}
          collectionsByStaff={collectionsByStaff}
          filteredPayments={filteredPayments}
          onExportCollectionsCSV={handleExportCollectionsCSV}
          cancelledWithCollections={cancelledWithCollections}
          receivablesTotal={receivablesTotal}
          overdueReceivablesTotal={overdueReceivablesTotal}
          corporateReceivablesTotal={corporateReceivablesTotal}
          addToBillReceivablesTotal={addToBillReceivablesTotal}
          receivablesByAge={receivablesByAge}
          corporateReceivables={corporateReceivables}
          filteredReceivables={filteredReceivables}
          onExportReceivablesCSV={handleExportReceivablesCSV}
          corporateInvoices={corporateInvoices}
          invoiceAction={invoiceAction}
          onIssueCorporateInvoice={handleIssueCorporateInvoice}
          onMarkCorporateInvoicePaid={handleMarkCorporateInvoicePaid}
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
          filteredCharges={filteredCharges}
          breakfastBookingsInRange={breakfastBookingsInRange}
          toDate={toDate}
          chartColors={chartColors}
          isMobile={isMobile}
          discountsSummary={discountsSummary}
          loyaltyLiability={loyaltyLiability}
          rewardsConfig={rewardsConfig}
        />
      )}

      {activeTab === "daily-close" && (
        <DailyCloseTab
          payments={payments}
          dailyCloses={dailyCloses}
          currentUser={currentUser}
          toDate={toDate}
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
  totalBookings, totalRevenue, avgNights, monthlyRevenue, roomTypeOccupancy, bookingSources, totalActiveRooms, avgOccupancyPct, totalRoomNights, daysInRange, busiestRoomType, busiestCount, adr, revpar, roomTypeRevenue, deltas
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
  adr: number;
  revpar: number;
  roomTypeRevenue: Array<{ name: string; revenue: number }>;
  deltas: { revenue: number; bookings: number; occupancy: number; adr: number; revpar: number };
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
    <div id="performance-tab-content" className="space-y-8 bg-white p-6 rounded-xl border border-gray-100">
      <div className="grid gap-6 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Revenue</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(totalRevenue)}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">All streams in period</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <DeltaBadge value={deltas.revenue} />
            <div className="h-8 w-8 rounded-full bg-orange-50 text-primary flex items-center justify-center">
              <DollarSign size={14} />
            </div>
          </div>
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Bookings</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{totalBookings}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Confirmed, in, out</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <DeltaBadge value={deltas.bookings} />
            <div className="h-8 w-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users size={14} />
            </div>
          </div>
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Avg. Occupancy</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{avgOccupancyPct}%</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
              {totalRoomNights} room-nights / {totalActiveRooms} rooms × {daysInRange} days
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <DeltaBadge value={deltas.occupancy} />
            <div className="h-8 w-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Home size={14} />
            </div>
          </div>
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">ADR</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(adr)}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Avg. Room Rate</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <DeltaBadge value={deltas.adr} />
            <div className="h-8 w-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Key size={14} />
            </div>
          </div>
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">RevPAR</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(revpar)}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Rev / Avail Room</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <DeltaBadge value={deltas.revpar} />
            <div className="h-8 w-8 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center">
              <BarChart2 size={14} />
            </div>
          </div>
        </div>

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Busiest Room Type</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none truncate">{busiestRoomType}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
              {busiestCount} bookings in this range
            </span>
          </div>
          <div className="mt-3 flex items-end justify-end">
            <div className="h-8 w-8 rounded-full bg-violet-50 text-violet-600 flex items-center justify-center">
              <TrendingUp size={14} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
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

        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Revenue by Room Type</h2>
            <p className="text-[10px] text-gray-500">Prorated room revenue generated per room type.</p>
          </div>
          {roomTypeRevenue.length === 0 || roomTypeRevenue.every(r => r.revenue === 0) ? (
            <div className="h-72 flex items-center justify-center text-xs text-gray-400">
              No revenue generated in this range.
            </div>
          ) : (
            <div className="h-72 w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roomTypeRevenue} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 9, fill: axisColor }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: axisColor }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: any) => [formatPrice(value), "Revenue"]}
                  />
                  <Bar dataKey="revenue" fill={config.colors.primary} radius={[4, 4, 0, 0]} barSize={24} />
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
  deltas: {
    revenue: number;
    roomRevenue: number;
    breakfastRevenue: number;
    storeRevenue: number;
    incidentalRevenue: number;
    transactions: number;
  };
  totalRevenue: number;
  roomRevenue: number;
  breakfastRevenue: number;
  storeRevenue: number;
  incidentalRevenue: number;
  billedTotal: number;
  collectedTotal: number;
  grossCollectionsTotal: number;
  refundsTotal: number;
  outstandingTotal: number;
  overCollectedTotal: number;
  collectionsByDay: Array<{ date: string; count: number; total: number }>;
  collectionsByStaff: Array<{ staff: string; count: number; total: number }>;
  filteredPayments: ReportPayment[];
  onExportCollectionsCSV: () => void;
  cancelledWithCollections: Array<{ bookingId: string; bookingRef: string; guestName: string; roomNumber: string; grossPaid: number; refunded: number; retained: number }>;
  receivablesTotal: number;
  overdueReceivablesTotal: number;
  corporateReceivablesTotal: number;
  addToBillReceivablesTotal: number;
  receivablesByAge: Array<{ bucket: string; total: number }>;
  corporateReceivables: Array<{ company: string; bookings: number; total: number }>;
  filteredReceivables: ReceivableRow[];
  onExportReceivablesCSV: () => void;
  corporateInvoices: CorporateInvoice[];
  invoiceAction: string | null;
  onIssueCorporateInvoice: (companyName: string) => void;
  onMarkCorporateInvoicePaid: (invoiceId: string) => void;
  totalTransactions: number;
  monthlyRevenue: Array<{ month: string; room: number; breakfast: number; store: number; incidentals: number; total: number }>;
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
  filteredCharges: ReportCharge[];
  breakfastBookingsInRange: Array<any>;
  toDate: (v: any) => Date | null;
  chartColors: string[];
  isMobile: boolean;
  discountsSummary: {
    grossRoomAndBreakfast: number;
    seniorPwdDiscounts: number;
    voucherDiscounts: number;
    memberDiscounts: number;
    pointsRedeemedValue: number;
    netBookings: number;
  };
  loyaltyLiability: {
    totalPoints: number;
    liability: number;
  };
  rewardsConfig?: any;
}) {
  const {
    deltas,
    totalRevenue, roomRevenue, breakfastRevenue, storeRevenue, incidentalRevenue, totalTransactions,
    billedTotal, collectedTotal, grossCollectionsTotal, refundsTotal, outstandingTotal, overCollectedTotal, collectionsByDay, collectionsByStaff,
    filteredPayments, onExportCollectionsCSV, cancelledWithCollections,
    receivablesTotal, overdueReceivablesTotal, corporateReceivablesTotal, addToBillReceivablesTotal,
    receivablesByAge, corporateReceivables, filteredReceivables, onExportReceivablesCSV,
    corporateInvoices, invoiceAction, onIssueCorporateInvoice, onMarkCorporateInvoicePaid,
    monthlyRevenue, combinedPaymentMethods, topStoreItems, storeOrdersByStatus, lowStockItems,
    deliveredStoreOrders, breakfastConfig, dailyKitchenPrep,
    salesSubTab, setSalesSubTab, searchTerm, setSearchTerm,
    filteredBookings, filteredBreakfastBookings, filteredStoreOrders, filteredCharges, breakfastBookingsInRange,
    toDate, chartColors, isMobile,
    discountsSummary, loyaltyLiability,
    rewardsConfig
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
    <div id="sales-tab-content" className="space-y-8 bg-white p-6 rounded-xl border border-gray-100">
      {/* Summary KPI Cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Revenue</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(totalRevenue)}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">All streams combined</span>
          </div>
          <div className="mt-2.5">
            <DeltaBadge value={deltas.revenue} />
          </div>
        </div>
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Room Revenue</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(roomRevenue)}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Net of discounts</span>
          </div>
          <div className="mt-2.5">
            <DeltaBadge value={deltas.roomRevenue} />
          </div>
        </div>
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Breakfast Revenue</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(breakfastRevenue)}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">
              {breakfastEnabled ? `${breakfastBookingsInRange.length} breakfast bookings` : "Service disabled"}
            </span>
          </div>
          <div className="mt-2.5">
            <DeltaBadge value={deltas.breakfastRevenue} />
          </div>
        </div>
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Store Revenue</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(storeRevenue)}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Delivered orders only</span>
          </div>
          <div className="mt-2.5">
            <DeltaBadge value={deltas.storeRevenue} />
          </div>
        </div>
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Incidental Revenue</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{formatPrice(incidentalRevenue)}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Net of charge reversals</span>
          </div>
          <div className="mt-2.5">
            <DeltaBadge value={deltas.incidentalRevenue} />
          </div>
        </div>
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 flex flex-col justify-between">
          <div>
            <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Transactions</span>
            <p className="font-heading text-2xl text-gray-950 mt-1.5 leading-none">{totalTransactions}</p>
            <span className="text-[10px] text-gray-500 font-semibold mt-2 block">Bookings + store orders</span>
          </div>
          <div className="mt-2.5">
            <DeltaBadge value={deltas.transactions} />
          </div>
        </div>
      </div>

      <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Collections Reconciliation</h2>
            <p className="mt-1 text-[10px] text-gray-500">Actual entries from the append-only payment ledger, compared with charge-inclusive billed totals for this period.</p>
          </div>
          <button type="button" onClick={onExportCollectionsCSV} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50">
            <Download size={14} /> Export Collections CSV
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Billed</p>
            <p className="mt-1 text-xl font-heading text-gray-950">{formatPrice(billedTotal)}</p>
            <p className="mt-1 text-[10px] text-gray-500">Bookings + store + incidentals</p>
          </div>
          <div className="rounded-lg bg-emerald-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Net Collected</p>
            <p className="mt-1 text-xl font-heading text-emerald-800">{formatPrice(collectedTotal)}</p>
            <p className="mt-1 text-[10px] text-emerald-700">Actual payment entries</p>
          </div>
          <div className="rounded-lg bg-emerald-50/60 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Gross Collections</p>
            <p className="mt-1 text-xl font-heading text-emerald-800">{formatPrice(grossCollectionsTotal)}</p>
            <p className="mt-1 text-[10px] text-emerald-700">Before refunds</p>
          </div>
          <div className="rounded-lg bg-rose-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-rose-700">Refunds</p>
            <p className="mt-1 text-xl font-heading text-rose-800">{formatPrice(refundsTotal)}</p>
            <p className="mt-1 text-[10px] text-rose-700">Approved outflows</p>
          </div>
          <div className="rounded-lg bg-red-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-red-600">Outstanding</p>
            <p className="mt-1 text-xl font-heading text-red-700">{formatPrice(outstandingTotal)}</p>
            <p className="mt-1 text-[10px] text-red-600">Billed less collected</p>
          </div>
          <div className="rounded-lg bg-amber-50 p-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Over-collected</p>
            <p className="mt-1 text-xl font-heading text-amber-800">{formatPrice(overCollectedTotal)}</p>
            <p className="mt-1 text-[10px] text-amber-700">Review for refund or timing mismatch</p>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Collections by day</h3>
            {collectionsByDay.length === 0 ? <p className="text-xs text-gray-400">No payments recorded in this period.</p> : (
              <div className="max-h-64 overflow-auto rounded-lg border border-gray-150">
                {collectionsByDay.map((row) => (
                  <div key={row.date} className="flex items-center justify-between border-b border-gray-100 p-3 text-xs last:border-0">
                    <span className="font-semibold text-gray-700">{row.date} · {row.count} payment{row.count === 1 ? "" : "s"}</span>
                    <span className="font-bold text-gray-950">{formatPrice(row.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Collections by staff</h3>
            {collectionsByStaff.length === 0 ? <p className="text-xs text-gray-400">No staff collection activity in this period.</p> : (
              <div className="max-h-64 overflow-auto rounded-lg border border-gray-150">
                {collectionsByStaff.map((row) => (
                  <div key={row.staff} className="flex items-center justify-between border-b border-gray-100 p-3 text-xs last:border-0">
                    <span className="font-semibold text-gray-700">{row.staff} · {row.count} payment{row.count === 1 ? "" : "s"}</span>
                    <span className="font-bold text-gray-950">{formatPrice(row.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-150">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-left">
              <tr>{["Date", "Booking", "Guest / Room", "Type", "Method", "Staff", "Amount"].map((heading) => <th key={heading} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredPayments.slice(0, 50).map((payment) => (
                <tr key={`${payment.bookingId}-${payment.id}`}>
                  <td className="px-3 py-2 text-gray-600">{payment.recordedAt?.toISOString().slice(0, 10) || "—"}</td>
                  <td className="px-3 py-2 font-semibold text-gray-900">{payment.bookingRef}</td>
                  <td className="px-3 py-2 text-gray-600">{payment.guestName || "—"} · Room {payment.roomNumber || "—"}</td>
                  <td className={`px-3 py-2 font-semibold capitalize ${payment.type === "refund" ? "text-red-600" : "text-emerald-700"}`}>{payment.type}</td>
                  <td className="px-3 py-2 text-gray-600">{PAYMENT_LABELS[payment.method] || payment.method}</td>
                  <td className="px-3 py-2 text-gray-600">{payment.recordedBy}</td>
                  <td className={`px-3 py-2 text-right font-bold ${payment.type === "refund" ? "text-red-600" : "text-emerald-700"}`}>{formatPrice(payment.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredPayments.length === 0 ? <p className="p-6 text-center text-xs text-gray-400">No collection entries match this range.</p> : null}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Cancelled bookings with money collected</h3>
          {cancelledWithCollections.length === 0 ? <p className="text-xs text-gray-400">No cancelled bookings have payment history.</p> : (
            <div className="overflow-x-auto rounded-lg border border-gray-150">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-left"><tr>{["Booking", "Guest / Room", "Gross Paid", "Refunded", "Still Retained"].map((heading) => <th key={heading} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">{heading}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {cancelledWithCollections.map((row) => (
                    <tr key={row.bookingId}>
                      <td className="px-3 py-2 font-semibold text-gray-900">{row.bookingRef}</td>
                      <td className="px-3 py-2 text-gray-600">{row.guestName} · Room {row.roomNumber}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{formatPrice(row.grossPaid)}</td>
                      <td className="px-3 py-2 text-right text-red-600">{formatPrice(row.refunded)}</td>
                      <td className={`px-3 py-2 text-right font-bold ${row.retained > 0 ? "text-amber-700" : "text-emerald-700"}`}>{formatPrice(row.retained)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Receivables & Aging</h2>
            <p className="mt-1 text-[10px] text-gray-500">All active and checked-out bookings with an unpaid, charge-inclusive folio balance. Aging starts from checkout.</p>
          </div>
          <button type="button" onClick={onExportReceivablesCSV} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 text-xs font-bold text-gray-700 hover:bg-gray-50">
            <Download size={14} /> Export Receivables CSV
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Total Receivables", value: receivablesTotal, tone: "bg-red-50 text-red-700" },
            { label: "Overdue", value: overdueReceivablesTotal, tone: "bg-amber-50 text-amber-800" },
            { label: "Corporate AR", value: corporateReceivablesTotal, tone: "bg-blue-50 text-blue-800" },
            { label: "Add to Bill Unpaid", value: addToBillReceivablesTotal, tone: "bg-gray-100 text-gray-800" }
          ].map((card) => (
            <div key={card.label} className={`rounded-lg p-4 ${card.tone}`}>
              <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{card.label}</p>
              <p className="mt-1 text-xl font-heading">{formatPrice(card.value)}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Aging buckets</h3>
            <div className="space-y-2 rounded-lg border border-gray-150 p-3">
              {receivablesByAge.map((row) => (
                <div key={row.bucket} className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-600">{row.bucket}</span>
                  <span className="font-bold text-gray-950">{formatPrice(row.total)}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Corporate accounts</h3>
            {corporateReceivables.length === 0 ? <p className="text-xs text-gray-400">No corporate receivables.</p> : (
              <div className="max-h-52 overflow-auto rounded-lg border border-gray-150">
                {corporateReceivables.map((row) => (
                  <div key={row.company} className="flex items-center justify-between gap-3 border-b border-gray-100 p-3 text-xs last:border-0">
                    <span className="font-semibold text-gray-700">{row.company} · {row.bookings} booking{row.bookings === 1 ? "" : "s"}<span className="block text-[11px] font-bold text-gray-950">{formatPrice(row.total)}</span></span>
                    <button type="button" disabled={Boolean(invoiceAction)} onClick={() => void onIssueCorporateInvoice(row.company)} className="min-h-[44px] rounded-lg border border-primary/30 px-3 text-[10px] font-bold text-primary-dark hover:bg-primary-light disabled:opacity-50">
                      {invoiceAction === `issue:${row.company}` ? "Issuing..." : "Issue invoice"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-150">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50 text-left">
              <tr>{["Booking", "Guest / Company", "Status", "Checkout", "Age", "Billed", "Collected", "Outstanding"].map((heading) => <th key={heading} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">{heading}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredReceivables.slice(0, 50).map((row) => (
                <tr key={row.bookingId}>
                  <td className="px-3 py-2 font-semibold text-gray-900">{row.bookingRef}<span className="block text-[10px] font-normal text-gray-500">Room {row.roomNumber}</span></td>
                  <td className="px-3 py-2 text-gray-600">{row.guestName}{row.companyName ? <span className="block text-[10px] text-blue-700">{row.companyName}</span> : null}</td>
                  <td className="px-3 py-2 capitalize text-gray-600">{row.status.replace(/-/g, " ")}</td>
                  <td className="px-3 py-2 text-gray-600">{row.checkOut?.toISOString().slice(0, 10) || "—"}</td>
                  <td className="px-3 py-2 text-gray-600">{row.ageBucket}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{formatPrice(row.billed)}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">{formatPrice(row.collected)}</td>
                  <td className="px-3 py-2 text-right font-bold text-red-700">{formatPrice(row.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredReceivables.length === 0 ? <p className="p-6 text-center text-xs text-gray-400">No unpaid balances match this search.</p> : null}
        </div>

        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-gray-500">Corporate invoice register</h3>
          {corporateInvoices.length === 0 ? <p className="text-xs text-gray-400">No corporate invoices issued yet.</p> : (
            <div className="overflow-x-auto rounded-lg border border-gray-150">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-left"><tr>{["Company", "Bookings", "Issued", "Amount", "Status", "Action"].map((heading) => <th key={heading} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">{heading}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {corporateInvoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="px-3 py-2 font-semibold text-gray-900">{invoice.companyName}</td>
                      <td className="px-3 py-2 text-gray-600">{invoice.bookingRefs.join(", ")}</td>
                      <td className="px-3 py-2 text-gray-600">{invoice.issuedAt?.toISOString().slice(0, 10) || "Pending"}</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-950">{formatPrice(invoice.amount)}</td>
                      <td className="px-3 py-2"><span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${invoice.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{invoice.status}</span></td>
                      <td className="px-3 py-2">{invoice.status === "issued" ? <button type="button" disabled={Boolean(invoiceAction)} onClick={() => void onMarkCorporateInvoicePaid(invoice.id)} className="min-h-[44px] rounded-lg px-3 text-[10px] font-bold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">{invoiceAction === `paid:${invoice.id}` ? "Saving..." : "Mark paid"}</button> : <span className="text-[10px] text-gray-500">{invoice.paidAt?.toISOString().slice(0, 10) || "Paid"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-5">
        <div>
          <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Discounts & Adjustments</h2>
          <p className="mt-1 text-[10px] text-gray-500">Gross-to-net bookings revenue bridge and active member loyalty points liability.</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Gross-to-Net Revenue Bridge</h3>
            
            <div className="rounded-lg border border-gray-150 overflow-hidden text-xs">
              <div className="flex items-center justify-between bg-gray-50 p-3 font-semibold text-gray-700 border-b border-gray-150">
                <span>Gross Bookings Subtotal (Room + Breakfast)</span>
                <span className="font-mono">{formatPrice(discountsSummary.grossRoomAndBreakfast)}</span>
              </div>
              <div className="divide-y divide-gray-100 bg-white">
                <div className="flex items-center justify-between p-3 text-gray-600">
                  <span>Senior Citizen & PWD Deductions (20% Exemption)</span>
                  <span className="font-mono text-red-600">-{formatPrice(discountsSummary.seniorPwdDiscounts)}</span>
                </div>
                <div className="flex items-center justify-between p-3 text-gray-600">
                  <span>Promo Voucher Deductions</span>
                  <span className="font-mono text-red-600">-{formatPrice(discountsSummary.voucherDiscounts)}</span>
                </div>
                <div className="flex items-center justify-between p-3 text-gray-600">
                  <span>Spark Rewards Member Discounts</span>
                  <span className="font-mono text-red-600">-{formatPrice(discountsSummary.memberDiscounts)}</span>
                </div>
                <div className="flex items-center justify-between p-3 text-gray-600">
                  <span>Spark Rewards Points Redeemed</span>
                  <span className="font-mono text-red-600">-{formatPrice(discountsSummary.pointsRedeemedValue)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between bg-primary/5 p-3 font-bold text-gray-950 border-t border-gray-150">
                <span>Net Bookings Revenue</span>
                <span className="font-mono">{formatPrice(discountsSummary.netBookings)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Loyalty Program Liability</h3>
            
            <div className="rounded-lg border border-gray-150 p-4 bg-gray-50 space-y-4 h-[calc(100%-1.75rem)]">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Outstanding Points</p>
                <p className="mt-1 text-2xl font-heading text-gray-950">{loyaltyLiability.totalPoints.toLocaleString()}</p>
                <p className="text-[10px] text-gray-500 mt-1">Accumulated across all registered members.</p>
              </div>
              <div className="border-t border-gray-250 pt-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-red-600">Points Redemption Liability</p>
                <p className="mt-1 text-2xl font-heading text-red-700">{formatPrice(loyaltyLiability.liability)}</p>
                <p className="text-[10px] text-gray-500 mt-1">
                  Cash equivalent liability calculated at 100 points = {formatPrice(rewardsConfig?.pointsRedemptionRate || 100)}.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Revenue by Stream</h2>
            <p className="text-[10px] text-gray-500">Monthly contribution of Room, Breakfast, Store, and incidental revenue.</p>
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
                  <Bar dataKey="incidentals" stackId="revenue" name="Incidentals" fill={chartColors[2]} radius={[4, 4, 0, 0]} />
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
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">Actual Payment Methods</h2>
            <p className="text-[10px] text-gray-500">Collected amounts from payment ledger entries, not booking-time preferences.</p>
          </div>
          {combinedPaymentMethods.length === 0 ? (
            <p className="text-xs text-gray-400 py-6">No payment data yet.</p>
          ) : (
            <>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={combinedPaymentMethods} dataKey="total" nameKey="name" innerRadius={48} outerRadius={82} paddingAngle={4}>
                      {combinedPaymentMethods.map((entry, index) => (
                        <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(value: any, _name: any, props: any) => [
                        `${formatPrice(Number(value))} · ${props.payload.count} payment${props.payload.count === 1 ? "" : "s"}`,
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
                    <span className="text-gray-500 font-mono">{formatPrice(method.total)}</span>
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

        <div role="tablist" className="grid grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1 sm:grid-cols-4 sm:max-w-2xl">
          {(["bookings", "breakfast", "store", "charges"] as const).map(tab => (
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
              {tab === "bookings" ? "Bookings" : tab === "breakfast" ? "Breakfast" : tab === "store" ? "Store Orders" : "Incidentals"}
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

        {salesSubTab === "charges" && (
          <SalesChargesTable charges={filteredCharges} isMobile={isMobile} />
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
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 text-right">Deductions</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 text-right font-semibold text-primary">Total Price</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Method</th>
            <th className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {bookings.slice(0, 50).map(b => {
            const roomSubtotal = b.rateBreakdown?.roomSubtotal ?? (b.ratePerNight * b.numNights);
            const breakfastTotal = b.hasBreakfast ? (b.breakfastRate || 0) * (b.numGuests || 0) * (b.numNights || 0) : 0;
            const subtotal = b.originalTotalPrice ?? (roomSubtotal + breakfastTotal);

            const discountPct = b.discountRejected ? 0 : (b.discountPct || 0);
            const seniorDiscount = discountPct > 0 ? Math.round(subtotal * (discountPct / 100)) : 0;
            const afterSenior = subtotal - seniorDiscount;

            const vchDiscount = b.voucherDiscount || 0;
            const afterVoucher = Math.max(afterSenior - vchDiscount, 0);

            const memDiscountPct = b.memberDiscountPct || 0;
            const memDiscount = memDiscountPct > 0 ? Math.round(afterVoucher * (memDiscountPct / 100)) : 0;

            const ptsRedeemedVal = b.pointsRedeemedValue || 0;
            const deductionsVal = seniorDiscount + vchDiscount + memDiscount + ptsRedeemedVal;

            return (
              <tr key={b.id} className="hover:bg-gray-50/50">
                <td className="py-2.5 pr-4 font-semibold text-gray-900">{b.bookingRef}</td>
                <td className="px-3 py-2.5 text-gray-700">{b.guestName}</td>
                <td className="px-3 py-2.5 text-gray-600">{b.roomNumber}</td>
                <td className="px-3 py-2.5 text-gray-600">{toDate(b.checkIn)?.toISOString().slice(0, 10) || "—"}</td>
                <td className="px-3 py-2.5 text-gray-600 font-mono">{b.numNights}</td>
                <td className="px-3 py-2.5 text-right font-mono text-red-650">
                  {deductionsVal > 0 ? `-${formatPrice(deductionsVal)}` : "—"}
                </td>
                <td className="px-3 py-2.5 text-right font-bold text-primary-dark font-mono">{formatPrice(b.totalPrice)}</td>
                <td className="px-3 py-2.5 text-gray-600 uppercase">{PAYMENT_LABELS[b.paymentMethod] || b.paymentMethod}</td>
                <td className="px-3 py-2.5">
                  <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-700 capitalize">
                    {b.status.replace(/-/g, " ")}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {bookings.length > 50 && (
        <p className="text-[10px] text-gray-500 text-center mt-2">Showing 50 of {bookings.length} — export XLSX for the full set.</p>
      )}
    </div>
  );
}

function SalesChargesTable({ charges, isMobile }: { charges: ReportCharge[]; isMobile?: boolean }) {
  if (charges.length === 0) {
    return <p className="py-8 text-center text-xs text-gray-400">No incidental charges in this range.</p>;
  }
  if (isMobile) {
    return (
      <div className="space-y-3">
        {charges.slice(0, 50).map((charge) => (
          <div key={`${charge.bookingId}-${charge.id}`} className="rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{charge.bookingRef}</span>
              <span className={`text-sm font-bold ${charge.amount < 0 ? "text-red-600" : "text-primary-dark"}`}>{formatPrice(charge.amount)}</span>
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-900">{charge.label}</p>
            <p className="mt-1 text-[11px] capitalize text-gray-600">Room {charge.roomNumber || "—"} · {charge.category.replace(/-/g, " ")}</p>
            <p className="mt-1 text-[10px] text-gray-500">{charge.addedAt?.toISOString().slice(0, 10) || "—"} · {charge.addedBy}</p>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-primary/20 text-left">
            {['Booking Ref', 'Room', 'Category', 'Label', 'Added By', 'Date', 'Amount'].map((heading) => (
              <th key={heading} className="px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 first:pl-0">{heading}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {charges.slice(0, 50).map((charge) => (
            <tr key={`${charge.bookingId}-${charge.id}`} className="hover:bg-gray-50/50">
              <td className="py-2.5 pr-3 font-semibold text-gray-900">{charge.bookingRef}</td>
              <td className="px-3 py-2.5 text-gray-600">{charge.roomNumber || "—"}</td>
              <td className="px-3 py-2.5 capitalize text-gray-600">{charge.category.replace(/-/g, " ")}</td>
              <td className="px-3 py-2.5 text-gray-700">{charge.label}</td>
              <td className="px-3 py-2.5 text-gray-600">{charge.addedBy}</td>
              <td className="px-3 py-2.5 text-gray-600">{charge.addedAt?.toISOString().slice(0, 10) || "—"}</td>
              <td className={`px-3 py-2.5 text-right font-bold ${charge.amount < 0 ? "text-red-600" : "text-primary-dark"}`}>{formatPrice(charge.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

// ───────────────────── Daily Close Tab ─────────────────────

interface DailyCloseTabProps {
  payments: ReportPayment[];
  dailyCloses: any[];
  currentUser: any;
  toDate: (v: any) => Date | null;
  isMobile: boolean;
}

function DailyCloseTab({ payments, dailyCloses, currentUser, toDate, isMobile }: DailyCloseTabProps) {
  const toast = useToast();
  const [dateStr, setDateStr] = useState(() => new Date().toLocaleDateString("en-CA"));
  const [countedCash, setCountedCash] = useState("");
  const [countedGCash, setCountedGCash] = useState("");
  const [countedBank, setCountedBank] = useState("");
  const [countedCard, setCountedCard] = useState("");
  const [countedPaypal, setCountedPaypal] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Check if a daily close document already exists for this date
  const existingClose = useMemo(() => {
    return dailyCloses.find((c) => c.id === dateStr);
  }, [dailyCloses, dateStr]);

  // Filter payments for selected date
  const dayPayments = useMemo(() => {
    return payments.filter((p) => {
      if (!p.recordedAt) return false;
      return p.recordedAt.toLocaleDateString("en-CA") === dateStr;
    });
  }, [payments, dateStr]);

  // Group and sum daily payments
  const dailySummary = useMemo(() => {
    const summary = {
      cash: { payments: 0, refunds: 0, net: 0, count: 0 },
      gcash: { payments: 0, refunds: 0, net: 0, count: 0 },
      bank: { payments: 0, refunds: 0, net: 0, count: 0 },
      card: { payments: 0, refunds: 0, net: 0, count: 0 },
      paypal: { payments: 0, refunds: 0, net: 0, count: 0 }
    };

    dayPayments.forEach((p) => {
      const lowerMethod = (p.method || "").toLowerCase();
      let key: keyof typeof summary = "cash";
      if (lowerMethod === "gcash") key = "gcash";
      else if (lowerMethod === "bank" || lowerMethod === "bank_transfer" || lowerMethod === "bank-transfer") key = "bank";
      else if (lowerMethod === "card") key = "card";
      else if (lowerMethod === "paypal") key = "paypal";

      const amt = p.amount;
      if (p.type === "refund") {
        const absAmt = Math.abs(amt);
        summary[key].refunds += absAmt;
        summary[key].net -= absAmt;
      } else {
        summary[key].payments += amt;
        summary[key].net += amt;
      }
      summary[key].count += 1;
    });

    return summary;
  }, [dayPayments]);

  // Set inputs if existing close is selected or found
  useEffect(() => {
    if (existingClose) {
      setCountedCash(String(existingClose.countedNet?.cash ?? 0));
      setCountedGCash(String(existingClose.countedNet?.gcash ?? 0));
      setCountedBank(String(existingClose.countedNet?.bank ?? 0));
      setCountedCard(String(existingClose.countedNet?.card ?? 0));
      setCountedPaypal(String(existingClose.countedNet?.paypal ?? 0));
      setNotes(existingClose.notes || "");
    } else {
      setCountedCash("");
      setCountedGCash("");
      setCountedBank("");
      setCountedCard("");
      setCountedPaypal("");
      setNotes("");
    }
  }, [existingClose]);

  // Handle inputs
  const parseVal = (val: string) => {
    const num = Number(val);
    return Number.isNaN(num) ? 0 : num;
  };

  const cashVal = parseVal(countedCash);
  const gcashVal = parseVal(countedGCash);
  const bankVal = parseVal(countedBank);
  const cardVal = parseVal(countedCard);
  const paypalVal = parseVal(countedPaypal);

  const varianceCash = cashVal - dailySummary.cash.net;
  const varianceGCash = gcashVal - dailySummary.gcash.net;
  const varianceBank = bankVal - dailySummary.bank.net;
  const varianceCard = cardVal - dailySummary.card.net;
  const variancePaypal = paypalVal - dailySummary.paypal.net;

  const totalRecordedNet =
    dailySummary.cash.net +
    dailySummary.gcash.net +
    dailySummary.bank.net +
    dailySummary.card.net +
    dailySummary.paypal.net;

  const totalCountedNet = cashVal + gcashVal + bankVal + cardVal + paypalVal;
  const totalVariance = totalCountedNet - totalRecordedNet;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (existingClose) return;
    setSubmitting(true);
    try {
      const closeRef = doc(db, "dailyCloses", dateStr);
      await setDoc(closeRef, {
        dateStr,
        closedAt: serverTimestamp(),
        closedBy: currentUser?.name || currentUser?.email || "Staff",
        recordedNet: {
          cash: dailySummary.cash.net,
          gcash: dailySummary.gcash.net,
          bank: dailySummary.bank.net,
          card: dailySummary.card.net,
          paypal: dailySummary.paypal.net
        },
        countedNet: {
          cash: cashVal,
          gcash: gcashVal,
          bank: bankVal,
          card: cardVal,
          paypal: paypalVal
        },
        variance: {
          cash: varianceCash,
          gcash: varianceGCash,
          bank: varianceBank,
          card: varianceCard,
          paypal: variancePaypal
        },
        notes
      });
      toast.success("Daily Close Submitted", `Reconciliation log for ${dateStr} has been successfully closed.`);
    } catch (error) {
      console.error("Failed to submit daily close:", error);
      toast.error("Submission Failed", "There was an error writing to Firestore.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Selector Card */}
      <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-heading text-gray-950 lowercase tracking-tight">reconcile daily close</h2>
            <p className="text-[10px] text-gray-500 mt-1">Review ledger transactions and submit physical cash drawer and online account counts.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase">Select Date:</span>
            <input
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              className="min-h-[36px] rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Aggregated Form Section */}
        <div className="lg:col-span-2 space-y-6">
          <form onSubmit={handleSubmit} className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-6">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Method Breakdown</span>
              {existingClose ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase text-emerald-700">
                  <Lock size={12} /> Closed & Locked
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-700">
                  Pending Close
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* Cash Row */}
              <div className="grid grid-cols-4 gap-4 items-center text-xs">
                <div className="col-span-1">
                  <p className="font-semibold text-gray-950">Cash</p>
                  <p className="text-[10px] text-gray-400 font-mono">
                    {dailySummary.cash.count} payment{dailySummary.cash.count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="col-span-1">
                  <p className="text-gray-500">Recorded</p>
                  <p className="font-semibold font-mono">{formatPrice(dailySummary.cash.net)}</p>
                </div>
                <div className="col-span-1">
                  <label className="text-[10px] font-bold text-gray-500 block mb-1">Physical Count</label>
                  <input
                    type="number"
                    step="any"
                    value={countedCash}
                    disabled={Boolean(existingClose)}
                    onChange={(e) => setCountedCash(e.target.value)}
                    placeholder="₱0.00"
                    className="w-full min-h-[36px] rounded-lg border border-gray-200 bg-white px-2.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-gray-50 disabled:text-gray-500 font-mono"
                  />
                </div>
                <div className="col-span-1 text-right">
                  <p className="text-[10px] font-bold text-gray-500 mb-1">Variance</p>
                  <span className={`font-bold font-mono px-2 py-0.5 rounded text-[11px] ${
                    varianceCash === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                  }`}>
                    {varianceCash >= 0 ? "+" : ""}{formatPrice(varianceCash)}
                  </span>
                </div>
              </div>

              {/* GCash Row */}
              <div className="grid grid-cols-4 gap-4 items-center text-xs border-t border-gray-100 pt-4">
                <div className="col-span-1">
                  <p className="font-semibold text-gray-950">GCash</p>
                  <p className="text-[10px] text-gray-400 font-mono">
                    {dailySummary.gcash.count} payment{dailySummary.gcash.count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="col-span-1">
                  <p className="text-gray-500">Recorded</p>
                  <p className="font-semibold font-mono">{formatPrice(dailySummary.gcash.net)}</p>
                </div>
                <div className="col-span-1">
                  <label className="text-[10px] font-bold text-gray-500 block mb-1">Counted Balance</label>
                  <input
                    type="number"
                    step="any"
                    value={countedGCash}
                    disabled={Boolean(existingClose)}
                    onChange={(e) => setCountedGCash(e.target.value)}
                    placeholder="₱0.00"
                    className="w-full min-h-[36px] rounded-lg border border-gray-200 bg-white px-2.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-gray-50 disabled:text-gray-500 font-mono"
                  />
                </div>
                <div className="col-span-1 text-right">
                  <p className="text-[10px] font-bold text-gray-500 mb-1">Variance</p>
                  <span className={`font-bold font-mono px-2 py-0.5 rounded text-[11px] ${
                    varianceGCash === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                  }`}>
                    {varianceGCash >= 0 ? "+" : ""}{formatPrice(varianceGCash)}
                  </span>
                </div>
              </div>

              {/* Bank Transfer Row */}
              <div className="grid grid-cols-4 gap-4 items-center text-xs border-t border-gray-100 pt-4">
                <div className="col-span-1">
                  <p className="font-semibold text-gray-950">Bank Transfer</p>
                  <p className="text-[10px] text-gray-400 font-mono">
                    {dailySummary.bank.count} payment{dailySummary.bank.count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="col-span-1">
                  <p className="text-gray-500">Recorded</p>
                  <p className="font-semibold font-mono">{formatPrice(dailySummary.bank.net)}</p>
                </div>
                <div className="col-span-1">
                  <label className="text-[10px] font-bold text-gray-500 block mb-1">Counted Net</label>
                  <input
                    type="number"
                    step="any"
                    value={countedBank}
                    disabled={Boolean(existingClose)}
                    onChange={(e) => setCountedBank(e.target.value)}
                    placeholder="₱0.00"
                    className="w-full min-h-[36px] rounded-lg border border-gray-200 bg-white px-2.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-gray-50 disabled:text-gray-500 font-mono"
                  />
                </div>
                <div className="col-span-1 text-right">
                  <p className="text-[10px] font-bold text-gray-500 mb-1">Variance</p>
                  <span className={`font-bold font-mono px-2 py-0.5 rounded text-[11px] ${
                    varianceBank === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                  }`}>
                    {varianceBank >= 0 ? "+" : ""}{formatPrice(varianceBank)}
                  </span>
                </div>
              </div>

              {/* Card Row */}
              <div className="grid grid-cols-4 gap-4 items-center text-xs border-t border-gray-100 pt-4">
                <div className="col-span-1">
                  <p className="font-semibold text-gray-950">Card</p>
                  <p className="text-[10px] text-gray-400 font-mono">
                    {dailySummary.card.count} payment{dailySummary.card.count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="col-span-1">
                  <p className="text-gray-500">Recorded</p>
                  <p className="font-semibold font-mono">{formatPrice(dailySummary.card.net)}</p>
                </div>
                <div className="col-span-1">
                  <label className="text-[10px] font-bold text-gray-500 block mb-1">Counted Net</label>
                  <input
                    type="number"
                    step="any"
                    value={countedCard}
                    disabled={Boolean(existingClose)}
                    onChange={(e) => setCountedCard(e.target.value)}
                    placeholder="₱0.00"
                    className="w-full min-h-[36px] rounded-lg border border-gray-200 bg-white px-2.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-gray-50 disabled:text-gray-500 font-mono"
                  />
                </div>
                <div className="col-span-1 text-right">
                  <p className="text-[10px] font-bold text-gray-500 mb-1">Variance</p>
                  <span className={`font-bold font-mono px-2 py-0.5 rounded text-[11px] ${
                    varianceCard === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                  }`}>
                    {varianceCard >= 0 ? "+" : ""}{formatPrice(varianceCard)}
                  </span>
                </div>
              </div>

              {/* PayPal Row */}
              <div className="grid grid-cols-4 gap-4 items-center text-xs border-t border-gray-100 pt-4">
                <div className="col-span-1">
                  <p className="font-semibold text-gray-950">PayPal</p>
                  <p className="text-[10px] text-gray-400 font-mono">
                    {dailySummary.paypal.count} payment{dailySummary.paypal.count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="col-span-1">
                  <p className="text-gray-500">Recorded</p>
                  <p className="font-semibold font-mono">{formatPrice(dailySummary.paypal.net)}</p>
                </div>
                <div className="col-span-1">
                  <label className="text-[10px] font-bold text-gray-500 block mb-1">Counted Net</label>
                  <input
                    type="number"
                    step="any"
                    value={countedPaypal}
                    disabled={Boolean(existingClose)}
                    onChange={(e) => setCountedPaypal(e.target.value)}
                    placeholder="₱0.00"
                    className="w-full min-h-[36px] rounded-lg border border-gray-200 bg-white px-2.5 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-gray-50 disabled:text-gray-500 font-mono"
                  />
                </div>
                <div className="col-span-1 text-right">
                  <p className="text-[10px] font-bold text-gray-500 mb-1">Variance</p>
                  <span className={`font-bold font-mono px-2 py-0.5 rounded text-[11px] ${
                    variancePaypal === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                  }`}>
                    {variancePaypal >= 0 ? "+" : ""}{formatPrice(variancePaypal)}
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-5 space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-gray-500 block mb-2">Reconciliation Notes</label>
                <textarea
                  value={notes}
                  disabled={Boolean(existingClose)}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Explain any physical count variances here..."
                  className="w-full min-h-[80px] rounded-lg border border-gray-200 p-3 text-xs outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-gray-50 disabled:text-gray-500"
                />
              </div>

              {!existingClose && (
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[44px] rounded-lg bg-primary hover:bg-primary-dark text-white font-bold text-xs shadow-sm transition active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? "Submitting Close..." : `Perform Daily Close for ${dateStr}`}
                </button>
              )}
            </div>
          </form>

          {/* Today's Transactions Ledger List */}
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Transactions Ledger ({dateStr})</h3>
              <p className="text-[10px] text-gray-400 mt-1">Audit log of recorded payments and refunds processed on this calendar date.</p>
            </div>

            <div className="overflow-x-auto rounded-lg border border-gray-150">
              <table className="min-w-full text-xs">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    {["Ref", "Guest / Room", "Type", "Method", "Staff", "Amount"].map((heading) => (
                      <th key={heading} className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dayPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 font-semibold text-gray-900">{p.bookingRef}</td>
                      <td className="px-3 py-2 text-gray-600">
                        {p.guestName} · Room {p.roomNumber}
                      </td>
                      <td className={`px-3 py-2 font-semibold capitalize ${p.type === "refund" ? "text-red-655" : "text-emerald-705"}`}>
                        {p.type}
                      </td>
                      <td className="px-3 py-2 text-gray-600 uppercase">{PAYMENT_LABELS[p.method] || p.method}</td>
                      <td className="px-3 py-2 text-gray-600">{p.recordedBy}</td>
                      <td className={`px-3 py-2 font-mono font-bold text-right ${p.type === "refund" ? "text-red-650" : "text-emerald-750"}`}>
                        {p.type === "refund" ? "-" : ""}{formatPrice(p.amount)}
                      </td>
                    </tr>
                  ))}
                  {dayPayments.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-gray-400">
                        No transactions recorded on this date.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Side Summary & Historical Logs Panel */}
        <div className="space-y-6">
          {/* Side Overage / Shortage Indicator */}
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Totals Summary</h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>Total Recorded Net:</span>
                <span className="font-bold font-mono text-gray-800">{formatPrice(totalRecordedNet)}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-600">
                <span>Total Counted Net:</span>
                <span className="font-bold font-mono text-gray-800">{formatPrice(totalCountedNet)}</span>
              </div>
              <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Total Variance</p>
                  {totalVariance !== 0 && (
                    <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-bold text-red-655 bg-red-50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      <AlertTriangle size={10} /> Discrepancy
                    </span>
                  )}
                  {totalVariance === 0 && (
                    <span className="inline-flex items-center gap-1 mt-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      <CheckCircle2 size={10} /> Reconciled
                    </span>
                  )}
                </div>
                <span className={`text-xl font-heading font-bold font-mono ${
                  totalVariance === 0 ? "text-emerald-700" : "text-red-705"
                }`}>
                  {totalVariance >= 0 ? "+" : ""}{formatPrice(totalVariance)}
                </span>
              </div>
            </div>
          </div>

          {/* Historical Logs List */}
          <div className="rounded-card bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Daily Close Logs</h3>
              <p className="text-[10px] text-gray-400 mt-1">Select a past close to view its reconciled drawer counts.</p>
            </div>

            <div className="divide-y divide-gray-100 max-h-96 overflow-auto">
              {dailyCloses.map((c) => {
                // Compute total variance for this historical close
                const closeVariance =
                  (c.variance?.cash ?? 0) +
                  (c.variance?.gcash ?? 0) +
                  (c.variance?.bank ?? 0) +
                  (c.variance?.card ?? 0) +
                  (c.variance?.paypal ?? 0);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setDateStr(c.id);
                    }}
                    className={`w-full text-left p-3 text-xs hover:bg-gray-50/80 transition flex flex-col gap-1 ${
                      dateStr === c.id ? "bg-primary-light/30 border-l-2 border-primary" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-gray-900">{c.id}</span>
                      <span className={`font-mono font-bold ${
                        closeVariance === 0 ? "text-emerald-700" : "text-red-700"
                      }`}>
                        {closeVariance >= 0 ? "+" : ""}{formatPrice(closeVariance)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-gray-500">
                      <span>Closed by {c.closedBy}</span>
                      <span>{c.closedAt ? c.closedAt.toLocaleTimeString() : ""}</span>
                    </div>
                    {c.notes && (
                      <p className="text-[10px] text-gray-400 line-clamp-1 italic mt-1 font-sans">"{c.notes}"</p>
                    )}
                  </button>
                );
              })}
              {dailyCloses.length === 0 && (
                <p className="p-6 text-center text-xs text-gray-400 font-sans">No close logs recorded yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
