import { adminDb } from "../lib/firebase-admin";

// Per W4.7 / `plan/features/AVAILABILITY-LOCKING.md`: this endpoint is the
// guest-side replacement for the previous client-side `bookings` subscription.
// Firestore rules deny guest reads on `bookings` (`allow read: if isStaff()`),
// so the client cannot list active bookings directly. Instead, it asks the
// server for PII-stripped booked date ranges that overlap a requested window
// and uses them only for UX filtering. The actual double-booking safety is
// the Firestore transaction in `handleCreateBooking` / `handleCreateWalkin`.

// Bookings with these statuses occupy the room and must be excluded from
// availability. `cancelled` is intentionally omitted — cancelled bookings
// release the room.
const ACTIVE_STATUSES = ["pending", "payment-uploaded", "confirmed", "checked-in"];

interface AvailabilityQuery {
  checkIn?: string;
  checkOut?: string;
}

// Normalize a Firestore checkIn/checkOut value to an ISO YYYY-MM-DD string.
// Accepts Firestore Timestamps (`{ toDate(): Date }`), JS Dates, and ISO
// strings. Returns null if the value cannot be parsed.
function toIsoDate(value: any): string | null {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    if (d instanceof Date && !isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  }
  return null;
}

export async function handleRoomAvailability(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const { checkIn, checkOut } = (req.query || {}) as AvailabilityQuery;

  if (!checkIn || !checkOut) {
    return res.status(400).json({
      success: false,
      error: "checkIn and checkOut query parameters are required (YYYY-MM-DD)."
    });
  }

  const reqStart = new Date(`${checkIn}T00:00:00Z`);
  const reqEnd = new Date(`${checkOut}T00:00:00Z`);

  if (isNaN(reqStart.getTime()) || isNaN(reqEnd.getTime()) || reqEnd <= reqStart) {
    return res.status(400).json({
      success: false,
      error: "Invalid date range. checkOut must be after checkIn."
    });
  }

  try {
    // Only fetch active bookings whose date range overlaps the requested
    // window. We use `where("status", "in", ...)` so Firestore filters
    // out cancelled/no-show/etc. server-side. The client only needs the
    // date span and roomId, not PII.
    const overlapSnapshot = await adminDb
      .collection("bookings")
      .where("status", "in", ACTIVE_STATUSES)
      .get();

    const bookedRanges: Array<{ roomId: string; checkIn: string; checkOut: string; status: string }> = [];

    overlapSnapshot.forEach((docSnap: any) => {
      const data = docSnap.data();
      const startIso = toIsoDate(data.checkIn);
      const endIso = toIsoDate(data.checkOut);
      const roomId = data.roomId;
      const status = data.status;
      if (!startIso || !endIso || !roomId || !status) return;

      const bStart = new Date(`${startIso}T00:00:00Z`);
      const bEnd = new Date(`${endIso}T00:00:00Z`);

      // Overlap test: requested range intersects the booking range
      if (bStart < reqEnd && bEnd > reqStart) {
        bookedRanges.push({ roomId, checkIn: startIso, checkOut: endIso, status });
      }
    });

    return res.status(200).json({
      success: true,
      data: { bookedRanges }
    });
  } catch (error: any) {
    console.error("Error fetching room availability:", error);
    return res.status(500).json({
      success: false,
      error: "An error occurred while fetching room availability."
    });
  }
}
