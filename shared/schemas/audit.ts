// ATR-01 (2026-11-20, `plan/features/AUDIT-TRAIL.md`): the shared
// Staff Audit Trail contract.
//
// This module is the SINGLE SOURCE OF TRUTH for the audit row shape.
// Both writers (the server's Admin-SDK writer — ATR-02 — and the
// admin app's client writer — ATR-03/ATR-05) import from here, so the
// two can never disagree about which fields exist, which actions are
// legal, or which fields must never carry a value.
//
// WHY A CLOSED VOCABULARY (decision 2 + the `NBS-08` failure mode):
// the vocabulary is closed and Zod-validated, so an unknown action is
// a thrown error / a failed test rather than a silently-dropped row.
// "Reports silently drops unknown sources — no error, no warning" is
// the exact failure class this prevents.
//
// WHY A SHARED REDACTION LIST (decision 2 + finding 4):
// a naive before/after snapshot copies guest personal data into a
// SECOND collection with different retention. A field on the redaction
// list is recorded in `changedFields` BY NAME ONLY — never in
// `before` / `after`. `buildAuditEntry` is the only sanctioned way to
// build a row, and it enforces the list.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Action vocabulary (closed set)
// ---------------------------------------------------------------------------

/**
 * The closed action vocabulary, per `plan/features/AUDIT-TRAIL.md
 * §Action vocabulary`.
 *
 * The order matters for nothing but readability; the SET is what the
 * rules file and the Zod schema both enforce. Keep it in sync with
 * `firebase/firestore.rules §auditLogs` — the rules file repeats the
 * list because Firestore rules cannot import from `shared/`, and the
 * `firestore-rules-coverage` test pins the two against each other.
 */
