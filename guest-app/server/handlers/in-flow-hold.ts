// In-flow hold handlers for the public booking flow's
// Steps 2 + 3 countdown banner.
//
// Lifecycle:
//   1. Guest on Step 1 clicks "Continue to Step 2".
//      The client preallocates a `holdId` (UUIDv4) and
//      calls POST /api/holds/start. The server stamps a
//      fresh `bookingHolds/{holdId}` doc with
//      `expiresAt = now + IN_FLOW_HOLD_MINUTES` and
//      `status: "active"`.
//   2. The Step 2 + Step 3 banner subscribes to the
//      hold via Firestore `onSnapshot` (or reads it via
//      GET /api/holds/:holdId) and renders the
//      countdown.
//   3. On Confirm, handleCreateBooking reads the hold
//      in the same Firestore transaction, validates it
//      is still "active" + not past `expiresAt`, marks
//      it "consumed", and proceeds with the booking
//      create.
//   4. If the guest abandons the flow, the hold's
//      `expiresAt` lapses. The read-time
//      `isInFlowHoldActive` helper (in shared/) returns
//      false; a future Janitor / cron will sweep stale
//      "active" holds past their deadline.
//
// Why this is a separate ephemeral collection (not a
// field on `reservations/{id}`): the reservation header
// doesn't exist until the booking transaction commits
// (MRB-01). Pre-creating the header would force MRB-01
// to handle a "draft" stage that every downstream reader
// would have to ignore. A dedicated `bookingHolds/{id}`
// collection keeps the hold lifecycle isolated.

import { Timestamp } from "firebase-admin/firestore";
import {
  HOLD_ID_REGEX,
  IN_FLOW_HOLD_MINUTES,
  MAX_IN_FLOW_HOLD_MINUTES,
  MIN_IN_FLOW_HOLD_MINUTES,
  StartBookingHoldSchema,
  computeInFlowHoldExpiresAt,
  isInFlowHoldActive
} from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";

const HOLDS_COLLECTION = "bookingHolds";

function toIsoOrNull(value: any): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    if (d instanceof Date && !isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function serializeHold(snap: FirebaseFirestore.DocumentSnapshot): {
  id: string;
  reservationId: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  numNights: number;
  expiresAt: string;
  status: "active" | "consumed" | "expired";
  createdAt: string;
  holdMinutes: number;
} {
  const data = snap.data() ?? {};
  return {
    id: snap.id,
    reservationId: String(data.reservationId ?? ""),
    roomType: String(data.roomType ?? ""),
    checkIn: String(data.checkIn ?? ""),
    checkOut: String(data.checkOut ?? ""),
    numNights: Number(data.numNights ?? 0),
    expiresAt: toIsoOrNull(data.expiresAt) ?? new Date(0).toISOString(),
    status:
      data.status === "consumed" || data.status === "expired"
        ? data.status
        : "active",
    createdAt: toIsoOrNull(data.createdAt) ?? new Date(0).toISOString(),
    holdMinutes: Number(data.holdMinutes ?? IN_FLOW_HOLD_MINUTES)
  };
}

// POST /api/holds/start
// Rate limit + Turnstile are enforced in apiRouter.ts
// before this handler is invoked.
export async function handleStartInFlowHold(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const parsed = StartBookingHoldSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid hold request.",
      details: parsed.error.flatten()
    });
  }
  const input = parsed.data;

  const holdMinutes = IN_FLOW_HOLD_MINUTES;
  if (
    !Number.isFinite(holdMinutes) ||
    holdMinutes < MIN_IN_FLOW_HOLD_MINUTES ||
    holdMinutes > MAX_IN_FLOW_HOLD_MINUTES
  ) {
    return res.status(500).json({
      success: false,
      error: "Hold window is misconfigured."
    });
  }
  const now = new Date();
  const expiresAt = computeInFlowHoldExpiresAt(holdMinutes, now);
  if (!expiresAt) {
    return res.status(500).json({
      success: false,
      error: "Failed to compute hold deadline."
    });
  }

  const ref = adminDb.collection(HOLDS_COLLECTION).doc(input.holdId);

  try {
    // Idempotent: a second POST with the same holdId
    // (a retry after a flaky network) returns the
    // existing doc unchanged rather than restarting
    // the clock. The "another guest holds this room"
    // case is impossible because the holdId is
    // client-preallocated (UUIDv4 collision is
    // negligible).
    const existing = await ref.get();
    if (existing.exists) {
      const data = existing.data() ?? {};
      if (data.reservationId !== input.reservationId) {
        return res.status(409).json({
          success: false,
          error: "Hold id is already in use."
        });
      }
      return res.status(200).json({
        success: true,
        data: serializeHold(existing),
        idempotentReplay: true
      });
    }

    await ref.set({
      reservationId: input.reservationId,
      roomType: input.roomType,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      numNights: input.numNights,
      expiresAt: Timestamp.fromDate(expiresAt),
      status: "active",
      createdAt: Timestamp.fromDate(now),
      holdMinutes
    });

    const fresh = await ref.get();
    return res.status(201).json({
      success: true,
      data: serializeHold(fresh)
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Failed to start hold."
    });
  }
}

