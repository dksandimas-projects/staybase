import { z } from "zod";
import { generateMemberNumber, validatePointsRedemption } from "@spark-inn/shared";
import config from "../../../hotel.config";
import { adminAuth, adminDb } from "../lib/firebase-admin";

const registerMemberSchema = z.object({
  fullName: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  photoUrl: z.string().trim().max(500).optional().default(""),
  authProvider: z.enum(["google", "email"]).optional().default("email"),
  bookingId: z.string().trim().max(120).optional().default("")
}).strict();

const redeemPointsSchema = z.object({
  bookingId: z.string().trim().min(1).max(120),
  memberId: z.string().trim().max(120).optional().default(""),
  pointsToRedeem: z.coerce.number().int().min(1)
}).strict();

const undoRedemptionSchema = z.object({
  bookingId: z.string().trim().min(1).max(120)
}).strict();

const setMemberActiveSchema = z.object({
  uid: z.string().trim().min(1).max(160),
  isActive: z.boolean()
}).strict();

const eraseAccountSchema = z.object({
  confirmation: z.literal("erase-my-account")
}).strict();

const STAY_STATUSES = [
  "pending",
  "payment-uploaded",
  "payment-confirmed",
  "confirmed",
  "checked-in",
  "checked-out",
  "cancelled"
];

function getAuthUser(req: any) {
  return (req as any).user || {};
}

function getStaff(req: any) {
  return (req as any).staff || {};
}

async function linkBookingsByEmail(email: string, uid: string, explicitBookingId?: string) {
  let linkedCount = 0;
  const batch = adminDb.batch();

  const bookingsSnapshot = await adminDb
    .collection("bookings")
    .where("guestEmail", "==", email)
    .get();

  bookingsSnapshot.docs.forEach((bookingDoc: any) => {
    const data = bookingDoc.data();
    if (data.memberId && data.memberId !== uid) {
      return;
    }
    batch.update(bookingDoc.ref, { memberId: uid, updatedAt: new Date() });
    linkedCount += 1;
  });

  if (explicitBookingId) {
    const bookingRef = adminDb.collection("bookings").doc(explicitBookingId);
    batch.update(bookingRef, { memberId: uid, updatedAt: new Date() });
    linkedCount += 1;
  }

  if (linkedCount > 0) {
    await batch.commit();
  }

  return linkedCount;
}

