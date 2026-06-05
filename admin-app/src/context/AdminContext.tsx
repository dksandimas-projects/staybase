import React, { createContext, useContext, useState, ReactNode } from "react";
import config from "@config";

// Interfaces aligning with plan/docs/TYPES.md
export interface Room {
  id: string;
  name: string;
  roomNumber: string;
  type: string;
  description: string;
  maxCapacity: number;
  bedDefinition: string;
  pricePerNight: number;
  weekendRate: number;
  corporateRate: number;
  amenities: string[];
  imageUrls: string[];
  isActive: boolean;
  status: "available" | "occupied" | "blocked";
  housekeepingStatus: "clean" | "dirty" | "in-progress";
  blockReason: string;
  remarks: string;
}

export interface OnsitePayment {
  id: string;
  amount: number;
  method: string;
  note: string;
  recordedBy: string;
  recordedAt: string;
}

export interface Booking {
  id: string;
  bookingRef: string;
  roomId: string;
  roomNumber: string;
  roomType: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  numGuests: number;
  checkIn: string;
  checkOut: string;
  numNights: number;
  ratePerNight: number;
  totalPrice: number;
  originalTotalPrice: number | null;
  discountType: string;
  discountPct: number;
  discountIdPhotoUrl: string | null;
  discountVerified: boolean;
  discountVerifiedBy: string | null;
  discountRejected: boolean;
  discountRejectedBy: string | null;
  discountRejectionReason: string;
  voucherCode: string;
  voucherDiscount: number;
  isCorporate: boolean;
  corporateCode: string;
  companyName: string;
  specialRequests: string;
  status: "pending" | "payment-uploaded" | "payment-confirmed" | "confirmed" | "checked-in" | "checked-out" | "cancelled";
  paymentMethod: string;
  paymentProofUrl: string;
  source: "online" | "walk-in" | "phone" | "facebook" | "corporate";
  notes: string;
  memberId: string | null;
  pointsRedeemed: number;
  pointsRedeemedValue: number;
  pointsRedeemedBy: string | null;
  pointsRedeemedAt: string | null;
  hasBreakfast: boolean;
  breakfastRate: number;
  guestIdPhotoUrl: string | null;
  handledBy: string;
  cancellationReason: string;
  createdAt: string;
  onsitePayments?: OnsitePayment[];
}

export interface PointsLog {
  id: string;
  type: "earn" | "redeem" | "manual" | "expire";
  points: number;
  description: string;
  reason: string;
  bookingId: string | null;
  by: string;
  at: string;
}

export interface Member {
  id: string;
  memberNumber: string;
  fullName: string;
  email: string;
  phone: string;
  photoUrl: string;
  authProvider: "google" | "email";
  isMember: boolean;
  memberSince: string;
  rewardsPoints: number;
  tier: "standard" | "silver" | "gold";
  isActive: boolean;
  pointsHistory: PointsLog[];
}

export interface Voucher {
  id: string;
  code: string;
  discountType: "percent" | "flat";
  discountValue: number;
  usageCap: number | null;
  usageCount: number;
  expiresAt: string | null;
  applicableRoomTypes: string[];
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

export interface CorporateCode {
  code: string;
  companyName: string;
  ratePerRoomType: Record<string, number>;
  expiresAt: string | null;
  usageCap: number | null;
  usageCount: number;
  linkedInquiryId: string;
  createdBy: string;
  createdAt: string;
  isActive: boolean;
}

export interface InquiryNote {
  text: string;
  by: string;
  at: string;
}

export interface CorporateInquiry {
  id: string;
  companyName: string;
  contactPerson: string;
  email: string;
  phone: string;
  numRooms: number;
  preferredDates: { from: string; to: string };
  specialRequirements: string;
  status: "new" | "contacted" | "negotiating" | "converted" | "declined";
  handler: string;
  notes: InquiryNote[];
  accessCodeId: string;
  createdAt: string;
}

export interface IntercomMessage {
  id: string;
  text: string;
  sender: "guest" | "front-desk";
  guestName: string;
  timestamp: string;
  isRead: boolean;
  isQuickRequest: boolean;
  isStoreOrder: boolean;
  orderRef?: string;
}

export interface StoreOrderItem {
  itemId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface StoreOrder {
  id: string;
  orderRef: string;
  roomId: string;
  roomNumber: string;
  bookingId: string | null;
  guestName: string;
  items: StoreOrderItem[];
  totalAmount: number;
  paymentMethod: "cod" | "add-to-bill" | "gcash";
  paymentProofUrl: string;
  status: "placed" | "confirmed" | "out-for-delivery" | "delivered" | "cancelled";
  isBilled: boolean;
  billedAt: string | null;
  cancellationReason: string;
  handledBy: string;
  notes: string;
  createdAt: string;
}

export interface AdminContextType {
  // Authentication
  currentUser: { email: string; role: "front-desk" | "admin" } | null;
  signIn: (email: string, role: "front-desk" | "admin") => void;
  signOut: () => void;

