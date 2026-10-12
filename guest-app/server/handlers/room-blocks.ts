import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "../lib/firebase-admin";
import { toDateOrNull, BOOKING_OCCUPYING_STATUSES, isBookingOccupyingRoom } from "@spark-inn/shared";
import { hasActiveStaffInventoryHoldConflict } from "./staff-inventory-holds";

// Per PEX-02 (2026-08-01, per decision #147): the room-blocks
// check uses the shared occupancy rule on top of the coarse
// `status in [...]` Firestore query, so an expired `pending` hold
// does not block a staff-initiated block on those dates. The
// block itself is an explicit staff action; if the hold's
// late-revival tries to claim the same dates, the create
// transaction's atomic retirement will have already cancelled
// the hold. Staff-block safety is preserved.
const ROOM_OCCUPYING_STATUSES = BOOKING_OCCUPYING_STATUSES;

const blockSchema = z.object({
  roomId: z.string().trim().min(1).max(80),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(500).optional().default("")
});

const updateBlockSchema = blockSchema.extend({
  blockId: z.string().trim().min(1).max(80),
  roomId: z.string().trim().min(1).max(80).optional()
});

const cancelBlockSchema = z.object({
  blockId: z.string().trim().min(1).max(80)
});

const bulkBlockSchema = z.object({
  roomIds: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
  startDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(500).optional().default("")
}).strict();

function parseStayRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new Error("End date must be after start date.");
  }
  return { start, end };
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

async function assertRoomIsFreeForBlock(
  transaction: FirebaseFirestore.Transaction,
  roomId: string,
  start: Date,
  end: Date,
  excludeBlockId?: string
) {
  const bookingsQuery = adminDb.collection("bookings")
    .where("roomId", "==", roomId)
    .where("status", "in", ROOM_OCCUPYING_STATUSES);
  const bookingsSnapshot = await transaction.get(bookingsQuery);
  const bookingConflict = bookingsSnapshot.docs.some((doc) => {
    const data = doc.data();
    // Per PEX-02 (2026-08-01, per decision #147): an expired
    // `pending` hold does not block a staff-initiated block. The
    // shared rule is the only authority.
    if (!isBookingOccupyingRoom({ status: data.status, holdExpiresAt: data.holdExpiresAt })) {
      return false;
    }
    const checkIn = toDateOrNull(data.checkIn);
    const checkOut = toDateOrNull(data.checkOut);
    return Boolean(checkIn && checkOut && overlaps(checkIn, checkOut, start, end));
  });
  if (bookingConflict) {
    throw new Error("Cannot block dates that overlap an active booking.");
  }

  const blocksQuery = adminDb.collection("roomBlocks")
    .where("roomId", "==", roomId)
    .where("status", "==", "active");
  const blocksSnapshot = await transaction.get(blocksQuery);
  const blockConflict = blocksSnapshot.docs.some((doc) => {
    if (excludeBlockId && doc.id === excludeBlockId) return false;
    const data = doc.data();
    const blockStart = toDateOrNull(data.startDate);
    const blockEnd = toDateOrNull(data.endDate);
    return Boolean(blockStart && blockEnd && overlaps(blockStart, blockEnd, start, end));
  });
  if (blockConflict) {
    throw new Error("These dates already overlap another active block.");
  }

  if (await hasActiveStaffInventoryHoldConflict(transaction, roomId, start, end)) {
    throw new Error("These dates are temporarily held for a front-desk booking.");
  }
}