function toMillis(value: any): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toIsoDate(value: any): string {
  if (!value) return "";
  const date = value instanceof Date
    ? value
    : typeof value?.toDate === "function"
      ? value.toDate()
      : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function projectStay(bookingDoc: any) {
  const data = bookingDoc.data() || {};
  return {
    id: bookingDoc.id,
    bookingRef: data.bookingRef || "",
    lookupToken: data.lookupToken || "",
    roomNumber: data.roomNumber || "",
    roomType: data.roomType || "",
    roomName: data.roomName || data.roomType || "",
    checkIn: toIsoDate(data.checkIn),
    checkOut: toIsoDate(data.checkOut),
    numNights: Number(data.numNights || 0),
    totalPrice: Number(data.totalPrice || 0),
    status: data.status || "",
    hasBreakfast: Boolean(data.hasBreakfast)
  };
}

function staySortRank(status: string): number {
  if (["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"].includes(status)) return 0;
  if (status === "checked-out") return 1;
  if (status === "cancelled") return 2;
  return 3;
}

export async function handleListMemberStays(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const authUser = getAuthUser(req);
  if (!authUser.uid || !authUser.email) {
    return res.status(401).json({ success: false, error: "Sign in to view your stays." });
  }

  try {
    const uid = String(authUser.uid);
    const email = String(authUser.email).trim().toLowerCase();
    const byIdSnap = await adminDb.collection("bookings").where("memberId", "==", uid).get();
    const byEmailSnap = await adminDb.collection("bookings").where("guestEmail", "==", email).get();
    const deduped = new Map<string, any>();

    [...byIdSnap.docs, ...byEmailSnap.docs].forEach((bookingDoc: any) => {
      const data = bookingDoc.data() || {};
      const belongsToMember = data.memberId === uid || String(data.guestEmail || "").trim().toLowerCase() === email;
      if (belongsToMember && STAY_STATUSES.includes(data.status || "")) {
        deduped.set(bookingDoc.id, bookingDoc);
      }
    });

    const stays = Array.from(deduped.values())
      .sort((a: any, b: any) => {
        const aData = a.data() || {};
        const bData = b.data() || {};
        const rankDelta = staySortRank(aData.status || "") - staySortRank(bData.status || "");
        if (rankDelta !== 0) return rankDelta;
        const aTime = toMillis(aData.checkIn);
        const bTime = toMillis(bData.checkIn);
        return staySortRank(aData.status || "") === 0 ? aTime - bTime : bTime - aTime;
      })
      .map(projectStay);

    return res.status(200).json({ success: true, data: { stays } });
  } catch (error) {
    console.error("Member stays lookup failed:", error);
    return res.status(500).json({
      success: false,
      error: "We could not load your stays right now. Please try again."
    });
  }
}

export async function handleRegisterMember(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const authUser = getAuthUser(req);
  if (!authUser.uid || !authUser.email) {
    return res.status(401).json({ success: false, error: `Sign in before joining ${config.rewardsName}.` });
  }

  const parsed = registerMemberSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please check your rewards profile details and try again."
    });
  }

  try {
    const now = new Date();
    const uid = authUser.uid;
    const email = String(authUser.email).trim().toLowerCase();
    const memberRef = adminDb.collection("members").doc(uid);
    const counterRef = adminDb.collection("counters").doc("memberNumbers");
    let memberNumber = "";

    await adminDb.runTransaction(async (transaction: any) => {
      const memberDoc = await transaction.get(memberRef);
      const existingMember = memberDoc.exists ? memberDoc.data() : {};

      if (existingMember?.memberNumber) {
        memberNumber = existingMember.memberNumber;
        transaction.update(memberRef, {
          isMember: true,
          memberSince: existingMember.memberSince || now,
          updatedAt: now
        });
        return;
      }

      const counterDoc = await transaction.get(counterRef);
      const sequence = counterDoc.exists ? (counterDoc.data()?.count || 0) + 1 : 1;
      memberNumber = generateMemberNumber(config.memberNumberPrefix || "SR", sequence);

      if (counterDoc.exists) {
        transaction.update(counterRef, { count: sequence, updatedAt: now });
      } else {
        transaction.set(counterRef, { count: sequence, createdAt: now, updatedAt: now });
      }

      const fullName = parsed.data.fullName || authUser.name || email.split("@")[0];
      const photoUrl = parsed.data.photoUrl || authUser.picture || "";

      transaction.set(memberRef, {
        fullName,
        email,
        phone: parsed.data.phone,
        photoUrl,
        authProvider: parsed.data.authProvider,
        memberNumber,
        isMember: true,
        memberSince: now,
        rewardsPoints: existingMember?.rewardsPoints || 0,
        tier: existingMember?.tier || "standard",
        isActive: existingMember?.isActive !== false,
        createdAt: existingMember?.createdAt || now,
        updatedAt: now
      }, { merge: true });
    });

    const linkedBookings = await linkBookingsByEmail(email, uid, parsed.data.bookingId || undefined);

    return res.status(200).json({
      success: true,
      data: {
        memberId: uid,
        memberNumber,
        linkedBookings
      }
    });
  } catch (error) {
    console.error("Member registration failed:", error);
    return res.status(500).json({
      success: false,
      error: `We could not join ${config.rewardsName} right now. Please try again.`
    });
  }
}