  // Rooms
  rooms: Room[];
  toggleHousekeepingStatus: (roomId: string) => void;
  updateRoomConfig: (roomId: string, updates: Partial<Room>) => void;
  addRoomBlock: (roomId: string, dates: { from: string; to: string }, reason: string) => void;

  // Bookings
  bookings: Booking[];
  updateBookingStatus: (bookingId: string, status: Booking["status"], details?: Partial<Booking>) => void;
  addOnsitePayment: (bookingId: string, amount: number, method: string, note: string) => void;
  addWalkinBooking: (booking: Omit<Booking, "id" | "bookingRef" | "createdAt">) => void;

  // Vouchers & Corporate Rates
  vouchers: Voucher[];
  addVoucher: (voucher: Omit<Voucher, "id" | "createdAt" | "usageCount">) => void;
  toggleVoucherActive: (voucherId: string) => void;
  corporateCodes: CorporateCode[];
  addCorporateCode: (code: CorporateCode) => void;

  // Corporate Inquiries
  corporateInquiries: CorporateInquiry[];
  updateInquiryStatus: (inquiryId: string, status: CorporateInquiry["status"]) => void;
  addInquiryNote: (inquiryId: string, text: string) => void;

  // Members
  members: Member[];
  updateMemberPoints: (memberId: string, amount: number, type: PointsLog["type"], reason: string) => void;
  toggleMemberActive: (memberId: string) => void;

  // Intercom Inbox
  intercoms: Record<string, IntercomMessage[]>;
  sendIntercomMessage: (roomId: string, text: string, sender?: "guest" | "front-desk") => void;
  markChatAsRead: (roomId: string) => void;
  incomingCall: { roomId: string; guestName: string; status: "ringing" | "active" | "ended" } | null;
  triggerIncomingCall: (roomId: string, guestName: string) => void;
  acceptCall: () => void;
  declineCall: () => void;

  // Store Orders
  storeOrders: StoreOrder[];
  updateStoreOrderStatus: (orderId: string, status: StoreOrder["status"]) => void;
  billStoreOrder: (orderId: string) => void;

