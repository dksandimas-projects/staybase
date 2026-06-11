import React, { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
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
import { collection, doc, onSnapshot, updateDoc, addDoc, deleteDoc, setDoc, Timestamp, serverTimestamp, orderBy, query } from "firebase/firestore";
import { db } from "../firebase/config";

type StaffRole = "front-desk" | "admin";

const rtcConfiguration: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

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
  isEarlyCheckInRequest?: boolean;
}

export interface IntercomThread {
  roomId: string;
  roomNumber: string;
  guestName: string;
  resolved: boolean;
  updatedAt: string;
}

export interface IncomingCall {
  roomId: string;
  guestName: string;
  status: "ringing" | "active" | "ended";
  offer?: RTCSessionDescriptionInit;
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
  intercomThreads: Record<string, IntercomThread>;
  sendIntercomMessage: (roomId: string, text: string, sender?: "guest" | "front-desk") => void;
  markChatAsRead: (roomId: string) => void;
  setIntercomResolved: (roomId: string, resolved: boolean) => void | Promise<void>;
  incomingCall: IncomingCall | null;
  triggerIncomingCall: (roomId: string, guestName: string) => void | Promise<void>;
  acceptCall: () => void | Promise<void>;
  declineCall: () => void | Promise<void>;

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
  updateSettings: (section: "hotelConfig" | "websiteContent" | "rewardsConfig" | "breakfastConfig" | "storeConfig", data: any) => Promise<void>;

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

  // Vouchers — live from Firestore
  const [vouchers, setVouchers] = useState<Voucher[]>([]);