export const AUDIT_ACTIONS = [
  // bookings.*
  "bookings.create-walkin",
  "bookings.checkin",
  "bookings.checkout",
  "bookings.confirm",
  "bookings.cancel",
  "bookings.reschedule",
  "bookings.room-reassign",
  "bookings.payment-add",
  "bookings.payment-verify",
  "bookings.payment-reject",
  "bookings.refund",
  "bookings.discount-verify",
  "bookings.discount-reject",
  "bookings.update",
  // rooms.*
  "rooms.create",
  "rooms.update",
  "rooms.delete",
  "rooms.status-change",
  "rooms.housekeeping",
  "rooms.block",
  // addons.*
  "addons.create",
  "addons.update",
  "addons.delete",
  // settings / rates / vouchers / staff
  "settings.update",
  "rates.update",
  "vouchers.create",
  "vouchers.update",
  "staff.create",
  "staff.disable",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AuditActionSchema = z.enum(AUDIT_ACTIONS);

/**
 * The collections an audit row may target.
 *
 * `roomPrivate` is in the list because the room BLOCK REASON write
 * targets it (ATR-03) — the block reason is a room-scoped fact that
 * lives on the private collection.
 */
export const AUDIT_TARGET_COLLECTIONS = [
  "bookings",
  "rooms",
  "roomPrivate",
  "addOns",
  "settings",
  "rates",
  "vouchers",
  "guests",
] as const;

export type AuditTargetCollection = (typeof AUDIT_TARGET_COLLECTIONS)[number];

export const AuditTargetCollectionSchema = z.enum(AUDIT_TARGET_COLLECTIONS);

/**
 * Trust level of a row (finding 2 — a client-written row is ADVISORY,
 * not forensic).
 *
 * - `server` — written by the server via the Admin SDK, where the actor
 *   is derived from the verified token. The client cannot forge it.
 * - `client` — written by the admin app directly to Firestore. Staff
 *   credentials + a browser console can skip the row or name someone
 *   else, so a reader must treat it as advisory.
 */
export const AUDIT_SOURCES = ["server", "client"] as const;

export type AuditSource = (typeof AUDIT_SOURCES)[number];

export const AuditSourceSchema = z.enum(AUDIT_SOURCES);

/** The staff role AS IT WAS at write time (roles change). */
export const AUDIT_ACTOR_ROLES = ["admin", "front-desk"] as const;

export type AuditActorRole = (typeof AUDIT_ACTOR_ROLES)[number];

export const AuditActorRoleSchema = z.enum(AUDIT_ACTOR_ROLES);

// ---------------------------------------------------------------------------
// Redaction list
// ---------------------------------------------------------------------------

/**
 * The PII redaction list — the single source of truth, per
 * `plan/features/AUDIT-TRAIL.md §Redaction list`.
 *
 * A field on this list is recorded in `changedFields` BY NAME ONLY and
 * is NEVER copied into `before` / `after`. Rationale:
 * `plan/docs/GOTCHAS.md §Security & PII` (never log PII; never expose
 * payment-proof URLs outside admin) + `plan/docs/SECURITY.md` RA 10173
 * data minimisation.
 *
 * `remarks` is on the list because GOTCHAS already forbids it reaching
 * guest surfaces, and it is free staff prose that may quote a guest.
 *
 * `members/*` personal fields are covered by the `MEMBERS_REDACTED_FIELDS`
 * list below — the `members` collection carries its own personal data
 * (email / phone / full name) under different field names.
 *
 * WHAT IS NOT ON THE LIST — `blockReason`. The room block reason is an
 * OPERATIONAL field (the room-management UI collects it as a
 * maintenance reason) and the spec's row shape names it explicitly as a
 * use for the `reason` column: *"Optional free text where the UI
 * already collects one (room reassignment reason, cancellation reason,
 * block reason)"*. So the block reason travels in `reason` — the
 * deliberate, writer-supplied channel — and NOT in a mechanical
 * before/after snapshot. The list governs snapshots; `reason` is a
 * separate, explicit path.
 *
 * THE `leadGuest*` FAMILY (added by ATR-02, 2026-11-21)
 * ------------------------------------------------------
 * The booking documents carry the guest's identity under
 * `leadGuestName` / `leadGuestEmail` / `leadGuestPhone` (plus a
 * nested `leadGuestDetails` object) — NOT under `guestName` /
 * `guestEmail` / `guestPhone`. The spec's redaction list names the
 * latter, so the list as shipped did not cover the field names the
 * actual documents use.
 *
 * That gap only became exploitable when ATR-02 landed the first
 * writer that copies booking fields into an audit row: a whole-document
 * before/after snapshot would have copied the guest's name, email and
 * phone straight into `auditLogs` — a SECOND copy of the guest's
 * personal data, under a different retention, in a collection the
 * admin can read. The list now covers the real field names, so
 * `buildAuditEntry` drops them whether the caller names them
 * `guestName` or `leadGuestName`.
 */
export const AUDIT_REDACTED_FIELDS = [
  "guestName",
  "guestEmail",
  "guestPhone",
  "guestRegistration",
  "guestIdPhotoUrl",
  "paymentProofUrl",
  "paymentProofPath",
  "discountIdPhotoUrl",
  "discountIdPhotoPath",
  "lookupToken",
  "qrToken",
  "remarks",
  // The booking documents' actual guest-identity field names (the
  // `leadGuest*` family) + the nested per-guest object.
  "leadGuestName",
  "leadGuestEmail",
  "leadGuestPhone",
  "leadGuestDetails",
  "guestDetails",
] as const;

export type AuditRedactedField = (typeof AUDIT_REDACTED_FIELDS)[number];

/**
 * The `members/*` personal fields the redaction list covers by the
 * spec's "any `members/*` personal field" clause. Kept as a SEPARATE
 * list (rather than folded into `AUDIT_REDACTED_FIELDS`) so a reader
 * can see which clause each entry comes from — the spec names the
 * members fields as a category, not as individual names.
 */
export const MEMBERS_REDACTED_FIELDS = [
  "memberEmail",
  "memberPhone",
  "memberFullName",
  "memberIdUrl",
] as const;

/**
 * Is this field name on the redaction list?
 *
 * Matches EXACTLY (so `guestEmailAddress` is NOT redacted — an
 * over-broad match would silently drop legitimate audit values), plus
 * the `members/*` personal fields.
 */
export function isAuditRedactedField(fieldName: string): boolean {
  return (
    (AUDIT_REDACTED_FIELDS as readonly string[]).includes(fieldName) ||
    (MEMBERS_REDACTED_FIELDS as readonly string[]).includes(fieldName)
  );
}

// ---------------------------------------------------------------------------
// The row shape
// ---------------------------------------------------------------------------

/**
 * The `auditLogs/{auditId}` row, per
 * `plan/features/AUDIT-TRAIL.md §Data shape`.
 *
 * The pre-ATR-12 fields (`action`, `targetCollection`, `targetId`,
 * `actor`, `actorName`, `before`, `after`, `timestamp`) are UNCHANGED —
 * the BR-12.1 `addons.*` rows written since OCT-C3 stay readable. The
 * ATR fields are additive.
 *
 * `before` / `after` are `z.record(z.unknown())` rather than
 * `z.object({...})` on purpose: the changed-field set differs per
 * action family, and the REDACTION LIST (not the schema) is what
 * constrains their content.
 */
export const AuditLogEntrySchema = z.object({
  /** `"<domain>.<verb>"` from the closed vocabulary above. */
  action: AuditActionSchema,
  /** The collection the change happened in. */
  targetCollection: AuditTargetCollectionSchema,
  /** The document id that changed. */
  targetId: z.string().min(1).max(160),
  /**
   * Human-readable label so the log renders without N lookups.
   * NEVER contains guest PII (e.g. `"SI-20260601-001"`,
   * `"Room 202 — Executive"`).
   */
  targetLabel: z.string().max(200).optional(),
  /**
   * The names of the fields that changed. This is the ONLY record of
   * a REDACTED field's change — a redacted field appears here BY NAME
   * and never in `before` / `after`.
   */
  changedFields: z.array(z.string().max(120)).max(200),
  /** Non-redacted changed fields only. `null` for a create. */
  before: z.record(z.unknown()).nullable().default(null),
  /** Non-redacted changed fields only. `null` for a delete. */
  after: z.record(z.unknown()).nullable().default(null),
  /** The staff Firebase Auth UID. */
  actor: z.string().min(1).max(160),
  /** The actor's display name AT WRITE TIME (decision 5). */
  actorName: z.string().max(160).default(""),
  /** The actor's role AT WRITE TIME (roles change). */
  actorRole: AuditActorRoleSchema.optional(),
  /** The trust level of the row (finding 2). */
  source: AuditSourceSchema,
  /**
   * Optional free text where the UI already collects one — the room
   * block reason, the room-reassignment reason, the cancellation
   * reason.
   *
   * This is the DELIBERATE channel for operational prose, distinct
   * from the mechanical before/after snapshot. It is not governed by
   * the redaction list (which governs snapshots), so a writer must
   * only put an operational reason here — never guest personal data.
   */
  reason: z.string().max(500).nullable().optional(),
  /** `serverTimestamp()`. */
  timestamp: z.union([z.string(), z.any()]).optional(),
});

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;

/** The shape `buildAuditEntry` returns (before the caller adds the timestamp). */
export type AuditLogEntryInput = Omit<
  AuditLogEntry,
  "changedFields" | "before" | "after" | "timestamp"
> & {
  changedFields?: string[];
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  timestamp?: unknown;
};

// ---------------------------------------------------------------------------
// buildAuditEntry — the pure helper both writers use
// ---------------------------------------------------------------------------

/**
 * Strip every redacted field out of a before/after map.
 *
 * The field NAME is preserved by the caller (in `changedFields`); only
 * the VALUE is dropped here. That is the whole point of the list: the
 * audit trail records THAT a field changed, never what it changed to.
 */
export function redactAuditValues(
  values: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!values) return null;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (isAuditRedactedField(key)) continue;
    safe[key] = value;
  }
  return safe;
}

