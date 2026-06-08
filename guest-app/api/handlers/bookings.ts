import { adminDb } from "../lib/firebase-admin";
import { resend } from "../lib/resend";
import { calculateBookingTotal } from "@spark-inn/shared";
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
        guestEmail: guestDetails.email.trim(),
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
        email: guestDetails.email.trim(),
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
      const { guestName, email, roomName, roomNumber } = computedData;
      const paymentMsg = paymentMethod === "pay-at-hotel"
        ? "<p><strong>Payment Method:</strong> Pay at Hotel (Present this confirmation at check-in. Payment is due upon arrival.)</p>"
        : `<p><strong>Payment Method:</strong> ${paymentMethod.toUpperCase()}</p>
           <p><strong>⚠️ Payment Verification:</strong> Your uploaded proof of payment is under review. Our team will verify it within 24 hours.</p>`;

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #111827; padding: 24px; text-align: center;">
            <h1 style="color: #EA8A1A; margin: 0; font-size: 24px; text-transform: lowercase;">${config.brandName || "spark inn"}</h1>
          </div>
          <div style="padding: 24px;">
            <h2 style="color: #111827; margin-top: 0;">Booking Request Submitted</h2>
            <p>Dear ${guestName},</p>
            <p>Thank you for choosing <strong>${config.brandName || "spark inn"}</strong>. We have received your booking request, and it is currently <strong>under review</strong>.</p>
            
            <div style="background-color: #FEF3E2; border-left: 4px solid #EA8A1A; padding: 16px; margin: 20px 0; border-radius: 4px;">
              <p style="margin: 0; font-weight: bold; color: #C4720E;">⚠️ Review Notice</p>
              <p style="margin: 4px 0 0 0; font-size: 14px;">Your booking status is currently <strong>Pending Manual Review</strong>. We will review your reservation details and verify any payment receipts/discount IDs submitted. An official confirmation email will be sent once verified.</p>
            </div>

            <h3 style="border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; color: #111827;">Reservation Details</h3>
            <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Booking Reference</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right;">${finalBookingRef}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Room</td>
                <td style="padding: 6px 0; text-align: right;">Room ${roomNumber} — ${roomName}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Check-in Date</td>
                <td style="padding: 6px 0; text-align: right;">${checkIn} (from ${config.checkInTime || "14:00"})</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Check-out Date</td>
                <td style="padding: 6px 0; text-align: right;">${checkOut} (by ${config.checkOutTime || "12:00"})</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Nights</td>
                <td style="padding: 6px 0; text-align: right;">${numNights} night(s)</td>
              </tr>
              <tr style="border-top: 1px dashed #e5e7eb;">
                <td style="padding: 10px 0; font-weight: bold; color: #111827;">Total Price</td>
                <td style="padding: 10px 0; font-weight: bold; text-align: right; color: #EA8A1A; font-size: 16px;">₱${finalTotalPrice.toLocaleString()}</td>
              </tr>
            </table>

            <div style="margin-top: 20px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
              ${paymentMsg}
            </div>

            <p style="margin-top: 30px; font-size: 13px; color: #6b7280; text-align: center;">
              J. Borja St, Tagbilaran City, Bohol, 6300<br/>
              dpo: ${config.dpoEmail || "sparkinn.reservations@gmail.com"} | support: ${config.supportEmail || "sparkinn.dev@gmail.com"}
            </p>
          </div>
        </div>
      `;

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || "sparkinn.dev@gmail.com",
        to: email,
        subject: `[${config.brandName || "spark inn"}] Acknowledgment: Booking Submission ${finalBookingRef}`,
        html: emailHtml
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
      
      const newBooking = {
        bookingRef,
        roomId,
        roomNumber: roomData.roomNumber,
        roomType: roomData.type,
        guestName,
        guestEmail: guestDetails.email.trim(),
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
      const discountTypeLabel = bookingData.discountType === "senior" ? "Senior Citizen" : "PWD";
      const idLabel = bookingData.discountType === "senior" ? "OSCA Card" : "PWD ID";
      
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #111827; padding: 24px; text-align: center;">
            <h1 style="color: #EA8A1A; margin: 0; font-size: 24px; text-transform: lowercase;">${config.brandName || "spark inn"}</h1>
          </div>
          <div style="padding: 24px;">
            <h2 style="color: #DC2626; margin-top: 0;">Discount Verification Update</h2>
            <p>Dear ${bookingData.guestName},</p>
            <p>Thank you for your booking at <strong>${config.brandName || "spark inn"}</strong>. We have reviewed your submitted ID for the ${discountTypeLabel} discount on Booking <strong>${bookingData.bookingRef}</strong>.</p>
            
            <p>Unfortunately, we were unable to verify your ${discountTypeLabel} ID.</p>
            ${reason ? `<p style="background-color: #F9FAFB; padding: 12px; border-left: 4px solid #DC2626; border-radius: 4px; font-size: 14px;"><strong>Reason for rejection:</strong> ${reason}</p>` : ""}
            
            <p>Your booking remains confirmed. The full rate of <strong>₱${originalTotalPrice.toLocaleString()}</strong> will be collected upon check-in. Please note that we still welcome you to present a valid ${idLabel} at check-in for our team's manual review.</p>
            
            <h3 style="border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; color: #111827; margin-top: 24px;">Reservation Summary</h3>
            <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Booking Reference</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right;">${bookingData.bookingRef}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Check-in Date</td>
                <td style="padding: 6px 0; text-align: right;">${bookingData.checkIn instanceof Date ? bookingData.checkIn.toISOString().split("T")[0] : bookingData.checkIn.toDate().toISOString().split("T")[0]}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Check-out Date</td>
                <td style="padding: 6px 0; text-align: right;">${bookingData.checkOut instanceof Date ? bookingData.checkOut.toISOString().split("T")[0] : bookingData.checkOut.toDate().toISOString().split("T")[0]}</td>
              </tr>
              <tr style="border-top: 1px dashed #e5e7eb;">
                <td style="padding: 10px 0; font-weight: bold; color: #111827;">Updated Total Price</td>
                <td style="padding: 10px 0; font-weight: bold; text-align: right; color: #EA8A1A; font-size: 16px;">₱${originalTotalPrice.toLocaleString()}</td>
              </tr>
            </table>

            <p style="margin-top: 30px; font-size: 13px; color: #6b7280; text-align: center;">
              J. Borja St, Tagbilaran City, Bohol, 6300<br/>
              dpo: ${config.dpoEmail || "sparkinn.reservations@gmail.com"} | support: ${config.supportEmail || "sparkinn.dev@gmail.com"}
            </p>
          </div>
        </div>
      `;

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || "sparkinn.dev@gmail.com",
        to: bookingData.guestEmail,
        subject: `[${config.brandName || "spark inn"}] Discount Verification Update: ${bookingData.bookingRef}`,
        html: emailHtml
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
        .where("guestEmail", "==", guestEmail.trim())
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
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
          <div style="background-color: #111827; padding: 24px; text-align: center;">
            <h1 style="color: #EA8A1A; margin: 0; font-size: 24px; text-transform: lowercase;">${config.brandName || "spark inn"}</h1>
          </div>
          <div style="padding: 24px;">
            <h2 style="color: #DC2626; margin-top: 0;">Booking Cancelled</h2>
            <p>Dear ${bookingData.guestName},</p>
            <p>This email confirms that your reservation at <strong>${config.brandName || "spark inn"}</strong> has been <strong>cancelled</strong>.</p>
            
            <h3 style="border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; color: #111827;">Cancellation Details</h3>
            <table style="width: 100%; font-size: 14px; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Booking Reference</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right;">${bookingData.bookingRef}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #6b7280;">Reason for Cancellation</td>
                <td style="padding: 6px 0; text-align: right; font-style: italic;">${reason || "Not provided"}</td>
              </tr>
            </table>

            <p>If you did not request this cancellation or believe this is an error, please contact our support team immediately at ${config.supportEmail || "sparkinn.dev@gmail.com"}.</p>
            
            <p style="margin-top: 30px; font-size: 13px; color: #6b7280; text-align: center;">
              J. Borja St, Tagbilaran City, Bohol, 6300<br/>
              support: ${config.supportEmail || "sparkinn.dev@gmail.com"}
            </p>
          </div>
        </div>
      `;

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || "sparkinn.dev@gmail.com",
        to: bookingData.guestEmail,
        subject: `[${config.brandName || "spark inn"}] Booking Cancelled: ${bookingData.bookingRef}`,
        html: emailHtml
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

    const paymentRecord = {
      amount: Number(amount),
      method,
      note: note || "",
      recordedBy: req.staff.email || "staff",
      recordedAt: new Date()
    };

    await bookingRef.collection("payments").add(paymentRecord);

    return res.status(200).json({ success: true, data: paymentRecord });
  } catch (error: any) {
    console.error("Add payment handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }
}