export async function handleRedeemMemberPoints(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (!staff.uid) {
    return res.status(401).json({ success: false, error: "Staff authentication is required." });
  }

  const parsed = redeemPointsSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please check the points redemption details and try again."
    });
  }

  try {
    const now = new Date();
    const { bookingId, memberId: requestedMemberId, pointsToRedeem } = parsed.data;
    let responseData: any = {};

    await adminDb.runTransaction(async (transaction: any) => {
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("Booking not found.");
      }

      const booking = bookingDoc.data();
      if (["checked-in", "checked-out", "cancelled"].includes(booking.status)) {
        throw new Error("Points can only be redeemed before check-in.");
      }
      if ((booking.pointsRedeemed || 0) > 0) {
        throw new Error("This booking already has a points redemption.");
      }

      const memberId = requestedMemberId || booking.memberId;
      if (!memberId || (booking.memberId && requestedMemberId && requestedMemberId !== booking.memberId)) {
        throw new Error("Booking is not linked to this member.");
      }

      const memberRef = adminDb.collection("members").doc(memberId);
      const rewardsConfigRef = adminDb.collection("settings").doc("rewardsConfig");
      const memberDoc = await transaction.get(memberRef);
      const rewardsConfigDoc = await transaction.get(rewardsConfigRef);

      if (!memberDoc.exists) {
        throw new Error("Member not found.");
      }

      const member = memberDoc.data();
      if (member.isActive === false || member.isMember === false) {
        throw new Error("Member account is not active.");
      }

      const pointsRedemptionRate = rewardsConfigDoc.exists ? Number(rewardsConfigDoc.data()?.pointsRedemptionRate || 0) : 0;
      if (pointsRedemptionRate <= 0) {
        throw new Error("Points redemption is not configured.");
      }

      const validation = validatePointsRedemption(pointsToRedeem, Number(member.rewardsPoints || 0), pointsRedemptionRate);
      if (!validation.valid) {
        throw new Error(validation.error);
      }

      const redemptionValue = Math.round(validation.value);
      if (redemptionValue <= 0 || redemptionValue > Number(booking.totalPrice || 0)) {
        throw new Error("Points redemption value exceeds the booking total.");
      }

      const nextTotalPrice = Math.max(Number(booking.totalPrice || 0) - redemptionValue, 0);
      const historyRef = adminDb.collection(`members/${memberId}/pointsHistory`).doc();

      transaction.update(bookingRef, {
        memberId,
        totalPrice: nextTotalPrice,
        pointsRedeemed: pointsToRedeem,
        pointsRedeemedValue: redemptionValue,
        pointsRedeemedBy: staff.uid,
        pointsRedeemedAt: now,
        updatedAt: now
      });
      transaction.update(memberRef, {
        rewardsPoints: Number(member.rewardsPoints || 0) - pointsToRedeem,
        updatedAt: now
      });
      transaction.set(historyRef, {
        type: "redeem",
        points: -pointsToRedeem,
        description: `Redeemed against booking ${booking.bookingRef || bookingId}`,
        reason: "Points redeemed by staff",
        bookingId,
        by: staff.uid,
        at: now
      });

      responseData = {
        bookingId,
        memberId,
        pointsRedeemed: pointsToRedeem,
        pointsRedeemedValue: redemptionValue,
        totalPrice: nextTotalPrice,
        rewardsPoints: Number(member.rewardsPoints || 0) - pointsToRedeem
      };
    });

    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: error?.message || "We could not redeem points for this booking."
    });
  }
}

