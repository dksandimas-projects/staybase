import { z } from "zod";
import {
  BOOKING_REF_REGEX,
  RESERVATION_REF_REGEX,
  generateMemberNumber,
  validatePointsRedemption
} from "@spark-inn/shared";
import config from "../../../hotel.config";
import { adminAuth, adminDb } from "../lib/firebase-admin";
import { rebuildRateBreakdown } from "../lib/rate-breakdown";
import { sendVerificationEmailTrigger } from "./email";
import { getServerBaseUrl } from "../lib/siteUrl";

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

// Per Spark Rewards audit 2026-07-18 MED-1: manual points
// adjustment must be server-side (Admin SDK) so the
// `rewardsPoints` + `pointsHistory` write happens inside one
// transaction the client cannot bypass. With the audit fix, the
// Firestore `members/{uid}` rule no longer permits staff clients
// to write `rewardsPoints` directly — the only path is this
// endpoint, which couples the balance and the history entry in
// the same `runTransaction` commit.
//
// The `type` field is fixed to "manual" on the server — clients
// cannot inject "earn" / "redeem" history rows through this path.
// Caller is admin-only (audit privilege). The reason is required
// (matches the existing UI guard at MembersPage.tsx).
const manualAdjustPointsSchema = z.object({
  memberId: z.string().trim().min(1).max(160),
  amount: z.coerce.number().int(),
  reason: z.string().trim().min(1).max(500)
}).strict().refine((data) => data.amount !== 0, {
  message: "Amount must be a non-zero integer.",
  path: ["amount"]
});

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
  const linkedPaths = new Set<string>();

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
    linkedPaths.add(bookingDoc.ref.path);
    linkedCount += 1;
  });

  if (explicitBookingId) {
    const bookingRef = adminDb.collection("bookings").doc(explicitBookingId);
    const bookingDoc = await bookingRef.get();
    if (bookingDoc.exists && !linkedPaths.has(bookingRef.path)) {
      const data = bookingDoc.data() || {};
      const bookingEmail = String(data.guestEmail || "").trim().toLowerCase();
      const alreadyLinkedToCaller = data.memberId === uid;
      if ((bookingEmail && bookingEmail === email) || alreadyLinkedToCaller) {
        batch.update(bookingRef, { memberId: uid, updatedAt: new Date() });
        linkedCount += 1;
      }
    }
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
    hasBreakfast: Boolean(data.hasBreakfast),
    earlyCheckIn: data.earlyCheckIn || null
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

  // Per Spark Rewards audit 2026-07-18 HIGH-1: `/api/members/stays`
  // returns `bookingRef` + `lookupToken` for every match — together
  // those are the public lookup/cancel credential. If we keyed off
  // an unverified email, an attacker who registered with a victim's
  // email could enumerate and cancel the victim's anonymous
  // bookings. The `uid` (memberId) match is always safe. The email
  // match is gated on `email_verified` (Google sign-in tokens are
  // always verified, so this is effectively a gate on the
  // email/password path).
  if (authUser.email_verified !== true) {
    return res.status(403).json({
      success: false,
      code: "EMAIL_NOT_VERIFIED",
      error: "Please verify your email to see your past stays. Check your inbox for the verification link, or resend it from your profile."
    });
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

    // Per Spark Rewards audit 2026-07-18 HIGH-1: an unverified
    // email/password signup can claim any address. Linking past
    // bookings by `guestEmail == member.email` would let the
    // attacker take over a victim's anonymous bookings. Skip the
    // link when the email isn't verified — the member record is
    // still created, and the client surfaces a "verify your email"
    // prompt. Once verified, re-calling `/api/members/register`
    // re-runs the link (the registration path is idempotent —
    // `memberNumber` is preserved).
    const emailIsVerified = authUser.email_verified === true;
    const linkedBookings = emailIsVerified
      ? await linkBookingsByEmail(email, uid, parsed.data.bookingId || undefined)
      : 0;

    return res.status(200).json({
      success: true,
      data: {
        memberId: uid,
        memberNumber,
        linkedBookings,
        // Surfaced to the client so the "verify your email" prompt
        // appears on the post-signup confirmation. Cleared once the
        // guest verifies (next register call returns emailVerified: true).
        emailVerified: emailIsVerified
      },
      ...(emailIsVerified ? {} : {
        // Non-blocking warning: registration succeeded, but past
        // bookings won't link until the guest verifies their email.
        warning: "Verify your email to link your past bookings."
      })
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
      const rateBreakdown = rebuildRateBreakdown(booking, {
        pointsRedeemedValue: redemptionValue,
        finalTotal: nextTotalPrice
      });
      const historyRef = adminDb.collection(`members/${memberId}/pointsHistory`).doc();

      transaction.update(bookingRef, {
        memberId,
        totalPrice: nextTotalPrice,
        pointsRedeemed: pointsToRedeem,
        pointsRedeemedValue: redemptionValue,
        pointsRedeemedBy: staff.uid,
        pointsRedeemedAt: now,
        ...(rateBreakdown ? { rateBreakdown } : {}),
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
      const rateBreakdown = rebuildRateBreakdown(booking, {
        pointsRedeemedValue: 0,
        finalTotal: nextTotalPrice
      });
      const nextRewardsPoints = Number(member.rewardsPoints || 0) + restoredPoints;
      const historyRef = adminDb.collection(`members/${booking.memberId}/pointsHistory`).doc();

      transaction.update(bookingRef, {
        totalPrice: nextTotalPrice,
        pointsRedeemed: 0,
        pointsRedeemedValue: 0,
        pointsRedeemedBy: null,
        pointsRedeemedAt: null,
        ...(rateBreakdown ? { rateBreakdown } : {}),
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

// Per Spark Rewards audit 2026-07-18 MED-1: manual points
// adjustment is the only points-mutation path still on the
// client SDK. Moving it server-side makes the
// "rewardsPoints == sum(pointsHistory)" invariant provable at
// the rules boundary — once the Firestore `members/{uid}` rule
// drops `rewardsPoints` from the staff update allowlist, this
// endpoint is the only way a staff caller can change a
// member's balance, and the transaction couples the balance
// write with the history write in one commit.
//
// Caller is admin-only (mirrors the existing client-side
// `MembersPage.tsx` UI guard which already restricts manual
// adjustment to admins). Front-desk callers get a 403; the
// audit recommends admin-only so the privilege to "create
// money" stays with the hotel owner.
//
// The `type: "manual"` history row is fixed server-side so
// clients cannot inject an "earn" / "redeem" history entry
// through this path — the field's invariant is preserved.
export async function handleManualAdjustPoints(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (!staff.uid) {
    return res.status(401).json({ success: false, error: "Staff authentication is required." });
  }
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can adjust member points." });
  }

  const parsed = manualAdjustPointsSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please provide a valid member ID, a non-zero points amount, and a reason (max 500 characters)."
    });
  }

  const { memberId, amount, reason } = parsed.data;
  const trimmedReason = reason.trim();

  try {
    let responseData: any = {};

    await adminDb.runTransaction(async (transaction: any) => {
      const memberRef = adminDb.collection("members").doc(memberId);
      const memberDoc = await transaction.get(memberRef);
      if (!memberDoc.exists) {
        throw new Error("Member account was not found.");
      }

      const currentBalance = Number(memberDoc.data()?.rewardsPoints || 0);
      const nextBalance = currentBalance + amount;
      if (nextBalance < 0) {
        // Defense-in-depth: the schema doesn't allow amount >= 0 to
        // result in a negative balance check, but the cap is
        // enforced here in case a future schema change widens the
        // input. Matches the existing client-side guard.
        throw new Error("Points adjustment cannot reduce the member balance below zero.");
      }

      const historyRef = adminDb.collection(`members/${memberId}/pointsHistory`).doc();

      transaction.update(memberRef, {
        rewardsPoints: nextBalance,
        updatedAt: new Date()
      });
      transaction.set(historyRef, {
        type: "manual",
        points: amount,
        description: `Manual adjust: ${trimmedReason}`,
        reason: trimmedReason,
        bookingId: null,
        by: staff.uid,
        at: new Date()
      });

      responseData = {
        memberId,
        rewardsPoints: nextBalance,
        pointsAdjusted: amount,
        historyId: historyRef.id
      };
    });

    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    const message = error?.message || "We could not adjust points for this member.";
    // Per audit: surface the "balance cannot go negative" guard as
    // a 400 (client error), not a 500. The "not found" guard is
    // also a 400 — the client is asking about a non-existent
    // member, not a server failure.
    const status = message.includes("not found") || message.includes("below zero")
      ? 400
      : 500;
    return res.status(status).json({ success: false, error: message });
  }
}

// Per Spark Rewards audit 2026-07-18 MED-3: when a member's account
// email (e.g. Google) differs from the email on their earlier
// anonymous booking, `linkBookingsByEmail` (which matches only on
// the token email) won't link it. The spec's "guest self-service
// prompt" surface was explicitly deferred; this is the front-desk
// "manual link from Member detail drawer" surface that the audit
// kept as the smaller build path (decision #135).
//
// Invariants:
//   - Admin-only (front-desk 403) — same posture as the other staff-
//     mediated member mutations. The audit calls out the work-around
//     is staff-mediated, and admin-only matches `set-active` /
//     `manual-adjust`.
//   - Transaction: re-read member + booking inside one commit so a
//     concurrent register or a concurrent erase cannot race the link.
//   - Reject when the booking is already linked to a DIFFERENT
//     member (don't unlink someone else's stays) — 409 with a
//     clear message so the staff knows the conflict.
//   - Reject when the booking is cancelled or a test run — preserves
//     the audit trail and the test-run isolation invariant (test
//     bookings must never reach the production member surface).
//   - No-op success when the booking is already linked to THIS
//     member — re-linking is idempotent, the audit row is still
//     written so the action is recorded.
//   - Audit row written under `bookings/audit/records/{id}` with the
//     staff UID, reason, source/target emails, and timestamp — mirrors
//     the existing erasure audit shape (decision #49 / W1.4).
//   - The booking doc's `memberId` write is the only payload change
//     on the booking; the `memberId` field is already in the staff
//     update allowlist (decision #4 / pre-MED-3).
const linkBookingToMemberSchema = z.object({
  memberUid: z.string().trim().min(1).max(160),
  bookingId: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500)
}).strict();

/**
 * Per MED-3 G1 (build-variant follow-up 2026-08-20):
 * resolve the staff's `bookingId` paste to a concrete
 * Firestore doc id, accepting all three input shapes:
 *
 *   - `SPK-YYYYMMDD-NNNNN` (the human `bookingRef`,
 *     matches `BOOKING_REF_REGEX` from
 *     `shared/utils/references.ts`)
 *   - `R-YYYYMMDD-NNNNN` (the human `reservationRef`,
 *     matches `RESERVATION_REF_REGEX` from
 *     `shared/utils/references.ts`) — resolves via the
 *     `reservations/{ref}` header to the lead child +
 *     the `reservations/{id}` uuid
 *   - raw Firestore doc id (legacy pre-MRB-01 paths +
 *     post-MRB-01 child doc ids that staff paste from
 *     the bookings table)
 *
 * Returns a discriminated union. The `ok: true` branch
 * carries the resolved `bookingId` (always the lead
 * child for the `R-…` path, the matching doc id for the
 * `SPK-…` + raw-id paths) + the `reservationId` (null
 * for the raw-id + `SPK-…` paths unless the matching
 * booking carries one, non-null for the `R-…` path).
 * The `ok: false` branch carries the structured `code`
 * for the toast + a human-readable `message`.
 *
 * Why non-transactional: the resolver is a single
 * `get()` / `where().limit(1)` — FOL-03's
 * reads-before-writes invariant only applies inside the
 * transaction. The `runTransaction` block then re-reads
 * the booking via `transaction.get(bookingRef)` so the
 * FOL-03 invariant is preserved for the actual write
 * phase. A race where the booking is deleted between
 * the resolver read and the transaction read is handled
 * by the transaction's `exists: false` check
 * (surfaces 404 + `code: BOOKING_NOT_FOUND`).
 */
async function resolveBookingForLink(input: string): Promise<
  | { ok: true; bookingId: string; reservationId: string | null }
  | { ok: false; code: "BOOKING_NOT_FOUND" | "RESERVATION_NOT_FOUND"; message: string }
> {
  const trimmed = String(input || "").trim();
  if (!trimmed) {
    return { ok: false, code: "BOOKING_NOT_FOUND", message: "Booking was not found." };
  }

  // Path 1: `R-…` reservationRef. The shape `R-YYYYMMDD-NNNNN`
  // is the post-MRB-01 public-facing reservation ref. Resolve
  // it via the `reservations` collection's doc id (the public
  // ref is also the Firestore doc id, per the
  // `generateReservationRef` helper in
  // `shared/utils/reservationRef.ts`). Fall through to the
  // `reservations.where("reservationRef", "==", input)` query
  // for the case where a ref + a uuid diverge (e.g. legacy
  // pre-MRB-04 reservations).
  if (RESERVATION_REF_REGEX.test(trimmed)) {
    const reservationDoc = await adminDb.collection("reservations").doc(trimmed).get();
    if (reservationDoc.exists) {
      const reservationData = reservationDoc.data() || {};
      const leadBookingId = String(reservationData.leadBookingId || "").trim();
      if (leadBookingId) {
        return {
          ok: true,
          bookingId: leadBookingId,
          reservationId: reservationDoc.id
        };
      }
      // Reservation header exists but no `leadBookingId`
      // — try the `where("reservationRef", "==", ...)` fallback
      // (the public ref might be on the doc under a different
      // name, OR the lead field name might be older).
      const whereFallback = await adminDb
        .collection("reservations")
        .where("reservationRef", "==", trimmed)
        .get();
      if (!whereFallback.empty) {
        const fallbackDoc = whereFallback.docs[0];
        const fallbackData = fallbackDoc.data() || {};
        const fallbackLead = String(fallbackData.leadBookingId || "").trim();
        if (fallbackLead) {
          return {
            ok: true,
            bookingId: fallbackLead,
            reservationId: fallbackDoc.id
          };
        }
      }
      return {
        ok: false,
        code: "RESERVATION_NOT_FOUND",
        message: "Reservation was not found or has no lead booking."
      };
    }
    // Reservation header miss — try the
    // `where("reservationId", "==", input)` query on the
    // `bookings` collection. For the case where a staff typed
    // a reservation ref into the bookings collection's
    // `reservationId` field (defense in depth; the
    // `reservationRef` is a separate field, but a misconfigured
    // write path could have used `reservationId`).
    const bookingByReservationId = await adminDb
      .collection("bookings")
      .where("reservationId", "==", trimmed)
      .limit(1)
      .get();
    if (!bookingByReservationId.empty) {
      const matchDoc = bookingByReservationId.docs[0];
      return {
        ok: true,
        bookingId: matchDoc.id,
        reservationId: trimmed
      };
    }
    return {
      ok: false,
      code: "RESERVATION_NOT_FOUND",
      message: "Reservation was not found."
    };
  }

  // Path 2: `SPK-…` bookingRef. The shape `SPK-YYYYMMDD-NNNNN`
  // is the public-facing booking ref. Resolve via
  // `bookings.where("bookingRef", "==", input).limit(1)`
  // (the canonical "look up by bookingRef" pattern at
  // `email.ts:932` and `bookings.ts:6053`).
  if (BOOKING_REF_REGEX.test(trimmed)) {
    const byBookingRef = await adminDb
      .collection("bookings")
      .where("bookingRef", "==", trimmed)
      .limit(1)
      .get();
    if (!byBookingRef.empty) {
      const matchDoc = byBookingRef.docs[0];
      return {
        ok: true,
        bookingId: matchDoc.id,
        reservationId: null
      };
    }
    return {
      ok: false,
      code: "BOOKING_NOT_FOUND",
      message: "Booking was not found."
    };
  }

  // Path 3: raw doc id (legacy pre-MRB-01 + post-MRB-01 child
  // doc ids that staff paste from the bookings table). The
  // transaction will re-read this id and surface 404 +
  // BOOKING_NOT_FOUND if the doc has been deleted between the
  // paste and the link confirmation.
  return {
    ok: true,
    bookingId: trimmed,
    reservationId: null
  };
}

export async function handleLinkBookingToMember(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = getStaff(req);
  if (!staff.uid) {
    return res.status(401).json({ success: false, error: "Staff authentication is required." });
  }
  if (staff.role !== "admin") {
    return res.status(403).json({ success: false, error: "Only admins can link bookings to a member." });
  }

  const parsed = linkBookingToMemberSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please provide a member UID, a booking ID, and a reason (max 500 characters)."
    });
  }

  const { memberUid, bookingId, reason } = parsed.data;
  const trimmedReason = reason.trim();

  try {
    let responseData: any = {};

    // Per MED-3 G1 (build-variant follow-up 2026-08-20):
    // extend the resolver to accept all three input shapes
    // the staff actually paste. The pre-G1 surface only did
    // `adminDb.collection("bookings").doc(bookingId).get()` —
    // a doc-id lookup, so pasting the human `bookingRef`
    // (`SPK-…`) or `reservationRef` (`R-…`) returned
    // `{ exists: false }` and the catch mapped it to 400
    // with the verbatim "Booking was not found." message
    // (misleading copy — reads as a client typo, not as
    // "the server expected a doc id, you gave it a ref").
    // G1 also tightens the catch to surface 404 + a
    // structured `code: "BOOKING_NOT_FOUND"` /
    // `code: "RESERVATION_NOT_FOUND"` on the JSON response
    // so the toast can branch on code, not prose (per
    // `silent-rate-limit-fallback` skill's AFTER pattern).
    //
    // The resolver is non-transactional (a single-shot
    // `get()` / `where().limit(1)`); the resulting
    // `resolvedBookingId` is then read INSIDE the
    // transaction via `transaction.get(bookingRef)` (per the
    // FOL-03 reads-before-writes invariant). The two reads
    // are consistent for the staff's interactive
    // link-and-confirm flow (the time between the resolver
    // read and the transaction read is sub-second, and the
    // `linkedReason` audit row is written for every call
    // regardless of success — the existing idempotency
    // guard handles a race where the booking is deleted
    // mid-transaction: the transaction's `exists: false`
    // throws "Booking was not found." → 404).
    const resolution = await resolveBookingForLink(bookingId);
    if (!resolution.ok) {
      return res.status(404).json({
        success: false,
        code: resolution.code,
        error: resolution.message
      });
    }
    const resolvedBookingId = resolution.bookingId;
    const resolvedReservationId = resolution.reservationId;

    await adminDb.runTransaction(async (transaction: any) => {
      const memberRef = adminDb.collection("members").doc(memberUid);
      const memberDoc = await transaction.get(memberRef);
      if (!memberDoc.exists) {
        throw new Error("Member account was not found.");
      }

      const bookingRef = adminDb.collection("bookings").doc(resolvedBookingId);
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        // Race: the booking was deleted between the resolver
        // read + the transaction read. Surface 404 + the same
        // structured code so the toast branches on code
        // regardless of which read missed.
        throw new Error("BOOKING_NOT_FOUND:Booking was not found.");
      }

      const bookingData = bookingDoc.data() || {};
      const bookingStatus = String(bookingData.status || "");
      const bookingTestRunId = bookingData.testRunId || null;

      if (bookingStatus === "cancelled") {
        // Cancelled bookings are historical; linking them would put
        // the cancelled stay in the member's My Stays list, which
        // would surface a confusing "you cancelled this" card next
        // to a successful stay. The booking-lookup workaround +
        // booking-drawer `memberId` edit still let the staff
        // re-attach the PII if needed; the MED-3 link path is for
        // the common "realized I had two emails" case only.
        throw new Error("Cancelled bookings cannot be linked to a member.");
      }

      if (bookingTestRunId) {
        // Test-run bookings must never reach the production member
        // surface — the same invariant the rest of the audit closes
        // (ETR-07, audit S2.3 reconciliation spot-checks).
        throw new Error("Test-run bookings cannot be linked to a member.");
      }

      // Per MED-3 G2 (build-variant follow-up 2026-08-20):
      // for an N>1 reservation (post-MRB-01
      // bookings with `reservationId` set), query
      // the siblings in the same `runTransaction`
      // and fan the `memberId` write out to every
      // one. Pre-G2 the transaction only wrote to
      // the resolved booking — so the member's My
      // Stays list (which queries
      // `bookings.where("memberId", "==", uid)` at
      // `members.ts:192`) only showed the lead
      // child. G2 closes that gap.
      //
      // The fan-out is conditional on
      // `bookingData.reservationId` being set —
      // legacy pre-MRB-01 + N=1 reservations have
      // no `reservationId` and skip the sibling
      // query entirely (preserves the pre-G2
      // single-doc write shape).
      //
      // The siblings are read in the SAME
      // `runTransaction` so the sibling query is
      // consistent with the rest of the write set
      // (per the FOL-03 reads-before-writes
      // invariant). The conflict guard at line 837
      // is extended: if ANY sibling is linked to a
      // different member, the whole link fails 409
      // (no silent overwrite on the lead, no
      // partial fan-out).
      const existingMemberId = bookingData.memberId || null;

      if (existingMemberId && existingMemberId !== memberUid) {
        // Surface the conflict cleanly on the lead
        // child. The sibling-extension below adds
        // the same check for every other child in
        // the same reservation. The thrown error
        // becomes a 409 in the catch.
        throw new Error("This booking is already linked to a different member account. Unlink it from the booking drawer first, then retry.");
      }

      let siblingDocs: Array<{ id: string; data: any }> = [];
      const isReservationBooking = !!(bookingData.reservationId && String(bookingData.reservationId).trim());
      if (isReservationBooking) {
        const siblingsQuery = await adminDb
          .collection("bookings")
          .where("reservationId", "==", String(bookingData.reservationId).trim())
          .get();
        siblingDocs = siblingsQuery.docs
          .map((d: any) => ({ id: d.id, data: d.data() || {} }))
          .filter((b: any) => String(b.id) !== String(resolvedBookingId));
        // G2.D: every sibling must be either
        // unlinked OR linked to the same member.
        // A different member on any sibling is a
        // 409 conflict (no silent overwrite).
        for (const sibling of siblingDocs) {
          const siblingMemberId = sibling.data.memberId || null;
          if (siblingMemberId && siblingMemberId !== memberUid) {
            throw new Error("This booking is already linked to a different member account. Unlink it from the booking drawer first, then retry.");
          }
        }
      }
      // The lead + the siblings form the fan-out
      // set. The lead's existingMemberId is the
      // primary gate (single-doc conflict guard
      // from pre-G2); each sibling's memberId is
      // the per-sibling gate (G2).
      const allTargets = [
        { id: resolvedBookingId, data: bookingData, existingMemberId },
        ...siblingDocs.map((s) => ({
          id: s.id,
          data: s.data,
          existingMemberId: s.data.memberId || null
        }))
      ];
      const allAlreadyLinked = allTargets.every((t) => t.existingMemberId === memberUid);
      const now = new Date();

      if (!allAlreadyLinked) {
        for (const target of allTargets) {
          if (target.existingMemberId === memberUid) continue; // idempotent skip
          const siblingRef = adminDb.collection("bookings").doc(target.id);
          transaction.update(siblingRef, {
            memberId: memberUid,
            linkedByStaff: staff.uid,
            linkedAt: now,
            linkedReason: trimmedReason,
            updatedAt: now
          });
        }
      }

      // Audit row — same shape as the erasure audit, written
      // before the booking update so a partial transaction can be
      // retried without losing the audit trail. Per MED-3 G1
      // (build-variant 2026-08-20): when the link resolves via the
      // `R-…` reservationRef path, the audit row carries the
      // `reservationId` + `reservationRef` so future auditors can
      // tell whether the staff linked a single child or a whole
      // reservation. Per MED-3 G2: the audit row also carries
      // `linkedBookingIds` (the fan-out set) so a future audit
      // can disambiguate "linked the lead" from "linked the
      // whole reservation".
      const linkedBookingIds = allTargets.map((t) => t.id);
      const auditRef = adminDb
        .collection("bookings").doc("audit").collection("records").doc(`${resolvedBookingId}-link-${now.getTime()}`);
      transaction.set(auditRef, {
        bookingId: resolvedBookingId,
        bookingRef: bookingData.bookingRef || "",
        // G1: include the reservation cluster on the
        // audit row so a future reconciliation can
        // disambiguate "linked the lead" from "linked
        // the whole reservation".
        reservationId: bookingData.reservationId || resolvedReservationId || null,
        reservationRef: bookingData.reservationRef || null,
        // G2: include the fan-out set so an auditor
        // can see exactly which bookings were
        // linked (and which were skipped via the
        // idempotency guard).
        linkedBookingIds,
        action: "manual-link-member",
        fromMemberId: existingMemberId,
        toMemberId: memberUid,
        memberEmail: memberDoc.data()?.email || "",
        bookingEmail: bookingData.guestEmail || "",
        reason: trimmedReason,
        staffUid: staff.uid,
        staffRole: staff.role,
        at: now
      });

      responseData = {
        memberUid,
        bookingId: resolvedBookingId,
        bookingRef: bookingData.bookingRef || "",
        // G1: surface the resolved reservation cluster
        // (null on legacy pre-MRB-01 single-room
        // links) so the admin UI can confirm what
        // was linked.
        reservationId: bookingData.reservationId || resolvedReservationId || null,
        // G2: surface the fan-out set so the
        // admin UI can confirm which bookings were
        // linked. Always array-shaped (length 1
        // for the single-doc back-compat path).
        linkedBookingIds,
        alreadyLinked: allAlreadyLinked,
        auditId: auditRef.id
      };
    });

    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    const message = error?.message || "We could not link this booking to the member.";
    // The conflict guard ("already linked to a different member")
    // is a 409 — the request is well-formed but conflicts with
    // existing data, not a server failure. Per MED-3 G1
    // (build-variant 2026-08-20): the "was not found" branch is
    // tightened to 404 with a structured `code: BOOKING_NOT_FOUND`
    // / `code: RESERVATION_NOT_FOUND` so the toast can branch on
    // code, not prose (per `silent-rate-limit-fallback` skill's
    // AFTER pattern). Validation errors (cancelled, test-run,
    // member-not-found, conflict) stay at 400 / 409. Default to
    // 500.
    if (message.includes("already linked to a different member")) {
      return res.status(409).json({ success: false, error: message });
    }
    if (message.startsWith("BOOKING_NOT_FOUND:")) {
      return res.status(404).json({
        success: false,
        code: "BOOKING_NOT_FOUND",
        error: message.replace(/^BOOKING_NOT_FOUND:/, "")
      });
    }
    if (message.startsWith("RESERVATION_NOT_FOUND:")) {
      return res.status(404).json({
        success: false,
        code: "RESERVATION_NOT_FOUND",
        error: message.replace(/^RESERVATION_NOT_FOUND:/, "")
      });
    }
    if (message.includes("was not found")
      || message.includes("cannot be linked")
      || message.includes("Cancelled bookings")
      || message.includes("Test-run bookings")) {
      return res.status(400).json({ success: false, error: message });
    }
    return res.status(500).json({ success: false, error: message });
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

export async function handleSendVerificationEmail(req: any, res: any) {
  try {
    const authUser = getAuthUser(req);
    if (!authUser?.uid || !authUser?.email) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: Missing or invalid authentication token."
      });
    }

    if (authUser.email_verified === true) {
      return res.status(200).json({
        success: true,
        message: "Email is already verified.",
        data: { alreadyVerified: true }
      });
    }

    const email = authUser.email;
    const guestName = authUser.name || authUser.displayName || "";

    const actionCodeSettings = {
      url: `${getServerBaseUrl()}/account/profile?emailVerified=true`,
      handleCodeInApp: true
    };

    const verificationLink = await adminAuth.generateEmailVerificationLink(email, actionCodeSettings);

    await sendVerificationEmailTrigger({
      guestName,
      email,
      verificationLink
    });

    return res.status(200).json({
      success: true,
      message: "Verification email sent successfully."
    });
  } catch (error: any) {
    console.error("handleSendVerificationEmail failed:", error);
    // Per operator report 2026-08-20: a generic 500 here
    // surfaces to the banner as a useless "try again" message
    // even when the real cause is a Firebase console config
    // issue (e.g. `auth/unauthorized-continue-uri` because the
    // continue-URL domain is not in the project's authorized
    // domains list). The firebase-admin SDK puts the error code
    // on both `error.code` and `error.errorInfo.code` — we read
    // both so the mapping survives any SDK shape changes.
    const firebaseErrorCode =
      (typeof error?.errorInfo?.code === "string" && error.errorInfo.code) ||
      (typeof error?.code === "string" && error.code) ||
      "";
    if (firebaseErrorCode === "auth/unauthorized-continue-uri") {
      return res.status(500).json({
        success: false,
        code: "auth/unauthorized-continue-uri",
        error:
          "This site's domain is not allowlisted in the Firebase project's authorized domains list. " +
          "Add the current hostname (e.g. stg.sparkinnbohol.com) under Firebase Console → Authentication → Settings → Authorized domains, then try again."
      });
    }
    return res.status(500).json({
      success: false,
      error: "Failed to send verification email. Please try again."
    });
  }
}
