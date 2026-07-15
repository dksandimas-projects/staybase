import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAdmin, Booking, OnsitePayment, IncidentalCharge, IncidentalChargeCategory } from "../context/AdminContext";
import { calculateSeasonalAwareRoomTotal, compressImageFile, getCheckInReadiness, getManilaDateInfo, getLockedManualNightlyRate, type BookingRateBreakdown, type PaymentMethodConfig, calculateSeasonalAwareRoomBreakdown, calculateVoucherDiscount, DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT } from "@spark-inn/shared";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { PrimaryButton } from "../components/PrimaryButton";
import { ConfirmForm } from "../components/ConfirmForm";
import { useToast } from "../components/Toast";
import { useTwoClickConfirm } from "../utils/useTwoClickConfirm";
import { formatPrice } from "../utils/format";
import {
  Calendar,
  User,
  Phone,
  Mail,
  Plus,
  Eye,
  ShoppingBag,
  Package,
  CreditCard,
  ClipboardCheck,
  FileText,
  ImageIcon,
  Utensils,
  Save,
  ShieldCheck,
  BedDouble,
  MoreVertical,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Move,
  Info
} from "lucide-react";

const RESCHEDULABLE_STATUSES = ["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"];

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.toDate && typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string") return new Date(value);
  if (value.seconds) return new Date(value.seconds * 1000);
  return null;
}