/**
 * The names of the fields that CHANGED between `before` and `after`.
 *
 * A field counts as changed when it is present in only one of the two
 * maps, or present in both with a DIFFERENT value. A field present in
 * both with the SAME value did not change, so it is not recorded —
 * the log answers "what changed", not "what was written".
 *
 * The comparison is computed from the UNREDACTED maps, so a redacted
 * field still appears here BY NAME. Only its VALUE is dropped, and
 * only at the end of `buildAuditEntry`.
 */
function collectChangedFieldNames(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined
): string[] {
  const names = new Set<string>();
  const beforeKeys = before ? Object.keys(before) : [];
  const afterKeys = after ? Object.keys(after) : [];

  for (const key of beforeKeys) {
    if (!(key in (after ?? {}))) {
      names.add(key);
      continue;
    }
    if (!deepEqual(before![key], after![key])) names.add(key);
  }
  for (const key of afterKeys) {
    if (!(key in (before ?? {}))) names.add(key);
  }
  return Array.from(names);
}

/**
 * A small structural equality check for the values an audit row can
 * carry — primitives, plain objects and arrays. Deliberately simple:
 * an audit row never carries a class instance, and a `JSON`-style
 * comparison is enough to decide "did this field change".
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      key in (b as Record<string, unknown>) &&
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key]
      )
  );
}

/**
 * Build a validated, redacted audit row.
 *
 * This is the ONLY sanctioned way to construct an `auditLogs` row —
 * both writers route through it so the redaction list can never be
 * bypassed by a call site that forgets it.
 *
 * The returned object carries NO `timestamp` unless the caller passes
 * one: the client writer passes `serverTimestamp()` and the server
 * writer passes the transaction's `now`, and each owns its own clock.
 *
 * @throws {z.ZodError} if the action is outside the closed vocabulary
 *   or the row shape is invalid.
 */
