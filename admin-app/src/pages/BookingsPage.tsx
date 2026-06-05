import { useState } from "react";
import { useAdmin, Booking, Room } from "../context/AdminContext";
import { DataTable, DataTableColumn } from "../components/DataTable";
import { Drawer } from "../components/Drawer";
import { Modal } from "../components/Modal";
import { StatusBadge } from "../components/StatusBadge";
import { PrimaryButton } from "../components/PrimaryButton";
import { formatPrice } from "../utils/format";
import { Calendar, User, Phone, Mail, DollarSign, Plus, Eye, CheckCircle2, ShieldAlert, ShoppingBag, Clock, Package, CreditCard } from "lucide-react";
import config from "@config";

export function BookingsPage() {
  const { 
    bookings, 
    rooms, 
    updateBookingStatus, 
    addOnsitePayment, 
    addWalkinBooking,
    storeOrders,
    updateStoreOrderStatus,
    billStoreOrder
  } = useAdmin();

  // Main navigation tab
  const [activeMainTab, setActiveMainTab] = useState<"bookings" | "store">("bookings");

  // Booking Search and Filter States
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Booking Drawer States
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Store Order Search and Filter States
  const [orderSearchText, setOrderSearchText] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<string>("all");

  // Store Order Drawer States
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null);
  const [isOrderDrawerOpen, setIsOrderDrawerOpen] = useState(false);

  // Payment Form States
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentNote, setPaymentNote] = useState("");

  // Modal States
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Walk-in Form States
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [roomType, setRoomType] = useState<string>(config.roomTypes[0].value);
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
  const totalPrice = ratePerNight * numNights + (hasBreakfast ? 300 * numGuests * numNights : 0);

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

  // Filtering Rows logic
  const filteredRows = bookings.filter((booking) => {
    const matchesSearch = 
      booking.guestName.toLowerCase().includes(searchText.toLowerCase()) ||
      booking.bookingRef.toLowerCase().includes(searchText.toLowerCase()) ||
      booking.roomNumber.includes(searchText);

    const matchesStatus = statusFilter === "all" || booking.status === statusFilter;

    return matchesSearch && matchesStatus;
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
      // Update selected booking details in drawer local state
      setSelectedBooking(prev => prev ? { ...prev, status } : null);
    }
  };

  const handleAddPaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedBooking && paymentAmount) {
      const amount = parseFloat(paymentAmount);
      addOnsitePayment(selectedBooking.id, amount, paymentMethod, paymentNote);
      // Sync local state
      const nextPayments = selectedBooking.onsitePayments || [];
      setSelectedBooking({
        ...selectedBooking,
        onsitePayments: [
          ...nextPayments,
          {
            id: `pay-${Date.now()}`,
            amount,
            method: paymentMethod,
            note: paymentNote,
            recordedBy: "admin-staff",
            recordedAt: new Date().toISOString()
          }
        ]
      });
      setPaymentAmount("");
      setPaymentNote("");
      alert("Payment recorded successfully.");
    }
  };

  const handleWalkinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName || !roomNumber) {
      alert("Please fill in the guest name and select an available room.");
      return;
    }

    addWalkinBooking({
      roomId: rooms.find(r => r.roomNumber === roomNumber)?.id || "",
      roomNumber,
      roomType,
      guestName,
      guestEmail: guestEmail || "walkin@guest.com",
      guestPhone: guestPhone || "n/a",
      numGuests,
      checkIn: checkInDate,
      checkOut: checkOutDate,
      numNights,
      ratePerNight,
      totalPrice,
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
      breakfastRate: hasBreakfast ? 300 : 0,
      guestIdPhotoUrl: null,
      handledBy: "frontdesk-staff",
      cancellationReason: ""
    });

    // Reset Form & Close Modal
    setGuestName("");
    setGuestEmail("");
    setGuestPhone("");
    setRoomNumber("");
    setHasBreakfast(false);
    setIsModalOpen(false);
    alert("Walk-in booking created successfully!");
  };

  return (
    <div className="space-y-8 font-body">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase font-medium">bookings & store orders</h1>
          <p className="text-xs text-gray-500 mt-1">Review active room check-ins, record onsite charges, and process walk-ins and minibar deliveries.</p>
        </div>
        {activeMainTab === "bookings" && (
          <button
            onClick={() => {
              // Auto select first available room if none selected
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
          <div className="rounded-card bg-white p-4.5 shadow-sm ring-1 ring-gray-200 flex flex-col sm:flex-row gap-4">
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
          />
        </>
      ) : (
        <>
          {/* Filters Toolbar Store Orders */}
          <div className="rounded-card bg-white p-4.5 shadow-sm ring-1 ring-gray-200 flex flex-col sm:flex-row gap-4">
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
          />
        </>
      )}

      {/* Booking Detail Drawer (D-01) */}
      <Drawer
        title={selectedBooking ? `Reference: ${selectedBooking.bookingRef}` : ""}
        open={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
      >
        {selectedBooking && (
          <div className="space-y-8 text-sm">
            {/* Status overview */}
            <div className="flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
              <div>
                <p className="text-[10px] uppercase font-bold text-gray-400">Current Status</p>
                <div className="mt-1">
                  <StatusBadge label={selectedBooking.status.replace("-", " ")} status={selectedBooking.status} />
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold text-gray-400 text-right">Channel</p>
                <p className="text-xs font-bold text-gray-900 mt-1 uppercase text-right">{selectedBooking.source}</p>
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

            {/* Room stay details */}
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Stay & Accommodation</h3>
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
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
              <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span>Room Charge ({selectedBooking.numNights} nights)</span>
                  <span>{formatPrice(selectedBooking.ratePerNight * selectedBooking.numNights)}</span>
                </div>
                {selectedBooking.hasBreakfast && (
                  <div className="flex justify-between text-gray-500">
                    <span>Breakfast Service charge</span>
                    <span>{formatPrice(300 * selectedBooking.numGuests * selectedBooking.numNights)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-gray-150 pt-2.5 text-sm font-bold text-gray-950">
                  <span>Total Bill Amount:</span>
                  <span className="text-primary-dark">{formatPrice(selectedBooking.totalPrice)}</span>
                </div>
              </div>
            </div>

            {/* Onsite payments ledger */}
            <div className="space-y-3.5">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">On-site Payments Ledger</h3>
              
              <div className="space-y-2">
                {(selectedBooking.onsitePayments || []).length > 0 ? (
                  <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50/50">
                    {(selectedBooking.onsitePayments || []).map((pay) => (
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
                  
                  <div className="grid gap-3 grid-cols-2">
                    <label className="grid gap-1.5 text-[10px] font-semibold text-gray-500">
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
                    
                    <label className="grid gap-1.5 text-[10px] font-semibold text-gray-500">
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
                  </div>

                  <label className="grid gap-1.5 text-[10px] font-semibold text-gray-500">
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
                    className="min-h-[36px] w-full rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm"
                  >
                    Log Payment
                  </button>
                </form>
              </div>
            </div>

            {/* Allowed transitions buttons */}
            <div className="pt-4 border-t border-gray-150 flex flex-col gap-2">
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
                  onClick={() => handleStatusTransition("checked-out")}
                  className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-gray-900 hover:bg-black text-xs font-bold text-white shadow-sm transition active:scale-95"
                >
                  Check Out Room Folio
                </button>
              )}

              {selectedBooking.status !== "checked-out" && selectedBooking.status !== "cancelled" && (
                <button
                  onClick={() => {
                    const reason = prompt("Enter cancellation reason:");
                    if (reason !== null) {
                      updateBookingStatus(selectedBooking.id, "cancelled", { cancellationReason: reason });
                      setSelectedBooking(prev => prev ? { ...prev, status: "cancelled", cancellationReason: reason } : null);
                    }
                  }}
                  className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-xs font-bold text-red-600 transition"
                >
                  Cancel Booking
                </button>
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
                <>
                  <button
                    onClick={() => {
                      updateStoreOrderStatus(selectedOrder.id, "confirmed");
                      setSelectedOrder((prev: any) => prev ? { ...prev, status: "confirmed" } : null);
                    }}
                    className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-green-600 hover:bg-green-700 text-xs font-bold text-white shadow-sm transition active:scale-95"
                  >
                    Confirm & Prepare Order
                  </button>
                  
                  <button
                    onClick={() => {
                      const reason = prompt("Enter cancellation reason:");
                      if (reason !== null) {
                        updateStoreOrderStatus(selectedOrder.id, "cancelled");
                        setSelectedOrder((prev: any) => prev ? { ...prev, status: "cancelled", cancellationReason: reason } : null);
                      }
                    }}
                    className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-xs font-bold text-red-600 transition"
                  >
                    Cancel Order
                  </button>
                </>
              )}

              {selectedOrder.status === "confirmed" && (
                <>
                  <button
                    onClick={() => {
                      updateStoreOrderStatus(selectedOrder.id, "out-for-delivery");
                      setSelectedOrder((prev: any) => prev ? { ...prev, status: "out-for-delivery" } : null);
                    }}
                    className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-primary hover:bg-primary-dark text-xs font-bold text-white shadow-sm transition active:scale-95"
                  >
                    Dispatch Out for Delivery
                  </button>
                  
                  <button
                    onClick={() => {
                      const reason = prompt("Enter cancellation reason:");
                      if (reason !== null) {
                        updateStoreOrderStatus(selectedOrder.id, "cancelled");
                        setSelectedOrder((prev: any) => prev ? { ...prev, status: "cancelled", cancellationReason: reason } : null);
                      }
                    }}
                    className="min-h-[44px] w-full inline-flex items-center justify-center rounded-lg bg-red-50 hover:bg-red-100 text-xs font-bold text-red-650 transition"
                  >
                    Cancel Order
                  </button>
                </>
              )}

              {selectedOrder.status === "out-for-delivery" && (
                <button
                  onClick={() => {
                    updateStoreOrderStatus(selectedOrder.id, "delivered");
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
                    billStoreOrder(selectedOrder.id);
                    setSelectedOrder((prev: any) => prev ? { ...prev, isBilled: true, billedAt: new Date().toISOString() } : null);
                    alert("Order amount added to guest's room bill successfully.");
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
            <label className="grid gap-2 text-xs font-semibold text-gray-700">
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

            <label className="grid gap-2 text-xs font-semibold text-gray-700">
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

          <label className="grid gap-2 text-xs font-semibold text-gray-700">
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
            <label className="grid gap-2 text-xs font-semibold text-gray-700">
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
                {config.roomTypes.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-2 text-xs font-semibold text-gray-700">
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
            <label className="grid gap-2 text-xs font-semibold text-gray-700">
              Check-In Date
              <input
                type="date"
                required
                value={checkInDate}
                onChange={(e) => setCheckInDate(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-gray-255 bg-white py-2 px-3 text-xs"
              />
            </label>

            <label className="grid gap-2 text-xs font-semibold text-gray-700">
              Check-Out Date
              <input
                type="date"
                required
                value={checkOutDate}
                onChange={(e) => setCheckOutDate(e.target.value)}
                className="min-h-[44px] w-full rounded-lg border border-gray-255 bg-white py-2 px-3 text-xs"
              />
            </label>

            <label className="grid gap-2 text-xs font-semibold text-gray-700">
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
              Include Daily Breakfast (+₱300/guest/night)
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

          <label className="grid gap-2 text-xs font-semibold text-gray-700">
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
                <span>{formatPrice(300 * numGuests * numNights)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-gray-150 pt-2 text-sm font-bold text-primary-dark">
              <span>Total calculated:</span>
              <span>{formatPrice(totalPrice)}</span>
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
              disabled={!roomNumber}
              className="min-w-[150px]"
            >
              Confirm Reservation
            </PrimaryButton>
          </div>
        </form>
      </Modal>
    </div>
  );
}