export async function handleCreateBulkRoomBlocks(req: any, res: any) {
  const parsed = bulkBlockSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Please choose rooms, valid dates, and a reason." });
  }
  const roomIds = Array.from(new Set(parsed.data.roomIds));
  if (roomIds.length !== parsed.data.roomIds.length) {
    return res.status(400).json({ success: false, error: "Each room can only be selected once." });
  }

  try {
    const { start, end } = parseStayRange(parsed.data.startDate, parsed.data.endDate);
    const batchId = adminDb.collection("roomBlockBatches").doc().id;
    const blockIds: string[] = [];

    await adminDb.runTransaction(async (transaction) => {
      const resolvedRooms: Array<{ id: string; data: any }> = [];
      for (const roomId of roomIds) {
        const roomDoc = await transaction.get(adminDb.collection("rooms").doc(roomId));
        if (!roomDoc.exists) throw new Error("One of the selected rooms was not found.");
        const room = roomDoc.data() || {};
        if (room.isActive === false) throw new Error(`Room ${room.roomNumber || roomId} is inactive.`);
        resolvedRooms.push({ id: roomId, data: room });
      }

      for (const room of resolvedRooms) {
        await assertRoomIsFreeForBlock(transaction, room.id, start, end);
      }

      const now = new Date();
      for (const room of resolvedRooms) {
        const blockRef = adminDb.collection("roomBlocks").doc();
        blockIds.push(blockRef.id);
        transaction.set(blockRef, {
          batchId,
          roomId: room.id,
          roomNumber: String(room.data.roomNumber || ""),
          roomType: String(room.data.type || ""),
          startDate: Timestamp.fromDate(start),
          endDate: Timestamp.fromDate(end),
          reason: parsed.data.reason,
          notes: parsed.data.notes || "",
          status: "active",
          createdBy: req.staff?.uid || req.staff?.email || "staff",
          createdAt: now,
          updatedAt: now,
          cancelledAt: null,
          cancelledBy: null
        });
      }
    });

    return res.status(200).json({ success: true, batchId, blockIds });
  } catch (error: any) {
    return res.status(409).json({ success: false, error: error.message || "Failed to block dates." });
  }
}

export async function handleCreateRoomBlock(req: any, res: any) {
  const parsed = blockSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Please choose a room, valid dates, and a reason." });
  }

  try {
    const { start, end } = parseStayRange(parsed.data.startDate, parsed.data.endDate);
    let blockId = "";

    await adminDb.runTransaction(async (transaction) => {
      const roomRef = adminDb.collection("rooms").doc(parsed.data.roomId);
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists) throw new Error("Room not found.");
      const room = roomDoc.data() || {};
      if (room.isActive === false) throw new Error("Cannot block an inactive room.");

      await assertRoomIsFreeForBlock(transaction, parsed.data.roomId, start, end);

      const blockRef = adminDb.collection("roomBlocks").doc();
      blockId = blockRef.id;
      transaction.set(blockRef, {
        roomId: parsed.data.roomId,
        roomNumber: String(room.roomNumber || ""),
        roomType: String(room.type || ""),
        startDate: Timestamp.fromDate(start),
        endDate: Timestamp.fromDate(end),
        reason: parsed.data.reason,
        notes: parsed.data.notes || "",
        status: "active",
        createdBy: req.staff?.uid || req.staff?.email || "staff",
        createdAt: new Date(),
        updatedAt: new Date(),
        cancelledAt: null,
        cancelledBy: null
      });
    });

    return res.status(200).json({ success: true, blockId });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message || "Failed to block dates." });
  }
}

export async function handleUpdateRoomBlock(req: any, res: any) {
  const parsed = updateBlockSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Please provide valid block details." });
  }

  try {
    const { start, end } = parseStayRange(parsed.data.startDate, parsed.data.endDate);

    await adminDb.runTransaction(async (transaction) => {
      const blockRef = adminDb.collection("roomBlocks").doc(parsed.data.blockId);
      const blockDoc = await transaction.get(blockRef);
      if (!blockDoc.exists) throw new Error("Block not found.");
      const existing = blockDoc.data() || {};
      if (existing.status === "cancelled") throw new Error("Cancelled blocks cannot be edited.");

      const targetRoomId = parsed.data.roomId || existing.roomId;
      if (!targetRoomId) throw new Error("Room ID is required.");

      const roomRef = adminDb.collection("rooms").doc(targetRoomId);
      const roomDoc = await transaction.get(roomRef);
      if (!roomDoc.exists) throw new Error("Room not found.");
      const room = roomDoc.data() || {};

      await assertRoomIsFreeForBlock(transaction, targetRoomId, start, end, parsed.data.blockId);

      transaction.update(blockRef, {
        roomId: targetRoomId,
        roomNumber: String(room.roomNumber || ""),
        roomType: String(room.type || ""),
        startDate: Timestamp.fromDate(start),
        endDate: Timestamp.fromDate(end),
        reason: parsed.data.reason,
        notes: parsed.data.notes || "",
        updatedAt: new Date()
      });
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message || "Failed to update block." });
  }
}

export async function handleCancelRoomBlock(req: any, res: any) {
  const parsed = cancelBlockSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "Block ID is required." });
  }

  try {
    const blockRef = adminDb.collection("roomBlocks").doc(parsed.data.blockId);
    await blockRef.update({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: req.staff?.uid || req.staff?.email || "staff",
      updatedAt: new Date()
    });
    return res.status(200).json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message || "Failed to unblock dates." });
  }
}
