import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import {
  BOOKING_OCCUPYING_STATUSES,
  isBookingOccupyingRoom,
  toDateOrNull
} from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";

const STAFF_HOLD_MINUTES = 15;

const holdRangeSchema = z.object({
  roomIds: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/)
}).strict();

const holdIdSchema = z.object({
  holdId: z.string().trim().regex(/^[A-Za-z0-9]{10,32}$/)
}).strict();

function parseRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("End date must be after start date.");
  }
  return { start, end };
}

function rangesOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function staffUid(req: any) {
  return String(req.staff?.uid || "").trim();
}

export function isActiveStaffInventoryHold(data: any, now = new Date()) {
  const expiresAt = toDateOrNull(data?.expiresAt);
  return data?.status === "active" && Boolean(expiresAt && expiresAt > now);
}

export function serializeStaffInventoryHold(
  id: string,
  data: any,
  now = new Date()
) {
  const expiresAt = toDateOrNull(data.expiresAt);
  const status = data.status === "active" && (!expiresAt || expiresAt <= now)
    ? "expired"
    : data.status;
  return {
    id,
    roomIds: Array.isArray(data.roomIds) ? data.roomIds.map(String) : [],
    roomNumbers: Array.isArray(data.roomNumbers) ? data.roomNumbers.map(String) : [],
    startDate: toDateOrNull(data.startDate)?.toISOString().slice(0, 10) || "",
    endDate: toDateOrNull(data.endDate)?.toISOString().slice(0, 10) || "",
    status,
    expiresAt: expiresAt?.toISOString() || new Date(0).toISOString(),
    createdBy: String(data.createdBy || ""),
    createdAt: toDateOrNull(data.createdAt)?.toISOString() || "",
    updatedAt: toDateOrNull(data.updatedAt)?.toISOString() || "",
    consumedAt: toDateOrNull(data.consumedAt)?.toISOString() || null,
    releasedAt: toDateOrNull(data.releasedAt)?.toISOString() || null
  };
}

export async function hasActiveStaffInventoryHoldConflict(
  transaction: FirebaseFirestore.Transaction,
  roomId: string,
  start: Date,
  end: Date,
  excludeHoldId?: string
) {
  const snapshot = await transaction.get(
    adminDb.collection("staffInventoryHolds")
      .where("roomIds", "array-contains", roomId)
      .where("status", "==", "active")
  );
  const now = new Date();
  return snapshot.docs.some((doc) => {
    if (excludeHoldId && doc.id === excludeHoldId) return false;
    const data = doc.data();
    if (!isActiveStaffInventoryHold(data, now)) return false;
    const holdStart = toDateOrNull(data.startDate);
    const holdEnd = toDateOrNull(data.endDate);
    return Boolean(holdStart && holdEnd && rangesOverlap(holdStart, holdEnd, start, end));
  });
}