  useEffect(() => {
    const vouchersRef = collection(db, "vouchers");
    const unsubscribe = onSnapshot(
      vouchersRef,
      (snapshot) => {
        const voucherData: Voucher[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          voucherData.push({
            id: docSnap.id,
            code: data.code || "",
            discountType: data.discountType || "flat",
            discountValue: data.discountValue || 0,
            usageCap: data.usageCap ?? null,
            usageCount: data.usageCount || 0,
            expiresAt: data.expiresAt ? (typeof data.expiresAt.toDate === "function" ? data.expiresAt.toDate().toISOString() : String(data.expiresAt)) : null,
            applicableRoomTypes: data.applicableRoomTypes || [],
            isActive: data.isActive !== false,
            createdBy: data.createdBy || "",
            createdAt: data.createdAt ? (typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : String(data.createdAt)) : "",
          });
        });

        voucherData.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setVouchers(voucherData);
      },
      (error) => {
        console.error("Error listening to vouchers collection:", error);
      }
    );

    return unsubscribe;
  }, []);

  const addVoucher = async (voucher: Omit<Voucher, "id" | "createdAt" | "usageCount">) => {
    try {
      const staff = currentUser;
      await addDoc(collection(db, "vouchers"), {
        ...voucher,
        usageCount: 0,
        createdBy: staff?.uid || "unknown",
        createdAt: Timestamp.now(),
      });
    } catch (error) {
      console.error("Error adding voucher:", error);
    }
  };

  const toggleVoucherActive = async (voucherId: string) => {
    try {
      const vchRef = doc(db, "vouchers", voucherId);
      const vch = vouchers.find(v => v.id === voucherId);
      if (vch) {
        await updateDoc(vchRef, { isActive: !vch.isActive });
      }
    } catch (error) {
      console.error("Error toggling voucher active:", error);
    }
  };

  // Corporate Codes — live from Firestore
  const [corporateCodes, setCorporateCodes] = useState<CorporateCode[]>([]);

  useEffect(() => {
    const corpCodesRef = collection(db, "corporateCodes");
    const unsubscribe = onSnapshot(
      corpCodesRef,
      (snapshot) => {
        const codes: CorporateCode[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          codes.push({
            code: docSnap.id,
            companyName: data.companyName || "",
            ratePerRoomType: data.ratePerRoomType || {},
            expiresAt: data.expiresAt ? (typeof data.expiresAt.toDate === "function" ? data.expiresAt.toDate().toISOString() : String(data.expiresAt)) : null,
            usageCap: data.usageCap ?? null,
            usageCount: data.usageCount || 0,
            linkedInquiryId: data.linkedInquiryId || "",
            createdBy: data.createdBy || "",
            createdAt: data.createdAt ? (typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : String(data.createdAt)) : "",
            isActive: data.isActive !== false,
          });
        });

        codes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setCorporateCodes(codes);
      },
      (error) => {
        console.error("Error listening to corporateCodes collection:", error);
      }
    );

    return unsubscribe;
  }, []);

  const addCorporateCode = async (code: CorporateCode) => {
    try {
      const { code: codeValue, ...rest } = code;
      await setDoc(doc(db, "corporateCodes", code.code), {
        ...rest,
        isActive: true,
      });
    } catch (error) {
      console.error("Error adding corporate code:", error);
    }
  };

  const toggleCorporateCodeActive = async (code: string) => {
    try {
      const codeRef = doc(db, "corporateCodes", code);
      const existing = corporateCodes.find(c => c.code === code);
      if (existing) {
        await updateDoc(codeRef, { isActive: !existing.isActive });
      }
    } catch (error) {
      console.error("Error toggling corporate code active:", error);
    }
  };

  const deleteCorporateCode = async (code: string) => {
    try {
      await deleteDoc(doc(db, "corporateCodes", code));
    } catch (error) {
      console.error("Error deleting corporate code:", error);
    }
  };

  // Corporate Inquiries — live from Firestore
  const [corporateInquiries, setCorporateInquiries] = useState<CorporateInquiry[]>([]);

  useEffect(() => {
    const inquiriesRef = collection(db, "corporateInquiries");
    const unsubscribe = onSnapshot(
      inquiriesRef,
      (snapshot) => {
        const inquiries: CorporateInquiry[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          inquiries.push({
            id: docSnap.id,
            companyName: data.companyName || "",
            contactPerson: data.contactPerson || "",
            email: data.email || "",
            phone: data.phone || "",
            numRooms: data.numRooms || 0,
            preferredDates: data.preferredDates || { from: "", to: "" },
            specialRequirements: data.specialRequirements || "",
            status: data.status || "new",
            handler: data.handler || "",
            notes: data.notes || [],
            accessCodeId: data.accessCodeId || "",
            createdAt: data.createdAt ? (typeof data.createdAt.toDate === "function" ? data.createdAt.toDate().toISOString() : String(data.createdAt)) : "",
          });
        });

        inquiries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setCorporateInquiries(inquiries);
      },
      (error) => {
        console.error("Error listening to corporateInquiries collection:", error);
      }
    );

    return unsubscribe;
  }, []);

  const updateInquiryStatus = async (inquiryId: string, status: CorporateInquiry["status"]) => {
    try {
      await updateDoc(doc(db, "corporateInquiries", inquiryId), { status });
    } catch (error) {
      console.error("Error updating inquiry status:", error);
    }
  };

  const addInquiryNote = async (inquiryId: string, text: string) => {
    try {
      const inquiryRef = doc(db, "corporateInquiries", inquiryId);
      const inquiry = corporateInquiries.find(i => i.id === inquiryId);
      if (inquiry) {
        const newNote = { text, by: currentUser?.email || "staff", at: new Date().toISOString() };
        await updateDoc(inquiryRef, {
          notes: [...inquiry.notes, newNote],
        });
      }
    } catch (error) {
      console.error("Error adding inquiry note:", error);
    }
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

  // Intercom log (inbox) state — live from Firestore, keyed by room number
  const [intercoms, setIntercoms] = useState<Record<string, IntercomMessage[]>>({});
  const [intercomThreads, setIntercomThreads] = useState<Record<string, IntercomThread>>({});

  const formatIntercomTimestamp = (value: any) => {
    if (!value) return "";
    const date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(config.locale, { hour: "2-digit", minute: "2-digit" });
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "intercoms"),
      (snapshot) => {
        const threads: Record<string, IntercomThread> = {};
        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data();
          const roomNumber = data.roomNumber || docSnap.id;
          threads[roomNumber] = {
            roomId: data.roomId || docSnap.id,
            roomNumber,
            guestName: data.guestName || "",
            resolved: !!data.resolved,
            updatedAt: formatIntercomTimestamp(data.updatedAt)
          };
        });
        setIntercomThreads(threads);
      },
      (error) => {
        console.error("Error listening to intercom thread metadata:", error);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const roomNumbers = rooms.map((room) => room.roomNumber).filter(Boolean);
    if (roomNumbers.length === 0) {
      setIntercoms({});
      return;
    }

    const unsubscribes = roomNumbers.map((roomNumber) => {
      const messagesQuery = query(
        collection(db, "intercoms", roomNumber, "messages"),
        orderBy("timestamp", "asc")
      );

      return onSnapshot(
        messagesQuery,
        (snapshot) => {
          const messages: IntercomMessage[] = snapshot.docs.map((docSnap) => {
            const data = docSnap.data();
            return {
              id: docSnap.id,
              text: data.text || "",
              sender: data.sender || "guest",
              guestName: data.guestName || "",
              timestamp: formatIntercomTimestamp(data.timestamp),
              isRead: !!data.isRead,
              isQuickRequest: !!data.isQuickRequest,
              isStoreOrder: !!data.isStoreOrder,
              orderRef: data.orderRef || undefined,
              isEarlyCheckInRequest: !!data.isEarlyCheckInRequest
            };
          });

          setIntercoms((prev) => {
            if (messages.length === 0) {
              const { [roomNumber]: _removed, ...rest } = prev;
              return rest;
            }
            return { ...prev, [roomNumber]: messages };
          });
        },
        (error) => {
          console.error(`Error listening to intercom messages for room ${roomNumber}:`, error);
        }
      );
    });

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [rooms]);

  const sendIntercomMessage = async (roomId: string, text: string, sender: "guest" | "front-desk" = "front-desk") => {
    try {
      await setDoc(doc(db, "intercoms", roomId), {
        roomId,
        roomNumber: roomId,
        resolved: false,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await addDoc(collection(db, "intercoms", roomId, "messages"), {
        text,
        sender,
        guestName: sender === "guest" ? "Guest" : currentUser?.email || "Front Desk",
        timestamp: serverTimestamp(),
        isRead: sender === "front-desk",
        isQuickRequest: false,
        isStoreOrder: false,
        isEarlyCheckInRequest: false
      });
    } catch (error) {
      console.error("Error sending intercom message:", error);
    }
  };

  const markChatAsRead = async (roomId: string) => {
    const unreadGuestMessages = (intercoms[roomId] || []).filter((message) => message.sender === "guest" && !message.isRead);
    if (unreadGuestMessages.length === 0) return;

    try {
      await Promise.all(
        unreadGuestMessages.map((message) =>
          updateDoc(doc(db, "intercoms", roomId, "messages", message.id), {
            isRead: true
          })
        )
      );
    } catch (error) {
      console.error("Error marking intercom messages as read:", error);
    }
  };

  const setIntercomResolved = async (roomId: string, resolved: boolean) => {
    if (!roomId) return;

    try {
      await setDoc(doc(db, "intercoms", roomId), {
        roomId,
        roomNumber: roomId,
        resolved,
        resolvedAt: resolved ? serverTimestamp() : null,
        updatedAt: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("Error updating intercom resolved status:", error);
    }
  };

  // Call Signaling state — live from Firestore calls/{roomId}
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const adminPeerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const adminMediaStreamRef = useRef<MediaStream | null>(null);
  const adminIceUnsubscribeRef = useRef<(() => void) | null>(null);
  const adminProcessedIceIdsRef = useRef<Set<string>>(new Set());

  const cleanupAdminCall = () => {
    adminIceUnsubscribeRef.current?.();
    adminIceUnsubscribeRef.current = null;
    adminProcessedIceIdsRef.current.clear();
    adminPeerConnectionRef.current?.close();
    adminPeerConnectionRef.current = null;
    adminMediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    adminMediaStreamRef.current = null;
  };

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "calls"),
      (snapshot) => {
        const activeCalls = snapshot.docs
          .map((docSnap): IncomingCall & { startedAt: number } => {
            const data = docSnap.data();
            return {
              roomId: docSnap.id,
              guestName: data.guestName || "Guest",
              status: data.status || "ended",
              offer: data.offer || undefined,
              startedAt: data.startedAt?.toMillis ? data.startedAt.toMillis() : 0
            };
          })
          .filter((call) =>
            (call.status === "ringing" || call.status === "active") && !!call.roomId
          )
          .sort((a, b) => b.startedAt - a.startedAt);

        const nextCall = activeCalls[0] || null;
        setIncomingCall(nextCall);
        if (!nextCall) {
          cleanupAdminCall();
        }
      },
      (error) => {
        console.error("Error listening to WebRTC calls:", error);
      }
    );

    return () => {
      unsubscribe();
      cleanupAdminCall();
    };
  }, []);

  const triggerIncomingCall = async (roomId: string, guestName: string) => {
    if (!roomId) return;
    await setDoc(doc(db, "calls", roomId), {
      answer: null,
      status: "ringing",
      guestName,
      startedAt: serverTimestamp(),
      endedAt: null
    }, { merge: true });
  };

  const acceptCall = async () => {
    if (!incomingCall) return;

    try {
      const callRef = doc(db, "calls", incomingCall.roomId);

      if (!incomingCall.offer) {
        await updateDoc(callRef, {
          status: "active",
          endedAt: null
        });
        return;
      }

      cleanupAdminCall();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      adminMediaStreamRef.current = stream;

      const peerConnection = new RTCPeerConnection(rtcConfiguration);
      adminPeerConnectionRef.current = peerConnection;
      stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

      peerConnection.onicecandidate = (event) => {
        if (!event.candidate) return;
        void addDoc(collection(db, "calls", incomingCall.roomId, "iceCandidates"), {
          candidate: event.candidate.toJSON(),
          from: "staff",
          createdAt: serverTimestamp()
        });
      };

      await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);

      adminIceUnsubscribeRef.current = onSnapshot(
        collection(db, "calls", incomingCall.roomId, "iceCandidates"),
        (snapshot) => {
          snapshot.docChanges().forEach((change) => {
            if (change.type !== "added") return;
            const data = change.doc.data();
            if (data.from !== "guest" || adminProcessedIceIdsRef.current.has(change.doc.id)) return;
            adminProcessedIceIdsRef.current.add(change.doc.id);
            if (data.candidate) {
              void peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            }
          });
        }
      );

      await updateDoc(callRef, {
        answer: {
          type: answer.type,
          sdp: answer.sdp
        },
        status: "active",
        endedAt: null
      });
    } catch (error) {
      console.error("Error accepting WebRTC call:", error);
      cleanupAdminCall();
      await updateDoc(doc(db, "calls", incomingCall.roomId), {
        status: "ended",
        endedAt: serverTimestamp()
      });
    }
  };

  const declineCall = async () => {
    if (!incomingCall) return;
    cleanupAdminCall();
    await updateDoc(doc(db, "calls", incomingCall.roomId), {
      status: "ended",
      endedAt: serverTimestamp()
    });
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

  // Subscribe to all settings documents from Firestore
  useEffect(() => {
    const settingsRef = collection(db, "settings");
    const unsubscribe = onSnapshot(
      settingsRef,
      (snapshot) => {
        snapshot.forEach((docSnap) => {
          const data = docSnap.data();
          const docId = docSnap.id;
          switch (docId) {
            case "hotelConfig":
              setHotelConfig(data as typeof hotelConfig);
              break;
            case "websiteContent":
              setWebsiteContent(data as typeof websiteContent);
              break;
            case "rewardsConfig":
              setRewardsConfig(data as typeof rewardsConfig);
              break;
            case "breakfastConfig":
              setBreakfastConfig(data as typeof breakfastConfig);
              break;
            case "storeConfig":
              setStoreConfig(data as typeof storeConfig);
              break;
          }
        });
      },
      (error) => {
        console.error("Error listening to settings collection:", error);
      }
    );
    return unsubscribe;
  }, []);

  const updateSettings = async (section: string, data: any) => {
    try {
      const docRef = doc(db, "settings", section);
      await setDoc(docRef, data, { merge: true });
    } catch (error) {
      console.error(`Error updating ${section}:`, error);
      alert(`Failed to save settings: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
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
        intercomThreads,
        sendIntercomMessage,
        markChatAsRead,
        setIntercomResolved,
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