function estimateNewTotalPrice(
  booking: Booking,
  targetRoomType: string,
  checkInStr: string,
  checkOutStr: string,
  roomTypes: any[],
  seasonalRateOverrides: any[],
  corporateCodes: any[],
  rewardsConfig: any,
  breakfastConfig: any,
  vouchers: any[]
): number {
  const typeEntry = roomTypes.find(t => t.value === targetRoomType);
  if (!typeEntry) return 0;
  
  let baseRate = typeEntry.pricePerNight || 0;
  let weekendRate = typeEntry.weekendRate || 0;

  if (booking.isCorporate) {
    let typeCorporateRate = typeEntry.corporateRate || 0;
    baseRate = typeCorporateRate > 0 ? typeCorporateRate : baseRate;

    if (booking.corporateCode) {
      const corpData = corporateCodes.find(c => c.code === booking.corporateCode);
      if (corpData && corpData.ratePerRoomType?.[targetRoomType]) {
        baseRate = corpData.ratePerRoomType[targetRoomType];
      }
    }
  }

  const checkInDate = new Date(`${checkInStr}T00:00:00Z`);
  const checkOutDate = new Date(`${checkOutStr}T00:00:00Z`);
  const numNights = Math.max(Math.round((checkOutDate.getTime() - checkInDate.getTime()) / 86400000), 0);
  const manualNightlyRate = getLockedManualNightlyRate(booking.rateBreakdown);

  const roomBreakdown = manualNightlyRate !== null
    ? { roomSubtotal: Math.round(manualNightlyRate * numNights) }
    : booking.isCorporate
    ? {
        roomSubtotal: baseRate * numNights,
      }
    : calculateSeasonalAwareRoomBreakdown({
        checkIn: checkInDate,
        checkOut: checkOutDate,
        roomType: targetRoomType,
        baseRate,
        weekendRate: weekendRate || baseRate,
        seasonalRateOverrides
      });

  const roomTotal = roomBreakdown.roomSubtotal;

  const bRate = booking.breakfastRate || breakfastConfig?.ratePerPersonPerNight || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT;
  const breakfastTotal = manualNightlyRate === null && booking.hasBreakfast ? bRate * booking.numGuests * numNights : 0;
  const subtotal = roomTotal + breakfastTotal;

  let discountPct = booking.discountPct || 0;
  const seniorPwdDiscount = Math.round(subtotal * (discountPct / 100));
  const afterSeniorPwd = subtotal - seniorPwdDiscount;

  let voucherDiscount = 0;
  if (booking.voucherCode) {
    const voucherData = vouchers.find(v => v.code === booking.voucherCode);
    if (voucherData) {
      const vBase = Math.max(subtotal - seniorPwdDiscount, 0);
      voucherDiscount = Math.round(calculateVoucherDiscount({
        discountType: voucherData.discountType === "percent" ? "percent" : "flat",
        discountValue: Number(voucherData.discountValue) || 0
      }, vBase));
    } else {
      voucherDiscount = booking.voucherDiscount || 0;
    }
  }

  const afterVoucher = afterSeniorPwd - voucherDiscount;

  let memberDiscountPct = booking.memberDiscountPct || 0;
  if (booking.memberId && rewardsConfig?.memberDiscountEnabled !== false) {
    memberDiscountPct = Number(rewardsConfig?.memberDiscountPct) || 0;
  }
  const memberDiscount = Math.round(afterVoucher * (memberDiscountPct / 100));
  const totalPrice = Math.max(afterVoucher - memberDiscount, 0);
  const finalTotalPrice = Math.max(totalPrice - (booking.pointsRedeemedValue || 0), 0);

  return finalTotalPrice;
}
import config from "@config";
import { jsPDF } from "jspdf";
import { addDoc, collection, doc, onSnapshot, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { db, storage } from "../firebase/config";
import { auth } from "../firebase/auth";

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized;
  const value = Number.parseInt(expanded, 16);
  if (Number.isNaN(value)) return [0, 0, 0];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

// Mirrors the guest picker in RewardsPage and the server-side
// confirmedTime whitelist in handleResolveEarlyCheckin — the approve
// form must only ever submit one of these values.
const EARLY_CHECKIN_TIME_OPTIONS = ["08:00 AM", "09:00 AM", "10:00 AM", "11:00 AM", "12:00 PM", "01:00 PM"];
const EARLY_CHECKIN_DEFAULT_TIME = "11:00 AM";
// Methods that are not a real settlement tender for an onsite payment/refund:
// store-only rails (cod, add-to-bill) and "pay-at-hotel", which is a
// booking-time *intent*, not how the guest actually paid. Excluding
// pay-at-hotel forces staff to record the true tender (Cash, GCash, …) so the
// Daily Close reconciliation isn't polluted by ambiguous entries.
const NON_TENDER_ONSITE_PAYMENT_METHODS = new Set(["cod", "add-to-bill", "pay-at-hotel"]);
// Cash must always be recordable at the desk even if the hotel never added a
// Cash method under Settings → Payment Methods (it is intentionally kept out
// of the guest-facing paymentMethods config so it can't be offered online).
const CASH_ONSITE_PAYMENT_METHOD: PaymentMethodConfig = { method: "cash", label: "Cash", accountName: "", accountNumber: "", qrUrl: "", isEnabled: true };
const LEGACY_ONSITE_PAYMENT_METHOD_OPTIONS: PaymentMethodConfig[] = [
  CASH_ONSITE_PAYMENT_METHOD,
  { method: "card", label: "Credit Card", accountName: "", accountNumber: "", qrUrl: "", isEnabled: true },
  { method: "gcash", label: "GCash Transfer", accountName: "", accountNumber: "", qrUrl: "", isEnabled: true }
];
const LEGACY_ONSITE_PAYMENT_METHOD_LABELS = LEGACY_ONSITE_PAYMENT_METHOD_OPTIONS.reduce<Record<string, string>>((acc, option) => {
  acc[option.method] = option.label;
  return acc;
}, {});

async function registerBrandPdfFonts(pdf: jsPDF) {
  pdf.setFont("helvetica", "normal");
  await Promise.resolve();
}

function setPdfFont(pdf: jsPDF, family: "Apollo" | "Inter" | "helvetica") {
  pdf.setFont(family === "helvetica" ? "helvetica" : "helvetica", "normal");
}

function getJsPdfImageFormat(dataUrl: string, blobType = "") {
  const mimeType = dataUrl.match(/^data:([^;]+);/)?.[1] || blobType;
  if (mimeType.includes("png")) return "PNG";
  if (mimeType.includes("webp")) return "WEBP";
  return "JPEG";
}

async function imageUrlToDataUrl(url: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  return await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

async function getPdfBrandLogoDataUrl() {
  try {
    return await imageUrlToDataUrl(`/brand/${config.logos.navbar}`);
  } catch {
    return "";
  }
}

function drawPdfBrandHeader(
  pdf: jsPDF,
  options: {
    logoDataUrl: string;
    title: string;
    subtitle?: string;
    meta?: string;
    brandRgb: [number, number, number];
    printLight?: boolean;
    compact?: boolean;
  }
) {
  const pageW = 210;
  const marginL = 15;
  const marginR = pageW - 15;
  const headerY = options.compact ? 8 : 12;
  const headerH = options.compact ? 25 : 32;
  const sidebarRgb = hexToRgb(config.colors.sidebar);

  pdf.setFillColor(...(options.printLight ? [255, 255, 255] as [number, number, number] : sidebarRgb));
  pdf.rect(0, 0, pageW, headerH, "F");
  pdf.setFillColor(...options.brandRgb);
  pdf.rect(0, headerH - 2, pageW, 2, "F");

  if (options.logoDataUrl) {
    pdf.addImage(
      options.logoDataUrl,
      getJsPdfImageFormat(options.logoDataUrl, "image/png"),
      marginL,
      headerY,
      options.compact ? 40 : 48,
      options.compact ? 10.5 : 12.5
    );
  } else {
    setPdfFont(pdf, "Inter");
    pdf.setFontSize(options.compact ? 11 : 13);
    pdf.setTextColor(...(options.printLight ? [30, 30, 30] as [number, number, number] : [255, 255, 255] as [number, number, number]));
    pdf.text(config.brandName, marginL, headerY + 8);
  }

  setPdfFont(pdf, "Inter");
  pdf.setFontSize(options.compact ? 13 : 16);
  pdf.setTextColor(...(options.printLight ? [30, 30, 30] as [number, number, number] : [255, 255, 255] as [number, number, number]));
  pdf.text(options.title, marginR, headerY + (options.compact ? 1 : 3), { align: "right" });

  pdf.setFontSize(options.compact ? 6.8 : 8);
  pdf.setTextColor(...(options.printLight ? [70, 70, 70] as [number, number, number] : [220, 226, 235] as [number, number, number]));
  if (options.subtitle) {
    pdf.text(options.subtitle, marginR, headerY + (options.compact ? 7 : 9), { align: "right" });
  }
  if (options.meta) {
    pdf.text(options.meta, marginR, headerY + (options.compact ? 12 : 14), { align: "right" });
  }

  return headerH + (options.compact ? 7 : 10);
}

function drawPdfSectionTitle(pdf: jsPDF, title: string, x: number, y: number, brandRgb: [number, number, number]) {
  pdf.setFillColor(254, 243, 226);
  pdf.roundedRect(x, y - 5, 3, 5, 1, 1, "F");
  pdf.setFontSize(12);
  pdf.setTextColor(30, 30, 30);
  pdf.text(title, x + 6, y, { charSpace: 0 });
  pdf.setDrawColor(230, 230, 230);
  pdf.setLineWidth(0.15);
  pdf.line(x + 6 + pdf.getTextWidth(title) + 4, y - 1.5, 195, y - 1.5);
  pdf.setDrawColor(...brandRgb);
}

function drawPdfFooter(
  pdf: jsPDF,
  bookingRef: string,
  footerNote: string,
  brandRgb: [number, number, number],
  footerY = 278
) {
  const pageW = 210;
  pdf.setDrawColor(...brandRgb);
  pdf.setLineWidth(0.35);
  pdf.line(15, footerY, 195, footerY);
  pdf.setFontSize(7.5);
  pdf.setTextColor(100, 100, 100);
  pdf.text(footerNote, pageW / 2, footerY + 5, { align: "center", charSpace: 0 });
  pdf.setFontSize(7);
  pdf.setTextColor(150, 150, 150);
  pdf.text(
    `${config.brandName} | ${config.address?.street ?? ""}${config.address?.street ? ", " : ""}${config.address?.city ?? ""} | ${config.frontDeskPhone ?? ""} | ${config.supportEmail ?? ""}`,
    pageW / 2,
    footerY + 9,
    { align: "center", charSpace: 0 }
  );
  pdf.text(`Booking Ref: ${bookingRef}`, pageW / 2, footerY + 13, { align: "center", charSpace: 0 });
}

function openPdfOrDownload(pdf: jsPDF, fileName: string, pdfWindow: Window | null) {
  const blob = pdf.output("blob");
  const url = URL.createObjectURL(blob);
  if (pdfWindow) {
    pdfWindow.location.href = url;
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return "opened";
  }
  pdf.save(fileName);
  URL.revokeObjectURL(url);
  return "downloaded";
}

function AdminPriceBreakdown({ breakdown, total }: { breakdown?: BookingRateBreakdown | null; total: number }) {
  if (!breakdown?.roomLines?.length) return null;
  return (
    <div className="space-y-2">
      {breakdown.roomLines.map((line, index) => (
        <div key={`${line.source}-${line.startDate}-${index}`} className="flex justify-between text-gray-600">
          <span>{line.label} ({line.nights} x {formatPrice(line.nightlyRate)})</span>
          <span>{formatPrice(line.subtotal)}</span>
        </div>
      ))}
      {breakdown.addOns.map((line, index) => (
        <div key={`add-on-${index}`} className="flex justify-between text-gray-500">
          <span>{line.label}</span>
          <span>{formatPrice(line.amount)}</span>
        </div>
      ))}
      {breakdown.deductions.map((line, index) => (
        <div key={`deduction-${index}`} className="flex justify-between text-status-red-text">
          <span>{line.label}</span>
          <span>-{formatPrice(line.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-gray-150 pt-2.5 text-sm font-bold text-gray-950">
        <span>Total Bill Amount:</span>
        <span className="text-primary-dark">{formatPrice(breakdown.finalTotal || total)}</span>
      </div>
    </div>
  );
}

export function BookingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { 
    bookings, 
    rooms, 
    updateBookingStatus, 
    resolveEarlyCheckin,
    addOnsitePayment, 
    addWalkinBooking,
    resendBookingEmail,
    storeOrders,
    updateStoreOrderStatus,
    billStoreOrder,
    roomTypes,
    seasonalRateOverrides,
    breakfastConfig,
    websiteContent,
    rewardsConfig,
    members,
    rescheduleBooking,
    vouchers,
    corporateCodes,
    paymentMethods,
    currentUser
  } = useAdmin();
  const toast = useToast();
  const discountApproveConfirm = useTwoClickConfirm<"approve">();
  const checkoutWithBalanceConfirm = useTwoClickConfirm<"confirm">();
  const brandRgb = hexToRgb(config.colors.primary);
  const getApiBaseUrl = () => {
    if (typeof window === "undefined") return "";
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1") return "http://localhost:3000";
    return import.meta.env.VITE_GUEST_APP_URL || `https://www.${config.domain}`;
  };

  const [showDiscountRejectForm, setShowDiscountRejectForm] = useState(false);
  const [showBookingCancelForm, setShowBookingCancelForm] = useState(false);
  const [showOrderCancelForm, setShowOrderCancelForm] = useState(false);
  const [chargeToVoid, setChargeToVoid] = useState<IncidentalCharge | null>(null);

  const [earlyCheckInAction, setEarlyCheckInAction] = useState<"approve" | "decline" | null>(null);
  const [earlyCheckInTimeOverride, setEarlyCheckInTimeOverride] = useState<string>("");
  const [earlyCheckInStaffNote, setEarlyCheckInStaffNote] = useState<string>("");
  const [isResolvingEarlyCheckIn, setIsResolvingEarlyCheckIn] = useState(false);

  const [resendingEmailAction, setResendingEmailAction] = useState<string | null>(null);

  const handleResendEmail = async (action: string) => {
    if (!selectedBooking) return;
    setResendingEmailAction(action);
    try {
      const res = await resendBookingEmail(selectedBooking.id, action);
      if (res.success) {
        toast.success("Email sent successfully", `Resent ${action} email template to ${selectedBooking.guestEmail}`);
      } else {
        toast.error("Failed to send email", res.error || "Please try again.");
      }
    } catch (err: any) {
      toast.error("Failed to send email", err.message || "Please try again.");
    } finally {
      setResendingEmailAction(null);
    }
  };

  // Main navigation tab
  const [activeMainTab, setActiveMainTab] = useState<"bookings" | "store">(
    searchParams.get("tab") === "store" ? "store" : "bookings"
  );

  // Booking Search and Filter States
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Booking Drawer States
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Store Order Search and Filter States
  const [orderSearchText, setOrderSearchText] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (searchParams.get("tab") !== "store") return;

    setActiveMainTab("store");
    const orderRef = searchParams.get("orderRef");
    if (orderRef) {
      setOrderSearchText(orderRef);
    }
    // Per Phase 12 — Notification Center (decision #120):
    // bell deep-links with `?orderId=...` to open the
    // matching store order drawer on the Store tab.
    const orderId = searchParams.get("orderId");
    if (orderId) {
      const match = storeOrders.find((order) => order.id === orderId);
      if (match) {
        setSelectedOrder(match);
        setIsOrderDrawerOpen(true);
      }
    }
  }, [searchParams, storeOrders]);

  useEffect(() => {
    const bookingId = searchParams.get("bookingId");
    if (!bookingId) return;
    const match = bookings.find((booking) => booking.id === bookingId);
    if (!match) return;
    setActiveMainTab("bookings");
    setSelectedBooking(match);
    setIsDrawerOpen(true);
  }, [searchParams, bookings]);

  // Store Order Drawer States
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isOrderDrawerOpen, setIsOrderDrawerOpen] = useState(false);

  // Payment Form States
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNote, setPaymentNote] = useState("");
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
  const paymentSubmissionIdRef = useRef<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [refundReason, setRefundReason] = useState("");
  const [isRefunding, setIsRefunding] = useState(false);
  const [guestIdUploadStatus, setGuestIdUploadStatus] = useState("");
  const [imagePreview, setImagePreview] = useState<{ title: string; url: string } | null>(null);
  const [redeemPointsInput, setRedeemPointsInput] = useState("");
  const [isRedeemingPoints, setIsRedeemingPoints] = useState(false);

  // Move Form States
  const [showMoveForm, setShowMoveForm] = useState(false);
  const [moveRoomId, setMoveRoomId] = useState("");
  const [moveCheckIn, setMoveCheckIn] = useState("");
  const [moveCheckOut, setMoveCheckOut] = useState("");
  const [moveReason, setMoveReason] = useState("");
  const [moveIsSubmitting, setMoveIsSubmitting] = useState(false);

  // Sync Move states when selectedBooking changes
  useEffect(() => {
    if (selectedBooking) {
      setMoveRoomId(selectedBooking.roomId || "");
      const checkInDate = toDate(selectedBooking.checkIn);
      const checkOutDate = toDate(selectedBooking.checkOut);
      setMoveCheckIn(checkInDate ? checkInDate.toISOString().slice(0, 10) : "");
      setMoveCheckOut(checkOutDate ? checkOutDate.toISOString().slice(0, 10) : "");
      setMoveReason("");
      setShowMoveForm(false);
    }
  }, [selectedBooking]);

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Walk-in Form States
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [roomType, setRoomType] = useState<string>(() => roomTypes[0]?.value || "");

  // Sync default roomType when roomTypes load
  useEffect(() => {
    if (!roomType && roomTypes.length > 0) {
      setRoomType(roomTypes[0].value);
    }
  }, [roomTypes]);
  const [roomNumber, setRoomNumber] = useState("");
  const [checkInDate, setCheckInDate] = useState(() => getManilaDateInfo(config.timezone).todayStr);
  const [checkOutDate, setCheckOutDate] = useState(() => {
    const tomorrow = getManilaDateInfo(config.timezone).manilaDate;
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateInput(tomorrow);
  });
  const [numGuests, setNumGuests] = useState(1);
  const [walkinPayment, setWalkinPayment] = useState("pay-at-hotel");
  const [hasBreakfast, setHasBreakfast] = useState(false);
  const [immediateCheckIn, setImmediateCheckIn] = useState(false);
  const [priceOverride, setPriceOverride] = useState("");
  const [walkinDiscountType, setWalkinDiscountType] = useState<"" | "senior" | "pwd">("");
  const [walkinVoucherCode, setWalkinVoucherCode] = useState("");
  const [staffDiscountType, setStaffDiscountType] = useState<"" | "senior" | "pwd">("");
  const [staffVoucherCode, setStaffVoucherCode] = useState("");
  const [isApplyingStaffDiscount, setIsApplyingStaffDiscount] = useState(false);

  const onsitePaymentMethodOptions = useMemo(() => {
    const configured = paymentMethods.filter((method) => {
      const key = method.method.trim();
      return key && !NON_TENDER_ONSITE_PAYMENT_METHODS.has(key);
    });
    const base = configured.length > 0 ? configured : LEGACY_ONSITE_PAYMENT_METHOD_OPTIONS;
    // Guarantee Cash is always selectable as an onsite tender.
    const hasCash = base.some((method) => method.method.trim().toLowerCase() === "cash");
    return hasCash ? base : [CASH_ONSITE_PAYMENT_METHOD, ...base];
  }, [paymentMethods]);

  const onsitePaymentMethodLabels = useMemo(() => {
    return onsitePaymentMethodOptions.reduce<Record<string, string>>((acc, method) => {
      acc[method.method] = method.label || method.method;
      return acc;
    }, { ...LEGACY_ONSITE_PAYMENT_METHOD_LABELS });
  }, [onsitePaymentMethodOptions]);

  const getOnsitePaymentMethodLabel = (method: string) => {
    return onsitePaymentMethodLabels[method] || method;
  };

  useEffect(() => {
    if (onsitePaymentMethodOptions.length === 0) return;
    if (onsitePaymentMethodOptions.some((method) => method.method === paymentMethod)) return;
    setPaymentMethod(onsitePaymentMethodOptions[0].method);
  }, [onsitePaymentMethodOptions, paymentMethod]);

  const [selectedBookingPayments, setSelectedBookingPayments] = useState<OnsitePayment[]>([]);
  const [selectedBookingCharges, setSelectedBookingCharges] = useState<IncidentalCharge[]>([]);
  const [chargeCategory, setChargeCategory] = useState<IncidentalChargeCategory>("other");
  const [chargeLabel, setChargeLabel] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeNote, setChargeNote] = useState("");
  const [isSavingCharge, setIsSavingCharge] = useState(false);

  useEffect(() => {
    if (!selectedBooking?.id) {
      setSelectedBookingPayments([]);
      return;
    }

    const paymentsRef = collection(db, "bookings", selectedBooking.id, "payments");
    const unsubscribe = onSnapshot(paymentsRef, (snapshot) => {
      const paymentsData: OnsitePayment[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        paymentsData.push({
          id: docSnap.id,
          type: data.type === "refund" || Number(data.amount || 0) < 0 ? "refund" : "payment",
          amount: data.amount || 0,
          method: data.method || "",
          note: data.note || "",
          reason: data.reason || null,
          approvedBy: data.approvedBy || null,
          recordedBy: data.recordedBy || "staff",
          recordedAt: data.recordedAt instanceof Date
            ? data.recordedAt.toISOString()
            : data.recordedAt?.toDate
              ? data.recordedAt.toDate().toISOString()
              : data.recordedAt || ""
        });
      });
      paymentsData.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      setSelectedBookingPayments(paymentsData);
    }, (error) => {
      console.error("Error listening to payments subcollection:", error);
    });

    return unsubscribe;
  }, [selectedBooking?.id]);

  useEffect(() => {
    if (!selectedBooking?.id) {
      setSelectedBookingCharges([]);
      return;
    }
    const chargesRef = collection(db, "bookings", selectedBooking.id, "charges");
    const unsubscribe = onSnapshot(chargesRef, (snapshot) => {
      const charges = snapshot.docs.map((chargeDoc) => {
        const data = chargeDoc.data();
        const addedAt = data.addedAt?.toDate ? data.addedAt.toDate().toISOString() : String(data.addedAt || "");
        return {
          id: chargeDoc.id,
          label: String(data.label || "Incidental charge"),
          amount: Number(data.amount || 0),
          category: (data.category || "other") as IncidentalChargeCategory,
          note: String(data.note || ""),
          addedBy: String(data.addedBy || "staff"),
          addedAt,
          voidOf: data.voidOf ? String(data.voidOf) : null
        };
      }).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
      setSelectedBookingCharges(charges);
    }, (error) => {
      console.error("Error listening to charges subcollection:", error);
      toast.error("Could not load incidental charges", "Refresh the booking drawer and try again.");
    });
    return unsubscribe;
  }, [selectedBooking?.id, toast]);

  // Filter available rooms based on type selected
  const availableRoomsOfType = rooms.filter(
    r => r.type === roomType && r.status === "available"
  );

  // Calculate rate per night for the selected room number — per W3.6
  // the rate lives on the room's type, not the room itself.
  const selectedRoomDetails = rooms.find(r => r.roomNumber === roomNumber);
  const selectedRoomType = roomTypes.find(t => t.value === selectedRoomDetails?.type);
  const ratePerNight = selectedRoomType?.pricePerNight || 0;
  const roomChargeTotal = selectedRoomType
    ? calculateSeasonalAwareRoomTotal({
        checkIn: `${checkInDate}T00:00:00Z`,
        checkOut: `${checkOutDate}T00:00:00Z`,
        roomType: selectedRoomType.value,
        baseRate: selectedRoomType.pricePerNight,
        weekendRate: selectedRoomType.weekendRate,
        seasonalRateOverrides
      })
    : 0;
  
  // Calculate nights
  const getNumNights = () => {
    if (!checkInDate || !checkOutDate) return 1;
    const start = new Date(checkInDate);
    const end = new Date(checkOutDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  };
  const numNights = getNumNights();
  const brekkieRate = breakfastConfig.ratePerPersonPerNight || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT;
  const totalPrice = roomChargeTotal + (hasBreakfast ? brekkieRate * numGuests * numNights : 0);

  // Table Columns Setup
  const columns: Array<DataTableColumn<Booking>> = [
    { key: "bookingRef", header: "Reference" },
    { key: "guestName", header: "Guest" },
    {
      key: "roomNumber",
      header: "Room",
      render: (row) => (
        <span>
          Room {row.roomNumber} ({row.roomType.replace("-", " ")})
        </span>
      )
    },
    {
      key: "checkIn",
      header: "Dates",
      render: (row) => (
        <span className="text-xs">
          {row.checkIn} to {row.checkOut} ({row.numNights} nights)
        </span>
      )
    },
    {
      key: "totalPrice",
      header: "Total",
      align: "end",
      render: (row) => <strong className="font-bold">{formatPrice(row.totalPrice)}</strong>
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <StatusBadge label={row.status.replace("-", " ")} status={row.status} />
          {row.earlyCheckIn?.status === "requested" && (
            <span
              title="Early check-in pending review"
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-amber-200"
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500" />
              </span>
              ECK
            </span>
          )}
          {row.earlyCheckIn?.status === "approved" && (
            <span
              title="Early check-in approved"
              className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 ring-1 ring-emerald-200"
            >
              <CheckCircle2 size={9} />
              ECK
            </span>
          )}
        </div>
      )
    },
    {
      key: "action",
      header: "Actions",
      align: "end",
      render: (row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedBooking(row);
            setIsDrawerOpen(true);
          }}
          className="min-h-[36px] px-3.5 inline-flex items-center gap-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 transition"
        >
          <Eye size={12} />
          Details
        </button>
      )
    }
  ];

  // Operational filter — driven by the bottom tab bar via ?filter=...
  // arrivals   = today's check-ins with status confirmed or checked-in
  // departures = today's check-outs with status checked-in (per the
  //              confirmed -> checked-in -> checked-out status flow)
  // in-house   = status === "checked-in"
  const operationalFilter = searchParams.get("filter");
  const today = getManilaDateInfo(config.timezone).todayStr;
  const matchesOperationalFilter = (booking: Booking) => {
    if (!operationalFilter) return true;
    if (operationalFilter === "arrivals") {
      return booking.checkIn === today && (booking.status === "confirmed" || booking.status === "checked-in");
    }
    if (operationalFilter === "departures") {
      return booking.checkOut === today && booking.status === "checked-in";
    }
    if (operationalFilter === "in-house") {
      return booking.status === "checked-in";
    }
    return true;
  };

  const filterLabels: Record<string, string> = {
    arrivals: "Today's arrivals",
    departures: "Today's departures",
    "in-house": "Currently in-house"
  };
  const activeFilterLabel = operationalFilter ? filterLabels[operationalFilter] : null;

  // Filtering Rows logic
  const filteredRows = bookings.filter((booking) => {
    const matchesSearch =
      booking.guestName.toLowerCase().includes(searchText.toLowerCase()) ||
      booking.bookingRef.toLowerCase().includes(searchText.toLowerCase()) ||
      booking.roomNumber.includes(searchText);

    const matchesStatus = statusFilter === "all" || booking.status === statusFilter;
    const matchesFilter = matchesOperationalFilter(booking);

    return matchesSearch && matchesStatus && matchesFilter;
  });

  const handleRowClick = (row: Booking) => {
    setSelectedBooking(row);
    setIsDrawerOpen(true);
  };

  // Store Columns
  const storeColumns: Array<DataTableColumn<any>> = [
    { key: "orderRef", header: "Order Ref" },
    { key: "roomNumber", header: "Room" },
    { key: "guestName", header: "Guest" },
    {
      key: "itemsSummary",
      header: "Items Ordered",
      render: (row) => (
        <span className="text-xs text-gray-500">
          {row.items.map((i: any) => `${i.name} x${i.quantity}`).join(", ")}
        </span>
      )
    },
    {
      key: "totalAmount",
      header: "Total",
      align: "end",
      render: (row) => <strong className="font-bold">{formatPrice(row.totalAmount)}</strong>
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <StatusBadge 
          label={row.status.replace("-", " ")} 
          status={row.status === "delivered" ? "confirmed" : row.status === "cancelled" ? "dirty" : "pending"} 
        />
      )
    },
    {
      key: "action",
      header: "Actions",
      align: "end",
      render: (row) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setSelectedOrder(row);
            setIsOrderDrawerOpen(true);
          }}
          className="min-h-[36px] px-3.5 inline-flex items-center gap-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 transition"
        >
          <Eye size={12} />
          Details
        </button>
      )
    }
  ];

  const isBookingPaid = (row: Booking) => {
    const paid = (row.onsitePayments ?? []).reduce((sum, p) => sum + (p.amount || 0), 0);
    return paid >= row.totalPrice && row.totalPrice > 0;
  };

  const renderBookingCard = (row: Booking) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-700">
          REF: {row.bookingRef}
        </span>
        <StatusBadge label={row.status.replace("-", " ")} status={row.status} />
      </div>
      <p className="text-base font-bold text-gray-900">{row.guestName}</p>
      <div className="flex items-center gap-3 text-xs text-gray-600">
        <span className="flex items-center gap-1">
          <Calendar size={12} className="text-gray-400" aria-hidden="true" />
          {row.checkIn} – {row.checkOut}
        </span>
        <span className="flex items-center gap-1">
          <BedDouble size={12} className="text-gray-400" aria-hidden="true" />
          Room {row.roomNumber}
        </span>
      </div>
      <p className="text-xs text-gray-500">
        {row.numNights} {row.numNights === 1 ? "night" : "nights"} · {row.numGuests} {row.numGuests === 1 ? "guest" : "guests"}
      </p>
      <div className="flex items-center justify-between gap-2">
        <p className="text-lg font-bold text-primary-dark">{formatPrice(row.totalPrice)}</p>
        {isBookingPaid(row) ? (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700"
            aria-label="Fully paid"
          >
            <span aria-hidden="true">●</span> Paid
          </span>
        ) : null}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          aria-label={`Open actions for booking ${row.bookingRef}`}
          onClick={(e) => {
            e.stopPropagation();
            setSelectedBooking(row);
            setIsDrawerOpen(true);
          }}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 active:bg-gray-200"
        >
          <MoreVertical size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  const renderOrderCard = (row: any) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-700">
          REF: {row.orderRef}
        </span>
        <StatusBadge
          label={row.status.replace("-", " ")}
          status={row.status === "delivered" ? "confirmed" : row.status === "cancelled" ? "dirty" : "pending"}
        />
      </div>
      <p className="text-base font-bold text-gray-900">{row.guestName}</p>
      <p className="flex items-center gap-1 text-xs text-gray-600">
        <BedDouble size={12} className="text-gray-400" aria-hidden="true" />
        Room {row.roomNumber}
      </p>
      <p className="line-clamp-2 text-xs text-gray-500">
        {row.items.map((i: any) => `${i.quantity}x ${i.name}`).join(", ")}
      </p>
      <p className="text-lg font-bold text-primary-dark">{formatPrice(row.totalAmount)}</p>
    </div>
  );

  // Filtering store orders
  const filteredOrders = storeOrders.filter((order) => {
    const matchesSearch = 
      order.guestName.toLowerCase().includes(orderSearchText.toLowerCase()) ||
      order.orderRef.toLowerCase().includes(orderSearchText.toLowerCase()) ||
      order.roomNumber.includes(orderSearchText);

    const matchesStatus = orderStatusFilter === "all" || order.status === orderStatusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleOrderRowClick = (row: any) => {
    setSelectedOrder(row);
    setIsOrderDrawerOpen(true);
  };

  const handleStatusTransition = (status: Booking["status"]) => {
    if (selectedBooking) {
      updateBookingStatus(selectedBooking.id, status);
      setSelectedBooking(prev => prev ? { ...prev, status } : null);
    }
  };

  const handleRejectDiscount = async (reason: string) => {
    if (!selectedBooking) return;
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/reject-discount`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          bookingId: selectedBooking.id,
          reason
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to reject discount");
      }

      if (data.data) syncSelectedBooking(data.data);
      toast.success("Discount rejected", "Full rate restored. Guest notified by email.");
      setShowDiscountRejectForm(false);
    } catch (err: any) {
      console.error("Failed to reject discount:", err);
      toast.error("Failed to reject discount", err.message);
    }
  };

  const selectedBookingMember = selectedBooking?.memberId
    ? members.find((member) => member.id === selectedBooking.memberId)
    : null;
  const pointsToRedeem = Math.max(0, Math.floor(Number(redeemPointsInput) || 0));
  const redemptionValue = Math.round(pointsToRedeem * ((rewardsConfig.pointsRedemptionRate || 0) / 100));

  const handleRedeemPoints = async () => {
    if (!selectedBooking || !selectedBooking.memberId || pointsToRedeem <= 0) return;
    setIsRedeemingPoints(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/members/redeem-points`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          bookingId: selectedBooking.id,
          memberId: selectedBooking.memberId,
          pointsToRedeem
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to redeem points.");
      }
      setRedeemPointsInput("");
      toast.success("Points redeemed", `${pointsToRedeem} points applied to this booking.`);
    } catch (error) {
      toast.error("Points not redeemed", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsRedeemingPoints(false);
    }
  };

  const handleUndoRedemption = async () => {
    if (!selectedBooking) return;
    setIsRedeemingPoints(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/members/undo-redemption`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ bookingId: selectedBooking.id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to undo redemption.");
      }
      toast.success("Redemption undone", "Points were returned to the member balance.");
    } catch (error) {
      toast.error("Could not undo redemption", error instanceof Error ? error.message : "Unknown error");
    } finally {
      setIsRedeemingPoints(false);
    }
  };

  const handleCancelBooking = async (reason: string) => {
    if (!selectedBooking) return;
    updateBookingStatus(selectedBooking.id, "cancelled", { cancellationReason: reason });
    setSelectedBooking(prev => prev ? { ...prev, status: "cancelled", cancellationReason: reason } : null);
    toast.success("Booking cancelled", reason ? `Reason: ${reason}` : "Guest will be notified by email.");
    setShowBookingCancelForm(false);
  };

  const handleCancelOrder = async (reason: string) => {
    if (!selectedOrder) return;
    void updateStoreOrderStatus(selectedOrder.id, "cancelled", reason);
    setSelectedOrder((prev: any) => prev ? { ...prev, status: "cancelled", cancellationReason: reason } : null);
    toast.success("Order cancelled", reason ? `Reason: ${reason}` : `Order ${selectedOrder.orderRef} cancelled.`);
    setShowOrderCancelForm(false);
  };

  const getStayDates = (booking: Booking) => {
    return Array.from({ length: booking.numNights }, (_, index) => {
      const date = new Date(booking.checkIn);
      date.setDate(date.getDate() + index);
      return date.toISOString().split("T")[0];
    });
  };

  const printRegistrationPDF = async () => {
    if (!selectedBooking) return;
    const b = selectedBooking;
    const reg = b.guestRegistration;
    const pdfWindow = window.open("", "_blank");
    pdfWindow?.document.write("<p style=\"font-family: sans-serif; padding: 24px;\">Preparing registration PDF...</p>");

    try {
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      await registerBrandPdfFonts(pdf);
      const logoDataUrl = await getPdfBrandLogoDataUrl();
      setPdfFont(pdf, "Inter");
    const pageW = 210;
    const marginL = 15;
    const marginR = pageW - 15;
    const generatedAt = new Date().toLocaleString("en-PH", {
      timeZone: config.timezone || "Asia/Manila",
      dateStyle: "medium",
      timeStyle: "short"
    });
    let y = drawPdfBrandHeader(pdf, {
      logoDataUrl,
      title: "Guest Registration Form",
      subtitle: `${b.bookingRef} | Room ${b.roomNumber}`,
      meta: generatedAt,
      brandRgb,
      printLight: true,
      compact: true
    });

    const compactLabelRgb: [number, number, number] = [90, 90, 90];
    const compactTextRgb: [number, number, number] = [45, 45, 45];

    const fitText = (text: string, maxWidth: number) => {
      let next = text || "—";
      while (next.length > 4 && pdf.getTextWidth(next) > maxWidth) {
        next = `${next.slice(0, -2).trim()}…`;
      }
      return next;
    };

    const drawCompactSectionTitle = (title: string, x: number, titleY: number, width: number) => {
      pdf.setFillColor(254, 243, 226);
      pdf.roundedRect(x, titleY - 3.8, 2.4, 4.8, 0.8, 0.8, "F");
      pdf.setFontSize(10);
      pdf.setTextColor(30, 30, 30);
      pdf.text(title, x + 5, titleY);
      pdf.setDrawColor(230, 230, 230);
      pdf.setLineWidth(0.12);
      const lineX = x + 5 + pdf.getTextWidth(title) + 4;
      pdf.line(lineX, titleY - 1.4, x + width, titleY - 1.4);
      pdf.setDrawColor(...brandRgb);
    };

    const drawCompactField = (
      label: string,
      value: string,
      x: number,
      fieldY: number,
      labelW: number,
      valueW: number
    ) => {
      pdf.setFontSize(7.5);
      pdf.setTextColor(...compactLabelRgb);
      pdf.text(`${label}:`, x, fieldY);
      pdf.setTextColor(...compactTextRgb);
      pdf.text(fitText(value || "—", valueW), x + labelW, fieldY);
    };

    // Booking info row
    pdf.setFillColor(248, 250, 252);
    pdf.roundedRect(marginL, y - 3, marginR - marginL, 15, 2, 2, "F");
    pdf.setFontSize(7.8);
    pdf.setTextColor(80, 80, 80);
    pdf.text(`Booking: ${b.bookingRef}`, marginL + 5, y);
    pdf.text(`Room: ${b.roomNumber} (${b.roomType})`, marginL + 92, y);
    y += 4.4;
    pdf.text(`Check-in: ${b.checkIn}  |  Check-out: ${b.checkOut}`, marginL + 5, y);
    y += 4.4;
    pdf.text(`Guests: ${b.numGuests}  |  Nights: ${b.numNights}`, marginL + 5, y);
    y += 10;

    const contentTop = y;
    const leftX = marginL;
    const leftW = 68;
    const rightX = leftX + leftW + 9;
    const rightW = marginR - rightX;

    // ── Middle grid: Guest Information + Registration Details ──
    drawCompactSectionTitle("Guest Information", leftX, contentTop, leftW);
    let leftY = contentTop + 7;
    drawCompactField("Name", b.guestName, leftX, leftY, 18, leftW - 21); leftY += 5.2;
    drawCompactField("Email", b.guestEmail, leftX, leftY, 18, leftW - 21); leftY += 5.2;
    drawCompactField("Phone", b.guestPhone, leftX, leftY, 18, leftW - 21);

    drawCompactSectionTitle("Registration Details", rightX, contentTop, rightW);

    const regFields: [string, string][] = [
      ["Nationality", reg?.nationality || "—"],
      ["Date of Birth", reg?.dateOfBirth || "—"],
      ["Gender", reg?.gender || "—"],
      ["ID Type", reg?.idType || "—"],
      ["ID Number", reg?.idNumber || "—"],
      ["Address", reg?.address || "—"],
      ["Emergency Contact", reg?.emergencyContact || "—"],
      ["Vehicle Plate", reg?.vehiclePlate || "—"],
    ];

    const regColGap = 7;
    const regColW = (rightW - regColGap) / 2;
    const regStartY = contentTop + 7;
    regFields.forEach(([label, value], index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      drawCompactField(
        label,
        value,
        rightX + col * (regColW + regColGap),
        regStartY + row * 5.2,
        25,
        regColW - 27
      );
    });

    y = contentTop + 34;

    // ── Lower-middle grid: ID + acknowledgment ──
    const lowerTop = y;
    const lowerGap = 8;
    const lowerW = (marginR - marginL - lowerGap) / 2;
    const idX = marginL;
    const ackX = idX + lowerW + lowerGap;
    drawCompactSectionTitle("Government-Issued ID", idX, lowerTop, lowerW);
    drawCompactSectionTitle("Guest Acknowledgment", ackX, lowerTop, lowerW);
    const idBoxY = lowerTop + 8;
    const idBoxW = lowerW - 4;
    const idBoxH = 31;

    if (b.guestIdPhotoUrl) {
      try {
        const response = await fetch(b.guestIdPhotoUrl);
        const blob = await response.blob();
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });

        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = base64;
        });

        const maxW = idBoxW - 2;
        const maxH = idBoxH - 2;
        const imgRatio = img.width / img.height;
        let drawW = maxW;
        let drawH = drawW / imgRatio;
        if (drawH > maxH) {
          drawH = maxH;
          drawW = drawH * imgRatio;
        }

        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.3);
        pdf.rect(idX, idBoxY, idBoxW, idBoxH);
        pdf.addImage(base64, getJsPdfImageFormat(base64, blob.type), idX + 1, idBoxY + 1, drawW, drawH);
      } catch {
        // Failed to fetch image — show placeholder
        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.3);
        pdf.setLineDashPattern([3, 3], 0);
        pdf.rect(idX, idBoxY, idBoxW, idBoxH);
        pdf.setLineDashPattern([], 0);
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text("Attach ID here", idX + idBoxW / 2, idBoxY + idBoxH / 2 + 1, { align: "center" });
      }
    } else {
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.3);
      pdf.setLineDashPattern([3, 3], 0);
      pdf.rect(idX, idBoxY, idBoxW, idBoxH);
      pdf.setLineDashPattern([], 0);
      pdf.setFontSize(8);
      pdf.setTextColor(150, 150, 150);
      pdf.text("Attach ID here", idX + idBoxW / 2, idBoxY + idBoxH / 2 + 1, { align: "center" });
    }

    pdf.setFontSize(8);
    pdf.setTextColor(...compactLabelRgb);
    pdf.text("Guest Signature", ackX, idBoxY + 5);
    pdf.setDrawColor(60, 60, 60);
    pdf.setLineWidth(0.25);
    pdf.line(ackX, idBoxY + 18, ackX + lowerW - 8, idBoxY + 18);
    pdf.text("Date", ackX, idBoxY + 27);
    pdf.line(ackX + 20, idBoxY + 27, ackX + lowerW - 8, idBoxY + 27);

    y = lowerTop + 45;

    // ── House Rules ──
    const houseRules = websiteContent?.houseRules;
    if (houseRules && houseRules.trim().length > 0) {
      drawCompactSectionTitle("House Rules", marginL, y, marginR - marginL);
      y += 5;

      pdf.setFontSize(7.2);
      pdf.setTextColor(90, 90, 90);
      const rulesLines = (pdf.splitTextToSize(houseRules, pageW - 38) as string[]).slice(0, 3);
      rulesLines.forEach((line) => {
        pdf.text(line, marginL, y);
        y += 3.7;
      });
      pdf.setTextColor(60, 60, 60);
      pdf.setDrawColor(150, 150, 150);
      pdf.setLineWidth(0.2);
      pdf.rect(marginL, y - 2.7, 3, 3);
      pdf.text("I have read and agree to the house rules.", marginL + 5, y);
      y += 5;
    }

    // ── Breakfast Selections ──
    if (b.hasBreakfast) {
      const activeSilogItems = breakfastConfig.silogItems.filter(
        (item: { id: string; name: string; isActive: boolean }) => item.isActive
      );
      const stayDates = getStayDates(b);
      const breakfastRows = b.numGuests * Math.max(stayDates.length, 1);
      const breakfastH = 11 + Math.max(1, breakfastRows) * 5;
      const breakfastTop = Math.min(Math.max(y + 3, 232), 276 - breakfastH);
      y = breakfastTop;

      drawCompactSectionTitle("Breakfast Silog Selections", marginL, y, marginR - marginL);
      y += 4.8;
      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 120);
      pdf.text("Circle or check your choice for each guest per day.", marginL, y);
      y += 5.5;

      if (activeSilogItems.length === 0) {
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text("No active silog items configured.", marginL, y);
        y += 4.5;
      } else {
        pdf.setFontSize(7);
        for (const date of stayDates) {
          const shortDate = stayDates.length > 1
            ? new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" })
            : "";
          for (let g = 0; g < b.numGuests; g++) {
            const rowLabel = stayDates.length > 1 ? `Guest ${g + 1} (${shortDate}):` : `Guest ${g + 1}:`;
            pdf.setTextColor(...compactTextRgb);
            pdf.text(rowLabel, marginL, y);
            let optionX = marginL + 24;
            for (const item of activeSilogItems) {
              const optionLabel = fitText(item.name, 17);
              pdf.setDrawColor(150, 150, 150);
              pdf.setLineWidth(0.12);
              pdf.rect(optionX, y - 2.8, 2.7, 2.7);
              pdf.setTextColor(75, 75, 75);
              pdf.text(optionLabel, optionX + 3.7, y);
              optionX += Math.min(28, Math.max(20, pdf.getTextWidth(optionLabel) + 8));
            }
            y += 4.8;
          }
        }
      }
    }

    // ── Footer ──
    drawPdfFooter(
      pdf,
      b.bookingRef,
      `Generated by ${config.brandName} guest registration system - ${getManilaDateInfo(config.timezone).todayStr}`,
      brandRgb
    );

      const result = openPdfOrDownload(pdf, `${b.bookingRef || "booking"}-registration.pdf`, pdfWindow);
      toast.success(
        "Registration PDF ready",
        result === "opened" ? "Opened in a new tab." : "Popup blocked, so the PDF was downloaded instead."
      );
    } catch (error) {
      pdfWindow?.close();
      toast.error("Registration PDF failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const printBookingReceiptPDF = async () => {
    if (!selectedBooking) return;
    const b = selectedBooking;
    const pdfWindow = window.open("", "_blank");
    pdfWindow?.document.write("<p style=\"font-family: sans-serif; padding: 24px;\">Preparing booking receipt PDF...</p>");

    try {
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      await registerBrandPdfFonts(pdf);
      const logoDataUrl = await getPdfBrandLogoDataUrl();
      setPdfFont(pdf, "Inter");
      const pageW = 210;
      const marginL = 15;
      const marginR = pageW - 15;
      const labelColX = 20;
      let y = 15;

      const generatedAt = new Date().toLocaleString("en-PH", {
        timeZone: config.timezone || "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short"
      });

      const checkNewPage = (needed: number) => {
        if (y + needed > 280) {
          pdf.addPage();
          y = drawPdfBrandHeader(pdf, {
            logoDataUrl,
            title: "Booking Confirmation Receipt",
            subtitle: `Booking Reference: ${b.bookingRef}`,
            meta: `Generated: ${generatedAt}`,
            brandRgb,
            printLight: true,
            compact: true
          });
        }
      };

      const receiptFolio = getBookingFolio(b);
      const paymentsTotalForSummary = selectedBookingPayments.reduce((sum, payment) => sum + payment.amount, 0);
      const amountDueForSummary = Math.max(0, receiptFolio.grandTotal - paymentsTotalForSummary);
      const amountX = marginR - 5; // Exactly X: 190, matching the Stay card right alignment

      const formatAmount = (value: number) =>
        `PHP ${Math.round(value || 0).toLocaleString("en-PH")}`;

      const formatPaymentMethod = (method?: string) =>
        method
          ? method
              .split("-")
              .filter(Boolean)
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(" ")
          : "—";

      const fitText = (text: string, maxWidth: number) => {
        let next = text || "—";
        while (next.length > 4 && pdf.getTextWidth(next) > maxWidth) {
          next = `${next.slice(0, -2).trim()}…`;
        }
        return next;
      };

      const drawInfoCard = (
        title: string,
        rows: { label: string; value: string }[],
        x: number,
        cardY: number,
        width: number
      ) => {
        const cardH = 7.5 + rows.length * 4.2;
        pdf.setFillColor(248, 250, 252);
        pdf.roundedRect(x, cardY, width, cardH, 1.5, 1.5, "F");
        pdf.setFontSize(7.2);
        pdf.setTextColor(120, 120, 120);
        pdf.text(title, x + 5, cardY + 4.5, { charSpace: 0 });
        pdf.setFontSize(8.0);
        rows.forEach((row, index) => {
          const rowY = cardY + 8.5 + index * 4.2;
          pdf.setTextColor(110, 110, 110);
          pdf.text(row.label, x + 5, rowY, { charSpace: 0 });
          pdf.setTextColor(45, 45, 45);
          pdf.text(fitText(row.value, width - 32), x + width - 5, rowY, { align: "right", charSpace: 0 });
        });
        return cardH;
      };

      const drawAmountRow = (label: string, amount: string, opts: { muted?: boolean; danger?: boolean; bold?: boolean } = {}) => {
        pdf.setFontSize(opts.bold ? 9.4 : 8.4);
        pdf.setTextColor(opts.danger ? 190 : opts.muted ? 110 : 45, opts.danger ? 55 : opts.muted ? 110 : 45, opts.danger ? 55 : opts.muted ? 110 : 45);
        
        // Regular font weight for descriptions
        pdf.setFont("helvetica", "normal");
        pdf.text(label, labelColX, y, { charSpace: 0 });
        
        // Bold font weight for currency values
        pdf.setFont("helvetica", "bold");
        pdf.text(amount, amountX, y, { align: "right", charSpace: 0 });
        
        setPdfFont(pdf, "Inter");
        y += 4.4; // Tighter vertical line height
      };

      // ── Header ──
      y = drawPdfBrandHeader(pdf, {
        logoDataUrl,
        title: "Booking Confirmation Receipt",
        subtitle: `Booking Reference: ${b.bookingRef}`,
        meta: `Generated: ${generatedAt}`,
        brandRgb,
        printLight: true,
        compact: true // Compact header saves 10mm of vertical height
      });

      pdf.setFillColor(255, 247, 237);
      pdf.roundedRect(marginL, y - 2, marginR - marginL, 10.5, 1.5, 1.5, "F");
      pdf.setFontSize(8.0);
      pdf.setTextColor(...brandRgb);
      pdf.text("Amount to collect", marginL + 5, y + 1.2, { charSpace: 0 });
      pdf.setFontSize(12.5);
      pdf.setFont("helvetica", "bold");
      pdf.text(
        formatAmount(amountDueForSummary),
        amountX,
        y + 2.2,
        { align: "right", charSpace: 0 }
      );
      setPdfFont(pdf, "Inter");
      pdf.setFontSize(7.5);
      pdf.setTextColor(90, 90, 90);
      pdf.text(`Booking ${b.bookingRef} • Generated ${generatedAt}`, marginL + 5, y + 6.2, { charSpace: 0 });
      y += 12; // Reduced gap

      // ── Guest & Stay Information ──
      const cardGap = 6;
      const cardW = (marginR - marginL - cardGap) / 2;
      const guestCardH = drawInfoCard("Guest", [
        { label: "Name", value: b.guestName },
        { label: "Email", value: b.guestEmail },
        { label: "Phone", value: b.guestPhone }
      ], marginL, y, cardW);
      const stayRows = [
        { label: "Room", value: `${b.roomNumber} (${b.roomType})` },
        { label: "Dates", value: `${b.checkIn} to ${b.checkOut}` },
        { label: "Stay", value: `${b.numNights} night${b.numNights === 1 ? "" : "s"} • ${b.numGuests} guest${b.numGuests === 1 ? "" : "s"}` },
        { label: "Rate", value: `${formatAmount(b.ratePerNight)} / night` }
      ];
      if (b.hasBreakfast && breakfastConfig.ratePerPersonPerNight) {
        stayRows.push({ label: "Breakfast", value: `${formatAmount(breakfastConfig.ratePerPersonPerNight)} / guest / night` });
      }
      const stayCardH = drawInfoCard("Stay", stayRows, marginL + cardW + cardGap, y, cardW);
      y += Math.max(guestCardH, stayCardH) + 4.5; // Tighter vertical gap

      // ── Pricing Breakdown ──
      checkNewPage(45);
      drawPdfSectionTitle(pdf, "Pricing Breakdown", marginL, y, brandRgb);
      y += 4.5;

      pdf.setFontSize(10);
      pdf.setTextColor(50, 50, 50);
      if (b.rateBreakdown?.roomLines?.length) {
        b.rateBreakdown.roomLines.forEach((line) => {
          checkNewPage(6);
          drawAmountRow(`${line.label}: ${line.nights} x ${formatAmount(line.nightlyRate)}`, formatAmount(line.subtotal));
        });
        b.rateBreakdown.addOns.forEach((line) => {
          checkNewPage(6);
          drawAmountRow(line.label, formatAmount(line.amount));
        });
        b.rateBreakdown.deductions.forEach((line) => {
          checkNewPage(6);
          drawAmountRow(line.label, `-${formatAmount(line.amount)}`, { muted: true });
        });
      } else {
        const subtotal = b.ratePerNight * b.numNights;
        drawAmountRow(
          `Room subtotal: ${b.numNights} night${b.numNights === 1 ? "" : "s"} x ${formatAmount(b.ratePerNight)}`,
          formatAmount(subtotal)
        );

        if (b.discountPct && b.discountPct > 0 && b.discountType && b.discountType !== "none") {
          const discountLabel = b.discountType === "senior"
            ? "Senior Citizen Discount"
            : b.discountType === "pwd"
              ? "PWD Discount"
              : "Discount";
          const storedDiscountBase = b.originalTotalPrice ?? subtotal;
          const discountAmount = Math.max(0, Math.round(storedDiscountBase * (b.discountPct / 100)));
          drawAmountRow(`${discountLabel} (${b.discountPct}%)`, `-${formatAmount(discountAmount)}`, { muted: true });
        }

        if (b.voucherCode && b.voucherDiscount && b.voucherDiscount > 0) {
          drawAmountRow(`Voucher (${b.voucherCode})`, `-${formatAmount(b.voucherDiscount)}`, { muted: true });
        }

        if (b.memberDiscountPct && b.memberDiscountPct > 0) {
          const discountBase = b.originalTotalPrice ?? subtotal;
          const seniorPwdAmount = b.discountPct ? Math.round(discountBase * (b.discountPct / 100)) : 0;
          const memberBase = Math.max(discountBase - seniorPwdAmount - (b.voucherDiscount || 0), 0);
          const memberDiscountAmount = Math.max(0, Math.round(memberBase * (b.memberDiscountPct / 100)));
          drawAmountRow(`Member Discount (${b.memberDiscountPct}%)`, `-${formatAmount(memberDiscountAmount)}`, { muted: true });
        }

        if (b.pointsRedeemed && b.pointsRedeemed > 0) {
          drawAmountRow(`Spark Rewards: ${b.pointsRedeemed} pts redeemed`, `-${formatAmount(b.pointsRedeemedValue || 0)}`, { muted: true });
        }
      }

      // Booking Total Banner
      y += 0.5;
      pdf.setFillColor(255, 247, 237);
      pdf.roundedRect(marginL, y - 2, marginR - marginL, 7.5, 1.5, 1.5, "F");
      y += 3.2;

      pdf.setFontSize(10);
      pdf.setTextColor(...brandRgb);
      pdf.text("Booking Total", labelColX, y, { charSpace: 0 });
      pdf.setFont("helvetica", "bold");
      pdf.text(formatAmount(b.totalPrice), amountX, y, { align: "right", charSpace: 0 });
      setPdfFont(pdf, "Inter");
      y += 6.5;

      if (receiptFolio.storeCharges.length > 0 || receiptFolio.charges.length > 0) {
        checkNewPage(12 + (receiptFolio.storeCharges.length + receiptFolio.charges.length) * 5);
        drawPdfSectionTitle(pdf, "Folio Charges", marginL, y, brandRgb);
        y += 4.5;
        receiptFolio.storeCharges.forEach((order) => {
          drawAmountRow(`Store order ${order.orderRef}`, formatAmount(order.totalAmount));
        });
        receiptFolio.charges.forEach((charge) => {
          drawAmountRow(charge.label, formatAmount(charge.amount), { muted: charge.amount < 0 });
        });
        drawAmountRow("Folio total", formatAmount(receiptFolio.grandTotal), { bold: true });
        y += 2;
      }

      // ── Special Requests / Notes ──
      if (b.specialRequests && b.specialRequests.trim().length > 0) {
        checkNewPage(15);
        drawPdfSectionTitle(pdf, "Special Requests", marginL, y, brandRgb);
        y += 5;

        pdf.setFontSize(10);
        pdf.setTextColor(60, 60, 60);
        const reqLines = pdf.splitTextToSize(b.specialRequests, pageW - 40);
        for (const line of reqLines) {
          checkNewPage(5);
          pdf.text(line, labelColX, y, { charSpace: 0 });
          y += 4.0;
        }
        y += 3;
      }

      // ── Payment Breakdown ──
      checkNewPage(30);
      drawPdfSectionTitle(pdf, "Payments Collected", marginL, y, brandRgb);
      y += 4.5;

      const payments = selectedBookingPayments;
      if (payments.length > 0) {
        pdf.setFontSize(9);
        pdf.setTextColor(80, 80, 80);
        pdf.text("Date", labelColX, y, { charSpace: 0 });
        pdf.text("Method", labelColX + 42, y, { charSpace: 0 });
        pdf.text("Amount", amountX, y, { align: "right", charSpace: 0 });
        y += 1.8;
        pdf.setDrawColor(220, 220, 220);
        pdf.setLineWidth(0.15);
        pdf.line(marginL, y, marginR, y);
        y += 3.8;

        let paymentsTotal = 0;
        payments.forEach((pay) => {
          checkNewPage(6);
          pdf.setFontSize(9);
          pdf.setTextColor(50, 50, 50);
          const recordedDate = pay.recordedAt
            ? new Date(pay.recordedAt).toLocaleDateString("en-PH", {
                timeZone: config.timezone || "Asia/Manila",
                year: "numeric",
                month: "short",
                day: "numeric"
              })
            : "—";
          pdf.text(recordedDate, labelColX, y, { charSpace: 0 });
          pdf.text(formatPaymentMethod(pay.method), labelColX + 42, y, { charSpace: 0 });
          pdf.setFont("helvetica", "bold");
          pdf.text(formatAmount(pay.amount), amountX, y, { align: "right", charSpace: 0 });
          setPdfFont(pdf, "Inter");
          paymentsTotal += pay.amount;
          y += 4.2;
        });

        y += 0.8;
        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.2);
        pdf.line(marginL, y, marginR, y);
        y += 3.8;

        drawAmountRow("Total collected", formatAmount(paymentsTotal), { bold: true });

        const balance = receiptFolio.grandTotal - paymentsTotal;
        pdf.setFontSize(10);
        if (balance <= 0) {
          pdf.setTextColor(34, 139, 34);
          pdf.text("Balance due", labelColX, y, { charSpace: 0 });
          pdf.setFont("helvetica", "bold");
          pdf.text(formatAmount(0), amountX, y, { align: "right", charSpace: 0 });
          setPdfFont(pdf, "Inter");
          y += 4.2;
          pdf.setFontSize(8.4);
          pdf.setTextColor(80, 80, 80);
          pdf.text("Fully settled. Thank you.", labelColX, y, { charSpace: 0 });
        } else {
          pdf.setTextColor(200, 60, 60);
          pdf.text("Balance due", labelColX, y, { charSpace: 0 });
          pdf.setFont("helvetica", "bold");
          pdf.text(formatAmount(balance), amountX, y, { align: "right", charSpace: 0 });
          setPdfFont(pdf, "Inter");
        }
        y += 5;
      } else {
        // No payments yet — show payment method + amount due
        pdf.setFontSize(10);
        pdf.setTextColor(50, 50, 50);
        const methodLabel = formatPaymentMethod(b.paymentMethod);
        pdf.text(`Expected payment method: ${methodLabel}`, labelColX, y, { charSpace: 0 });
        y += 5.0;
        pdf.setFontSize(10);
        pdf.setTextColor(200, 60, 60);
        pdf.text("Amount due at property", labelColX, y, { charSpace: 0 });
        pdf.setFont("helvetica", "bold");
        pdf.text(formatAmount(receiptFolio.grandTotal), amountX, y, { align: "right", charSpace: 0 });
        setPdfFont(pdf, "Inter");
        y += 5;
      }

      // ── Footer ──
      // Pull footer up dynamically, removing artificial large margins
      const footerY = y + 8;
      if (footerY > 275) {
        pdf.addPage();
        y = drawPdfBrandHeader(pdf, {
          logoDataUrl,
          title: "Booking Confirmation Receipt",
          subtitle: `Booking Reference: ${b.bookingRef}`,
          meta: `Generated: ${generatedAt}`,
          brandRgb,
          printLight: true,
          compact: true
        });
      }
      drawPdfFooter(
        pdf,
        b.bookingRef,
        "This is a booking confirmation only. An official BIR receipt will be issued upon payment at the property.",
        brandRgb,
        footerY > 275 ? y + 8 : footerY
      );

      const result = openPdfOrDownload(pdf, `${b.bookingRef || "booking"}-receipt.pdf`, pdfWindow);
      toast.success(
        "Receipt PDF ready",
        result === "opened" ? "Opened in a new tab." : "Popup blocked, so the PDF was downloaded instead."
      );
    } catch (error) {
      pdfWindow?.close();
      toast.error("Receipt PDF failed", error instanceof Error ? error.message : "Please try again.");
    }
  };

  const getBookingPaymentsTotal = (booking: Booking) => {
    if (selectedBooking && selectedBooking.id === booking.id) {
      return selectedBookingPayments.reduce((sum, payment) => sum + payment.amount, 0);
    }
    return (booking.onsitePayments || []).reduce((sum, payment) => sum + payment.amount, 0);
  };

  const getBookingStoreCharges = (booking: Booking) => {
    return storeOrders.filter(
      (order) =>
        order.bookingId === booking.id &&
        order.paymentMethod === "add-to-bill" &&
        order.status === "delivered" &&
        order.isBilled
    );
  };

  const getBookingFolio = (booking: Booking) => {
    const storeCharges = getBookingStoreCharges(booking);
    const storeTotal = storeCharges.reduce((sum, order) => sum + order.totalAmount, 0);
    const paymentsTotal = getBookingPaymentsTotal(booking);
    const charges = selectedBooking?.id === booking.id ? selectedBookingCharges : [];
    const chargesTotal = charges.reduce((sum, charge) => sum + charge.amount, 0);
    const grandTotal = booking.totalPrice + storeTotal + chargesTotal;
    return {
      storeCharges,
      storeTotal,
      charges,
      chargesTotal,
      paymentsTotal,
      grandTotal,
      balance: grandTotal - paymentsTotal
    };
  };

  const selectedBookingCheckInReadiness = selectedBooking
    ? getCheckInReadiness({
        status: selectedBooking.status,
        guestIdPhotoUrl: selectedBooking.guestIdPhotoUrl,
        guestRegistration: selectedBooking.guestRegistration
      })
    : null;

  const syncSelectedBooking = (updates: Partial<Booking>) => {
    if (!selectedBooking) return;
    setSelectedBooking(prev => prev ? { ...prev, ...updates } : null);
  };

  const persistSelectedBooking = (updates: Partial<Booking>) => {
    if (!selectedBooking) return;
    void updateBookingStatus(selectedBooking.id, selectedBooking.status, updates);
    syncSelectedBooking(updates);
  };

  const handleGuestIdUpload = async (file: File | undefined) => {
    if (!file || !selectedBooking) return;

    try {
      setGuestIdUploadStatus("Compressing guest ID image...");
      const image = await compressImageFile(file, { maxWidth: 1400, maxHeight: 1400, quality: 0.84 });
      setGuestIdUploadStatus("Uploading guest ID to secure storage...");
      const safeName = image.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileRef = storageRef(storage, `bookings/${selectedBooking.id}/guest-id/${Date.now()}-${safeName}`);
      await uploadBytes(fileRef, image.file);
      const url = await getDownloadURL(fileRef);
      persistSelectedBooking({ guestIdPhotoUrl: url });
      setGuestIdUploadStatus(`ID image uploaded: ${Math.max(1, Math.round(image.compressedSize / 1024))} KB.`);
    } catch (error) {
      setGuestIdUploadStatus(error instanceof Error ? error.message : "Unable to process guest ID image.");
    }
  };

  const handleRegistrationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    persistSelectedBooking({
      guestRegistration: {
        nationality: String(formData.get("nationality") || "").trim(),
        address: String(formData.get("address") || "").trim(),
        dateOfBirth: String(formData.get("dateOfBirth") || ""),
        gender: String(formData.get("gender") || ""),
        idType: String(formData.get("idType") || ""),
        idNumber: String(formData.get("idNumber") || "").trim(),
        emergencyContact: String(formData.get("emergencyContact") || "").trim(),
        vehiclePlate: String(formData.get("vehiclePlate") || "").trim(),
        signatureStatus: formData.get("signatureStatus") === "signed" ? "signed" : "pending"
      }
    });
  };

  const handleBreakfastSelection = (key: string, value: string) => {
    if (!selectedBooking) return;
    const selections = {
      ...(selectedBooking.breakfastSelections || {}),
      [key]: value
    };
    persistSelectedBooking({ breakfastSelections: selections });
  };

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

  // Estimate pricing delta
  const movePriceDelta = useMemo(() => {
    if (!selectedBooking || !showMoveForm || !moveRoomId || !moveCheckIn || !moveCheckOut) return 0;
    
    const targetRoom = rooms.find(r => r.id === moveRoomId);
    if (!targetRoom) return 0;
    
    try {
      const estimatedPrice = estimateNewTotalPrice(
        selectedBooking,
        targetRoom.type,
        moveCheckIn,
        moveCheckOut,
        roomTypes,
        seasonalRateOverrides,
        corporateCodes,
        rewardsConfig,
        breakfastConfig,
        vouchers
      );
      return estimatedPrice - (selectedBooking.totalPrice || 0);
    } catch (e) {
      console.warn("Pricing estimate failed:", e);
      return 0;
    }
  }, [selectedBooking, showMoveForm, moveRoomId, moveCheckIn, moveCheckOut, rooms, roomTypes, seasonalRateOverrides, corporateCodes, rewardsConfig, breakfastConfig, vouchers]);

  const lockedManualMoveRate = useMemo(
    () => getLockedManualNightlyRate(selectedBooking?.rateBreakdown),
    [selectedBooking?.rateBreakdown]
  );

  const handleMoveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking || !moveRoomId || !moveCheckIn || !moveCheckOut) return;
    
    setMoveIsSubmitting(true);
    try {
      const result = await rescheduleBooking({
        bookingId: selectedBooking.id,
        roomId: moveRoomId,
        checkIn: moveCheckIn,
        checkOut: moveCheckOut,
        reason: moveReason
      });
      if (result.success) {
        toast.success("Booking moved", "Room and dates updated successfully.");
        const targetRoom = rooms.find(r => r.id === moveRoomId);
        const updatedFields = {
          roomId: moveRoomId,
          roomNumber: targetRoom ? targetRoom.roomNumber : selectedBooking.roomNumber,
          roomType: targetRoom ? targetRoom.type : selectedBooking.roomType,
          checkIn: moveCheckIn,
          checkOut: moveCheckOut,
          numNights: Math.max(
            Math.round((new Date(`${moveCheckOut}T00:00:00Z`).getTime() - new Date(`${moveCheckIn}T00:00:00Z`).getTime()) / 86400000),
            1
          ),
          ratePerNight: result.data?.ratePerNight ?? selectedBooking.ratePerNight,
          totalPrice: result.data?.totalPrice ?? selectedBooking.totalPrice + movePriceDelta,
          rateBreakdown: result.data?.rateBreakdown ?? selectedBooking.rateBreakdown,
          originalTotalPrice: result.data?.originalTotalPrice ?? selectedBooking.originalTotalPrice,
          voucherDiscount: result.data?.voucherDiscount ?? selectedBooking.voucherDiscount
        };
        // The reschedule API already committed the authoritative Firestore
        // update with Timestamp dates. Update only the open drawer here; using
        // syncSelectedBooking would write the display strings back over those
        // server timestamps.
        setSelectedBooking((previous) => previous ? { ...previous, ...updatedFields } : null);
        setShowMoveForm(false);
      } else {
        toast.error("Failed to move booking", result.error || "Please choose another room or date range.");
      }
    } catch (err: any) {
      console.error("Move booking failed:", err);
      toast.error("Failed to move booking", err.message || "An unexpected error occurred.");
    } finally {
      setMoveIsSubmitting(false);
    }
  };

  const handleAddPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBooking && paymentAmount) {
      const amount = parseFloat(paymentAmount);
      const paymentId = paymentSubmissionIdRef.current
        || doc(collection(db, "bookings", selectedBooking.id, "payments")).id;
      paymentSubmissionIdRef.current = paymentId;
      setIsRecordingPayment(true);
      let paymentCompleted = false;
      try {
        const result = await addOnsitePayment(selectedBooking.id, paymentId, amount, paymentMethod, paymentNote);
        if (result.success) {
          paymentCompleted = true;
          setPaymentAmount("");
          setPaymentNote("");
          toast.success("Payment recorded", `${formatPrice(amount)} via ${getOnsitePaymentMethodLabel(paymentMethod)}`);
        } else {
          toast.error("Failed to record payment", result.error);
        }
      } catch (err: any) {
        toast.error("Failed to record payment", err.message);
      } finally {
        // Keep the same ID after an uncertain/network failure. A manual
        // retry then replays the original server commit instead of creating
        // a second ledger entry. Successful submissions mint a fresh ID.
        if (paymentCompleted) paymentSubmissionIdRef.current = null;
        setIsRecordingPayment(false);
      }
    }
  };

  const handleRefundSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking || currentUser?.role !== "admin") return;
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !refundReason.trim()) {
      toast.warning("Check refund details", "Enter a positive amount and a required refund reason.");
      return;
    }
    setIsRefunding(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/add-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" },
        body: JSON.stringify({ bookingId: selectedBooking.id, amount, method: refundMethod, reason: refundReason.trim() })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to record refund.");
      setRefundAmount("");
      setRefundReason("");
      toast.success("Refund recorded", `${formatPrice(amount)} returned via ${getOnsitePaymentMethodLabel(refundMethod)}.`);
    } catch (error: any) {
      toast.error("Could not record refund", error.message || "Please try again.");
    } finally {
      setIsRefunding(false);
    }
  };

  const handleAddChargeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking) return;
    const amount = Number(chargeAmount);
    if (!chargeLabel.trim() || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
      toast.warning("Check charge details", "Enter a label and an amount between 0.01 and 1,000,000.");
      return;
    }
    setIsSavingCharge(true);
    try {
      await addDoc(collection(db, "bookings", selectedBooking.id, "charges"), {
        label: chargeLabel.trim(),
        amount,
        category: chargeCategory,
        note: chargeNote.trim(),
        addedBy: currentUser?.uid || "staff",
        addedAt: serverTimestamp(),
        voidOf: null
      });
      setChargeLabel("");
      setChargeAmount("");
      setChargeNote("");
      setChargeCategory("other");
      toast.success("Charge added", `${formatPrice(amount)} added to the booking folio.`);
    } catch (error: any) {
      toast.error("Could not add charge", error.message || "Please try again.");
    } finally {
      setIsSavingCharge(false);
    }
  };

  const handleVoidCharge = async (reason: string) => {
    if (!selectedBooking || !chargeToVoid) return;
    try {
      const reversalRef = doc(db, "bookings", selectedBooking.id, "charges", `void-${chargeToVoid.id}`);
      await setDoc(reversalRef, {
        label: `Reversal — ${chargeToVoid.label}`,
        amount: -Math.abs(chargeToVoid.amount),
        category: chargeToVoid.category,
        note: reason.trim(),
        addedBy: currentUser?.uid || "staff",
        addedAt: serverTimestamp(),
        voidOf: chargeToVoid.id
      });
      toast.success("Charge voided", "A reversal entry was added; the original record remains unchanged.");
      setChargeToVoid(null);
    } catch (error: any) {
      toast.error("Could not void charge", error.message || "Please try again.");
    }
  };

  const handleApplyStaffDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBooking || (!staffDiscountType && !staffVoucherCode.trim())) return;
    setIsApplyingStaffDiscount(true);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/apply-discount`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" },
        body: JSON.stringify({
          bookingId: selectedBooking.id,
          discountType: staffDiscountType,
          voucherCode: staffVoucherCode.trim()
        })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to apply discount.");
      syncSelectedBooking(payload.data);
      setStaffDiscountType("");
      setStaffVoucherCode("");
      toast.success("Booking repriced", `New total: ${formatPrice(payload.data.totalPrice)}`);
    } catch (error: any) {
      toast.error("Could not apply discount", error.message || "Please check the details and try again.");
    } finally {
      setIsApplyingStaffDiscount(false);
    }
  };

  const [isWalkinSubmitting, setIsWalkinSubmitting] = useState(false);

  const handleWalkinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName || !roomNumber) {
      toast.warning("Missing details", "Please fill in the guest name and select an available room.");
      return;
    }

    setIsWalkinSubmitting(true);
    try {
      const result = await addWalkinBooking({
        roomId: rooms.find(r => r.roomNumber === roomNumber)?.id || "",
        roomNumber,
        roomType,
        guestName,
        reminderSentAt: null,
        guestEmail: guestEmail || `walkin-${Date.now()}@example.invalid`,
        guestPhone: guestPhone || "n/a",
        numGuests,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        numNights,
        ratePerNight,
        totalPrice: priceOverride !== "" ? Number(priceOverride) : totalPrice,
        totalPriceOverride: priceOverride !== "" ? Number(priceOverride) : undefined,
        originalTotalPrice: totalPrice,
        discountType: walkinDiscountType,
        discountPct: walkinDiscountType ? 20 : 0,
        discountIdPhotoUrl: null,
        discountVerified: false,
        discountVerifiedBy: null,
        discountRejected: false,
        discountRejectedBy: null,
        discountRejectionReason: "",
        voucherCode: walkinVoucherCode.trim().toUpperCase(),
        voucherDiscount: 0,
        isCorporate: false,
        corporateCode: "",
        companyName: "",
        specialRequests: "Walk-in registration.",
        status: immediateCheckIn ? "checked-in" : "confirmed",
        paymentMethod: walkinPayment,
        // Per BF-45 (booking-flow audit 2026-06-26):
        // canonical "absent" is `null`, not `""`.
        paymentProofUrl: null,
        // Per H2 (hardening batch 2026-06-26): the admin
        // walkin flow generates a fresh per-booking token
        // on the server. The client just needs to send an
        // empty string placeholder so the type is satisfied;
        // the server overwrites it with the real token.
        lookupToken: "",
        source: "walk-in",
        notes: "Created on-site at Front Desk.",
        memberId: null,
        pointsRedeemed: 0,
        pointsRedeemedValue: 0,
        pointsRedeemedBy: null,
        pointsRedeemedAt: null,
        hasBreakfast,
        breakfastRate: hasBreakfast ? (breakfastConfig.ratePerPersonPerNight || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT) : 0,
        guestIdPhotoUrl: null,
        handledBy: currentUser?.uid || "staff",
        cancellationReason: ""
      });

      if (result.success) {
        setGuestName("");
        setGuestEmail("");
        setGuestPhone("");
        setRoomNumber("");
        setPriceOverride("");
        setHasBreakfast(false);
        setWalkinDiscountType("");
        setWalkinVoucherCode("");
        setIsModalOpen(false);
        toast.success("Walk-in booking created", `Room ${roomNumber} for ${guestName}`);
      } else {
        toast.error("Failed to create walk-in booking", result.error);
      }
    } catch (err: any) {
      toast.error("Failed to create walk-in booking", err.message);
    } finally {
      setIsWalkinSubmitting(false);
    }
  };

  return (
    <>
      <div className="space-y-8 font-body">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase font-medium">bookings & store orders</h1>
          <p className="text-xs text-gray-500 mt-1">
            {activeFilterLabel
              ? activeFilterLabel
              : "Review active room check-ins, record onsite charges, and process walk-ins and minibar deliveries."}
          </p>
          {activeFilterLabel && (
            <button
              type="button"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete("filter");
                const query = next.toString();
                setSearchParams(query ? `?${query}` : "", { replace: true });
              }}
              className="mt-2 inline-flex min-h-[32px] items-center gap-1 rounded-full bg-primary/10 px-3 text-[10px] font-bold uppercase tracking-wider text-primary-dark"
            >
              Filter: {operationalFilter} <span aria-hidden="true">×</span> clear
            </button>
          )}
        </div>
        {activeMainTab === "bookings" && (
          <button
            onClick={() => {
              setPriceOverride("");
              if (availableRoomsOfType.length > 0) {
                setRoomNumber(availableRoomsOfType[0].roomNumber);
              } else {
                setRoomNumber("");
              }
              setIsModalOpen(true);
            }}
            className="min-h-[44px] px-5 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark active:scale-[0.98] text-sm font-semibold text-white shadow-sm transition"
          >
            <Plus size={16} />
            New Walk-in Booking
          </button>
        )}
      </header>

      {/* Main navigation tabs */}
      <div className="flex gap-2 border-b border-gray-200 pb-3">
        <button
          onClick={() => setActiveMainTab("bookings")}
          className={`min-h-[36px] px-4 py-1.5 rounded-lg text-xs font-bold transition ${
            activeMainTab === "bookings"
              ? "bg-primary text-white shadow-sm"
              : "text-gray-650 hover:bg-gray-150 hover:text-gray-900"
          }`}
        >
          Room Reservations
        </button>
        <button
          onClick={() => setActiveMainTab("store")}
          className={`min-h-[36px] px-4 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
            activeMainTab === "store"
              ? "bg-primary text-white shadow-sm"
              : "text-gray-650 hover:bg-gray-150 hover:text-gray-900"
          }`}
        >
          <ShoppingBag size={14} />
          Spark Essentials Orders
        </button>
      </div>

      {activeMainTab === "bookings" ? (
        <>
          {/* Filters Toolbar Bookings */}
          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by Guest Name, Reference, Room..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-sm outline-none transition focus:border-primary focus:bg-white"
              />
            </div>
            
            <div className="w-full sm:w-48">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-sm outline-none transition focus:border-primary focus:bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="pending">Pending</option>
                <option value="payment-uploaded">Payment Uploaded</option>
                <option value="payment-confirmed">Payment Confirmed</option>
                <option value="confirmed">Confirmed</option>
                <option value="checked-in">Checked In</option>
                <option value="checked-out">Checked Out</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Main Table Bookings */}
          <DataTable
            columns={columns}
            rows={filteredRows}
            onRowClick={handleRowClick}
            renderMobileCard={renderBookingCard}
            emptyMessage="No bookings match the current filters."
          />
        </>
      ) : (
        <>
          {/* Filters Toolbar Store Orders */}
          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200 flex flex-col sm:flex-row gap-4">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search orders by Guest, Reference, Room..."
                value={orderSearchText}
                onChange={(e) => setOrderSearchText(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-sm outline-none transition focus:border-primary focus:bg-white"
              />
            </div>

            <div className="w-full sm:w-48">
              <select
                value={orderStatusFilter}
                onChange={(e) => setOrderStatusFilter(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-sm outline-none transition focus:border-primary focus:bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="placed">Placed</option>
                <option value="confirmed">Confirmed</option>
                <option value="out-for-delivery">Out For Delivery</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {/* Main Table Store Orders */}
          <DataTable
            columns={storeColumns}
            rows={filteredOrders}
            onRowClick={handleOrderRowClick}
            renderMobileCard={renderOrderCard}
            emptyMessage="No orders match the current filters."
          />
        </>
      )}

      </div>

      {/* Booking Detail Drawer (D-01) */}
      <Drawer
        title={selectedBooking ? `Reference: ${selectedBooking.bookingRef}` : ""}
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        className="max-w-[1120px]"
      >
        {selectedBooking && (
          <div className="space-y-6 text-sm">
            {/* Status overview */}
            <div className="grid gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:grid-cols-2">
              <div>
                <p className="text-[10px] uppercase font-bold text-gray-400">Current Status</p>
                <div className="mt-1">
                  <StatusBadge label={selectedBooking.status.replace("-", " ")} status={selectedBooking.status} />
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-gray-400 sm:text-right">Channel</p>
                <p className="text-xs font-bold text-gray-900 mt-1 uppercase sm:text-right">{selectedBooking.source}</p>
              </div>
            </div>

            {selectedBooking.paymentProofUrl && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                  <CreditCard size={14} className="text-primary" />
                  Payment Proof
                </h3>
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                    <button
                      type="button"
                      onClick={() => setImagePreview({ title: `Payment proof for ${selectedBooking.bookingRef}`, url: selectedBooking.paymentProofUrl ?? "" })}
                      className="block overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                    >
                      <img
                        src={selectedBooking.paymentProofUrl}
                        alt={`Payment proof for ${selectedBooking.bookingRef}`}
                        className="h-44 w-full object-cover"
                      />
                    </button>
                    <div className="flex flex-col justify-center gap-2 text-xs text-gray-600">
                      <p>
                        Review the uploaded payment screenshot before confirming this booking.
                      </p>
                      <p className="font-semibold text-gray-900">
                        Method: {selectedBooking.paymentMethod || "Not specified"}
                      </p>
                      <a
                        href={selectedBooking.paymentProofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[36px] w-fit items-center justify-center gap-1.5 rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 transition hover:bg-gray-50"
                      >
                        <Eye size={13} />
                        Open Full Size
                      </a>
                      <button
                        type="button"
                        onClick={() => setImagePreview({ title: `Payment proof for ${selectedBooking.bookingRef}`, url: selectedBooking.paymentProofUrl ?? "" })}
                        className="inline-flex min-h-[36px] w-fit items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-bold text-white transition hover:bg-primary-dark"
                      >
                        <Eye size={13} />
                        Preview
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Guest details card */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Guest Information</h3>
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2.5">
                <p className="flex items-center gap-2 text-gray-800">
                  <User size={16} className="text-primary shrink-0" />
                  <span>{selectedBooking.guestName}</span>
                </p>
                <p className="flex items-center gap-2 text-gray-600 text-xs">
                  <Mail size={16} className="text-gray-400 shrink-0" />
                  <span>{selectedBooking.guestEmail}</span>
                </p>
                <p className="flex items-center gap-2 text-gray-600 text-xs">
                  <Phone size={16} className="text-gray-400 shrink-0" />
                  <span>{selectedBooking.guestPhone}</span>
                </p>
              </div>
            </div>

            {/* Payment method & Reference number workstation */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard size={14} className="text-primary" />
                Payment Method & Reference
              </h3>
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-gray-400">Payment Method</p>
                    <p className="text-xs font-bold text-gray-900 mt-1 uppercase">
                      {selectedBooking.paymentMethod || "Not specified"}
                    </p>
                  </div>
                  <div>
                    <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
                      Payment Reference Number
                      <input
                        type="text"
                        value={selectedBooking.paymentReferenceNumber || ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          persistSelectedBooking({ paymentReferenceNumber: val || null });
                        }}
                        placeholder="e.g. GCash Ref # or Bank Trace #"
                        className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800 font-medium"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Check-in registration workstation */}
            {(selectedBooking.status === "confirmed" || selectedBooking.status === "checked-in") && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                    <ClipboardCheck size={14} className="text-primary" />
                    Check-in Registration
                  </h3>
                  <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    selectedBooking.guestRegistration?.signatureStatus === "signed"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-orange-50 text-orange-700"
                  }`}>
                    {selectedBooking.guestRegistration?.signatureStatus === "signed" ? "Signed" : "Pending"}
                  </span>
                </div>

                <form onSubmit={handleRegistrationSubmit} className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
                      Nationality
                      <input
                        name="nationality"
                        defaultValue={selectedBooking.guestRegistration?.nationality ?? "Filipino"}
                        className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
                      Date of Birth
                      <input
                        name="dateOfBirth"
                        type="date"
                        defaultValue={selectedBooking.guestRegistration?.dateOfBirth ?? ""}
                        className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
                      Gender
                      <select
                        name="gender"
                        defaultValue={selectedBooking.guestRegistration?.gender ?? ""}
                        className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
                      >
                        <option value="">Select</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="prefer-not-to-say">Prefer not to say</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
                      Valid ID Type
                      <select
                        name="idType"
                        defaultValue={selectedBooking.guestRegistration?.idType ?? "passport"}
                        className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
                      >
                        <option value="passport">Passport</option>
                        <option value="drivers-license">Driver's License</option>
                        <option value="national-id">National ID</option>
                        <option value="umid">UMID</option>
                        <option value="other">Other Government ID</option>
                      </select>
                    </label>
                  </div>
                  <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
                    ID Number
                    <input
                      name="idNumber"
                      defaultValue={selectedBooking.guestRegistration?.idNumber ?? ""}
                      placeholder="Government ID reference"
                      className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
                    Home Address
                    <textarea
                      name="address"
                      rows={2}
                      defaultValue={selectedBooking.guestRegistration?.address ?? ""}
                      placeholder="Guest residential address"
                      className="rounded border border-gray-200 p-2 text-xs text-gray-800"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
                      Emergency Contact
                      <input
                        name="emergencyContact"
                        defaultValue={selectedBooking.guestRegistration?.emergencyContact ?? ""}
                        placeholder="Name / Phone"
                        className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-500">
                      Vehicle Plate
                      <input
                        name="vehiclePlate"
                        defaultValue={selectedBooking.guestRegistration?.vehiclePlate ?? ""}
                        placeholder="Optional"
                        className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
                      />
                    </label>
                  </div>
                  <label className="flex min-h-[38px] items-center gap-2 rounded border border-gray-200 px-2 text-[10px] font-bold text-gray-700">
                    <input
                      type="checkbox"
                      name="signatureStatus"
                      value="signed"
                      defaultChecked={selectedBooking.guestRegistration?.signatureStatus === "signed"}
                      className="h-4 w-4 accent-primary"
                    />
                    Guest signed physical registration form
                  </label>
                  <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 sm:flex-row sm:justify-end">
                    <button
                      type="button"
                      onClick={printRegistrationPDF}
                      className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 hover:bg-gray-50"
                    >
                      <FileText size={13} />
                      Preview Registration PDF
                    </button>
                    <button
                      type="submit"
                      className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-bold text-white hover:bg-primary-dark"
                    >
                      <Save size={13} />
                      Save Registration
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Guest ID upload */}
            {(selectedBooking.status === "confirmed" || selectedBooking.status === "checked-in") && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                  <ImageIcon size={14} className="text-primary" />
                  Guest ID Attachment
                </h3>
                <div className="rounded-lg border border-gray-200 bg-white p-5">
                  <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
                    <button
                      type="button"
                      disabled={!selectedBooking.guestIdPhotoUrl}
                      onClick={() => selectedBooking.guestIdPhotoUrl && setImagePreview({ title: `Guest ID for ${selectedBooking.bookingRef}`, url: selectedBooking.guestIdPhotoUrl })}
                      className="flex h-32 w-full items-center justify-center overflow-hidden rounded-lg bg-gray-100 disabled:cursor-default"
                    >
                      {selectedBooking.guestIdPhotoUrl ? (
                        <img src={selectedBooking.guestIdPhotoUrl} alt="Guest ID preview" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon size={22} className="text-gray-400" />
                      )}
                    </button>
                    <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-250 bg-gray-50 px-4 py-4 text-center transition hover:border-primary hover:bg-primary-light/30">
                      <span className="text-xs font-bold text-gray-800">Attach Guest ID Photo</span>
                      <span className="mt-1 text-[10px] leading-relaxed text-gray-500">
                        JPG, PNG, or WebP. Image is compressed before upload.
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => {
                          void handleGuestIdUpload(event.currentTarget.files?.[0]);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  </div>
                  {guestIdUploadStatus ? (
                    <p className="mt-3 rounded bg-gray-50 px-3 py-2 text-[10px] font-semibold text-gray-600">{guestIdUploadStatus}</p>
                  ) : null}
                </div>
              </div>
            )}

            {/* Room stay details */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Stay & Accommodation</h3>
              <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
                <div className="flex justify-between">
                  <span className="font-bold text-gray-900">Room {selectedBooking.roomNumber}</span>
                  <span className="text-xs text-gray-500 capitalize">{selectedBooking.roomType.replace("-", " ")}</span>
                </div>
                <div className="grid gap-2 border-t border-gray-100 pt-3 text-xs text-gray-600">
                  <p className="flex items-center gap-2">
                    <Calendar size={14} className="text-primary shrink-0" />
                    <span>Check-In: <strong>{selectedBooking.checkIn}</strong></span>
                  </p>
                  <p className="flex items-center gap-2">
                    <Calendar size={14} className="text-primary shrink-0" />
                    <span>Check-Out: <strong>{selectedBooking.checkOut}</strong></span>
                  </p>
                  <p>Duration: {selectedBooking.numNights} nights</p>
                  <p>Guests: {selectedBooking.numGuests}</p>
                  <p>Breakfast: {selectedBooking.hasBreakfast ? "Included" : "Excluded"}</p>
                </div>
                {/* Move Booking trigger */}
                {RESCHEDULABLE_STATUSES.includes(selectedBooking.status) && (
                  <div className="border-t border-gray-100 pt-3">
                    <button
                      type="button"
                      onClick={() => setShowMoveForm(!showMoveForm)}
                      className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-gray-250 bg-white px-3 text-xs font-bold text-gray-700 transition hover:bg-gray-50 active:scale-95"
                    >
                      <Move size={14} className="text-primary" />
                      {showMoveForm ? "Cancel Move" : "Move / Upgrade Room"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Move booking form */}
            {selectedBooking && showMoveForm && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Move size={14} className="text-primary" />
                  Move / Upgrade Room Workstation
                </h3>
                <form onSubmit={handleMoveSubmit} className="rounded-lg border border-gray-200 bg-white p-5 space-y-4 text-xs">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <label className="flex flex-col gap-1.5 font-semibold text-gray-500">
                      Target Room & Type
                      <select
                        required
                        value={moveRoomId}
                        onChange={(e) => setMoveRoomId(e.target.value)}
                        className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
                      >
                        <option value="">Select Room</option>
                        {sortedRooms.map((r) => {
                          const label = roomTypeLabels[r.type] || r.type;
                          return (
                            <option key={r.id} value={r.id}>
                              Room {r.roomNumber} ({label})
                            </option>
                          );
                        })}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1.5 font-semibold text-gray-500">
                      Check-In Date
                      <input
                        type="date"
                        required
                        value={moveCheckIn}
                        onChange={(e) => setMoveCheckIn(e.target.value)}
                        className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
                      />
                    </label>

                    <label className="flex flex-col gap-1.5 font-semibold text-gray-500">
                      Check-Out Date
                      <input
                        type="date"
                        required
                        value={moveCheckOut}
                        onChange={(e) => setMoveCheckOut(e.target.value)}
                        className="min-h-[38px] rounded border border-gray-200 px-2 text-xs text-gray-800"
                      />
                    </label>
                  </div>

                  <label className="flex flex-col gap-1.5 font-semibold text-gray-500">
                    Reason for Move
                    <input
                      type="text"
                      value={moveReason}
                      onChange={(e) => setMoveReason(e.target.value)}
                      placeholder="e.g. Guest requested high floor / upgrade to Deluxe"
                      className="min-h-[38px] rounded border border-gray-200 px-3 text-xs text-gray-800"
                    />
                  </label>

                  {/* Price Delta block */}
                  {lockedManualMoveRate !== null && (
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-[10px] leading-relaxed text-blue-800">
                      <p className="font-bold">Locked manual rate will be preserved</p>
                      <p className="mt-1">
                        This booking keeps its agreed front-desk rate of {formatPrice(lockedManualMoveRate)} per night. The total will be rescaled only for the new number of nights; the target room's standard rate will not replace it.
                      </p>
                    </div>
                  )}

                  <div className="rounded-lg border border-gray-150 bg-gray-50/50 p-3 space-y-1.5">
                    <p className="font-semibold text-gray-700">Estimated Price Delta</p>
                    <div className="flex items-center justify-between text-xs">
                      <span>Price Difference:</span>
                      <span className={`font-bold ${movePriceDelta > 0 ? "text-amber-600" : movePriceDelta < 0 ? "text-emerald-600" : "text-gray-600"}`}>
                        {movePriceDelta > 0 ? "+" : ""}{formatPrice(movePriceDelta)}
                      </span>
                    </div>
                    {movePriceDelta > 0 && (
                      <p className="text-[10px] text-gray-500 leading-normal">
                        <Info size={12} className="inline mr-1 text-amber-500" />
                        This move results in an upgrade cost. The guest will need to pay the additional balance of <strong>{formatPrice(movePriceDelta)}</strong> onsite.
                      </p>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShowMoveForm(false)}
                      className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-gray-200 px-4 font-semibold text-gray-700 hover:bg-gray-50 active:scale-95"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={moveIsSubmitting || !moveRoomId || !moveCheckIn || !moveCheckOut}
                      className="inline-flex min-h-[38px] items-center justify-center rounded-lg bg-primary px-4 font-semibold text-white hover:bg-primary-dark disabled:opacity-50 active:scale-95"
                    >
                      {moveIsSubmitting ? "Moving..." : "Confirm Move"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Financial totals */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Financial Breakdown</h3>
              <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-2 text-xs">
                {selectedBooking.rateBreakdown ? (
                  <AdminPriceBreakdown breakdown={selectedBooking.rateBreakdown} total={selectedBooking.totalPrice} />
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span>Room Charge ({selectedBooking.numNights} nights)</span>
                      <span>{formatPrice(selectedBooking.ratePerNight * selectedBooking.numNights)}</span>
                    </div>
                    {selectedBooking.hasBreakfast && (
                      <div className="flex justify-between text-gray-500">
                        <span>Breakfast Service charge</span>
                        <span>{formatPrice((selectedBooking.breakfastRate || 0) * selectedBooking.numGuests * selectedBooking.numNights)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-gray-150 pt-2.5 text-sm font-bold text-gray-950">
                      <span>Total Bill Amount:</span>
                      <span className="text-primary-dark">{formatPrice(selectedBooking.totalPrice)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Breakfast selections */}
            {selectedBooking.hasBreakfast && (selectedBooking.status === "confirmed" || selectedBooking.status === "checked-in") && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                  <Utensils size={14} className="text-primary" />
                  Breakfast Selections
                </h3>
                <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-3">
                  <p className="text-[10px] leading-relaxed text-gray-500">
                    Front desk records silog selections from the physical registration form. These are shown by guest and date.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-150 text-left text-[9px] font-bold uppercase tracking-wider text-gray-400">
                          <th className="py-2 pr-3">Guest</th>
                          {getStayDates(selectedBooking).map((date) => (
                            <th key={date} className="min-w-[140px] px-2 py-2">{date}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {Array.from({ length: selectedBooking.numGuests }, (_, guestIndex) => (
                          <tr key={guestIndex}>
                            <td className="py-2 pr-3 font-semibold text-gray-800">Guest {guestIndex + 1}</td>
                            {getStayDates(selectedBooking).map((date) => {
                              const key = `${date}-guest-${guestIndex + 1}`;
                              return (
                                <td key={key} className="px-2 py-2">
                                  <select
                                    value={selectedBooking.breakfastSelections?.[key] ?? ""}
                                    onChange={(event) => handleBreakfastSelection(key, event.target.value)}
                                    className="min-h-[34px] w-full rounded border border-gray-200 bg-white px-2 text-[10px] font-semibold text-gray-700"
                                  >
                                    <option value="">Select meal</option>
                                    {breakfastConfig.silogItems
                                      .filter((item: { id: string; name: string; isActive: boolean }) => item.isActive)
                                      .map((item: { id: string; name: string; isActive: boolean }) => (
                                        <option key={item.id} value={item.name}>{item.name}</option>
                                      ))}
                                  </select>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {!selectedBooking.discountType && !selectedBooking.voucherCode && RESCHEDULABLE_STATUSES.includes(selectedBooking.status) && (
              <form onSubmit={handleApplyStaffDiscount} className="rounded-card border border-primary/20 bg-primary-light/20 p-4 space-y-3">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-900">Apply discount / voucher</h3>
                  <p className="mt-1 text-[11px] text-gray-600">Use after sighting a valid Senior/PWD ID, or enter a promo code. Pricing is recalculated and audited by the server.</p>
                </div>
                <label className="block text-xs font-semibold text-gray-700">
                  Government discount
                  <select value={staffDiscountType} onChange={(e) => setStaffDiscountType(e.target.value as "" | "senior" | "pwd")} className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-250 bg-white px-3 text-xs">
                    <option value="">None</option>
                    <option value="senior">Senior Citizen (20%)</option>
                    <option value="pwd">PWD (20%)</option>
                  </select>
                </label>
                <label className="block text-xs font-semibold text-gray-700">
                  Voucher code
                  <input value={staffVoucherCode} onChange={(e) => setStaffVoucherCode(e.target.value.toUpperCase())} maxLength={40} placeholder="Optional promo code" className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-250 bg-white px-3 text-xs uppercase" />
                </label>
                <button type="submit" disabled={isApplyingStaffDiscount || (!staffDiscountType && !staffVoucherCode.trim())} className="min-h-[44px] w-full rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">
                  {isApplyingStaffDiscount ? "Applying..." : "Apply and reprice booking"}
                </button>
              </form>
            )}

            {/* Government discount verification */}
            {selectedBooking.discountType && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                  <ShieldCheck size={14} className="text-primary" />
                  Government Discount Verification
                </h3>
                <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <div>
                      <p className="font-semibold text-gray-800">
                        Requested Discount: <span className="uppercase text-primary-dark font-bold">{selectedBooking.discountType}</span> (20% off room rate)
                      </p>
                      {selectedBooking.discountIdPhotoUrl ? (
                        <p className="text-[10px] text-gray-500 mt-1">ID photo uploaded by guest.</p>
                      ) : (
                        <p className="text-[10px] text-red-500 mt-1">No ID photo uploaded yet.</p>
                      )}
                    </div>
                    <div>
                      {selectedBooking.discountVerified ? (
                        <span className="inline-flex items-center gap-1 rounded bg-green-50 px-2 py-1 text-[10px] font-bold text-green-700">
                          ✓ Verified
                        </span>
                      ) : selectedBooking.discountRejected ? (
                        <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-1 text-[10px] font-bold text-red-700">
                          ✗ Rejected
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-yellow-50 px-2 py-1 text-[10px] font-bold text-yellow-700">
                          ⌛ Pending Review
                        </span>
                      )}
                    </div>
                  </div>

                  {selectedBooking.discountIdPhotoUrl && (
                    <div className="border border-gray-150 rounded-lg overflow-hidden max-w-[240px]">
                      <button
                        type="button"
                        onClick={() => setImagePreview({ title: `${selectedBooking.discountType?.toUpperCase()} ID for ${selectedBooking.bookingRef}`, url: selectedBooking.discountIdPhotoUrl ?? "" })}
                        className="block w-full"
                      >
                        <img
                          src={selectedBooking.discountIdPhotoUrl}
                          alt={`${selectedBooking.discountType} ID`}
                          className="w-full h-auto max-h-40 object-cover hover:opacity-90"
                        />
                      </button>
                      <p className="text-[9px] text-center text-gray-400 py-1 bg-gray-50 border-t border-gray-150">
                        Click image to preview
                      </p>
                    </div>
                  )}

                  {selectedBooking.discountVerified && (
                    <div className="text-xs text-green-700 bg-green-50/50 p-3 rounded-lg border border-green-100 leading-relaxed">
                      <p className="font-semibold">✓ Discount Approved</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">Verified by: {selectedBooking.discountVerifiedBy || "Staff"}</p>
                    </div>
                  )}

                  {selectedBooking.discountRejected && (
                    <div className="text-xs text-red-700 bg-red-50/50 p-3 rounded-lg border border-red-100 leading-relaxed">
                      <p className="font-semibold">✗ Discount Rejected</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">Rejected by: {selectedBooking.discountRejectedBy || "Staff"}</p>
                      {selectedBooking.discountRejectionReason && (
                        <p className="text-[10px] text-gray-600 mt-1 italic">Reason: {selectedBooking.discountRejectionReason}</p>
                      )}
                    </div>
                  )}

                  {!selectedBooking.discountVerified && !selectedBooking.discountRejected && (
                    showDiscountRejectForm ? (
                      <ConfirmForm
                        title="Reject this discount?"
                        message={
                          <>
                            The guest will be charged the full rate (<strong>{formatPrice(selectedBooking.originalTotalPrice ?? selectedBooking.totalPrice)}</strong> instead of the discounted amount. They are notified by email.
                          </>
                        }
                        reasonLabel="Rejection reason (for the audit log)"
                        reasonPlaceholder="e.g. ID expired, name mismatch, invalid OSCA card"
                        confirmLabel="Reject discount"
                        cancelLabel="Back"
                        variant="danger"
                        onConfirm={(reason) => void handleRejectDiscount(reason)}
                        onCancel={() => setShowDiscountRejectForm(false)}
                      />
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!discountApproveConfirm.arm("approve")) return;
                            try {
                              const updatedFields = {
                                discountVerified: true,
                                discountVerifiedBy: currentUser?.email || "staff",
                                discountRejected: false
                              };

                              const bookingDocRef = doc(db, "bookings", selectedBooking.id);
                              await updateDoc(bookingDocRef, {
                                ...updatedFields,
                                updatedAt: serverTimestamp()
                              });

                              syncSelectedBooking(updatedFields);
                              toast.success("Discount approved", `Verified by ${currentUser?.email || "staff"}`);
                            } catch (err: any) {
                              console.error("Failed to verify discount:", err);
                              toast.error("Failed to verify discount", err.message);
                              discountApproveConfirm.cancel();
                            }
                          }}
                          className="flex-grow min-h-[36px] inline-flex items-center justify-center rounded-lg bg-green-600 hover:bg-green-700 text-[11px] font-bold text-white shadow-sm transition active:scale-95"
                        >
                          {discountApproveConfirm.isPending("approve") ? "Click to confirm" : "Approve Discount"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowDiscountRejectForm(true)}
                          className="flex-grow min-h-[36px] inline-flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-[11px] font-bold text-red-600 transition"
                        >
                          Reject Discount
                        </button>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {selectedBooking.memberId && ["confirmed", "checked-in", "checked-out"].includes(selectedBooking.status) && (
              <div className="rounded-card border border-primary/20 bg-primary-light/30 p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-gray-900 uppercase tracking-wider">Spark Rewards Redemption</h3>
                    <p className="mt-1 text-[11px] text-gray-600">
                      {selectedBookingMember
                        ? `${selectedBookingMember.fullName || "Member"} · ${selectedBookingMember.memberNumber} · ${selectedBookingMember.rewardsPoints} pts`
                        : `Linked member: ${selectedBooking.memberId}`}
                    </p>
                  </div>
                  {selectedBooking.pointsRedeemed > 0 && (
                    <span className="rounded bg-white px-2 py-1 text-[10px] font-bold text-primary-dark">
                      {selectedBooking.pointsRedeemed} pts = {formatPrice(selectedBooking.pointsRedeemedValue || 0)}
                    </span>
                  )}
                </div>

                {selectedBooking.pointsRedeemed > 0 ? (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs text-gray-700">
                      Redemption already applied to this booking total.
                    </p>
                    {currentUser?.role === "admin" && selectedBooking.status === "confirmed" && (
                      <button
                        type="button"
                        disabled={isRedeemingPoints}
                        onClick={() => void handleUndoRedemption()}
                        className="min-h-[38px] rounded-lg border border-red-200 bg-white px-3 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-60"
                      >
                        Undo Redemption
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <label className="flex flex-col gap-2 text-[10px] font-semibold text-gray-600">
                      Points to redeem
                      <input
                        type="number"
                        min={1}
                        max={selectedBookingMember?.rewardsPoints || undefined}
                        value={redeemPointsInput}
                        onChange={(e) => setRedeemPointsInput(e.target.value)}
                        className="min-h-[44px] rounded border border-gray-200 bg-white px-3 text-xs"
                      />
                      <span className="font-normal text-gray-500">
                        {currentUser?.role === "admin"
                          ? `Preview: ${formatPrice(redemptionValue)} off · new total ${formatPrice(Math.max(0, selectedBooking.totalPrice - redemptionValue))}`
                          : "Admin role required to apply points redemptions."}
                      </span>
                    </label>
                    <button
                      type="button"
                      disabled={currentUser?.role !== "admin" || isRedeemingPoints || pointsToRedeem <= 0}
                      onClick={() => void handleRedeemPoints()}
                      className="min-h-[44px] rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Apply Points
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Onsite payments ledger */}
            <div className="space-y-3.5">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">On-site Payments Ledger</h3>
              
              <div className="space-y-2">
                {selectedBookingPayments.length > 0 ? (
                  <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                    {selectedBookingPayments.map((pay) => (
                      <div key={pay.id} className="pt-2 first:pt-0 flex justify-between items-center text-xs">
                        <div>
                          <p className="font-semibold text-gray-800">{pay.type === "refund" ? `Refund — ${pay.reason || pay.note}` : pay.note || "Onsite Payment"}</p>
                          <p className="text-[9px] text-gray-400">{pay.recordedAt.split("T")[0]} via {getOnsitePaymentMethodLabel(pay.method)}{pay.approvedBy ? ` · approved by ${pay.approvedBy}` : ""}</p>
                        </div>
                        <span className={`font-bold ${pay.type === "refund" ? "text-red-600" : "text-green-700"}`}>{pay.amount >= 0 ? "+" : ""}{formatPrice(pay.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">No onsite payments recorded yet.</p>
                )}

                {(() => {
                  const folio = getBookingFolio(selectedBooking);
                  return (
                    <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-xs font-semibold">
                      <span className="text-gray-600">Outstanding folio balance</span>
                      <span className={folio.balance > 0 ? "text-red-600" : "text-emerald-700"}>{formatPrice(Math.max(0, folio.balance))}</span>
                    </div>
                  );
                })()}

                {/* Inline form to record payments */}
                <form onSubmit={handleAddPaymentSubmit} className="rounded-lg border border-gray-150 p-4 space-y-3 bg-white">
                  <p className="text-xs font-bold text-gray-750">Record Onsite Payment</p>
                  
                  <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1.6fr_auto]">
                    <label className="flex flex-col gap-2 text-[10px] font-semibold text-gray-500">
                      Amount (PHP)
                      <input
                        type="number"
                        required
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        placeholder="e.g. 500"
                        className="min-h-[44px] w-full rounded border border-gray-200 px-2 text-xs"
                      />
                    </label>
                    
                    <label className="flex flex-col gap-2 text-[10px] font-semibold text-gray-500">
                      Payment Method
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="min-h-[44px] w-full rounded border border-gray-200 px-2 text-xs"
                      >
                        {onsitePaymentMethodOptions.map((method) => (
                          <option key={method.method} value={method.method}>
                            {method.label || method.method}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-2 text-[10px] font-semibold text-gray-500">
                      Payment Reference / Note
                      <input
                        type="text"
                        value={paymentNote}
                        onChange={(e) => setPaymentNote(e.target.value)}
                        placeholder="e.g. Downpayment deposit"
                        className="min-h-[44px] w-full rounded border border-gray-200 px-2 text-xs"
                      />
                    </label>
                  
                    <button
                      type="submit"
                      disabled={isRecordingPayment}
                      className="min-h-[44px] self-end rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm hover:bg-primary-dark disabled:opacity-60"
                    >
                      {isRecordingPayment ? "Recording..." : "Record payment"}
                    </button>
                  </div>
                </form>

                {currentUser?.role === "admin" && selectedBookingPayments.some((payment) => payment.amount > 0) && (
                  <form onSubmit={handleRefundSubmit} className="rounded-lg border border-red-100 bg-red-50/40 p-4 space-y-3">
                    <div>
                      <p className="text-xs font-bold text-red-800">Record Refund</p>
                      <p className="mt-1 text-[10px] text-red-700">Creates an immutable negative payment entry. Refunds cannot exceed net collected funds.</p>
                    </div>
                    <label className="block text-[10px] font-semibold text-gray-600">
                      Refund amount
                      <input type="number" min="0.01" step="0.01" required value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-red-100 bg-white px-3 text-xs" />
                    </label>
                    <label className="block text-[10px] font-semibold text-gray-600">
                      Refund method
                      <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-red-100 bg-white px-3 text-xs">
                        {onsitePaymentMethodOptions.map((method) => <option key={method.method} value={method.method}>{method.label}</option>)}
                      </select>
                    </label>
                    <label className="block text-[10px] font-semibold text-gray-600">
                      Reason
                      <textarea required maxLength={500} rows={2} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Required approval and audit context" className="mt-1 w-full rounded-lg border border-red-100 bg-white p-3 text-xs" />
                    </label>
                    <button type="submit" disabled={isRefunding} className="min-h-[44px] w-full rounded-lg bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50">{isRefunding ? "Recording refund..." : "Approve and record refund"}</button>
                  </form>
                )}
              </div>
            </div>

            {/* Early Check-In Request Panel */}
            {selectedBooking.earlyCheckIn && ["confirmed", "checked-in"].includes(selectedBooking.status) && (() => {
              const eci = selectedBooking.earlyCheckIn!;
              const isResolved = eci.status === "approved" || eci.status === "declined";
              const statusColors = {
                requested: "bg-amber-50 border-amber-200 text-amber-800",
                approved: "bg-emerald-50 border-emerald-200 text-emerald-800",
                declined: "bg-red-50 border-red-200 text-red-700"
              };

              return (
                <div className="space-y-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                    <Clock size={14} className="text-primary" />
                    Early Check-In Request
                  </h3>
                  <div className={`rounded-lg border p-4 space-y-3 text-xs ${statusColors[eci.status as keyof typeof statusColors] || "bg-gray-50 border-gray-200 text-gray-700"}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="font-bold uppercase tracking-wide text-[10px]">
                        Status: {eci.status}
                      </p>
                      {eci.resolvedBy && (
                        <span className="text-[10px] text-gray-500">Resolved by {eci.resolvedBy}</span>
                      )}
                    </div>

                    <div className="grid gap-1.5 sm:grid-cols-2 text-xs">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-bold">Requested Time</p>
                        <p className="font-semibold text-gray-900">{eci.requestedTime || "Not specified"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-bold">Submitted</p>
                        <p className="font-semibold text-gray-900">{eci.requestedAt ? new Date(eci.requestedAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "—"}</p>
                      </div>
                      {eci.notes && (
                        <div className="sm:col-span-2">
                          <p className="text-[10px] text-gray-500 uppercase font-bold">Guest Notes</p>
                          <p className="italic text-gray-700">"{eci.notes}"</p>
                        </div>
                      )}
                      {eci.staffNote && (
                        <div className="sm:col-span-2">
                          <p className="text-[10px] text-gray-500 uppercase font-bold">Staff Note</p>
                          <p className="italic text-gray-700">"{eci.staffNote}"</p>
                        </div>
                      )}
                    </div>

                    {!earlyCheckInAction && (
                      <div className="flex gap-2 pt-1 border-t border-current/10">
                        <button
                          type="button"
                          onClick={() => {
                            setEarlyCheckInAction("approve");
                            setEarlyCheckInTimeOverride(
                              EARLY_CHECKIN_TIME_OPTIONS.includes(eci.requestedTime)
                                ? eci.requestedTime
                                : EARLY_CHECKIN_DEFAULT_TIME
                            );
                            setEarlyCheckInStaffNote("");
                          }}
                          className="flex-grow min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-[11px] font-bold text-white shadow-sm transition active:scale-95"
                        >
                          <CheckCircle2 size={13} />
                          {isResolved && eci.status === "approved" ? "Re-approve" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEarlyCheckInAction("decline");
                            setEarlyCheckInTimeOverride("");
                            setEarlyCheckInStaffNote("");
                          }}
                          className="flex-grow min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-red-50 hover:bg-red-100 text-[11px] font-bold text-red-600 transition"
                        >
                          <XCircle size={13} />
                          {isResolved && eci.status === "declined" ? "Re-decline" : "Decline"}
                        </button>
                      </div>
                    )}

                    {earlyCheckInAction && (
                      <div className="space-y-3 border-t border-current/10 pt-3">
                        <p className="text-xs font-bold text-gray-800">
                          {earlyCheckInAction === "approve" ? "Confirm Approval" : "Confirm Decline"}
                        </p>

                        {earlyCheckInAction === "approve" && (
                          <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                            Confirmed Check-In Time
                            <select
                              value={earlyCheckInTimeOverride}
                              onChange={(e) => setEarlyCheckInTimeOverride(e.target.value)}
                              className="min-h-[36px] w-full rounded border border-gray-200 bg-white px-2 text-xs text-gray-900 outline-none"
                            >
                              {EARLY_CHECKIN_TIME_OPTIONS.map((time) => (
                                <option key={time} value={time}>{time}</option>
                              ))}
                            </select>
                          </label>
                        )}

                        <label className="flex flex-col gap-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                          Staff Note (sent to guest)
                          <textarea
                            value={earlyCheckInStaffNote}
                            onChange={(e) => setEarlyCheckInStaffNote(e.target.value)}
                            placeholder={
                              earlyCheckInAction === "approve"
                                ? "e.g. Room will be ready by 10 AM, please proceed to front desk..."
                                : "e.g. All rooms are occupied until standard check-in time..."
                            }
                            rows={2}
                            className="w-full rounded border border-gray-200 bg-white p-2 text-xs text-gray-800 outline-none resize-none"
                          />
                        </label>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={isResolvingEarlyCheckIn}
                            onClick={async () => {
                              setIsResolvingEarlyCheckIn(true);
                              try {
                                const status = earlyCheckInAction === "approve" ? "approved" : "declined";
                                const confirmedTime = status === "approved" ? (earlyCheckInTimeOverride || undefined) : undefined;
                                const result = await resolveEarlyCheckin(selectedBooking.id, status, earlyCheckInStaffNote || undefined, confirmedTime);
                                if (!result.success) {
                                  toast.error("Failed to resolve", result.error || "An unexpected error occurred.");
                                } else {
                                  toast.success(
                                    earlyCheckInAction === "approve" ? "Early check-in approved" : "Early check-in declined",
                                    "Guest will be notified by email."
                                  );
                                  setEarlyCheckInAction(null);
                                  syncSelectedBooking({
                                    earlyCheckIn: {
                                      ...eci,
                                      status,
                                      resolvedAt: new Date().toISOString(),
                                      resolvedBy: currentUser?.email || "Staff",
                                      staffNote: earlyCheckInStaffNote || null,
                                      confirmedTime: confirmedTime || null
                                    }
                                  } as Partial<Booking>);
                                }
                              } finally {
                                setIsResolvingEarlyCheckIn(false);
                              }
                            }}
                            className={`flex-grow min-h-[36px] inline-flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-bold text-white shadow-sm transition active:scale-95 disabled:opacity-60 ${
                              earlyCheckInAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                            }`}
                          >
                            {isResolvingEarlyCheckIn ? <Loader2 size={13} className="animate-spin" /> : null}
                            {earlyCheckInAction === "approve" ? "Send Approval" : "Send Decline"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEarlyCheckInAction(null)}
                            className="min-h-[36px] rounded-lg border border-gray-250 px-4 text-[11px] font-bold text-gray-700 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Email Actions Panel */}
            <div className="space-y-3">
              <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                <Mail size={14} className="text-primary" />
                Resend Transactional Email
              </h3>
              <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
                <p className="text-[10px] leading-relaxed text-gray-500">
                  Select an email template below to resend to the guest (<strong>{selectedBooking.guestEmail}</strong>).
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(() => {
                    const getRecommendedEmailAction = (status: Booking["status"]) => {
                      if (status === "pending" || status === "payment-uploaded") return "booking-submitted";
                      if (status === "payment-confirmed") return "payment-confirmed";
                      if (status === "confirmed") return "booking-confirmed";
                      if (status === "checked-in") return "checkin-reminder";
                      if (status === "checked-out") return "payment-confirmed";
                      if (status === "cancelled") return "booking-cancelled";
                      return null;
                    };

                    const recommendedAction = getRecommendedEmailAction(selectedBooking.status);

                    return [
                      { action: "booking-submitted", label: "Booking Submitted" },
                      { action: "booking-confirmed", label: "Booking Confirmed" },
                      { action: "payment-confirmed", label: "Payment Confirmed" },
                      { action: "checkin-reminder", label: "Check-in Reminder" },
                      { action: "booking-cancelled", label: "Booking Cancelled" },
                      { action: "discount-rejected", label: "Discount Rejected" },
                    ].map(({ action, label }) => {
                      const isRecommended = recommendedAction === action || (action === "discount-rejected" && selectedBooking.discountRejected);
                      const isPending = resendingEmailAction === action;

                      return (
                        <button
                          key={action}
                          type="button"
                          disabled={resendingEmailAction !== null}
                          onClick={() => handleResendEmail(action)}
                          className={`min-h-[40px] px-3 rounded-lg text-[11px] font-bold transition flex items-center justify-center gap-1.5 active:scale-95 ${
                            isRecommended
                              ? "bg-primary hover:bg-primary-dark text-white border-transparent shadow-sm"
                              : "bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 disabled:opacity-50"
                          }`}
                        >
                          {isPending ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : null}
                          {label}
                          {isRecommended && !isPending && (
                            <span className="ml-1 rounded bg-white/20 px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wider text-white">
                              Rec
                            </span>
                          )}
                        </button>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>

            {(["confirmed", "checked-in", "checked-out"] as string[]).includes(selectedBooking.status) && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                  <FileText size={14} className="text-primary" />
                  Incidental Charge Ledger
                </h3>
                <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
                  {selectedBookingCharges.length === 0 ? (
                    <p className="text-xs italic text-gray-400">No incidental charges recorded.</p>
                  ) : (
                    <div className="divide-y divide-gray-100 rounded-lg border border-gray-150">
                      {selectedBookingCharges.map((charge) => (
                        <div key={charge.id} className="flex items-center justify-between gap-3 p-3 text-xs">
                          <div className="min-w-0">
                            <p className="font-semibold text-gray-800">{charge.label}</p>
                            <p className="mt-0.5 text-[10px] text-gray-500 capitalize">
                              {charge.category.replace(/-/g, " ")} · {charge.addedAt ? charge.addedAt.slice(0, 10) : "Pending timestamp"}
                              {charge.voidOf ? " · reversal" : ""}
                            </p>
                            {charge.note ? <p className="mt-1 text-[10px] text-gray-500">{charge.note}</p> : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className={`font-bold ${charge.amount < 0 ? "text-red-600" : "text-gray-900"}`}>{formatPrice(charge.amount)}</span>
                            {!charge.voidOf && charge.amount > 0 && !selectedBookingCharges.some((entry) => entry.voidOf === charge.id) && selectedBooking.status !== "checked-out" ? (
                              <button type="button" onClick={() => setChargeToVoid(charge)} className="min-h-[44px] rounded-lg px-3 text-[10px] font-bold text-red-600 hover:bg-red-50">Void</button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedBooking.status !== "checked-out" && (
                    <form onSubmit={handleAddChargeSubmit} className="space-y-3 rounded-lg bg-gray-50 p-3">
                      <p className="text-xs font-bold text-gray-750">Add charge</p>
                      <label className="block text-[10px] font-semibold text-gray-600">
                        Category
                        <select value={chargeCategory} onChange={(e) => setChargeCategory(e.target.value as IncidentalChargeCategory)} className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 text-xs">
                          <option value="late-checkout">Late checkout</option>
                          <option value="early-checkin">Early check-in</option>
                          <option value="extra-person">Extra person / bed</option>
                          <option value="damage">Damage</option>
                          <option value="laundry">Laundry</option>
                          <option value="other">Other</option>
                        </select>
                      </label>
                      <label className="block text-[10px] font-semibold text-gray-600">
                        Label
                        <input required maxLength={120} value={chargeLabel} onChange={(e) => setChargeLabel(e.target.value)} placeholder="e.g. Late checkout until 2 PM" className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 text-xs" />
                      </label>
                      <label className="block text-[10px] font-semibold text-gray-600">
                        Amount ({config.currencySymbol})
                        <input required type="number" min="0.01" max="1000000" step="0.01" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 text-xs" />
                      </label>
                      <label className="block text-[10px] font-semibold text-gray-600">
                        Note (optional)
                        <input maxLength={300} value={chargeNote} onChange={(e) => setChargeNote(e.target.value)} placeholder="Operational context for the audit trail" className="mt-1 min-h-[44px] w-full rounded-lg border border-gray-200 bg-white px-3 text-xs" />
                      </label>
                      <button type="submit" disabled={isSavingCharge} className="min-h-[44px] w-full rounded-lg bg-primary px-4 text-xs font-bold text-white disabled:opacity-60">
                        {isSavingCharge ? "Adding charge..." : "Add to folio"}
                      </button>
                    </form>
                  )}
                </div>
              </div>
            )}

            {chargeToVoid ? (
              <ConfirmForm
                title="Void incidental charge?"
                message={<>A negative reversal for <strong>{chargeToVoid.label}</strong> ({formatPrice(chargeToVoid.amount)}) will be appended. The original entry will remain in the audit trail.</>}
                reasonLabel="Void reason"
                reasonPlaceholder="Required audit note"
                confirmLabel="Add reversal"
                cancelLabel="Keep charge"
                variant="danger"
                reasonRequired
                onConfirm={(reason) => void handleVoidCharge(reason)}
                onCancel={() => setChargeToVoid(null)}
              />
            ) : null}

            {/* Checkout folio */}
            {(selectedBooking.status === "checked-in" || selectedBooking.status === "checked-out") && (
              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                  <CreditCard size={14} className="text-primary" />
                  Checkout Folio Review
                </h3>
                <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-2 text-xs">
                  {(() => {
                    const folio = getBookingFolio(selectedBooking);
                    return (
                      <>
                        <div className="flex justify-between">
                          <span>Room and booked add-ons</span>
                          <span>{formatPrice(selectedBooking.totalPrice)}</span>
                        </div>
                        {folio.storeCharges.length > 0 ? (
                          <div className="space-y-1 border-t border-gray-100 pt-2">
                            <p className="font-bold text-gray-700">Spark Essentials billed to room</p>
                            {folio.storeCharges.map((order) => (
                              <div key={order.id} className="flex justify-between text-gray-500">
                                <span>{order.orderRef}</span>
                                <span>{formatPrice(order.totalAmount)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex justify-between text-gray-400">
                            <span>No delivered store charges billed yet</span>
                            <span>{formatPrice(0)}</span>
                          </div>
                        )}
                        {folio.charges.length > 0 && (
                          <div className="space-y-1 border-t border-gray-100 pt-2">
                            <p className="font-bold text-gray-700">Incidental charges</p>
                            {folio.charges.map((charge) => (
                              <div key={charge.id} className="flex justify-between text-gray-500">
                                <span>{charge.label}</span>
                                <span>{formatPrice(charge.amount)}</span>
                              </div>
                            ))}
                            <div className="flex justify-between font-semibold text-gray-700">
                              <span>Incidental subtotal</span>
                              <span>{formatPrice(folio.chargesTotal)}</span>
                            </div>
                          </div>
                        )}
                        <div className="flex justify-between border-t border-gray-150 pt-2 font-bold text-gray-950">
                          <span>Folio total</span>
                          <span>{formatPrice(folio.grandTotal)}</span>
                        </div>
                        <div className="flex justify-between text-gray-500">
                          <span>Payments collected</span>
                          <span>-{formatPrice(folio.paymentsTotal)}</span>
                        </div>
                        <div className={`flex justify-between rounded-lg px-3 py-2 text-sm font-bold ${
                          folio.balance > 0 ? "bg-red-50 text-red-700" : folio.balance < 0 ? "bg-orange-50 text-orange-700" : "bg-emerald-50 text-emerald-700"
                        }`}>
                          <span>{folio.balance > 0 ? "Balance due at checkout" : folio.balance < 0 ? "Overpaid amount" : "Fully settled"}</span>
                          <span>{formatPrice(Math.abs(folio.balance))}</span>
                        </div>
                        <button
                          type="button"
                          onClick={printBookingReceiptPDF}
                          className="mt-2 inline-flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg border border-gray-255 text-[10px] font-bold text-gray-700 hover:bg-gray-50"
                        >
                          <FileText size={13} />
                          Print Booking Receipt (PDF)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const params = new URLSearchParams({
                              bookingRef: selectedBooking.bookingRef,
                              roomId: selectedBooking.roomId,
                              checkIn: selectedBooking.checkIn,
                              checkOut: selectedBooking.checkOut,
                              guests: String(selectedBooking.numGuests),
                              paymentMethod: selectedBooking.paymentMethod,
                              total: String(selectedBooking.totalPrice)
                            });
                            window.open(`${getApiBaseUrl().replace(/\/$/, "")}/book/confirm?${params.toString()}`, "_blank");
                          }}
                          className="mt-2 inline-flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg border border-gray-255 text-[10px] font-bold text-gray-700 hover:bg-gray-50"
                        >
                          <FileText size={13} />
                          Preview Folio / Receipt Page
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Allowed transitions buttons */}
            <div className="grid gap-2 border-t border-gray-150 pt-4 sm:grid-cols-2">
              {selectedBooking.status === "pending" && (
                <button
                  onClick={() => handleStatusTransition("confirmed")}
                  className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-green-600 hover:bg-green-700 text-xs font-bold text-white shadow-sm transition active:scale-95"
                >
                  Confirm Pay-at-Hotel Booking
                </button>
              )}

              {selectedBooking.status === "payment-uploaded" && (
                <button
                  onClick={() => handleStatusTransition("payment-confirmed")}
                  className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-green-600 hover:bg-green-700 text-xs font-bold text-white shadow-sm transition active:scale-95"
                >
                  Mark Payment Confirmed
                </button>
              )}

              {selectedBooking.status === "payment-confirmed" && (
                <button
                  onClick={() => handleStatusTransition("confirmed")}
                  className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm transition active:scale-95"
                >
                  Confirm Booking
                </button>
              )}

              {(selectedBooking.status === "confirmed" || selectedBooking.status === "payment-confirmed") && selectedBookingCheckInReadiness && (
                <div className="sm:col-span-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-gray-900">Ready for check-in</p>
                      <p className="mt-0.5 text-[11px] text-gray-600">
                        Guest ID, registration details, and signature must be saved first.
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                      selectedBookingCheckInReadiness.ready
                        ? "bg-status-green-bg text-status-green-text"
                        : "bg-amber-50 text-amber-700"
                    }`}>
                      {selectedBookingCheckInReadiness.ready ? "Ready" : "Missing items"}
                    </span>
                  </div>
                  {!selectedBookingCheckInReadiness.ready ? (
                    <ul className="mt-3 grid gap-1 text-[11px] font-medium text-amber-800 sm:grid-cols-2">
                      {selectedBookingCheckInReadiness.missingItems.map((item) => (
                        <li key={item} className="flex items-center gap-1.5">
                          <XCircle size={12} className="shrink-0" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button
                    onClick={() => handleStatusTransition("checked-in")}
                    disabled={!selectedBookingCheckInReadiness.ready}
                    className="mt-3 min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm transition active:scale-95 disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none disabled:active:scale-100"
                  >
                    Verify Guest ID & Check In
                  </button>
                </div>
              )}

              {selectedBooking.status === "checked-in" && (
                <button
                  onClick={() => {
                    const folio = getBookingFolio(selectedBooking);
                    if (folio.balance > 0 && !checkoutWithBalanceConfirm.arm("confirm")) return;
                    handleStatusTransition("checked-out");
                  }}
                  className={`min-h-[44px] w-full inline-flex items-center justify-center rounded-lg text-xs font-bold text-white shadow-sm transition active:scale-95 ${
                    getBookingFolio(selectedBooking).balance > 0 && checkoutWithBalanceConfirm.isPending("confirm")
                      ? "bg-orange-600 hover:bg-orange-700"
                      : "bg-gray-900 hover:bg-black"
                  }`}
                >
                  {checkoutWithBalanceConfirm.isPending("confirm")
                    ? `Confirm — ${formatPrice(getBookingFolio(selectedBooking).balance)} still due`
                    : "Check Out Room Folio"}
                </button>
              )}

              {selectedBooking.status !== "checked-out" && selectedBooking.status !== "cancelled" && (
                showBookingCancelForm ? (
                  <ConfirmForm
                    title="Cancel this booking?"
                    message="The guest will be notified by email. The booking record is kept in the audit log."
                    reasonLabel="Cancellation reason (optional)"
                    reasonPlaceholder="e.g. guest requested, no-show, double-booked"
                    confirmLabel="Cancel booking"
                    cancelLabel="Back"
                    variant="danger"
                    onConfirm={(reason) => void handleCancelBooking(reason)}
                    onCancel={() => setShowBookingCancelForm(false)}
                  />
                ) : (
                  <button
                    onClick={() => setShowBookingCancelForm(true)}
                    className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-xs font-bold text-red-600 transition"
                  >
                    Cancel Booking
                  </button>
                )
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Store Order Detail Drawer (D-05) */}
      <Drawer
        title={selectedOrder ? `Order Reference: ${selectedOrder.orderRef}` : ""}
        open={isOrderDrawerOpen}
        onClose={() => setIsOrderDrawerOpen(false)}
        className="max-w-[760px]"
      >
        {selectedOrder && (
          <div className="space-y-8 text-sm">
            {/* Status & Payment Info */}
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex justify-between items-center">
              <div>
                <span className="text-[10px] uppercase font-bold text-gray-400">Order Status</span>
                <div className="mt-1">
                  <StatusBadge 
                    label={selectedOrder.status.replace("-", " ")} 
                    status={selectedOrder.status === "delivered" ? "confirmed" : selectedOrder.status === "cancelled" ? "dirty" : "pending"} 
                  />
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-gray-400 text-right">Settlement Method</p>
                <p className="text-xs font-bold text-gray-900 mt-1 uppercase text-right">
                  {selectedOrder.paymentMethod === "add-to-bill" ? "Room Bill" : selectedOrder.paymentMethod}
                </p>
              </div>
            </div>

            {/* Room stay details */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Delivery Destination</h3>
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="font-bold text-gray-900">Room {selectedOrder.roomNumber}</span>
                  <span className="text-gray-655">{selectedOrder.guestName}</span>
                </div>
                {selectedOrder.notes && (
                  <div className="border-t border-gray-100 pt-2 mt-2">
                    <span className="font-bold text-gray-700">Delivery Instructions:</span>
                    <p className="text-gray-500 italic mt-0.5">{selectedOrder.notes}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Items Ordered List */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Ordered Items</h3>
              <div className="divide-y divide-gray-150 border border-gray-200 rounded-lg p-3 bg-white space-y-2">
                {selectedOrder.items.map((item: any, idx: number) => (
                  <div key={idx} className="pt-2 first:pt-0 flex justify-between items-center text-xs">
                    <div>
                      <p className="font-semibold text-gray-800">{item.name}</p>
                      <p className="text-[9px] text-gray-400">{formatPrice(item.price)} each • Quantity: {item.quantity}</p>
                    </div>
                    <span className="font-bold text-gray-900">{formatPrice(item.price * item.quantity)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-200 pt-2.5 text-sm font-bold text-gray-955 font-heading">
                  <span>Grand Total:</span>
                  <span className="text-primary-dark">{formatPrice(selectedOrder.totalAmount)}</span>
                </div>
              </div>
            </div>

            {/* Billing status information if room billing is active */}
            {selectedOrder.paymentMethod === "add-to-bill" && (
              <div className="rounded-lg border border-gray-150 p-4 space-y-2 bg-gray-50/50">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <CreditCard size={12} className="text-primary" />
                  Room Charge Processing
                </span>
                {selectedOrder.isBilled ? (
                  <p className="text-xs text-green-700 font-bold">
                    ✓ Billed to Room {selectedOrder.roomNumber} guest folio at {new Date(selectedOrder.billedAt || "").toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                ) : (
                  <p className="text-xs text-gray-500 leading-relaxed font-semibold">
                    This order is set to be charged directly to the guest room invoice on checkout. Mark as delivered to permit folio billing.
                  </p>
                )}
              </div>
            )}

            {selectedOrder.paymentMethod === "gcash" && selectedOrder.paymentProofUrl && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">GCash Proof of Remittance</h3>
                <div className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
                    <button
                      type="button"
                      onClick={() => setImagePreview({ title: `GCash proof for ${selectedOrder.orderRef}`, url: selectedOrder.paymentProofUrl })}
                      className="block overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                    >
                      <img
                        src={selectedOrder.paymentProofUrl}
                        alt={`GCash proof for ${selectedOrder.orderRef}`}
                        className="h-44 w-full object-cover"
                      />
                    </button>
                    <div className="flex flex-col justify-center gap-2 text-xs text-gray-600">
                      <p>Review the uploaded store payment screenshot before confirming this order.</p>
                      <a
                        href={selectedOrder.paymentProofUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[36px] w-fit items-center justify-center gap-1.5 rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 transition hover:bg-gray-50"
                      >
                        <Eye size={13} />
                        Open Full Size
                      </a>
                      <button
                        type="button"
                        onClick={() => setImagePreview({ title: `GCash proof for ${selectedOrder.orderRef}`, url: selectedOrder.paymentProofUrl })}
                        className="inline-flex min-h-[36px] w-fit items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-bold text-white transition hover:bg-primary-dark"
                      >
                        <Eye size={13} />
                        Preview
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Order status actions */}
            <div className="pt-4 border-t border-gray-150 flex flex-col gap-2">
              {selectedOrder.status === "placed" && (
                showOrderCancelForm ? (
                  <ConfirmForm
                    title="Cancel this order?"
                    message={`Order ${selectedOrder.orderRef} will be marked as cancelled. The guest will be notified by email.`}
                    reasonLabel="Cancellation reason (optional)"
                    reasonPlaceholder="e.g. out of stock, guest requested, wrong address"
                    confirmLabel="Cancel order"
                    cancelLabel="Back"
                    variant="danger"
                    onConfirm={(reason) => void handleCancelOrder(reason)}
                    onCancel={() => setShowOrderCancelForm(false)}
                  />
                ) : (
                  <>
                    <button
                      onClick={() => {
                        void updateStoreOrderStatus(selectedOrder.id, "confirmed");
                        setSelectedOrder((prev: any) => prev ? { ...prev, status: "confirmed" } : null);
                      }}
                      className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-green-600 hover:bg-green-700 text-xs font-bold text-white shadow-sm transition active:scale-95"
                    >
                      Confirm & Prepare Order
                    </button>

                    <button
                      onClick={() => setShowOrderCancelForm(true)}
                      className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-xs font-bold text-red-600 transition"
                    >
                      Cancel Order
                    </button>
                  </>
                )
              )}

              {selectedOrder.status === "confirmed" && (
                showOrderCancelForm ? (
                  <ConfirmForm
                    title="Cancel this order?"
                    message={`Order ${selectedOrder.orderRef} will be marked as cancelled. The guest will be notified by email.`}
                    reasonLabel="Cancellation reason (optional)"
                    reasonPlaceholder="e.g. out of stock, guest requested, wrong address"
                    confirmLabel="Cancel order"
                    cancelLabel="Back"
                    variant="danger"
                    onConfirm={(reason) => void handleCancelOrder(reason)}
                    onCancel={() => setShowOrderCancelForm(false)}
                  />
                ) : (
                  <>
                    <button
                      onClick={() => {
                        void updateStoreOrderStatus(selectedOrder.id, "out-for-delivery");
                        setSelectedOrder((prev: any) => prev ? { ...prev, status: "out-for-delivery" } : null);
                      }}
                      className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm transition active:scale-95"
                    >
                      Dispatch Out for Delivery
                    </button>

                    <button
                      onClick={() => setShowOrderCancelForm(true)}
                      className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-xs font-bold text-red-650 transition"
                    >
                      Cancel Order
                    </button>
                  </>
                )
              )}

              {selectedOrder.status === "out-for-delivery" && (
                <button
                  onClick={async () => {
                    try {
                      await updateStoreOrderStatus(selectedOrder.id, "delivered");
                      setSelectedOrder((prev: any) => prev ? {
                        ...prev,
                        status: "delivered",
                        deliveredAt: new Date().toISOString()
                      } : null);
                      toast.success("Order delivered", "The delivery and direct-payment tender were recorded together.");
                    } catch (error) {
                      toast.error("Could not complete delivery", error instanceof Error ? error.message : String(error));
                    }
                  }}
                  className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-gray-900 hover:bg-black text-xs font-bold text-white shadow-sm transition active:scale-95"
                >
                  Confirm Room Delivered
                </button>
              )}

              {selectedOrder.status === "delivered" && selectedOrder.paymentMethod === "add-to-bill" && !selectedOrder.isBilled && (
                <button
                  onClick={() => {
                    void billStoreOrder(selectedOrder.id);
                    setSelectedOrder((prev: any) => prev ? { ...prev, isBilled: true, billedAt: new Date().toISOString() } : null);
                    toast.success("Order charged to folio", `${formatPrice(selectedOrder.totalAmount)} added to Room ${selectedOrder.roomNumber}`);
                  }}
                  className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm transition active:scale-95"
                >
                  Charge to Guest Folio
                </button>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Walk-in Booking Modal (M-05) */}
      <Modal
        title="Create Walk-in Booking"
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        footer={
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              form="walkin-form"
              onClick={() => setIsModalOpen(false)}
              className="min-h-[44px] px-5 rounded-lg border border-gray-250 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <PrimaryButton
              type="submit"
              form="walkin-form"
              disabled={!roomNumber || isWalkinSubmitting}
              className="min-w-[150px]"
            >
              {isWalkinSubmitting ? "Confirming..." : "Confirm Reservation"}
            </PrimaryButton>
          </div>
        }
      >
        <form onSubmit={handleWalkinSubmit} id="walkin-form" className="space-y-4 text-sm">
          <span className="sr-only">Confirm Reservation</span>
          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Guest Full Name
            <input
              type="text"
              required
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Maria Santos"
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-xs outline-none focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Guest Phone
            <input
              type="tel"
              value={guestPhone}
              onChange={(e) => setGuestPhone(e.target.value)}
              placeholder="+63 912 345 6789"
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-xs outline-none focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Guest Email Address
            <input
              type="email"
              value={guestEmail}
              onChange={(e) => setGuestEmail(e.target.value)}
              placeholder="maria@example.com"
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-xs outline-none focus:bg-white"
            />
          </label>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Room Type
            <select
              value={roomType}
              onChange={(e) => {
                setRoomType(e.target.value);
                const matching = rooms.filter(r => r.type === e.target.value && r.status === "available");
                if (matching.length > 0) {
                  setRoomNumber(matching[0].roomNumber);
                } else {
                  setRoomNumber("");
                }
              }}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
            >
              {roomTypes.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Select Available Room Number
            <select
              value={roomNumber}
              onChange={(e) => setRoomNumber(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs text-gray-900"
              required
            >
                {availableRoomsOfType.length > 0 ? (
                  availableRoomsOfType.map(r => (
                    <option key={r.id} value={r.roomNumber}>
                      Room {r.roomNumber} ({roomTypes.find(t => t.value === r.type)?.shortLabel || r.type}, ₱{roomTypes.find(t => t.value === r.type)?.pricePerNight ?? 0}/night)
                    </option>
                  ))
                ) : (
                  <option value="" disabled>No vacant rooms available</option>
                )}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Check-In Date
            <input
              type="date"
              required
              value={checkInDate}
              onChange={(e) => setCheckInDate(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-255 bg-white py-2 px-3 text-xs"
            />
          </label>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Check-Out Date
            <input
              type="date"
              required
              value={checkOutDate}
              onChange={(e) => setCheckOutDate(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-255 bg-white py-2 px-3 text-xs"
            />
          </label>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Number of Guests
            <input
              type="number"
              min={1}
              required
              value={numGuests}
              onChange={(e) => setNumGuests(parseInt(e.target.value) || 1)}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-xs"
            />
          </label>

          <div className="space-y-2 pt-1">
            <label className="flex items-start gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={hasBreakfast}
                onChange={(e) => setHasBreakfast(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary-light"
              />
              <span>Include Daily Breakfast (+₱{breakfastConfig.ratePerPersonPerNight || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT}/guest/night)</span>
            </label>

            <label className="flex items-start gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={immediateCheckIn}
                onChange={(e) => setImmediateCheckIn(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary-light"
              />
              <span>Check-In Guest Immediately</span>
            </label>
          </div>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Payment Term
            <select
              value={walkinPayment}
              onChange={(e) => setWalkinPayment(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
            >
              <option value="pay-at-hotel">Pay at Hotel</option>
              <option value="cash">Cash on Hand</option>
              <option value="card">Onsite Card Reader</option>
            </select>
          </label>

          <>
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
              Government Discount
              <select value={walkinDiscountType} onChange={(e) => setWalkinDiscountType(e.target.value as "" | "senior" | "pwd")} className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white px-3 text-xs">
                <option value="">None</option>
                <option value="senior">Senior Citizen (20%)</option>
                <option value="pwd">PWD (20%)</option>
              </select>
            </label>
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
              Voucher Code
              <input value={walkinVoucherCode} onChange={(e) => setWalkinVoucherCode(e.target.value.toUpperCase())} maxLength={40} placeholder="Optional" className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white px-3 text-xs uppercase" />
            </label>
          </>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Manual Price Override (Optional)
            <input
              type="number"
              placeholder={`Standard price: ₱${totalPrice.toLocaleString()}`}
              value={priceOverride}
              onChange={(e) => setPriceOverride(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
            />
          </label>

          {/* Pricing Summary display */}
          <div className="rounded-lg bg-gray-50 border border-gray-200 p-4 space-y-1 text-xs">
            <div className="flex justify-between">
              <span>Duration:</span>
              <span className="font-bold">{numNights} night(s)</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Accommodation Cost:</span>
              <span>{formatPrice(roomChargeTotal)}</span>
            </div>
            {hasBreakfast && (
              <div className="flex justify-between text-gray-500">
                <span>Breakfast Surcharges:</span>
                <span>{formatPrice(brekkieRate * numGuests * numNights)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-150 pt-2 text-sm font-bold text-primary-dark">
              <span>Final Total Price:</span>
              <span>{formatPrice(priceOverride !== "" ? Number(priceOverride) : totalPrice)}</span>
            </div>
          </div>
        </form>
      </Modal>
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
    </>
  );
}
