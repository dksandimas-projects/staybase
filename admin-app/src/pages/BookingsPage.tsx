import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useAdmin, Booking, OnsitePayment } from "../context/AdminContext";
import { compressImageFile } from "@spark-inn/shared";
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
  BedDouble
} from "lucide-react";
import config from "@config";
import { jsPDF } from "jspdf";
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/config";
import { auth } from "../firebase/auth";

export function BookingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { 
    bookings, 
    rooms, 
    updateBookingStatus, 
    addOnsitePayment, 
    addWalkinBooking,
    storeOrders,
    updateStoreOrderStatus,
    billStoreOrder,
    roomTypes,
    breakfastConfig,
    websiteContent,
    currentUser
  } = useAdmin();
  const toast = useToast();
  const discountApproveConfirm = useTwoClickConfirm<"approve">();
  const checkoutWithBalanceConfirm = useTwoClickConfirm<"confirm">();

  const [showDiscountRejectForm, setShowDiscountRejectForm] = useState(false);
  const [showBookingCancelForm, setShowBookingCancelForm] = useState(false);
  const [showOrderCancelForm, setShowOrderCancelForm] = useState(false);

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
  }, [searchParams]);

  // Store Order Drawer States
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isOrderDrawerOpen, setIsOrderDrawerOpen] = useState(false);

  // Payment Form States
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNote, setPaymentNote] = useState("");
  const [guestIdUploadStatus, setGuestIdUploadStatus] = useState("");

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
  const [checkInDate, setCheckInDate] = useState(new Date().toISOString().split("T")[0]);
  const [checkOutDate, setCheckOutDate] = useState(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().split("T")[0];
  });
  const [numGuests, setNumGuests] = useState(1);
  const [walkinPayment, setWalkinPayment] = useState("pay-at-hotel");
  const [hasBreakfast, setHasBreakfast] = useState(false);
  const [immediateCheckIn, setImmediateCheckIn] = useState(false);
  const [priceOverride, setPriceOverride] = useState("");

  const [selectedBookingPayments, setSelectedBookingPayments] = useState<OnsitePayment[]>([]);

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
          amount: data.amount || 0,
          method: data.method || "",
          note: data.note || "",
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

  // Filter available rooms based on type selected
  const availableRoomsOfType = rooms.filter(
    r => r.type === roomType && r.status === "available"
  );

  // Calculate rate per night for selected room number
  const selectedRoomDetails = rooms.find(r => r.roomNumber === roomNumber);
  const ratePerNight = selectedRoomDetails?.pricePerNight || 0;
  
  // Calculate nights
  const getNumNights = () => {
    if (!checkInDate || !checkOutDate) return 1;
    const start = new Date(checkInDate);
    const end = new Date(checkOutDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    return Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
  };
  const numNights = getNumNights();
  const brekkieRate = breakfastConfig.ratePerPersonPerNight || 300;
  const totalPrice = ratePerNight * numNights + (hasBreakfast ? brekkieRate * numGuests * numNights : 0);

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
      render: (row) => <StatusBadge label={row.status.replace("-", " ")} status={row.status} />
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
  const today = new Date().toISOString().split("T")[0];
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
      <p className="text-lg font-bold text-primary-dark">{formatPrice(row.totalPrice)}</p>
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
      const token = await auth.currentUser?.getIdToken();
      const baseUrl = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:3000"
        : import.meta.env.VITE_GUEST_APP_URL || "";

      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/bookings/reject-discount`, {
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

      const updatedFields = {
        discountRejected: true,
        discountRejectedBy: currentUser?.email || "staff",
        discountRejectionReason: reason,
        discountVerified: false,
        discountPct: 0,
        totalPrice: selectedBooking.originalTotalPrice ?? selectedBooking.totalPrice
      };

      syncSelectedBooking(updatedFields);
      toast.success("Discount rejected", "Full rate restored. Guest notified by email.");
      setShowDiscountRejectForm(false);
    } catch (err: any) {
      console.error("Failed to reject discount:", err);
      toast.error("Failed to reject discount", err.message);
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

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = 210;
    const marginL = 15;
    const marginR = pageW - 15;
    let y = 15;

    const checkNewPage = (needed: number) => {
      if (y + needed > 280) {
        pdf.addPage();
        y = 15;
      }
    };

    // ── Header ──
    pdf.setFontSize(18);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Guest Registration Form", pageW / 2, y, { align: "center" });
    y += 8;

    pdf.setDrawColor(241, 101, 34);
    pdf.setLineWidth(0.5);
    pdf.line(marginL, y, marginR, y);
    y += 8;

    // Booking info row
    pdf.setFontSize(9);
    pdf.setTextColor(80, 80, 80);
    pdf.text(`Booking: ${b.bookingRef}`, marginL, y);
    pdf.text(`Room: ${b.roomNumber} (${b.roomType})`, pageW / 2, y);
    y += 5;
    pdf.text(`Check-in: ${b.checkIn}  |  Check-out: ${b.checkOut}`, marginL, y);
    y += 5;
    pdf.text(`Guests: ${b.numGuests}  |  Nights: ${b.numNights}`, marginL, y);
    y += 8;

    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.2);
    pdf.line(marginL, y, marginR, y);
    y += 8;

    // ── Guest Information ──
    pdf.setFontSize(13);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Guest Information", marginL, y);
    y += 7;

    pdf.setFontSize(10);
    pdf.setTextColor(60, 60, 60);
    pdf.text(`Guest Name: ${b.guestName}`, 20, y); y += 5.5;
    pdf.text(`Email: ${b.guestEmail}`, 20, y); y += 5.5;
    pdf.text(`Phone: ${b.guestPhone}`, 20, y); y += 8;

    // ── Registration Details ──
    pdf.setFontSize(13);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Registration Details", marginL, y);
    y += 7;

    pdf.setFontSize(10);
    pdf.setTextColor(60, 60, 60);

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

    for (const [label, value] of regFields) {
      pdf.setFontSize(9);
      pdf.setTextColor(100, 100, 100);
      pdf.text(`${label}:`, 20, y);
      pdf.setFontSize(10);
      pdf.setTextColor(50, 50, 50);
      const displayValue = value.length > 55 ? value.substring(0, 52) + "..." : value;
      pdf.text(displayValue, 55, y);
      y += 5.5;
    }
    y += 3;

    // ── Guest ID Photo ──
    checkNewPage(70);
    pdf.setFontSize(13);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Government-Issued ID", marginL, y);
    y += 7;

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

        const maxW = (pageW - 40) / 2; // half page width
        const maxH = 50;
        const imgRatio = img.width / img.height;
        let drawW = maxW;
        let drawH = drawW / imgRatio;
        if (drawH > maxH) {
          drawH = maxH;
          drawW = drawH * imgRatio;
        }

        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.3);
        pdf.rect(20, y, drawW + 2, drawH + 2);
        pdf.addImage(base64, "JPEG", 21, y + 1, drawW, drawH);
        y += drawH + 4;
      } catch {
        // Failed to fetch image — show placeholder
        pdf.setDrawColor(200, 200, 200);
        pdf.setLineWidth(0.3);
        pdf.setLineDashPattern([3, 3], 0);
        pdf.rect(20, y, 80, 35);
        pdf.setLineDashPattern([], 0);
        pdf.setFontSize(9);
        pdf.setTextColor(150, 150, 150);
        pdf.text("Attach ID here", 40, y + 20);
        y += 37;
      }
    } else {
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.3);
      pdf.setLineDashPattern([3, 3], 0);
      pdf.rect(20, y, 80, 35);
      pdf.setLineDashPattern([], 0);
      pdf.setFontSize(9);
      pdf.setTextColor(150, 150, 150);
      pdf.text("Attach ID here", 40, y + 20);
      y += 37;
    }
    y += 5;

    // ── House Rules ──
    const houseRules = websiteContent?.houseRules;
    if (houseRules && houseRules.trim().length > 0) {
      checkNewPage(30);
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.2);
      pdf.line(marginL, y, marginR, y);
      y += 8;

      pdf.setFontSize(13);
      pdf.setTextColor(30, 30, 30);
      pdf.text("House Rules", marginL, y);
      y += 7;

      pdf.setFontSize(9);
      pdf.setTextColor(80, 80, 80);
      const rulesLines = pdf.splitTextToSize(houseRules, pageW - 40);
      for (const line of rulesLines) {
        checkNewPage(5);
        pdf.text(line, 20, y);
        y += 4.5;
      }
      y += 3;

      // Agreement checkbox
      pdf.setFontSize(9);
      pdf.setTextColor(60, 60, 60);
      pdf.setDrawColor(150, 150, 150);
      pdf.setLineWidth(0.2);
      pdf.rect(20, y - 3.5, 4, 4);
      pdf.text("I have read and agree to the house rules.", 27, y);
      y += 8;
    }

    // ── Signature ──
    checkNewPage(30);
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.2);
    pdf.line(marginL, y, marginR, y);
    y += 10;

    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text("Guest Signature", marginL, y - 2);
    pdf.setDrawColor(60, 60, 60);
    pdf.setLineWidth(0.3);
    pdf.line(marginL, y + 10, marginL + 80, y + 10);

    pdf.text("Date", marginL + 90, y - 2);
    pdf.line(marginL + 90, y + 10, marginL + 130, y + 10);
    y += 15;

    // ── Breakfast Selections ──
    if (b.hasBreakfast) {
      checkNewPage(50);

      pdf.setDrawColor(241, 101, 34);
      pdf.setLineWidth(0.5);
      pdf.line(marginL, y, marginR, y);
      y += 8;

      pdf.setFontSize(13);
      pdf.setTextColor(30, 30, 30);
      pdf.text("Breakfast Silog Selections", marginL, y);
      y += 5;
      pdf.setFontSize(8);
      pdf.setTextColor(120, 120, 120);
      pdf.text("Circle or check your choice for each guest per day.", marginL, y);
      y += 7;

      const stayDates = getStayDates(b);
      const activeSilogItems = breakfastConfig.silogItems.filter(
        (item: { id: string; name: string; isActive: boolean }) => item.isActive
      );

      if (activeSilogItems.length === 0) {
        pdf.setFontSize(10);
        pdf.setTextColor(150, 150, 150);
        pdf.text("No active silog items configured.", 20, y);
        y += 6;
      } else {
        const colW = Math.min(38, (pageW - 40) / (stayDates.length + 1));
        const startX = 20;
        const rowH = 10;

        // Header row
        pdf.setFillColor(241, 101, 34);
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(8);
        pdf.rect(startX, y, colW, rowH, "F");
        pdf.text("Guest", startX + 2, y + 6);

        let cx = startX + colW;
        for (const date of stayDates) {
          pdf.rect(cx, y, colW, rowH, "F");
          const d = new Date(date);
          const shortDate = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          pdf.text(shortDate, cx + 2, y + 6);
          cx += colW;
        }
        y += rowH;

        // Guest rows with checkbox options
        for (let g = 0; g < b.numGuests; g++) {
          checkNewPage(rowH + activeSilogItems.length * 4 + 5);

          if (g % 2 === 0) {
            pdf.setFillColor(248, 248, 248);
            pdf.rect(startX, y, colW + stayDates.length * colW, rowH, "F");
          }

          pdf.setFontSize(9);
          pdf.setTextColor(50, 50, 50);
          pdf.text(`Guest ${g + 1}`, startX + 2, y + 6);

          cx = startX + colW;
          for (const date of stayDates) {
            const key = `${date}-guest-${g + 1}`;
            const existingSelection = b.breakfastSelections?.[key];

            if (existingSelection) {
              // Already selected — show the choice with a checkmark
              pdf.setFontSize(8);
              pdf.setTextColor(30, 30, 30);
              pdf.text(`✓ ${existingSelection}`, cx + 2, y + 6);
            } else {
              // Not selected — show checkbox options
              let optionY = y + 4;
              for (let si = 0; si < activeSilogItems.length; si++) {
                const item = activeSilogItems[si];
                pdf.setDrawColor(150, 150, 150);
                pdf.setLineWidth(0.15);
                pdf.rect(cx + 2, optionY - 3, 3, 3);
                pdf.setFontSize(7);
                pdf.setTextColor(100, 100, 100);
                pdf.text(item.name, cx + 6, optionY);
                optionY += 3.5;
              }
            }
            cx += colW;
          }
          y += rowH;
        }

        y += 4;
        pdf.setFontSize(8);
        pdf.setTextColor(120, 120, 120);
        pdf.text("Available Items:", marginL, y);
        y += 4.5;
        const legendText = activeSilogItems
          .map((item: { name: string }) => item.name)
          .join("  •  ");
        pdf.setFontSize(8);
        pdf.setTextColor(150, 150, 150);
        pdf.text(legendText, marginL + 2, y);
      }
    }

    // ── Footer ──
    const footerY = 280;
    if (y > footerY - 10) {
      pdf.addPage();
      y = 15;
    }
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.2);
    pdf.line(marginL, footerY, marginR, footerY);
    pdf.setFontSize(7);
    pdf.setTextColor(160, 160, 160);
    pdf.text(
      `Generated by ${config.brandName} guest registration system — ${new Date().toISOString().split("T")[0]}`,
      pageW / 2,
      footerY + 6,
      { align: "center" }
    );
    pdf.text(`Booking Ref: ${b.bookingRef} | Room ${b.roomNumber}`, pageW / 2, footerY + 10, { align: "center" });

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const printBookingReceiptPDF = () => {
    if (!selectedBooking) return;
    const b = selectedBooking;

    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = 210;
    const marginL = 15;
    const marginR = pageW - 15;
    const labelColX = 20;
    const valueColX = 70;
    let y = 15;

    const checkNewPage = (needed: number) => {
      if (y + needed > 280) {
        pdf.addPage();
        y = 15;
      }
    };

    const formatAmount = (value: number) =>
      formatPrice(value).replace(/\u00A0/g, " ");

    // ── Header ──
    pdf.setFontSize(20);
    pdf.setTextColor(241, 101, 34);
    pdf.text(config.brandName, pageW / 2, y, { align: "center" });
    y += 7;

    pdf.setFontSize(16);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Booking Confirmation Receipt", pageW / 2, y, { align: "center" });
    y += 6;

    pdf.setDrawColor(241, 101, 34);
    pdf.setLineWidth(0.5);
    pdf.line(marginL, y, marginR, y);
    y += 6;

    // Booking ref + generated-on
    pdf.setFontSize(9);
    pdf.setTextColor(100, 100, 100);
    pdf.text(`Booking Reference: ${b.bookingRef}`, marginL, y);
    const generatedAt = new Date().toLocaleString("en-PH", {
      timeZone: config.timezone || "Asia/Manila",
      dateStyle: "medium",
      timeStyle: "short"
    });
    pdf.text(`Generated: ${generatedAt}`, marginR, y, { align: "right" });
    y += 8;

    // ── Guest Information ──
    pdf.setFontSize(12);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Guest Information", marginL, y);
    y += 6;

    pdf.setFontSize(10);
    pdf.setTextColor(50, 50, 50);
    pdf.text(`Name: ${b.guestName}`, labelColX, y); y += 5.5;
    pdf.text(`Email: ${b.guestEmail}`, labelColX, y); y += 5.5;
    pdf.text(`Phone: ${b.guestPhone}`, labelColX, y); y += 8;

    // ── Stay Information ──
    pdf.setFontSize(12);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Stay Information", marginL, y);
    y += 6;

    pdf.setFontSize(10);
    pdf.setTextColor(50, 50, 50);
    pdf.text(`Room: ${b.roomNumber} (${b.roomType})`, labelColX, y); y += 5.5;
    pdf.text(`Check-in: ${b.checkIn}`, labelColX, y); y += 5.5;
    pdf.text(`Check-out: ${b.checkOut}`, labelColX, y); y += 5.5;
    pdf.text(`Nights: ${b.numNights}    Guests: ${b.numGuests}`, labelColX, y); y += 5.5;
    pdf.text(`Rate per night: ${formatAmount(b.ratePerNight)}`, labelColX, y); y += 5.5;

    if (b.hasBreakfast && breakfastConfig.ratePerPersonPerNight) {
      pdf.text(
        `Includes breakfast: ${formatAmount(breakfastConfig.ratePerPersonPerNight)} / guest / night`,
        labelColX,
        y
      );
      y += 5.5;
    }
    y += 2;

    // ── Pricing Breakdown ──
    checkNewPage(60);
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.2);
    pdf.line(marginL, y, marginR, y);
    y += 6;

    pdf.setFontSize(12);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Pricing Breakdown", marginL, y);
    y += 6;

    const subtotal = b.ratePerNight * b.numNights;
    pdf.setFontSize(10);
    pdf.setTextColor(50, 50, 50);
    pdf.text(`Subtotal (${b.numNights} night${b.numNights === 1 ? "" : "s"} x ${formatAmount(b.ratePerNight)})`, labelColX, y);
    pdf.text(formatAmount(subtotal), marginR, y, { align: "right" });
    y += 5.5;

    // Senior / PWD discount
    if (b.discountPct && b.discountPct > 0 && b.discountType && b.discountType !== "none") {
      const discountLabel = b.discountType === "senior"
        ? "Senior Citizen Discount"
        : b.discountType === "pwd"
          ? "PWD Discount"
          : "Discount";
      const discountAmount = Math.round(subtotal * (b.discountPct / 100));
      pdf.text(`${discountLabel} (${b.discountPct}%)`, labelColX, y);
      pdf.text(`-${formatAmount(discountAmount)}`, marginR, y, { align: "right" });
      y += 5.5;
    }

    // Voucher
    if (b.voucherCode && b.voucherDiscount && b.voucherDiscount > 0) {
      pdf.text(`Voucher (${b.voucherCode})`, labelColX, y);
      pdf.text(`-${formatAmount(b.voucherDiscount)}`, marginR, y, { align: "right" });
      y += 5.5;
    }

    // Points redemption
    if (b.pointsRedeemed && b.pointsRedeemed > 0) {
      pdf.text(
        `Spark Rewards: ${b.pointsRedeemed} pts redeemed`,
        labelColX,
        y
      );
      pdf.text(
        `-${formatAmount(b.pointsRedeemedValue || 0)}`,
        marginR,
        y,
        { align: "right" }
      );
      y += 5.5;
    }

    // Total
    y += 2;
    pdf.setDrawColor(150, 150, 150);
    pdf.setLineWidth(0.3);
    pdf.line(marginL, y, marginR, y);
    y += 6;

    pdf.setFontSize(12);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Total", labelColX, y);
    pdf.text(formatAmount(b.totalPrice), marginR, y, { align: "right" });
    y += 8;

    // ── Special Requests / Notes ──
    if (b.specialRequests && b.specialRequests.trim().length > 0) {
      checkNewPage(20);
      pdf.setFontSize(12);
      pdf.setTextColor(30, 30, 30);
      pdf.text("Special Requests", marginL, y);
      y += 6;

      pdf.setFontSize(10);
      pdf.setTextColor(60, 60, 60);
      const reqLines = pdf.splitTextToSize(b.specialRequests, pageW - 40);
      for (const line of reqLines) {
        checkNewPage(5);
        pdf.text(line, labelColX, y);
        y += 4.5;
      }
      y += 4;
    }

    // ── Payment Breakdown ──
    checkNewPage(40);
    pdf.setDrawColor(241, 101, 34);
    pdf.setLineWidth(0.5);
    pdf.line(marginL, y, marginR, y);
    y += 6;

    pdf.setFontSize(12);
    pdf.setTextColor(30, 30, 30);
    pdf.text("Payments Collected", marginL, y);
    y += 6;

    const payments = selectedBookingPayments;
    if (payments.length > 0) {
      pdf.setFontSize(9);
      pdf.setTextColor(80, 80, 80);
      pdf.text("Date", labelColX, y);
      pdf.text("Method", labelColX + 40, y);
      pdf.text("Amount", marginR, y, { align: "right" });
      y += 2;
      pdf.setDrawColor(220, 220, 220);
      pdf.setLineWidth(0.15);
      pdf.line(marginL, y, marginR, y);
      y += 4;

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
        pdf.text(recordedDate, labelColX, y);
        pdf.text(pay.method || "—", labelColX + 40, y);
        pdf.text(formatAmount(pay.amount), marginR, y, { align: "right" });
        paymentsTotal += pay.amount;
        y += 5;
      });

      y += 1;
      pdf.setDrawColor(200, 200, 200);
      pdf.setLineWidth(0.2);
      pdf.line(marginL, y, marginR, y);
      y += 5;

      pdf.setFontSize(10);
      pdf.setTextColor(50, 50, 50);
      pdf.text("Total Collected", labelColX, y);
      pdf.text(formatAmount(paymentsTotal), marginR, y, { align: "right" });
      y += 5;

      const balance = b.totalPrice - paymentsTotal;
      pdf.setFontSize(11);
      if (balance <= 0) {
        pdf.setTextColor(34, 139, 34);
        pdf.text("Outstanding Balance", labelColX, y);
        pdf.text(formatAmount(0), marginR, y, { align: "right" });
        y += 6;
        pdf.setFontSize(9);
        pdf.setTextColor(80, 80, 80);
        pdf.text("Fully settled. Thank you.", labelColX, y);
      } else {
        pdf.setTextColor(200, 60, 60);
        pdf.text("Outstanding Balance", labelColX, y);
        pdf.text(formatAmount(balance), marginR, y, { align: "right" });
      }
      y += 8;
    } else {
      // No payments yet — show payment method + amount due
      pdf.setFontSize(10);
      pdf.setTextColor(50, 50, 50);
      const methodLabel = b.paymentMethod
        ? b.paymentMethod.charAt(0).toUpperCase() + b.paymentMethod.slice(1)
        : "—";
      pdf.text(`Payment Method: ${methodLabel}`, labelColX, y);
      y += 5.5;
      pdf.setFontSize(11);
      pdf.setTextColor(200, 60, 60);
      pdf.text("Amount Due", labelColX, y);
      pdf.text(formatAmount(b.totalPrice), marginR, y, { align: "right" });
      y += 8;
    }

    // ── Footer ──
    const footerY = 280;
    if (y > footerY - 20) {
      pdf.addPage();
      y = 15;
    }
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.2);
    pdf.line(marginL, footerY, marginR, footerY);
    pdf.setFontSize(8);
    pdf.setTextColor(120, 120, 120);
    pdf.text(
      "This is a booking confirmation only. An official BIR receipt will be issued upon payment at the property.",
      pageW / 2,
      footerY + 5,
      { align: "center" }
    );
    pdf.setFontSize(7);
    pdf.setTextColor(160, 160, 160);
    pdf.text(
      `${config.brandName} — ${config.address?.street ?? ""}${config.address?.street ? ", " : ""}${config.address?.city ?? ""} | ${config.frontDeskPhone ?? ""} | ${config.supportEmail ?? ""}`,
      pageW / 2,
      footerY + 10,
      { align: "center" }
    );
    pdf.text(
      `Generated by ${config.brandName} booking system — ${new Date().toISOString().split("T")[0]}`,
      pageW / 2,
      footerY + 14,
      { align: "center" }
    );

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
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
    const grandTotal = booking.totalPrice + storeTotal;
    return {
      storeCharges,
      storeTotal,
      paymentsTotal,
      grandTotal,
      balance: grandTotal - paymentsTotal
    };
  };

  const syncSelectedBooking = (updates: Partial<Booking>) => {
    if (!selectedBooking) return;
    updateBookingStatus(selectedBooking.id, selectedBooking.status, updates);
    setSelectedBooking(prev => prev ? { ...prev, ...updates } : null);
  };

  const handleGuestIdUpload = async (file: File | undefined) => {
    if (!file || !selectedBooking) return;

    try {
      setGuestIdUploadStatus("Compressing guest ID image...");
      const image = await compressImageFile(file, { maxWidth: 1400, maxHeight: 1400, quality: 0.84 });
      syncSelectedBooking({ guestIdPhotoUrl: image.dataUrl });
      setGuestIdUploadStatus(`ID image ready: ${Math.max(1, Math.round(image.compressedSize / 1024))} KB.`);
    } catch (error) {
      setGuestIdUploadStatus(error instanceof Error ? error.message : "Unable to process guest ID image.");
    }
  };

  const handleRegistrationSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    syncSelectedBooking({
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
    syncSelectedBooking({ breakfastSelections: selections });
  };

  const handleAddPaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBooking && paymentAmount) {
      const amount = parseFloat(paymentAmount);
      try {
        const result = await addOnsitePayment(selectedBooking.id, amount, paymentMethod, paymentNote);
        if (result.success) {
          setPaymentAmount("");
          setPaymentNote("");
          toast.success("Payment recorded", `${formatPrice(amount)} via ${paymentMethod.toUpperCase()}`);
        } else {
          toast.error("Failed to record payment", result.error);
        }
      } catch (err: any) {
        toast.error("Failed to record payment", err.message);
      }
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
        guestEmail: guestEmail || "walkin@guest.com",
        guestPhone: guestPhone || "n/a",
        numGuests,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        numNights,
        ratePerNight,
        totalPrice: priceOverride !== "" ? Number(priceOverride) : totalPrice,
        totalPriceOverride: priceOverride !== "" ? Number(priceOverride) : undefined,
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
        specialRequests: "Walk-in registration.",
        status: immediateCheckIn ? "checked-in" : "confirmed",
        paymentMethod: walkinPayment,
        paymentProofUrl: "",
        source: "walk-in",
        notes: "Created on-site at Front Desk.",
        memberId: null,
        pointsRedeemed: 0,
        pointsRedeemedValue: 0,
        pointsRedeemedBy: null,
        pointsRedeemedAt: null,
        hasBreakfast,
        breakfastRate: hasBreakfast ? (breakfastConfig.ratePerPersonPerNight || 300) : 0,
        guestIdPhotoUrl: null,
        handledBy: "frontdesk-staff",
        cancellationReason: ""
      });

      if (result.success) {
        setGuestName("");
        setGuestEmail("");
        setGuestPhone("");
        setRoomNumber("");
        setPriceOverride("");
        setHasBreakfast(false);
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
                    <div className="flex h-32 w-full items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                      {selectedBooking.guestIdPhotoUrl ? (
                        <img src={selectedBooking.guestIdPhotoUrl} alt="Guest ID preview" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon size={22} className="text-gray-400" />
                      )}
                    </div>
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
              </div>
            </div>

            {/* Financial totals */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Financial Breakdown</h3>
              <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-2 text-xs">
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
                      <img
                        src={selectedBooking.discountIdPhotoUrl}
                        alt={`${selectedBooking.discountType} ID`}
                        className="w-full h-auto max-h-40 object-cover cursor-pointer hover:opacity-90"
                        onClick={() => window.open(selectedBooking.discountIdPhotoUrl ?? "", "_blank")}
                      />
                      <p className="text-[9px] text-center text-gray-400 py-1 bg-gray-50 border-t border-gray-150">
                        Click image to open in new tab
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

            {/* Onsite payments ledger */}
            <div className="space-y-3.5">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">On-site Payments Ledger</h3>
              
              <div className="space-y-2">
                {selectedBookingPayments.length > 0 ? (
                  <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                    {selectedBookingPayments.map((pay) => (
                      <div key={pay.id} className="pt-2 first:pt-0 flex justify-between items-center text-xs">
                        <div>
                          <p className="font-semibold text-gray-800">{pay.note || "Onsite Payment"}</p>
                          <p className="text-[9px] text-gray-400">{pay.recordedAt.split("T")[0]} via {pay.method.toUpperCase()}</p>
                        </div>
                        <span className="font-bold text-green-700">+{formatPrice(pay.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 italic">No onsite payments recorded yet.</p>
                )}

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
                        className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                      />
                    </label>
                    
                    <label className="flex flex-col gap-2 text-[10px] font-semibold text-gray-500">
                      Payment Method
                      <select
                        value={paymentMethod}
                        onChange={(e) => setPaymentMethod(e.target.value)}
                        className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Credit Card</option>
                        <option value="gcash">GCash Transfer</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-2 text-[10px] font-semibold text-gray-500">
                      Payment Reference / Note
                      <input
                        type="text"
                        value={paymentNote}
                        onChange={(e) => setPaymentNote(e.target.value)}
                        placeholder="e.g. Downpayment deposit"
                        className="min-h-[38px] w-full rounded border border-gray-200 px-2 text-xs"
                      />
                    </label>
                  
                    <button
                      type="submit"
                      className="min-h-[38px] self-end rounded-lg bg-primary px-4 text-xs font-bold text-white shadow-sm hover:bg-primary-dark"
                    >
                      Log Payment
                    </button>
                  </div>
                </form>
              </div>
            </div>

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
                            const baseUrl = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
                              ? "http://localhost:3000"
                              : import.meta.env.VITE_GUEST_APP_URL || "";
                            const params = new URLSearchParams({
                              bookingRef: selectedBooking.bookingRef,
                              roomId: selectedBooking.roomId,
                              checkIn: selectedBooking.checkIn,
                              checkOut: selectedBooking.checkOut,
                              guests: String(selectedBooking.numGuests),
                              paymentMethod: selectedBooking.paymentMethod,
                              total: String(selectedBooking.totalPrice)
                            });
                            window.open(`${baseUrl.replace(/\/$/, "")}/book/confirm?${params.toString()}`, "_blank");
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
              {(selectedBooking.status === "pending" || selectedBooking.status === "payment-uploaded") && (
                <button
                  onClick={() => handleStatusTransition("confirmed")}
                  className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-green-600 hover:bg-green-700 text-xs font-bold text-white shadow-sm transition active:scale-95"
                >
                  Confirm Payment & Booking
                </button>
              )}

              {(selectedBooking.status === "confirmed" || selectedBooking.status === "payment-confirmed") && (
                <button
                  onClick={() => handleStatusTransition("checked-in")}
                  className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm transition active:scale-95"
                >
                  Verify Guest ID & Check In
                </button>
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

            {/* GCash screenshot mock proof */}
            {selectedOrder.paymentMethod === "gcash" && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">GCash Proof of Remittance</h3>
                <div className="rounded-lg border border-gray-200 p-4 bg-gray-100 flex flex-col items-center justify-center gap-2">
                  <div className="h-44 w-32 rounded bg-blue-650/10 border border-blue-600/30 flex items-center justify-center text-blue-600 text-xs font-bold font-mono shadow-inner">
                    RECEIPT SCREENSHOT
                  </div>
                  <span className="text-[10px] text-gray-400">Mock receipt confirmation verified</span>
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
                  onClick={() => {
                    void updateStoreOrderStatus(selectedOrder.id, "delivered");
                    setSelectedOrder((prev: any) => prev ? { ...prev, status: "delivered" } : null);
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
      >
        <form onSubmit={handleWalkinSubmit} className="space-y-5 text-sm">
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>

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

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
              Room Type
              <select
                value={roomType}
                onChange={(e) => {
                  setRoomType(e.target.value);
                  // Automatically trigger selection of first available room in next list
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
                    <option key={r.id} value={r.roomNumber}>Room {r.roomNumber} (₱{r.pricePerNight}/night)</option>
                  ))
                ) : (
                  <option value="" disabled>No vacant rooms available</option>
                )}
              </select>
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
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
          </div>

          <div className="grid gap-4 sm:grid-cols-2 items-center pt-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={hasBreakfast}
                onChange={(e) => setHasBreakfast(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary-light"
              />
              Include Daily Breakfast (+₱{breakfastConfig.ratePerPersonPerNight || 300}/guest/night)
            </label>

            <label className="flex items-center gap-2 text-xs font-semibold text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={immediateCheckIn}
                onChange={(e) => setImmediateCheckIn(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary-light"
              />
              Check-In Guest Immediately
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
              <span>{formatPrice(ratePerNight * numNights)}</span>
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

          {/* Action Row */}
          <div className="flex gap-3 pt-2 justify-end">
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="min-h-[44px] px-5 rounded-lg border border-gray-250 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <PrimaryButton
              type="submit"
              disabled={!roomNumber || isWalkinSubmitting}
              className="min-w-[150px]"
            >
              {isWalkinSubmitting ? "Confirming..." : "Confirm Reservation"}
            </PrimaryButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