  // Configurations
  hotelConfig: any;
  websiteContent: any;
  rewardsConfig: any;
  breakfastConfig: any;
  storeConfig: any;
  updateSettings: (section: "hotelConfig" | "websiteContent" | "rewardsConfig" | "breakfastConfig" | "storeConfig", data: any) => void;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

export function AdminProvider({ children }: { children: ReactNode }) {
  // Auth State
  const [currentUser, setCurrentUser] = useState<AdminContextType["currentUser"]>(() => {
    const authState = sessionStorage.getItem("sim_admin_auth_state");
    const role = sessionStorage.getItem("sim_admin_role") as "front-desk" | "admin";
    const email = sessionStorage.getItem("sim_admin_email") || "";
    if (authState === "logged-in" && role) {
      return { email, role };
    }
    return null;
  });

  const signIn = (email: string, role: "front-desk" | "admin") => {
    sessionStorage.setItem("sim_admin_auth_state", "logged-in");
    sessionStorage.setItem("sim_admin_role", role);
    sessionStorage.setItem("sim_admin_email", email);
    setCurrentUser({ email, role });
  };

  const signOut = () => {
    sessionStorage.removeItem("sim_admin_auth_state");
    sessionStorage.removeItem("sim_admin_role");
    sessionStorage.removeItem("sim_admin_email");
    setCurrentUser(null);
  };

  // Rooms Data State
  const [rooms, setRooms] = useState<Room[]>([
    {
      id: "rm-101",
      name: "Standard Double 101",
      roomNumber: "101",
      type: "standard-double",
      description: "Comfortable standard room on first floor.",
      maxCapacity: 2,
      bedDefinition: "1 Double Bed",
      pricePerNight: 3200,
      weekendRate: 3700,
      corporateRate: 2880,
      amenities: ["TV", "Wifi", "AC", "Hot Shower"],
      imageUrls: [],
      isActive: true,
      status: "available",
      housekeepingStatus: "clean",
      blockReason: "",
      remarks: ""
    },
    {
      id: "rm-102",
      name: "Family Suite 102",
      roomNumber: "102",
      type: "family",
      description: "Spacious pool access room for family stays.",
      maxCapacity: 4,
      bedDefinition: "2 Queen Beds",
      pricePerNight: 7500,
      weekendRate: 8500,
      corporateRate: 6750,
      amenities: ["TV", "Wifi", "AC", "Hot Shower", "Mini Fridge", "Pool Access"],
      imageUrls: [],
      isActive: true,
      status: "occupied", // matches stay history in My Stays
      housekeepingStatus: "clean",
      blockReason: "",
      remarks: "Requested vegetarian breakfast options"
    },
    {
      id: "rm-201",
      name: "Standard Twin 201",
      roomNumber: "201",
      type: "standard-twin",
      description: "Cozy standard room with twin beds.",
      maxCapacity: 2,
      bedDefinition: "2 Single Beds",
      pricePerNight: 3200,
      weekendRate: 3700,
      corporateRate: 2880,
      amenities: ["TV", "Wifi", "AC", "Hot Shower"],
      imageUrls: [],
      isActive: true,
      status: "available",
      housekeepingStatus: "dirty",
      blockReason: "",
      remarks: ""
    },
    {
      id: "rm-305",
      name: "Executive Suite 305",
      roomNumber: "305",
      type: "executive",
      description: "Luxury suite overlooking the river.",
      maxCapacity: 2,
      bedDefinition: "1 King Bed",
      pricePerNight: 4500,
      weekendRate: 5000,
      corporateRate: 4050,
      amenities: ["TV", "Wifi", "AC", "Hot Shower", "Balcony", "Coffee Maker"],
      imageUrls: [],
      isActive: true,
      status: "occupied", // Confirmed stay in stays page
      housekeepingStatus: "clean",
      blockReason: "",
      remarks: "High floor requested"
    },
    {
      id: "rm-401",
      name: "Sky Loft 401",
      roomNumber: "401",
      type: "single",
      description: "Top floor penthouse layout.",
      maxCapacity: 2,
      bedDefinition: "1 Queen Bed",
      pricePerNight: 5500,
      weekendRate: 6200,
      corporateRate: 4950,
      amenities: ["TV", "Wifi", "AC", "Hot Shower", "Mini Bar", "Bath Tub"],
      imageUrls: [],
      isActive: true,
      status: "available",
      housekeepingStatus: "clean",
      blockReason: "",
      remarks: ""
    }
  ]);

  const toggleHousekeepingStatus = (roomId: string) => {
    setRooms(prev => prev.map(rm => {
      if (rm.id === roomId) {
        const nextHK: Room["housekeepingStatus"] = rm.housekeepingStatus === "clean" ? "dirty" : "clean";
        return { ...rm, housekeepingStatus: nextHK };
      }
      return rm;
    }));
  };

  const updateRoomConfig = (roomId: string, updates: Partial<Room>) => {
    setRooms(prev => prev.map(rm => rm.id === roomId ? { ...rm, ...updates } : rm));
  };

  const addRoomBlock = (roomId: string, dates: { from: string; to: string }, reason: string) => {
    setRooms(prev => prev.map(rm => {
      if (rm.id === roomId) {
        return {
          ...rm,
          status: "blocked",
          blockReason: `${reason} (${dates.from} to ${dates.to})`
        };
      }
      return rm;
    }));
  };

  // Bookings Data State
  const [bookings, setBookings] = useState<Booking[]>([
    {
      id: "bk-1",
      bookingRef: "SI-20260612-042",
      roomId: "rm-101",
      roomNumber: "101",
      roomType: "standard-double",
      guestName: "Maria Santos",
      guestEmail: "maria@example.com",
      guestPhone: "+63 917 000 0000",
      numGuests: 2,
      checkIn: "2026-06-12",
      checkOut: "2026-06-14",
      numNights: 2,
      ratePerNight: 3200,
      totalPrice: 6400,
      originalTotalPrice: 6400,
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
      specialRequests: "Late check-in around 8 PM, please.",
      status: "pending",
      paymentMethod: "gcash",
      paymentProofUrl: "payment-proof-mock.png",
      source: "online",
      notes: "Awaiting payment verification.",
      memberId: null,
      pointsRedeemed: 0,
      pointsRedeemedValue: 0,
      pointsRedeemedBy: null,
      pointsRedeemedAt: null,
      hasBreakfast: false,
      breakfastRate: 0,
      guestIdPhotoUrl: null,
      handledBy: "",
      cancellationReason: "",
      createdAt: "2026-06-02",
      onsitePayments: []
    },
    {
      id: "bk-2",
      bookingRef: "SI-09214",
      roomId: "rm-305",
      roomNumber: "305",
      roomType: "executive",
      guestName: "Alex Mercer",
      guestEmail: "member@sparkinn.com",
      guestPhone: "+63 912 345 6789",
      numGuests: 2,
      checkIn: "2026-10-12",
      checkOut: "2026-10-15",
      numNights: 3,
      ratePerNight: 4500,
      totalPrice: 13500,
      originalTotalPrice: 13500,
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
      specialRequests: "High floor, quiet room please.",
      status: "confirmed",
      paymentMethod: "bank",
      paymentProofUrl: "",
      source: "online",
      notes: "Member booking.",
      memberId: "mem-42",
      pointsRedeemed: 0,
      pointsRedeemedValue: 0,
      pointsRedeemedBy: null,
      pointsRedeemedAt: null,
      hasBreakfast: true,
      breakfastRate: 300,
      guestIdPhotoUrl: null,
      handledBy: "",
      cancellationReason: "",
      createdAt: "2026-06-02",
      onsitePayments: []
    },
    {
      id: "bk-3",
      bookingRef: "SI-08103",
      roomId: "rm-102",
      roomNumber: "102",
      roomType: "family",
      guestName: "Alex Mercer",
      guestEmail: "member@sparkinn.com",
      guestPhone: "+63 912 345 6789",
      numGuests: 4,
      checkIn: "2025-08-05",
      checkOut: "2025-08-09",
      numNights: 4,
      ratePerNight: 7500,
      totalPrice: 30000,
      originalTotalPrice: 30000,
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
      specialRequests: "Vegetarian breakfast options.",
      status: "checked-out",
      paymentMethod: "gcash",
      paymentProofUrl: "payment-proof-mock2.png",
      source: "online",
      notes: "Checked out successfully.",
      memberId: "mem-42",
      pointsRedeemed: 0,
      pointsRedeemedValue: 0,
      pointsRedeemedBy: null,
      pointsRedeemedAt: null,
      hasBreakfast: true,
      breakfastRate: 300,
      guestIdPhotoUrl: "guest-id.png",
      handledBy: "FD-1",
      cancellationReason: "",
      createdAt: "2025-07-20",
      onsitePayments: []
    }
  ]);

  const updateBookingStatus = (bookingId: string, status: Booking["status"], details?: Partial<Booking>) => {
    setBookings(prev => prev.map(bk => {
      if (bk.id === bookingId) {
        // Automatically check-in / check-out matching rooms
        if (status === "checked-in") {
          setRooms(roomsPrev => roomsPrev.map(r => r.roomNumber === bk.roomNumber ? { ...r, status: "occupied" } : r));
        } else if (status === "checked-out") {
          setRooms(roomsPrev => roomsPrev.map(r => r.roomNumber === bk.roomNumber ? { ...r, status: "available", housekeepingStatus: "dirty" } : r));
        }
        return { ...bk, status, ...details, updatedAt: new Date().toISOString() };
      }
      return bk;
    }));
  };

  const addOnsitePayment = (bookingId: string, amount: number, method: string, note: string) => {
    setBookings(prev => prev.map(bk => {
      if (bk.id === bookingId) {
        const nextPayments = bk.onsitePayments || [];
        const newPayment: OnsitePayment = {
          id: `pay-${Date.now()}`,
          amount,
          method,
          note,
          recordedBy: currentUser?.email || "staff",
          recordedAt: new Date().toISOString()
        };
        return {
          ...bk,
          onsitePayments: [...nextPayments, newPayment]
        };
      }
      return bk;
    }));
  };

  const addWalkinBooking = (booking: Omit<Booking, "id" | "bookingRef" | "createdAt">) => {
    const bookingId = `bk-${Date.now()}`;
    const bookingRef = `SI-${Math.floor(100000 + Math.random() * 900000)}`;
    const newBooking: Booking = {
      ...booking,
      id: bookingId,
      bookingRef,
      createdAt: new Date().toISOString().split("T")[0],
      onsitePayments: []
    };
    setBookings(prev => [newBooking, ...prev]);

    // Force update room status if checking in immediately
    if (booking.status === "checked-in") {
      setRooms(prev => prev.map(r => r.roomNumber === booking.roomNumber ? { ...r, status: "occupied" } : r));
    }
  };

  // Vouchers & Corporate codes
  const [vouchers, setVouchers] = useState<Voucher[]>([
    {
      id: "vch-1",
      code: "WELCOME10",
      discountType: "percent",
      discountValue: 10,
      usageCap: 100,
      usageCount: 42,
      expiresAt: "2526-12-31",
      applicableRoomTypes: ["standard-double", "standard-twin"],
      isActive: true,
      createdBy: "admin",
      createdAt: "2026-06-01"
    }
  ]);

  const addVoucher = (voucher: Omit<Voucher, "id" | "createdAt" | "usageCount">) => {
    const newVch: Voucher = {
      ...voucher,
      id: `vch-${Date.now()}`,
      usageCount: 0,
      createdAt: new Date().toISOString()
    };
    setVouchers(prev => [newVch, ...prev]);
  };

  const toggleVoucherActive = (voucherId: string) => {
    setVouchers(prev => prev.map(v => v.id === voucherId ? { ...v, isActive: !v.isActive } : v));
  };

  const [corporateCodes, setCorporateCodes] = useState<CorporateCode[]>([
    {
      code: "ACME123",
      companyName: "ACME Corp",
      ratePerRoomType: { "standard-double": 2720, executive: 3825 },
      expiresAt: "2027-12-31",
      usageCap: null,
      usageCount: 12,
      linkedInquiryId: "inq-1",
      createdBy: "admin",
      createdAt: "2026-06-01",
      isActive: true
    }
  ]);

  const addCorporateCode = (code: CorporateCode) => {
    setCorporateCodes(prev => [code, ...prev]);
  };

  // Corporate Inquiries
  const [corporateInquiries, setCorporateInquiries] = useState<CorporateInquiry[]>([
    {
      id: "inq-1",
      companyName: "ACME Corp",
      contactPerson: "Jane Smith",
      email: "jsmith@acme.com",
      phone: "+63 918 111 2222",
      numRooms: 5,
      preferredDates: { from: "2026-11-10", to: "2026-11-15" },
      specialRequirements: "Requires project screen facilities in suite.",
      status: "converted",
      handler: "admin",
      notes: [{ text: "Discussed corporate rates. Set up code ACME123.", by: "admin", at: "2026-06-02" }],
      accessCodeId: "ACME123",
      createdAt: "2026-06-01"
    },
    {
      id: "inq-2",
      companyName: "Globex Corporation",
      contactPerson: "Hank Scorpio",
      email: "hscorpio@globex.com",
      phone: "+63 919 333 4444",
      numRooms: 10,
      preferredDates: { from: "2026-12-01", to: "2026-12-07" },
      specialRequirements: "Full floor booking, custom security clearances.",
      status: "new",
      handler: "",
      notes: [],
      accessCodeId: "",
      createdAt: "2026-06-04"
    }
  ]);

  const updateInquiryStatus = (inquiryId: string, status: CorporateInquiry["status"]) => {
    setCorporateInquiries(prev => prev.map(inq => inq.id === inquiryId ? { ...inq, status } : inq));
  };

  const addInquiryNote = (inquiryId: string, text: string) => {
    setCorporateInquiries(prev => prev.map(inq => {
      if (inq.id === inquiryId) {
        return {
          ...inq,
          notes: [...inq.notes, { text, by: currentUser?.email || "staff", at: new Date().toISOString() }]
        };
      }
      return inq;
    }));
  };

  // Members Data State
  const [members, setMembers] = useState<Member[]>([
    {
      id: "mem-42",
      memberNumber: "SR-00042",
      fullName: "Alex Mercer",
      email: "member@sparkinn.com",
      phone: "+63 912 345 6789",
      photoUrl: "",
      authProvider: "email",
      isMember: true,
      memberSince: "2025-06-02",
      rewardsPoints: 2480,
      tier: "standard",
      isActive: true,
      pointsHistory: [
        {
          id: "pt-1",
          type: "earn",
          points: 800,
          description: "Stay Checkout Earnings (SI-08103)",
          reason: "Checkout bonus points",
          bookingId: "bk-3",
          by: "system",
          at: "2025-08-09"
        },
        {
          id: "pt-2",
          type: "manual",
          points: 680,
          description: "Loyalty Adjustment",
          reason: "Front desk courtesy credit",
          bookingId: null,
          by: "admin",
          at: "2025-08-08"
        },
        {
          id: "pt-3",
          type: "earn",
          points: 1000,
          description: "Welcome Rewards Bonus",
          reason: "Registration welcome points",
          bookingId: null,
          by: "system",
          at: "2025-06-02"
        }
      ]
    }
  ]);

  const updateMemberPoints = (memberId: string, amount: number, type: PointsLog["type"], reason: string) => {
    setMembers(prev => prev.map(mem => {
      if (mem.id === memberId) {
        const newBalance = Math.max(0, mem.rewardsPoints + amount);
        const newEntry: PointsLog = {
          id: `pt-${Date.now()}`,
          type,
          points: amount,
          description: type === "manual" ? `Manual Adjust (${reason})` : "Loyalty reward",
          reason,
          bookingId: null,
          by: currentUser?.email || "staff",
          at: new Date().toISOString()
        };
        return {
          ...mem,
          rewardsPoints: newBalance,
          pointsHistory: [newEntry, ...mem.pointsHistory]
        };
      }
      return mem;
    }));
  };

  const toggleMemberActive = (memberId: string) => {
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, isActive: !m.isActive } : m));
  };

