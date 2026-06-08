import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import {
  browserSessionPersistence,
  getIdTokenResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut
} from "firebase/auth";
import { DEFAULT_ROOM_TYPES } from "@spark-inn/shared";
import config from "@config";
import { auth } from "../firebase/auth";
import { collection, doc, onSnapshot, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase/config";

type StaffRole = "front-desk" | "admin";

interface AdminUser {
  uid: string;
  email: string;
  role: StaffRole;
}

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
  guestRegistration?: {
    nationality: string;
    address: string;
    dateOfBirth: string;
    gender: string;
    idType: string;
    idNumber: string;
    emergencyContact: string;
    vehiclePlate: string;
    signatureStatus: "pending" | "signed";
  };
  breakfastSelections?: Record<string, string>;
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

export interface StoreItem {
  id: string;
  name: string;
  category: "drinks" | "snacks" | "toiletries" | "rentals" | "other";
  description: string;
  price: number;
  stock: number | null;
  imageUrl: string;
  isActive: boolean;
  createdAt: string;
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
  authLoading: boolean;
  currentUser: AdminUser | null;
  sendPasswordReset: (email: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;

  // Rooms
  rooms: Room[];
  toggleHousekeepingStatus: (roomId: string) => void | Promise<void>;
  updateRoomConfig: (roomId: string, updates: Partial<Room>) => void | Promise<void>;
  addRoomBlock: (roomId: string, dates: { from: string; to: string }, reason: string) => void | Promise<void>;

  // Bookings
  bookings: Booking[];
  updateBookingStatus: (bookingId: string, status: Booking["status"], details?: Partial<Booking>) => void | Promise<void>;
  addOnsitePayment: (bookingId: string, amount: number, method: string, note: string) => Promise<{ success: boolean; error?: string }>;
  addWalkinBooking: (booking: Omit<Booking, "id" | "bookingRef" | "createdAt"> & { totalPriceOverride?: number }) => Promise<{ success: boolean; error?: string }>;

  // Vouchers & Corporate Rates
  vouchers: Voucher[];
  addVoucher: (voucher: Omit<Voucher, "id" | "createdAt" | "usageCount">) => void;
  toggleVoucherActive: (voucherId: string) => void;
  corporateCodes: CorporateCode[];
  addCorporateCode: (code: CorporateCode) => void;
  toggleCorporateCodeActive: (code: string) => void;
  deleteCorporateCode: (code: string) => void;

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
  storeItems: StoreItem[];
  addStoreItem: (item: Omit<StoreItem, "id" | "createdAt">) => void;
  updateStoreItem: (itemId: string, updates: Partial<Omit<StoreItem, "id" | "createdAt">>) => void;
  deleteStoreItem: (itemId: string) => void;

  // Configurations
  hotelConfig: any;
  websiteContent: any;
  rewardsConfig: any;
  breakfastConfig: any;
  storeConfig: any;
  updateSettings: (section: "hotelConfig" | "websiteContent" | "rewardsConfig" | "breakfastConfig" | "storeConfig", data: any) => void;

  // Room Types Config
  roomTypes: { value: string; label: string; shortLabel: string }[];
  addRoomType: (rt: { value: string; label: string; shortLabel: string }) => void;
  updateRoomType: (value: string, updates: Partial<{ label: string; shortLabel: string }>) => void;
  deleteRoomType: (value: string) => void;
}

const AdminContext = createContext<AdminContextType | undefined>(undefined);

function isStaffRole(role: unknown): role is StaffRole {
  return role === "admin" || role === "front-desk";
}

export function AdminProvider({ children }: { children: ReactNode }) {
  // Auth State
  const [authLoading, setAuthLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<AdminContextType["currentUser"]>(null);

  useEffect(() => {
    void setPersistence(auth, browserSessionPersistence).catch(() => undefined);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setCurrentUser(null);
        setAuthLoading(false);
        return;
      }

      try {
        const tokenResult = await getIdTokenResult(firebaseUser, true);
        const role = isStaffRole(tokenResult.claims.role) ? tokenResult.claims.role : "front-desk";

        setCurrentUser({
          uid: firebaseUser.uid,
          email: firebaseUser.email ?? "",
          role
        });
      } catch {
        setCurrentUser(null);
      } finally {
        setAuthLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const signIn = async (email: string, password: string) => {
    setAuthLoading(true);
    try {
      await setPersistence(auth, browserSessionPersistence);
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const tokenResult = await getIdTokenResult(credential.user, true);
      const role = isStaffRole(tokenResult.claims.role) ? tokenResult.claims.role : "front-desk";

      setCurrentUser({
        uid: credential.user.uid,
        email: credential.user.email ?? email,
        role
      });
    } finally {
      setAuthLoading(false);
    }
  };

  const signOut = async () => {
    await firebaseSignOut(auth);
    setCurrentUser(null);
  };

  const sendPasswordReset = async (email: string) => {
    await sendPasswordResetEmail(auth, email);
  };

  // Rooms Data State
  const [rooms, setRooms] = useState<Room[]>([]);

  useEffect(() => {
    const roomsRef = collection(db, "rooms");
    const unsubscribe = onSnapshot(roomsRef, (snapshot) => {
      const roomsData: Room[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        roomsData.push({
          id: doc.id,
          name: data.name || "",
          roomNumber: data.roomNumber || "",
          type: data.type || "",
          description: data.description || "",
          maxCapacity: data.maxCapacity || 0,
          bedDefinition: data.bedDefinition || "",
          pricePerNight: data.pricePerNight || 0,
          weekendRate: data.weekendRate || 0,
          corporateRate: data.corporateRate || 0,
          amenities: data.amenities || [],
          imageUrls: data.imageUrls || [],
          isActive: data.isActive !== false,
          status: data.status || "available",
          housekeepingStatus: data.housekeepingStatus || "clean",
          blockReason: data.blockReason || "",
          remarks: data.remarks || ""
        });
      });

      // Consistent natural sort by room number
      roomsData.sort((a, b) =>
        a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true })
      );

      setRooms(roomsData);
    });

    return unsubscribe;
  }, []);

  const toggleHousekeepingStatus = async (roomId: string) => {
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;
    
    let nextHK: Room["housekeepingStatus"] = "clean";
    if (room.housekeepingStatus === "clean") {
      nextHK = "in-progress";
    } else if (room.housekeepingStatus === "in-progress") {
      nextHK = "dirty";
    } else {
      nextHK = "clean";
    }

    try {
      const roomRef = doc(db, "rooms", roomId);
      await updateDoc(roomRef, {
        housekeepingStatus: nextHK,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error updating housekeeping status in Firestore:", error);
    }
  };

  const updateRoomConfig = async (roomId: string, updates: Partial<Room>) => {
    try {
      const roomRef = doc(db, "rooms", roomId);
      const dataToUpdate: Record<string, any> = {
        ...updates,
        updatedAt: serverTimestamp()
      };
      delete dataToUpdate.id; // Exclude ID from updates payload

      await updateDoc(roomRef, dataToUpdate);
    } catch (error) {
      console.error("Error updating room config in Firestore:", error);
    }
  };

  const addRoomBlock = async (roomId: string, dates: { from: string; to: string }, reason: string) => {
    try {
      const roomRef = doc(db, "rooms", roomId);
      await updateDoc(roomRef, {
        status: "blocked",
        blockReason: `${reason} (${dates.from} to ${dates.to})`,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error adding room block in Firestore:", error);
    }
  };

  // Bookings Data State
  const [bookings, setBookings] = useState<Booking[]>([]);

  useEffect(() => {
    const bookingsRef = collection(db, "bookings");
    const unsubscribe = onSnapshot(
      bookingsRef,
      (snapshot) => {
        const bookingsData: Booking[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          
          const parseDateString = (val: any) => {
            if (!val) return "";
            if (typeof val.toDate === "function") {
              return val.toDate().toISOString().split("T")[0];
            }
            if (val instanceof Date) {
              return val.toISOString().split("T")[0];
            }
            if (typeof val === "string") {
              return val.split("T")[0];
            }
            return "";
          };

          const parseDateTimeString = (val: any) => {
            if (!val) return "";
            if (typeof val.toDate === "function") {
              return val.toDate().toISOString();
            }
            if (val instanceof Date) {
              return val.toISOString();
            }
            if (typeof val === "string") {
              return val;
            }
            return "";
          };

          bookingsData.push({
            id: docSnap.id,
            bookingRef: data.bookingRef || "",
            roomId: data.roomId || "",
            roomNumber: data.roomNumber || "",
            roomType: data.roomType || "",
            guestName: data.guestName || "",
            guestEmail: data.guestEmail || "",
            guestPhone: data.guestPhone || "",
            numGuests: data.numGuests || 0,
            checkIn: parseDateString(data.checkIn),
            checkOut: parseDateString(data.checkOut),
            numNights: data.numNights || 0,
            ratePerNight: data.ratePerNight || 0,
            totalPrice: data.totalPrice || 0,
            originalTotalPrice: data.originalTotalPrice !== undefined ? data.originalTotalPrice : null,
            discountType: data.discountType || "",
            discountPct: data.discountPct || 0,
            discountIdPhotoUrl: data.discountIdPhotoUrl || null,
            discountVerified: !!data.discountVerified,
            discountVerifiedBy: data.discountVerifiedBy || null,
            discountRejected: !!data.discountRejected,
            discountRejectedBy: data.discountRejectedBy || null,
            discountRejectionReason: data.discountRejectionReason || "",
            voucherCode: data.voucherCode || "",
            voucherDiscount: data.voucherDiscount || 0,
            isCorporate: !!data.isCorporate,
            corporateCode: data.corporateCode || "",
            companyName: data.companyName || "",
            specialRequests: data.specialRequests || "",
            status: data.status || "pending",
            paymentMethod: data.paymentMethod || "",
            paymentProofUrl: data.paymentProofUrl || "",
            source: data.source || "online",
            notes: data.notes || "",
            memberId: data.memberId || null,
            pointsRedeemed: data.pointsRedeemed || 0,
            pointsRedeemedValue: data.pointsRedeemedValue || 0,
            pointsRedeemedBy: data.pointsRedeemedBy || null,
            pointsRedeemedAt: data.pointsRedeemedAt || null,
            hasBreakfast: !!data.hasBreakfast,
            breakfastRate: data.breakfastRate || 0,
            guestIdPhotoUrl: data.guestIdPhotoUrl || null,
            handledBy: data.handledBy || "",
            cancellationReason: data.cancellationReason || "",
            createdAt: parseDateTimeString(data.createdAt),
            guestRegistration: data.guestRegistration || null,
            breakfastSelections: data.breakfastSelections || {},
          });
        });

        // Natural sort by createdAt descending
        bookingsData.sort((a, b) => {
          const aTime = a.createdAt || "";
          const bTime = b.createdAt || "";
          if (aTime !== bTime) {
            return bTime.localeCompare(aTime);
          }
          return b.bookingRef.localeCompare(a.bookingRef);
        });

        setBookings(bookingsData);
      },
      (error) => {
        console.error("Error listening to bookings collection:", error);
      }
    );

    return unsubscribe;
  }, []);

  const updateBookingStatus = async (bookingId: string, status: Booking["status"], details?: Partial<Booking>) => {
    try {
      const bookingDocRef = doc(db, "bookings", bookingId);

      if (status === "cancelled") {
        const token = await auth.currentUser?.getIdToken();
        const baseUrl = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
          ? "http://localhost:3000"
          : import.meta.env.VITE_GUEST_APP_URL || "";

        const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/bookings/cancel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": token ? `Bearer ${token}` : ""
          },
          body: JSON.stringify({
            bookingId,
            reason: details?.cancellationReason || ""
          })
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Failed to cancel booking via server API.");
        }
      } else {
        const updatePayload: Record<string, any> = {
          status,
          ...details,
          updatedAt: serverTimestamp()
        };

        if (status === "checked-in") {
          const booking = bookings.find(b => b.id === bookingId);
          if (booking) {
            const matchedRoom = rooms.find(r => r.roomNumber === booking.roomNumber);
            if (matchedRoom) {
              void updateRoomConfig(matchedRoom.id, { status: "occupied" });
            }
          }
        } else if (status === "checked-out") {
          const booking = bookings.find(b => b.id === bookingId);
          if (booking) {
            const matchedRoom = rooms.find(r => r.roomNumber === booking.roomNumber);
            if (matchedRoom) {
              void updateRoomConfig(matchedRoom.id, { status: "available", housekeepingStatus: "dirty" });
            }
          }
        }

        await updateDoc(bookingDocRef, updatePayload);
      }
    } catch (error) {
      console.error("Error updating booking status:", error);
      alert("Failed to update booking status: " + (error instanceof Error ? error.message : String(error)));
    }
  };

  const addOnsitePayment = async (bookingId: string, amount: number, method: string, note: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const baseUrl = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:3000"
        : import.meta.env.VITE_GUEST_APP_URL || "";

      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/bookings/add-payment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          bookingId,
          amount,
          method,
          note
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to record payment" };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error recording onsite payment:", err);
      return { success: false, error: err.message };
    }
  };

  const addWalkinBooking = async (booking: Omit<Booking, "id" | "bookingRef" | "createdAt"> & { totalPriceOverride?: number }): Promise<{ success: boolean; error?: string }> => {
    try {
      const token = await auth.currentUser?.getIdToken();
      const baseUrl = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
        ? "http://localhost:3000"
        : import.meta.env.VITE_GUEST_APP_URL || "";

      const bookingId = doc(collection(db, "bookings")).id;

      const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/bookings/create-walkin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token ? `Bearer ${token}` : ""
        },
        body: JSON.stringify({
          bookingId,
          roomId: booking.roomId,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          guests: booking.numGuests,
          hasBreakfast: booking.hasBreakfast,
          guestDetails: {
            firstName: booking.guestName.split(" ")[0] || "Guest",
            lastName: booking.guestName.split(" ").slice(1).join(" ") || "Walkin",
            email: booking.guestEmail,
            phone: booking.guestPhone,
            requests: booking.specialRequests
          },
          paymentMethod: booking.paymentMethod,
          status: booking.status,
          totalPriceOverride: booking.totalPriceOverride
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || "Failed to create walk-in booking." };
      }
      return { success: true };
    } catch (err: any) {
      console.error("Error creating walkin booking:", err);
      return { success: false, error: err.message };
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

  const toggleCorporateCodeActive = (code: string) => {
    setCorporateCodes(prev => prev.map(c => c.code === code ? { ...c, isActive: !c.isActive } : c));
  };

  const deleteCorporateCode = (code: string) => {
    setCorporateCodes(prev => prev.filter(c => c.code !== code));
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

  // Store Catalog State
  const [storeItems, setStoreItems] = useState<StoreItem[]>([
    {
      id: "item-1",
      name: "San Miguel Pale Pilsen",
      category: "drinks",
      description: "Ice-cold local pilsner beer, 330ml can.",
      price: 120,
      stock: 18,
      imageUrl: "https://images.unsplash.com/photo-1608270586620-248524c67de9?auto=format&fit=crop&q=80&w=256&h=256",
      isActive: true,
      createdAt: "2026-06-01"
    },
    {
      id: "item-2",
      name: "Spark Still Water",
      category: "drinks",
      description: "Premium purified drinking water in a glass bottle.",
      price: 60,
      stock: null,
      imageUrl: "https://images.unsplash.com/photo-1523362628745-0c100150b504?auto=format&fit=crop&q=80&w=256&h=256",
      isActive: true,
      createdAt: "2026-06-01"
    },
    {
      id: "item-3",
      name: "Bohol Peanut Kisses",
      category: "snacks",
      description: "Crisp local peanut cookies shaped like Chocolate Hills.",
      price: 80,
      stock: 4,
      imageUrl: "https://images.unsplash.com/photo-1590080875515-8a3a8dc5735e?auto=format&fit=crop&q=80&w=256&h=256",
      isActive: true,
      createdAt: "2026-06-01"
    },
    {
      id: "item-4",
      name: "Extra Beach Towel",
      category: "rentals",
      description: "Large microfiber towel for pool trips and beach days.",
      price: 150,
      stock: 0,
      imageUrl: "",
      isActive: false,
      createdAt: "2026-06-01"
    }
  ]);

  const addStoreItem = (item: Omit<StoreItem, "id" | "createdAt">) => {
    const nextItem: StoreItem = {
      ...item,
      id: `item-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
    setStoreItems(prev => [nextItem, ...prev]);
  };

  const updateStoreItem = (itemId: string, updates: Partial<Omit<StoreItem, "id" | "createdAt">>) => {
    setStoreItems(prev => prev.map(item => item.id === itemId ? { ...item, ...updates } : item));
  };

  const deleteStoreItem = (itemId: string) => {
    setStoreItems(prev => prev.filter(item => item.id !== itemId));
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
    notificationSoundUrl: "",
    bookingPaymentMethods: [
      { method: "bank", label: "Bank Transfer", isEnabled: true, qrUrl: "bank-qr.png", accountInfo: "BDO: 001234567890 (Spark Inn)" },
      { method: "gcash", label: "GCash Wallet", isEnabled: true, qrUrl: "gcash-qr.png", accountInfo: "GCash: 09170000000 (Daniel Sandimas)" },
      { method: "pay-at-hotel", label: "Pay at Hotel", isEnabled: true, qrUrl: "", accountInfo: "Pay in cash/card on arrival" }
    ]
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

  // Room Types State
  const [roomTypes, setRoomTypes] = useState<{ value: string; label: string; shortLabel: string }[]>(() => {
    const saved = localStorage.getItem("sim_admin_room_types");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return [...DEFAULT_ROOM_TYPES];
  });

  const saveRoomTypes = (newTypes: typeof roomTypes) => {
    setRoomTypes(newTypes);
    localStorage.setItem("sim_admin_room_types", JSON.stringify(newTypes));
  };

  const addRoomType = (rt: { value: string; label: string; shortLabel: string }) => {
    const updated = [...roomTypes, rt];
    saveRoomTypes(updated);
  };

  const updateRoomType = (value: string, updates: Partial<{ label: string; shortLabel: string }>) => {
    const updated = roomTypes.map(t => t.value === value ? { ...t, ...updates } : t);
    saveRoomTypes(updated);
  };

  const deleteRoomType = (value: string) => {
    const updated = roomTypes.filter(t => t.value !== value);
    saveRoomTypes(updated);
  };

  return (
    <AdminContext.Provider
      value={{
        currentUser,
        authLoading,
        sendPasswordReset,
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
        toggleCorporateCodeActive,
        deleteCorporateCode,
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
        storeItems,
        addStoreItem,
        updateStoreItem,
        deleteStoreItem,
        hotelConfig,
        websiteContent,
        rewardsConfig,
        breakfastConfig,
        storeConfig,
        updateSettings,
        roomTypes,
        addRoomType,
        updateRoomType,
        deleteRoomType
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