// GET /api/holds/:holdId
export async function handleReadInFlowHold(req: any, res: any) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }
  const holdId = String(req.query?.holdId || "").trim();
  if (!holdId) {
    return res.status(400).json({ success: false, error: "holdId is required." });
  }
  if (!HOLD_ID_REGEX.test(holdId)) {
    return res.status(400).json({ success: false, error: "Invalid hold id format." });
  }

  try {
    const ref = adminDb.collection(HOLDS_COLLECTION).doc(holdId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ success: false, error: "Hold not found." });
    }
    const data = snap.data() ?? {};
    const expiresAt = toIsoOrNull(data.expiresAt);
    const activeNow = isInFlowHoldActive({
      status: data.status,
      expiresAt
    });
    // Server-side read-time evaluation: a hold past
    // its deadline is reported as "expired" even if
    // the Janitor hasn't run yet. The on-disk `status`
    // stays "active" until the Janitor cleans it up —
    // we don't mutate the doc on every read.
    const payload = serializeHold(snap);
    if (payload.status === "active" && !activeNow) {
      payload.status = "expired";
    }
    return res.status(200).json({
      success: true,
      data: payload
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: "Failed to read hold."
    });
  }
}

// Server-only consume path. Called by handleCreateBooking
// inside the same `runTransaction` as the booking write —
// see the bookings.ts update below.
export async function handleConsumeInFlowHold(
  holdId: string,
  reservationId: string,
  now: Date = new Date()
): Promise<
  | { ok: true; hold: ReturnType<typeof serializeHold> }
  | {
      ok: false;
      reason: "not-found" | "expired" | "stale-reservation" | "already-consumed";
    }
> {
  if (!HOLD_ID_REGEX.test(holdId)) {
    return { ok: false, reason: "not-found" };
  }
  const ref = adminDb.collection(HOLDS_COLLECTION).doc(holdId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { ok: false, reason: "not-found" };
  }
  const data = snap.data() ?? {};
  if (data.reservationId && data.reservationId !== reservationId) {
    return { ok: false, reason: "stale-reservation" };
  }
  if (data.status === "consumed") {
    return { ok: false, reason: "already-consumed" };
  }
  const expiresAt = toIsoOrNull(data.expiresAt);
  if (!isInFlowHoldActive({ status: data.status, expiresAt }, now)) {
    // Mark it expired so the next read reports
    // "expired" cleanly. The Janitor will sweep
    // eventually.
    await ref.update({ status: "expired", updatedAt: Timestamp.fromDate(now) });
    return { ok: false, reason: "expired" };
  }
  await ref.update({ status: "consumed", updatedAt: Timestamp.fromDate(now) });
  return { ok: true, hold: serializeHold(snap) };
}
