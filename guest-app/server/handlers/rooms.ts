import { adminDb } from "../lib/firebase-admin";
// Per PEX-02 (2026-08-01, per decision #147): the availability
// endpoint is the third of three readers of "does this booking
// occupy the room?" — the create / walkin / reschedule
// transactions and the room-blocks handler are the other two.
// All three now use `isBookingOccupyingRoom` as the per-doc
// filter on top of the coarse `status in [...]` Firestore query,
// so an expired `pending` hold shows as free in the public
// availability response (the cron will retire it eventually;
// the create / walkin / reschedule transactions retire it
// atomically when the next guest tries to take the room).
import { BOOKING_OCCUPYING_STATUSES, isBookingOccupyingRoom } from "@spark-inn/shared";

// Per W4.7 / `plan/features/AVAILABILITY-LOCKING.md`: this endpoint is the
// guest-side replacement for the previous client-side `bookings` subscription.
// Firestore rules deny guest reads on `bookings` (`allow read: if isStaff()`),
// so the client cannot list active bookings directly. Instead, it asks the
// server for PII-stripped booked date ranges that overlap a requested window
// and uses them only for UX filtering. The actual double-booking safety is
// the Firestore transaction in `handleCreateBooking` / `handleCreateWalkin`.

// Bookings with these statuses occupy the room and must be excluded from
// availability. `cancelled` is intentionally omitted — cancelled bookings
// release the room. The shared list is the source of truth (PEX-02).
const ACTIVE_STATUSES = BOOKING_OCCUPYING_STATUSES;

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
    // Per BF-22 (booking-flow audit 2026-06-26): the previous
    // implementation pulled every active booking in the
    // collection and filtered in JS. The BookingPage calls this
    // endpoint on every date change at Step 1, so the cost
    // scales linearly with the bookings collection size. The
    // fix pushes the upper bound of the overlap check down to
    // Firestore: an existing booking can only overlap the
    // requested window if its `checkIn` is strictly before the
    // requested `checkOut`. The lower bound (`bEnd > reqStart`)
    // is still filtered in JS (Firestore doesn't support OR
    // across two inequality fields), but the dominant cost
    // (a full collection scan) is gone. The composite index
    // `(status, checkIn)` is declared in
    // `firebase/firestore.indexes.json` (BF-23).
    const overlapSnapshot = await adminDb
      .collection("bookings")
      .where("status", "in", ACTIVE_STATUSES)
      .where("checkIn", "<", reqEnd)
      .get();

    const blocksSnapshot = await adminDb
      .collection("roomBlocks")
      .where("status", "==", "active")
      .where("startDate", "<", reqEnd)
      .get();

    const bookedRanges: Array<{ roomId: string; checkIn: string; checkOut: string; status: string }> = [];

    overlapSnapshot.forEach((docSnap: any) => {
      const data = docSnap.data();
      const startIso = toIsoDate(data.checkIn);
      const endIso = toIsoDate(data.checkOut);
      const roomId = data.roomId;
      const status = data.status;
      if (!startIso || !endIso || !roomId || !status) return;

      // Per PEX-02 (2026-08-01, per decision #147): the public
      // availability endpoint may display an eligible expired
      // hold as free. The create / walkin / reschedule
      // transactions retire it atomically when the next guest
      // takes the room; the cron retires any leftover ones.
      if (!isBookingOccupyingRoom({ status, holdExpiresAt: data.holdExpiresAt })) {
        return;
      }

      const bStart = new Date(`${startIso}T00:00:00Z`);
      const bEnd = new Date(`${endIso}T00:00:00Z`);

      // Overlap test: requested range intersects the booking range
      if (bStart < reqEnd && bEnd > reqStart) {
        bookedRanges.push({ roomId, checkIn: startIso, checkOut: endIso, status });
      }
    });

    blocksSnapshot.forEach((docSnap: any) => {
      const data = docSnap.data();
      const startIso = toIsoDate(data.startDate);
      const endIso = toIsoDate(data.endDate);
      const roomId = data.roomId;
      if (!startIso || !endIso || !roomId) return;

      const bStart = new Date(`${startIso}T00:00:00Z`);
      const bEnd = new Date(`${endIso}T00:00:00Z`);

      // Overlap test: requested range intersects the block range
      if (bStart < reqEnd && bEnd > reqStart) {
        bookedRanges.push({ roomId, checkIn: startIso, checkOut: endIso, status: "blocked" });
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
