import { z } from "zod";
import { generateMemberNumber, validatePointsRedemption } from "@spark-inn/shared";
import config from "../../../hotel.config";
import { adminAuth, adminDb } from "../lib/firebase-admin";
import { rebuildRateBreakdown } from "../lib/rate-breakdown";

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

    await adminDb.runTransaction(async (transaction: any) => {
      const memberRef = adminDb.collection("members").doc(memberUid);
      const memberDoc = await transaction.get(memberRef);
      if (!memberDoc.exists) {
        throw new Error("Member account was not found.");
      }

      const bookingRef = adminDb.collection("bookings").doc(bookingId);
      const bookingDoc = await transaction.get(bookingRef);
      if (!bookingDoc.exists) {
        throw new Error("Booking was not found.");
      }

      const bookingData = bookingDoc.data() || {};
      const bookingStatus = String(bookingData.status || "");
      const bookingTestRunId = bookingData.testRunId || null;
      const existingMemberId = bookingData.memberId || null;

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

      if (existingMemberId && existingMemberId !== memberUid) {
        // Surface the conflict cleanly. The staff can either unlink
        // the booking via the booking-drawer `memberId` edit (out of
        // scope for this fix) or pick a different booking. The
        // thrown error becomes a 409 in the catch.
        throw new Error("This booking is already linked to a different member account. Unlink it from the booking drawer first, then retry.");
      }

      const alreadyLinked = existingMemberId === memberUid;
      const now = new Date();

      if (!alreadyLinked) {
        transaction.update(bookingRef, {
          memberId: memberUid,
          linkedByStaff: staff.uid,
          linkedAt: now,
          linkedReason: trimmedReason,
          updatedAt: now
        });
      }

      // Audit row — same shape as the erasure audit, written
      // before the booking update so a partial transaction can be
      // retried without losing the audit trail.
      const auditRef = adminDb
        .collection("bookings").doc("audit").collection("records").doc(`${bookingId}-link-${now.getTime()}`);
      transaction.set(auditRef, {
        bookingId,
        bookingRef: bookingData.bookingRef || "",
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
        bookingId,
        bookingRef: bookingData.bookingRef || "",
        alreadyLinked,
        auditId: auditRef.id
      };
    });

    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    const message = error?.message || "We could not link this booking to the member.";
    // The conflict guard ("already linked to a different member")
    // is a 409 — the request is well-formed but conflicts with
    // existing data, not a server failure. Everything else that
    // mentions a missing member/booking or a cancelled/test-run
    // booking is a 400 (client error). Default to 500.
    const status = message.includes("already linked to a different member")
      ? 409
      : message.includes("was not found")
        || message.includes("cannot be linked")
        || message.includes("Cancelled bookings")
        || message.includes("Test-run bookings")
        ? 400
        : 500;
    return res.status(status).json({ success: false, error: message });
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