  // Intercom log (inbox) state
  const [intercoms, setIntercoms] = useState<Record<string, IntercomMessage[]>>({
    "305": [
      {
        id: "int-1",
        text: "Mabuhay Alex! Welcome to spark inn. This is the Front Desk. How can we help you in Room 305 today?",
        sender: "front-desk",
        guestName: "Front Desk Staff",
        timestamp: "10:00 AM",
        isRead: true,
        isQuickRequest: false,
        isStoreOrder: false
      },
      {
        id: "int-2",
        text: "Hi! Can we get an extra blanket for Room 305?",
        sender: "guest",
        guestName: "Alex Mercer",
        timestamp: "10:15 AM",
        isRead: false,
        isQuickRequest: false,
        isStoreOrder: false
      }
    ]
  });

  const sendIntercomMessage = (roomId: string, text: string, sender: "guest" | "front-desk" = "front-desk") => {
    const activeRoomMsgs = intercoms[roomId] || [];
    const newMsg: IntercomMessage = {
      id: `int-${Date.now()}`,
      text,
      sender,
      guestName: sender === "guest" ? "Guest" : "Front Desk",
      timestamp: new Date().toLocaleTimeString(config.locale, { hour: "2-digit", minute: "2-digit" }),
      isRead: sender === "front-desk",
      isQuickRequest: false,
      isStoreOrder: false
    };

    setIntercoms(prev => ({
      ...prev,
      [roomId]: [...activeRoomMsgs, newMsg]
    }));

    // Trigger mock automatic guest reply if staff sent the message
    if (sender === "front-desk") {
      setTimeout(() => {
        setIntercoms(prev => {
          const msgs = prev[roomId] || [];
          return {
            ...prev,
            [roomId]: [
              ...msgs,
              {
                id: `int-guest-reply-${Date.now()}`,
                text: "Thank you for the quick response! (Simulated Guest)",
                sender: "guest",
                guestName: "Guest",
                timestamp: new Date().toLocaleTimeString(config.locale, { hour: "2-digit", minute: "2-digit" }),
                isRead: false,
                isQuickRequest: false,
                isStoreOrder: false
              }
            ]
          };
        });
      }, 3500);
    }
  };

