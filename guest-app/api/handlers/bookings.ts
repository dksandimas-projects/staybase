import { adminDb } from "../lib/firebase-admin";
import { sendBookingTrigger } from "./email";
import config from "../../../hotel.config";

interface GuestDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  requests?: string;
  consent: boolean;
  companyName?: string;
  designation?: string;
  companyAddress?: string;
  numRooms?: number;
  purposeOfStay?: string;
  preferredBillingArrangement?: string;
}

interface CreateBookingBody {
  bookingId: string;
  roomId: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  guests: number;
  hasBreakfast: boolean;
  guestDetails: GuestDetails;
  discountType: "" | "senior" | "pwd";
  discountIdPhotoUrl: string | null;
  voucherCode?: string;
  paymentMethod: string;
  paymentProofUrl?: string | null;
  isCorporate: boolean;
  corporateCode?: string;
}

function getManilaDateInfo() {
  const d = new Date();
  const manilaStr = d.toLocaleString("en-US", { timeZone: "Asia/Manila" });
  const manilaDate = new Date(manilaStr);
  const year = manilaDate.getFullYear();
  const month = String(manilaDate.getMonth() + 1).padStart(2, "0");
  const day = String(manilaDate.getDate()).padStart(2, "0");
  return {
    todayStr: `${year}-${month}-${day}`,
    todayCompact: `${year}${month}${day}`,
    manilaDate
  };
}

