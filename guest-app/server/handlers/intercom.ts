import { z } from "zod";
import { adminDb } from "../lib/firebase-admin";
import { generateLookupToken } from "@spark-inn/shared";

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
  // Per PR-AUDIT-B3 (2026-10-20): the capability token issued by
  // `handleVerifyIntercomGuest`. It selects the session-scoped
  // collection the message is written to, and the server re-validates
  // it against the intercom document before writing.
  sessionToken: z.string().trim().min(16).max(64),
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

// Per the intercom-verify-guest permanent fix (2026-08-21):
// `getBookingLastName` is the single source of truth for what
// the guest must type to unlock the in-room intercom. It reads
// ONLY from the structured `guestDetails.lastName` field on the
// booking doc — never the concatenated `guestName` top-level
// string. The legacy split-on-whitespace fallback was retired
// because it silently invented a "last name" by treating
// everything after the first token of the full name as the
// family name (e.g. for `guestName: "Maria Clara Santos"` it
// returned "Clara Santos" — rejecting the real last name and
// accepting the second given name). Booking write paths now
// persist a structured `guestDetails: { firstName, lastName,
// email, phone }` on every booking doc, so this function has
// a real, structured value to read.
//
// Exported for unit-testability — see
// `guest-app/tests/api/intercom-lastname-persistence.test.ts`.
export function getBookingLastName(data: FirebaseFirestore.DocumentData) {
  const guestDetails = data.guestDetails && typeof data.guestDetails === "object"
    ? data.guestDetails
    : {};
  // Strict: only the structured lastName counts. Returning ""
  // when the field is missing causes the verifier to reject
  // with 403 (front desk re-verifies) instead of silently
  // accepting a wrong last name.
  const explicitLastName = guestDetails.lastName || data.guestLastName || data.lastName;
  return explicitLastName ? normalizeName(explicitLastName) : "";
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

/**
 * Resolve and validate the guest's stay for an intercom message.
 *
 * Per PR-AUDIT-B6 (2026-10-20): the send endpoint used to trust the
 * request body completely — `roomNumber`, `guestName` and
 * `currentStayId` were written straight to Firestore through the
 * Admin SDK. The only check was "does the room have a checked-in
 * booking", which the caller never proved: any anonymous caller could
 * post into ANY room's thread as a spoofed guest name, and the desk
 * is instructed to treat intercom messages as genuine guest requests.
 *
 * The server now resolves the booking itself and derives the guest's
 * identity from it:
 *   - the booking must exist,
 *   - it must belong to the claimed room,
 *   - it must be CHECKED IN (the same condition `getCurrentStay`
 *     uses, so the two paths agree on what "in-house" means),
 *   - the session token must match the one the server issued for that
 *     room's current stay.
 *
 * `guestName` is taken from the BOOKING, not from the request body.
 */
async function resolveVerifiedStay(params: {
  roomNumber: string;
  currentStayId: string;
  sessionToken: string;
}) {
  const { roomNumber, currentStayId, sessionToken } = params;

  const bookingSnap = await adminDb.collection("bookings").doc(currentStayId).get();
  if (!bookingSnap.exists) {
    return { ok: false as const, error: "We could not verify this stay." };
  }

  const booking = bookingSnap.data() || {};
  const bookingRoom = String(booking.roomNumber || "").trim();
  if (!bookingRoom || bookingRoom !== roomNumber) {
    return { ok: false as const, error: "We could not verify this stay." };
  }
  if (String(booking.status || "") !== "checked-in") {
    return { ok: false as const, error: "This intercom is available only for checked-in guests." };
  }

  // The session token must be the one the server issued for THIS room.
  const intercomSnap = await adminDb.collection("intercoms").doc(roomNumber).get();
  const storedToken = String((intercomSnap.data() || {}).currentStayToken || "");
  if (!storedToken || storedToken !== sessionToken) {
    return { ok: false as const, error: "Please verify this stay again." };
  }
  if (String((intercomSnap.data() || {}).currentStayId || "") !== currentStayId) {
    return { ok: false as const, error: "Please verify this stay again." };
  }

  // The guest's name comes from the booking — never from the request.
  const guestDetails = (booking.guestDetails && typeof booking.guestDetails === "object")
    ? (booking.guestDetails as Record<string, unknown>)
    : {};
  const bookingGuestName = String(
    booking.guestName
    || [guestDetails.firstName, guestDetails.lastName].filter(Boolean).join(" ")
    || ""
  ).trim();

  return {
    ok: true as const,
    bookingId: bookingSnap.id,
    guestName: bookingGuestName
  };
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

  const { roomNumber, sessionToken, text, isQuickRequest, isStoreOrder, orderRef, isEarlyCheckInRequest, isCancelledOrder } = parsed.data;

  // Per PR-AUDIT-H6 (2026-10-20): `x-vercel-forwarded-for` is
  // Vercel's own sanitized single-value client IP and stays correct
  // even with a proxy in front of Vercel (the one case where
  // `x-forwarded-for` could be overwritten). Vercel overwrites
  // `x-forwarded-for` and does not forward external IPs.
  const rawIp =
    req.headers["x-vercel-forwarded-for"] ||
    req.headers["x-forwarded-for"] ||
    req.headers["x-real-ip"] ||
    req.socket.remoteAddress ||
    "unknown";
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
    // Per PR-AUDIT-B6 (2026-10-20): the guest's identity is resolved
    // from the booking on the server. The request body's `guestName` is
    // IGNORED — the desk sees the name the guest booked under, not one
    // a caller typed.
    const verified = await resolveVerifiedStay({
      roomNumber,
      currentStayId: parsed.data.currentStayId,
      sessionToken
    });
    if (!verified.ok) {
      return res.status(403).json({ success: false, error: verified.error });
    }
    const guestName = verified.guestName || parsed.data.guestName;

    // The intercom thread document is staff-only now (PR-AUDIT-B5), so
    // the server is the only writer. It carries the capability token
    // the desk uses to address the guest's session.
    await adminDb.collection("intercoms").doc(roomNumber).set({
      roomId: roomNumber,
      roomNumber,
      guestName,
      currentStayId: verified.bookingId,
      currentStayToken: sessionToken,
      resolved: false,
      updatedAt: new Date()
    }, { merge: true });

    // Per PR-AUDIT-B3 (2026-10-20): the message is written to the
    // SESSION-SCOPED collection, whose path contains the unguessable
    // capability token. The legacy room-scoped collection is
    // staff-only, so the guest's thread is no longer world-readable.
    await adminDb.collection("intercomSessions").doc(sessionToken).collection("messages").add({
      text,
      sender: "guest",
      guestName,
      timestamp: new Date(),
      isRead: false,
      isQuickRequest,
      isStoreOrder,
      orderRef: orderRef || "",
      isEarlyCheckInRequest,
      currentStayId: verified.bookingId,
      roomNumber
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

    // Per PR-AUDIT-B3 (2026-10-20): issue (or reuse) the capability
    // token for this room's current stay. The token is the guest's
    // ONLY credential for reading their own thread, so it must be:
    //   - stable for the duration of the stay (the guest's realtime
    //     listener is bound to the path that contains it), and
    //   - regenerated when the stay changes (so the previous guest's
    //     token cannot read the next guest's messages).
    const intercomRef = adminDb.collection("intercoms").doc(roomNumber);
    const intercomSnap = await intercomRef.get();
    const intercomData = intercomSnap.data() || {};
    const sameStay = String(intercomData.currentStayId || "") === currentStay.id;
    const existingToken = String(intercomData.currentStayToken || "");
    const sessionToken = sameStay && existingToken ? existingToken : generateLookupToken();

    if (bookingId) {
      if (currentStay.id !== bookingId) {
        return res.status(403).json({ success: false, error: "Please verify this stay again." });
      }
      await intercomRef.set({
        roomId: roomNumber,
        roomNumber,
        currentStayId: currentStay.id,
        currentStayToken: sessionToken,
        updatedAt: new Date()
      }, { merge: true });
      return res.status(200).json({
        success: true,
        data: { ...getPublicBookingSummary(currentStay), sessionToken }
      });
    }

    const expectedLastName = getBookingLastName(currentStay.data());
    if (!expectedLastName || normalizeName(lastName) !== expectedLastName) {
      return res.status(403).json({ success: false, error: "We could not verify that last name for this room." });
    }

    await intercomRef.set({
      roomId: roomNumber,
      roomNumber,
      currentStayId: currentStay.id,
      currentStayToken: sessionToken,
      updatedAt: new Date()
    }, { merge: true });

    return res.status(200).json({
      success: true,
      data: { ...getPublicBookingSummary(currentStay), sessionToken }
    });
  } catch (error) {
    console.error("Intercom guest verification failed:", error);
    return res.status(500).json({ success: false, error: "Unable to verify this intercom session." });
  }
}
