import { adminAuth, adminDb } from "../lib/firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { sendBookingTrigger, sendStaffNewBookingTrigger, sendStaffNewPaymentTrigger } from "./email";
import { toDateOrNull, validateCorporateCode, getManilaDateInfo, BOOKING_REF_REGEX, generateLookupToken } from "@spark-inn/shared";
import { z } from "zod";
import config from "../../../hotel.config";

// Per BF-21 (booking-flow audit 2026-06-26): the public
// self-service endpoints (`/api/bookings/lookup`,
// `/api/bookings/cancel`) accept a bookingRef + guestEmail
// pair to look up and act on a booking without auth. The
// previous validation was just `!bookingRef || !guestEmail`,
// so a 100KB body, `""`, or `"notanemail"` would all hit
// Firestore. These schemas short-circuit malformed input
// with a 400 before the query runs.
//
// Per H2 (hardening batch 2026-06-26): the schemas now
// accept either `guestEmail` (legacy) OR `token` (the new
// per-booking `lookupToken` random hex). Exactly one of
// the two is required. The token path is what the email
// magic link uses — the URL no longer carries the raw
// `guestEmail`, so PII never lands in browser history or
// Vercel access logs.
const lookupSchema = z
  .object({
    bookingRef: z
      .string()
      .trim()
      .max(40)
      .regex(BOOKING_REF_REGEX, "Invalid booking reference format."),
    guestEmail: z.string().trim().toLowerCase().email().max(160).optional(),
    token: z
      .string()
      .trim()
      .max(64)
      .regex(/^[a-f0-9]{32}$/i, "Invalid lookup token format.")
      .optional(),
    turnstileToken: z.string().max(2000).optional()
  })
  .refine(
    (data) => Boolean(data.guestEmail) !== Boolean(data.token),
    "Provide either an email or a lookup token (not both)."
  );

const guestCancelSchema = z
  .object({
    bookingRef: z
      .string()
      .trim()
      .max(40)
      .regex(BOOKING_REF_REGEX, "Invalid booking reference format."),
    guestEmail: z.string().trim().toLowerCase().email().max(160).optional(),
    token: z
      .string()
      .trim()
      .max(64)
      .regex(/^[a-f0-9]{32}$/i, "Invalid lookup token format.")
      .optional(),
    reason: z.string().trim().max(500).optional().default("")
  })
  .refine(
    (data) => Boolean(data.guestEmail) !== Boolean(data.token),
    "Provide either an email or a lookup token (not both)."
  );

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
  // Per the room-type booking refactor: clients send the chosen
  // `roomType` instead of a specific `roomId`. The transaction
  // below picks the first non-conflicting physical room of that
  // type and stores its `roomId` + `roomNumber` on the booking doc.
  // Schema is unchanged — the booking still references a real
  // `rooms/<id>` document.
  roomType: string;
  checkIn: string; // Yyyy-MM-DD
  checkOut: string; // Yyyy-MM-DD
  guests: number;
  hasBreakfast: boolean;
  guestDetails: GuestDetails;
  discountType: "" | "senior" | "pwd";
  discountIdPhotoUrl: string | null;
  voucherCode?: string;
  paymentMethod: string;
  paymentProofUrl?: string | null;
  // Per W1.3 / decision #79 / audit S1.5: the client no longer
  // sets `isCorporate` directly. The server derives it from a
  // validated `corporateCode` lookup. The `companyName` on the
  // booking is sourced from the `corporateCodes` document for
  // the validated code, never from `guestDetails.companyName`.
  corporateCode?: string;
  // Per W2.14 / decision #102: set when this booking is created from a
  // converted corporate inquiry. The convert-to-booking UI (per audit
  // 1.4 SEV-1 #2) populates this field; normal bookings send null.
  linkedInquiryId?: string | null;
}