export async function handleCreateBooking(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = req.body as CreateBookingBody;
  if (!body) {
    return res.status(400).json({ success: false, error: "Invalid request body." });
  }

  const {
    bookingId,
    roomId,
    checkIn,
    checkOut,
    guests,
    hasBreakfast,
    guestDetails,
    discountType,
    discountIdPhotoUrl,
    voucherCode,
    paymentMethod,
    paymentProofUrl,
    isCorporate,
    corporateCode
  } = body;

  // Basic Input Validation
  if (!bookingId || !roomId || !checkIn || !checkOut || !guests || !guestDetails) {
    return res.status(400).json({ success: false, error: "Missing required booking fields." });
  }

  if (!guestDetails.consent) {
    return res.status(400).json({ success: false, error: "Privacy policy consent is required." });
  }

  const checkInDate = new Date(`${checkIn}T00:00:00Z`);
  const checkOutDate = new Date(`${checkOut}T00:00:00Z`);

  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime()) || checkOutDate <= checkInDate) {
    return res.status(400).json({ success: false, error: "Invalid check-in or check-out date." });
  }

  // Calculate nights
  const startMs = checkInDate.getTime();
  const endMs = checkOutDate.getTime();
  const numNights = Math.max(Math.round((endMs - startMs) / 86400000), 0);
  if (numNights < 1) {
    return res.status(400).json({ success: false, error: "Stay must be at least 1 night." });
  }

  try {
    let finalBookingRef = "";
    let finalTotalPrice = 0;
    let computedData: any = {};

    // Run Firestore Transaction
    await adminDb.runTransaction(async (transaction) => {
      // 1. Fetch Room Details
      const roomRef = adminDb.collection("rooms").doc(roomId);
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists) {
        throw new Error("Room not found");
      }
      const roomData = roomDoc.data()!;
      if (!roomData.isActive) {
        throw new Error("Room is inactive");
      }
      if (roomData.status === "blocked") {
        throw new Error("Room no longer available");
      }
      if (guests > roomData.maxCapacity) {
        throw new Error(`Guest count exceeds room capacity of ${roomData.maxCapacity}.`);
      }

      // 2. Overlapping Booking Check
      const bookingsQuery = adminDb.collection("bookings")
        .where("roomId", "==", roomId)
        .where("status", "!=", "cancelled");
      const bookingsSnapshot = await transaction.get(bookingsQuery);
      
      const hasConflict = bookingsSnapshot.docs.some((doc) => {
        const data = doc.data();
        const existingCheckIn = data.checkIn.toDate();
        const existingCheckOut = data.checkOut.toDate();
        return existingCheckIn < checkOutDate && existingCheckOut > checkInDate;
      });

      if (hasConflict) {
        throw new Error("Room no longer available");
      }

      // 3. Fetch Breakfast Settings
      const breakfastConfigRef = adminDb.collection("settings").doc("breakfastConfig");
      const breakfastConfigDoc = await transaction.get(breakfastConfigRef);
      const breakfastConfig = breakfastConfigDoc.exists ? breakfastConfigDoc.data()! : { isEnabled: false, ratePerPersonPerNight: 250 };
      const actualBreakfastRate = breakfastConfig.isEnabled ? (breakfastConfig.ratePerPersonPerNight || 250) : 0;

      // 4. Handle Corporate Code validation if corporate is true
      let activeRoomRate = roomData.pricePerNight;
      let corporateDetails: any = { isCorporate: false, corporateCode: "", companyName: "" };

      if (isCorporate) {
        corporateDetails.isCorporate = true;
        corporateDetails.companyName = guestDetails.companyName || "";
        if (corporateCode) {
          corporateDetails.corporateCode = corporateCode;
          const corpCodeRef = adminDb.collection("corporateCodes").doc(corporateCode);
          const corpCodeDoc = await transaction.get(corpCodeRef);
          if (corpCodeDoc.exists) {
            const corpData = corpCodeDoc.data()!;
            if (corpData.isActive && (!corpData.expiresAt || corpData.expiresAt.toDate() > new Date())) {
              if (corpData.ratePerRoomType && corpData.ratePerRoomType[roomData.type] !== undefined) {
                activeRoomRate = corpData.ratePerRoomType[roomData.type];
              } else {
                activeRoomRate = roomData.corporateRate || roomData.pricePerNight;
              }
            } else {
              activeRoomRate = roomData.corporateRate || roomData.pricePerNight;
            }
          } else {
            activeRoomRate = roomData.corporateRate || roomData.pricePerNight;
          }
        } else {
          activeRoomRate = roomData.corporateRate || roomData.pricePerNight;
        }
      }

      // 5. Calculate Nightly Rate Total (support weekend rate)
      let roomTotal = 0;
      const dateCursor = new Date(checkInDate);
      for (let i = 0; i < numNights; i++) {
        // check if weekend night (Friday or Saturday night? Or Saturday or Sunday night per shared/utils/dates.ts)
        // Let's check: shared/utils/dates.ts checks day === 0 (Sun) or day === 6 (Sat)
        const day = dateCursor.getUTCDay();
        const isWeekend = day === 0 || day === 6;
        if (isWeekend && !isCorporate && roomData.weekendRate) {
          roomTotal += roomData.weekendRate;
        } else {
          roomTotal += activeRoomRate;
        }
        dateCursor.setUTCDate(dateCursor.getUTCDate() + 1);
      }

      // 6. Calculate Breakfast Add-on
      const finalHasBreakfast = breakfastConfig.isEnabled && hasBreakfast;
      const breakfastTotal = finalHasBreakfast ? actualBreakfastRate * guests * numNights : 0;
      const subtotal = roomTotal + breakfastTotal;

      // 7. Voucher Validation
      let voucherDiscount = 0;
      let appliedVoucherCode = "";
      if (voucherCode) {
        const formattedCode = voucherCode.trim().toUpperCase();
        const voucherRef = adminDb.collection("vouchers").doc(formattedCode);
        const voucherDoc = await transaction.get(voucherRef);
        if (voucherDoc.exists) {
          const vData = voucherDoc.data()!;
          const now = new Date();
          const isValid =
            vData.isActive !== false &&
            (!vData.expiresAt || vData.expiresAt.toDate() >= now) &&
            (vData.usageCap === null || (vData.usageCount || 0) < vData.usageCap) &&
            (!vData.applicableRoomTypes || vData.applicableRoomTypes.length === 0 || vData.applicableRoomTypes.includes(roomData.type));

          if (isValid) {
            appliedVoucherCode = formattedCode;
            if (vData.discountType === "percent") {
              voucherDiscount = Math.round(subtotal * (vData.discountValue / 100));
            } else {
              voucherDiscount = vData.discountValue;
            }
            voucherDiscount = Math.min(Math.max(voucherDiscount, 0), subtotal);

            // Increment voucher usage
            transaction.update(voucherRef, {
              usageCount: (vData.usageCount || 0) + 1,
              updatedAt: new Date()
            });
          }
        }
      }

      // 8. Government Discount Validation
      let discountPct = 0;
      if (discountType === "senior" || discountType === "pwd") {
        discountPct = 20;
        // Verify discount ID is provided client-side
        if (!discountIdPhotoUrl) {
          throw new Error("Government-mandated discount requires verification ID photo.");
        }
      }

      const governmentDiscount = Math.round((subtotal - voucherDiscount) * (discountPct / 100));
      const totalDiscount = voucherDiscount + governmentDiscount;
      const totalPrice = Math.max(subtotal - totalDiscount, 0);

      // Pre-discount total to restore if discount is rejected
      const originalTotalPrice = discountPct > 0 ? (subtotal - voucherDiscount) : null;

      // 9. Generate Reference Number
      const { todayStr, todayCompact } = getManilaDateInfo();
      const counterRef = adminDb.collection("counters").doc(`bookings-${todayStr}`);
      const counterDoc = await transaction.get(counterRef);
      let sequence = 1;
      if (counterDoc.exists) {
        sequence = (counterDoc.data()?.count || 0) + 1;
        transaction.update(counterRef, { count: sequence });
      } else {
        transaction.set(counterRef, { count: 1 });
      }

      const bookingRef = `${config.bookingRefPrefix || "SI"}-${todayCompact}-${String(sequence).padStart(3, "0")}`;

      // Save output for outer scope
      finalBookingRef = bookingRef;
      finalTotalPrice = totalPrice;

      // 10. Prepare Document Fields
      const guestName = `${guestDetails.firstName.trim()} ${guestDetails.lastName.trim()}`;
      
      const newBooking = {
        bookingRef,
        roomId,
        roomNumber: roomData.roomNumber,
        roomType: roomData.type,
        guestName,
        guestEmail: guestDetails.email.trim().toLowerCase(),
        guestPhone: guestDetails.phone.trim(),
        numGuests: guests,
        checkIn: adminDb.doc(`rooms/${roomId}`).firestore.valueType ? checkInDate : checkInDate, // Firestore Timestamps
        checkOut: checkOutDate,
        numNights,
        ratePerNight: activeRoomRate,
        totalPrice,
        originalTotalPrice,
        discountType: discountType || "",
        discountPct,
        discountIdPhotoUrl: discountIdPhotoUrl || null,
        discountVerified: false,
        discountVerifiedBy: null,
        discountRejected: false,
        discountRejectedBy: null,
        discountRejectionReason: "",
        voucherCode: appliedVoucherCode,
        voucherDiscount,
        isCorporate: corporateDetails.isCorporate,
        corporateCode: corporateDetails.corporateCode,
        companyName: corporateDetails.companyName,
        specialRequests: guestDetails.requests || "",
        status: paymentProofUrl ? "payment-uploaded" : "pending",
        paymentMethod,
        paymentProofUrl: paymentProofUrl || "",
        source: isCorporate ? "corporate" : "online",
        notes: "",
        handledBy: "",
        memberId: null,
        pointsRedeemed: 0,
        pointsRedeemedValue: 0,
        pointsRedeemedBy: null,
        pointsRedeemedAt: null,
        hasBreakfast: finalHasBreakfast,
        breakfastRate: finalHasBreakfast ? actualBreakfastRate : 0,
        guestIdPhotoUrl: null,
        guestRegistration: null,
        breakfastSelections: {},
        cancellationReason: "",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const bookingDocRef = adminDb.collection("bookings").doc(bookingId);
      transaction.set(bookingDocRef, newBooking);

      computedData = {
        guestName,
        email: guestDetails.email.trim().toLowerCase(),
        roomName: roomData.name,
        roomNumber: roomData.roomNumber,
        checkIn,
        checkOut,
        numNights,
        totalPrice
      };
    });

    // Send acknowledgment email outside the transaction via Resend
    try {
      await sendBookingTrigger("booking-submitted", {
        ...computedData,
        bookingRef: finalBookingRef,
        guestEmail: computedData.email,
        paymentMethod
      });
    } catch (emailErr) {
      // Log email error, but do not fail the request since booking document is already written successfully
      console.error("Failed to send acknowledgment email:", emailErr);
    }

    return res.status(200).json({
      success: true,
      data: {
        bookingId,
        bookingRef: finalBookingRef
      }
    });

  } catch (error: any) {
    console.error("Booking creation failed:", error);
    const status = error.message === "Room no longer available" ? 409 : 500;
    return res.status(status).json({
      success: false,
      error: error.message || "An unexpected error occurred during booking creation."
    });
  }
}