  const markChatAsRead = (roomId: string) => {
    setIntercoms(prev => {
      const msgs = prev[roomId];
      if (!msgs) return prev;
      return {
        ...prev,
        [roomId]: msgs.map(m => ({ ...m, isRead: true }))
      };
    });
  };

  // Call Signaling state
  const [incomingCall, setIncomingCall] = useState<AdminContextType["incomingCall"]>(null);

  const triggerIncomingCall = (roomId: string, guestName: string) => {
    setIncomingCall({ roomId, guestName, status: "ringing" });
  };

  const acceptCall = () => {
    if (incomingCall) {
      setIncomingCall({ ...incomingCall, status: "active" });
    }
  };

  const declineCall = () => {
    setIncomingCall(null);
  };

  // Store Orders State
  const [storeOrders, setStoreOrders] = useState<StoreOrder[]>([
    {
      id: "ord-1",
      orderRef: "ORD-8714",
      roomId: "rm-305",
      roomNumber: "305",
      bookingId: "bk-2",
      guestName: "Alex Mercer",
      items: [
        { itemId: "item-1", name: "San Miguel Pale Pilsen (Can)", price: 120, quantity: 2 },
        { itemId: "item-3", name: "Bohol Peanut Kisses", price: 80, quantity: 1 }
      ],
      totalAmount: 320,
      paymentMethod: "add-to-bill",
      paymentProofUrl: "",
      status: "placed",
      isBilled: false,
      billedAt: null,
      cancellationReason: "",
      handledBy: "",
      notes: "Deliver cold pilsen.",
      createdAt: new Date().toISOString()
    }
  ]);