export async function handleUndoMemberPointsRedemption(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (!staff.uid) {
    return res.status(401).json({ success: false, error: "Staff authentication is required." });
  }
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can undo points redemption." });
  }

  const parsed = undoRedemptionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please check the redemption undo details and try again."
    });
  }

  try {
    const now = new Date();
    const { bookingId } = parsed.data;
    let responseData: any = {};

    await adminDb.runTransaction(async (transaction: any) => {
      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("Booking not found.");
      }

      const booking = bookingDoc.data();
      if (booking.status !== "confirmed") {
        throw new Error("Points redemption can only be undone while the booking is confirmed.");
      }
      if (!booking.memberId || (booking.pointsRedeemed || 0) <= 0 || (booking.pointsRedeemedValue || 0) <= 0) {
        throw new Error("This booking has no points redemption to undo.");
      }

      const memberRef = adminDb.collection("members").doc(booking.memberId);
      const memberDoc = await transaction.get(memberRef);
      if (!memberDoc.exists) {
        throw new Error("Member not found.");
      }

      const member = memberDoc.data();
      const restoredPoints = Number(booking.pointsRedeemed || 0);
      const restoredValue = Number(booking.pointsRedeemedValue || 0);
      const nextTotalPrice = Number(booking.totalPrice || 0) + restoredValue;
      const nextRewardsPoints = Number(member.rewardsPoints || 0) + restoredPoints;
      const historyRef = adminDb.collection(`members/${booking.memberId}/pointsHistory`).doc();

      transaction.update(bookingRef, {
        totalPrice: nextTotalPrice,
        pointsRedeemed: 0,
        pointsRedeemedValue: 0,
        pointsRedeemedBy: null,
        pointsRedeemedAt: null,
        updatedAt: now
      });
      transaction.update(memberRef, {
        rewardsPoints: nextRewardsPoints,
        updatedAt: now
      });
      transaction.set(historyRef, {
        type: "manual",
        points: restoredPoints,
        description: `Reversed points redemption for booking ${booking.bookingRef || bookingId}`,
        reason: "Points redemption undone by admin",
        bookingId,
        by: staff.uid,
        at: now
      });

      responseData = {
        bookingId,
        memberId: booking.memberId,
        pointsRestored: restoredPoints,
        pointsRedeemedValue: restoredValue,
        totalPrice: nextTotalPrice,
        rewardsPoints: nextRewardsPoints
      };
    });

    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    return res.status(400).json({
      success: false,
      error: error?.message || "We could not undo this points redemption."
    });
  }
}

export async function handleSetMemberActive(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (!staff.uid) {
    return res.status(401).json({ success: false, error: "Staff authentication is required." });
  }
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can suspend or activate member accounts." });
  }

  const parsed = setMemberActiveSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please choose a member account to update."
    });
  }

  const { uid, isActive } = parsed.data;

  try {
    const memberRef = adminDb.collection("members").doc(uid);
    const memberDoc = await memberRef.get();
    if (!memberDoc.exists) {
      return res.status(404).json({
        success: false,
        error: "Member account was not found."
      });
    }

    const now = new Date();
    const previousIsActive = memberDoc.data()?.isActive !== false;

    try {
      await memberRef.set({
        isActive,
        disabledAt: isActive ? null : now,
        disabledBy: isActive ? null : staff.uid,
        updatedAt: now
      }, { merge: true });
      await adminAuth.updateUser(uid, { disabled: !isActive });
    } catch (syncErr) {
      console.error("Member active-state sync failed, rolling back Firestore:", syncErr);
      try {
        await memberRef.set({
          isActive: previousIsActive,
          disabledAt: previousIsActive ? null : memberDoc.data()?.disabledAt || null,
          disabledBy: previousIsActive ? null : memberDoc.data()?.disabledBy || null,
          updatedAt: new Date()
        }, { merge: true });
      } catch (rollbackErr) {
        console.error("Failed to roll back member active-state:", rollbackErr);
      }
      throw syncErr;
    }

    return res.status(200).json({
      success: true,
      data: { uid, isActive }
    });
  } catch (error: any) {
    if (error?.code === "auth/user-not-found") {
      return res.status(404).json({
        success: false,
        error: "Member auth account was not found."
      });
    }

    console.error("Member account active-state update failed:", error);
    return res.status(500).json({
      success: false,
      error: "Unable to update member account status. Please try again."
    });
  }
}