export async function handleCreateWalkin(req: any, res: any) {
  const body = req.body;
  if (!body) {
    return res.status(400).json({ success: false, error: "Invalid request body." });
  }

  const {
    bookingId,
    roomId,
    checkIn,
    checkOut,
    guests,
    hasBreakfast,
    guestDetails,
    paymentMethod,
    status,
    totalPriceOverride
  } = body;

  if (!bookingId || !roomId || !checkIn || !checkOut || !guests || !guestDetails) {
    return res.status(400).json({ success: false, error: "Missing required booking fields." });
  }

  const checkInDate = new Date(`${checkIn}T00:00:00Z`);
  const checkOutDate = new Date(`${checkOut}T00:00:00Z`);

  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime()) || checkOutDate <= checkInDate) {
    return res.status(400).json({ success: false, error: "Invalid check-in or check-out date." });
  }

  const startMs = checkInDate.getTime();
  const endMs = checkOutDate.getTime();
  const numNights = Math.max(Math.round((endMs - startMs) / 86400000), 0);
  if (numNights < 1) {
    return res.status(400).json({ success: false, error: "Stay must be at least 1 night." });
  }

  try {
    let finalBookingRef = "";
    let finalTotalPrice = 0;
    let newBooking: Record<string, any> | null = null;

    await adminDb.runTransaction(async (transaction) => {
      // 1. Fetch Room Details
      const roomRef = adminDb.collection("rooms").doc(roomId);
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists) {
        throw new Error("Room not found");
      }
      const roomData = roomDoc.data()!;
      if (!roomData.isActive) {
        throw new Error("Room is inactive");
      }
      if (roomData.status === "blocked") {
        throw new Error("Room no longer available");
      }
      if (guests > roomData.maxCapacity) {
        throw new Error(`Guest count exceeds room capacity of ${roomData.maxCapacity}.`);
      }

      // 2. Overlapping Booking Check
      const bookingsQuery = adminDb.collection("bookings")
        .where("roomId", "==", roomId)
        .where("status", "!=", "cancelled");
      const bookingsSnapshot = await transaction.get(bookingsQuery);
      
      const hasConflict = bookingsSnapshot.docs.some((doc) => {
        const data = doc.data();
        const existingCheckIn = data.checkIn.toDate();
        const existingCheckOut = data.checkOut.toDate();
        return existingCheckIn < checkOutDate && existingCheckOut > checkInDate;
      });

      if (hasConflict) {
        throw new Error("Room no longer available");
      }

      // 3. Fetch Breakfast Settings
      const breakfastConfigRef = adminDb.collection("settings").doc("breakfastConfig");
      const breakfastConfigDoc = await transaction.get(breakfastConfigRef);
      const breakfastConfig = breakfastConfigDoc.exists ? breakfastConfigDoc.data()! : { isEnabled: false, ratePerPersonPerNight: 250 };
      const actualBreakfastRate = breakfastConfig.isEnabled ? (breakfastConfig.ratePerPersonPerNight || 250) : 0;

      // 4. Calculate Nightly Rate Total (weekend rate check)
      let roomTotal = 0;
      const dateCursor = new Date(checkInDate);
      for (let i = 0; i < numNights; i++) {
        const day = dateCursor.getUTCDay();
        const isWeekend = day === 0 || day === 6;
        if (isWeekend && roomData.weekendRate) {
          roomTotal += roomData.weekendRate;
        } else {
          roomTotal += roomData.pricePerNight;
        }
        dateCursor.setUTCDate(dateCursor.getUTCDate() + 1);
      }

      // 5. Calculate Breakfast Add-on
      const finalHasBreakfast = breakfastConfig.isEnabled && hasBreakfast;
      const breakfastTotal = finalHasBreakfast ? actualBreakfastRate * guests * numNights : 0;
      const subtotal = roomTotal + breakfastTotal;

      // Pricing Overrides: Use staff override if provided, otherwise standard computed
      if (totalPriceOverride !== undefined && totalPriceOverride !== null) {
        finalTotalPrice = Number(totalPriceOverride);
      } else {
        finalTotalPrice = subtotal;
      }

      // 6. Generate Reference Number
      const { todayStr, todayCompact } = getManilaDateInfo();
      const counterRef = adminDb.collection("counters").doc(`bookings-${todayStr}`);
      const counterDoc = await transaction.get(counterRef);
      let sequence = 1;
      if (counterDoc.exists) {
        sequence = (counterDoc.data()?.count || 0) + 1;
        transaction.update(counterRef, { count: sequence });
      } else {
        transaction.set(counterRef, { count: 1 });
      }

      const bookingRef = `${config.bookingRefPrefix || "SI"}-${todayCompact}-${String(sequence).padStart(3, "0")}`;
      finalBookingRef = bookingRef;

      // 7. Prepare Document Fields
      const guestName = `${guestDetails.firstName.trim()} ${guestDetails.lastName.trim()}`;
      
      newBooking = {
        bookingRef,
        roomId,
        roomNumber: roomData.roomNumber,
        roomType: roomData.type,
        guestName,
        guestEmail: guestDetails.email.trim().toLowerCase(),
        guestPhone: guestDetails.phone.trim(),
        numGuests: guests,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        numNights,
        ratePerNight: roomData.pricePerNight,
        totalPrice: finalTotalPrice,
        originalTotalPrice: subtotal,
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
        specialRequests: guestDetails.requests || "",
        status: status || "confirmed",
        paymentMethod,
        paymentProofUrl: "",
        source: "walk-in",
        notes: "Created on-site at Front Desk.",
        handledBy: req.staff.uid || "staff",
        memberId: null,
        pointsRedeemed: 0,
        pointsRedeemedValue: 0,
        pointsRedeemedBy: null,
        pointsRedeemedAt: null,
        hasBreakfast: finalHasBreakfast,
        breakfastRate: finalHasBreakfast ? actualBreakfastRate : 0,
        guestIdPhotoUrl: null,
        guestRegistration: null,
        breakfastSelections: {},
        cancellationReason: "",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Auto update room status if immediate check-in
      if (status === "checked-in") {
        transaction.update(roomRef, { status: "occupied" });
      }

      const bookingDocRef = adminDb.collection("bookings").doc(bookingId);
      transaction.set(bookingDocRef, newBooking);
    });

    const resolvedStatus = status || "confirmed";
    if (resolvedStatus === "confirmed" && newBooking) {
      try {
        await sendBookingTrigger("booking-confirmed", { ...newBooking, status: "confirmed" });
      } catch (emailErr) {
        console.error("Failed to send walk-in booking confirmation email:", emailErr);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        bookingId,
        bookingRef: finalBookingRef
      }
    });

  } catch (error: any) {
    console.error("Walk-in booking creation failed:", error);
    const status = error.message === "Room no longer available" ? 409 : 500;
    return res.status(status).json({
      success: false,
      error: error.message || "An unexpected error occurred during walk-in booking creation."
    });
  }
}