  const updateStoreOrderStatus = (orderId: string, status: StoreOrder["status"]) => {
    setStoreOrders(prev => prev.map(ord => ord.id === orderId ? { ...ord, status } : ord));
  };

  const billStoreOrder = (orderId: string) => {
    setStoreOrders(prev => prev.map(ord => {
      if (ord.id === orderId) {
        return {
          ...ord,
          isBilled: true,
          billedAt: new Date().toISOString()
        };
      }
      return ord;
    }));
  };

  // Settings Mock States
  const [hotelConfig, setHotelConfig] = useState({
    hotelName: config.brandName,
    address: `${config.address.street}, ${config.address.city}, ${config.address.region}`,
    contactEmail: config.supportEmail,
    contactPhone: config.frontDeskPhone,
    frontDeskPhone: config.frontDeskPhone,
    facebookUrl: `https://facebook.com/${config.brandName}`,
    instagramUrl: `https://instagram.com/${config.brandName}`,
    checkInTime: "2:00 PM",
    checkOutTime: "12:00 PM",
    missionStatement: "To deliver peaceful, consistent stays shaped by genuine, intentional hospitality.",
    visionStatement: "To be Bohol's boutique standard.",
    hotelStory: "A hospitality story built on consistency...",
    intercomQuickRequests: ["Extra Towels", "Bottled Water", "Room Cleaning", "Do Not Disturb"],
    notificationSoundUrl: ""
  });