// Per BF-42 (booking-flow audit 2026-06-26): the
// `getManilaDateInfo()` helper was duplicated here twice
// (and in `store.ts`, `corporate-inquiries.ts`, `email.ts`,
// `reference.ts`). The shared implementation lives in
// `shared/utils/bookingDates.ts` and is imported as
// `getManilaDateInfo` above. Local definitions removed BF-42.

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
    roomType,
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
    corporateCode,
    linkedInquiryId
  } = body;

  // Basic Input Validation
  if (!bookingId || !roomType || !checkIn || !checkOut || !guests || !guestDetails) {
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
    // Captured inside the transaction so the response payload
    // can surface the auto-assigned physical room.
    let assignedRoomId = "";
    let assignedRoomNumber = "";

    // Detect Spark Rewards member via the request's ID token.
    // Per W2.2 / decision #90: server is authoritative for member discount.
    // The client cannot supply a memberDiscount or memberDiscountPct field;
    // we look up the member by authUser.uid and apply the 3rd stacking
    // step (DECISIONS-FEATURES.md #13b). The Authorization header is
    // optional — anonymous bookings get no member discount.
    let detectedMemberId: string | null = null;
    let detectedMemberDoc: any = null;
    let memberTokenError: Error | null = null;
    const authHeader = req.headers?.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const idToken = authHeader.split("Bearer ")[1];
      try {
        const decoded = await adminAuth.verifyIdToken(idToken);
        const memberRef = adminDb.collection("members").doc(decoded.uid);
        const memberSnap = await memberRef.get();
        if (memberSnap.exists) {
          const m = memberSnap.data()!;
          if (m.isMember !== false && m.isActive !== false) {
            detectedMemberId = memberSnap.id;
            detectedMemberDoc = m;
          }
        }
      } catch (err) {
        // Per BF-32 (booking-flow audit 2026-06-26): the previous
        // handler silently swallowed every token-verify error
        // and downgraded to an anonymous booking. A transient
        // Firebase Auth error (quota, network) would silently
        // lose a member's discount. We now:
        //   1. log at warn level so the issue is visible
        //   2. distinguish "infra" errors (Firebase unavailable,
        //      network, quota) from auth-style errors (invalid or
        //      expired token). Infra errors fail the request with
        //      503 so the client can retry. Auth-style errors
        //      fall through to anonymous booking.
        memberTokenError = err as Error;
        const code = (err as any)?.code || "";
        // Only rethrow for known Firebase infra codes. Anything
        // else (including plain `Error` from test mocks or a
        // thrown string from upstream) is an auth-style failure
        // and falls through to anonymous.
        const isInfraError = typeof code === "string" && (
          code.includes("UNAVAILABLE")
          || code.includes("DEADLINE_EXCEEDED")
          || code.includes("RESOURCE_EXHAUSTED")
          || code.includes("INTERNAL")
          || code.includes("ECONNRESET")
          || code.includes("ETIMEDOUT")
        );
        if (isInfraError) {
          throw err;
        }
        // Auth-style error: fall through to anonymous booking.
      }
    }
    if (memberTokenError) {
      console.warn("ID token verify failed; continuing as anonymous booking:", memberTokenError.message);
    }

    // Run Firestore Transaction
    await adminDb.runTransaction(async (transaction) => {
      // 1. Load the room type entry from `settings/hotelConfig`.
      // Per W3.6 + W3.7, rate matrix + max capacity live on the
      // type, not on individual room docs. Reading the type here
      // is the canonical source for the booking pricing and the
      // candidate-room filter (max capacity, type label).
      const hotelConfigRef = adminDb.collection("settings").doc("hotelConfig");
      const hotelConfigDoc = await transaction.get(hotelConfigRef);
      if (!hotelConfigDoc.exists) {
        throw new Error("Room type catalog is not configured.");
      }
      const hotelConfig = hotelConfigDoc.data()!;
      const roomTypesArr: any[] = Array.isArray(hotelConfig.roomTypes) ? hotelConfig.roomTypes : [];
      const typeEntry = roomTypesArr.find((entry) => entry && entry.value === roomType);
      if (!typeEntry) {
        throw new Error("Selected room type is not available.");
      }
      const typeMaxCapacity = Number(typeEntry.maxCapacity) || 0;
      const typeBaseRate = Number(typeEntry.pricePerNight) || 0;
      const typeWeekendRate = Number(typeEntry.weekendRate) || 0;
      const typeCorporateRate = Number(typeEntry.corporateRate) || 0;

      if (guests > typeMaxCapacity) {
        throw new Error(`Guest count exceeds room capacity of ${typeMaxCapacity}.`);
      }

      // 2. Find an available physical room of this type. Sort
      // candidates by `roomNumber` for deterministic assignment
      // so two concurrent requests can't fight over the same room.
      const candidatesQuery = adminDb.collection("rooms")
        .where("type", "==", roomType)
        .where("isActive", "==", true);
      const candidatesSnapshot = await transaction.get(candidatesQuery);
      // Per BF-33 (booking-flow audit 2026-06-26): the previous
      // post-filter `.filter((c) => c.data && c.data.isActive !== false)`
      // was redundant with the `where("isActive", "==", true)` on
      // the query. The query is the single source of truth; drop
      // the post-filter to avoid the two filters drifting out of
      // sync. Defensive null-check on `data` remains in case a
      // doc exists with no fields.
      const candidates = candidatesSnapshot.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .filter((c) => c.data)
        .sort((a, b) => {
          const an = String(a.data.roomNumber || a.id);
          const bn = String(b.data.roomNumber || b.id);
          return an.localeCompare(bn, undefined, { numeric: true });
        });

      if (candidates.length === 0) {
        throw new Error("Room no longer available");
      }

      let assignedRoom: { id: string; data: any } | null = null;
      for (const candidate of candidates) {
        const cData = candidate.data;
        // Per-room blocked window check
        if (cData.status === "blocked") {
          const blockedFrom = toDateOrNull(cData.blockedFrom);
          const blockedTo = toDateOrNull(cData.blockedTo);
          const windowActive = blockedFrom && blockedTo
            ? checkInDate < blockedTo && checkOutDate > blockedFrom
            : true;
          if (windowActive) {
            continue;
          }
        }
        // Overlapping booking check for this candidate
        const overlapQuery = adminDb.collection("bookings")
          .where("roomId", "==", candidate.id)
          .where("status", "!=", "cancelled");
        const overlapSnapshot = await transaction.get(overlapQuery);
        const hasConflict = overlapSnapshot.docs.some((doc) => {
          const data = doc.data();
          const existingCheckIn = toDateOrNull(data.checkIn);
          const existingCheckOut = toDateOrNull(data.checkOut);
          if (!existingCheckIn || !existingCheckOut) return false;
          return existingCheckIn < checkOutDate && existingCheckOut > checkInDate;
        });
        if (hasConflict) {
          continue;
        }
        assignedRoom = candidate;
        break;
      }

      if (!assignedRoom) {
        throw new Error("Room no longer available");
      }

      const roomId = assignedRoom.id;
      const roomData = assignedRoom.data;
      assignedRoomId = roomId;
      assignedRoomNumber = String(roomData.roomNumber || "");

      // 3. Fetch Breakfast Settings
      const breakfastConfigRef = adminDb.collection("settings").doc("breakfastConfig");
      const breakfastConfigDoc = await transaction.get(breakfastConfigRef);
      const breakfastConfig = breakfastConfigDoc.exists ? breakfastConfigDoc.data()! : { isEnabled: false, ratePerPersonPerNight: 250 };
      const actualBreakfastRate = breakfastConfig.isEnabled ? (breakfastConfig.ratePerPersonPerNight || 250) : 0;

      // 4. Handle Corporate Code validation. Per W1.3 / decision #79 /
      // audit S1.5: the server is the only source of truth for
      // `isCorporate` and `companyName`. A client posting
      // `isCorporate: true, corporateCode: "INVALID"` no longer
      // gets the corporate rate — the server independently looks
      // up the code, validates it (active + not expired + under
      // cap), and sets these fields from the corporateCodes doc.
      let activeRoomRate = typeBaseRate;
      let corporateDetails: any = { isCorporate: false, corporateCode: "", companyName: "" };

      if (corporateCode) {
        const corpCodeRef = adminDb.collection("corporateCodes").doc(corporateCode);
        const corpCodeDoc = await transaction.get(corpCodeRef);
        if (corpCodeDoc.exists) {
          const corpData = corpCodeDoc.data()!;
          const corpValidation = validateCorporateCode({
            isActive: corpData.isActive !== false,
            expiresAt: corpData.expiresAt ? corpData.expiresAt.toDate() : null,
            usageCap: corpData.usageCap ?? null,
            usageCount: corpData.usageCount || 0
          });
          if (corpValidation.valid) {
            corporateDetails.isCorporate = true;
            corporateDetails.corporateCode = corporateCode;
            // The doc's companyName is the source of truth — the
            // body's guestDetails.companyName is informational only.
            corporateDetails.companyName = corpData.companyName || "";
            if (corpData.ratePerRoomType && corpData.ratePerRoomType[roomType] !== undefined) {
              activeRoomRate = corpData.ratePerRoomType[roomType];
            } else if (typeCorporateRate) {
              activeRoomRate = typeCorporateRate;
            }
          } else {
            // Invalid code: fall back to standard rate, do NOT set
            // isCorporate. The booking still goes through but
            // without any corporate discount — the server never
            // trusts the body's claim.
            activeRoomRate = typeBaseRate;
          }
        } else {
          // Code not found in DB — fall back to standard rate.
          activeRoomRate = typeBaseRate;
        }
      }
      // No corporateCode at all → activeRoomRate stays as
      // typeBaseRate, isCorporate stays false.

      // 5. Calculate Nightly Rate Total (support weekend rate)
      let roomTotal = 0;
      const dateCursor = new Date(checkInDate);
      for (let i = 0; i < numNights; i++) {
        // check if weekend night (Friday or Saturday night? Or Saturday or Sunday night per shared/utils/dates.ts)
        // Let's check: shared/utils/dates.ts checks day === 0 (Sun) or day === 6 (Sat)
        const day = dateCursor.getUTCDay();
        const isWeekend = day === 0 || day === 6;
        if (isWeekend && !corporateDetails.isCorporate && typeWeekendRate) {
          roomTotal += typeWeekendRate;
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
      // Per W2.12 / decision #100: corporate bookings never accept
      // promo vouchers. Silently zero out the discount + clear the
      // code so the booking doc reflects `voucherDiscount: 0` even
      // if a guest types a code into the corporate booking form.
      let voucherDiscount = 0;
      let appliedVoucherCode = "";
      if (voucherCode && !corporateDetails.isCorporate) {
        const formattedCode = voucherCode.trim().toUpperCase();
        const voucherRef = adminDb.collection("vouchers").doc(formattedCode);
        const voucherDoc = await transaction.get(voucherRef);
        if (voucherDoc.exists) {
          const vData = voucherDoc.data()!;
          const now = new Date();
          // Per BF-18 (booking-flow audit 2026-06-26): the
          // assigned room's `type` should match the room type
          // the guest selected (the body's `roomType`). If they
          // diverge (legacy data drift), skip the voucher — it's
          // safer to under-apply than to apply against a room
          // type the guest never saw.
          const assignedTypeMatchesChosen = !roomType || roomData.type === roomType;
          const isValid =
            vData.isActive !== false &&
            (!vData.expiresAt || vData.expiresAt.toDate() >= now) &&
            (vData.usageCap === null || (vData.usageCount || 0) < vData.usageCap) &&
            // Per BF-19 (booking-flow audit 2026-06-26): the
            // empty-or-undefined case is covered by the optional
            // chaining below; drop the redundant `!vData.applicableRoomTypes`
            // short-circuit. The `length === 0` covers both the
            // "empty array" and "falsy" cases via `?.length ?? 0`.
            ((vData.applicableRoomTypes?.length ?? 0) === 0 || vData.applicableRoomTypes.includes(roomData.type)) &&
            assignedTypeMatchesChosen;

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

      // 8b. Spark Rewards member discount (3rd stacking step per
      // DECISIONS-FEATURES.md #13b). Read settings/rewardsConfig inside
      // the transaction. Applied to the post-voucher subtotal.
      // Per BF-20 (booking-flow audit 2026-06-26): the local
      // var was named `memberDiscountPct` which collides with
      // the doc field of the same name. Rename to
      // `appliedMemberDiscountPct` so the doc-write is clearly
      // distinct from the in-scope variable.
      let appliedMemberDiscountPct = 0;
      if (detectedMemberId) {
        const rewardsRef = adminDb.doc("settings/rewardsConfig");
        const rewardsDoc = await transaction.get(rewardsRef);
        if (rewardsDoc.exists) {
          const rc = rewardsDoc.data()!;
          if (rc.memberDiscountEnabled !== false) {
            const pct = Number(rc.memberDiscountPct) || 0;
            if (pct > 0) appliedMemberDiscountPct = pct;
          }
        }
      }

      // Stacking order (per DECISIONS-FEATURES.md #13b):
      //   1. Senior/PWD on subtotal
      //   2. Voucher (flat or percent) on post–Senior/PWD subtotal
      //   3. Member discount (percent) on post-voucher subtotal
      const seniorPwdDiscount = Math.round(subtotal * (discountPct / 100));
      const afterSeniorPwd = subtotal - seniorPwdDiscount;
      const afterVoucher = afterSeniorPwd - voucherDiscount;
      const memberDiscount = Math.round(afterVoucher * (appliedMemberDiscountPct / 100));
      const totalPrice = Math.max(afterVoucher - memberDiscount, 0);

      // Pre-discount total to restore if discount is rejected.
      // Per BF-05 (booking-flow audit 2026-06-26): the value
      // stored must be the full pre-Senior/PWD subtotal so a
      // rejection restores the price the guest would have paid
      // without any discount applied. The previous formula
      // `subtotal - voucherDiscount` was correct only when a
      // voucher was also applied; without a voucher it stored
      // `null` and the reject-discount handler 500'd. The
      // handler now uses `originalTotalPrice - voucherDiscount`
      // to apply the voucher if one was also applied.
      const originalTotalPrice = discountPct > 0 ? subtotal : null;

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

      // Per H3 (hardening batch 2026-06-26): sequence
      // width is now 5 digits. Mirrors the shared
      // `generateBookingRef` helper; the inline form is
      // kept here so the counter transaction + the ref
      // share the same scope.
      const bookingRef = `${config.bookingRefPrefix || "SI"}-${todayCompact}-${String(sequence).padStart(5, "0")}`;

      // Save output for outer scope
      finalBookingRef = bookingRef;
      finalTotalPrice = totalPrice;

      // 10. Prepare Document Fields
      const guestName = `${guestDetails.firstName.trim()} ${guestDetails.lastName.trim()}`;
      
      const newBooking = {
        bookingRef,
        roomId,
        roomNumber: roomData.roomNumber,
        roomType,
        guestName,
        guestEmail: guestDetails.email.trim().toLowerCase(),
        guestPhone: guestDetails.phone.trim(),
        numGuests: guests,
        checkIn: Timestamp.fromDate(checkInDate),
        checkOut: Timestamp.fromDate(checkOutDate),
        numNights,
        ratePerNight: activeRoomRate,
        // Per H2 (hardening batch 2026-06-26): random
        // 32-char hex token used by the email magic link
        // to authenticate the lookup / cancel endpoints
        // without leaking the raw `guestEmail` in URLs.
        lookupToken: generateLookupToken(),
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
        // Per BF-45 (booking-flow audit 2026-06-26): write
        // `null` (not `""`) when no payment proof is attached.
        // `|| null` coalesces both `""` and `undefined` to
        // `null` so the canonical "absent" value is consistent.
        paymentProofUrl: paymentProofUrl || null,
        source: corporateDetails.isCorporate ? "corporate" : "online",
        notes: "",
        handledBy: "",
        // Server-detected Spark Rewards member (per W2.2 / decision #90).
        // Set from the Authorization Bearer token detected above.
        memberId: detectedMemberId,
        memberDiscountPct: appliedMemberDiscountPct,
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
        // Per W2.14 / decision #102: linkedInquiryId is set when a booking
        // is created from a converted corporate inquiry. The body field
        // is null for normal bookings; the convert-to-booking UI (per
        // audit 1.4 SEV-1 #2) will populate it.
        linkedInquiryId: linkedInquiryId || null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const bookingDocRef = adminDb.collection("bookings").doc(bookingId);
      // Per BF-03 (booking-flow audit 2026-06-26): the
      // preallocated `bookingId` is a Firestore document ID
      // generated client-side before payment-proof + discount-ID
      // uploads. A client retry after a network blip where the
      // original write committed would hand the same ID to the
      // second request, and a blind `set` would clobber the prior
      // booking (including any staff-applied status changes,
      // the daily counter, and the bookingRef). The existence
      // check + abort makes the create truly idempotent.
      const existingBooking = await transaction.get(bookingDocRef);
      if (existingBooking.exists) {
        throw new Error("Booking already exists");
      }
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

    // Capture the assigned room outside the transaction scope so
    // the response can hand the roomId/roomNumber to the client for
    // the confirmation page. The booking doc also stores both.
    // (assignedRoomId / assignedRoomNumber were captured inside the
    // transaction above.)

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

    // Per W4.4 / decision #104: also notify the staff team of the
    // new online booking. Source is "online" (corporate / walkin
    // bookings take a different path with their own notifications).
    // Persist a timestamp on the booking so a re-fire via the
    // /api/email/staff-new-booking endpoint won't double-send.
    //
    // Per BF-04 (booking-flow audit 2026-06-26): the previous
    // guard read `computedData.emailNotificationsSent?.staffNewBooking`
    // from the in-memory `computedData` object, which is never
    // populated with that field — so the email always fired
    // (and a client retry between send and timestamp write would
    // fire a duplicate). The fix reads the fresh booking doc
    // after commit so the dedup works against real persisted
    // state.
    try {
      const freshBookingSnap = await adminDb.collection("bookings").doc(bookingId).get();
      const alreadySent = freshBookingSnap.exists
        && (freshBookingSnap.data() as any)?.emailNotificationsSent?.staffNewBooking;
      if (!alreadySent) {
        await adminDb.collection("bookings").doc(bookingId).update({
          "emailNotificationsSent.staffNewBooking": new Date()
        });
        await sendStaffNewBookingTrigger({
          ...computedData,
          bookingRef: finalBookingRef,
          guestEmail: computedData.email,
          paymentMethod,
          source: computedData.source || "online"
        });
      }
    } catch (staffEmailErr) {
      console.error("Failed to send staff-new-booking email:", staffEmailErr);
    }

    return res.status(200).json({
      success: true,
      data: {
        bookingId,
        bookingRef: finalBookingRef,
        // Per BF-39 (booking-flow audit 2026-06-26): surface the
        // server-computed `totalPrice` so the confirmation page
        // (and the corporate confirmation step) can display what
        // was actually charged, not the client's local
        // `calculateBookingTotal` (which still carries the
        // weekend-rate override but is otherwise prone to drift).
        totalPrice: finalTotalPrice,
        roomId: assignedRoomId,
        roomNumber: assignedRoomNumber,
        roomType
      }
    });

  } catch (error: any) {
    console.error("Booking creation failed:", error);
    // Per BF-32 (booking-flow audit 2026-06-26): surface 503
    // for upstream infrastructure errors (Firebase Auth
    // quota, network) so the client can retry, instead of
    // collapsing them into a generic 500.
    const code = (error as any)?.code || "";
    const isInfraError = typeof code === "string" && (
      code.includes("UNAVAILABLE")
      || code.includes("DEADLINE_EXCEEDED")
      || code.includes("RESOURCE_EXHAUSTED")
      || code.includes("INTERNAL")
    );
    let status: number;
    if (error.message === "Room no longer available") {
      status = 409;
    } else if (isInfraError) {
      status = 503;
    } else {
      status = 500;
    }
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
    totalPriceOverride,
    linkedInquiryId
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
        const blockedFrom = toDateOrNull(roomData.blockedFrom);
        const blockedTo = toDateOrNull(roomData.blockedTo);
        const windowActive = blockedFrom && blockedTo
          ? checkInDate < blockedTo && checkOutDate > blockedFrom
          : true;
        if (windowActive) {
          throw new Error("Room no longer available");
        }
      }

      // 1b. Per W3.6 + W3.7: pricing + max capacity live on the
      // room type, not on individual room docs. Read the type
      // entry from settings/hotelConfig.roomTypes[] and use those
      // values for the capacity check + pricing. The room-doc
      // fields are no longer authoritative (per TYPES.md §Room).
      const hotelConfigRef = adminDb.collection("settings").doc("hotelConfig");
      const hotelConfigDoc = await transaction.get(hotelConfigRef);
      if (!hotelConfigDoc.exists) {
        throw new Error("Room type catalog is not configured.");
      }
      const hotelConfig = hotelConfigDoc.data()!;
      const roomTypesArr: any[] = Array.isArray(hotelConfig.roomTypes) ? hotelConfig.roomTypes : [];
      const typeEntry = roomTypesArr.find((entry) => entry && entry.value === roomData.type);
      if (!typeEntry) {
        throw new Error("Room type is not available.");
      }
      const typeMaxCapacity = Number(typeEntry.maxCapacity) || 0;
      const typeBaseRate = Number(typeEntry.pricePerNight) || 0;
      const typeWeekendRate = Number(typeEntry.weekendRate) || 0;

      if (guests > typeMaxCapacity) {
        throw new Error(`Guest count exceeds room capacity of ${typeMaxCapacity}.`);
      }

      // 2. Overlapping Booking Check
      const bookingsQuery = adminDb.collection("bookings")
        .where("roomId", "==", roomId)
        .where("status", "!=", "cancelled");
      const bookingsSnapshot = await transaction.get(bookingsQuery);
      
      const hasConflict = bookingsSnapshot.docs.some((doc) => {
        const data = doc.data();
        const existingCheckIn = toDateOrNull(data.checkIn);
        const existingCheckOut = toDateOrNull(data.checkOut);
        if (!existingCheckIn || !existingCheckOut) return false;
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
        if (isWeekend && typeWeekendRate) {
          roomTotal += typeWeekendRate;
        } else {
          roomTotal += typeBaseRate;
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

      // Per H3 (hardening batch 2026-06-26): sequence
      // width is now 5 digits. Mirrors the shared
      // `generateBookingRef` helper; the inline form is
      // kept here so the counter transaction + the ref
      // share the same scope.
      const bookingRef = `${config.bookingRefPrefix || "SI"}-${todayCompact}-${String(sequence).padStart(5, "0")}`;
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
        checkIn: Timestamp.fromDate(checkInDate),
        checkOut: Timestamp.fromDate(checkOutDate),
        numNights,
        ratePerNight: typeBaseRate,
        totalPrice: finalTotalPrice,
        originalTotalPrice: subtotal,
        // Per H2 (hardening batch 2026-06-26): see the
        // matching field in `handleCreateBooking`. The
        // walkin flow writes a token too so the email
        // magic link works the same way for walkins
        // (reception sends it manually to the guest's
        // email).
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
        isCorporate: false,
        corporateCode: "",
        companyName: "",
        specialRequests: guestDetails.requests || "",
        status: status || "confirmed",
        paymentMethod,
        // Per BF-45 (booking-flow audit 2026-06-26): walkin
        // bookings start without a payment proof; write `null`
        // (not `""`) so the canonical "absent" value is
        // consistent with the online flow.
        paymentProofUrl: null,
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
        linkedInquiryId: linkedInquiryId || null,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Auto update room status if immediate check-in
      if (status === "checked-in") {
        transaction.update(roomRef, { status: "occupied" });
      }

      const bookingDocRef = adminDb.collection("bookings").doc(bookingId);
      // Per BF-03: same idempotency check as handleCreateBooking
      // — a walkin retry with the same preallocated `bookingId`
      // would otherwise overwrite the prior record.
      const existingWalkin = await transaction.get(bookingDocRef);
      if (existingWalkin.exists) {
        throw new Error("Booking already exists");
      }
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

    // Per BF-05 (booking-flow audit 2026-06-26): the booking's
    // `originalTotalPrice` is the full pre-Senior/PWD subtotal.
    // If a voucher was also applied, the new total restores the
    // voucher deduction too.
    const voucherDiscount = Number(bookingData.voucherDiscount || 0);
    const restoredTotalPrice = Math.max(originalTotalPrice - voucherDiscount, 0);

    // Per BF-15 (booking-flow audit 2026-06-26): the
    // `discountRejectedBy` field is a staff UID per the
    // BACKEND.md schema, not the staff email. Audit logs flow
    // through the `bookings/audit/records` collection which is
    // PII-sensitive; writing the email leaks the staff member's
    // contact info. Use the UID from the auth result.
    const discountRejectedBy = req.staff?.uid || "staff";

    const updates = {
      discountRejected: true,
      discountRejectedBy,
      discountRejectionReason: reason || "",
      discountPct: 0,
      totalPrice: restoredTotalPrice,
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

  // Per BF-21 (booking-flow audit 2026-06-26): normalise
  // `reason` once here so the staff + guest paths share the
  // same downstream binding. Staff passes a free-form string;
  // guests go through `guestCancelSchema` which trims +
  // caps to 500 chars.
  let validReason = typeof reason === "string" ? reason.slice(0, 500) : "";

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
      // Per BF-21 (booking-flow audit 2026-06-26): validate
      // the guest-self-service cancel input with the same
      // schema as lookup so a 100KB body / malformed email
      // never reaches Firestore.
      //
      // Per H2 (hardening batch 2026-06-26): the schema
      // accepts either `guestEmail` (legacy) OR `token`
      // (the per-booking `lookupToken`). The query below
      // branches on which was supplied.
      const parsed = guestCancelSchema.safeParse(req.body || {});
      if (!parsed.success) {
        return res.status(400).json({
          success: false,
          error: "Please provide a valid booking reference and email or lookup token."
        });
      }
      validReason = parsed.data.reason;

      const compositeFilter = parsed.data.token
        ? { field: "lookupToken", value: String(parsed.data.token).toLowerCase() }
        : { field: "guestEmail", value: parsed.data.guestEmail };

      const query = adminDb.collection("bookings")
        .where("bookingRef", "==", parsed.data.bookingRef)
        .where(compositeFilter.field, "==", compositeFilter.value)
        .limit(1);

      const snapshot = await query.get();
      if (snapshot.empty) {
        return res.status(404).json({
          success: false,
          error: parsed.data.token
            ? "Booking not found with matching token."
            : "Booking not found with matching email."
        });
      }

      bookingDocumentRef = snapshot.docs[0].ref;
      bookingData = snapshot.docs[0].data();
    }

    // Per BF-16 (booking-flow audit 2026-06-26): the previous
    // block list also rejected `confirmed` and `payment-confirmed`
    // bookings, forcing paid guests to call the front desk. The
    // self-service path is the more useful default; the only
    // statuses that genuinely cannot be cancelled online are the
    // terminal ones (`checked-in` has the guest on-property,
    // `checked-out` is past, `cancelled` is already terminal). A
    // confirmed or payment-confirmed booking has no business
    // reason to be undeleteable — staff can reverse charges out
    // of band if needed.
    if (
      bookingData.status === "checked-in"
      || bookingData.status === "checked-out"
      || bookingData.status === "cancelled"
    ) {
      return res.status(400).json({
        success: false,
        error: `Booking cannot be cancelled because its status is already ${bookingData.status}. Please contact the front desk.`
      });
    }

    await bookingDocumentRef.update({
      status: "cancelled",
      cancellationReason: validReason,
      updatedAt: new Date()
    });

    try {
      await sendBookingTrigger("booking-cancelled", {
        ...bookingData,
        cancellationReason: validReason
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
  const { bookingId, amount, method, note } = req.body || {};
  if (!bookingId || amount === undefined || !method) {
    return res.status(400).json({ success: false, error: "Booking ID, amount, and payment method are required." });
  }

  const numericAmount = Number(amount);
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ success: false, error: "Payment amount must be a positive number." });
  }

  // Per S4 (soft batch 2026-06-26): a 1B-peso typo would
  // otherwise land in the payments subcollection + inflate
  // the running total past `totalPrice` and skew the audit
  // trail. Cap at 1,000,000 PHP — the largest realistic
  // single payment for a hotel room.
  if (numericAmount > 1_000_000) {
    return res.status(400).json({ success: false, error: "Payment amount exceeds the 1,000,000 per-transaction limit." });
  }

  // Trim + cap the free-form note. A 100KB note used to
  // land in the payments subcollection as-is.
  const safeNote = typeof note === "string" ? note.trim().slice(0, 500) : "";

  // Per BF-14 (booking-flow audit 2026-06-26): the previous
  // implementation wrote the new payment, then re-read the
  // entire `bookings/{id}/payments` subcollection to compute
  // the running total. Two staff adding payments in parallel
  // could each see the other's write missing and either
  // (a) both decide `fullyPaid === false` and miss the
  // `payment-confirmed` trigger, or (b) both decide
  // `fullyPaid === true` and send duplicate `payment-confirmed`
  // emails. The fix appends the payment + re-sums + decides
  // the staff-new-payment dedup inside a Firestore transaction,
  // then defers the email sends to a single follow-up read.
  const staffUid = req.staff?.uid || "staff";
  const paymentRecord = {
    amount: numericAmount,
    method,
    note: safeNote,
    recordedBy: staffUid,
    recordedAt: new Date()
  };

  // Result of the transaction — used to decide which emails to
  // fire after the transaction commits.
  let totalPaid = 0;
  let totalPrice = 0;
  let isConfirmableStatus = false;
  let fullyPaid = false;
  let hadPaymentProof = false;
  let staffPaymentMarkerMissing = true;
  let bookingDataSnapshot: any = null;

  try {
    await adminDb.runTransaction(async (transaction) => {
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("Booking not found");
      }
      const bookingData = bookingDoc.data()!;
      bookingDataSnapshot = bookingData;

      // Append the payment record inside the transaction so the
      // post-commit read sees the new total.
      const paymentsRef = bookingRef.collection("payments");
      const newPaymentRef = paymentsRef.doc();
      transaction.set(newPaymentRef, paymentRecord);

      // Re-read the subcollection inside the same transaction.
      // The Firestore Admin SDK's transaction.get() works for
      // subcollection queries.
      const paymentsSnapshot = await transaction.get(paymentsRef);
      totalPaid = paymentsSnapshot.docs.reduce((sum, docSnap) => {
        const data = docSnap.data() as { amount?: number };
        return sum + Number(data.amount || 0);
      }, 0);

      totalPrice = Number(bookingData.totalPrice || 0);
      fullyPaid = totalPrice > 0 && totalPaid >= totalPrice;
      isConfirmableStatus = bookingData.status === "pending"
        || bookingData.status === "payment-uploaded";
      hadPaymentProof = !!bookingData.paymentProofUrl;
      staffPaymentMarkerMissing = !bookingData.emailNotificationsSent?.staffNewPayment;

      // Mark the staff-new-payment dedup inside the transaction
      // so a concurrent addPayment call doesn't re-fire the email.
      if (hadPaymentProof && staffPaymentMarkerMissing) {
        transaction.update(bookingRef, {
          "emailNotificationsSent.staffNewPayment": new Date()
        });
      }
    });
  } catch (error: any) {
    if (error.message === "Booking not found") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    console.error("Add payment handler error:", error);
    return res.status(500).json({ success: false, error: error.message || "An unexpected error occurred." });
  }

  // Email sends stay outside the transaction (Resend calls are
  // external and slow) but the dedup marker is now written
  // transactionally so the duplicate-fire race is closed.
  try {
    if (fullyPaid && isConfirmableStatus) {
      await sendBookingTrigger("payment-confirmed", bookingDataSnapshot);
    }
    // Per W4.4 / decision #104: notify staff when a guest
    // uploads a payment proof. Idempotent via the
    // `emailNotificationsSent.staffNewPayment` timestamp.
    if (hadPaymentProof && staffPaymentMarkerMissing) {
      await sendStaffNewPaymentTrigger(
        { ...bookingDataSnapshot, bookingRef: bookingDataSnapshot.bookingRef },
        { ...paymentRecord, paymentProofUrl: bookingDataSnapshot.paymentProofUrl }
      );
    }
  } catch (emailErr) {
    console.error("Failed to send payment confirmation email:", emailErr);
  }

  return res.status(200).json({
    success: true,
    data: { ...paymentRecord, totalPaid }
  });
}

export async function handleConfirmBooking(req: any, res: any) {
  const { bookingId } = req.body || {};
  if (!bookingId || typeof bookingId !== "string" || bookingId.length > 64) {
    return res.status(400).json({ success: false, error: "Booking ID is required." });
  }

  try {
    const bookingRef = adminDb.collection("bookings").doc(bookingId);
    const confirmedBy = req.staff?.uid || "staff";
    let bookingData: any = null;
    let alreadyConfirmed = false;

    // Per S4 (soft batch 2026-06-26): wrap the
    // read + status check + write in a transaction so two
    // staff confirming the same booking in parallel
    // don't both fire the `booking-confirmed` email. The
    // transaction's first reader sees `pending`; the
    // second sees the new `confirmed` status and
    // short-circuits.
    await adminDb.runTransaction(async (transaction) => {
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("BOOKING_NOT_FOUND");
      }
      const data = bookingDoc.data()!;
      bookingData = data;

      if (data.status === "confirmed") {
        // Idempotent: already confirmed by another staff
        // member. Return success without re-firing the
        // email.
        alreadyConfirmed = true;
        return;
      }

      const allowedStatuses = ["pending", "payment-uploaded"];
      if (!allowedStatuses.includes(data.status)) {
        throw new Error(`INVALID_STATUS:${data.status}`);
      }

      transaction.update(bookingRef, {
        status: "confirmed",
        confirmedAt: new Date(),
        confirmedBy,
        updatedAt: new Date()
      });
    });

    if (alreadyConfirmed) {
      return res.status(200).json({ success: true, data: { status: "confirmed", alreadyConfirmed: true } });
    }

    // Per BF-15 (booking-flow audit 2026-06-26): the
    // `confirmedBy` field is a staff UID per the BACKEND.md
    // schema, not the staff email. The audit collection
    // (`bookings/audit/records/{id}`) reads these fields and
    // is PII-sensitive; storing emails leaks the staff member's
    // contact info. Use the UID from the auth result (the
    // dispatcher's `authenticateStaff` guarantees presence).
    try {
      await sendBookingTrigger("booking-confirmed", { ...bookingData, status: "confirmed" });
    } catch (emailErr) {
      console.error("Failed to send booking confirmation email:", emailErr);
    }

    return res.status(200).json({ success: true, data: { status: "confirmed" } });
  } catch (error: any) {
    if (error?.message === "BOOKING_NOT_FOUND") {
      return res.status(404).json({ success: false, error: "Booking not found." });
    }
    if (error?.message?.startsWith("INVALID_STATUS:")) {
      return res.status(400).json({
        success: false,
        error: `Booking cannot be confirmed because its status is already ${error.message.split(":")[1]}.`
      });
    }
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

    // Per BF-15 (booking-flow audit 2026-06-26): store the staff
    // UID (not email) on `checkedOutBy` + `resolvedBy`. These
    // fields flow into the `bookings/audit/records` collection
    // and are PII-sensitive.
    const checkedOutBy = req.staff?.uid || "staff";
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

      // Per W2.7 / decision #95: auto-archive the intercom thread on
      // checkout. Sets `intercoms/{roomNumber}.resolved = true` so the
      // thread moves out of the active inbox tab. Staff can reopen from
      // the admin Inbox by toggling resolved: false.
      const roomNumber = String(bookingData.roomNumber || "");
      if (roomNumber) {
        const intercomRef = adminDb.collection("intercoms").doc(roomNumber);
        transaction.set(
          intercomRef,
          { resolved: true, resolvedAt: new Date(), resolvedBy: checkedOutBy, roomNumber, updatedAt: new Date() },
          { merge: true }
        );
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
  const parsed = lookupSchema.safeParse(req.body || {});
  if (!parsed.success) {
    // Per BF-21 (booking-flow audit 2026-06-26): return 400
    // (not 404) on malformed input so the caller can
    // distinguish "bad input" from "no match". The error
    // message is intentionally generic so the validator
    // does not become an oracle for the booking-ref shape.
    return res.status(400).json({
      success: false,
      error: "Please provide a valid booking reference and email or lookup token."
    });
  }

  const { bookingRef: trimmedRef, guestEmail: normalizedEmail, token: lookupToken } = parsed.data;

  try {
    // Per H2 (hardening batch 2026-06-26): the token
    // path queries by `bookingRef + lookupToken` (an
    // indexed compound — both fields are part of the
    // existing composite index), bypassing `guestEmail`
    // entirely. The email path is unchanged.
    const compositeFilter = lookupToken
      ? { field: "lookupToken", value: String(lookupToken).toLowerCase() }
      : { field: "guestEmail", value: normalizedEmail };

    const snapshot = await adminDb.collection("bookings")
      .where("bookingRef", "==", trimmedRef)
      .where(compositeFilter.field, "==", compositeFilter.value)
      .limit(1)
      .get();

    if (snapshot.empty) {
      // The composite index on (bookingRef, guestEmail)
      // is the original lookup path. If the email-mode
      // query returns no rows, retry with a fallback
      // (limit 5) by bookingRef and re-filter in JS in
      // case the stored email differs in case / whitespace.
      // The token-mode query has no equivalent fallback
      // (tokens are generated server-side and never
      // re-cased by the user).
      if (lookupToken) {
        return res.status(404).json({ success: false, error: "Booking not found." });
      }

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
    console.error("Booking lookup failed:", error?.message || error);
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