export async function handleRejectDiscount(req: any, res: any) {
  const { bookingId, reason } = req.body;
  if (!bookingId) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }

    const bookingData = bookingDoc.data()!;
    if (!bookingData.discountType) {
      return res.status(400).json({ success: false, error: "Booking does not have an active government discount request." });
    }

    const originalTotalPrice = bookingData.originalTotalPrice;
    if (originalTotalPrice === null || originalTotalPrice === undefined) {
      return res.status(500).json({ success: false, error: "Original total price not stored on booking." });
    }

    const updates = {
      discountRejected: true,
      discountRejectedBy: req.staff.email || "staff",
      discountRejectionReason: reason || "",
      discountPct: 0,
      totalPrice: originalTotalPrice,
      status: "pending",
      updatedAt: new Date()
    };

    await bookingRef.update(updates);

    try {
      await sendBookingTrigger("discount-rejected", {
        ...bookingData,
        discountRejectionReason: reason || "",
        totalPrice: originalTotalPrice
      });
    } catch (emailErr) {
      console.error("Failed to send discount rejection email:", emailErr);
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Discount rejection handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleCancelBooking(req: any, res: any) {
  const { bookingId, bookingRef, guestEmail, reason } = req.body;

  try {
    let bookingDocumentRef: any;
    let bookingData: any;

    if (req.staff) {
      if (bookingId) {
        bookingDocumentRef = adminDb.collection("bookings").doc(bookingId);
      } else if (bookingRef) {
        const query = adminDb.collection("bookings").where("bookingRef", "==", bookingRef).limit(1);
        const snapshot = await query.get();
        if (snapshot.empty) {
          return res.status(404).json({ success: false, error: "Booking not found." });
        }
        bookingDocumentRef = snapshot.docs[0].ref;
      } else {
        return res.status(400).json({ success: false, error: "Booking ID or Reference is required." });
      }
      
      const doc = await bookingDocumentRef.get();
      if (!doc.exists) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }
      bookingData = doc.data();
    } else {
      if (!bookingRef || !guestEmail) {
        return res.status(400).json({ success: false, error: "Booking Reference and Guest Email are required." });
      }

      const query = adminDb.collection("bookings")
        .where("bookingRef", "==", bookingRef.trim())
        .where("guestEmail", "==", guestEmail.trim().toLowerCase())
        .limit(1);
      
      const snapshot = await query.get();
      if (snapshot.empty) {
        return res.status(404).json({ success: false, error: "Booking not found with matching email." });
      }
      
      bookingDocumentRef = snapshot.docs[0].ref;
      bookingData = snapshot.docs[0].data();
    }

    if (bookingData.status === "checked-in" || bookingData.status === "checked-out" || bookingData.status === "cancelled") {
      return res.status(400).json({ success: false, error: `Booking cannot be cancelled because its status is already ${bookingData.status}.` });
    }

    await bookingDocumentRef.update({
      status: "cancelled",
      cancellationReason: reason || "",
      updatedAt: new Date()
    });

    try {
      await sendBookingTrigger("booking-cancelled", {
        ...bookingData,
        cancellationReason: reason || ""
      });
    } catch (emailErr) {
      console.error("Failed to send cancellation email:", emailErr);
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Booking cancellation handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleAddPayment(req: any, res: any) {
  const { bookingId, amount, method, note } = req.body;
  if (!bookingId || amount === undefined || !method) {
    return res.status(400).json({ success: false, error: "Booking ID, amount, and payment method are required." });
  }

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }

    const bookingData = bookingDoc.data()!;
    const numericAmount = Number(amount);

    const paymentRecord = {
      amount: numericAmount,
      method,
      note: note || "",
      recordedBy: req.staff.email || "staff",
      recordedAt: new Date()
    };

    await bookingRef.collection("payments").add(paymentRecord);

    try {
      const paymentsSnapshot = await bookingRef.collection("payments").get();
      const totalPaid = paymentsSnapshot.docs.reduce((sum, doc) => {
        const data = doc.data() as { amount?: number };
        return sum + Number(data.amount || 0);
      }, 0);

      const totalPrice = Number(bookingData.totalPrice || 0);
      const fullyPaid = totalPrice > 0 && totalPaid >= totalPrice;
      const isConfirmableStatus = bookingData.status === "pending" || bookingData.status === "payment-uploaded";

      if (fullyPaid && isConfirmableStatus) {
        await sendBookingTrigger("payment-confirmed", bookingData);
      }
    } catch (emailErr) {
      console.error("Failed to send payment confirmation email:", emailErr);
    }

    return res.status(200).json({ success: true, data: paymentRecord });
  } catch (error: any) {
    console.error("Add payment handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleConfirmBooking(req: any, res: any) {
  const { bookingId } = req.body;
  if (!bookingId) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }

    const bookingData = bookingDoc.data()!;
    const allowedStatuses = ["pending", "payment-uploaded"];
    if (!allowedStatuses.includes(bookingData.status)) {
      return res.status(400).json({
        success: false,
        error: `Booking cannot be confirmed because its status is already ${bookingData.status}.`
      });
    }

    const confirmedBy = req.staff?.email || "staff";
    await bookingRef.update({
      status: "confirmed",
      confirmedAt: new Date(),
      confirmedBy,
      updatedAt: new Date()
    });

    try {
      await sendBookingTrigger("booking-confirmed", { ...bookingData, status: "confirmed" });
    } catch (emailErr) {
      console.error("Failed to send booking confirmation email:", emailErr);
    }

    return res.status(200).json({ success: true, data: { status: "confirmed" } });
  } catch (error: any) {
    console.error("Confirm booking handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleCheckoutBooking(req: any, res: any) {
  const { bookingId } = req.body;
  if (!bookingId) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const bookingDoc = await bookingRef.get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }

    const bookingData = bookingDoc.data()!;
    if (bookingData.status !== "checked-in") {
      return res.status(400).json({
        success: false,
        error: `Booking can only be checked out from 'checked-in' status (current: ${bookingData.status}).`
      });
    }

    const checkedOutBy = req.staff?.email || "staff";
    const totalPrice = Number(bookingData.totalPrice || 0);

    let pointsAwarded = 0;
    let memberId: string | null = bookingData.memberId || null;
    let rewardsConfig: any = null;

    // Try to find member either by memberId (if booking is already linked) or by guestEmail
    let memberDoc: any = null;
    if (memberId) {
      memberDoc = await adminDb.collection("members").doc(memberId).get();
    }
    if (!memberDoc?.exists && bookingData.guestEmail) {
      const guestEmail = String(bookingData.guestEmail).toLowerCase();
      const membersSnap = await adminDb.collection("members")
        .where("email", "==", guestEmail)
        .limit(1)
        .get();
      if (!membersSnap.empty) {
        memberDoc = membersSnap.docs[0];
        memberId = memberDoc.id;
        // Persist the link for future use
        await bookingRef.update({ memberId });
      }
    }

    if (memberDoc?.exists) {
      const rewardsDoc = await adminDb.collection("settings").doc("rewardsConfig").get();
      rewardsConfig = rewardsDoc.exists ? rewardsDoc.data() : null;
      const pointsEnabled = rewardsConfig?.pointsEnabled !== false;

      if (pointsEnabled && rewardsConfig) {
        const earningMode = rewardsConfig.earningMode || "per-spend";
        if (earningMode === "per-spend") {
          const pointsPerHundred = Number(rewardsConfig.pointsPerHundred || 0);
          pointsAwarded = Math.floor((totalPrice / 100) * pointsPerHundred);
        } else {
          pointsAwarded = Number(rewardsConfig.pointsPerBooking || 0);
        }
      }
    }

    await adminDb.runTransaction(async (transaction) => {
      transaction.update(bookingRef, {
        status: "checked-out",
        checkedOutAt: new Date(),
        checkedOutBy,
        pointsAwarded,
        updatedAt: new Date()
      });

      if (bookingData.roomId) {
        const roomRef = adminDb.collection("rooms").doc(String(bookingData.roomId));
        transaction.update(roomRef, {
          status: "available",
          housekeepingStatus: "dirty",
          updatedAt: new Date()
        });
      }

      if (memberId && pointsAwarded > 0) {
        const memberRef = adminDb.collection("members").doc(memberId);
        const memberDoc = await transaction.get(memberRef);
        if (memberDoc.exists) {
          const currentPoints = Number(memberDoc.data()?.rewardsPoints || 0);
          transaction.update(memberRef, {
            rewardsPoints: currentPoints + pointsAwarded,
            updatedAt: new Date()
          });

          const historyRef = adminDb.collection("members").doc(memberId).collection("pointsHistory").doc();
          transaction.set(historyRef, {
            type: "earn",
            points: pointsAwarded,
            bookingId,
            bookingRef: bookingData.bookingRef,
            description: `Stay Checkout Earnings (${bookingData.bookingRef})`,
            by: checkedOutBy,
            createdAt: new Date()
          });
        }
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        status: "checked-out",
        pointsAwarded,
        memberId
      }
    });
  } catch (error: any) {
    console.error("Checkout booking handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}

export async function handleLookupBooking(req: any, res: any) {
  const { bookingRef, guestEmail } = req.body || {};
  if (!bookingRef || !guestEmail) {
    return res.status(400).json({ success: false, error: "Booking reference and guest email are required." });
  }

  const trimmedRef = String(bookingRef).trim();
  const normalizedEmail = String(guestEmail).trim().toLowerCase();

  try {
    const snapshot = await adminDb.collection("bookings")
      .where("bookingRef", "==", trimmedRef)
      .where("guestEmail", "==", normalizedEmail)
      .limit(1)
      .get();

    if (snapshot.empty) {
      const fallbackSnapshot = await adminDb.collection("bookings")
        .where("bookingRef", "==", trimmedRef)
        .limit(5)
        .get();

      const matched = fallbackSnapshot.docs.find((doc: any) => {
        const data = doc.data();
        return String(data.guestEmail || "").trim().toLowerCase() === normalizedEmail;
      });

      if (!matched) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }

      const bookingData: any = { id: matched.id, ...matched.data() };
      return await enrichAndRespond(res, bookingData);
    }

    const bookingDoc = snapshot.docs[0];
    const bookingData: any = { id: bookingDoc.id, ...bookingDoc.data() };
    return await enrichAndRespond(res, bookingData);
  } catch (error: any) {
    console.error("Booking lookup failed:", error);
    return res.status(500).json({ success: false, error: "Unable to look up booking. Please try again." });
  }
}

async function enrichAndRespond(res: any, bookingData: any) {
  let roomData: any = null;
  if (bookingData.roomId) {
    try {
      const roomDoc = await adminDb.collection("rooms").doc(String(bookingData.roomId)).get();
      if (roomDoc.exists) {
        roomData = roomDoc.data();
      }
    } catch (roomErr) {
      console.error("Failed to enrich booking with room data:", roomErr);
    }
  }

  return res.status(200).json({
    success: true,
    data: {
      id: bookingData.id,
      bookingRef: bookingData.bookingRef,
      guestName: bookingData.guestName,
      guestEmail: bookingData.guestEmail,
      guestPhone: bookingData.guestPhone,
      roomId: bookingData.roomId,
      roomNumber: bookingData.roomNumber,
      roomName: roomData?.name || bookingData.roomType || "",
      roomType: bookingData.roomType,
      checkIn: bookingData.checkIn,
      checkOut: bookingData.checkOut,
      numNights: bookingData.numNights,
      numGuests: bookingData.numGuests,
      ratePerNight: bookingData.ratePerNight,
      totalPrice: bookingData.totalPrice,
      paymentMethod: bookingData.paymentMethod,
      status: bookingData.status,
      hasBreakfast: bookingData.hasBreakfast,
      specialRequests: bookingData.specialRequests || ""
    }
  });
}
