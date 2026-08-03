import { useState, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useAdmin, Booking, OnsitePayment, IncidentalCharge, IncidentalChargeCategory } from "../context/AdminContext";
import { calculateSeasonalAwareRoomTotal, compressImageFile, getCheckInReadiness, getLatestPaymentReference, getManilaDateInfo, getLockedManualNightlyRate, type BookingRateBreakdown, type BookingSourceConfig, type CancellationPreview, type PaymentMethodConfig, type Reservation, calculateSeasonalAwareRoomBreakdown, calculateVoucherDiscount, calculatePercentDiscount, calculateVoucherBase, calculateVatBreakdown, computeBookingFolio, DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT, getBookingVatBreakdown, requiredExtraBedsFor } from "@spark-inn/shared";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Modal } from "../components/Modal";
import { PaymentSuccessModal } from "../components/PaymentSuccessModal";
import { ConfirmWithBalanceForm } from "../components/ConfirmWithBalanceForm";
import { StatusBadge } from "../components/StatusBadge";
import { PrimaryButton } from "../components/PrimaryButton";
import { ConfirmForm } from "../components/ConfirmForm";
import { CancellationPreviewPanel } from "../components/CancellationPreviewPanel";
import { CancellationLiabilityPanel, CancellationExceptionModal } from "../components/CancellationLiabilityPanel";
import {
  BookingCheckInReadiness,
  BookingDrawerActionFooter,
  BookingDrawerSectionPanel,
  BookingDrawerWorkspaceHeader,
  type BookingDrawerSection
} from "../components/BookingDrawerWorkspace";
import { BookingRegistrationForm } from "../components/BookingRegistrationForm";
import { BookingEmailActions } from "../components/BookingEmailActions";
import { IncidentalChargeList } from "../components/IncidentalChargeList";
import { useToast } from "../components/Toast";
import { useTwoClickConfirm } from "../utils/useTwoClickConfirm";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";
import { getApiBaseUrl } from "../utils/apiBaseUrl";
import {
  Calendar,
  Mail,
  Plus,
  Minus,
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
  Info,
  ChevronDown,
  ChevronRight,
  Search,
  FlaskConical
} from "lucide-react";

const RESCHEDULABLE_STATUSES = ["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"];

// Per MRB-07 (2026-08-02, per decision #159): one room inside the New
// Booking modal's reservation. The desk picks a type and a specific
// room per stay and distributes the party's guests across them; the
// lead guest, dates, payment, discount and voucher stay
// reservation-level. `key` is a stable React key so removing a middle
// row doesn't reshuffle the inputs of the rows after it.
type WalkinRoomStay = {
  key: string;
  roomType: string;
  roomNumber: string;
  numAdults: number;
  numChildren: number;
  extraBedCount: number;
};

// Per MRB-07 (2026-08-02, per decision #159): a row in the main
// Bookings list. `booking` is an ungrouped room row (the historical
// shape); `reservation` is the synthetic parent row for a reservation
// covering several rooms; `roomStay` is one of that reservation's rooms
// rendered nested beneath it. Grouping is derived from the
// `reservation*` fields already denormalized onto each booking, so the
// list needs no extra reads to render a group.
type BookingListRow = Booking & {
  listRowKind: "booking" | "reservation" | "roomStay";
  listReservationId?: string;
  listRoomCount?: number;
  listChildBookings?: Booking[];
  listReservationBalance?: number;
  // Per MRB-12 (2026-08-03, per decision #179 — proposed):
  // the `Reservation` header is attached to the row so the
  // Status column can render the aggregate `paymentStatus`
  // + the cancellation-count chip (MRB-12-02) without a
  // second lookup. Absent for N=1 / legacy null-
  // `reservationId` rows (the existing byte-equivalent path).
  listReservationHeader?: Reservation;
  // Per MRB-12 (2026-08-03, per decision #179 — proposed):
  // the reservation-scope paid amount (sum of positive
  // payment entries + negative refund entries on
  // `reservations/{id}/payments/`). Used by the row's
  // Total + Balance rendering and the drawer reservation
  // strip's Paid + Balance pills (MRB-12-03). Absent
  // for N=1 / legacy.
  listReservationPaidAmount?: number;
};

let walkinRoomStayKeySeq = 0;
const createWalkinRoomStay = (roomType: string): WalkinRoomStay => ({
  key: `stay_${++walkinRoomStayKeySeq}`,
  roomType,
  roomNumber: "",
  numAdults: 1,
  numChildren: 0,
  extraBedCount: 0
});

function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.toDate && typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string") return new Date(value);
  if (value.seconds) return new Date(value.seconds * 1000);
  return null;
}

// Per MRB-14 (2026-08-03, per decision #180 — proposed):
// the per-child dates UI uses a short date string
// ("MMM D" → "Jan 1") for the actual-range display. The
// admin `checkIn` / `checkOut` row already renders the
// longer ISO string from the booking; the new
// divergent-dates pill reads the `Reservation`
// header's `actualDateRange` (Date objects) and the
// children's per-child `checkIn` / `checkOut` (ISO
// strings from the booking listener). The helper
// normalises both shapes.
function formatShortDate(value: any): string {
  const date = toDate(value);
  if (!date) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

// Per 2026-07-24 (refactor/unify-payment-reference-fields):
// `getLatestPaymentReference` is now imported from
// `@spark-inn/shared` so the bookings table, dashboard, drawer
// header, and reports exports all read the same helper.

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
  // Per DSC (2026-07-31): the inline `subtotal × (pct/100)` and
  // `Math.max(subtotal − deduction, 0)` patterns now route through the
  // shared `calculatePercentDiscount` + `calculateVoucherBase` helpers.
  // Byte-equivalent output: the helper returns the same raw product, and
  // the caller's `Math.round` wrap is preserved.
  const seniorPwdDiscount = Math.round(calculatePercentDiscount(subtotal, discountPct));
  const afterSeniorPwd = subtotal - seniorPwdDiscount;

  let voucherDiscount = 0;
  if (booking.voucherCode) {
    const voucherData = vouchers.find(v => v.code === booking.voucherCode);
    if (voucherData) {
      const vBase = calculateVoucherBase(subtotal, seniorPwdDiscount);
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
  const memberDiscount = Math.round(calculatePercentDiscount(afterVoucher, memberDiscountPct));
  const totalPrice = Math.max(afterVoucher - memberDiscount, 0);
  const finalTotalPrice = Math.max(totalPrice - (booking.pointsRedeemedValue || 0), 0);

  return finalTotalPrice;
}
import config from "@config";
import { jsPDF } from "jspdf";
import { addDoc, collection, doc, getDoc, onSnapshot, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { getBlob, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
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

async function normalizePdfImageToJpeg(blob: Blob) {
  const sourceDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read image."));
    reader.readAsDataURL(blob);
  });
  // Browser image decoders don't reliably fire `onerror` for formats
  // they don't recognize (HEIC, HEIF, AVIF on older builds, etc.) — in
  // those cases the `<img>` element just sits there and the Promise
  // never settles, which hangs the entire registration PDF generator
  // (the "Preparing registration PDF..." tab is left open forever).
  // A bounded decode keeps the error path reachable so the caller can
  // surface a friendly toast and close the placeholder tab.
  const DECODE_TIMEOUT_MS = 5000;
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Image decode timed out — the file may be an unsupported format. Please re-upload as JPEG, PNG, or WebP.")),
      DECODE_TIMEOUT_MS
    );
    image.onload = () => {
      clearTimeout(timer);
      resolve();
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("Unable to decode image."));
    };
    image.src = sourceDataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context || canvas.width === 0 || canvas.height === 0) {
    throw new Error("Unable to prepare image for PDF.");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.9),
    width: canvas.width,
    height: canvas.height
  };
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
  footerY = 278,
  referenceLabel = "Booking Ref"
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
  pdf.text(`${referenceLabel}: ${bookingRef}`, pageW / 2, footerY + 13, { align: "center", charSpace: 0 });
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

function AdminPriceBreakdown({ breakdown, total, originalTotalPrice, discountType, discountPct, discountRejected }: { breakdown?: BookingRateBreakdown | null; total: number; originalTotalPrice?: number | null; discountType?: string | null; discountPct?: number | null; discountRejected?: boolean | null }) {
  if (!breakdown?.roomLines?.length) return null;
  // Per DSC-07 (2026-08-01, per #115): the admin booking
  // drawer now shows the 12% VAT reconciliation the same
  // way the receipt PDF + XLSX export do. The helper
  // composes the senior discount from the booking's stored
  // `originalTotalPrice` (broad-scope approximation;
  // documented narrow-scope edge case in the helper header).
  const vat = getBookingVatBreakdown({
    totalPrice: breakdown.finalTotal || total,
    originalTotalPrice,
    discountType,
    discountPct,
    discountRejected
  });
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
      {/* Per DSC-07 (2026-08-01, per #115): the 12% VAT
          breakdown sub-block. Three muted lines for the
          BIR-reconcilable figures; the senior discount
          (RA 9994) is the VAT-exempt portion when the
          booking carried one. */}
      <div className="mt-2 space-y-1 border-t border-dashed border-gray-200 pt-2 text-[11px] text-gray-500">
        <div className="flex justify-between">
          <span>VATable Sales (VAT-exclusive)</span>
          <span className="font-mono">{formatPrice(vat.vatExclusiveSales)}</span>
        </div>
        <div className="flex justify-between">
          <span>VAT-Exempt Sales (RA 9994 Senior/PWD)</span>
          <span className="font-mono">{formatPrice(vat.vatExemptSales)}</span>
        </div>
        <div className="flex justify-between font-semibold text-gray-700">
          <span>VAT Amount (12% × VATable)</span>
          <span className="font-mono">{formatPrice(vat.vatAmount)}</span>
        </div>
      </div>
    </div>
  );
}

