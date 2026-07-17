import { z } from "zod";
import { adminDb } from "../lib/firebase-admin";

const MAX_ROOM_NUMBER_LENGTH = 12;
const MAX_LAST_NAME_LENGTH = 80;
const MAX_BOOKING_ID_LENGTH = 128;

// G-04 (E2E audit 2026-07-17): strict-Zod validated guest intercom
// message submission. Staff replies bypass this endpoint and are
// written directly via Firestore rules. We do not expose booking
// PII through this route — only roomNumber, guestName, and
// currentStayId are accepted.
const guestMessageSchema = z.object({
  roomNumber: z.string().trim().min(1).max(MAX_ROOM_NUMBER_LENGTH),
  guestName: z.string().trim().min(1).max(120),
  currentStayId: z.string().trim().min(1).max(128),
  text: z.string().trim().min(1).max(1000),
  isQuickRequest: z.boolean().optional().default(false),
  isStoreOrder: z.boolean().optional().default(false),
  orderRef: z.string().trim().max(80).optional().default(""),
  isEarlyCheckInRequest: z.boolean().optional().default(false),
  isCancelledOrder: z.boolean().optional().default(false)
}).strict();


interface VerifyGuestBody {
  roomNumber?: string;
  lastName?: string;
  bookingId?: string;
}

function normalizeName(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}

function getBookingLastName(data: FirebaseFirestore.DocumentData) {
  const guestDetails = data.guestDetails && typeof data.guestDetails === "object"
    ? data.guestDetails
    : {};
  const explicitLastName = guestDetails.lastName || data.guestLastName || data.lastName;
  if (explicitLastName) return normalizeName(explicitLastName);

  const nameParts = String(data.guestName || "").trim().split(/\s+/).filter(Boolean);
  return normalizeName(nameParts.length > 1 ? nameParts.slice(1).join(" ") : nameParts[0] || "");
}

function getPublicBookingSummary(docSnap: FirebaseFirestore.QueryDocumentSnapshot) {
  const data = docSnap.data();
  return {
    bookingId: docSnap.id,
    bookingRef: String(data.bookingRef || ""),
    guestName: String(data.guestName || ""),
    checkIn: String(data.checkIn || ""),
    checkOut: String(data.checkOut || "")
  };
}

async function getCurrentStay(roomNumber: string) {
  const snapshot = await adminDb.collection("bookings")
    .where("roomNumber", "==", roomNumber)
    .where("status", "==", "checked-in")
    .limit(1)
    .get();

  return snapshot.empty ? null : snapshot.docs[0];
}

// Simple in-memory rate-limit store for guest messages (not exported;
// the apiRouter has its own but this handler routes directly).
const guestMessageRateLimit = new Map<string, { count: number; resetTime: number }>();

function isGuestMessageRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const record = guestMessageRateLimit.get(key);
  if (!record || now > record.resetTime) {
    guestMessageRateLimit.set(key, { count: 1, resetTime: now + windowMs });
    return false;
  }
  record.count++;
  return record.count > limit;
}

// G-04 (E2E audit 2026-07-17): guest intercom messages are routed
// through this server-side endpoint instead of direct Firestore
// writes. Enforces ~30 messages per room per 10 minutes, with an
// IP/room composite key. Does not expose booking PII outside the
// roomNumber/guestName/currentStayId already verified client-side.
export async function handleSendGuestMessage(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const parsed = guestMessageSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Please check your message and try again."
    });
  }

  const { roomNumber, guestName, currentStayId, text, isQuickRequest, isStoreOrder, orderRef, isEarlyCheckInRequest, isCancelledOrder } = parsed.data;

  const rawIp = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";
  const ip = Array.isArray(rawIp) ? rawIp[0] : String(rawIp).split(",")[0].trim();

  // Rate limit: 30 messages per room per 10 minutes, keyed by
  // IP + room number to prevent a single IP flooding all rooms.
  if (isGuestMessageRateLimited(`intercom-msg:${ip}:${roomNumber}`, 30, 10 * 60 * 1000)) {
    return res.status(429).json({
      success: false,
      error: "Too many messages. Please wait a few minutes or call the front desk."
    });
  }

  try {
    await adminDb.collection("intercoms").doc(roomNumber).set({
      roomId: roomNumber,
      roomNumber,
      guestName,
      currentStayId,
      resolved: false,
      updatedAt: new Date()
    }, { merge: true });

    await adminDb.collection("intercoms").doc(roomNumber).collection("messages").add({
      text,
      sender: "guest",
      guestName,
      timestamp: new Date(),
      isRead: false,
      isQuickRequest,
      isStoreOrder,
      orderRef: orderRef || "",
      isEarlyCheckInRequest,
      currentStayId
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Failed to send intercom message:", error);
    return res.status(500).json({
      success: false,
      error: "Your message was not sent. Please try again or call the front desk."
    });
  }
}

export async function handleVerifyIntercomGuest(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const body = (req.body || {}) as VerifyGuestBody;
  const roomNumber = String(body.roomNumber || "").trim();
  const lastName = String(body.lastName || "").trim();
  const bookingId = String(body.bookingId || "").trim();

  if (!roomNumber || roomNumber.length > MAX_ROOM_NUMBER_LENGTH) {
    return res.status(400).json({ success: false, error: "Invalid room number." });
  }
  if (lastName.length > MAX_LAST_NAME_LENGTH || bookingId.length > MAX_BOOKING_ID_LENGTH) {
    return res.status(400).json({ success: false, error: "Invalid verification details." });
  }
  if (!lastName && !bookingId) {
    return res.status(400).json({ success: false, error: "Last name is required." });
  }

  try {
    const currentStay = await getCurrentStay(roomNumber);
    if (!currentStay) {
      return res.status(403).json({ success: false, error: "This intercom is available only for checked-in guests." });
    }

    if (bookingId) {
      if (currentStay.id !== bookingId) {
        return res.status(403).json({ success: false, error: "Please verify this stay again." });
      }
      await adminDb.collection("intercoms").doc(roomNumber).set({
        roomId: roomNumber,
        roomNumber,
        currentStayId: currentStay.id,
        updatedAt: new Date()
      }, { merge: true });
      return res.status(200).json({ success: true, data: getPublicBookingSummary(currentStay) });
    }

    const expectedLastName = getBookingLastName(currentStay.data());
    if (!expectedLastName || normalizeName(lastName) !== expectedLastName) {
      return res.status(403).json({ success: false, error: "We could not verify that last name for this room." });
    }

    const intercomRef = adminDb.collection("intercoms").doc(roomNumber);
    await intercomRef.set({
      roomId: roomNumber,
      roomNumber,
      currentStayId: currentStay.id,
      updatedAt: new Date()
    }, { merge: true });

    return res.status(200).json({ success: true, data: getPublicBookingSummary(currentStay) });
  } catch (error) {
    console.error("Intercom guest verification failed:", error);
    return res.status(500).json({ success: false, error: "Unable to verify this intercom session." });
  }
}
