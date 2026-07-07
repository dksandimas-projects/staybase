import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../lib/firebase-admin";
import { sendCorporateInquiryTrigger, sendBookingTrigger } from "./email";
import { toDateOrNull, getManilaDateInfo, generateLookupToken } from "@spark-inn/shared";
import config from "../../../hotel.config";

const inquirySchema = z.object({
  companyName: z.string().trim().min(1).max(120),
  contactPerson: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(160),
  phone: z.string().trim().min(6).max(40),
  numRooms: z.coerce.number().int().min(1).max(500),
  preferredDates: z.string().trim().min(1).max(160),
  specialRequirements: z.string().trim().max(2000).optional().default("")
}).strict();

const convertInquirySchema = z.object({
  inquiryId: z.string().trim().min(1).max(160),
  bookingId: z.string().trim().min(1).max(120),
  roomId: z.string().trim().min(1).max(120),
  checkIn: z.string().trim().min(1).max(40),
  checkOut: z.string().trim().min(1).max(40),
  guests: z.coerce.number().int().min(1).max(20),
  hasBreakfast: z.boolean().optional().default(false),
  paymentMethod: z.string().trim().min(1).max(40).optional().default("chargeback"),
  // Optional negotiated rate override. When omitted, the handler
  // uses room.corporateRate. When a corporateCodes/{code} already
  // exists for this inquiry, the handler uses its
  // ratePerRoomType[roomType] if defined.
  ratePerNightOverride: z.coerce.number().min(0).max(1000000).optional().nullable()
}).strict();

export async function handleCreateCorporateInquiry(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const { _hp, turnstileToken, ...inquiryBody } = req.body || {};
  const parsed = inquirySchema.safeParse(inquiryBody);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please check the inquiry form and try again."
    });
  }

  const inquiry = {
    ...parsed.data,
    status: "new",
    handler: "",
    notes: [],
    accessCodeId: "",
    createdAt: new Date(),
    updatedAt: new Date()
  };

  try {
    const docRef = await adminDb.collection("corporateInquiries").add(inquiry);

    try {
      await sendCorporateInquiryTrigger({ id: docRef.id, ...inquiry });
    } catch (emailError) {
      console.error("Corporate inquiry notification failed:", emailError);
    }

    return res.status(200).json({
      success: true,
      data: { inquiryId: docRef.id }
    });
  } catch (error) {
    console.error("Corporate inquiry creation failed:", error);
    return res.status(500).json({
      success: false,
      error: "We could not submit your inquiry right now. Please try again."
    });
  }
}

