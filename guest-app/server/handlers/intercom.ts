import { adminDb } from "../lib/firebase-admin";

const MAX_ROOM_NUMBER_LENGTH = 12;
const MAX_LAST_NAME_LENGTH = 80;
const MAX_BOOKING_ID_LENGTH = 128;

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
