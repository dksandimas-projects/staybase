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
  isInFlowHoldActive,
  normalizeInFlowHoldMinutes
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
  // Per the IFH-01.2 (settings-routing) follow-up: the
  // per-hotel `settings/hotelConfig.inFlowHoldMinutes`
  // field is the source of truth. The constant
  // `IN_FLOW_HOLD_MINUTES` is the fallback for legacy
  // settings (no field) + the hand-edit-Firestore case.
  // Same pattern as `paymentHoldWindowHours` (PEX-01):
  // server reads the settings doc once at start time,
  // snapshots the value onto the hold doc as
  // `holdMinutes`, and the rest of the lifecycle reads
  // the snapshot (a later Settings change never
  // shortens or lengthens an existing guest's promise).
  const hotelConfigRef = adminDb.collection("settings").doc("hotelConfig");
  const hotelConfigSnap = await hotelConfigRef.get();
  const hotelConfig = hotelConfigSnap.exists ? hotelConfigSnap.data() ?? {} : {};
  const effectiveHoldMinutes = normalizeInFlowHoldMinutes(
    (hotelConfig as { inFlowHoldMinutes?: unknown }).inFlowHoldMinutes
  );

  const expiresAt = computeInFlowHoldExpiresAt(effectiveHoldMinutes, now);
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
      // Per the IFH-01.2 (settings-routing) follow-up:
      // the snapshot is the per-hotel config value
      // (`effectiveHoldMinutes`), not the module
      // constant. A later Settings change never
      // shortens or lengthens an existing guest's
      // promise — the snapshotted value is the only
      // field the rest of the lifecycle reads.
      holdMinutes: effectiveHoldMinutes
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

// Cron-driven Janitor sweep for stale in-flow holds.
//
// Per the IFH-01 follow-up: the IFH-01 commit shipped
// the start + read + consume handlers but deferred the
// Janitor sweep (the read-time `isInFlowHoldActive`
// evaluation already reports stale holds as `"expired"`
// honestly, so the sweep is a cleanup of the on-disk
// `status`, not a UX-critical path). This handler is
// the dedicated sweep:
//
//   1. Query `bookingHolds` for `status == "active"` + `expiresAt < now`.
//   2. Mark each match `"expired"` (no delete — the
//      audit trail is more useful when the doc is
//      preserved with a tombstone status).
//   3. Return a count so the cron response is auditable.
//   4. Idempotent: a re-fire of the same cron tick
//      finds zero matches (the first run marked them
//      all `"expired"`).
//
// Auth: same `CRON_SECRET` pattern as the existing
// `/api/holds/expire` PEX-06 cron. Vercel sets the
// `x-cron-secret` header on every cron invocation.
//
// Schedule: hourly (in `vercel.json`). The 15-minute
// `IN_FLOW_HOLD_MINUTES` window means a stale hold can
// be left in `"active"` for up to 60 minutes before
// this sweep runs. The read-time evaluation already
// reports it as `"expired"` to the banner — the sweep
// is purely an on-disk cleanup so future reports +
// the `bookingHolds` collection size stay bounded.

const SWEEP_BATCH_SIZE = 200;

export interface SweepInFlowHoldsResult {
  swept: number;
  scanned: number;
  runAt: string;
}

export async function handleSweepInFlowHolds(
  req: any,
  res: any,
  options: { now?: Date; skipAuthCheck?: boolean } = {}
): Promise<SweepInFlowHoldsResult | { ok: false; status: number; error: string }> {
  // The route registration in apiRouter.ts enforces
  // the method + CRON_SECRET. This handler also
  // re-checks for defense-in-depth (the function can
  // be called directly from a future ops endpoint
  // without going through the apiRouter path).
  if (!options.skipAuthCheck) {
    if (req.method !== "POST" && req.method !== "GET") {
      return { ok: false, status: 405, error: "Method not allowed." };
    }
    const expected = process.env.CRON_SECRET;
    if (!expected) {
      return { ok: false, status: 500, error: "CRON_SECRET is not configured on the server." };
    }
    const headerSecret = req.headers?.["x-cron-secret"];
    const authHeader = req.headers?.authorization;
    const authorized =
      (typeof headerSecret === "string" && headerSecret === expected) ||
      (typeof authHeader === "string" &&
        authHeader.startsWith("Bearer ") &&
        authHeader.slice("Bearer ".length) === expected);
    if (!authorized) {
      return { ok: false, status: 401, error: "Unauthorized cron request." };
    }
  }

  const now = options.now ?? new Date();
  let swept = 0;
  let scanned = 0;

  try {
    // Per the same PEX-06 pattern: the coarse Firestore
    // filter is `status == "active"` + `expiresAt < now`,
    // ordered by `expiresAt` so the oldest deadlines are
    // swept first (matters at scale). The per-doc
    // recheck inside the transaction is the
    // authoritative gate — a hold may have been
    // consumed by a booking between the coarse query
    // and the per-doc write.
    const expiredSnapshot = await adminDb
      .collection(HOLDS_COLLECTION)
      .where("status", "==", "active")
      .where("expiresAt", "<", Timestamp.fromDate(now))
      .orderBy("expiresAt", "asc")
      .limit(SWEEP_BATCH_SIZE)
      .get();

    scanned = expiredSnapshot.size;

    for (const doc of expiredSnapshot.docs) {
      try {
        await adminDb.runTransaction(async (transaction) => {
          const freshDoc = await transaction.get(doc.ref);
          if (!freshDoc.exists) return;
          const freshData = freshDoc.data() ?? {};
          // Recheck eligibility — a booking
          // transaction may have consumed this hold
          // between the coarse query and the per-doc
          // write.
          if (freshData.status === "consumed") return;
          if (freshData.status === "expired") return;
          const expiresAt = toIsoOrNull(freshData.expiresAt);
          if (isInFlowHoldActive({ status: freshData.status, expiresAt }, now)) {
            return;
          }
          transaction.update(doc.ref, {
            status: "expired",
            updatedAt: Timestamp.fromDate(now)
          });
        });
        swept += 1;
      } catch (err) {
        // A single bad doc must not stop the
        // sweep. Log + continue.
        console.error(
          `In-flow hold sweep failed for ${doc.id}:`,
          err
        );
      }
    }

    return {
      swept,
      scanned,
      runAt: now.toISOString()
    };
  } catch (err) {
    return { ok: false, status: 500, error: "Failed to sweep in-flow holds." };
  }
}
