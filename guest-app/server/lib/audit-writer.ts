// ATR-02 (2026-11-21, `plan/features/AUDIT-TRAIL.md`): the SERVER-SIDE
// audit writer.
//
// WHY THIS FILE EXISTS
// --------------------
// The ATR-01 contract (`shared/schemas/audit.ts`) defines ONE row shape
// and ONE closed action vocabulary. Until ATR-02, only the admin APP
// wrote rows — and a client-written row is ADVISORY, not forensic
// (finding 2): anyone with staff credentials and a browser console can
// make a mutation and simply not write the row.
//
// So the writer has to live on the SERVER, where the actor comes from
// the VERIFIED TOKEN and the row is written by the Admin SDK — which
// bypasses Firestore rules, so the row cannot be skipped, forged, or
// pointed at another staff member.
//
// WHY THE ROW COMMITS WITH THE MUTATION
// --------------------------------------
// Where the handler already runs a `runTransaction`, the row is
// STAGED INSIDE IT. A booking that changes without its row (or a row
// without its change) is exactly the drift the trail exists to
// prevent.
//
// The entry is BUILT inside the transaction body — AFTER every
// `transaction.get()`, because `before` / `after` must carry the REAL
// pre-mutation values, and because Firestore requires all reads before
// all writes (FOL-03). It is built through `buildServerAuditEntry`,
// which NEVER throws: a malformed row is a programming error, it is
// logged, and the mutation proceeds without a row rather than failing
// the check-in.
//
// THE NEVER-ROLL-BACK RULE
// ------------------------
// A failed audit write must never undo the staff member's actual work
// (GOTCHAS §Security & PII). That rule is why the entry is built in a
// try/catch that returns `null` on failure: the desk's work is never
// blocked by the audit trail.
//
// A commit-time failure (network / quota) still fails the whole
// transaction — and that is the correct trade: the booking and its
// record should agree, and a half-committed check-in is worse than a
// retry.

import { Timestamp, type Transaction } from "firebase-admin/firestore";
import {
  buildAuditEntry,
  type AuditAction,
  type AuditLogEntry
} from "@spark-inn/shared";
import { adminDb } from "./firebase-admin";
import { resolveStaffDisplayName } from "./staffNames";

/** The acting staff member — derived from the VERIFIED token. */
export interface ServerAuditActor {
  /** The staff member's Firebase Auth UID (the token's `uid`). */
  uid: string;
  /** The staff member's display name, resolved from `guests/{uid}`. */
  name: string;
  /** The staff member's role, from the token's `role` claim. */
  role: "admin" | "front-desk";
}

/** Everything a server-side audit row needs. */
export interface ServerAuditWrite {
  actor: ServerAuditActor;
  /** MUST be inside the closed vocabulary (`AUDIT_ACTIONS`). */
  action: AuditAction;
  /** The audited document's id (the booking id). */
  targetId: string;
  /** The audited collection — always `"bookings"` for ATR-02. */
  targetCollection?: "bookings";
  /** A human label for the audited document. */
  targetLabel?: string | null;
  /** The changed values BEFORE the mutation. */
  before?: Record<string, unknown> | null;
  /** The changed values AFTER the mutation. */
  after?: Record<string, unknown> | null;
  /**
   * The changed field NAMES.
   *
   * Omit it to have the diff computed from `before` / `after`. Pass it
   * explicitly for a field whose VALUE must not be copied into the row
   * (free-text fields like `specialRequests` / `notes`): the name is
   * recorded, the value is not.
   */
  changedFields?: string[];
  /** The staff member's free-text reason, when the surface collects one. */
  reason?: string | null;
  /**
   * The moment the mutation happened.
   *
   * Pass the SAME `now` the mutation stamps on the booking, so the row
   * and the change agree to the millisecond.
   */
  timestamp: Date | Timestamp;
}

/**
 * Build the audit row — validated, redacted, and safe to stage.
 *
 * Returns `null` when the row is invalid (an action outside the
 * closed vocabulary, a malformed shape). It NEVER throws: a bad row is
 * a programming error, and a programming error must not fail the
 * staff member's check-in.
 *
 * The returned row carries NO `timestamp` field beyond the one passed
 * in — the row's clock is the mutation's clock.
 */
export function buildServerAuditEntry(
  write: ServerAuditWrite
): AuditLogEntry | null {
  try {
    return buildAuditEntry({
      action: write.action,
      targetCollection: write.targetCollection || "bookings",
      targetId: write.targetId,
      targetLabel: write.targetLabel ?? undefined,
      changedFields: write.changedFields,
      before: write.before ?? null,
      after: write.after ?? null,
      actor: write.actor.uid,
      actorName: write.actor.name,
      actorRole: write.actor.role,
      source: "server",
      reason: write.reason ?? null,
      timestamp:
        write.timestamp instanceof Timestamp
          ? write.timestamp
          : Timestamp.fromDate(write.timestamp)
    });
  } catch (error: any) {
    // A row that cannot be built is a BUG in the call site (an action
    // outside the vocabulary, a shape the schema rejects). Log it and
    // let the mutation proceed — the desk's work is never blocked by
    // the audit trail.
    console.error(
      `[audit] could not build a "${write.action}" audit row for ${write.targetId}:`,
      error?.message || error
    );
    return null;
  }
}

/**
 * Stage an audit row INSIDE a transaction, so it commits atomically
 * with the mutation.
 *
 * Must be called AFTER every `transaction.get()` in the transaction
 * body — Firestore requires all reads before all writes (FOL-03).
 */
export function stageServerAuditRow(
  transaction: Transaction,
  entry: AuditLogEntry
): void {
  transaction.set(adminDb.collection("auditLogs").doc(), entry);
}

/**
 * Write an audit row OUTSIDE a transaction (for a handler that has no
 * transaction of its own).
 *
 * Never throws: a failed row is logged and swallowed, and the
 * mutation's own result is unaffected.
 */
export async function writeServerAuditRow(
  entry: AuditLogEntry | null
): Promise<void> {
  if (!entry) return;
  try {
    await adminDb.collection("auditLogs").add(entry);
  } catch (error: any) {
    console.error(
      `[audit] could not write the "${entry.action}" audit row:`,
      error?.message || error
    );
  }
}

/**
 * The acting staff member, from the request's verified staff identity.
 *
 * `req.staff` is populated by `authenticateStaff` from the VERIFIED
 * token — never from the request body — so `uid` and `role` are
 * trustworthy. The display NAME is resolved separately (the token does
 * not carry it); pass it in from the handler's existing resolution so
 * a handler does not pay for a second lookup.
 */
export function serverAuditActor(
  staff: { uid?: string; email?: string; role?: string } | undefined | null,
  displayName: string
): ServerAuditActor {
  return {
    uid: staff?.uid || "staff",
    name: displayName || staff?.email || "",
    role: staff?.role === "admin" ? "admin" : "front-desk"
  };
}

/**
 * Resolve the acting staff member for an audit row in ONE call.
 *
 * The uid + role come from the verified token; the display name from
 * `guests/{uid}` (the same document the admin app's shared resolver
 * reads — one resolver, so the surfaces cannot drift).
 *
 * Call this BEFORE the handler's transaction: the name lookup is a
 * READ, and a Firestore transaction rejects a read after a write
 * (FOL-03).
 */
export async function resolveServerAuditActor(
  staff: { uid?: string; email?: string; role?: string } | undefined | null
): Promise<ServerAuditActor> {
  return serverAuditActor(staff, await resolveStaffDisplayName(staff?.uid));
}