// Per W1.4 / decision #49 / audit S2.3: member account deletion must
// trigger full RA 10173 right to erasure. Anonymizes all linked
// bookings (writes a no-PII audit record to
// `bookings/audit/records/{id}` first, then scrubs guestName /
// guestEmail / guestPhone / memberId from the booking doc),
// recursively deletes the `pointsHistory` subcollection, deletes the
// member document, and deletes the Firebase Auth user. Cannot be
// triggered for someone else — the caller's ID token UID must match
// the member being erased.
export async function handleEraseMemberAccount(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const authUser = getAuthUser(req);
  if (!authUser.uid || !authUser.email) {
    return res.status(401).json({ success: false, error: "Sign in before requesting account erasure." });
  }

  const parsed = eraseAccountSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please confirm account erasure by sending the 'erase-my-account' confirmation string."
    });
  }

  const uid = authUser.uid;
  const erasedAt = new Date();
  let auditBookingsCount = 0;
  let anonymizedBookingsCount = 0;
  let deletedHistoryCount = 0;

  try {
    // Step 1: transactionally audit + anonymize every booking linked
    // to this member. Anonymization must succeed for all linked
    // bookings before we touch the member doc, so the booking PII is
    // gone even if the function aborts later.
    await adminDb.runTransaction(async (transaction: any) => {
      const memberRef = adminDb.collection("members").doc(uid);
      const memberDoc = await transaction.get(memberRef);
      if (!memberDoc.exists) {
        throw new Error("Member account was not found.");
      }

      const linkedBookingsSnap = await adminDb
        .collection("bookings")
        .where("memberId", "==", uid)
        .get();

      linkedBookingsSnap.forEach((bookingDoc: any) => {
        const data = bookingDoc.data();
        const auditRef = adminDb
          .collection("bookings").doc("audit").collection("records").doc(bookingDoc.id);
        transaction.set(auditRef, {
          bookingRef: data.bookingRef || "",
          roomId: data.roomId || "",
          roomNumber: data.roomNumber || "",
          roomType: data.roomType || "",
          checkIn: data.checkIn || null,
          checkOut: data.checkOut || null,
          numNights: Number(data.numNights || 0),
          numGuests: Number(data.numGuests || 0),
          totalPrice: Number(data.totalPrice || 0),
          status: data.status || "",
          source: data.source || "",
          createdAt: data.createdAt || null,
          erasedAt,
          erasedByUid: uid
        });
        auditBookingsCount += 1;

        transaction.update(bookingDoc.ref, {
          memberId: null,
          guestName: "Erased",
          guestEmail: "erased@invalid",
          guestPhone: "",
          erasedAt,
          erasedByUid: uid,
          updatedAt: erasedAt
        });
        anonymizedBookingsCount += 1;
      });

      transaction.set(memberRef, {
        isErased: true,
        erasedAt,
        fullName: "Erased",
        email: "erased@invalid",
        phone: "",
        photoUrl: "",
        rewardsPoints: 0,
        isActive: false,
        updatedAt: erasedAt
      }, { merge: true });
    });

    // Step 2: recursively delete the pointsHistory subcollection.
    // Done outside the transaction because Firestore transactions
    // cannot list collections. Read-then-batch-delete is the
    // documented pattern.
    const historySnap = await adminDb
      .collection("members").doc(uid)
      .collection("pointsHistory")
      .get();

    if (!historySnap.empty) {
      const batch = adminDb.batch();
      historySnap.forEach((doc: any) => batch.delete(doc.ref));
      await batch.commit();
      deletedHistoryCount = historySnap.size;
    }

    // Step 3: delete the member document. Anonymized + flagged above
    // already; this removes the PII row outright.
    await adminDb.collection("members").doc(uid).delete();

    // Step 4: delete the Firebase Auth user. If this fails (e.g.
    // recent login required) the booking anonymization is already
    // done and idempotent — the client may retry.
    try {
      await adminAuth.deleteUser(uid);
    } catch (authError: any) {
      if (authError?.code === "auth/user-not-found") {
        // Already gone — treat as success
      } else {
        throw authError;
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        uid,
        auditBookingsCount,
        anonymizedBookingsCount,
        deletedHistoryCount,
        erasedAt: erasedAt.toISOString()
      }
    });
  } catch (error: any) {
    if (error?.message === "Member account was not found.") {
      return res.status(404).json({ success: false, error: error.message });
    }
    if (error?.code === "auth/requires-recent-login") {
      return res.status(401).json({
        success: false,
        error: "Please sign in again before requesting account erasure."
      });
    }
    console.error("Member account erasure failed:", error);
    return res.status(500).json({
      success: false,
      error: "We could not erase your account right now. Please try again."
    });
  }
}
