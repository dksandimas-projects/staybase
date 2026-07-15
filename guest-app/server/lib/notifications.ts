// Per Phase 12 — Notification Center (decision #120):
// server-side helper for writing persisted `notifications`
// docs via the Admin SDK. Called from the existing API
// routes (booking create / add-payment / confirm / check-in
// / check-out / store order placed) after the primary
// Firestore write succeeds.
//
// The helper is **best-effort**: a failed notification write
// must never fail the booking/payment it describes, so all
// errors are logged + swallowed. This is the same pattern
// the email-send helpers follow (`sendBookingTrigger` etc.).
//
// Fields written: `type`, `title`, `entityType`, `entityId`,
// `roomNumber`, `bookingRef`, `readBy: {}`, `createdBy: "system"`,
// `createdAt: serverTimestamp()`. Per Hard Rules, never log
// guest email / payment data — only room number + booking ref.

import type { Notification, NotificationEntityType, NotificationType } from "@spark-inn/shared";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";

const MAX_TITLE_LENGTH = 160;
const MAX_ID_LENGTH = 64;
const MAX_ROOM_LENGTH = 12;
const MAX_REF_LENGTH = 40;

export interface WriteNotificationInput {
  type: NotificationType;
  title: string;
  entityType: NotificationEntityType;
  entityId: string;
  roomNumber?: string | null;
  bookingRef?: string | null;
}

/**
 * Write a `notifications` doc via the Admin SDK. Best-effort:
 * errors are logged + swallowed so the caller's primary
 * operation is never disrupted by a notification write
 * failure. The doc id is auto-generated; clients read it via
 * the `onSnapshot` listener in the bell panel.
 */
export async function writeNotification(input: WriteNotificationInput): Promise<void> {
  try {
    const title = String(input.title || "").trim().slice(0, MAX_TITLE_LENGTH);
    const entityId = String(input.entityId || "").trim().slice(0, MAX_ID_LENGTH);
    if (!title || !entityId) {
      console.warn("[notifications] Skipping write — missing required field:", {
        hasTitle: !!title,
        hasEntityId: !!entityId
      });
      return;
    }
    const roomNumber = input.roomNumber != null
      ? String(input.roomNumber).trim().slice(0, MAX_ROOM_LENGTH)
      : null;
    const bookingRef = input.bookingRef != null
      ? String(input.bookingRef).trim().slice(0, MAX_REF_LENGTH)
      : null;

    await adminDb.collection("notifications").add({
      type: input.type,
      title,
      entityType: input.entityType,
      entityId,
      roomNumber: roomNumber || null,
      bookingRef: bookingRef || null,
      readBy: {},
      createdBy: "system",
      createdAt: Timestamp.now()
    });
  } catch (err) {
    // Per spec: best-effort, never fail the caller.
    console.error("[notifications] Failed to write notification:", err);
  }
}

/**
 * Helper for the retention cron. Deletes `notifications`
 * docs whose `createdAt` is older than `maxAgeMs`. Returns
 * the number of docs deleted (and the IDs so the caller
 * can log them).
 *
 * Per NC-03 (post-ship review 2026-07-15): deletes are
 * issued via Firestore's `BulkWriter` so the work runs
 * in parallel and retries transient failures
 * automatically. The default `batchSize` is 500; the
 * `BulkWriter` itself flushes at 500 ops by default, so
 * one prune call prunes exactly one batch.
 *
 * Auth-gated by the route's CRON_SECRET — this function
 * itself does no auth. The rule allows client `delete: if
 * false`; the Admin SDK bypasses the rule. Tests in
 * `notification-center-writes.test.ts` mock the Admin SDK
 * and assert the bounded query + delete count.
 */
export interface PruneNotificationsResult {
  scanned: number;
  deleted: number;
  deletedIds: string[];
  cutoffIso: string;
}

export async function pruneNotifications(maxAgeMs: number, batchSize = 500): Promise<PruneNotificationsResult> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const snap = await adminDb
    .collection("notifications")
    .where("createdAt", "<", Timestamp.fromDate(cutoff))
    .orderBy("createdAt", "asc")
    .limit(batchSize)
    .get();

  const deletedIds: string[] = [];
  if (snap.docs.length === 0) {
    return {
      scanned: 0,
      deleted: 0,
      deletedIds,
      cutoffIso: cutoff.toISOString()
    };
  }

  // Per NC-03: use a BulkWriter so deletes run in
  // parallel and transient failures are retried
  // automatically. Each per-doc promise resolves on
  // success and rejects on terminal failure; we collect
  // the successes into the returned `deletedIds`.
  const writer = adminDb.bulkWriter();
  const queue = snap.docs.map((docSnap) =>
    writer
      .delete(docSnap.ref)
      .then(() => docSnap.id)
      .catch((err) => {
        console.error(`[notifications-prune] Failed to delete ${docSnap.id}:`, err);
        return null;
      })
  );
  await writer.close();
  const settled = await Promise.all(queue);
  const successful = settled.filter((id): id is string => id !== null);

  return {
    scanned: snap.docs.length,
    deleted: successful.length,
    deletedIds: successful,
    cutoffIso: cutoff.toISOString()
  };
}