export function buildAuditEntry(input: AuditLogEntryInput): AuditLogEntry {
  const before = input.before ?? null;
  const after = input.after ?? null;

  // The changed-field names are computed from the UNREDACTED maps, so
  // a redacted field is still recorded BY NAME — it is only its VALUE
  // that never leaves the record it came from.
  const changedFields =
    input.changedFields ?? collectChangedFieldNames(before, after);

  const entry: AuditLogEntryInput = {
    ...input,
    changedFields,
    before: redactAuditValues(before),
    after: redactAuditValues(after),
  };

  // `timestamp` is intentionally NOT defaulted here — the caller owns
  // the clock (client: `serverTimestamp()`, server: the transaction's
  // `now`).
  const parsed = AuditLogEntrySchema.parse(entry);

  // The Firestore SDK REJECTS an `undefined` field value outright
  // ("Unsupported field value: undefined") unless the app sets
  // `ignoreUndefinedProperties` — which the admin app does NOT. A
  // Zod object parse KEEPS an optional key that was present with an
  // `undefined` value, so an omitted `targetLabel` would otherwise
  // become `targetLabel: undefined` and fail the whole write.
  //
  // Stripping undefined-valued keys here is what makes
  // "the optional fields are genuinely optional" true at the wire
  // level, not just in the type.
  for (const key of Object.keys(parsed) as Array<keyof typeof parsed>) {
    if (parsed[key] === undefined) {
      delete parsed[key];
    }
  }

  return parsed;
}

/**
 * Is this a legal action? A thin wrapper for call sites that want a
 * boolean instead of a thrown error (the rules file mirrors the
 * vocabulary, and a client writer may want to skip an unknown action
 * rather than crash a save).
 */
export function isAuditAction(value: unknown): value is AuditAction {
  return (
    typeof value === "string" &&
    (AUDIT_ACTIONS as readonly string[]).includes(value)
  );
}