// Per W2.14 / decision #102 / audit S4.2: staff can convert a
// `new` / `contacted` / `negotiating` corporate inquiry into a
// real `bookings` document. The booking is pre-filled from the
// inquiry (company, contact, dates, numRooms), linked back via
// `linkedInquiryId`, and the inquiry status flips to `converted`.
// The booking is `isCorporate: true` (server-derived) and
// `source: "corporate"` (per W2.15 / decision #103). The
// negotiated rate is sourced from the existing `corporateCodes/
// {accessCodeId}` document when one is attached, falling back
// to `room.corporateRate` and finally to `room.pricePerNight`.
export async function handleConvertInquiryToBooking(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = req.staff || {};
  if (!staff.uid) {
    return res.status(401).json({ success: false, error: "Staff authentication is required." });
  }

  const parsed = convertInquirySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please check the conversion details and try again."
    });
  }

  const {
    inquiryId,
    bookingId,
    roomId,
    checkIn,
    checkOut,
    guests,
    hasBreakfast,
    paymentMethod,
    ratePerNightOverride
  } = parsed.data;

  const checkInDate = new Date(`${checkIn}T00:00:00Z`);
  const checkOutDate = new Date(`${checkOut}T00:00:00Z`);

  if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime()) || checkOutDate <= checkInDate) {
    return res.status(400).json({ success: false, error: "Invalid check-in or check-out date." });
  }

  const numNights = Math.max(Math.round((checkOutDate.getTime() - checkInDate.getTime()) / 86400000), 0);
  if (numNights < 1) {
    return res.status(400).json({ success: false, error: "Stay must be at least 1 night." });
  }

  let finalBookingRef = "";
  let finalTotalPrice = 0;
  let newBooking: Record<string, any> | null = null;
  let inquirySnap: any = null;
  let roomSnap: any = null;
  let codeSnap: any = null;

  try {
    await adminDb.runTransaction(async (transaction) => {
      // 1. Inquiry
      const inquiryRef = adminDb.collection("corporateInquiries").doc(inquiryId);
      inquirySnap = await transaction.get(inquiryRef);
      if (!inquirySnap.exists) {
        throw new Error("Corporate inquiry not found.");
      }
      const inquiryData = inquirySnap.data();
      if (inquiryData.status === "converted") {
        throw new Error("Inquiry is already converted.");
      }
      if (inquiryData.status === "declined") {
        throw new Error("Cannot convert a declined inquiry.");
      }

      // 2. Room
      const roomRef = adminDb.collection("rooms").doc(roomId);
      roomSnap = await transaction.get(roomRef);
      if (!roomSnap.exists) {
        throw new Error("Room not found.");
      }
      const roomData = roomSnap.data();
      if (!roomData.isActive) {
        throw new Error("Room is inactive.");
      }
      if (roomData.status === "blocked") {
        const blockedFrom = toDateOrNull(roomData.blockedFrom);
        const blockedTo = toDateOrNull(roomData.blockedTo);
        const checkInDate = new Date(`${inquiryData.preferredDates.split(" to ")[0] || inquiryData.preferredDates}T00:00:00Z`);
        const checkOutDate = new Date(`${inquiryData.preferredDates.split(" to ")[1] || inquiryData.preferredDates}T00:00:00Z`);
        const windowActive = blockedFrom && blockedTo
          ? checkInDate < blockedTo && checkOutDate > blockedFrom
          : true;
        if (windowActive) {
          throw new Error("Room is blocked for the selected dates.");
        }
      }
      if (guests > roomData.maxCapacity) {
        throw new Error(`Guest count exceeds room capacity of ${roomData.maxCapacity}.`);
      }

      // 3. Overlapping booking check
      const bookingsQuery = adminDb.collection("bookings")
        .where("roomId", "==", roomId)
        .where("status", "!=", "cancelled");
      const bookingsSnapshot = await transaction.get(bookingsQuery);
      const hasConflict = bookingsSnapshot.docs.some((doc) => {
        const data = doc.data();
        const existingIn = data.checkIn?.toDate ? data.checkIn.toDate() : new Date(data.checkIn);
        const existingOut = data.checkOut?.toDate ? data.checkOut.toDate() : new Date(data.checkOut);
        return existingIn < checkOutDate && existingOut > checkInDate;
      });
      if (hasConflict) {
        throw new Error("Room no longer available for the selected dates.");
      }

      // 4. Breakfast config
      const breakfastConfigRef = adminDb.collection("settings").doc("breakfastConfig");
      const breakfastConfigDoc = await transaction.get(breakfastConfigRef);
      const breakfastConfig = breakfastConfigDoc.exists
        ? breakfastConfigDoc.data()!
        : { isEnabled: false, ratePerPersonPerNight: 250 };
      const actualBreakfastRate = breakfastConfig.isEnabled
        ? (breakfastConfig.ratePerPersonPerNight || 250)
        : 0;
      const finalHasBreakfast = !!hasBreakfast && breakfastConfig.isEnabled;

      // 5. Resolve negotiated rate
      // Order of precedence: explicit override > ratePerRoomType
      // from attached access code > room.corporateRate >
      // room.pricePerNight.
      let ratePerNight = Number(roomData.pricePerNight || 0);
      let codeUsageUpdate: { ref: any; data: any } | null = null;
      if (ratePerNightOverride !== undefined && ratePerNightOverride !== null) {
        ratePerNight = ratePerNightOverride;
      } else if (inquiryData.accessCodeId) {
        const codeRef = adminDb.collection("corporateCodes").doc(inquiryData.accessCodeId);
        codeSnap = await transaction.get(codeRef);
        if (codeSnap.exists) {
          const codeData = codeSnap.data();
          const rateMap = codeData.ratePerRoomType || {};
          if (rateMap[roomData.type] !== undefined) {
            ratePerNight = rateMap[roomData.type];
          } else if (roomData.corporateRate) {
            ratePerNight = roomData.corporateRate;
          }
          // Per BI-07 (booking-intercom audit 2026-07-06):
          // the convert-inquiry path shares the same
          // `usageCount` omission as the create path — a code
          // attached to an inquiry never advances its cap.
          // Increment in the same transaction so capped
          // codes used via the convert path also stop working
          // once their cap is hit.
          //
          // Per BR-06 (booking-flow audit 2026-07-08): defer
          // the write until after the counter read below. The
          // Firestore Admin SDK rejects reads after queued
          // writes, so writing here made every conversion of
          // a code-attached inquiry fail (same class as BR-01
          // in `handleCreateBooking`).
          codeUsageUpdate = {
            ref: codeRef,
            data: {
              usageCount: (codeData.usageCount || 0) + 1,
              updatedAt: new Date()
            }
          };
        } else if (roomData.corporateRate) {
          ratePerNight = roomData.corporateRate;
        }
      } else if (roomData.corporateRate) {
        ratePerNight = roomData.corporateRate;
      }

      // 6. Generate booking reference
      // Per BF-42 (booking-flow audit 2026-06-26): the
      // inline Asia/Manila date math that used to live here
      // now comes from the shared `getManilaDateInfo()`
      // helper (single source of truth across 5 handlers).
      const { todayStr, todayCompact } = getManilaDateInfo();
      const counterRef = adminDb.collection("counters").doc(`bookings-${todayStr}`);
      const counterDoc = await transaction.get(counterRef);
      let sequence = 1;
      if (counterDoc.exists) {
        sequence = (counterDoc.data()?.count || 0) + 1;
      }

      // BR-06: all transaction reads are done — apply the queued
      // writes together (code usage, counter, then the booking +
      // inquiry writes below).
      if (codeUsageUpdate) {
        transaction.update(codeUsageUpdate.ref, codeUsageUpdate.data);
      }
      if (counterDoc.exists) {
        transaction.update(counterRef, { count: sequence });
      } else {
        transaction.set(counterRef, { count: 1 });
      }
      // Per H3 (hardening batch 2026-06-26): sequence
      // width is now 5 digits. Mirrors the shared
      // `generateBookingRef` helper.
      const bookingRef = `${config.bookingRefPrefix || "SI"}-${todayCompact}-${String(sequence).padStart(5, "0")}`;
      finalBookingRef = bookingRef;

      // 7. Totals
      const roomTotal = ratePerNight * numNights;
      const breakfastTotal = finalHasBreakfast ? actualBreakfastRate * guests * numNights : 0;
      finalTotalPrice = roomTotal + breakfastTotal;

      // 8. Guest details from inquiry. Split `contactPerson` into
      // first/last; the inquiry is always a real contact, so the
      // [firstName, lastName] split is safe.
      const contactName = String(inquiryData.contactPerson || "").trim();
      const [firstName, ...rest] = contactName.split(/\s+/);
      const lastName = rest.length > 0 ? rest.join(" ") : "—";
      const guestName = `${firstName || "Corporate"} ${lastName}`.trim();
      const guestEmail = String(inquiryData.email || "").trim().toLowerCase();
      const guestPhone = String(inquiryData.phone || "").trim();
      const companyName = String(inquiryData.companyName || "").trim();

      newBooking = {
        bookingRef,
        roomId,
        roomNumber: roomData.roomNumber,
        roomType: roomData.type,
        guestName,
        guestEmail,
        guestPhone,
        numGuests: guests,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        numNights,
        ratePerNight,
        totalPrice: finalTotalPrice,
        originalTotalPrice: finalTotalPrice,
        // Per H2 (hardening batch 2026-06-26): the
        // corporate convert flow writes a token too so
        // the inquiry-to-booking email can carry the
        // lookup deep-link.
        lookupToken: generateLookupToken(),
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
        // Per W1.3 / decision #79: derived server-side from the
        // validated inquiry (a converted inquiry is always a
        // corporate account). corporateCode is the attached
        // access code if one was generated earlier.
        isCorporate: true,
        corporateCode: String(inquiryData.accessCodeId || ""),
        companyName,
        specialRequests: String(inquiryData.specialRequirements || ""),
        status: "confirmed",
        paymentMethod,
        // Per BF-45 (booking-flow audit 2026-06-26): write
        // `null` (not `""`) so the canonical "absent" value
        // is consistent with the online + walkin flows.
        paymentProofUrl: null,
        source: "corporate",
        notes: `Converted from corporate inquiry ${inquiryId} by ${staff.email || staff.uid}.`,
        handledBy: staff.uid,
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
        // Per W2.14 / decision #102: backlink to the source inquiry
        linkedInquiryId: inquiryId,
        // Per BI-11 (booking-intercom audit 2026-07-06): the
        // convert-inquiry path is always corporate, so the
        // corporate metadata block is written. The
        // `inquiryData` shape doesn't carry the same
        // designation / purposeOfStay fields the public
        // corporate form collects, so we persist what's
        // available: `specialRequirements` flows into
        // `purposeOfStay` (the closest semantic match) and
        // `companyName` is the company on the inquiry.
        // `billingArrangement` is implicit (inquiry is
        // always a chargeback) so we record "chargeback" so
        // staff can tell the LOU workflow to fire.
        corporate: {
          designation: "",
          companyAddress: "",
          purposeOfStay: String(inquiryData.specialRequirements || "").trim().slice(0, 120),
          billingArrangement: "chargeback"
        },
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const bookingDocRef = adminDb.collection("bookings").doc(bookingId);
      transaction.set(bookingDocRef, newBooking);

      // 9. Update inquiry: status -> converted, add a note + the
      // back-link to the new booking
      const conversionNote = {
        text: `Converted to booking ${bookingRef} (${bookingId})`,
        by: staff.email || "staff",
        at: new Date().toISOString()
      };
      const existingNotes = Array.isArray(inquiryData.notes) ? inquiryData.notes : [];
      transaction.update(inquiryRef, {
        status: "converted",
        convertedBookingId: bookingId,
        convertedBookingRef: bookingRef,
        notes: [...existingNotes, conversionNote],
        updatedAt: new Date()
      });
    });

    // Fire booking-confirmed email (best-effort). The walk-in flow
    // does the same; the converted-inquiry flow follows the same
    // contract — the booking is confirmed the moment it is created.
    if (newBooking) {
      try {
        await sendBookingTrigger("booking-confirmed", { ...newBooking, status: "confirmed" });
      } catch (emailErr) {
        console.error("Failed to send converted-inquiry booking confirmation email:", emailErr);
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        bookingId,
        bookingRef: finalBookingRef,
        totalPrice: finalTotalPrice
      }
    });
  } catch (error: any) {
    console.error("Corporate inquiry conversion failed:", error);
    const message = error?.message || "We could not convert this inquiry into a booking.";
    let status = 500;
    if (
      message.includes("not found") ||
      message.includes("already converted") ||
      message.includes("declined") ||
      message.includes("inactive") ||
      message.includes("blocked")
    ) {
      status = 400;
    } else if (message.includes("no longer available") || message.includes("exceeds room capacity")) {
      status = 409;
    }
    return res.status(status).json({ success: false, error: message });
  }
}
