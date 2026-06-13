import { z } from "zod";
import { generateMemberNumber } from "@spark-inn/shared";
import config from "../../../hotel.config";
import { adminDb } from "../lib/firebase-admin";

const registerMemberSchema = z.object({
  fullName: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  photoUrl: z.string().trim().max(500).optional().default(""),
  authProvider: z.enum(["google", "email"]).optional().default("email"),
  bookingId: z.string().trim().max(120).optional().default("")
}).strict();

function getAuthUser(req: any) {
  return (req as any).user || {};
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

export async function handleRegisterMember(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const authUser = getAuthUser(req);
  if (!authUser.uid || !authUser.email) {
    return res.status(401).json({ success: false, error: "Sign in before joining Spark Rewards." });
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
      error: "We could not join Spark Rewards right now. Please try again."
    });
  }
}