  const [websiteContent, setWebsiteContent] = useState({
    homepage: {
      heroHeading: "Boutique Comfort in Bohol",
      heroSubtext: "Peaceful stays near tourist landmarks.",
      heroPhotoUrl: ""
    },
    about: {
      heroPhotoUrl: ""
    },
    corporate: {
      heroHeading: "Corporate Boardrooms",
      heroSubtext: "Flexible spaces.",
      perks: [
        { title: "Negotitated Rates", description: "Discounted room charges.", icon: "percent" }
      ]
    }
  });

  const [rewardsConfig, setRewardsConfig] = useState({
    pointsEnabled: true,
    earningMode: "per-spend",
    pointsPerBooking: 50,
    pointsPerHundred: 10,
    memberDiscountEnabled: true,
    memberDiscountPct: 10,
    pointsRedemptionRate: 100
  });

  const [breakfastConfig, setBreakfastConfig] = useState({
    isEnabled: true,
    ratePerPersonPerNight: 300,
    silogItems: [
      { id: "sl-1", name: "Tapsilog", isActive: true },
      { id: "sl-2", name: "Longsilog", isActive: true },
      { id: "sl-3", name: "Tocilog", isActive: true }
    ]
  });

  const [storeConfig, setStoreConfig] = useState({
    isEnabled: true,
    lowStockThreshold: 3,
    paymentMethods: [
      { method: "cod", label: "Cash on Delivery", isEnabled: true },
      { method: "add-to-bill", label: "Room Bill", isEnabled: true },
      { method: "gcash", label: "GCash Wallet", isEnabled: true }
    ]
  });