export function BookingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { 
    bookings, 
    // Per MRB-12 (2026-08-03, per decision #179 — proposed):
    // reservation headers + the reservation-scope paid-amount
    // aggregate. The Bookings table row reads these so the
    // row's `totalPrice` and `listReservationBalance` are
    // independent of the active filter (the old code summed
    // the filtered in-memory children and silently dropped
    // any child hidden by the filter).
    reservations,
    reservationPaidAmount,
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
    bookingSources,
    currentUser,
    verifyAndRecordPayment,
    testRuns
  } = useAdmin();
  const toast = useToast();
  const discountApproveConfirm = useTwoClickConfirm<"approve">();

  // UCO-02/03: unpaid checkout reason modal state
  const [showUnpaidCheckoutForm, setShowUnpaidCheckoutForm] = useState(false);
  const [unpaidCheckoutReason, setUnpaidCheckoutReason] = useState("");
  const [unpaidCheckoutError, setUnpaidCheckoutError] = useState<string | null>(null);
  const [unpaidCheckoutSubmitting, setUnpaidCheckoutSubmitting] = useState(false);
  const UNPAID_REASON_SHORTCUTS = [
    { label: "Company billing", value: "approved company billing" },
    { label: "Bank transfer pending", value: "bank transfer pending" },
    { label: "Payment failure", value: "payment failure" },
    { label: "Disputed charge", value: "disputed charge" },
    { label: "Other", value: "other" }
  ];
  const [unpaidCheckoutBlocked, setUnpaidCheckoutBlocked] = useState(false);
  const [unpaidCheckoutBlockMessage, setUnpaidCheckoutBlockMessage] = useState("");
  const brandRgb = hexToRgb(config.colors.primary);
  const [showDiscountRejectForm, setShowDiscountRejectForm] = useState(false);
  const [showDiscountForm, setShowDiscountForm] = useState(false);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [refundError, setRefundError] = useState<string | null>(null);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [showBookingCancelForm, setShowBookingCancelForm] = useState(false);
  // Per MRB-13 (2026-08-02, per decision #166): the
  // cancel scope selector. The admin BookingsPage
  // cancel modal exposes a `This room` / `All N
  // rooms` selector when the selected booking is part
  // of a multi-room reservation. The default `"room"`
  // is the safer choice — staff must opt into the
  // reservation-scope path explicitly. The state
  // resets to `"room"` when the cancel form closes so
  // a previous session's choice never bleeds into a
  // new session.
  const [bookingCancelScope, setBookingCancelScope] = useState<"room" | "reservation">("room");
  // Per CRL-06 (2026-08-02): the cancellation preview
  // state. The admin cancel modal calls the new
  // `POST /api/bookings/cancel-preview` endpoint on
  // open (and on scope flip) and renders the
  // financial breakdown BEFORE the user taps confirm.
  // The destructive cancel never auto-refunds (CRL-04);
  // the panel makes the financial effect explicit.
  // The state resets to `null` on close so a previous
  // session's preview never bleeds into a new one.
  const [cancelPreview, setCancelPreview] = useState<CancellationPreview | null>(null);
  const [cancelPreviewLoading, setCancelPreviewLoading] = useState(false);
  const [cancelPreviewError, setCancelPreviewError] = useState<string | null>(null);
  const cancelPreviewRequestIdRef = useRef(0);
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

  // FSO-03: Canonical URL state for all filter/search/tab params
  const readParam = (key: string, fallback: string) => searchParams.get(key) || fallback;
  const writeParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === "") next.delete(key); else next.set(key, val);
    }
    const q = next.toString();
    setSearchParams(q ? `?${q}` : "", { replace: true });
  };

  // Main navigation tab
  const activeMainTab = (readParam("tab", "bookings") === "store" ? "store" : "bookings") as "bookings" | "store";
  const setActiveMainTab = (tab: "bookings" | "store") => writeParams({ tab: tab === "store" ? "store" : null });

  // FSO-06: Booking quick views + filter state (synced to URL)
  type BookingQuickView = "all" | "needs-attention" | "arrivals-today" | "departures-today" | "in-house" | "upcoming" | "balance-due" | "cancelled";
  const bookingQuickView = readParam("bqv", "all") as BookingQuickView;
  const setBookingQuickView = (v: BookingQuickView) => writeParams({ bqv: v === "all" ? null : v, bs: null });
  const bookingSearch = readParam("bq", "");
  const setBookingSearch = (v: string) => writeParams({ bq: v || null });
  const bookingStatusFilter = readParam("bs", "all");
  const setBookingStatusFilter = (v: string) => writeParams({ bs: v === "all" ? null : v, bqv: null });

  // FSO-10: Store quick views + filter state (synced to URL)
  type StoreQuickView = "all" | "needs-action" | "placed" | "preparing" | "out-for-delivery" | "delivered-today" | "add-to-bill" | "payment-pending" | "cancelled";
  const storeQuickView = readParam("sqv", "all") as StoreQuickView;
  const setStoreQuickView = (v: StoreQuickView) => writeParams({ sqv: v === "all" ? null : v, ss: null });
  const storeSearch = readParam("sq", "");
  const setStoreSearch = (v: string) => writeParams({ sq: v || null });
  const storeStatusFilter = readParam("ss", "all");
  const setStoreStatusFilter = (v: string) => writeParams({ ss: v === "all" ? null : v, sqv: null });

  // FSO-08: Booking advanced filter state (synced to URL)
  const bDateBasis = readParam("bdb", "stay") as "stay" | "arrival" | "departure" | "created";
  const setBDateBasis = (v: string) => writeParams({ bdb: v === "stay" ? null : v });
  const bDateFrom = readParam("bdf", "");
  const setBDateFrom = (v: string) => writeParams({ bdf: v || null });
  const bDateTo = readParam("bdt", "");
  const setBDateTo = (v: string) => writeParams({ bdt: v || null });
  const bPayState = readParam("bps", "");
  const setBPayState = (v: string) => writeParams({ bps: v || null });
  const bPaymentMethod = readParam("bpm", "");
  const setBPaymentMethod = (v: string) => writeParams({ bpm: v || null });
  const bRoom = readParam("br", "");
  const setBRoom = (v: string) => writeParams({ br: v || null });
  const bRoomType = readParam("brt", "");
  const setBRoomType = (v: string) => writeParams({ brt: v || null });
  const bSource = readParam("bsrc", "");
  const setBSource = (v: string) => writeParams({ bsrc: v || null });
  const bCorp = readParam("bc", "");
  const setBCorp = (v: string) => writeParams({ bc: v || null });
  const bDiscount = readParam("bd", "");
  const setBDiscount = (v: string) => writeParams({ bd: v || null });
  const [showBookingFilters, setShowBookingFilters] = useState(false);

  // FSO-12: Store advanced filter state (synced to URL)
  const sDateFrom = readParam("sdf", "");
  const setSDateFrom = (v: string) => writeParams({ sdf: v || null });
  const sDateTo = readParam("sdt", "");
  const setSDateTo = (v: string) => writeParams({ sdt: v || null });
  const sRoom = readParam("sr", "");
  const setSRoom = (v: string) => writeParams({ sr: v || null });
  const sPaymentMethod = readParam("spm", "");
  const setSPaymentMethod = (v: string) => writeParams({ spm: v || null });
  const sBilling = readParam("sbl", "");
  const setSBilling = (v: string) => writeParams({ sbl: v || null });
  const sBilled = readParam("sbd", "");
  const setSBilled = (v: string) => writeParams({ sbd: v || null });
  const sPayProof = readParam("spp", "");
  const setSPayProof = (v: string) => writeParams({ spp: v || null });
  const [showStoreFilters, setShowStoreFilters] = useState(false);

  // Booking Drawer States
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activeBookingSection, setActiveBookingSection] = useState<BookingDrawerSection>("overview");
  const [showEditRegistration, setShowEditRegistration] = useState(false);

  useEffect(() => {
    setActiveBookingSection("overview");
    setShowEditRegistration(false);
  }, [selectedBooking?.id]);


  const processedLegacyRef = useRef<string>("");
  useEffect(() => {
    const serialized = Array.from(searchParams.entries()).sort().join("&");
    if (serialized === processedLegacyRef.current) return;
    processedLegacyRef.current = serialized;

    // Migrate legacy `filter` param to canonical `bqv` param
    const filter = searchParams.get("filter");
    const filterToQv: Record<string, string> = { arrivals: "arrivals-today", departures: "departures-today", "in-house": "in-house" };
    if (filter && filterToQv[filter] && !searchParams.get("bqv")) {
      return void writeParams({ bqv: filterToQv[filter], filter: null });
    }
    // Migrate legacy `orderRef` param to canonical `sq` param
    const orderRef = searchParams.get("orderRef");
    if (orderRef && !searchParams.get("sq")) {
      return void writeParams({ sq: orderRef, orderRef: null });
    }
    // Open store order drawer from deep-link
    const orderId = searchParams.get("orderId");
    if (orderId) {
      const match = storeOrders.find((order) => order.id === orderId);
      if (match) {
        setSelectedOrder(match);
        setIsOrderDrawerOpen(true);
      }
    }
  }, [searchParams, storeOrders]);

  const processedDeepLinkRef = useRef<string | null>(null);
  useEffect(() => {
    // Per MRB-07 (2026-08-02, per decision #159): deep links resolve
    // both a child booking id (`?bookingId=`) and a reservation
    // (`?reservationId=` or `?reservationRef=`). Emails, receipts and
    // notifications reference whichever level they were written about,
    // and every one of them must land somewhere useful. A reservation
    // link expands that reservation in the list and opens its lead room
    // — the room the desk almost always wants — rather than dead-ending
    // because the id isn't a booking id.
    const bookingId = searchParams.get("bookingId");
    const reservationId = searchParams.get("reservationId");
    const reservationRef = searchParams.get("reservationRef");
    const deepLinkKey = bookingId || reservationId || reservationRef;
    if (!deepLinkKey || deepLinkKey === processedDeepLinkRef.current) return;

    if (bookingId) {
      const match = bookings.find((booking) => booking.id === bookingId);
      if (!match) return;
      processedDeepLinkRef.current = deepLinkKey;
      setSelectedBooking(match);
      setIsDrawerOpen(true);
      return;
    }

    const reservationRooms = bookings
      .filter((booking) =>
        reservationId
          ? booking.reservationId === reservationId
          : booking.reservationRef === reservationRef
      )
      .sort((a, b) => (a.reservationPosition || 0) - (b.reservationPosition || 0));
    if (reservationRooms.length === 0) return;
    processedDeepLinkRef.current = deepLinkKey;
    const resolvedReservationId = reservationRooms[0].reservationId;
    if (resolvedReservationId) {
      setExpandedReservationIds((current) => new Set(current).add(resolvedReservationId));
    }
    setSelectedBooking(reservationRooms[0]);
    setIsDrawerOpen(true);
  }, [searchParams, bookings]);

  // Per fix/bookings-drawer-stale-state: the booking drawer
  // holds a local copy of one row in `selectedBooking`. The
  // `bookings` array is the live source of truth (admin context
  // owns the onSnapshot listener and converts Firestore docs into
  // `Booking` objects with the right field types), but the local
  // copy is never re-synced. That means a status-changing action
  // like Verify & Record Payment (which transitions the booking
  // to `payment-confirmed` server-side and writes a payments
  // ledger entry) would update `bookings` on the next onSnapshot
  // tick — yet the drawer would still show the pre-action copy,
  // so the "Verify & Record Payment" / "Review proof in Folio"
  // buttons would keep rendering as if nothing happened.
  //
  // The dashboard doesn't hit this because its "pending payments"
  // list renders directly from `bookings`. The BookingsPage
  // drawer does not — it has a single `selectedBooking` state
  // that needs to be re-synced. Whenever `bookings` updates, look
  // up the matching row and adopt the live version. The early
  // bail when the id is missing or no match is found keeps the
  // effect safe (a deleted booking, a pre-load state, etc.).
  useEffect(() => {
    if (!selectedBooking?.id) return;
    const fresh = bookings.find((b) => b.id === selectedBooking.id);
    if (fresh && fresh !== selectedBooking) {
      setSelectedBooking(fresh);
    }
  }, [bookings, selectedBooking?.id]);

  // Store Order Drawer States
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isOrderDrawerOpen, setIsOrderDrawerOpen] = useState(false);

  // Payment Form States
  const [showRecordPaymentModal, setShowRecordPaymentModal] = useState(false);
  const paymentSubmissionIdRef = useRef<string | null>(null);
  // Per CRL-01 (2026-08-01): preallocated refundId is the canonical
  // idempotency key for /api/bookings/add-refund. A retry after an
  // uncertain response (network blip, closed tab) replays the original
  // commit instead of appending a second refund entry. Mirrors the
  // paymentSubmissionIdRef pattern above.
  const refundSubmissionIdRef = useRef<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNote, setPaymentNote] = useState("");
  const [paymentTransactionReference, setPaymentTransactionReference] = useState("");
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [refundReason, setRefundReason] = useState("");

  const [showVerifyPaymentModal, setShowVerifyPaymentModal] = useState(false);
  const verifySubmissionIdRef = useRef<string | null>(null);
  const [showRefundModal, setShowRefundModal] = useState(false);
  // Per CRL-07 (2026-08-03, per decision #173): the
  // exception modal state. Mounted when the admin
  // taps "Apply exception" on the liability panel.
  // The form lives in `CancellationExceptionModal`;
  // this state just controls the open/close + the
  // refresh trigger after a successful submit.
  const [showExceptionModal, setShowExceptionModal] = useState(false);
  // The `liabilitySnapshotKey` is bumped on every
  // mutation that changes the stored liability
  // (a fresh exception submit, a fresh refund
  // submit). The panel watches this key (via
  // the `liability` prop's identity change) and
  // re-projects. Same pattern as the existing
  // `cancelPreviewRequestIdRef` — a counter that
  // forces a refetch when a dependent query
  // changes its inputs.
  const [liabilitySnapshotKey, setLiabilitySnapshotKey] = useState(0);
  // The `openLiabilityRefundModal` function
  // opens the existing refund modal pre-filled
  // with the suggested amount. The panel calls
  // this when the admin taps "Record processed
  // refund". Same shape as
  // `openRecordPaymentForBalance` — the parent
  // owns the refund modal state, the panel
  // just hands the amount.
  const openLiabilityRefundModal = (suggestedAmount: number) => {
    setRefundAmount(String(Math.max(0, Number(suggestedAmount) || 0)));
    setRefundMethod("cash");
    setRefundReason("");
    setShowRefundModal(true);
  };
  const [verifyAmount, setVerifyAmount] = useState("");
  const [verifyMethod, setVerifyMethod] = useState("gcash");
  const [verifyReference, setVerifyReference] = useState("");
  const [verifyNote, setVerifyNote] = useState("");
  const [verifyPending, setVerifyPending] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  // Per feat/payment-success-modal: after a successful
  // verify-and-record, surface a closing-the-loop modal that
  // confirms the payment, notes the email that was sent, and
  // nudges the front desk toward the natural next step
  // (Confirm Booking). `null` while the modal is closed.
  const [verifySuccess, setVerifySuccess] = useState<null | {
    booking: Booking;
    amount: number;
    method: string;
    methodLabel: string;
    isFullPayment: boolean;
    remainingBalance: number;
  }>(null);
  const [confirmingBookingFromSuccess, setConfirmingBookingFromSuccess] = useState(false);
  // Per CWB-04 / decision #122 (2026-07-23): when the post-verify
  // success modal renders the partial-payment variant, the
  // "Confirm with Balance" CTA opens this form. The form is also
  // reachable from the drawer's More actions menu for any
  // `payment-uploaded` row. `null` while the form is closed.
  const [confirmWithBalanceContext, setConfirmWithBalanceContext] = useState<null | {
    booking: Booking;
    currentBalance: number;
  }>(null);
  const [isRefunding, setIsRefunding] = useState(false);
  const [guestIdUploadStatus, setGuestIdUploadStatus] = useState("");
  const [imagePreview, setImagePreview] = useState<{ title: string; url: string } | null>(null);
  const [redeemPointsInput, setRedeemPointsInput] = useState("");
  const [isRedeemingPoints, setIsRedeemingPoints] = useState(false);

  // Move Form States
  const [showMoveForm, setShowMoveForm] = useState(false);
  // Per MRB-14 (2026-08-03, per decision #180 —
  // proposed): the add-room modal state. The new
  // child's dates are NEVER in the form (the server
  // reads them from the header). The form captures
  // just the target room + occupancy.
  const [showAddRoomForm, setShowAddRoomForm] = useState(false);
  const [addRoomRoomId, setAddRoomRoomId] = useState("");
  const [addRoomNumAdults, setAddRoomNumAdults] = useState(1);
  const [addRoomNumChildren, setAddRoomNumChildren] = useState(0);
  const [addRoomExtraBedCount, setAddRoomExtraBedCount] = useState(0);
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [addRoomError, setAddRoomError] = useState<string | null>(null);
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
  // Per fix/walkin-split-name (2026-07-25): the walk-in modal
  // now mirrors the guest `/book` page — firstName + lastName
  // are collected separately (two-column grid below) instead
  // of being shoehorned into a single `guestName` field. The
  // server combines them into `Booking.guestName` for storage.
  const [walkinFirstName, setWalkinFirstName] = useState("");
  const [walkinLastName, setWalkinLastName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  // Per MRB-07 (2026-08-02, per decision #159): the New Booking modal
  // creates a reservation covering one OR MORE room stays — walk-in
  // groups, phone bookings and OTA entry all book blocks of rooms. The
  // room stay list is the single source of truth for the room, guest
  // and extra-bed selections; the whole reservation shares one lead
  // guest, one set of dates and one payment. A brand new modal starts
  // with exactly one stay, so the common single-room case is unchanged
  // for the desk.
  const [walkinRoomStays, setWalkinRoomStays] = useState<WalkinRoomStay[]>(
    () => [createWalkinRoomStay(roomTypes[0]?.value || "")]
  );

  // Sync the default room type onto the first stay when the room type
  // catalog finishes loading.
  useEffect(() => {
    if (roomTypes.length > 0) {
      setWalkinRoomStays((stays) =>
        stays.some((stay) => stay.roomType)
          ? stays
          : stays.map((stay) => ({ ...stay, roomType: roomTypes[0].value }))
      );
    }
  }, [roomTypes]);

  // Compatibility aliases for the primary room stay. The submit
  // handler, the price preview and the booking payload all describe the
  // reservation as a whole; these two keep the "primary room" reads
  // that predate multi-room support reading the first stay.
  const roomType = walkinRoomStays[0]?.roomType || "";
  const roomNumber = walkinRoomStays[0]?.roomNumber || "";

  const updateWalkinRoomStay = (index: number, patch: Partial<WalkinRoomStay>) => {
    setWalkinRoomStays((stays) =>
      stays.map((stay, idx) => (idx === index ? { ...stay, ...patch } : stay))
    );
  };
  const [checkInDate, setCheckInDate] = useState(() => getManilaDateInfo(config.timezone).todayStr);
  const [checkOutDate, setCheckOutDate] = useState(() => {
    const tomorrow = getManilaDateInfo(config.timezone).manilaDate;
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDateInput(tomorrow);
  });
  // Per EXB-07 (2026-08-01, per decision #155): the walk-in
  // modal gains the same adult/child split + extra bed steppers
  // the guest `/book` page already has. The split is
  // staff-edited (the desk can decide a 3-guest booking is
  // 2 adults + 1 child or 3 adults depending on what the
  // guest said at the counter); the server derives
  // `numGuests = numAdults + numChildren` (per CHD-04) so the
  // booking doc stays consistent. The extra-bed stepper
  // renders only when the selected room type has
  // `maxExtraBeds > 0` (per EXB-01's "no separate
  // `allowsExtraBed` boolean" rule). The legacy single
  // `numGuests` input is replaced by the 3 steppers; the
  // total is auto-derived from the adult + child sum.
  //
  // Per MRB-07 (2026-08-02, per decision #159): the steppers live on
  // each room stay, so a reservation distributes its guests across its
  // rooms instead of repeating one occupancy on every room. These
  // aliases read the primary stay.
  const walkinNumAdults = walkinRoomStays[0]?.numAdults ?? 1;
  const walkinNumChildren = walkinRoomStays[0]?.numChildren ?? 0;
  const walkinExtraBedCount = walkinRoomStays[0]?.extraBedCount ?? 0;
  // Derived from the split (per CHD-04): the price preview
  // and the booking doc's `numGuests` field both use this
  // sum. The walkin form has no independent `numGuests`
  // input — the steppers are the only source of truth. Per
  // MRB-07 the total is summed across every room stay.
  const numGuests = walkinRoomStays.reduce(
    (sum, stay) => sum + stay.numAdults + stay.numChildren,
    0
  );
  // Per NBS-07 (2026-07-31): the New Booking modal now records the
  // source (walk-in / phone / facebook / agoda / etc.) and writes it
  // to `Booking.source`. Default is still "walk-in" so the common
  // case is one click. The selector maps the configured, front-desk-
  // selectable, enabled entries — never the system-assigned ones
  // (online / walk-in / corporate per NBS-06).
  const [walkinSource, setWalkinSource] = useState("walk-in");
  const [walkinPayment, setWalkinPayment] = useState("pay-at-hotel");
  const [hasBreakfast, setHasBreakfast] = useState(false);
  const [immediateCheckIn, setImmediateCheckIn] = useState(false);
  const [priceOverride, setPriceOverride] = useState("");
  const [walkinDiscountType, setWalkinDiscountType] = useState<"" | "senior" | "pwd">("");
  const [walkinVoucherCode, setWalkinVoucherCode] = useState("");
  const [walkinTestRunId, setWalkinTestRunId] = useState("");
  const [staffDiscountType, setStaffDiscountType] = useState<"" | "senior" | "pwd">("");
  const [staffVoucherCode, setStaffVoucherCode] = useState("");
  const [isApplyingStaffDiscount, setIsApplyingStaffDiscount] = useState(false);
  // Per MRB-12 (2026-08-03, per decision #179 — proposed): the
  // discount-form scope selector (MRB-12-05). Mirrors the
  // MRB-13 cancel-modal `bookingCancelScope` pattern. Default
  // `"room"` is the safer choice — staff must opt into the
  // whole-reservation path explicitly. Resets to `"room"` on
  // close so a previous session's choice never bleeds into a
  // new one. Absent (null) is the uninitialised state; the
  // `useEffect` on `showDiscountForm` flips it to `"room"`
  // when the modal opens.
  const [staffDiscountScope, setStaffDiscountScope] = useState<"room" | "reservation" | null>(null);

  // Per NBS-07 (2026-07-31): memo for the New Booking modal's source
  // selector. Filters the configured list to entries that are
  // (a) enabled, (b) selectable at the front desk, and (c) not the
  // currently-selected source (so the user can re-pick the same one
  // after toggling — the system-assigned sources never appear here
  // regardless). Default selection in the state (`walkinSource`) is
  // still "walk-in" for the common case.
  const selectableBookingSources = useMemo<BookingSourceConfig[]>(() => {
    return (bookingSources || []).filter(
      (s) => s.isEnabled && s.selectableAtFrontDesk
    );
  }, [bookingSources]);

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
  const [selectedReservationTotal, setSelectedReservationTotal] = useState<number | null>(null);
  const [chargeCategory, setChargeCategory] = useState<IncidentalChargeCategory>("other");
  const [chargeLabel, setChargeLabel] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [chargeNote, setChargeNote] = useState("");
  const [isSavingCharge, setIsSavingCharge] = useState(false);
  const [showChargeModal, setShowChargeModal] = useState(false);

  const selectedFolioBookingIds = useMemo(() => {
    if (!selectedBooking?.id) return [];
    if (!selectedBooking.reservationId) return [selectedBooking.id];
    const childIds = bookings
      .filter((booking) => booking.reservationId === selectedBooking.reservationId)
      .map((booking) => booking.id);
    return childIds.length > 0 ? childIds : [selectedBooking.id];
  }, [bookings, selectedBooking?.id, selectedBooking?.reservationId]);

  const selectedFolioBaseTotal = useMemo(() => {
    if (!selectedBooking) return 0;
    if (!selectedBooking.reservationId) return selectedBooking.totalPrice;
    if (selectedReservationTotal !== null) return selectedReservationTotal;
    const childTotal = bookings
      .filter((booking) => booking.reservationId === selectedBooking.reservationId)
      .reduce((sum, booking) => sum + (Number(booking.totalPrice) || 0), 0);
    return childTotal || selectedBooking.totalPrice;
  }, [bookings, selectedBooking, selectedReservationTotal]);

  useEffect(() => {
    if (!selectedBooking?.reservationId) {
      setSelectedReservationTotal(null);
      return;
    }

    setSelectedReservationTotal(null);
    const unsubscribe = onSnapshot(
      doc(db, "reservations", selectedBooking.reservationId),
      (snapshot) => {
        const total = Number(snapshot.data()?.totalPrice);
        setSelectedReservationTotal(snapshot.exists() && Number.isFinite(total) ? total : null);
      },
      (error) => {
        console.error("Error listening to reservation total:", error);
        setSelectedReservationTotal(null);
      }
    );
    return unsubscribe;
  }, [selectedBooking?.reservationId]);

  useEffect(() => {
    if (!selectedBooking?.id) {
      setSelectedBookingPayments([]);
      return;
    }

    setSelectedBookingPayments([]);
    const snapshots = new Map<string, OnsitePayment[]>();
    const sources = selectedBooking.reservationId
      ? [
          { key: `reservation:${selectedBooking.reservationId}:payments`, ref: collection(db, "reservations", selectedBooking.reservationId, "payments") },
          { key: `reservation:${selectedBooking.reservationId}:refunds`, ref: collection(db, "reservations", selectedBooking.reservationId, "refunds") },
          ...selectedFolioBookingIds.map((bookingId) => ({
            key: `booking:${bookingId}:payments`,
            ref: collection(db, "bookings", bookingId, "payments")
          }))
        ]
      : [{
          key: `booking:${selectedBooking.id}:payments`,
          ref: collection(db, "bookings", selectedBooking.id, "payments")
        }];

    const emitPayments = () => {
      setSelectedBookingPayments(
        Array.from(snapshots.values())
          .flat()
          .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
      );
    };

    const unsubscribes = sources.map((source) => onSnapshot(
      source.ref,
      (snapshot) => {
        snapshots.set(source.key, snapshot.docs.map((paymentDoc) => {
          const data = paymentDoc.data();
          return {
            id: `${source.key}:${paymentDoc.id}`,
            type: data.type === "refund" || Number(data.amount || 0) < 0 ? "refund" : "payment",
            amount: Number(data.amount || 0),
            method: String(data.method || ""),
            note: String(data.note || ""),
            transactionReference: data.transactionReference ? String(data.transactionReference) : null,
            reason: data.reason ? String(data.reason) : null,
            approvedBy: data.approvedBy ? String(data.approvedBy) : null,
            recordedBy: String(data.recordedBy || "staff"),
            recordedAt: data.recordedAt instanceof Date
              ? data.recordedAt.toISOString()
              : data.recordedAt?.toDate
                ? data.recordedAt.toDate().toISOString()
                : String(data.recordedAt || "")
          };
        }));
        emitPayments();
      },
      (error) => {
        console.error("Error listening to folio payments:", error);
      }
    ));

    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [selectedBooking?.id, selectedBooking?.reservationId, selectedFolioBookingIds]);

  useEffect(() => {
    if (!selectedBooking?.id) {
      setSelectedBookingCharges([]);
      return;
    }

    setSelectedBookingCharges([]);
    const snapshots = new Map<string, IncidentalCharge[]>();
    const sources = selectedBooking.reservationId
      ? [
          {
            key: `reservation:${selectedBooking.reservationId}`,
            owner: "reservation" as const,
            ownerId: selectedBooking.reservationId,
            ref: collection(db, "reservations", selectedBooking.reservationId, "charges")
          },
          ...selectedFolioBookingIds.map((bookingId) => ({
            key: `booking:${bookingId}`,
            owner: "booking" as const,
            ownerId: bookingId,
            ref: collection(db, "bookings", bookingId, "charges")
          }))
        ]
      : [{
          key: `booking:${selectedBooking.id}`,
          owner: "booking" as const,
          ownerId: selectedBooking.id,
          ref: collection(db, "bookings", selectedBooking.id, "charges")
        }];

    const emitCharges = () => {
      setSelectedBookingCharges(
        Array.from(snapshots.values())
          .flat()
          .sort((a, b) => a.addedAt.localeCompare(b.addedAt))
      );
    };

    const unsubscribes = sources.map((source) => onSnapshot(
      source.ref,
      (snapshot) => {
        snapshots.set(source.key, snapshot.docs.map((chargeDoc) => {
          const data = chargeDoc.data();
          return {
            id: chargeDoc.id,
            label: String(data.label || "Incidental charge"),
            amount: Number(data.amount || 0),
            category: (data.category || "other") as IncidentalChargeCategory,
            note: String(data.note || ""),
            addedBy: String(data.addedBy || "staff"),
            addedAt: data.addedAt?.toDate ? data.addedAt.toDate().toISOString() : String(data.addedAt || ""),
            voidOf: data.voidOf ? String(data.voidOf) : null,
            bookingId: data.bookingId ? String(data.bookingId) : source.owner === "booking" ? source.ownerId : null,
            ledgerOwner: source.owner,
            ledgerOwnerId: source.ownerId
          };
        }));
        emitCharges();
      },
      (error) => {
        console.error("Error listening to folio charges:", error);
        toast.error("Could not load incidental charges", "Refresh the booking drawer and try again.");
      }
    ));
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [selectedBooking?.id, selectedBooking?.reservationId, selectedFolioBookingIds, toast]);

  // Per EXB-07 (2026-08-01, per decision #155) + MRB-07 (2026-08-02,
  // per decision #159): the per-type caps (`maxCapacity` +
  // `maxChildren` + `maxExtraBeds` + `extraBedRate`) that drive the
  // occupancy steppers and the contextual overflow message are read
  // per room stay, inside the room list below, rather than once from a
  // single selected type. Each stay looks up its own type entry from
  // its selected room TYPE (not its room number) so the overflow
  // message can render before the desk has picked a specific room —
  // that's the case where the message is most actionable. The overflow
  // itself uses the same `requiredExtraBedsFor` helper the server uses
  // (per decision #153) so the preview matches the server's check.

  // Calculate rate per night for the selected room number — per W3.6
  // the rate lives on the room's type, not the room itself.
  const selectedRoomDetails = rooms.find(r => r.roomNumber === roomNumber);
  const selectedRoomType = roomTypes.find(t => t.value === selectedRoomDetails?.type);
  const ratePerNight = selectedRoomType?.pricePerNight || 0;

  // Per MRB-07 (2026-08-02, per decision #159): the room charge is the
  // sum across every room stay, each priced against its own type — the
  // same shape the server computes, so the preview the desk sees before
  // confirming matches what gets written.
  const walkinRoomChargeTotals = walkinRoomStays.map((stay) => {
    const stayRoom = rooms.find((r) => r.roomNumber === stay.roomNumber);
    const stayType = roomTypes.find((t) => t.value === (stayRoom?.type || stay.roomType));
    if (!stayType || !stay.roomNumber) return 0;
    return calculateSeasonalAwareRoomTotal({
      checkIn: `${checkInDate}T00:00:00Z`,
      checkOut: `${checkOutDate}T00:00:00Z`,
      roomType: stayType.value,
      baseRate: stayType.pricePerNight,
      weekendRate: stayType.weekendRate,
      seasonalRateOverrides
    });
  });
  const roomChargeTotal = walkinRoomChargeTotals.reduce((sum, amount) => sum + amount, 0);

  // Rooms already claimed by another stay must not be offered again —
  // the server rejects a duplicate room, so the picker never lets the
  // desk build one.
  const availableRoomsForStay = (stayIndex: number) => {
    const claimed = new Set(
      walkinRoomStays
        .filter((_, idx) => idx !== stayIndex)
        .map((stay) => stay.roomNumber)
        .filter(Boolean)
    );
    return rooms.filter(
      (r) =>
        r.type === walkinRoomStays[stayIndex].roomType &&
        r.status === "available" &&
        !claimed.has(r.roomNumber)
    );
  };

  const addWalkinRoomStay = () => {
    setWalkinRoomStays((stays) => {
      const nextType = stays[stays.length - 1]?.roomType || roomTypes[0]?.value || "";
      const claimed = new Set(stays.map((stay) => stay.roomNumber).filter(Boolean));
      const nextStay = createWalkinRoomStay(nextType);
      const firstFree = rooms.find(
        (r) => r.type === nextType && r.status === "available" && !claimed.has(r.roomNumber)
      );
      return [...stays, { ...nextStay, roomNumber: firstFree?.roomNumber || "" }];
    });
  };

  const removeWalkinRoomStay = (index: number) => {
    setWalkinRoomStays((stays) =>
      stays.length <= 1 ? stays : stays.filter((_, idx) => idx !== index)
    );
  };

  // Every stay must name a room, and no stay may exceed its type's caps
  // without enough extra beds — both are server rejects, so the submit
  // button stays disabled until the reservation is actually creatable.
  const walkinRoomStayIssues = walkinRoomStays.map((stay) => {
    if (!stay.roomNumber) return "room";
    const stayType = roomTypes.find((t) => t.value === stay.roomType);
    if (!stayType) return "type";
    const overflow = requiredExtraBedsFor({
      numAdults: stay.numAdults,
      numChildren: stay.numChildren,
      maxCapacity: Number(stayType.maxCapacity) || 0,
      maxChildren: Number(stayType.maxChildren) || 0
    });
    if (overflow.requiredExtraBeds > stay.extraBedCount) return "capacity";
    if (stay.numAdults + stay.numChildren < 1) return "empty";
    return null;
  });
  const walkinReservationIsValid = walkinRoomStayIssues.every((issue) => issue === null);

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
  // Per MRB-07 (2026-08-02, per decision #159): the columns render three
  // row kinds. A `reservation` row is the group header — it shows the
  // public reservation reference, the room count, and the reservation's
  // aggregate money, and it expands rather than opening a workspace. A
  // `roomStay` row is one room inside an expanded reservation. A
  // `booking` row is an ungrouped room, exactly as before.
  const columns: Array<DataTableColumn<BookingListRow>> = [
    {
      key: "bookingRef",
      header: "Reference",
      render: (row) => (
        <span className="inline-flex items-center gap-1.5">
          {row.listRowKind === "reservation" ? (
            <>
              {expandedReservationIds.has(row.listReservationId!) ? (
                <ChevronDown size={13} className="text-gray-500" aria-hidden="true" />
              ) : (
                <ChevronRight size={13} className="text-gray-500" aria-hidden="true" />
              )}
              <strong className="font-bold">{row.reservationRef || row.bookingRef}</strong>
            </>
          ) : (
            row.bookingRef
          )}
          {row.isTestData && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">TEST</span>
          )}
        </span>
      )
    },
    { key: "guestName", header: "Guest" },
    {
      key: "roomNumber",
      header: "Room",
      render: (row) =>
        row.listRowKind === "reservation" ? (
          <span className="font-semibold text-gray-700">
            {row.listRoomCount} rooms
          </span>
        ) : (
          <span>
            Room {row.roomNumber} ({row.roomType.replace("-", " ")})
          </span>
        )
    },
    {
      key: "checkIn",
      header: "Dates",
      render: (row) => {
        // Per MRB-14 (2026-08-03, per decision #180 —
        // proposed): for reservation rows where the
        // children have diverged from the header's
        // original shared dates, the Dates column
        // shows the actual range (MIN(children.checkIn)
        // / MAX(children.checkOut)) + a "varies by
        // room" badge. N=1 + legacy null-`reservationId`
        // rows keep the existing per-booking render
        // (no children to diverge, no header to read).
        // Pre-MRB-14 reservations have no
        // `actualDateRange` (the field is `null`);
        // they fall through to the per-child render.
        if (row.listRowKind === "reservation" && row.listReservationHeader?.actualDateRange?.isDivergent) {
          const range = row.listReservationHeader.actualDateRange;
          const earliestStr = formatShortDate(range.earliestCheckIn);
          const latestStr = formatShortDate(range.latestCheckOut);
          return (
            <span
              className="inline-flex flex-col items-start gap-0.5 text-xs"
              data-testid="reservation-dates-divergent"
              title={
                (row.listChildBookings || [])
                  .map((child: any) => `Room ${child.roomNumber}: ${formatShortDate(child.checkIn)} – ${formatShortDate(child.checkOut)}`)
                  .join("\n") || "Per-room dates available"
              }
            >
              <span>{earliestStr} to {latestStr}</span>
              <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800 ring-1 ring-inset ring-amber-200">
                varies by room
              </span>
            </span>
          );
        }
        return (
          <span className="text-xs">
            {row.checkIn} to {row.checkOut} ({row.numNights} nights)
          </span>
        );
      }
    },
    {
      key: "totalPrice",
      header: "Total",
      align: "end",
      render: (row) => (
        <span className="inline-flex flex-col items-end">
          <strong className="font-bold">{formatPrice(row.totalPrice)}</strong>
          {/* Per MRB-07: the reservation row states the group balance
              so the desk can triage a group without expanding it. */}
          {row.listRowKind === "reservation" && (row.listReservationBalance || 0) > 0 && (
            <span className="text-[10px] font-semibold text-amber-700">
              {formatPrice(row.listReservationBalance!)} due
            </span>
          )}
        </span>
      )
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex items-center gap-1.5">
          {/* Per MRB-12 (2026-08-03, per decision #179 — proposed):
              the reservation row's Status column reads the
              `Reservation.paymentStatus` from the header
              (populated by MRB-12-01's listener). The aggregate
              pill is the desk's at-a-glance read of the group
              state — it replaces the previous "Mixed" fallback
              (which collapsed to a generic chip when the
              children's per-booking statuses disagreed) with a
              concrete payment state. The legacy "Mixed" wording
              is kept as the cold-start fallback for the
              first paint (when the listener hasn't hydrated yet);
              the next snapshot replaces it with the aggregate
              pill. N=1 + legacy null-`reservationId` rows keep
              the per-booking `StatusBadge` byte-equivalent to
              pre-MRB-12. */}
          {row.listRowKind === "reservation" && row.listReservationHeader ? (
            renderReservationPaymentStatusPill(
              row.listReservationHeader.paymentStatus,
              row.listReservationHeader.totalPrice,
              row.listReservationPaidAmount || 0
            )
          ) : row.listRowKind === "reservation" && new Set((row.listChildBookings || []).map((child) => child.status)).size > 1 ? (
            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600 ring-1 ring-gray-200">
              Mixed
            </span>
          ) : (
            <StatusBadge label={row.status.replace("-", " ")} status={row.status} />
          )}
          {/* Per MRB-12 (2026-08-03, per decision #179 — proposed):
              the cancellation-count chip. Renders only on
              reservation rows (N>1) when the denormalized
              `cancelledRoomCount` is > 0 — the desk never
              has to expand a row to know a group has
              cancellations in it. Legacy N=1 single-row
              path keeps the existing per-booking
              `StatusBadge` (the `cancelled` tone is
              already on the badge). The chip's tooltip
              lists the cancelled room numbers for
              quick triage. */}
          {row.listRowKind === "reservation" && row.listReservationHeader && row.listReservationHeader.cancelledRoomCount > 0 && (
            <span
              title={
                "Cancelled rooms in this reservation: " +
                (row.listChildBookings || [])
                  .filter((child) => child.status === "cancelled")
                  .map((child) => `Room ${child.roomNumber}`)
                  .join(", ")
              }
              className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700 ring-1 ring-inset ring-red-200"
            >
              {row.listReservationHeader.cancelledRoomCount} cancelled
            </span>
          )}
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
      render: (row) =>
        // Per MRB-07: a reservation has no single booking workspace, so
        // its action is to reveal the rooms. Each room then opens its
        // own drawer as it always has.
        row.listRowKind === "reservation" ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleReservationExpanded(row.listReservationId!);
            }}
            className="min-h-[36px] px-3.5 inline-flex items-center gap-1 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-semibold text-gray-700 transition"
          >
            {expandedReservationIds.has(row.listReservationId!) ? "Hide rooms" : "Show rooms"}
          </button>
        ) : (
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

  // FSO-04/06/07: Quick-view predicates — reusable, server-aligned, consistent with drawer alerts
  const today = getManilaDateInfo(config.timezone).todayStr;
  const bookingQuickViewPredicate = (booking: Booking, qv: BookingQuickView): boolean => {
    const folio = getBookingFolio(booking);
    switch (qv) {
      case "needs-attention":
        return (
          booking.status === "payment-uploaded" ||
          (booking.status === "confirmed" && booking.checkIn < today) ||
          (booking.status === "pending" && booking.checkIn <= today) ||
          (booking.earlyCheckIn?.status === "requested") ||
          (booking.status === "checked-in" && booking.checkOut < today) ||
          (booking.status === "checked-out" && folio.balance > 0)
        );
      case "arrivals-today":
        return booking.checkIn === today && ["confirmed", "checked-in"].includes(booking.status);
      case "departures-today":
        return booking.checkOut === today && booking.status === "checked-in";
      case "in-house":
        return booking.status === "checked-in";
      case "upcoming":
        return booking.status === "confirmed" && booking.checkIn > today;
      case "balance-due":
        return folio.balance > 0;
      case "cancelled":
        return booking.status === "cancelled";
      default:
        return true;
    }
  };

  // FSO-10/11: Store quick-view predicates
  const storeQuickViewPredicate = (order: any, qv: StoreQuickView): boolean => {
    switch (qv) {
      case "needs-action":
        return order.status === "placed" || (order.paymentProofUrl && order.status === "payment-uploaded");
      case "placed":
        return order.status === "placed";
      case "preparing":
        return order.status === "confirmed";
      case "out-for-delivery":
        return order.status === "out-for-delivery";
      case "delivered-today":
        return order.status === "delivered" && (order.deliveredAt || "").startsWith(today);
      case "add-to-bill":
        return order.status === "delivered" && !order.billedToRoom;
      case "payment-pending":
        return order.paymentProofUrl && order.status === "payment-uploaded";
      case "cancelled":
        return order.status === "cancelled";
      default:
        return true;
    }
  };

  // FSO-05: Sort — actionable/attention first, then by nearest stay/order time
  const bookingSortScore = (booking: Booking): number => {
    if (bookingQuickViewPredicate(booking, "needs-attention")) return 0;
    if (booking.status === "checked-in" && booking.checkOut === today) return 1;
    if (booking.status === "checked-in") return 2;
    if (booking.status === "confirmed" && booking.checkIn === today) return 3;
    if (booking.status === "checked-out") return 4;
    return 5;
  };

  // Folio helpers must be initialized before the filteredRows useMemo below.
  // Advanced payment-state filters calculate each booking's live folio during
  // render, so leaving these const declarations below that memo triggers the
  // temporal dead zone in production builds.
  // Per PMH-02 (2026-07-31): folio math is now sourced from the
  // shared `computeBookingFolio` helper. The wrapper below is a
  // thin adapter that feeds the React state (selectedBooking,
  // selectedBookingPayments, selectedBookingCharges, storeOrders)
  // into the shared function. Eight call sites in this file now
  // go through this wrapper; the math lives in `shared/` so MRB-04
  // and any future group-folio change can edit one place.
  const getBookingFolio = (booking: Booking) => {
    const isSelected = selectedBooking?.id === booking.id;
    const folioBookingIds = isSelected ? selectedFolioBookingIds : [booking.id];
    return computeBookingFolio({
      booking: isSelected
        ? { ...booking, totalPrice: selectedFolioBaseTotal }
        : booking,
      // Prefer the live (selected) payments when this is the
      // selected booking (optimistic-update path). Otherwise
      // use the booking's persisted payments.
      selectedBookingPayments: isSelected ? selectedBookingPayments : undefined,
      persistedPayments: isSelected ? undefined : (booking.onsitePayments || []),
      selectedBookingCharges: isSelected ? selectedBookingCharges : undefined,
      folioBookingIds,
      storeOrders: storeOrders as any
    });
  };

  // FSO-08/09: Advanced filter predicates
  const matchesBookingAdvanced = (booking: Booking): boolean => {
    const folio = getBookingFolio(booking);
    // Payment state
    if (bPayState) {
      const totalPayments = folio.paymentsTotal;
      if (bPayState === "unpaid" && totalPayments > 0) return false;
      if (bPayState === "partial" && (totalPayments <= 0 || totalPayments >= booking.totalPrice)) return false;
      if (bPayState === "paid" && totalPayments < booking.totalPrice) return false;
      if (bPayState === "overpaid" && totalPayments <= booking.totalPrice) return false;
    }
    // Payment method
    if (bPaymentMethod && booking.paymentMethod !== bPaymentMethod) return false;
    // Room
    if (bRoom && booking.roomNumber !== bRoom) return false;
    // Room type
    if (bRoomType && booking.roomType !== bRoomType) return false;
    // Source
    if (bSource && booking.source !== bSource) return false;
    // Corporate
    if (bCorp === "yes" && !booking.isCorporate) return false;
    if (bCorp === "no" && booking.isCorporate) return false;
    // Discount/voucher
    if (bDiscount === "yes" && !booking.discountType && !booking.voucherCode) return false;
    if (bDiscount === "no" && (booking.discountType || booking.voucherCode)) return false;
    // Date basis/range
    const dateField: Record<string, string> = { stay: booking.checkIn, arrival: booking.checkIn, departure: booking.checkOut, created: booking.createdAt };
    const bookingDate = dateField[bDateBasis] || booking.checkIn;
    if (bDateFrom && bookingDate < bDateFrom) return false;
    if (bDateTo && bookingDate > bDateTo) return false;
    return true;
  };

  // FSO-04: Combined filtered + sorted booking rows
  const filteredRows = useMemo(() => {
    let rows = bookings.filter((booking) => {
      const s = bookingSearch.toLowerCase().trim();
      const matchesSearch = !s || (
        booking.guestName.toLowerCase().includes(s) ||
        booking.bookingRef.toLowerCase().includes(s) ||
        booking.roomNumber.includes(s) ||
        booking.guestEmail.toLowerCase().includes(s) ||
        booking.guestPhone.includes(s) ||
        // Per 2026-07-24 (refactor/unify-payment-reference-fields):
        // the canonical payment reference lives on each entry in
        // the booking's onsitePayments[] ledger. The previous
        // top-level `paymentReferenceNumber` is retired.
        (booking.onsitePayments || []).some((p) => (p.transactionReference || "").toLowerCase().includes(s))
      );
      const matchesStatus = bookingStatusFilter === "all" || booking.status === bookingStatusFilter;
      const matchesQV = bookingQuickView === "all" || bookingQuickViewPredicate(booking, bookingQuickView);
      const matchesAdvanced = matchesBookingAdvanced(booking);
      return matchesSearch && matchesStatus && matchesQV && matchesAdvanced;
    });
    rows.sort((a, b) => {
      const sa = bookingSortScore(a);
      const sb = bookingSortScore(b);
      if (sa !== sb) return sa - sb;
      return (a.checkIn || "").localeCompare(b.checkIn || "");
    });
    return rows;
  }, [bookings, bookingSearch, bookingStatusFilter, bookingQuickView, bDateBasis, bDateFrom, bDateTo, bPayState, bPaymentMethod, bRoom, bRoomType, bSource, bCorp, bDiscount]);

  // Per MRB-07 (2026-08-02, per decision #159): the main Bookings list
  // shows one row per RESERVATION, with its room stays nested beneath
  // it. Operational quick views stay room rows — when the desk is
  // working arrivals, departures, in-house or needs-attention, the unit
  // of work is a room, not a reservation, and collapsing rooms into a
  // group would hide the very rows being worked.
  const OPERATIONAL_QUICK_VIEWS = new Set([
    "needs-attention",
    "arrivals-today",
    "departures-today",
    "in-house"
  ]);
  const bookingListIsGrouped = !OPERATIONAL_QUICK_VIEWS.has(bookingQuickView);

  // Per MRB-12 (2026-08-03, per decision #179 — proposed):
  // a `Map<reservationId, Reservation>` lookup so the row builder
  // can read the header in O(1). Rebuilt only when the
  // `reservations` array reference changes (i.e. on snapshot
  // updates, not on every render).
  const reservationsMap = useMemo(
    () => new Map(reservations.map((reservation) => [reservation.id, reservation])),
    [reservations]
  );

  // Which reservations the desk has expanded. Collapsed by default so
  // a group booking reads as one line until the desk asks for the
  // rooms.
  const [expandedReservationIds, setExpandedReservationIds] = useState<Set<string>>(new Set());
  const toggleReservationExpanded = (reservationId: string) => {
    setExpandedReservationIds((current) => {
      const next = new Set(current);
      if (next.has(reservationId)) next.delete(reservationId);
      else next.add(reservationId);
      return next;
    });
  };

  // The flattened row list the table renders: a synthetic reservation
  // row followed by its room stays when expanded. A reservation is only
  // grouped when it actually holds more than one of the rows currently
  // in view — a single-room reservation, a legacy booking with no
  // reservation link, or a group whose other rooms were filtered out
  // all render as plain room rows, so filters never lie about what is
  // in the result set.
  const groupedRows = useMemo<BookingListRow[]>(() => {
    if (!bookingListIsGrouped) {
      return filteredRows.map((booking) => ({ ...booking, listRowKind: "booking" as const }));
    }

    const byReservation = new Map<string, Booking[]>();
    for (const booking of filteredRows) {
      const reservationId = booking.reservationId;
      if (!reservationId) continue;
      const group = byReservation.get(reservationId);
      if (group) group.push(booking);
      else byReservation.set(reservationId, [booking]);
    }

    const emitted = new Set<string>();
    const rows: BookingListRow[] = [];
    for (const booking of filteredRows) {
      if (emitted.has(booking.id)) continue;
      const reservationId = booking.reservationId;
      const group = reservationId ? byReservation.get(reservationId) : undefined;

      if (!reservationId || !group || group.length < 2) {
        rows.push({ ...booking, listRowKind: "booking" });
        emitted.add(booking.id);
        continue;
      }

      const sorted = [...group].sort(
        (a, b) => (a.reservationPosition || 0) - (b.reservationPosition || 0)
      );
      // Per MRB-12 (2026-08-03, per decision #179 — proposed):
      // the row's `totalPrice` and `listReservationBalance` are
      // read from the `Reservation` header + the reservation-scope
      // paid-amount aggregate (`reservations` + `reservationPaidAmount`
      // from the AdminContext listener). The header doesn't filter,
      // so the previously-existing bug — where the row's
      // `listReservationBalance` summed the FILTERED children and
      // silently dropped any child hidden by an active filter —
      // is fixed by construction. When the header is not yet in
      // memory (cold-start race; the listener hydrates on the
      // first snapshot), fall back to the child sum so the first
      // paint byte-matches the pre-MRB-12 surface; the listener's
      // next tick replaces the row with the header-sourced values.
      const reservationHeader = reservationsMap.get(reservationId);
      const paidAmount = reservationPaidAmount[reservationId] || 0;
      const reservationTotal = reservationHeader
        ? reservationHeader.totalPrice
        : sorted.reduce((sum, child) => sum + (child.totalPrice || 0), 0);
      const reservationBalance = reservationHeader
        ? Math.max(0, reservationHeader.totalPrice - paidAmount)
        : sorted.reduce((sum, child) => sum + getBookingFolio(child).balance, 0);
      // The reservation row borrows the lead room's identity for the
      // fields every column already knows how to read, and overrides
      // the ones that are reservation-scoped (money, room label,
      // occupancy). The columns special-case `listRowKind` where the
      // reservation needs to read differently from a room.
      rows.push({
        ...sorted[0],
        id: `reservation_${reservationId}`,
        listRowKind: "reservation",
        listReservationId: reservationId,
        listRoomCount: sorted.length,
        listChildBookings: sorted,
        listReservationBalance: reservationBalance,
        totalPrice: reservationTotal,
        numGuests: sorted.reduce((sum, child) => sum + (child.numGuests || 0), 0),
        // Per MRB-12 (2026-08-03, per decision #179 — proposed):
        // attach the header + paid-amount aggregate so the
        // Status column (MRB-12-02) can render the aggregate
        // `paymentStatus` + cancellation-count chip without a
        // second lookup.
        listReservationHeader: reservationHeader,
        listReservationPaidAmount: paidAmount
      });
      emitted.add(booking.id);

      if (expandedReservationIds.has(reservationId)) {
        for (const child of sorted) {
          rows.push({ ...child, listRowKind: "roomStay", listReservationId: reservationId });
          emitted.add(child.id);
        }
      } else {
        for (const child of sorted) emitted.add(child.id);
      }
    }
    return rows;
  }, [filteredRows, bookingListIsGrouped, expandedReservationIds, reservationsMap, reservationPaidAmount]);

  // Per MRB-07 (2026-08-02, per decision #159): the reservation context
  // for whatever booking the drawer currently has open. `null` for a
  // legacy booking with no reservation link, and for a reservation that
  // only ever held one room — in both cases there is no "other rooms"
  // to disambiguate against, so the drawer stays exactly as it was.
  const selectedReservationContext = useMemo(() => {
    if (!selectedBooking?.reservationId) return null;
    const siblings = bookings
      .filter((booking) => booking.reservationId === selectedBooking.reservationId)
      .sort((a, b) => (a.reservationPosition || 0) - (b.reservationPosition || 0));
    if (siblings.length < 2) return null;
    return {
      reservationId: selectedBooking.reservationId,
      reservationRef: selectedBooking.reservationRef || "",
      rooms: siblings,
      roomCount: siblings.length,
      position: siblings.findIndex((booking) => booking.id === selectedBooking.id) + 1
    };
  }, [selectedBooking, bookings]);

  // Every action inside a multi-room reservation states what it touches.
  // Without this the desk cannot tell whether "Cancel Booking" drops one
  // room or the whole group — the single most expensive ambiguity in a
  // group booking. Rendered only when there IS more than one room, so
  // ordinary single-room work is not cluttered with a label that would
  // always read the same.
  const renderActionScope = (scope: "room" | "reservation") => {
    if (!selectedReservationContext) return null;
    return (
      <span
        className={cn(
          "ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider",
          scope === "room"
            ? "bg-white/20 text-current"
            : "bg-amber-100 text-amber-800"
        )}
      >
        {scope === "room" ? "This room" : "All rooms"}
      </span>
    );
  };

  // Per MRB-12 (2026-08-03, per decision #179 — proposed): the
  // reservation-scope payment-state pill rendered in the
  // Bookings table's Status column for reservation rows
  // (MRB-12-02). The pill is the aggregate read: it states the
  // group's payment state from the `Reservation.paymentStatus`
  // header field (populated by MRB-12-01's listener) and
  // surfaces the due amount when the group is not yet settled.
  // The legacy "Mixed" wording is gone — the desk sees a
  // concrete state instead of a generic chip when the children
  // disagree. N=1 + legacy null-`reservationId` paths do not
  // render this pill (the per-booking `StatusBadge` byte-
  // equivalent is preserved).
  const renderReservationPaymentStatusPill = (
    status: string,
    totalPrice: number,
    paidAmount: number
  ) => {
    // Map the reservation's `paymentStatus` to the same tone
    // set `StatusBadge` uses for booking statuses (the
    // reservation enum mirrors the booking status flow but
    // uses kebab-cased labels). The `Awaiting` variant
    // surfaces the outstanding amount — the desk sees the
    // group's due total in one glance without expanding the
    // row.
    const tone: Record<string, { label: string; className: string }> = {
      "awaiting-payment": { label: "Awaiting", className: "bg-blue-50 text-blue-700 ring-blue-200" },
      "payment-uploaded": { label: "Proof pending", className: "bg-violet-50 text-violet-700 ring-violet-200" },
      "payment-confirmed": { label: "Verified", className: "bg-blue-50 text-blue-700 ring-blue-200" },
      confirmed: { label: "Confirmed", className: "bg-green-50 text-green-700 ring-green-200" },
      "in-house": { label: "In-house", className: "bg-primary-light text-primary-dark ring-primary" },
      completed: { label: "Completed", className: "bg-gray-100 text-gray-600 ring-gray-200" },
      cancelled: { label: "Cancelled", className: "bg-red-50 text-red-700 ring-red-200" }
    };
    const entry = tone[status] || tone["awaiting-payment"];
    const balance = Math.max(0, totalPrice - paidAmount);
    // Per MRB-12-02: surface the outstanding amount when
    // the group is not yet settled. Settled groups show the
    // state label only (no "₱0 due" noise).
    const showDue = balance > 0 && status !== "cancelled";
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 ring-inset",
          entry.className
        )}
      >
        <span>{entry.label}</span>
        {showDue && <span className="text-[9px] font-semibold opacity-80">₱{Math.round(balance).toLocaleString()} due</span>}
      </span>
    );
  };

  const handleRowClick = (row: BookingListRow) => {
    if (row.listRowKind === "reservation") {
      toggleReservationExpanded(row.listReservationId!);
      return;
    }
    setSelectedBooking(row);
    setIsDrawerOpen(true);
  };

  // Store Columns
  const storeColumns: Array<DataTableColumn<any>> = [
    {
      key: "orderRef",
      header: "Order Ref",
      render: (row) => (
        <span className="inline-flex items-center gap-1.5">
          {row.orderRef}
          {row.isTestData && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">TEST</span>
          )}
        </span>
      )
    },
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

  const renderBookingCard = (row: BookingListRow) => {
    // Per MRB-07 (2026-08-02, per decision #159): on a phone a
    // reservation renders as a compact summary card that expands to its
    // room cards, rather than repeating the full room detail of its
    // lead room.
    if (row.listRowKind === "reservation") {
      const mixedStatus = new Set((row.listChildBookings || []).map((child) => child.status)).size > 1;
      return (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5">
              {expandedReservationIds.has(row.listReservationId!) ? (
                <ChevronDown size={13} className="text-gray-500" aria-hidden="true" />
              ) : (
                <ChevronRight size={13} className="text-gray-500" aria-hidden="true" />
              )}
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-700">
                REF: {row.reservationRef || row.bookingRef}
              </span>
              {row.isTestData && (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">TEST</span>
              )}
            </span>
            {mixedStatus ? (
              <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-600 ring-1 ring-gray-200">
                Mixed
              </span>
            ) : (
              <StatusBadge label={row.status.replace("-", " ")} status={row.status} />
            )}
          </div>
          <p className="text-base font-bold text-gray-900">{row.guestName}</p>
          <div className="flex items-center gap-3 text-xs text-gray-600">
            <span className="flex items-center gap-1">
              <Calendar size={12} className="text-gray-400" aria-hidden="true" />
              {row.checkIn} – {row.checkOut}
            </span>
            <span className="flex items-center gap-1">
              <BedDouble size={12} className="text-gray-400" aria-hidden="true" />
              {row.listRoomCount} rooms
            </span>
          </div>
          <div className="flex items-center justify-between">
            <strong className="text-sm font-bold text-gray-900">{formatPrice(row.totalPrice)}</strong>
            {(row.listReservationBalance || 0) > 0 && (
              <span className="text-[11px] font-semibold text-amber-700">
                {formatPrice(row.listReservationBalance!)} due
              </span>
            )}
          </div>
          <p className="text-[11px] font-semibold text-gray-500">
            Tap to {expandedReservationIds.has(row.listReservationId!) ? "hide" : "show"} rooms
          </p>
        </div>
      );
    }

    return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-700">
            REF: {row.bookingRef}
          </span>
          {row.isTestData && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">TEST</span>
          )}
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
        {row.numNights} {row.numNights === 1 ? "night" : "nights"} · {(() => {
          // Per EXB-08 (2026-08-01, per decision #156):
          // the Bookings table row now shows the
          // adult/child split when both fields are
          // present, with the extra bed count appended
          // when > 0. Legacy pre-CHD bookings read as
          // a single `numGuests` total. Matches the
          // drawer header + receipt PDF + the email
          // helper so the staff surfaces stay in
          // lockstep.
          const numAdults = Number((row as any).numAdults);
          const numChildren = Number((row as any).numChildren);
          const extraBedCount = Number((row as any).extraBedCount);
          if (Number.isFinite(numAdults) && Number.isFinite(numChildren) && (numAdults > 0 || numChildren > 0)) {
            const splitLabel = `${numAdults}A + ${numChildren}C`;
            const extraLabel = Number.isFinite(extraBedCount) && extraBedCount > 0
              ? ` + ${extraBedCount} bed${extraBedCount === 1 ? "" : "s"}`
              : "";
            return <span title={`${row.numGuests} guest${row.numGuests === 1 ? "" : "s"} total`}>{splitLabel}{extraLabel}</span>;
          }
          return <>{row.numGuests} {row.numGuests === 1 ? "guest" : "guests"}</>;
        })()}
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
  };

  const renderOrderCard = (row: any) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-700">
            REF: {row.orderRef}
          </span>
          {row.isTestData && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">TEST</span>
          )}
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

  // FSO-12/13: Store advanced filter predicates
  const matchesStoreAdvanced = (order: any): boolean => {
    if (sRoom && order.roomNumber !== sRoom) return false;
    if (sPaymentMethod && order.paymentMethod !== sPaymentMethod) return false;
    if (sBilling === "direct" && order.paymentMethod === "add-to-bill") return false;
    if (sBilling === "add-to-bill" && order.paymentMethod !== "add-to-bill") return false;
    if (sBilled === "billed" && !order.isBilled) return false;
    if (sBilled === "unbilled" && order.isBilled) return false;
    if (sPayProof === "uploaded" && !order.paymentProofUrl) return false;
    if (sPayProof === "verified" && order.status !== "payment-confirmed") return false;
    if (sDateFrom && (order.createdAt || "") < sDateFrom) return false;
    if (sDateTo && (order.createdAt || "") > sDateTo) return false;
    return true;
  };

  // FSO-04/10: Combined filtered + sorted store orders
  const filteredOrders = useMemo(() => {
    let rows = storeOrders.filter((order) => {
      const s = storeSearch.toLowerCase().trim();
      const matchesSearch = !s || (
        order.guestName?.toLowerCase().includes(s) ||
        order.orderRef?.toLowerCase().includes(s) ||
        order.roomNumber?.includes(s) ||
        (order.bookingId || "").toLowerCase().includes(s) ||
        (order.notes || "").toLowerCase().includes(s) ||
        (order.items || []).some((i: any) => (i.name || "").toLowerCase().includes(s))
      );
      const matchesStatus = storeStatusFilter === "all" || order.status === storeStatusFilter;
      const matchesQV = storeQuickView === "all" || storeQuickViewPredicate(order, storeQuickView);
      const matchesAdvanced = matchesStoreAdvanced(order);
      return matchesSearch && matchesStatus && matchesQV && matchesAdvanced;
    });
    rows.sort((a: any, b: any) => {
      const aAction = storeQuickViewPredicate(a, "needs-action") ? 0 : 1;
      const bAction = storeQuickViewPredicate(b, "needs-action") ? 0 : 1;
      if (aAction !== bAction) return aAction - bAction;
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
    return rows;
  }, [storeOrders, storeSearch, storeStatusFilter, storeQuickView, sRoom, sPaymentMethod, sBilling, sBilled, sPayProof, sDateFrom, sDateTo]);

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

  const handleCancelBooking = async (reason: string, scope: "room" | "reservation" = "room") => {
    if (!selectedBooking) return;
    // Per MRB-13 (2026-08-02, per decision #166): the
    // scope selector flows into `updateBookingStatus`
    // as the 4th arg (`options.scope`). The default
    // `"room"` is the legacy per-child path (byte-
    // compatible with pre-MRB-13). The
    // reservation-scope path cancels every cancellable
    // child of the reservation in one transaction +
    // decrements the shared voucher / corporate code
    // `usageCount` exactly once per code. The
    // `confirmLabel` already states the room count
    // when `selectedReservationContext` is set, so the
    // staff sees what they're about to cancel before
    // they tap.
    updateBookingStatus(selectedBooking.id, "cancelled", { cancellationReason: reason }, { scope });
    setSelectedBooking(prev => prev ? { ...prev, status: "cancelled", cancellationReason: reason } : null);
    toast.success(
      "Booking cancelled",
      scope === "reservation"
        ? `All rooms in this reservation have been cancelled. ${reason ? `Reason: ${reason}` : "Guest will be notified by email."}`
        : reason ? `Reason: ${reason}` : "Guest will be notified by email."
    );
    setShowBookingCancelForm(false);
    // Per MRB-13: reset the scope on close so a
    // previous session's choice never bleeds into a
    // new session. The default `"room"` is the safer
    // choice.
    setBookingCancelScope("room");
    cancelPreviewRequestIdRef.current += 1;
    // Per CRL-06: drop the preview state on close
    // so a previous session's breakdown never
    // bleeds into a new session.
    setCancelPreview(null);
    setCancelPreviewError(null);
  };

  // Per CRL-06 (2026-08-02): the cancellation preview
  // fetch. The cancel modal calls this on open
  // (mounted by the `useEffect` below) and on scope
  // flip. The endpoint is `/api/bookings/cancel-preview`
  // (apiRouter's flat `[domain, action]` shape — same
  // pattern as `add-payment` / `create-walkin`). The
  // staff path uses the staff's ID token; the body
  // carries `bookingId` + `scope` so the server can
  // resolve the looked-up booking. The fetch never
  // mutates anything — the user sees the financial
  // breakdown before tapping confirm.
  const fetchCancelPreview = async (bookingId: string, scope: "room" | "reservation") => {
    const requestId = ++cancelPreviewRequestIdRef.current;
    setCancelPreviewLoading(true);
    setCancelPreviewError(null);
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const res = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/cancel-preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({ bookingId, scope })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load the cancellation preview.");
      }
      if (requestId !== cancelPreviewRequestIdRef.current) return;
      setCancelPreview(data.preview);
    } catch (err: any) {
      // Per CRL-06: the preview is best-effort. The
      // destructive cancel still proceeds (the user
      // can confirm with the panel in the error
      // state). The error surfaces in the panel so
      // the staff knows the breakdown is unavailable.
      if (requestId === cancelPreviewRequestIdRef.current) {
        setCancelPreview(null);
        setCancelPreviewError(err?.message || "Could not load the cancellation preview.");
      }
    } finally {
      if (requestId === cancelPreviewRequestIdRef.current) {
        setCancelPreviewLoading(false);
      }
    }
  };

  // Per CRL-06: trigger the preview fetch when the
  // cancel modal opens or the scope flips. The
  // `useEffect` is intentionally scoped to the
  // `[showBookingCancelForm, selectedBooking?.id,
  // bookingCancelScope]` triple — a re-fetch fires
  // when any of those change. The destructive
  // cancel never auto-fires this (the modal close
  // path clears state in `handleCancelBooking`).
  useEffect(() => {
    if (showBookingCancelForm && selectedBooking?.id) {
      void fetchCancelPreview(selectedBooking.id, bookingCancelScope);
    }
  }, [showBookingCancelForm, selectedBooking?.id, bookingCancelScope]);

  // Per feat/payment-success-modal: the success modal's
  // "Confirm Booking" CTA runs the `payment-confirmed` →
  // `confirmed` transition. The onSnapshot listener will
  // refresh `selectedBooking` on the next tick (see
  // fix/bookings-drawer-stale-state), and the modal closes
  // regardless of outcome so the staff never gets stuck
  // behind it on a slow network.
  const handleConfirmBookingFromSuccess = async () => {
    if (!verifySuccess) return;
    setConfirmingBookingFromSuccess(true);
    try {
      await updateBookingStatus(verifySuccess.booking.id, "confirmed");
      toast.success("Booking confirmed", `${verifySuccess.booking.bookingRef} is ready for the guest's arrival.`);
    } catch (err: any) {
      toast.error("Failed to confirm booking", err?.message || "Please try again.");
    } finally {
      setConfirmingBookingFromSuccess(false);
      setVerifySuccess(null);
    }
  };

  // Per CWB-04 / decision #122 (2026-07-23): the post-verify
  // partial-payment variant's "Confirm with Balance" CTA opens
  // the confirm-with-balance form. We carry the just-computed
  // `remainingBalance` from the success modal so the form can
  // preview the right number even before the onSnapshot
  // listener catches up. The form is the source of truth for
  // the actual transition; it calls `confirmBookingWithBalance`
  // and the snapshot listener refreshes the drawer.
  const openConfirmWithBalanceFromSuccess = () => {
    if (!verifySuccess) return;
    setConfirmWithBalanceContext({
      booking: verifySuccess.booking,
      currentBalance: Math.max(0, verifySuccess.remainingBalance)
    });
    setVerifySuccess(null);
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

    // Per the 2026-07-24 follow-up to the HEIC decode timeout: the
    // generator has multiple awaits (brand-logo fetch, Firebase
    // Storage `getBlob`, FileReader, `canvas.toDataURL`, etc.) and
    // only the image-decode step is individually bounded. A single
    // hung await anywhere in the chain leaves the placeholder tab
    // open forever. This outer timeout guarantees the tab is closed
    // and a clear error toast is shown no matter where the hang is.
    const PDF_GENERATION_TIMEOUT_MS = 20_000;
    let timeoutHandle: number | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = window.setTimeout(
        () => reject(new Error("Registration PDF generation took too long. The guest ID photo may be too large or the network is slow — try again or re-upload a smaller ID.")),
        PDF_GENERATION_TIMEOUT_MS
      );
    });

    try {
      const buildAndOpen = async () => {
        const pdf = new jsPDF({ unit: "mm", format: "a4" });
        await registerBrandPdfFonts(pdf);
        const logoDataUrl = await getPdfBrandLogoDataUrl();
        setPdfFont(pdf, "Inter");
    const pageW = 210;
    const marginL = 15;
    const marginR = pageW - 15;
    const generatedAt = new Date().toLocaleString(config.locale, {
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
    // Per EXB-08 (2026-08-01, per decision #156): the
    // receipt PDF's occupancy line now shows the
    // adult/child split when both fields are present,
    // with the extra bed count appended when > 0.
    // Legacy pre-CHD bookings read as a single
    // `numGuests` total. The "Guests:" prefix is
    // preserved for the legacy case so the receipt
    // stays scannable; the split case uses the
    // compact "2A + 1C + 1 extra bed" form to fit
    // the single-line PDF layout.
    {
      const numAdults = Number((b as any).numAdults);
      const numChildren = Number((b as any).numChildren);
      const extraBedCount = Number((b as any).extraBedCount);
      if (Number.isFinite(numAdults) && Number.isFinite(numChildren) && (numAdults > 0 || numChildren > 0)) {
        const splitLabel = `${numAdults}A + ${numChildren}C (${b.numGuests})`;
        const extraLabel = Number.isFinite(extraBedCount) && extraBedCount > 0
          ? ` + ${extraBedCount} extra bed${extraBedCount === 1 ? "" : "s"}`
          : "";
        pdf.text(`Guests: ${splitLabel}${extraLabel}  |  Nights: ${b.numNights}`, marginL + 5, y);
      } else {
        pdf.text(`Guests: ${b.numGuests}  |  Nights: ${b.numNights}`, marginL + 5, y);
      }
    }
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
      // Per Decision #121: render Purpose of stay inline; if the staff
      // picked "Other" the free-text reason (reg.otherPurpose) is
      // appended to the same line so it stays in the same row.
      ["Purpose of stay", reg?.purposeOfStay
        ? `${reg.purposeOfStay}${reg.purposeOfStay.toLowerCase() === "other" && reg?.otherPurpose ? ` — ${reg.otherPurpose}` : ""}`
        : "—"
      ],
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
        const guestIdRef = storageRef(storage, b.guestIdPhotoUrl);
        const blob = await getBlob(guestIdRef);
        const pdfImage = await normalizePdfImageToJpeg(blob);

        const maxW = idBoxW - 2;
        const maxH = idBoxH - 2;
        const imgRatio = pdfImage.width / pdfImage.height;
        let drawW = maxW;
        let drawH = drawW / imgRatio;
        if (drawH > maxH) {
          drawH = maxH;
          drawW = drawH * imgRatio;
        }

        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.3);
        const drawX = idX + (idBoxW - drawW) / 2;
        const drawY = idBoxY + (idBoxH - drawH) / 2;
        pdf.rect(idX, idBoxY, idBoxW, idBoxH);
        pdf.addImage(pdfImage.dataUrl, "JPEG", drawX, drawY, drawW, drawH);
      } catch {
        throw new Error(
          "The uploaded guest ID could not be added to the registration PDF. Please re-upload the ID and try again."
        );
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
        return result;
      };
      await Promise.race([buildAndOpen(), timeoutPromise]);
    } catch (error) {
      pdfWindow?.close();
      toast.error("Registration PDF failed", error instanceof Error ? error.message : "Please try again.");
    } finally {
      if (timeoutHandle !== undefined) {
        window.clearTimeout(timeoutHandle);
      }
    }
  };

  const printBookingReceiptPDF = async () => {
    if (!selectedBooking) return;
    const b = selectedBooking;
    const isReservationReceipt = Boolean(b.reservationId);
    const receiptBookings = isReservationReceipt
      ? bookings
          .filter((booking) => booking.reservationId === b.reservationId)
          .sort((left, right) => {
            const positionDifference = Number(left.reservationPosition || 0) - Number(right.reservationPosition || 0);
            return positionDifference || left.bookingRef.localeCompare(right.bookingRef);
          })
      : [b];
    if (receiptBookings.length === 0) receiptBookings.push(b);
    const receiptReference = isReservationReceipt
      ? (b.reservationRef || b.bookingRef)
      : b.bookingRef;
    const receiptReferenceLabel = isReservationReceipt ? "Reservation Reference" : "Booking Reference";
    const receiptFileStem = receiptReference || b.bookingRef || "booking";
    const getReceiptRoomLabel = (booking: Booking, index: number) =>
      isReservationReceipt
        ? `Room ${booking.reservationPosition || index + 1} of ${receiptBookings.length} — ${booking.roomType}`
        : booking.roomType;
    const getReceiptAttribution = (bookingId?: string | null) => {
      if (!isReservationReceipt || !bookingId) return "";
      const bookingIndex = receiptBookings.findIndex((booking) => booking.id === bookingId);
      if (bookingIndex < 0) return "";
      const booking = receiptBookings[bookingIndex];
      return ` — Room ${booking.reservationPosition || bookingIndex + 1}`;
    };
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

      const generatedAt = new Date().toLocaleString(config.locale, {
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
            subtitle: `${receiptReferenceLabel}: ${receiptReference}`,
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
        `${config.currencySymbol}${Math.round(value || 0).toLocaleString(config.locale)}`;

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
        subtitle: `${receiptReferenceLabel}: ${receiptReference}`,
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
      pdf.text(`${isReservationReceipt ? "Reservation" : "Booking"} ${receiptReference} • Generated ${generatedAt}`, marginL + 5, y + 6.2, { charSpace: 0 });
      y += 12; // Reduced gap

      // ── Guest & Stay Information ──
      const cardGap = 6;
      const cardW = (marginR - marginL - cardGap) / 2;
      const guestCardH = drawInfoCard("Guest", [
        { label: "Name", value: b.guestName },
        { label: "Email", value: b.guestEmail },
        { label: "Phone", value: b.guestPhone }
      ], marginL, y, cardW);
      const receiptGuestCount = receiptBookings.reduce((sum, booking) => sum + (Number(booking.numGuests) || 0), 0);
      const stayRows = [
        {
          label: isReservationReceipt ? "Rooms" : "Room",
          value: isReservationReceipt
            ? `${receiptBookings.length} room${receiptBookings.length === 1 ? "" : "s"} — itemized below`
            : `${b.roomNumber} (${b.roomType})`
        },
        { label: "Dates", value: `${b.checkIn} to ${b.checkOut}` },
        // Per MRB-14 (2026-08-03, per decision #180): when
        // the reservation's children have diverged from the
        // header's original shared dates, the receipt adds
        // an "Actual range" line so the printed copy matches
        // what the guest sees in the email + the desk sees
        // in the Bookings table. The per-room dates are
        // still printed per-row in the pricing breakdown
        // below. Pre-MRB-14 reservations carry no
        // `actualDateRange` and the line is hidden.
        ...((isReservationReceipt && b.reservationId && reservationsMap.get(b.reservationId)?.actualDateRange?.isDivergent)
          ? [{
              label: "Actual range",
              value: `${formatShortDate(reservationsMap.get(b.reservationId)!.actualDateRange!.earliestCheckIn)} to ${formatShortDate(reservationsMap.get(b.reservationId)!.actualDateRange!.latestCheckOut)} (varies by room)`
            }]
          : []),
        // Per EXB-08 (2026-08-01, per decision #156):
        // the receipt's "Stay" line shows the adult/child
        // split when both fields are present, with the
        // extra bed count appended when > 0. Legacy pre-CHD
        // bookings read as a single `numGuests` total.
        { label: "Stay", value: (() => {
          if (isReservationReceipt) {
            const nightsLabel = `${b.numNights} night${b.numNights === 1 ? "" : "s"}`;
            return `${nightsLabel} • ${receiptGuestCount} guest${receiptGuestCount === 1 ? "" : "s"} across ${receiptBookings.length} room${receiptBookings.length === 1 ? "" : "s"}`;
          }
          const numAdults = Number((b as any).numAdults);
          const numChildren = Number((b as any).numChildren);
          const extraBedCount = Number((b as any).extraBedCount);
          const nightsLabel = `${b.numNights} night${b.numNights === 1 ? "" : "s"}`;
          if (Number.isFinite(numAdults) && Number.isFinite(numChildren) && (numAdults > 0 || numChildren > 0)) {
            const splitLabel = `${numAdults}A + ${numChildren}C (${b.numGuests} total)`;
            const extraLabel = Number.isFinite(extraBedCount) && extraBedCount > 0
              ? ` + ${extraBedCount} extra bed${extraBedCount === 1 ? "" : "s"}`
              : "";
            return `${nightsLabel} • ${splitLabel}${extraLabel}`;
          }
          return `${nightsLabel} • ${b.numGuests} guest${b.numGuests === 1 ? "" : "s"}`;
        })() },
        {
          label: "Rate",
          value: isReservationReceipt ? "See room allocations" : `${formatAmount(b.ratePerNight)} / night`
        }
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
      if (isReservationReceipt) {
        receiptBookings.forEach((receiptBooking, bookingIndex) => {
          const roomLabel = getReceiptRoomLabel(receiptBooking, bookingIndex);
          const breakdown = receiptBooking.rateBreakdown;
          checkNewPage(12 + (
            (breakdown?.roomLines?.length || 1)
            + (breakdown?.addOns?.length || 0)
            + (breakdown?.deductions?.length || 0)
          ) * 5);

          pdf.setFontSize(9.2);
          pdf.setTextColor(...brandRgb);
          pdf.setFont("helvetica", "bold");
          pdf.text(roomLabel, labelColX, y, { charSpace: 0 });
          pdf.text(receiptBooking.bookingRef, amountX, y, { align: "right", charSpace: 0 });
          setPdfFont(pdf, "Inter");
          y += 4.4;

          // Per MRB-14 (2026-08-03, per decision #180):
          // when the reservation's children have diverged,
          // print the per-room dates inline under the
          // room label so the printed receipt matches the
          // "Actual range" line in the Stay card above and
          // the per-room dates in the email. Otherwise the
          // per-room dates match the reservation header
          // dates and are omitted (no duplication).
          const reservationActualRange = b.reservationId
            ? reservationsMap.get(b.reservationId)?.actualDateRange
            : null;
          if (reservationActualRange?.isDivergent && receiptBooking.checkIn && receiptBooking.checkOut) {
            pdf.setFontSize(8.0);
            pdf.setTextColor(120, 120, 120);
            const roomDatesLabel = `  ${receiptBooking.checkIn} → ${receiptBooking.checkOut}`;
            pdf.text(roomDatesLabel, labelColX, y, { charSpace: 0 });
            y += 4.0;
          }

          if (breakdown?.roomLines?.length) {
            breakdown.roomLines.forEach((line) => {
              drawAmountRow(
                `  ${line.label}: ${line.nights} x ${formatAmount(line.nightlyRate)}`,
                formatAmount(line.subtotal)
              );
            });
            breakdown.addOns.forEach((line) => {
              drawAmountRow(`  ${line.label}`, formatAmount(line.amount));
            });
            breakdown.deductions.forEach((line) => {
              drawAmountRow(`  ${line.label}`, `-${formatAmount(line.amount)}`, { muted: true });
            });
          } else {
            const roomSubtotal = receiptBooking.ratePerNight * receiptBooking.numNights;
            drawAmountRow(
              `  Room subtotal: ${receiptBooking.numNights} night${receiptBooking.numNights === 1 ? "" : "s"} x ${formatAmount(receiptBooking.ratePerNight)}`,
              formatAmount(roomSubtotal)
            );
          }

          drawAmountRow(
            `  ${roomLabel} total`,
            formatAmount(receiptBooking.totalPrice),
            { bold: true }
          );
          y += 1.5;
        });
      } else if (b.rateBreakdown?.roomLines?.length) {
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
          // Per DSC (2026-07-31): the percentage step routes through the shared
          // `calculatePercentDiscount` helper. Byte-equivalent output: same
          // product, same `Math.round` wrap, same `Math.max(0, …)` clamp.
          const discountAmount = Math.max(0, Math.round(calculatePercentDiscount(storedDiscountBase, b.discountPct)));
          drawAmountRow(`${discountLabel} (${b.discountPct}%)`, `-${formatAmount(discountAmount)}`, { muted: true });
        }

        if (b.voucherCode && b.voucherDiscount && b.voucherDiscount > 0) {
          drawAmountRow(`Voucher (${b.voucherCode})`, `-${formatAmount(b.voucherDiscount)}`, { muted: true });
        }

        if (b.memberDiscountPct && b.memberDiscountPct > 0) {
          const discountBase = b.originalTotalPrice ?? subtotal;
          // Per DSC (2026-07-31): both the senior step and the member-base
          // subtraction now route through the shared helpers. The historical
          // pattern was `Math.max(discountBase − seniorPwdAmount − voucher, 0)`
          // — a single clamped subtraction of two deductions. The refactor
          // composes two `calculateVoucherBase` calls (byte-equivalent: a
          // clamped subtraction followed by another clamped subtraction on
          // the clamped result is the same as one clamped subtraction of
          // both deductions).
          const seniorPwdAmount = b.discountPct ? Math.round(calculatePercentDiscount(discountBase, b.discountPct)) : 0;
          const afterSenior = calculateVoucherBase(discountBase, seniorPwdAmount);
          const memberBase = calculateVoucherBase(afterSenior, b.voucherDiscount || 0);
          const memberDiscountAmount = Math.max(0, Math.round(calculatePercentDiscount(memberBase, b.memberDiscountPct)));
          drawAmountRow(`Member Discount (${b.memberDiscountPct}%)`, `-${formatAmount(memberDiscountAmount)}`, { muted: true });
        }

        if (b.pointsRedeemed && b.pointsRedeemed > 0) {
          drawAmountRow(`Spark Rewards: ${b.pointsRedeemed} pts redeemed`, `-${formatAmount(b.pointsRedeemedValue || 0)}`, { muted: true });
        }
      }

      // Reservation / booking base total banner. Folio-only
      // charges render separately below so they are counted once.
      y += 0.5;
      pdf.setFillColor(255, 247, 237);
      pdf.roundedRect(marginL, y - 2, marginR - marginL, 7.5, 1.5, 1.5, "F");
      y += 3.2;

      pdf.setFontSize(10);
      pdf.setTextColor(...brandRgb);
      pdf.text(isReservationReceipt ? "Reservation Total" : "Booking Total", labelColX, y, { charSpace: 0 });
      pdf.setFont("helvetica", "bold");
      pdf.text(formatAmount(isReservationReceipt ? selectedFolioBaseTotal : b.totalPrice), amountX, y, { align: "right", charSpace: 0 });
      setPdfFont(pdf, "Inter");
      y += 6.5;

      // ── VAT Breakdown ──
      // Per DSC-07 (2026-08-01, per #115): the receipt PDF now
      // shows the 12% VAT reconciliation the same way the
      // monthly XLSX export does. The helper composes the
      // senior discount from the booking's stored `originalTotalPrice`
      // (broad-scope approximation; documented narrow-scope
      // edge case in the helper header). The senior discount
      // is the VAT-exempt portion under RA 9994 (Philippine
      // BIR); the rest of the bill is VATable at 12%.
      checkNewPage(20);
      drawPdfSectionTitle(pdf, "VAT Breakdown (12% Philippine standard)", marginL, y, brandRgb);
      y += 4.5;
      const vatBreakdown = receiptBookings.reduce((totals, receiptBooking) => {
        const roomVat = getBookingVatBreakdown({
          totalPrice: receiptBooking.totalPrice,
          originalTotalPrice: receiptBooking.originalTotalPrice,
          discountType: receiptBooking.discountType,
          discountPct: receiptBooking.discountPct,
          discountRejected: receiptBooking.discountRejected
        });
        return {
          vatExclusiveSales: totals.vatExclusiveSales + roomVat.vatExclusiveSales,
          vatExemptSales: totals.vatExemptSales + roomVat.vatExemptSales,
          vatAmount: totals.vatAmount + roomVat.vatAmount
        };
      }, { vatExclusiveSales: 0, vatExemptSales: 0, vatAmount: 0 });
      drawAmountRow(
        "VATable Sales (VAT-exclusive)",
        formatAmount(vatBreakdown.vatExclusiveSales)
      );
      drawAmountRow(
        "VAT-Exempt Sales (RA 9994 Senior/PWD)",
        formatAmount(vatBreakdown.vatExemptSales)
      );
      drawAmountRow(
        "VAT Amount (12% × VATable)",
        formatAmount(vatBreakdown.vatAmount)
      );
      y += 1;

      if (receiptFolio.storeCharges.length > 0 || receiptFolio.charges.length > 0) {
        checkNewPage(12 + (receiptFolio.storeCharges.length + receiptFolio.charges.length) * 5);
        drawPdfSectionTitle(pdf, "Folio Charges", marginL, y, brandRgb);
        y += 4.5;
        receiptFolio.storeCharges.forEach((order) => {
          drawAmountRow(
            `Store order ${order.orderRef || order.bookingId || ""}${getReceiptAttribution(order.bookingId)}`,
            formatAmount(order.totalAmount ?? 0)
          );
        });
        receiptFolio.charges.forEach((charge) => {
          const amount = charge.amount ?? 0;
          drawAmountRow(
            `${charge.label || "Charge"}${getReceiptAttribution((charge as IncidentalCharge).bookingId)}`,
            formatAmount(amount),
            { muted: amount < 0 }
          );
        });
        drawAmountRow("Folio total", formatAmount(receiptFolio.grandTotal), { bold: true });
        y += 2;
      }

      // ── Special Requests / Notes ──
      const requestBookings = receiptBookings.filter(
        (receiptBooking) => receiptBooking.specialRequests?.trim().length > 0
      );
      if (requestBookings.length > 0) {
        checkNewPage(15);
        drawPdfSectionTitle(pdf, "Special Requests", marginL, y, brandRgb);
        y += 5;

        pdf.setFontSize(10);
        pdf.setTextColor(60, 60, 60);
        requestBookings.forEach((receiptBooking, requestIndex) => {
          const bookingIndex = receiptBookings.findIndex((booking) => booking.id === receiptBooking.id);
          if (isReservationReceipt) {
            checkNewPage(5);
            pdf.setFont("helvetica", "bold");
            pdf.text(getReceiptRoomLabel(receiptBooking, bookingIndex), labelColX, y, { charSpace: 0 });
            setPdfFont(pdf, "Inter");
            y += 4;
          }
          const reqLines = pdf.splitTextToSize(receiptBooking.specialRequests, pageW - 40);
          for (const line of reqLines) {
            checkNewPage(5);
            pdf.text(line, labelColX, y, { charSpace: 0 });
            y += 4.0;
          }
          if (requestIndex < requestBookings.length - 1) y += 1;
        });
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
            ? new Date(pay.recordedAt).toLocaleDateString(config.locale, {
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
          subtitle: `${receiptReferenceLabel}: ${receiptReference}`,
          meta: `Generated: ${generatedAt}`,
          brandRgb,
          printLight: true,
          compact: true
        });
      }
      drawPdfFooter(
        pdf,
        receiptReference,
        "This is a booking confirmation only. An official BIR receipt will be issued upon payment at the property.",
        brandRgb,
        footerY > 275 ? y + 8 : footerY,
        isReservationReceipt ? "Reservation Ref" : "Booking Ref"
      );

      const result = openPdfOrDownload(pdf, `${receiptFileStem}-receipt.pdf`, pdfWindow);
      toast.success(
        "Receipt PDF ready",
        result === "opened" ? "Opened in a new tab." : "Popup blocked, so the PDF was downloaded instead."
      );
    } catch (error) {
      pdfWindow?.close();
      toast.error("Receipt PDF failed", error instanceof Error ? error.message : "Please try again.");
    }
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

  // The PDF generator only knows how to rasterize JPEG/PNG/WebP into a
  // jsPDF page. Two paths land there:
  //   1. JPEG/PNG/WebP - pass through `compressImageFile` directly.
  //   2. HEIC/HEIF    - the registration PDF can't decode HEIC and the
  //                     iPhone "High Efficiency" default hits the
  //                     previous strict-reject path far too often to
  //                     leave it. Convert client-side to JPEG via
  //                     `heic-to` (LGPL-3.0, decision #125) before
  //                     the compression step. The lib is loaded via
  //                     dynamic `import()` only on HEIC detection so
  //                     non-iPhone uploads never pay the ~720 KB
  //                     gzipped chunk.
  //
  // Anything else (AVIF, TIFF, BMP, etc.) is still rejected — the
  // allowlist is the final enforcement point, the picker `accept`
  // attribute is just a hint.
  const HEIC_INPUT_MIME_TYPES = new Set(["image/heic", "image/heif"]);
  const ALLOWED_GUEST_ID_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp"
  ]);

  const handleGuestIdUpload = async (file: File | undefined) => {
    if (!file || !selectedBooking) return;

    // HEIC path: dynamic-import the WASM decoder, convert to JPEG,
    // then fall through to the standard compress+upload path with
    // the resulting `File`. The library uses Web Workers internally
    // (per its README) so the conversion does not block the UI thread.
    let processedFile: File = file;
    if (HEIC_INPUT_MIME_TYPES.has(file.type)) {
      try {
        setGuestIdUploadStatus("Converting HEIC to JPEG (first time only, ~720 KB download)...");
        const { heicTo } = await import("heic-to");
        const converted = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
        // Drop the original .heic / .heif extension; the convert
        // output is now a JPEG blob. Filename is intentionally
        // simple so downstream `safeName` normalization doesn't have
        // to deal with the new extension.
        const originalName = file.name || "guest-id";
        const baseName = originalName.replace(/\.(heic|heif)$/i, "");
        processedFile = new File([converted], `${baseName || "guest-id"}.jpg`, { type: "image/jpeg" });
      } catch (error) {
        setGuestIdUploadStatus(
          error instanceof Error
            ? `Could not convert HEIC image (${error.message}). Please re-capture or convert to JPEG manually.`
            : "Could not convert HEIC image. Please re-capture or convert to JPEG manually."
        );
        return;
      }
    } else if (!file.type || !ALLOWED_GUEST_ID_MIME_TYPES.has(file.type)) {
      setGuestIdUploadStatus(
        `Unsupported image format (${file.type || "unknown"}). Please re-capture or convert to JPEG, PNG, or WebP and try again.`
      );
      return;
    }

    try {
      setGuestIdUploadStatus("Compressing guest ID image...");
      const image = await compressImageFile(processedFile, { maxWidth: 1400, maxHeight: 1400, quality: 0.84 });
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
    // Per Decision #121 (2026-07-23): capture purpose of stay (defaults
    // to Leisure) and the free-text "other" reason when applicable.
    // Trimmed + normalized so the readiness gate's lowercase comparison
    // on "other" works without surprises.
    const purposeOfStay = String(formData.get("purposeOfStay") || "leisure").trim().toLowerCase();
    const otherPurpose = String(formData.get("otherPurpose") || "").trim();
    // Per GCR-01 follow-up (2026-07-24): Firestore's `updateDoc` rejects
    // `undefined` as a field value, so the `otherPurpose` key must be
    // OMITTED from the object (not set to `undefined`) when the staff
    // didn't pick "Other". Spreading the conditional in keeps the
    // document clean (no null/undefined fields) and matches how
    // `corporate` is conditionally included in the public
    // bookings-create payload.
    persistSelectedBooking({
      guestRegistration: {
        nationality: String(formData.get("nationality") || "").trim(),
        address: String(formData.get("address") || "").trim(),
        dateOfBirth: String(formData.get("dateOfBirth") || ""),
        gender: String(formData.get("gender") || ""),
        purposeOfStay,
        ...(purposeOfStay === "other" && otherPurpose ? { otherPurpose } : {}),
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

  const createSelectedLedgerEntryId = (kind: "payment" | "refund") => {
    if (!selectedBooking) return "";
    if (selectedBooking.reservationId) {
      return doc(collection(
        db,
        "reservations",
        selectedBooking.reservationId,
        kind === "refund" ? "refunds" : "payments"
      )).id;
    }
    return doc(collection(db, "bookings", selectedBooking.id, "payments")).id;
  };

  const getSelectedChargeCollection = () => {
    if (!selectedBooking) return null;
    return selectedBooking.reservationId
      ? collection(db, "reservations", selectedBooking.reservationId, "charges")
      : collection(db, "bookings", selectedBooking.id, "charges");
  };

  const handleAddPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBooking && paymentAmount) {
      const amount = parseFloat(paymentAmount);
      const paymentId = paymentSubmissionIdRef.current
        || createSelectedLedgerEntryId("payment");
      paymentSubmissionIdRef.current = paymentId;
      setIsRecordingPayment(true);
      let paymentCompleted = false;
      try {
        const result = await addOnsitePayment(selectedBooking.id, paymentId, amount, paymentMethod, paymentNote, paymentTransactionReference || undefined);
        if (result.success) {
          paymentCompleted = true;
          setPaymentAmount("");
          setPaymentNote("");
          setPaymentTransactionReference("");
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
    // Per CRL-01: client-preallocated refundId for idempotency. Keep the
    // same ID across a retry-after-uncertain-response so the server
    // transaction replays the original commit; mint a fresh one on the
    // next intentional submit so a new refund does not collide with a
    // previous one. The mint uses the Firestore-generated payments doc
    // ID so the ID is server-acceptable under the existing rules shape
    // (no client-side rules allowlist for /payments/{id}).
    const refundId = refundSubmissionIdRef.current
      || createSelectedLedgerEntryId("refund");
    refundSubmissionIdRef.current = refundId;
    setIsRefunding(true);
    let refundCompleted = false;
    try {
      const token = await auth.currentUser?.getIdToken(true);
      const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/add-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" },
        body: JSON.stringify({ bookingId: selectedBooking.id, refundId, amount, method: refundMethod, reason: refundReason.trim() })
      });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        // 409 means the staff reused an ID for a different refund; clear
        // the held ref so the next submit mints a fresh one, and surface
        // the server's reason verbatim.
        if (response.status === 409) {
          refundSubmissionIdRef.current = null;
        }
        throw new Error(payload.error || "Unable to record refund.");
      }
      refundCompleted = true;
      setRefundAmount("");
      setRefundReason("");
      toast.success("Refund recorded", `${formatPrice(amount)} returned via ${getOnsitePaymentMethodLabel(refundMethod)}.`);
    } catch (error: any) {
      toast.error("Could not record refund", error.message || "Please try again.");
    } finally {
      // Keep the same ID after an uncertain/network failure. A manual
      // retry then replays the original server commit instead of creating
      // a second ledger entry. Successful submissions mint a fresh ID.
      if (refundCompleted) refundSubmissionIdRef.current = null;
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
      const chargesRef = getSelectedChargeCollection();
      if (!chargesRef) return;
      await addDoc(chargesRef, {
        label: chargeLabel.trim(),
        amount,
        category: chargeCategory,
        note: chargeNote.trim(),
        addedBy: currentUser?.uid || "staff",
        addedAt: serverTimestamp(),
        voidOf: null,
        ...(selectedBooking.reservationId ? { bookingId: selectedBooking.id } : {})
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
      const owner = chargeToVoid.ledgerOwner || (selectedBooking.reservationId ? "reservation" : "booking");
      const ownerId = chargeToVoid.ledgerOwnerId || selectedBooking.reservationId || selectedBooking.id;
      const reversalRef = doc(db, owner === "reservation" ? "reservations" : "bookings", ownerId, "charges", `void-${chargeToVoid.id}`);
      await setDoc(reversalRef, {
        label: `Reversal — ${chargeToVoid.label}`,
        amount: -Math.abs(chargeToVoid.amount),
        category: chargeToVoid.category,
        note: reason.trim(),
        addedBy: currentUser?.uid || "staff",
        addedAt: serverTimestamp(),
        voidOf: chargeToVoid.id,
        ...(owner === "reservation"
          ? { bookingId: chargeToVoid.bookingId || selectedBooking.id }
          : {})
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
    const trimmedFirst = walkinFirstName.trim();
    const trimmedLast = walkinLastName.trim();
    if (!trimmedFirst || !trimmedLast || !roomNumber) {
      toast.warning(
        "Missing details",
        "Please fill in the guest's first and last name and select an available room."
      );
      return;
    }
    // Per MRB-07 (2026-08-02, per decision #159): every room in the
    // reservation must name a vacant room before the reservation can be
    // created — the server writes all N rooms or none of them.
    if (walkinRoomStays.some((stay) => !stay.roomNumber)) {
      toast.warning(
        "Missing room",
        "Every room in this reservation needs an available room number."
      );
      return;
    }

    const submittedRoomStays = walkinRoomStays;
    setIsWalkinSubmitting(true);
    try {
      const result = await addWalkinBooking({
        roomId: rooms.find(r => r.roomNumber === roomNumber)?.id || "",
        roomNumber,
        roomType,
        // Per MRB-07 (2026-08-02, per decision #159): the reservation's
        // full room list. The server treats this as canonical, prices
        // each room against its own type, and writes one booking doc
        // per room under a single reservation header. The top-level
        // room / occupancy fields above still describe the primary
        // room, which the server cross-checks against `rooms[0]`.
        rooms: submittedRoomStays.map((stay) => ({
          roomId: rooms.find((r) => r.roomNumber === stay.roomNumber)?.id || "",
          numAdults: stay.numAdults,
          numChildren: stay.numChildren,
          extraBedCount: stay.extraBedCount
        })),
        firstName: trimmedFirst,
        lastName: trimmedLast,
        reminderSentAt: null,
        guestEmail: guestEmail || `walkin-${Date.now()}@example.invalid`,
        guestPhone: guestPhone || "n/a",
        numGuests,
        // Per EXB-07 (2026-08-01, per decision #155): the
        // walk-in modal now carries the adult/child split
        // + the extra bed count. The server (per CHD-04 +
        // EXB-03) validates `numAdults + numChildren === numGuests`
        // and applies the EXB-03 overflow rule
        // (`requiredExtraBedsFor` helper). The extra-bed count
        // is the desk's choice; absent fields on legacy data
        // hydrate to all-adults (per CHD-04's fallback rule).
        numAdults: walkinNumAdults,
        numChildren: walkinNumChildren,
        extraBedCount: walkinExtraBedCount,
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
        // Per NBS-02 / NBS-07 (2026-07-31): the source is now selected
        // by the desk from the configured list (default "walk-in" for
        // the common case). The note becomes source-derived server-
        // side so a phone / Agoda / Facebook booking no longer ships
        // with a note claiming it was created at the desk.
        source: walkinSource,
        notes: "",
        memberId: null,
        pointsRedeemed: 0,
        pointsRedeemedValue: 0,
        pointsRedeemedBy: null,
        pointsRedeemedAt: null,
        hasBreakfast,
        breakfastRate: hasBreakfast ? (breakfastConfig.ratePerPersonPerNight || DEFAULT_BREAKFAST_RATE_PER_PERSON_PER_NIGHT) : 0,
        guestIdPhotoUrl: null,
        handledBy: currentUser?.uid || "staff",
        cancellationReason: "",
        testRunId: walkinTestRunId || null
      });

      if (result.success) {
        setWalkinFirstName("");
        setWalkinLastName("");
        setGuestEmail("");
        setGuestPhone("");
        setPriceOverride("");
        setHasBreakfast(false);
        setWalkinDiscountType("");
        setWalkinVoucherCode("");
        setWalkinTestRunId("");
        // Per EXB-07 + MRB-07: reset back to a single empty room stay
        // at the 1-adult / 0-children / 0-extra-bed default, so the
        // next booking starts from the common single-room state
        // rather than inheriting the previous group's room list.
        setWalkinRoomStays([createWalkinRoomStay(roomTypes[0]?.value || "")]);
        setIsModalOpen(false);
        toast.success(
          submittedRoomStays.length > 1 ? "Reservation created" : "Walk-in booking created",
          submittedRoomStays.length > 1
            ? `${submittedRoomStays.length} rooms (${submittedRoomStays.map((stay) => stay.roomNumber).join(", ")}) for ${trimmedFirst} ${trimmedLast}`
            : `Room ${roomNumber} for ${trimmedFirst} ${trimmedLast}`
        );
      } else {
        toast.error("Failed to create walk-in booking", result.error);
      }
    } catch (err: any) {
      toast.error("Failed to create walk-in booking", err.message);
    } finally {
      setIsWalkinSubmitting(false);
    }
  };

  const selectedBookingFolio = selectedBooking ? getBookingFolio(selectedBooking) : null;

  const openRecordPaymentForBalance = (balance: number) => {
    setShowRecordPaymentModal(true);
    setPaymentAmount(String(Math.max(0, balance)));
    setPaymentMethod("cash");
    setPaymentTransactionReference("");
    setPaymentNote("");
    setPaymentError(null);
  };

  const renderBookingPrimaryAction = () => {
    if (!selectedBooking) return null;

    if (selectedBooking.status === "pending") {
      return (
        <button
          type="button"
          onClick={() => handleStatusTransition("confirmed")}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-green-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-green-700 active:scale-95"
        >
          Confirm pay-at-hotel booking
          {renderActionScope("room")}
        </button>
      );
    }

    if (selectedBooking.status === "payment-uploaded") {
      return (
        <button
          type="button"
          onClick={() => setActiveBookingSection("folio")}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-green-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-green-700 active:scale-95"
        >
          Review proof in Folio
          {renderActionScope("reservation")}
        </button>
      );
    }

    if (selectedBooking.status === "payment-confirmed") {
      return (
        <button
          type="button"
          onClick={() => handleStatusTransition("confirmed")}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
        >
          Confirm booking
          {renderActionScope("room")}
        </button>
      );
    }

    if (
      activeBookingSection === "folio" &&
      ["confirmed", "checked-in", "checked-out"].includes(selectedBooking.status) &&
      selectedBookingFolio &&
      selectedBookingFolio.balance > 0
    ) {
      return (
        <button
          type="button"
          onClick={() => openRecordPaymentForBalance(selectedBookingFolio.balance)}
          className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
        >
          <CreditCard size={15} aria-hidden="true" />
          Collect {formatPrice(selectedBookingFolio.balance)}
          {renderActionScope("reservation")}
        </button>
      );
    }

    if (selectedBooking.status === "confirmed") {
      return (
        <button
          type="button"
          onClick={() => handleStatusTransition("checked-in")}
          disabled={!selectedBookingCheckInReadiness?.ready}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:bg-gray-300 disabled:text-gray-500 disabled:shadow-none disabled:active:scale-100"
        >
          {selectedBookingCheckInReadiness?.ready ? "Verify guest ID & check in" : "Complete check-in requirements"}
          {renderActionScope("room")}
        </button>
      );
    }

    if (selectedBooking.status === "checked-in") {
      return (
        <button
          type="button"
          onClick={() => {
            const folio = getBookingFolio(selectedBooking);
            if (folio.balance > 0) {
              setUnpaidCheckoutReason("");
              setUnpaidCheckoutError(null);
              setUnpaidCheckoutBlocked(false);
              setUnpaidCheckoutBlockMessage("");
              setShowUnpaidCheckoutForm(true);
            } else {
              handleStatusTransition("checked-out");
            }
          }}
          className={`inline-flex min-h-[44px] w-full items-center justify-center rounded-lg px-4 text-xs font-bold text-white shadow-sm transition active:scale-95 ${
            selectedBookingFolio && selectedBookingFolio.balance > 0
              ? "bg-orange-600 hover:bg-orange-700"
              : "bg-gray-900 hover:bg-black"
          }`}
        >
          {selectedBookingFolio && selectedBookingFolio.balance > 0
            ? `Check out — ${formatPrice(selectedBookingFolio.balance)} due`
            : "Review folio & check out"}
        </button>
      );
    }

    return (
      <button
        type="button"
        onClick={printBookingReceiptPDF}
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
      >
        <FileText size={15} aria-hidden="true" />
        View / print receipt
      </button>
    );
  };

  const activeQuickView = activeMainTab === "bookings" ? bookingQuickView : storeQuickView;
  const totalCount = activeMainTab === "bookings" ? bookings.length : storeOrders.length;
  const resultCount = activeMainTab === "bookings" ? filteredRows.length : filteredOrders.length;

  // Shared quick-view definitions for rendering chips
  const bookingQuickViews: { id: BookingQuickView; label: string; desc: string }[] = [
    { id: "all", label: "All bookings", desc: "All reservations" },
    { id: "needs-attention", label: "Needs attention", desc: "Actionable records" },
    { id: "arrivals-today", label: "Arrivals today", desc: "Checking in today" },
    { id: "departures-today", label: "Departures today", desc: "Checking out today" },
    { id: "in-house", label: "In house", desc: "Currently checked in" },
    { id: "upcoming", label: "Upcoming", desc: "Future arrivals" },
    { id: "balance-due", label: "Balance due", desc: "Outstanding folio" },
    { id: "cancelled", label: "Cancelled", desc: "Cancelled reservations" }
  ];

  const storeQuickViews: { id: StoreQuickView; label: string; desc: string }[] = [
    { id: "all", label: "All orders", desc: "All store orders" },
    { id: "needs-action", label: "Needs action", desc: "Requires attention" },
    { id: "placed", label: "Placed", desc: "Awaiting confirmation" },
    { id: "preparing", label: "Preparing", desc: "Confirmed, in progress" },
    { id: "out-for-delivery", label: "Out for delivery", desc: "On the way" },
    { id: "delivered-today", label: "Delivered today", desc: "Completed today" },
    { id: "add-to-bill", label: "Add to room bill", desc: "Not yet billed" },
    { id: "payment-pending", label: "Payment pending", desc: "Proof uploaded" },
    { id: "cancelled", label: "Cancelled", desc: "Cancelled orders" }
  ];

  const quickViewCount = (qvId: string, tab: "bookings" | "store"): number => {
    if (tab === "bookings") {
      return qvId === "all" ? bookings.length : bookings.filter((b) => bookingQuickViewPredicate(b, qvId as BookingQuickView)).length;
    }
    return qvId === "all" ? storeOrders.length : storeOrders.filter((o) => storeQuickViewPredicate(o, qvId as StoreQuickView)).length;
  };

  // FSO-02: Build active chips from current filter state
  interface Chip { id: string; label: string; onRemove: () => void; }
  const activeChips: Chip[] = [];
  if (activeMainTab === "bookings") {
    if (bookingQuickView !== "all") {
      const def = bookingQuickViews.find((q) => q.id === bookingQuickView);
      activeChips.push({ id: `qv-${bookingQuickView}`, label: def?.label || bookingQuickView, onRemove: () => setBookingQuickView("all") });
    }
    if (bookingSearch) {
      activeChips.push({ id: "search", label: `Search: "${bookingSearch}"`, onRemove: () => setBookingSearch("") });
    }
    if (bookingStatusFilter !== "all") {
      activeChips.push({ id: "status", label: `Status: ${bookingStatusFilter}`, onRemove: () => setBookingStatusFilter("all") });
    }
    if (bPayState) activeChips.push({ id: "bPayState", label: `Payment: ${bPayState}`, onRemove: () => setBPayState("") });
    if (bPaymentMethod) activeChips.push({ id: "bPaymentMethod", label: `Method: ${bPaymentMethod}`, onRemove: () => setBPaymentMethod("") });
    if (bRoom) activeChips.push({ id: "bRoom", label: `Room: ${bRoom}`, onRemove: () => setBRoom("") });
    if (bRoomType) activeChips.push({ id: "bRoomType", label: `Type: ${bRoomType}`, onRemove: () => setBRoomType("") });
    if (bSource) {
      // Render the configured label, not the raw key, per NBS-09.
      const sourceLabel = (bookingSources || []).find((s) => s.source === bSource)?.label || bSource;
      activeChips.push({ id: "bSource", label: `Source: ${sourceLabel}`, onRemove: () => setBSource("") });
    }
    if (bCorp) activeChips.push({ id: "bCorp", label: bCorp === "yes" ? "Corporate" : "Non-corporate", onRemove: () => setBCorp("") });
    if (bDiscount) activeChips.push({ id: "bDiscount", label: bDiscount === "yes" ? "With discount" : "No discount", onRemove: () => setBDiscount("") });
    if (bDateFrom || bDateTo) activeChips.push({ id: "bDate", label: `Dates: ${bDateFrom || "any"} – ${bDateTo || "any"}`, onRemove: () => { setBDateFrom(""); setBDateTo(""); } });
  } else {
    if (storeQuickView !== "all") {
      const def = storeQuickViews.find((q) => q.id === storeQuickView);
      activeChips.push({ id: `qv-${storeQuickView}`, label: def?.label || storeQuickView, onRemove: () => setStoreQuickView("all") });
    }
    if (storeSearch) {
      activeChips.push({ id: "search", label: `Search: "${storeSearch}"`, onRemove: () => setStoreSearch("") });
    }
    if (storeStatusFilter !== "all") {
      activeChips.push({ id: "status", label: `Status: ${storeStatusFilter}`, onRemove: () => setStoreStatusFilter("all") });
    }
    if (sRoom) activeChips.push({ id: "sRoom", label: `Room: ${sRoom}`, onRemove: () => setSRoom("") });
    if (sPaymentMethod) activeChips.push({ id: "sPaymentMethod", label: `Method: ${sPaymentMethod}`, onRemove: () => setSPaymentMethod("") });
    if (sBilling) activeChips.push({ id: "sBilling", label: sBilling === "direct" ? "Direct pay" : "Add to bill", onRemove: () => setSBilling("") });
    if (sBilled) activeChips.push({ id: "sBilled", label: sBilled === "billed" ? "Billed" : "Unbilled", onRemove: () => setSBilled("") });
    if (sPayProof) activeChips.push({ id: "sPayProof", label: `Proof: ${sPayProof}`, onRemove: () => setSPayProof("") });
    if (sDateFrom || sDateTo) activeChips.push({ id: "sDate", label: `Dates: ${sDateFrom || "any"} – ${sDateTo || "any"}`, onRemove: () => { setSDateFrom(""); setSDateTo(""); } });
  }

  const advancedCount = activeMainTab === "bookings"
    ? [bPayState, bPaymentMethod, bRoom, bRoomType, bSource, bCorp, bDiscount, bDateFrom || bDateTo ? "dates" : ""].filter(Boolean).length
    : [sRoom, sPaymentMethod, sBilling, sBilled, sPayProof, sDateFrom || sDateTo ? "dates" : ""].filter(Boolean).length;

  const currentQVs = activeMainTab === "bookings" ? bookingQuickViews : storeQuickViews;
  const setQV = activeMainTab === "bookings" ? setBookingQuickView : setStoreQuickView;

  return (
    <>
      <div className="space-y-8 font-body">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase font-medium">bookings & store orders</h1>
          <p className="text-xs text-gray-500 mt-1">Review active room check-ins, record onsite charges, and process walk-ins and minibar deliveries.</p>
        </div>
        {testRuns.filter(r => r.status === "active").length > 0 && (
          <div className="col-span-full rounded-lg bg-amber-50 border border-amber-300 px-4 py-3 text-xs text-amber-900 flex items-center gap-2.5">
            <FlaskConical size={14} className="shrink-0" />
            <span>
              <strong>Active test run.</strong> Test data is tagged with TEST badges.
            </span>
          </div>
        )}
        {activeMainTab === "bookings" && (
          <button
            onClick={() => {
              setPriceOverride("");
              // Per MRB-07 (2026-08-02, per decision #159): open on a
              // single room stay, preselected to the first vacant room
              // of the default type — the common single-room case is
              // still one click away.
              const defaultType = roomTypes[0]?.value || "";
              const firstFree = rooms.find(
                (r) => r.type === defaultType && r.status === "available"
              );
              setWalkinRoomStays([
                { ...createWalkinRoomStay(defaultType), roomNumber: firstFree?.roomNumber || "" }
              ]);
              setIsModalOpen(true);
            }}
            className="min-h-[44px] px-5 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary hover:bg-primary-dark active:scale-[0.98] text-sm font-semibold text-white shadow-sm transition"
          >
            <Plus size={16} />
            New Booking
          </button>
        )}
      </header>

      {/* FSO-01: Main navigation tabs */}
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

      {/* FSO-01/06/10: Quick-view chips (horizontally scrollable on mobile, compact on desktop) */}
      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex items-center gap-1.5 pb-1 sm:flex-wrap sm:pb-0" role="tablist" aria-label="Quick views">
          {currentQVs.map((qv) => {
            const active = activeQuickView === qv.id;
            const count = quickViewCount(qv.id, activeMainTab);
            return (
              <button
                key={qv.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => (setQV as (v: any) => void)(qv.id)}
                className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition sm:shrink ${
                  active
                    ? "bg-primary text-white shadow-sm"
                    : "bg-gray-100 text-gray-650 hover:bg-gray-200 hover:text-gray-900"
                }`}
              >
                <span className="truncate">{qv.label}</span>
                <span className={`inline-flex min-w-[18px] items-center justify-center rounded-full px-1 py-0 text-[10px] font-bold leading-tight ${
                  active ? "bg-white/20 text-white" : "bg-gray-200 text-gray-600"
                }`}>{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* FSO-01/02/08/15: Toolbar — search, filters button, result count, clear all */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder={activeMainTab === "bookings" ? "Search by guest, ref, room, email, payment ref..." : "Search by guest, ref, room, item, booking ref..."}
            value={activeMainTab === "bookings" ? bookingSearch : storeSearch}
            onChange={(e) => { const v = e.target.value; if (activeMainTab === "bookings") setBookingSearch(v); else setStoreSearch(v); }}
            className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:bg-white"
          />
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-gray-500 sm:inline">
            {resultCount === totalCount
              ? `${totalCount} records`
              : `${resultCount} of ${totalCount}`}
          </span>
          {advancedCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary-dark">
              {advancedCount} active filters
            </span>
          )}
          <button
            type="button"
            onClick={() => { if (activeMainTab === "bookings") setShowBookingFilters(true); else setShowStoreFilters(true); }}
            className="min-h-[36px] rounded-lg border border-gray-250 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            {activeMainTab === "bookings" ? "Filters" : "Filters"}
            {advancedCount > 0 && ` (${advancedCount})`}
          </button>
          <button
            type="button"
            onClick={() => {
              if (activeMainTab === "bookings") {
                setBookingQuickView("all"); setBookingSearch(""); setBookingStatusFilter("all");
                setBPayState(""); setBPaymentMethod(""); setBRoom(""); setBRoomType(""); setBSource(""); setBCorp(""); setBDiscount(""); setBDateFrom(""); setBDateTo("");
              } else {
                setStoreQuickView("all"); setStoreSearch(""); setStoreStatusFilter("all");
                setSRoom(""); setSPaymentMethod(""); setSBilling(""); setSBilled(""); setSPayProof(""); setSDateFrom(""); setSDateTo("");
              }
            }}
            disabled={activeChips.length === 0}
            className="min-h-[36px] rounded-lg border border-gray-250 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* FSO-02: Active chips row */}
      {activeChips.length > 0 && (
        <div className="-mt-1 flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={chip.onRemove}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-primary/10 px-3 text-[10px] font-bold uppercase tracking-wider text-primary-dark hover:bg-primary/20"
            >
              {chip.label} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      )}

      {/* FSO-08/15: Booking advanced filters panel */}
      {showBookingFilters && (
        <div className="relative">
          <div className="absolute left-0 right-0 z-20 rounded-xl border border-gray-200 bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Advanced filters — bookings</h3>
              <button type="button" onClick={() => setShowBookingFilters(false)} className="min-h-[36px] rounded-lg border border-gray-250 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50">Close</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Date basis
                <select value={bDateBasis} onChange={(e) => setBDateBasis(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="stay">Stay overlap</option>
                  <option value="arrival">Arrival date</option>
                  <option value="departure">Departure date</option>
                  <option value="created">Booking created</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                From
                <input type="date" value={bDateFrom} onChange={(e) => setBDateFrom(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs" />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                To
                <input type="date" value={bDateTo} onChange={(e) => setBDateTo(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs" />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Payment state
                <select value={bPayState} onChange={(e) => setBPayState(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  <option value="unpaid">Unpaid</option>
                  <option value="partial">Partially paid</option>
                  <option value="paid">Fully paid</option>
                  <option value="overpaid">Overpaid</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Payment method
                <select value={bPaymentMethod} onChange={(e) => setBPaymentMethod(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  {onsitePaymentMethodOptions.map((m: any) => <option key={m.method} value={m.method}>{m.label || m.method}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Room
                <select value={bRoom} onChange={(e) => setBRoom(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  {rooms.map((r: any) => <option key={r.id} value={r.roomNumber}>{r.roomNumber}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Room type
                <select value={bRoomType} onChange={(e) => setBRoomType(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  {roomTypes.map((rt: any) => <option key={rt.id} value={rt.id}>{rt.name || rt.id}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Source / channel
                <select value={bSource} onChange={(e) => setBSource(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  {(bookingSources || []).map((s) => (
                    <option key={s.source} value={s.source}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Corporate
                <select value={bCorp} onChange={(e) => setBCorp(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  <option value="yes">Corporate</option>
                  <option value="no">Non-corporate</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Discount / Voucher
                <select value={bDiscount} onChange={(e) => setBDiscount(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  <option value="yes">Has discount or voucher</option>
                  <option value="no">No discount or voucher</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
              <button type="button" onClick={() => { setBPayState(""); setBPaymentMethod(""); setBRoom(""); setBRoomType(""); setBSource(""); setBCorp(""); setBDiscount(""); setBDateFrom(""); setBDateTo(""); }} className="min-h-[36px] rounded-lg border border-gray-250 bg-white px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50">Clear all</button>
              <button type="button" onClick={() => setShowBookingFilters(false)} className="min-h-[36px] rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark">Apply filters</button>
            </div>
          </div>
        </div>
      )}

      {/* FSO-12/15: Store advanced filters panel */}
      {showStoreFilters && (
        <div className="relative">
          <div className="absolute left-0 right-0 z-20 rounded-xl border border-gray-200 bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500">Advanced filters — store orders</h3>
              <button type="button" onClick={() => setShowStoreFilters(false)} className="min-h-[36px] rounded-lg border border-gray-250 px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50">Close</button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                From
                <input type="date" value={sDateFrom} onChange={(e) => setSDateFrom(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs" />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                To
                <input type="date" value={sDateTo} onChange={(e) => setSDateTo(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs" />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Room
                <select value={sRoom} onChange={(e) => setSRoom(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  {rooms.map((r: any) => <option key={r.id} value={r.roomNumber}>{r.roomNumber}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Payment method
                <select value={sPaymentMethod} onChange={(e) => setSPaymentMethod(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  {onsitePaymentMethodOptions.map((m: any) => <option key={m.method} value={m.method}>{m.label || m.method}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Billing type
                <select value={sBilling} onChange={(e) => setSBilling(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  <option value="direct">Direct pay</option>
                  <option value="add-to-bill">Add to room bill</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Billed state
                <select value={sBilled} onChange={(e) => setSBilled(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  <option value="billed">Billed to room</option>
                  <option value="unbilled">Not yet billed</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-semibold text-gray-600">
                Payment proof
                <select value={sPayProof} onChange={(e) => setSPayProof(e.target.value)} className="min-h-[36px] rounded-lg border border-gray-200 px-2 text-xs">
                  <option value="">Any</option>
                  <option value="uploaded">Uploaded</option>
                  <option value="verified">Verified</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
              <button type="button" onClick={() => { setSDateFrom(""); setSDateTo(""); setSRoom(""); setSPaymentMethod(""); setSBilling(""); setSBilled(""); setSPayProof(""); }} className="min-h-[36px] rounded-lg border border-gray-250 bg-white px-3 text-xs font-semibold text-gray-600 hover:bg-gray-50">Clear all</button>
              <button type="button" onClick={() => setShowStoreFilters(false)} className="min-h-[36px] rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark">Apply filters</button>
            </div>
          </div>
        </div>
      )}

      {activeMainTab === "bookings" ? (
        <>
          <DataTable
            columns={columns}
            rows={groupedRows}
            onRowClick={handleRowClick}
            renderMobileCard={renderBookingCard}
            // Per MRB-07 (2026-08-02, per decision #159): nest the
            // room stays under their reservation row.
            rowVariant={(row) =>
              row.listRowKind === "reservation"
                ? "parent"
                : row.listRowKind === "roomStay"
                  ? "child"
                  : undefined
            }
            emptyMessage="No bookings match the current filters."
          />
        </>
      ) : (
        <>
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
        title={selectedBooking ? `Booking ${selectedBooking.bookingRef}` : ""}
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        className="max-w-[1120px]"
        footer={selectedBooking ? (
          <BookingDrawerActionFooter
            primaryAction={renderBookingPrimaryAction()}
            onMoreActions={() => setActiveBookingSection("more")}
            moreActionsActive={activeBookingSection === "more"}
          />
        ) : undefined}
      >
        {selectedBooking && (
          <div className={activeBookingSection === "folio"
            ? "flow-root space-y-6 text-sm"
            : "space-y-6 text-sm"
          }>
            {/* Per MRB-07 (2026-08-02, per decision #159): the
                reservation strip. A room inside a multi-room
                reservation always shows which reservation it belongs
                to, its position in the group, and one-tap navigation to
                the sibling rooms — the desk works a group room by room,
                and re-finding the next room through the list each time
                is the friction that makes staff avoid group bookings.
                Absent entirely for single-room and legacy bookings. */}
            {selectedReservationContext && (
              <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-gray-700">
                    Reservation {selectedReservationContext.reservationRef || "—"}
                    <span className="ml-2 font-semibold text-gray-500">
                      Room {selectedReservationContext.position} of {selectedReservationContext.roomCount}
                    </span>
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    Actions below apply to this room unless marked
                  </span>
                </div>
                {/* Per MRB-12 (2026-08-03, per decision #179 — proposed):
                    the reservation-scope money pills. The Total /
                    Paid / Balance come from the `Reservation` header
                    + the reservation-scope paid-amount aggregate
                    (MRB-12-01) — independent of which room the
                    desk is currently looking at. The per-room
                    `BookingDrawerWorkspaceHeader` below (line 4426+)
                    keeps its own per-room money; the strip's pills
                    are the GROUP-level read, not a replacement. The
                    pills appear as soon as the header + the paid
                    aggregate are in memory; otherwise the row falls
                    back to the per-child sum so the first paint is
                    never empty. Hidden when the reservation context
                    is null (N=1 / legacy) — the strip already gates
                    on that. */}
                {(() => {
                  const reservationId = selectedReservationContext.reservationId;
                  const reservationHeader = reservationsMap.get(reservationId);
                  const paidAmount = reservationPaidAmount[reservationId] || 0;
                  const reservationTotal = reservationHeader
                    ? reservationHeader.totalPrice
                    : selectedReservationContext.rooms.reduce(
                        (sum, child) => sum + (child.totalPrice || 0),
                        0
                      );
                  // Per-room paid = totalPrice - balance (capped at 0;
                  // a negative balance means overpayment, which the
                  // strip renders as the overpayment). The fallback
                  // keeps the first paint byte-equivalent to the
                  // pre-MRB-12 surface; the listener's next tick
                  // replaces it with the header-sourced values.
                  const reservationPaid = reservationHeader
                    ? paidAmount
                    : selectedReservationContext.rooms.reduce(
                        (sum, child) => {
                          const folio = getBookingFolio(child);
                          return sum + Math.max(0, (folio.grandTotal || 0) - folio.balance);
                        },
                        0
                      );
                  const reservationBalance = Math.max(0, reservationTotal - reservationPaid);
                  return (
                    <div
                      data-testid="reservation-strip-money"
                      className="mt-2 grid grid-cols-3 gap-1.5"
                      aria-label="Reservation money"
                    >
                      <div className="rounded-md bg-white px-2 py-1 ring-1 ring-inset ring-gray-200">
                        <p className="text-[8px] font-bold uppercase tracking-wider text-gray-400">Total</p>
                        <p className="mt-0.5 text-xs font-bold text-gray-900">{formatPrice(reservationTotal)}</p>
                      </div>
                      <div className="rounded-md bg-white px-2 py-1 ring-1 ring-inset ring-gray-200">
                        <p className="text-[8px] font-bold uppercase tracking-wider text-gray-400">Paid</p>
                        <p className="mt-0.5 text-xs font-bold text-gray-900">{formatPrice(reservationPaid)}</p>
                      </div>
                      <div className="rounded-md bg-white px-2 py-1 ring-1 ring-inset ring-gray-200">
                        <p className="text-[8px] font-bold uppercase tracking-wider text-gray-400">Balance</p>
                        <p className={cn(
                          "mt-0.5 text-xs font-bold",
                          reservationBalance > 0 ? "text-amber-700" : "text-status-green-text"
                        )}>
                          {formatPrice(reservationBalance)}
                        </p>
                      </div>
                    </div>
                  );
                })()}
                {/* Per MRB-14 (2026-08-03, per decision #180): the
                    "Actual range" pill row. Surfaces when the
                    reservation's children have diverged from the
                    header's original shared dates (a room has been
                    rescheduled to a different check-in / check-out).
                    The pill shows MIN(children.checkIn) →
                    MAX(children.checkOut) and a "varies by room"
                    badge. The per-room dates are still listed on the
                    existing per-booking header below this strip.
                    Hidden for N=1 / legacy reservations (no
                    `actualDateRange` to read; no children to diverge). */}
                {(() => {
                  const reservationId = selectedReservationContext.reservationId;
                  const reservationHeader = reservationsMap.get(reservationId);
                  const actualRange = reservationHeader?.actualDateRange;
                  if (!actualRange || !actualRange.isDivergent) return null;
                  const earliestStr = formatShortDate(actualRange.earliestCheckIn);
                  const latestStr = formatShortDate(actualRange.latestCheckOut);
                  return (
                    <div
                      data-testid="reservation-strip-actual-range"
                      className="mt-1.5 flex items-center gap-1.5 rounded-md bg-white px-2 py-1 ring-1 ring-inset ring-amber-200"
                      aria-label="Reservation actual range"
                      title={
                        selectedReservationContext.rooms
                          .map((sibling) => `Room ${sibling.roomNumber}: ${formatShortDate(sibling.checkIn)} – ${formatShortDate(sibling.checkOut)}`)
                          .join("\n") || "Per-room dates available"
                      }
                    >
                      <p className="text-[8px] font-bold uppercase tracking-wider text-gray-400">Actual range</p>
                      <p className="text-xs font-bold text-gray-900">{earliestStr} → {latestStr}</p>
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-800 ring-1 ring-inset ring-amber-200">
                        varies by room
                      </span>
                    </div>
                  );
                })()}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {selectedReservationContext.rooms.map((sibling) => (
                    <button
                      key={sibling.id}
                      type="button"
                      onClick={() => setSelectedBooking(sibling)}
                      aria-current={sibling.id === selectedBooking.id ? "true" : undefined}
                      className={cn(
                        "min-h-[32px] rounded-lg px-2.5 text-[11px] font-semibold transition",
                        sibling.id === selectedBooking.id
                          ? "bg-primary text-white"
                          : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                      )}
                    >
                      Room {sibling.roomNumber}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Per CRL-07 (2026-08-03, per decision #173):
                the cancellation-liability panel. Mounted
                inside the drawer when the selected
                booking is cancelled (`status ===
                "cancelled"`) AND has a liability
                snapshot. For reservation-scope cancels
                the snapshot lives on the reservation
                header (the source of truth for the
                aggregate); for per-child + legacy
                cancels the snapshot lives on the
                booking doc. The reservation header
                carries the snapshot only when the
                cancel was reservation-scope; the
                cancelled child booking's
                `cancellationLiability` is populated
                when the cancel was per-child.

                The panel reads from the booking doc by
                default; when the selected booking is
                part of a multi-room reservation AND
                the reservation header carries a
                liability (the reservation-scope case),
                the panel reads from the header. For
                N=1 (today's entire active surface) the
                booking path is sufficient — the
                cancel is per-child, the snapshot is
                on the booking doc. The reservation-
                header read is the CRL-08/15 follow-up
                surface for N>1 reservation-scope
                cancels; for now the panel falls
                through to the booking's snapshot
                when the header has none. */}
            {selectedBooking.status === "cancelled" && (
              <CancellationLiabilityPanel
                liability={selectedBooking.cancellationLiability || null}
                bookingId={selectedBooking.id}
                reservationId={selectedBooking.reservationId || null}
                isAdmin={currentUser?.role === "admin"}
                onOpenRefundModal={openLiabilityRefundModal}
                onOpenExceptionModal={() => setShowExceptionModal(true)}
                refreshKey={liabilitySnapshotKey}
              />
            )}

            <div>
            <BookingDrawerWorkspaceHeader
              booking={selectedBooking}
              activeSection={activeBookingSection}
              onSectionChange={setActiveBookingSection}
              totalPaid={selectedBookingFolio?.paymentsTotal ?? 0}
              balance={selectedBookingFolio?.balance ?? selectedBooking.totalPrice}
              missingCheckInItems={selectedBookingCheckInReadiness?.missingItems ?? []}
              paymentMethodLabel={selectedBooking.paymentMethod ? getOnsitePaymentMethodLabel(selectedBooking.paymentMethod) : ""}
            />
            </div>

            <BookingDrawerSectionPanel section="overview" activeSection={activeBookingSection}>
            {selectedBooking.paymentProofUrl ? (
              <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5">
                <div className="flex items-center gap-2 text-xs">
                  <CreditCard size={14} className="text-gray-400" />
                  <span className="text-gray-700">{selectedBooking.paymentMethod ? getOnsitePaymentMethodLabel(selectedBooking.paymentMethod) : "Online payment"}</span>
                  {selectedBooking.status === "payment-uploaded" && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-bold text-amber-800">Pending</span>
                  )}
                  {selectedBooking.status === "payment-confirmed" && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-800">Verified</span>
                  )}
                  {selectedBooking.paymentRejectionReason && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold text-red-700">Rejected</span>
                  )}
                </div>
                {selectedBooking.paymentProofUrl && (
                  <button type="button" onClick={() => setImagePreview({ title: `Payment proof for ${selectedBooking.bookingRef}`, url: selectedBooking.paymentProofUrl ?? "" })} className="min-h-[32px] rounded-lg border border-gray-250 bg-white px-2.5 text-[10px] font-semibold text-gray-600 hover:bg-gray-100">
                    View proof
                  </button>
                )}
              </div>
            ) : selectedBooking.paymentMethod !== "pay-at-hotel" && selectedBooking.paymentMethod ? (
              <div className="flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
                <CreditCard size={14} className="text-gray-400" />
                {getOnsitePaymentMethodLabel(selectedBooking.paymentMethod!)} — no proof uploaded
              </div>
            ) : null}
            </BookingDrawerSectionPanel>

            {/* Check-in registration workstation */}
            <BookingDrawerSectionPanel section="check-in" activeSection={activeBookingSection} primary>
            {selectedBookingCheckInReadiness && (
              <BookingCheckInReadiness
                ready={selectedBookingCheckInReadiness.ready}
                missingItems={selectedBookingCheckInReadiness.missingItems}
              />
            )}
            <BookingRegistrationForm
              registration={selectedBooking.guestRegistration}
              status={selectedBooking.status}
              showEdit={showEditRegistration}
              onSetShowEdit={setShowEditRegistration}
              onSubmit={handleRegistrationSubmit}
              onPrintPdf={printRegistrationPDF}
            />

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
                        JPG, PNG, or WebP. HEIC from iPhone cameras is auto-converted to JPEG before upload.
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
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
            </BookingDrawerSectionPanel>

            {/* Room stay details */}
            <BookingDrawerSectionPanel section="overview" activeSection={activeBookingSection} primary>
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
                  {/* Per EXB-08 (2026-08-01, per decision #156):
                      the drawer "Guests:" line now shows
                      the adult/child split when both
                      fields are present, with the extra
                      bed count appended when > 0. Legacy
                      pre-CHD bookings read as a single
                      `numGuests` total. Matches the
                      receipt PDF + the email helper +
                      the table row so the staff
                      surfaces stay in lockstep. */}
                  <p>Guests: {(() => {
                    const numAdults = Number((selectedBooking as any).numAdults);
                    const numChildren = Number((selectedBooking as any).numChildren);
                    const extraBedCount = Number((selectedBooking as any).extraBedCount);
                    if (Number.isFinite(numAdults) && Number.isFinite(numChildren) && (numAdults > 0 || numChildren > 0)) {
                      const splitLabel = `${numAdults} adult${numAdults === 1 ? "" : "s"} + ${numChildren} child${numChildren === 1 ? "" : "ren"} (${selectedBooking.numGuests} total)`;
                      const extraLabel = Number.isFinite(extraBedCount) && extraBedCount > 0
                        ? ` + ${extraBedCount} extra bed${extraBedCount === 1 ? "" : "s"}`
                        : "";
                      return <span>{splitLabel}{extraLabel}</span>;
                    }
                    return <span>{selectedBooking.numGuests}</span>;
                  })()}</p>
                  <p>Breakfast: {selectedBooking.hasBreakfast ? "Included" : "Excluded"}</p>
                </div>
                {/* Move Booking trigger */}
                {RESCHEDULABLE_STATUSES.includes(selectedBooking.status) && (
                  <div className="border-t border-gray-100 pt-3">
                    <button
                      type="button"
                      onClick={() => {
                        setShowMoveForm(!showMoveForm);
                        setActiveBookingSection("more");
                      }}
                      className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-lg border border-gray-250 bg-white px-3 text-xs font-bold text-gray-700 transition hover:bg-gray-50 active:scale-95"
                    >
                      <Move size={14} className="text-primary" />
                      {showMoveForm ? "Cancel Move" : "Move / Upgrade Room"}
                    </button>
                  </div>
                )}
              </div>
            </div>
            </BookingDrawerSectionPanel>

            {/* Move booking form */}
            <BookingDrawerSectionPanel section="more" activeSection={activeBookingSection}>
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
            </BookingDrawerSectionPanel>

            {/* Financial totals */}
            <BookingDrawerSectionPanel
              section="folio"
              activeSection={activeBookingSection}
              primary
              className="lg:sticky lg:top-20 lg:float-right lg:w-[calc(33.333%-1rem)]"
            >
            <div className="space-y-4 rounded-card border border-gray-200 bg-white p-4 shadow-sm">
              {/* Per CWB-04 / decision #122 (2026-07-23): a
                  visible Balance-owed panel for any booking
                  that was confirmed with money still owed.
                  Renders while `confirmedWithBalance != null`
                  AND a current balance remains. Auto-hides at
                  ₱0. The "Settle on check-in" copy tells the
                  staff (and the live drawer itself) that the
                  guest will pay the rest at the front desk —
                  not via the Record Payment flow. */}
              {selectedBooking.confirmedWithBalance != null &&
                (selectedBookingFolio?.balance ?? 0) > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-bold uppercase tracking-wider">Balance owed</p>
                    <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[9px] font-bold text-amber-900">
                      Settle on check-in
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-amber-700">Original</p>
                      <p className="font-heading text-sm font-bold text-amber-950">{formatPrice(selectedBooking.confirmedWithBalance)}</p>
                    </div>
                    <div>
                      <p className="text-[9px] font-semibold uppercase tracking-widest text-amber-700">Now</p>
                      <p className="font-heading text-sm font-bold text-amber-950">{formatPrice(selectedBookingFolio?.balance ?? 0)}</p>
                    </div>
                  </div>
                  {selectedBooking.confirmedWithBalanceReason && (
                    <p className="mt-2 border-t border-amber-200 pt-2 text-amber-800">
                      <span className="font-semibold">Reason:</span> {selectedBooking.confirmedWithBalanceReason}
                    </p>
                  )}
                </div>
              )}
              <div>
                <h2 className="text-sm font-bold text-gray-950">Folio summary</h2>
                <p className="mt-1 text-[11px] text-gray-500">Current charges and collections for this stay.</p>
              </div>
              {/* BDUX-05a: Read-first Total / Paid / Balance summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-gray-50 px-3.5 py-2.5 text-center">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Total</p>
                  <p className="mt-0.5 text-base font-heading font-bold text-gray-950">{formatPrice(selectedBookingFolio?.grandTotal ?? selectedBooking.totalPrice)}</p>
                </div>
                <div className="rounded-lg bg-gray-50 px-3.5 py-2.5 text-center">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Paid</p>
                  <p className="mt-0.5 text-base font-heading font-bold text-emerald-700">{formatPrice(selectedBookingFolio?.paymentsTotal ?? 0)}</p>
                </div>
                <div className={`rounded-lg px-3.5 py-2.5 text-center ${
                  (selectedBookingFolio?.balance ?? 0) > 0
                    ? "bg-red-50"
                    : (selectedBookingFolio?.balance ?? 0) < 0
                      ? "bg-amber-50"
                      : "bg-emerald-50"
                }`}>
                  <p className={`text-[9px] font-bold uppercase tracking-widest ${
                    (selectedBookingFolio?.balance ?? 0) > 0
                      ? "text-red-800"
                      : (selectedBookingFolio?.balance ?? 0) < 0
                        ? "text-amber-800"
                        : "text-emerald-800"
                  }`}>
                    {(selectedBookingFolio?.balance ?? 0) > 0 ? "Balance" : (selectedBookingFolio?.balance ?? 0) < 0 ? "Overpaid" : "Settled"}
                  </p>
                  <p className={`mt-0.5 text-base font-heading font-bold ${
                    (selectedBookingFolio?.balance ?? 0) > 0
                      ? "text-red-600"
                      : (selectedBookingFolio?.balance ?? 0) < 0
                        ? "text-amber-700"
                        : "text-emerald-700"
                  }`}>
                    {formatPrice(Math.abs(selectedBookingFolio?.balance ?? 0))}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3.5 text-xs">
                <h3 className="font-bold text-gray-900">Charge breakdown</h3>
                <div className="mt-3 space-y-2 text-gray-600">
                  <div className="flex items-center justify-between gap-4">
                    <span>Room and booked add-ons</span>
                    <span className="font-semibold text-gray-900">{formatPrice(selectedFolioBaseTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Store charges billed to room</span>
                    <span className="font-semibold text-gray-900">{formatPrice(selectedBookingFolio?.storeTotal ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span>Incidental charges</span>
                    <span className="font-semibold text-gray-900">{formatPrice(selectedBookingFolio?.chargesTotal ?? 0)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-t border-gray-200 pt-2 font-bold text-gray-950">
                    <span>Folio total</span>
                    <span>{formatPrice(selectedBookingFolio?.grandTotal ?? selectedBooking.totalPrice)}</span>
                  </div>
                </div>
                {selectedBooking.rateBreakdown && (
                  <details className="group mt-3 border-t border-gray-200 pt-3">
                    <summary className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-gray-500 hover:text-gray-700">
                      <span>View nightly rate details</span>
                      <ChevronRight size={12} className="transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="mt-3 rounded-lg bg-white p-3">
                      <AdminPriceBreakdown
                        breakdown={selectedBooking.rateBreakdown}
                        total={selectedBooking.totalPrice}
                        originalTotalPrice={selectedBooking.originalTotalPrice}
                        discountType={selectedBooking.discountType}
                        discountPct={selectedBooking.discountPct}
                        discountRejected={selectedBooking.discountRejected}
                      />
                    </div>
                  </details>
                )}
              </div>

              {selectedBooking.paymentProofUrl && (
                <div className="space-y-3">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                    <CreditCard size={14} className="text-primary" />
                    Payment Proof
                  </h3>
                  {selectedBooking.status === "payment-confirmed" || selectedBooking.status === "confirmed" || selectedBooking.paymentRejectionReason ? (
                    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3">
                      <div className="space-y-0.5 text-xs">
                        <p className="font-semibold text-gray-800">
                          {selectedBooking.paymentMethod} · {getLatestPaymentReference(selectedBooking) || "No reference"}
                        </p>
                        <p className="text-[10px] text-gray-400">
                          {selectedBooking.status === "payment-confirmed" ? "Verified" : selectedBooking.paymentRejectionReason ? `Rejected: ${selectedBooking.paymentRejectionReason}` : "Pending"}
                        </p>
                      </div>
                      <button type="button" onClick={() => setImagePreview({ title: `Payment proof for ${selectedBooking.bookingRef}`, url: selectedBooking.paymentProofUrl ?? "" })} className="min-h-[36px] rounded-lg border border-gray-250 bg-white px-3 text-[10px] font-bold text-gray-700 hover:bg-gray-50">
                        <Eye size={13} className="inline mr-1" />
                        View proof
                      </button>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="grid gap-4 sm:grid-cols-[112px_1fr]">
                        <button
                          type="button"
                          onClick={() => setImagePreview({ title: `Payment proof for ${selectedBooking.bookingRef}`, url: selectedBooking.paymentProofUrl ?? "" })}
                          className="block overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                        >
                          <img
                            src={selectedBooking.paymentProofUrl}
                            alt={`Payment proof for ${selectedBooking.bookingRef}`}
                            className="h-28 w-full object-cover"
                          />
                        </button>
                        <div className="flex flex-col justify-center gap-2 text-xs text-gray-600">
                          <p className="font-semibold text-gray-900">
                            Method: {selectedBooking.paymentMethod ? getOnsitePaymentMethodLabel(selectedBooking.paymentMethod) : "Not specified"}
                          </p>
                          {getLatestPaymentReference(selectedBooking) && (
                            <p className="font-semibold text-gray-900">
                              Ref: {getLatestPaymentReference(selectedBooking)}
                            </p>
                          )}
                          {selectedBooking.status === "payment-uploaded" && (
                            <button
                              type="button"
                              onClick={() => { verifySubmissionIdRef.current = createSelectedLedgerEntryId("payment"); setShowVerifyPaymentModal(true); setVerifyAmount(String(Math.max(0, selectedBookingFolio?.balance ?? 0))); setVerifyMethod(selectedBooking.paymentMethod || "gcash"); setVerifyReference(""); setVerifyNote(""); setVerifyError(null); setVerifyPending(false); }}
                              className="inline-flex min-h-[36px] w-full items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3 text-[10px] font-bold text-white transition hover:bg-green-700"
                            >
                              <ShieldCheck size={13} />
                              Verify & Record Payment
                            </button>
                          )}
                          <div className="flex gap-2">
                            <a href={selectedBooking.paymentProofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-gray-250 px-3 text-[10px] font-bold text-gray-700 transition hover:bg-gray-50">
                              <Eye size={13} />
                              Open Full Size
                            </a>
                            <button type="button" onClick={() => setImagePreview({ title: `Payment proof for ${selectedBooking.bookingRef}`, url: selectedBooking.paymentProofUrl ?? "" })} className="inline-flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[10px] font-bold text-white transition hover:bg-primary-dark">
                              <Eye size={13} />
                              Preview
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            </BookingDrawerSectionPanel>

            {/* Breakfast selections */}
            <BookingDrawerSectionPanel section="check-in" activeSection={activeBookingSection}>
            {selectedBooking.hasBreakfast && (selectedBooking.status === "confirmed" || selectedBooking.status === "checked-in") && (() => {
              const breakfastKeys = Object.keys(selectedBooking.breakfastSelections ?? {});
              const recordedCount = breakfastKeys.filter((key) => selectedBooking.breakfastSelections?.[key]).length;
              const totalSlots = selectedBooking.numGuests * getStayDates(selectedBooking).length;
              return (
              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-400">
                  <Utensils size={14} className="text-primary" />
                  Breakfast Selections
                </h3>
                <details className="group rounded-lg border border-gray-200 bg-white open:shadow-sm">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-xs font-semibold text-gray-700 hover:bg-gray-50 [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2">
                      <ChevronRight size={14} className="transition-transform group-open:rotate-90 text-gray-400" />
                      {recordedCount > 0 ? (
                        <span>{recordedCount} of {totalSlots} selections recorded</span>
                      ) : (
                        <span>Record breakfast selections</span>
                      )}
                    </span>
                    {recordedCount > 0 && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700">{recordedCount}/{totalSlots}</span>
                    )}
                  </summary>
                  <div className="border-t border-gray-200 p-5 space-y-3">
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
                </details>
              </div>
              );
            })()}
            </BookingDrawerSectionPanel>

            <BookingDrawerSectionPanel section="folio" activeSection={activeBookingSection} className="lg:w-[calc(66.667%-0.5rem)]">
            {(() => {
              const hasVoucherOrDiscount = selectedBooking.discountType || selectedBooking.voucherCode;
              return (
                <div className="flex flex-col gap-3 rounded-card border border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
                      <ShieldCheck size={14} className="text-primary" />
                      Discount or voucher
                    </h3>
                    <div className="mt-1 space-y-1 text-[11px] text-gray-500">
                      {hasVoucherOrDiscount ? (
                        <>
                          {selectedBooking.discountType && (
                            <p>
                              {selectedBooking.discountType === "senior" ? "Senior Citizen (20%)" : "PWD (20%)"}
                              {selectedBooking.discountVerified ? <span className="ml-1 font-semibold text-emerald-700">Verified</span> : <span className="ml-1 font-semibold text-amber-700">Pending review</span>}
                            </p>
                          )}
                          {selectedBooking.voucherCode && <p>Voucher {selectedBooking.voucherCode}</p>}
                        </>
                      ) : (
                        <p>No booking-level discount has been applied.</p>
                      )}
                    </div>
                  </div>
                  {!hasVoucherOrDiscount && RESCHEDULABLE_STATUSES.includes(selectedBooking.status) && (
                    <button
                      type="button"
                      onClick={() => { setStaffDiscountType(""); setStaffVoucherCode(""); setShowDiscountForm(true); }}
                      className="inline-flex min-h-[44px] w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-white px-4 text-xs font-bold text-primary-dark hover:bg-primary-light sm:w-auto"
                    >
                      <Plus size={14} />
                      Apply discount
                      {/* Per MRB-12 (2026-08-03, per decision #179 —
                          proposed): the discount action is per-room
                          by default. The form gains a "This room" /
                          "All N rooms" segmented control in
                          MRB-12-05; the chip here is informational
                          so the desk sees the scope before opening
                          the modal. Hidden for N=1 / legacy (the
                          `renderActionScope` helper gates on
                          `selectedReservationContext`). */}
                      {renderActionScope("room")}
                    </button>
                  )}
                </div>
              );
            })()}
            </BookingDrawerSectionPanel>

            {/* Government discount verification */}
            <BookingDrawerSectionPanel section="check-in" activeSection={activeBookingSection}>
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
            </BookingDrawerSectionPanel>

            <BookingDrawerSectionPanel section="folio" activeSection={activeBookingSection} className="lg:w-[calc(66.667%-0.5rem)]">
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
            <div className="space-y-3.5 rounded-card border border-gray-200 bg-white p-4">
              <div>
                <h3 className="text-xs font-bold text-gray-900">Payment history</h3>
                <p className="mt-1 text-[11px] text-gray-500">Immutable onsite collections and refunds.</p>
              </div>
              
              <div className="space-y-2">
                {selectedBookingPayments.length > 0 ? (() => {
                  const paymentList = (
                    <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                      {selectedBookingPayments.map((pay) => (
                        <div key={pay.id} className="pt-2 first:pt-0 flex justify-between items-center text-xs">
                          <div>
                            <p className="font-semibold text-gray-800">{pay.type === "refund" ? `Refund — ${pay.reason || pay.note}` : pay.note || "Onsite Payment"}</p>
                            <p className="text-[9px] text-gray-400">
                              {pay.recordedAt.split("T")[0]} via {getOnsitePaymentMethodLabel(pay.method)}
                              {pay.transactionReference ? ` · Ref: ${pay.transactionReference}` : ""}
                              {pay.approvedBy ? ` · approved by ${pay.approvedBy}` : ""}
                            </p>
                          </div>
                          <span className={`font-bold ${pay.type === "refund" ? "text-red-600" : "text-green-700"}`}>{pay.amount >= 0 ? "+" : ""}{formatPrice(pay.amount)}</span>
                        </div>
                      ))}
                    </div>
                  );
                  if (selectedBookingPayments.length >= 4) {
                    return (
                      <details className="group" defaultChecked>
                        <summary className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-gray-600 hover:text-gray-800 [&::-webkit-details-marker]:hidden">
                          <ChevronRight size={14} className="transition-transform group-open:rotate-90" />
                          {selectedBookingPayments.length} entries
                        </summary>
                        <div className="mt-2">{paymentList}</div>
                      </details>
                    );
                  }
                  return paymentList;
                })() : (
                  <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2.5 text-xs text-gray-500">No onsite payments recorded.</p>
                )}

                {/* The sticky drawer footer owns the sole primary Collect action while a balance is due. */}
                {(["confirmed", "checked-in", "checked-out"] as string[]).includes(selectedBooking.status) && (() => {
                  const folioBalance = getBookingFolio(selectedBooking).balance;
                  if (folioBalance > 0) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => openRecordPaymentForBalance(folioBalance)}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 sm:w-auto"
                    >
                      <CreditCard size={13} />
                      Record payment
                    </button>
                  );
                })()}

                {currentUser?.role === "admin" && selectedBookingPayments.some((payment) => payment.amount > 0) && (
                  <button
                    type="button"
                    onClick={() => { setRefundAmount(""); setRefundMethod("cash"); setRefundReason(""); setShowRefundModal(true); }}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 text-xs font-bold text-red-700 hover:bg-red-50 sm:w-auto"
                  >
                    <CreditCard size={13} />
                    Record Refund
                  </button>
                )}
              </div>
            </div>
            </BookingDrawerSectionPanel>

            {/* Early Check-In Request Panel */}
            <BookingDrawerSectionPanel section="overview" activeSection={activeBookingSection}>
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
                        <p className="font-semibold text-gray-900">{eci.requestedAt ? new Date(eci.requestedAt).toLocaleDateString(config.locale, { month: "short", day: "numeric", year: "numeric" }) : "—"}</p>
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
            </BookingDrawerSectionPanel>

            {/* Email Actions Panel */}
            <BookingDrawerSectionPanel section="more" activeSection={activeBookingSection} primary>
            <BookingEmailActions
              booking={selectedBooking}
              resendingAction={resendingEmailAction}
              onResend={handleResendEmail}
            />
            </BookingDrawerSectionPanel>

            <BookingDrawerSectionPanel section="folio" activeSection={activeBookingSection} className="lg:w-[calc(66.667%-0.5rem)]">
            <IncidentalChargeList
              charges={selectedBookingCharges}
              booking={selectedBooking}
              chargeToVoid={chargeToVoid}
              onAddCharge={() => { setChargeCategory("other"); setChargeLabel(""); setChargeAmount(""); setChargeNote(""); setShowChargeModal(true); }}
              onSetChargeToVoid={setChargeToVoid}
              onVoidCharge={handleVoidCharge}
            />

            {/* UCO-08/UCO-10: post-checkout receivable state */}
            {selectedBooking.status === "checked-out" && (() => {
              const folio = getBookingFolio(selectedBooking);
              const hasLiveBalance = folio.balance > 0;
              const hasUnpaidCheckoutReason = selectedBooking.unpaidCheckoutReason;
              if (hasLiveBalance) {
                return (
                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 space-y-2">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-orange-800">
                      <CreditCard size={14} />
                      {hasUnpaidCheckoutReason ? "Balance due — unpaid departure" : "Balance due"}
                    </p>
                    <p className="text-[10px] text-orange-700">
                      Outstanding: {formatPrice(folio.balance)} · Record a payment to settle.
                    </p>
                    {selectedBooking.unpaidCheckoutReason && (
                      <p className="rounded bg-orange-100/50 px-2 py-1 text-[10px] text-orange-800">
                        Reason: {selectedBooking.unpaidCheckoutReason}
                      </p>
                    )}
                    <p className="text-[10px] text-orange-600">
                      Original folio: {formatPrice(selectedBooking.checkedOutFolioTotal || folio.grandTotal)} ·
                      Collected at checkout: {formatPrice(selectedBooking.checkedOutCollectedTotal || folio.paymentsTotal)}
                    </p>
                  </div>
                );
              }
              if (folio.balance <= 0 && folio.paymentsTotal > 0 && selectedBooking.checkedOutWithBalance && selectedBooking.checkedOutWithBalance > 0) {
                return (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                      <CreditCard size={14} />
                      Settled after checkout
                    </p>
                    <p className="mt-1 text-[10px] text-emerald-700">
                      Originally departed with {formatPrice(selectedBooking.checkedOutWithBalance)} due. Now fully settled.
                    </p>
                  </div>
                );
              }
              return null;
            })()}

            {/* Receipt actions — financial totals live in the sticky Folio summary. */}
            {(selectedBooking.status === "checked-in" || selectedBooking.status === "checked-out") && (
              <div className="rounded-card border border-gray-200 bg-white p-4">
                <div>
                  <h3 className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
                    <FileText size={14} className="text-primary" />
                    Receipt and checkout documents
                  </h3>
                  <p className="mt-1 text-[11px] text-gray-500">The current folio summary is used for both receipt views.</p>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={printBookingReceiptPDF}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-gray-250 bg-white px-3 text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    <FileText size={13} />
                    Print receipt PDF
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
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg border border-gray-250 bg-white px-3 text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    <Eye size={13} />
                    Preview receipt page
                  </button>
                </div>
              </div>
            )}
            </BookingDrawerSectionPanel>

            {/* Secondary and destructive booking actions */}
            <BookingDrawerSectionPanel section="more" activeSection={activeBookingSection} className="border-t border-gray-150 pt-4">
              {/* Per CWB-04 / decision #122 (2026-07-23):
                  secondary entry point for the confirm-with-
                  balance flow. Visible whenever the booking is
                  in `payment-uploaded` and a balance remains
                  (the same case the verify success modal's
                  partial variant covers). The form's threshold
                  banner handles the role-gated submit. */}
              {selectedBooking.status === "payment-uploaded" && (selectedBookingFolio?.balance ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmWithBalanceContext({
                      booking: selectedBooking,
                      currentBalance: Math.max(0, selectedBookingFolio?.balance ?? 0)
                    });
                  }}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-4 text-xs font-bold text-primary transition hover:bg-primary/10"
                >
                  <ShieldCheck size={15} className="text-primary" aria-hidden="true" />
                  Confirm with Balance
                  {renderActionScope("reservation")}
                </button>
              )}

              {RESCHEDULABLE_STATUSES.includes(selectedBooking.status) && !showMoveForm && (
                <button
                  type="button"
                  onClick={() => setShowMoveForm(true)}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
                >
                  <Move size={15} className="text-primary" aria-hidden="true" />
                  Move / upgrade room
                  {renderActionScope("room")}
                </button>
              )}

              {/*
                Per MRB-14 (2026-08-03, per decision #180 —
                proposed): the "Add room to this
                reservation" action. Staff picks a
                vacant room; the server reads the
                header's current dates (the new child
                inherits them — the dates are NEVER in
                the modal). Pre-arrival only. Hidden
                for legacy null-`reservationId`
                bookings (the add-room flow is a
                multi-room concept). Hidden for single-
                room reservations where the existing
                children disagree on status (a stale
                or `cancelled` child triggers a
                server-side 400 — the desk should
                clear the stale child first).
              */}
              {selectedBooking.reservationId && RESCHEDULABLE_STATUSES.includes(selectedBooking.status) && !showAddRoomForm && (
                <button
                  type="button"
                  onClick={() => {
                    setAddRoomRoomId("");
                    setAddRoomNumAdults(1);
                    setAddRoomNumChildren(0);
                    setAddRoomExtraBedCount(0);
                    setShowAddRoomForm(true);
                  }}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 transition hover:bg-gray-50"
                  data-testid="add-room-button"
                >
                  <Plus size={15} className="text-primary" aria-hidden="true" />
                  Add room to this reservation
                  {renderActionScope("reservation")}
                </button>
              )}

              {selectedBooking.status !== "checked-out" && selectedBooking.status !== "cancelled" && (
                showBookingCancelForm ? (
                  <ConfirmForm
                    // Per MRB-13 (2026-08-02, per decision
                    // #166): the cancel form's title +
                    // confirm label switch with the
                    // selected scope. Default scope is
                    // `"room"` (safer choice — staff must
                    // opt into the whole-reservation
                    // path). The `additionalFields` slot
                    // hosts the `This room` / `All N
                    // rooms` segmented control; it is only
                    // rendered when the selected booking
                    // is part of a multi-room reservation
                    // (so single-room work is not
                    // cluttered with a control that
                    // would always pick the same value).
                    title={
                      selectedReservationContext && bookingCancelScope === "reservation"
                        ? `Cancel all ${selectedReservationContext.roomCount} rooms?`
                        : "Cancel this booking?"
                    }
                    message={
                      selectedReservationContext && bookingCancelScope === "reservation"
                        ? `This will cancel every room in reservation ${selectedReservationContext.reservationRef || "—"} (${selectedReservationContext.roomCount} rooms total). Cancellation is permanent and the guest will be notified by email. The booking records are kept in the audit log. If money was collected, no refund is issued automatically — record a refund separately through the Folio → Refund action.`
                        : "Cancellation is permanent and the guest will be notified by email. The booking record is kept in the audit log. If money was collected, no refund is issued automatically — record a refund separately through the Folio → Refund action."
                    }
                    reasonLabel="Cancellation reason (optional)"
                    reasonPlaceholder="e.g. guest requested, no-show, double-booked"
                    confirmLabel={
                      selectedReservationContext && bookingCancelScope === "reservation"
                        ? `Cancel all ${selectedReservationContext.roomCount} rooms`
                        : "Cancel booking"
                    }
                    cancelLabel="Back"
                    variant="danger"
                    additionalFields={
                      <div className="space-y-3">
                        {selectedReservationContext ? (
                          <div
                            data-testid="booking-cancel-scope-selector"
                            className="rounded-lg border border-amber-200 bg-amber-50/60 p-3"
                          >
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                              Cancellation scope
                            </p>
                            <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                              This booking is part of reservation {selectedReservationContext.reservationRef || "—"} ({selectedReservationContext.roomCount} rooms). Pick what to cancel.
                            </p>
                            <div className="mt-2 grid grid-cols-2 gap-2">
                              <button
                                type="button"
                                data-testid="booking-cancel-scope-room"
                                onClick={() => setBookingCancelScope("room")}
                                className={cn(
                                  "min-h-[44px] rounded-lg border px-3 text-left transition sm:min-h-[36px]",
                                  bookingCancelScope === "room"
                                    ? "border-primary bg-primary text-white shadow-sm"
                                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                )}
                              >
                                <span className="block text-xs font-bold">This room</span>
                                <span className={cn(
                                  "mt-0.5 block text-[10px]",
                                  bookingCancelScope === "room" ? "text-white/80" : "text-gray-500"
                                )}>
                                  Room {selectedReservationContext.position} of {selectedReservationContext.roomCount}
                                </span>
                              </button>
                              <button
                                type="button"
                                data-testid="booking-cancel-scope-reservation"
                                onClick={() => setBookingCancelScope("reservation")}
                                className={cn(
                                  "min-h-[44px] rounded-lg border px-3 text-left transition sm:min-h-[36px]",
                                  bookingCancelScope === "reservation"
                                    ? "border-red-600 bg-red-600 text-white shadow-sm"
                                    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                                )}
                              >
                                <span className="block text-xs font-bold">All {selectedReservationContext.roomCount} rooms</span>
                                <span className={cn(
                                  "mt-0.5 block text-[10px]",
                                  bookingCancelScope === "reservation" ? "text-white/80" : "text-gray-500"
                                )}>
                                  Cancel the whole reservation
                                </span>
                              </button>
                            </div>
                          </div>
                        ) : null}
                        {/* Per CRL-06 (2026-08-02): the financial-effect
                            preview. The panel is mounted below the scope
                            selector so the staff sees the breakdown
                            before tapping confirm. The panel is
                            best-effort — the destructive cancel still
                            proceeds if the preview errors (the error
                            state surfaces a clear "breakdown unavailable"
                            message). The panel re-fetches on scope
                            flip via the `useEffect` above. */}
                        <CancellationPreviewPanel
                          preview={cancelPreview}
                          isLoading={cancelPreviewLoading}
                          error={cancelPreviewError}
                        />
                      </div>
                    }
                    onConfirm={(reason) => void handleCancelBooking(reason, bookingCancelScope)}
                    onCancel={() => {
                      setShowBookingCancelForm(false);
                      // Per MRB-13: reset the scope on
                      // close so a previous session's
                      // choice never bleeds into a new
                      // session. The default `"room"` is
                      // the safer choice.
                      setBookingCancelScope("room");
                      cancelPreviewRequestIdRef.current += 1;
                      // Per CRL-06: drop the preview
                      // state on close so a previous
                      // session's breakdown never
                      // bleeds into a new session.
                      setCancelPreview(null);
                      setCancelPreviewError(null);
                    }}
                  />
                ) : (
                  <button
                    onClick={() => setShowBookingCancelForm(true)}
                    className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-xs font-bold text-red-600 transition"
                  >
                    Cancel Booking
                    {renderActionScope("room")}
                  </button>
                )
              )}
            </BookingDrawerSectionPanel>
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
                <div className="flex justify-between items-center">
                  <span className="font-bold text-gray-900">Room {selectedOrder.roomNumber}</span>
                  <span className="inline-flex items-center gap-1.5 text-gray-655">
                    {selectedOrder.guestName}
                    {selectedOrder.isTestData && (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700">TEST</span>
                    )}
                  </span>
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
        title="Create New Booking"
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
              // Per MRB-07 (2026-08-02, per decision #159): every room
              // stay must name a vacant room and fit its own type's
              // caps — all of them are server rejects, so the desk is
              // stopped before the round trip rather than after it.
              disabled={!walkinReservationIsValid || isWalkinSubmitting}
              className="min-w-[150px]"
            >
              {isWalkinSubmitting
                ? "Confirming..."
                : walkinRoomStays.length > 1
                  ? `Confirm ${walkinRoomStays.length} Rooms`
                  : "Confirm Reservation"}
            </PrimaryButton>
          </div>
        }
      >
        <form onSubmit={handleWalkinSubmit} id="walkin-form" className="space-y-4 text-sm">
          <span className="sr-only">Confirm Reservation</span>
          {/* Per fix/walkin-split-name (2026-07-25): walk-in
              now mirrors the guest `/book` page and collects
              first + last name separately. We use a flex
              (not a grid) wrapper so the Phase 11.7 "single
              column on mobile" rule stays intact — the two
              fields stack on phones (where two short text
              inputs side-by-side would be cramped) and sit
              side-by-side on sm+ (640px+, where the front-
              desk tablet/desktop lives). The autoComplete
              hints let the browser's address-book fill drive
              the input on each form independently. Both
              fields are required — the server-side
              WalkinGuestDetailsSchema already enforces this,
              and the form-level guard in handleWalkinSubmit
              surfaces a friendlier error before the round
              trip. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:gap-3">
            <label className="flex flex-1 flex-col gap-2 text-xs font-semibold text-gray-700">
              Guest First Name
              <input
                type="text"
                required
                value={walkinFirstName}
                onChange={(e) => setWalkinFirstName(e.target.value)}
                placeholder="Maria"
                autoComplete="given-name"
                className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-xs outline-none focus:bg-white"
              />
            </label>
            <label className="flex flex-1 flex-col gap-2 text-xs font-semibold text-gray-700">
              Guest Last Name
              <input
                type="text"
                required
                value={walkinLastName}
                onChange={(e) => setWalkinLastName(e.target.value)}
                placeholder="Santos"
                autoComplete="family-name"
                className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 px-3 text-xs outline-none focus:bg-white"
              />
            </label>
          </div>

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

          {/* Per EXB-07 (2026-08-01, per decision #155) + MRB-07
              (2026-08-02, per decision #159): the reservation's room
              stays. Each stay picks a room type and a specific vacant
              room, then carries its own occupancy steppers: adults
              (>= 1, required), children (>= 0), and extra beds (>= 0,
              capped at `maxExtraBeds` for that stay's type, hidden
              entirely when the type allows 0). Totals auto-update the
              price preview below. The contextual overflow hint renders
              per stay when its split exceeds that type's caps —
              strongest UX: tell the desk exactly how many extra beds to
              add instead of letting the server reject. Rooms already
              taken by another stay are filtered out of the picker, so
              the desk cannot build a reservation the server would
              refuse for selling the same room twice. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-500">
              <span>
                Rooms
                {walkinRoomStays.length > 1 ? ` (${walkinRoomStays.length})` : ""}
              </span>
              <span className="text-gray-400 normal-case font-normal">
                {numGuests} guest{numGuests === 1 ? "" : "s"} total
              </span>
            </div>

            {walkinRoomStays.map((stay, stayIndex) => {
              const stayRooms = availableRoomsForStay(stayIndex);
              const stayTypeEntry = roomTypes.find((t) => t.value === stay.roomType);
              const stayMaxCapacity = Number(stayTypeEntry?.maxCapacity) || 0;
              const stayMaxChildren = Number(stayTypeEntry?.maxChildren) || 0;
              const stayMaxExtraBeds = Number(stayTypeEntry?.maxExtraBeds) || 0;
              const stayExtraBedRate = Number(stayTypeEntry?.extraBedRate) || 0;
              const stayOverflow = stayTypeEntry
                ? requiredExtraBedsFor({
                    numAdults: stay.numAdults,
                    numChildren: stay.numChildren,
                    maxCapacity: stayMaxCapacity,
                    maxChildren: stayMaxChildren
                  })
                : { overflowAdults: 0, overflowChildren: 0, requiredExtraBeds: 0 };
              const stayShowOverflowHint =
                Boolean(stayTypeEntry) && stayOverflow.requiredExtraBeds > stay.extraBedCount;
              const stayGuests = stay.numAdults + stay.numChildren;

              return (
                <div
                  key={stay.key}
                  className="space-y-2 rounded-xl border border-gray-200 bg-gray-50/40 p-3"
                >
                  {walkinRoomStays.length > 1 && (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-gray-600">
                        Room {stayIndex + 1} of {walkinRoomStays.length}
                        {walkinRoomChargeTotals[stayIndex] > 0
                          ? ` — ${formatPrice(walkinRoomChargeTotals[stayIndex])}`
                          : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeWalkinRoomStay(stayIndex)}
                        className="min-h-[32px] rounded-lg px-2 text-[11px] font-semibold text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Room Type
                    <select
                      value={stay.roomType}
                      onChange={(e) => {
                        const nextType = e.target.value;
                        const claimed = new Set(
                          walkinRoomStays
                            .filter((_, idx) => idx !== stayIndex)
                            .map((other) => other.roomNumber)
                            .filter(Boolean)
                        );
                        const firstFree = rooms.find(
                          (r) =>
                            r.type === nextType &&
                            r.status === "available" &&
                            !claimed.has(r.roomNumber)
                        );
                        updateWalkinRoomStay(stayIndex, {
                          roomType: nextType,
                          roomNumber: firstFree?.roomNumber || "",
                          // A different type has different caps, so a
                          // carried-over extra-bed count could exceed
                          // the new allowance.
                          extraBedCount: 0
                        });
                      }}
                      className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
                    >
                      {roomTypes.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                    Select Available Room Number
                    <select
                      value={stay.roomNumber}
                      onChange={(e) => updateWalkinRoomStay(stayIndex, { roomNumber: e.target.value })}
                      className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs text-gray-900"
                      required
                    >
                      {stayRooms.length > 0 ? (
                        stayRooms.map((r) => (
                          <option key={r.id} value={r.roomNumber}>
                            Room {r.roomNumber} ({roomTypes.find((t) => t.value === r.type)?.shortLabel || r.type}, ₱{roomTypes.find((t) => t.value === r.type)?.pricePerNight ?? 0}/night)
                          </option>
                        ))
                      ) : (
                        <option value="" disabled>No vacant rooms available</option>
                      )}
                    </select>
                  </label>

                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    <span>Occupancy</span>
                    <span className="text-gray-400 normal-case font-normal">
                      {stayGuests} guest{stayGuests === 1 ? "" : "s"} in this room
                    </span>
                  </div>

                  <label className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700">
                    <span>Adults</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                        aria-label={`Decrease adults in room ${stayIndex + 1}`}
                        onClick={() => updateWalkinRoomStay(stayIndex, { numAdults: Math.max(1, stay.numAdults - 1) })}
                        disabled={stay.numAdults <= 1}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-6 text-center tabular-nums">{stay.numAdults}</span>
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                        aria-label={`Increase adults in room ${stayIndex + 1}`}
                        onClick={() => updateWalkinRoomStay(stayIndex, { numAdults: stay.numAdults + 1 })}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </label>

                  <label className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700">
                    <span>Children (0–11, free of room rate)</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                        aria-label={`Decrease children in room ${stayIndex + 1}`}
                        onClick={() => updateWalkinRoomStay(stayIndex, { numChildren: Math.max(0, stay.numChildren - 1) })}
                        disabled={stay.numChildren <= 0}
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-6 text-center tabular-nums">{stay.numChildren}</span>
                      <button
                        type="button"
                        className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                        aria-label={`Increase children in room ${stayIndex + 1}`}
                        onClick={() => updateWalkinRoomStay(stayIndex, { numChildren: stay.numChildren + 1 })}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </label>

                  {stayMaxExtraBeds > 0 ? (
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700">
                      <span>Extra beds ({formatPrice(stayExtraBedRate)} / bed / night)</span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                          aria-label={`Decrease extra beds in room ${stayIndex + 1}`}
                          onClick={() => updateWalkinRoomStay(stayIndex, { extraBedCount: Math.max(0, stay.extraBedCount - 1) })}
                          disabled={stay.extraBedCount <= 0}
                        >
                          <Minus size={14} />
                        </button>
                        <span className="w-6 text-center tabular-nums">{stay.extraBedCount}</span>
                        <button
                          type="button"
                          className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
                          aria-label={`Increase extra beds in room ${stayIndex + 1}`}
                          onClick={() => updateWalkinRoomStay(stayIndex, { extraBedCount: Math.min(stay.extraBedCount + 1, stayMaxExtraBeds) })}
                          disabled={stay.extraBedCount >= stayMaxExtraBeds}
                        >
                          <Plus size={14} />
                        </button>
                      </div>
                    </label>
                  ) : null}

                  {stayShowOverflowHint && stayTypeEntry ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                      {stayMaxExtraBeds > 0 ? (
                        <>
                          This room type allows up to {stayMaxCapacity} adult{stayMaxCapacity === 1 ? "" : "s"} + {stayMaxChildren} child{stayMaxChildren === 1 ? "" : "ren"} (or {stayMaxCapacity + stayMaxExtraBeds}/{stayMaxChildren + stayMaxExtraBeds} with {stayMaxExtraBeds} extra bed{stayMaxExtraBeds === 1 ? "" : "s"}). Add {stayOverflow.requiredExtraBeds} extra bed{stayOverflow.requiredExtraBeds === 1 ? "" : "s"} to fit this room's guests, move someone to another room, or pick a different room type.
                        </>
                      ) : (
                        <>
                          This room type allows up to {stayMaxCapacity} adult{stayMaxCapacity === 1 ? "" : "s"} + {stayMaxChildren} child{stayMaxChildren === 1 ? "" : "ren"} and does not allow extra beds. Move someone to another room or pick a different room type.
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}

            <button
              type="button"
              onClick={addWalkinRoomStay}
              className="min-h-[44px] w-full rounded-lg border border-dashed border-gray-300 text-xs font-semibold text-gray-600 hover:border-primary hover:text-primary"
            >
              + Add another room
            </button>
          </div>

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
            Source
            <select
              value={walkinSource}
              onChange={(e) => setWalkinSource(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
            >
              {selectableBookingSources.map((s) => (
                <option key={s.source} value={s.source}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
            Payment Method
            <select
              value={walkinPayment}
              onChange={(e) => setWalkinPayment(e.target.value)}
              className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white py-2 px-3 text-xs"
            >
              {[
                { method: "pay-at-hotel", label: "Pay at Hotel" },
                ...onsitePaymentMethodOptions
              ].map((m: any) => (
                <option key={m.method} value={m.method}>
                  {m.label || m.method}
                </option>
              ))}
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
            {testRuns.filter(r => r.status === "active").length > 0 && (
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Mark as Test Data
                <select value={walkinTestRunId} onChange={(e) => setWalkinTestRunId(e.target.value)} className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white px-3 text-xs">
                  <option value="">Live data (not a test)</option>
                  {testRuns.filter(r => r.status === "active").map(run => (
                    <option key={run.id} value={run.id}>{run.name}</option>
                  ))}
                </select>
              </label>
            )}
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
            {/* Per MRB-07 (2026-08-02, per decision #159): a
                multi-room reservation states its room count so the
                accommodation figure below is unambiguous. */}
            {walkinRoomStays.length > 1 && (
              <div className="flex justify-between">
                <span>Rooms:</span>
                <span className="font-bold">
                  {walkinRoomStays.length} ({walkinRoomStays.map((stay) => stay.roomNumber || "—").join(", ")})
                </span>
              </div>
            )}
            <div className="flex justify-between text-gray-600">
              <span>Accommodation Cost{walkinRoomStays.length > 1 ? " (all rooms)" : ""}:</span>
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
        title="Unpaid checkout — reason required"
        open={showUnpaidCheckoutForm}
        onClose={() => setShowUnpaidCheckoutForm(false)}
        className="max-w-lg"
      >
        {selectedBooking && (() => {
          const folio = getBookingFolio(selectedBooking);
          return (
            <div className="space-y-4">
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-xs font-semibold text-amber-900">
                  Outstanding balance: <span className="text-base">{formatPrice(folio.balance)}</span>
                </p>
                <p className="mt-1 text-[10px] text-amber-700">
                  Folio total: {formatPrice(folio.grandTotal)} · Collected: {formatPrice(folio.paymentsTotal)}
                </p>
              </div>

              {unpaidCheckoutBlocked ? (
                <div className="space-y-3">
                  <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                    <p className="text-xs font-bold text-red-800">Front Desk approval limit exceeded</p>
                    <p className="mt-1 text-[10px] text-red-700">{unpaidCheckoutBlockMessage}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowUnpaidCheckoutForm(false)}
                    className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <div>
                    <label htmlFor="unpaid-reason" className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                      Reason for unpaid checkout <span className="text-red-500">*</span>
                    </label>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {UNPAID_REASON_SHORTCUTS.map((shortcut) => (
                        <button
                          key={shortcut.value}
                          type="button"
                          onClick={() => setUnpaidCheckoutReason(shortcut.value)}
                          className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                            unpaidCheckoutReason === shortcut.value
                              ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300"
                              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        >
                          {shortcut.label}
                        </button>
                      ))}
                    </div>
                    <textarea
                      id="unpaid-reason"
                      value={unpaidCheckoutReason}
                      onChange={(e) => setUnpaidCheckoutReason(e.target.value)}
                      placeholder="Describe why the balance remains unpaid..."
                      rows={3}
                      maxLength={500}
                      className="w-full resize-none rounded-lg border border-gray-250 px-3 py-2 text-xs text-gray-900 placeholder-gray-400 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <p className="mt-1 text-right text-[10px] text-gray-400">{unpaidCheckoutReason.length}/500</p>
                  </div>

                  {unpaidCheckoutError && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{unpaidCheckoutError}</p>
                  )}

                  <div className="flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowUnpaidCheckoutForm(false)}
                      disabled={unpaidCheckoutSubmitting}
                      className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!selectedBooking) return;
                        const reason = unpaidCheckoutReason.trim();
                        if (!reason) {
                          setUnpaidCheckoutError("A reason is required for unpaid checkout.");
                          return;
                        }
                        setUnpaidCheckoutSubmitting(true);
                        setUnpaidCheckoutError(null);
                        try {
                          await updateBookingStatus(selectedBooking.id, "checked-out", {
                            unpaidCheckoutReason: reason
                          } as any);
                          setSelectedBooking(prev => prev ? { ...prev, status: "checked-out", unpaidCheckoutReason: reason } as any : null);
                          setShowUnpaidCheckoutForm(false);
                        } catch (err: any) {
                          if (err.message?.includes("Front Desk cannot complete")) {
                            setUnpaidCheckoutBlocked(true);
                            setUnpaidCheckoutBlockMessage(err.message);
                          } else {
                            setUnpaidCheckoutError(err.message || "Failed to checkout.");
                          }
                        } finally {
                          setUnpaidCheckoutSubmitting(false);
                        }
                      }}
                      disabled={unpaidCheckoutSubmitting || !unpaidCheckoutReason.trim()}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-orange-600 px-4 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-50"
                    >
                      {unpaidCheckoutSubmitting ? (
                        <>
                          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Checking out…
                        </>
                      ) : (
                        `Check out with ${formatPrice(folio.balance)} due`
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </Modal>
      {/* PRC-11: Focused Record Payment modal */}
      <Modal
        title="Record Onsite Payment"
        open={showRecordPaymentModal}
        onClose={() => setShowRecordPaymentModal(false)}
        className="max-w-lg"
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Folio balance</p>
              <p className="text-sm font-bold text-gray-900">{formatPrice(selectedBooking ? getBookingFolio(selectedBooking).balance : 0)}</p>
            </div>
          </div>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Amount (PHP)
            <input type="number" required min="0.01" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900" />
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Payment Method
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900">
              {onsitePaymentMethodOptions.map((m) => (<option key={m.method} value={m.method}>{m.label || m.method}</option>))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Transaction Reference
            <input type="text" value={paymentTransactionReference} onChange={(e) => setPaymentTransactionReference(e.target.value)} placeholder="e.g. GCash ref or bank trace #" className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900" />
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Internal Note <span className="font-normal text-gray-400">(optional)</span>
            <input type="text" value={paymentNote} onChange={(e) => setPaymentNote(e.target.value)} placeholder="e.g. Downpayment deposit" className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900" />
          </label>
          {paymentError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{paymentError}</p>}
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setShowRecordPaymentModal(false)} disabled={isRecordingPayment} className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => void (async () => { setPaymentError(null); await handleAddPaymentSubmit(new Event("submit") as unknown as React.FormEvent); setShowRecordPaymentModal(false); })()} disabled={isRecordingPayment || !paymentAmount || parseFloat(paymentAmount) <= 0} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50">
              {isRecordingPayment ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> Recording…</> : "Record Payment"}
            </button>
          </div>
        </div>
      </Modal>

      {/* PRC-13: Verify & Record Payment modal (replaces old status-only mark-payment-confirmed) */}
      <Modal
        title={selectedBooking ? `Verify payment — ${selectedBooking.bookingRef}` : "Verify payment"}
        open={showVerifyPaymentModal}
        onClose={() => { verifySubmissionIdRef.current = null; setShowVerifyPaymentModal(false); }}
        className="max-w-lg"
      >
        {selectedBooking && (
          <div className="space-y-4">
            <p className="text-xs text-gray-600">
              Review the uploaded proof and confirm the collection. This atomically creates a payment ledger entry
              and transitions the booking status.
            </p>
            {selectedBooking.paymentProofUrl && (
              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <button type="button" onClick={() => setImagePreview({ title: `Payment proof for ${selectedBooking.bookingRef}`, url: selectedBooking.paymentProofUrl ?? "" })} className="block w-full overflow-hidden rounded-lg border border-gray-200">
                  <img src={selectedBooking.paymentProofUrl} alt="Payment proof" className="max-h-48 w-full object-contain" />
                </button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Booking total</p>
                <p className="text-sm font-bold text-gray-900">{formatPrice(selectedBookingFolio?.grandTotal ?? selectedFolioBaseTotal)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Outstanding</p>
                <p className="text-sm font-bold text-gray-900">{formatPrice(Math.max(0, selectedBookingFolio?.balance ?? 0))}</p>
              </div>
            </div>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Verified amount
              <input type="number" required min="0.01" step="0.01" value={verifyAmount} onChange={(e) => setVerifyAmount(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900" />
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Payment method
              <select value={verifyMethod} onChange={(e) => setVerifyMethod(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900">
                <option value="gcash">GCash</option>
                <option value="maya">Maya</option>
                <option value="bank">Bank Transfer</option>
                <option value="paypal">PayPal</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Transaction reference
              <input type="text" value={verifyReference} onChange={(e) => setVerifyReference(e.target.value)} placeholder="GCash ref or bank trace #" className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900" />
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Internal note <span className="font-normal text-gray-400">(optional)</span>
              <input type="text" value={verifyNote} onChange={(e) => setVerifyNote(e.target.value)} placeholder="e.g. Full payment via GCash" className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs font-medium text-gray-900" />
            </label>
            {verifyError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{verifyError}</p>}
            <div className="flex items-center justify-end gap-3">
              <button type="button" onClick={() => { verifySubmissionIdRef.current = null; setShowVerifyPaymentModal(false); }} disabled={verifyPending} className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void (async () => {
                setVerifyError(null);
                const amount = parseFloat(verifyAmount);
                if (!Number.isFinite(amount) || amount <= 0) { setVerifyError("Enter a valid positive amount."); return; }
                setVerifyPending(true);
                const paymentId = verifySubmissionIdRef.current
                  || createSelectedLedgerEntryId("payment");
                verifySubmissionIdRef.current = paymentId;
                const result = await verifyAndRecordPayment(selectedBooking.id, paymentId, amount, verifyMethod, verifyReference.trim() || undefined, verifyNote.trim() || undefined);
                setVerifyPending(false);
                if (!result.success) { setVerifyError(result.error || "Failed to verify payment."); return; }
                verifySubmissionIdRef.current = null;
                setShowVerifyPaymentModal(false);

                // Per feat/payment-success-modal: close the loop
                // with a confirmation modal. We compute "is full
                // payment" client-side from the amount the staff
                // just submitted plus the existing onsite
                // payments — the server transitions to
                // `payment-confirmed` iff the cumulative total
                // reaches `totalPrice`. The existing
                // onsitePayments snapshot is pre-action (the
                // snapshot listener will catch up on the next
                // tick), so the math here is correct.
                const existingPaid = selectedBookingPayments.reduce((s, p) => s + p.amount, 0);
                const cumulativeAfter = existingPaid + amount;
                const folioTotal = selectedBookingFolio?.grandTotal ?? selectedFolioBaseTotal;
                const isFullPayment = cumulativeAfter >= folioTotal && folioTotal > 0;
                setVerifySuccess({
                  booking: selectedBooking,
                  amount,
                  method: verifyMethod,
                  methodLabel: onsitePaymentMethodLabels[verifyMethod] || verifyMethod,
                  isFullPayment,
                  remainingBalance: Math.max(0, folioTotal - cumulativeAfter)
                });
              })()} disabled={verifyPending || !verifyAmount || parseFloat(verifyAmount) <= 0} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50">
                {verifyPending ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> Recording…</> : "Verify & Record Payment"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* PRC-13 / feat/payment-success-modal: post-verify confirmation
          modal. Closes the loop on the verify action and nudges the
          front desk toward confirming the booking now that the
          payment is recorded. See the component for the full variant
          matrix (full vs partial, drawer vs dashboard CTAs). */}
      <PaymentSuccessModal
        open={verifySuccess !== null}
        onClose={() => { if (!confirmingBookingFromSuccess) setVerifySuccess(null); }}
        surface="drawer"
        bookingRef={verifySuccess?.booking.bookingRef ?? ""}
        guestName={verifySuccess?.booking.guestName ?? ""}
        guestEmail={verifySuccess?.booking.guestEmail ?? ""}
        roomType={verifySuccess?.booking.roomType ?? ""}
        amount={verifySuccess?.amount ?? 0}
        method={verifySuccess?.method ?? ""}
        methodLabel={verifySuccess?.methodLabel}
        isFullPayment={verifySuccess?.isFullPayment ?? false}
        remainingBalance={verifySuccess?.remainingBalance}
        onConfirmBooking={handleConfirmBookingFromSuccess}
        confirmingBooking={confirmingBookingFromSuccess}
        onConfirmWithBalance={openConfirmWithBalanceFromSuccess}
      />

      {/* Per CWB-04 / decision #122 (2026-07-23): opens from
          the post-verify success modal (partial variant) OR
          from the drawer's More actions menu. The form owns
          the threshold banner + the role-gated submit
          button; on success the snapshot listener refreshes
          the drawer automatically. */}
      {confirmWithBalanceContext && (
        <ConfirmWithBalanceForm
          open={confirmWithBalanceContext !== null}
          onClose={() => setConfirmWithBalanceContext(null)}
          booking={{
            ...confirmWithBalanceContext.booking,
            totalPrice: selectedBookingFolio?.grandTotal ?? confirmWithBalanceContext.booking.totalPrice,
            onsitePayments: selectedBookingPayments
          }}
          currentBalance={confirmWithBalanceContext.currentBalance}
          onConfirmed={() => setConfirmWithBalanceContext(null)}
        />
      )}

      {/* BDUX-05: Discount / Voucher modal */}
      <Modal
        title={
          selectedBooking
            ? staffDiscountScope === "reservation" && selectedReservationContext
              ? `Apply discount — all ${selectedReservationContext.roomCount} rooms (${selectedReservationContext.reservationRef || "—"})`
              : `Apply discount — ${selectedBooking.bookingRef}`
            : "Apply discount / voucher"
        }
        open={showDiscountForm}
        onClose={() => {
          setShowDiscountForm(false);
          // Per MRB-12 (2026-08-03, per decision #179 — proposed):
          // reset the discount scope on close so a previous
          // session's choice never bleeds into a new one (mirrors
          // the MRB-13 cancel-modal `bookingCancelScope` reset).
          setStaffDiscountScope(null);
        }}
        className="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-600">Apply after sighting a valid Senior/PWD ID, or enter a promo code. Pricing is recalculated and audited by the server.</p>
          {/* Per MRB-12 (2026-08-03, per decision #179 — proposed):
              the discount scope selector. Mirrors the MRB-13
              cancel-modal `bookingCancelScope` segmented control.
              Default `"room"` is the safer choice; staff must
              opt into the whole-reservation path explicitly. The
              scope selector is hidden when the selected booking
              is single-room or legacy (no `selectedReservationContext`)
              — the segmented control is meaningless for those
              rows and would always read the same. */}
          {selectedReservationContext && (
            <div
              data-testid="staff-discount-scope-selector"
              className="rounded-lg border border-amber-200 bg-amber-50/60 p-3"
            >
              <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
                Discount scope
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-amber-700">
                This booking is part of reservation {selectedReservationContext.reservationRef || "—"} ({selectedReservationContext.roomCount} rooms). Pick what to discount.
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  data-testid="staff-discount-scope-room"
                  onClick={() => setStaffDiscountScope("room")}
                  className={cn(
                    "min-h-[44px] rounded-lg border px-3 text-left transition sm:min-h-[36px]",
                    (staffDiscountScope ?? "room") === "room"
                      ? "border-primary bg-primary text-white shadow-sm"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  )}
                >
                  <span className="block text-xs font-bold">This room</span>
                  <span className={cn(
                    "mt-0.5 block text-[10px]",
                    (staffDiscountScope ?? "room") === "room" ? "text-white/80" : "text-gray-500"
                  )}>
                    Room {selectedReservationContext.position} of {selectedReservationContext.roomCount}
                  </span>
                </button>
                <button
                  type="button"
                  data-testid="staff-discount-scope-reservation"
                  onClick={() => setStaffDiscountScope("reservation")}
                  className={cn(
                    "min-h-[44px] rounded-lg border px-3 text-left transition sm:min-h-[36px]",
                    staffDiscountScope === "reservation"
                      ? "border-primary bg-primary text-white shadow-sm"
                      : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                  )}
                >
                  <span className="block text-xs font-bold">All {selectedReservationContext.roomCount} rooms</span>
                  <span className={cn(
                    "mt-0.5 block text-[10px]",
                    staffDiscountScope === "reservation" ? "text-white/80" : "text-gray-500"
                  )}>
                    Reservation total
                  </span>
                </button>
              </div>
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Government discount
            <select value={staffDiscountType} onChange={(e) => setStaffDiscountType(e.target.value as "" | "senior" | "pwd")} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs">
              <option value="">None</option>
              <option value="senior">Senior Citizen (20%)</option>
              <option value="pwd">PWD (20%)</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Voucher code
            <input value={staffVoucherCode} onChange={(e) => setStaffVoucherCode(e.target.value.toUpperCase())} maxLength={40} placeholder="Optional promo code" className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs uppercase" />
          </label>
          {discountError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{discountError}</p>}
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => {
              setShowDiscountForm(false);
              setStaffDiscountScope(null);
            }} disabled={isApplyingStaffDiscount} className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => void (async () => {
              if (!selectedBooking || (!staffDiscountType && !staffVoucherCode.trim())) return;
              setDiscountError(null);
              setIsApplyingStaffDiscount(true);
              try {
                // Per MRB-12 (2026-08-03, per decision #179 —
                // proposed): when the staff picks the reservation
                // scope, loop over every room in
                // `selectedReservationContext.rooms` and call the
                // existing per-booking `apply-discount` endpoint
                // for each. The server has no `applyReservationDiscount`
                // endpoint today (MRB-14+ follow-up if atomicity
                // ever matters); the loop is the same code path
                // the desk would manually run for each room
                // today. Errors on a single room abort the loop
                // and surface the failure to the desk — already-
                // repriced rooms keep their new totals; the
                // operator retries the failed room.
                const scope = staffDiscountScope ?? "room";
                const targetIds = scope === "reservation" && selectedReservationContext
                  ? selectedReservationContext.rooms.map((room) => room.id)
                  : [selectedBooking.id];
                const token = await auth.currentUser?.getIdToken(true);
                const errors: string[] = [];
                for (const targetId of targetIds) {
                  const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/apply-discount`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" },
                    body: JSON.stringify({ bookingId: targetId, discountType: staffDiscountType, voucherCode: staffVoucherCode.trim() })
                  });
                  const payload = await response.json();
                  if (!response.ok || !payload.success) {
                    errors.push(payload.error || `Room ${targetId} failed.`);
                    continue;
                  }
                  if (targetId === selectedBooking.id) {
                    // The drawer's `selectedBooking` is the only
                    // one the page hydrates locally via
                    // `syncSelectedBooking`; the sibling rooms
                    // refresh via the AdminContext listener.
                    syncSelectedBooking(payload.data);
                  }
                }
                if (errors.length > 0) {
                  throw new Error(
                    errors.length === targetIds.length
                      ? errors[0]
                      : `${errors.length} of ${targetIds.length} rooms failed: ${errors[0]}`
                  );
                }
                setStaffDiscountType("");
                setStaffVoucherCode("");
                setShowDiscountForm(false);
                setStaffDiscountScope(null);
                toast.success(
                  scope === "reservation" && selectedReservationContext
                    ? `Reservation repriced (${targetIds.length} rooms)`
                    : "Booking repriced",
                  scope === "reservation" && selectedReservationContext
                    ? `Applied across ${targetIds.length} rooms in ${selectedReservationContext.reservationRef || "—"}`
                    : `New total: ${formatPrice(selectedBooking.totalPrice || 0)}`
                );
              } catch (error: any) {
                setDiscountError(error.message || "Please check the details and try again.");
              } finally {
                setIsApplyingStaffDiscount(false);
              }
            })()} disabled={isApplyingStaffDiscount || (!staffDiscountType && !staffVoucherCode.trim())} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50">
              {isApplyingStaffDiscount ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> Applying…</> : (staffDiscountScope === "reservation" && selectedReservationContext ? `Apply to all ${selectedReservationContext.roomCount} rooms` : "Apply and reprice booking")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Per MRB-14 (2026-08-03, per decision #180 —
          proposed): the "Add room to this reservation"
          modal. Staff picks a vacant room; the
          server reads the header's current dates
          (the new child inherits them — the dates
          are NEVER in the form). Pre-arrival only.
          Hidden for legacy null-`reservationId`
          bookings (the drawer's button gates on
          `selectedBooking.reservationId`). The
          modal is intentionally minimal — just
          target room + occupancy. The pricing +
          allocation snapshot is the server's job
          (per MRB-11 the server always computes
          before the write; the input is accepted
          for the rare pre-computed case). */}
      <Modal
        title={selectedBooking ? `Add room — ${selectedBooking.reservationRef || "—"}` : "Add room"}
        open={showAddRoomForm}
        onClose={() => {
          setShowAddRoomForm(false);
          setAddRoomError(null);
        }}
        className="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-xs text-gray-600">
            The new room inherits the reservation's current dates. The room must be vacant and pass bed-inventory validation.
          </p>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Target room
            <select
              value={addRoomRoomId}
              onChange={(e) => setAddRoomRoomId(e.target.value)}
              data-testid="add-room-room-select"
              className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs"
            >
              <option value="">Choose a vacant room</option>
              {rooms
                .filter((r) => r.isActive !== false && r.status !== "blocked")
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.roomNumber} — {r.type.replace(/-/g, " ")}
                  </option>
                ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Adults
              <input
                type="number"
                min={1}
                max={100}
                value={addRoomNumAdults}
                onChange={(e) => setAddRoomNumAdults(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                data-testid="add-room-num-adults"
                className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Children
              <input
                type="number"
                min={0}
                max={100}
                value={addRoomNumChildren}
                onChange={(e) => setAddRoomNumChildren(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                data-testid="add-room-num-children"
                className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
              Extra beds
              <input
                type="number"
                min={0}
                max={20}
                value={addRoomExtraBedCount}
                onChange={(e) => setAddRoomExtraBedCount(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                data-testid="add-room-extra-bed-count"
                className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs"
              />
            </label>
          </div>
          {addRoomError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" data-testid="add-room-error">
              {addRoomError}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => {
                setShowAddRoomForm(false);
                setAddRoomError(null);
              }}
              disabled={isAddingRoom}
              className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!selectedBooking?.reservationId || !addRoomRoomId) {
                  setAddRoomError("Choose a target room.");
                  return;
                }
                setAddRoomError(null);
                setIsAddingRoom(true);
                try {
                  const token = await auth.currentUser?.getIdToken(true);
                  const response = await fetch(
                    `${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/add-room`,
                    {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                        Authorization: token ? `Bearer ${token}` : ""
                      },
                      body: JSON.stringify({
                        reservationId: selectedBooking.reservationId,
                        roomId: addRoomRoomId,
                        numAdults: addRoomNumAdults,
                        numChildren: addRoomNumChildren,
                        extraBedCount: addRoomExtraBedCount
                      })
                    }
                  );
                  const payload = await response.json();
                  if (!response.ok || !payload.success) {
                    throw new Error(payload.error || "Unable to add room.");
                  }
                  toast.success(
                    "Room added",
                    `New room ${payload.data?.bookingRef || ""} added to ${selectedBooking.reservationRef || "reservation"}`
                  );
                  setShowAddRoomForm(false);
                } catch (error: any) {
                  setAddRoomError(error?.message || "Failed to add room. Please try again.");
                } finally {
                  setIsAddingRoom(false);
                }
              }}
              disabled={isAddingRoom || !addRoomRoomId}
              data-testid="add-room-submit"
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              {isAddingRoom ? (
                <>
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Adding…
                </>
              ) : (
                "Add room"
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* BDUX-05: Refund modal */}
      <Modal
        title={selectedBooking ? `Record refund — ${selectedBooking.bookingRef}` : "Record refund"}
        open={showRefundModal}
        onClose={() => setShowRefundModal(false)}
        className="max-w-lg"
      >
        <div className="space-y-4">
          <p className="text-xs text-red-700">Creates an immutable negative payment entry. Refunds cannot exceed net collected funds.</p>
          <div className="rounded-lg bg-gray-50 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Net collected</p>
            <p className="text-sm font-bold text-gray-900">{formatPrice(selectedBookingPayments.reduce((s, p) => s + p.amount, 0))}</p>
          </div>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Refund amount
            <input type="number" min="0.01" step="0.01" value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs" />
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Refund method
            <select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs">
              {onsitePaymentMethodOptions.map((method) => <option key={method.method} value={method.method}>{method.label}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Reason
            <textarea required maxLength={500} rows={2} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Required approval and audit context" className="rounded-lg border border-gray-200 p-3 text-xs" />
          </label>
          {refundError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{refundError}</p>}
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setShowRefundModal(false)} disabled={isRefunding} className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => void (async () => {
              if (!selectedBooking || currentUser?.role !== "admin") return;
              const amount = Number(refundAmount);
              if (!Number.isFinite(amount) || amount <= 0 || !refundReason.trim()) {
                toast.warning("Check refund details", "Enter a positive amount and a required refund reason.");
                return;
              }
              // Per CRL-01: client-preallocated refundId for idempotency.
              // See handleRefundSubmit for the full rationale; the inline
              // Approve button mirrors the same preallocate-keep-replay-mint
              // flow so a manual retry after a closed tab never appends a
              // second refund entry.
              const refundId = refundSubmissionIdRef.current
                || createSelectedLedgerEntryId("refund");
              refundSubmissionIdRef.current = refundId;
              setRefundError(null);
              setIsRefunding(true);
              let refundCompleted = false;
              try {
                const token = await auth.currentUser?.getIdToken(true);
                const response = await fetch(`${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/add-refund`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: token ? `Bearer ${token}` : "" },
                  body: JSON.stringify({ bookingId: selectedBooking.id, refundId, amount, method: refundMethod, reason: refundReason.trim() })
                });
                const payload = await response.json();
                if (!response.ok || !payload.success) {
                  // 409 means the staff reused an ID for a different refund;
                  // clear the held ref so the next submit mints a fresh one.
                  if (response.status === 409) {
                    refundSubmissionIdRef.current = null;
                  }
                  throw new Error(payload.error || "Unable to record refund.");
                }
                refundCompleted = true;
                setRefundAmount("");
                setRefundReason("");
                setShowRefundModal(false);
                toast.success("Refund recorded", `${formatPrice(amount)} returned via ${getOnsitePaymentMethodLabel(refundMethod)}.`);
                // Per CRL-07: the refund updated the
                // refunds subcollection. Bump the
                // panel's `refreshKey` so it re-projects
                // the live `processedAmount` without
                // waiting for the Firestore onSnapshot
                // to land the new value.
                setLiabilitySnapshotKey((prev) => prev + 1);
              } catch (error: any) {
                setRefundError(error.message || "Please try again.");
              } finally {
                // Keep the same ID after an uncertain/network failure. A
                // manual retry then replays the original server commit
                // instead of creating a second ledger entry. Successful
                // submissions mint a fresh ID.
                if (refundCompleted) refundSubmissionIdRef.current = null;
                setIsRefunding(false);
              }
            })()} disabled={isRefunding || !refundAmount || Number(refundAmount) <= 0 || !refundReason.trim()} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50">
              {isRefunding ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> Recording…</> : "Approve and record refund"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Per CRL-07 (2026-08-03, per decision #173):
          the admin-only exception modal. The form
          lives in the
          `CancellationExceptionModal` component (it
          owns the input state, the validation, the
          API call, and the error display). The
          parent only owns the open/close + the
          post-success refresh trigger. The modal is
          admin-gated by the parent: the panel
          only renders the "Apply exception" button
          when `currentUser?.role === "admin"`, and
          the modal itself is mounted only when
          `showExceptionModal` is true (the parent
          controls who can open it via the panel
          button). A non-admin could not even
          trigger the open handler. */}
      <CancellationExceptionModal
        open={showExceptionModal}
        onClose={() => setShowExceptionModal(false)}
        liability={selectedBooking?.cancellationLiability || null}
        bookingId={selectedBooking?.id || ""}
        reservationId={selectedBooking?.reservationId || null}
        onSuccess={() => {
          // The exception updated the stored
          // `cancellationLiability`. Bump the
          // panel's `refreshKey` so it re-projects
          // the new state. The Firestore onSnapshot
          // will also push the new value to
          // `selectedBooking.cancellationLiability`,
          // but the bump makes the refresh feel
          // instant.
          setLiabilitySnapshotKey((prev) => prev + 1);
        }}
      />

      {/* BDUX-05: Add charge modal */}
      <Modal
        title={selectedBooking ? `Add charge — ${selectedBooking.bookingRef}` : "Add incidental charge"}
        open={showChargeModal}
        onClose={() => setShowChargeModal(false)}
        className="max-w-lg"
      >
        <div className="space-y-4">
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Category
            <select value={chargeCategory} onChange={(e) => setChargeCategory(e.target.value as IncidentalChargeCategory)} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs">
              <option value="late-checkout">Late checkout</option>
              <option value="early-checkin">Early check-in</option>
              <option value="extra-person">Extra person / bed</option>
              <option value="damage">Damage</option>
              <option value="laundry">Laundry</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Label
            <input required maxLength={120} value={chargeLabel} onChange={(e) => setChargeLabel(e.target.value)} placeholder="e.g. Late checkout until 2 PM" className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs" />
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Amount ({config.currencySymbol})
            <input required type="number" min="0.01" max="1000000" step="0.01" value={chargeAmount} onChange={(e) => setChargeAmount(e.target.value)} className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs" />
          </label>
          <label className="flex flex-col gap-1.5 text-[10px] font-semibold text-gray-600">
            Note (optional)
            <input maxLength={300} value={chargeNote} onChange={(e) => setChargeNote(e.target.value)} placeholder="Operational context for the audit trail" className="min-h-[44px] rounded-lg border border-gray-200 px-3 text-xs" />
          </label>
          {chargeError && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{chargeError}</p>}
          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={() => setShowChargeModal(false)} disabled={isSavingCharge} className="min-h-[44px] rounded-lg border border-gray-250 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">Cancel</button>
            <button type="button" onClick={() => void (async () => {
              if (!selectedBooking) return;
              const amount = Number(chargeAmount);
              if (!chargeLabel.trim() || !Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
                toast.warning("Check charge details", "Enter a label and an amount between 0.01 and 1,000,000.");
                return;
              }
              setChargeError(null);
              setIsSavingCharge(true);
              try {
                const chargesRef = getSelectedChargeCollection();
                if (!chargesRef) return;
                await addDoc(chargesRef, {
                  label: chargeLabel.trim(),
                  amount,
                  category: chargeCategory,
                  note: chargeNote.trim(),
                  addedBy: currentUser?.uid || "staff",
                  addedAt: serverTimestamp(),
                  voidOf: null,
                  ...(selectedBooking.reservationId ? { bookingId: selectedBooking.id } : {})
                });
                setChargeLabel("");
                setChargeAmount("");
                setChargeNote("");
                setChargeCategory("other");
                setShowChargeModal(false);
                toast.success("Charge added", `${formatPrice(amount)} added to the booking folio.`);
              } catch (error: any) {
                setChargeError(error.message || "Please try again.");
              } finally {
                setIsSavingCharge(false);
              }
            })()} disabled={isSavingCharge || !chargeLabel.trim() || !chargeAmount || Number(chargeAmount) <= 0} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-bold text-white hover:bg-primary-dark disabled:opacity-50">
              {isSavingCharge ? <><span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" /> Adding…</> : "Add to folio"}
            </button>
          </div>
        </div>
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