export async function handleAcquireStaffInventoryHold(req: any, res: any) {
  const parsed = holdRangeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Choose valid rooms and dates." });
  }
  const roomIds = Array.from(new Set(parsed.data.roomIds));
  if (roomIds.length !== parsed.data.roomIds.length) {
    return res.status(400).json({ success: false, error: "Each room can only be selected once." });
  }

  try {
    const { start, end } = parseRange(parsed.data.startDate, parsed.data.endDate);
    const holdRef = adminDb.collection("staffInventoryHolds").doc();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + STAFF_HOLD_MINUTES * 60_000);
    let roomNumbers: string[] = [];

    await adminDb.runTransaction(async (transaction) => {
      const rooms: Array<{ id: string; data: any }> = [];
      for (const roomId of roomIds) {
        const roomSnap = await transaction.get(adminDb.collection("rooms").doc(roomId));
        if (!roomSnap.exists) throw new Error("One of the selected rooms no longer exists.");
        const room = roomSnap.data() || {};
        if (room.isActive === false) throw new Error(`Room ${room.roomNumber || roomId} is inactive.`);
        rooms.push({ id: roomId, data: room });
      }

      for (const room of rooms) {
        const bookingsSnapshot = await transaction.get(
          adminDb.collection("bookings")
            .where("roomId", "==", room.id)
            .where("status", "in", BOOKING_OCCUPYING_STATUSES)
        );
        const bookingConflict = bookingsSnapshot.docs.some((doc) => {
          const data = doc.data();
          if (!isBookingOccupyingRoom({ status: data.status, holdExpiresAt: data.holdExpiresAt }, now)) return false;
          const checkIn = toDateOrNull(data.checkIn);
          const checkOut = toDateOrNull(data.checkOut);
          return Boolean(checkIn && checkOut && rangesOverlap(checkIn, checkOut, start, end));
        });
        if (bookingConflict) throw new Error(`Room ${room.data.roomNumber || room.id} was just booked for those dates.`);

        const blocksSnapshot = await transaction.get(
          adminDb.collection("roomBlocks")
            .where("roomId", "==", room.id)
            .where("status", "==", "active")
        );
        const blockConflict = blocksSnapshot.docs.some((doc) => {
          const data = doc.data();
          const blockStart = toDateOrNull(data.startDate);
          const blockEnd = toDateOrNull(data.endDate);
          return Boolean(blockStart && blockEnd && rangesOverlap(blockStart, blockEnd, start, end));
        });
        if (blockConflict) throw new Error(`Room ${room.data.roomNumber || room.id} is blocked for those dates.`);

        if (await hasActiveStaffInventoryHoldConflict(transaction, room.id, start, end)) {
          throw new Error(`Room ${room.data.roomNumber || room.id} is already held by another front-desk booking.`);
        }
      }

      roomNumbers = rooms.map((room) => String(room.data.roomNumber || room.id));
      transaction.set(holdRef, {
        roomIds,
        roomNumbers,
        startDate: Timestamp.fromDate(start),
        endDate: Timestamp.fromDate(end),
        status: "active",
        createdBy: staffUid(req),
        createdAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now),
        expiresAt: Timestamp.fromDate(expiresAt),
        consumedAt: null,
        releasedAt: null
      });
    });

    return res.status(201).json({
      success: true,
      data: serializeStaffInventoryHold(holdRef.id, {
        roomIds,
        roomNumbers,
        startDate: start,
        endDate: end,
        status: "active",
        createdBy: staffUid(req),
        createdAt: now,
        updatedAt: now,
        expiresAt,
        consumedAt: null,
        releasedAt: null
      })
    });
  } catch (error: any) {
    return res.status(409).json({ success: false, error: error.message || "Could not hold those rooms." });
  }
}

export async function handleReleaseStaffInventoryHold(req: any, res: any) {
  const parsed = holdIdSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "A valid hold id is required." });
  try {
    const ref = adminDb.collection("staffInventoryHolds").doc(parsed.data.holdId);
    await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new Error("Hold not found.");
      const data = snap.data() || {};
      if (data.createdBy !== staffUid(req)) throw new Error("This hold belongs to another staff member.");
      if (data.status !== "active") return;
      const now = new Date();
      transaction.update(ref, {
        status: "released",
        releasedAt: Timestamp.fromDate(now),
        updatedAt: Timestamp.fromDate(now)
      });
    });
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(409).json({ success: false, error: error.message || "Could not release the hold." });
  }
}

export async function handleExtendStaffInventoryHold(req: any, res: any) {
  const parsed = holdIdSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "A valid hold id is required." });
  try {
    const ref = adminDb.collection("staffInventoryHolds").doc(parsed.data.holdId);
    let responseData: any = null;
    await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new Error("Hold not found.");
      const data = snap.data() || {};
      if (data.createdBy !== staffUid(req)) throw new Error("This hold belongs to another staff member.");
      if (!isActiveStaffInventoryHold(data)) throw new Error("This hold has expired. Return to the calendar and hold the rooms again.");
      const now = new Date();
      const expiresAt = new Date(now.getTime() + STAFF_HOLD_MINUTES * 60_000);
      transaction.update(ref, { expiresAt: Timestamp.fromDate(expiresAt), updatedAt: Timestamp.fromDate(now) });
      responseData = serializeStaffInventoryHold(snap.id, { ...data, expiresAt, updatedAt: now });
    });
    return res.status(200).json({ success: true, data: responseData });
  } catch (error: any) {
    return res.status(409).json({ success: false, error: error.message || "Could not extend the hold." });
  }
}