  const updateSettings = (section: any, data: any) => {
    if (section === "hotelConfig") setHotelConfig(prev => ({ ...prev, ...data }));
    if (section === "websiteContent") setWebsiteContent(prev => ({ ...prev, ...data }));
    if (section === "rewardsConfig") setRewardsConfig(prev => ({ ...prev, ...data }));
    if (section === "breakfastConfig") setBreakfastConfig(prev => ({ ...prev, ...data }));
    if (section === "storeConfig") setStoreConfig(prev => ({ ...prev, ...data }));
  };

  return (
    <AdminContext.Provider
      value={{
        currentUser,
        signIn,
        signOut,
        rooms,
        toggleHousekeepingStatus,
        updateRoomConfig,
        addRoomBlock,
        bookings,
        updateBookingStatus,
        addOnsitePayment,
        addWalkinBooking,
        vouchers,
        addVoucher,
        toggleVoucherActive,
        corporateCodes,
        addCorporateCode,
        corporateInquiries,
        updateInquiryStatus,
        addInquiryNote,
        members,
        updateMemberPoints,
        toggleMemberActive,
        intercoms,
        sendIntercomMessage,
        markChatAsRead,
        incomingCall,
        triggerIncomingCall,
        acceptCall,
        declineCall,
        storeOrders,
        updateStoreOrderStatus,
        billStoreOrder,
        hotelConfig,
        websiteContent,
        rewardsConfig,
        breakfastConfig,
        storeConfig,
        updateSettings
      }}
    >
      {children}
    </AdminContext.Provider>
  );
}

export function useAdmin() {
  const context = useContext(AdminContext);
  if (context === undefined) {
    throw new Error("useAdmin must be used within an AdminProvider");
  }
  return context;
}
