// Per BR-01 (Phase 13 — Breakfast Redesign, decision
// #231, 2026-10-12): the CANONICAL breakfast slot-key
// contract.
//
// A breakfast slot is one (service date × guest slot)
// pair. The booking doc stores it under a composite key:
//
//     `${serviceDate}-guest-${guestIndex}`
//
// where `guestIndex` is **0-based** — the index into the
// booking's `guests[]` array. "Guest 1" is a display
// label (`guestIndex + 1`), never part of the key.
//
// WHY 0-BASED CANONICAL
// ---------------------
// The guest app (`BookingPage.tsx` Step 2 +
// `ManageBreakfastPage.tsx`) has always written
// `guest-0 … guest-{n-1}`. The server's own guest-name
// resolver (`extractGuestNameFromSlotKey` in
// `guest-app/server/handlers/breakfast-kitchen-list.ts`)
// indexes `booking.guests[]` with the trailing number, so
// it is ALREADY a 0-based read. The bare legacy form
// (`<date>-N`, no `guest-` prefix) that lives in
// production is provably 0-based too — a one-guest
// production booking stores `2026-10-21-0`, and a
// two-guest booking stores `-0` and `-1`. So 0-based is
// the base that the guest path, the server path, and the
// bulk of the live data already agree on; only the admin
// app drifted onto a 1-based (`guest-1 … guest-n`)
// space.
//
// LEGACY KEY FORMS
// -----------------
// Three forms exist in the wild:
//
//   1. `<date>-guest-<n>`   — CANONICAL, 0-based.
//   2. `<date>-<n>`         — legacy bare form, 0-based
//                             (production QA walk-ins).
//   3. `<date>-guest-<n>`   — legacy 1-based, written by
//                             the pre-fix admin app.
//
// Forms 1 and 3 are the SAME string shape but a
// DIFFERENT base, so they cannot be told apart from the
// key string alone. `detectBreakfastSlotIndexBase`
// resolves that per booking (a booking whose `guest-n`
// index reaches `numGuests` cannot be a 0-based space,
// because 0-based indices only run `0 … numGuests-1`).
//
// The bare form (2) is ALWAYS 0-based, so it maps onto
// the canonical key with a prefix change and NO index
// shift.
//
// The normaliser is the single place that knows all of
// this. The guest app, the admin app, and the server all
// go through it, so the two apps can never drift apart
// again.

/**
 * The index base of a booking's breakfast slot keys.
 *
 * - `"zero-based"` — the canonical space (`guest-0` is the
 *   first guest). Also the base of the legacy bare form.
 * - `"one-based"` — the legacy admin-app space (`guest-1`
 *   is the first guest). Only detected for bookings that
 *   were written before the admin app was fixed.
 */
export type BreakfastSlotIndexBase = "zero-based" | "one-based";

/** The canonical slot-id token for a 0-based guest index (`guest-0`). */
export function buildBreakfastSlotId(guestIndex: number): string {
  return `guest-${guestIndex}`;
}

/** The canonical slot key for `guestIndex` (0-based) on `serviceDate`. */
export function buildBreakfastSlotKey(serviceDate: string, guestIndex: number): string {
  return `${serviceDate}-${buildBreakfastSlotId(guestIndex)}`;
}

/**
 * The slot key to WRITE for `guestIndex`, honouring the
 * booking's own index base.
 *
 * Writing into the booking's existing space matters: a
 * legacy 1-based booking that received a canonical
 * `guest-0` key would hold two different index spaces at
 * once, and the resolver could not tell them apart.
 */
export function buildBreakfastSlotKeyForBase(
  serviceDate: string,
  guestIndex: number,
  base: BreakfastSlotIndexBase
): string {
  return base === "one-based"
    ? `${serviceDate}-guest-${guestIndex + 1}`
    : buildBreakfastSlotKey(serviceDate, guestIndex);
}

/** Which string form a stored slot key uses. */
export type BreakfastSlotKeyForm = "canonical" | "bare";

export interface ParsedBreakfastSlotKey {
  /** The `yyyy-mm-dd` service date prefix. */
  serviceDate: string;
  /** The numeric token exactly as it appeared in the key. */
  rawIndex: number;
  /** `"canonical"` = `<date>-guest-<n>`, `"bare"` = `<date>-<n>`. */
  form: BreakfastSlotKeyForm;
}

/**
 * Parse a stored slot key into its service date + raw index
 * token. Returns `null` for any key that is not one of the
 * two recognised forms (so an unknown key is left alone
 * rather than silently reinterpreted).
 */
export function parseBreakfastSlotKey(slotKey: string): ParsedBreakfastSlotKey | null {
  if (typeof slotKey !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})-(?:(guest-)?(\d+))$/.exec(slotKey);
  if (!match) return null;
  const rawIndex = Number(match[3]);
  if (!Number.isFinite(rawIndex)) return null;
  return {
    serviceDate: match[1],
    rawIndex,
    form: match[2] ? "canonical" : "bare"
  };
}

/**
 * Detect the slot-index base of a booking's breakfast slot
 * keys.
 *
 * The bare form is always 0-based, so only the canonical
 * (`<date>-guest-<n>`) keys can carry a 1-based space. A
 * booking is 1-based only when every canonical key is
 * 1-based, which is observable as: no canonical key uses
 * index `0`, and the highest canonical index reaches
 * `numGuests` (a 0-based space can never index past
 * `numGuests - 1`).
 *
 * The bare form is ignored by this probe on purpose — it is
 * 0-based by construction and must not influence the
 * canonical space's base.
 */
export function detectBreakfastSlotIndexBase(
  selections: Record<string, unknown> | null | undefined,
  numGuests?: number | null
): BreakfastSlotIndexBase {
  if (!selections || typeof selections !== "object") return "zero-based";
  let highestCanonicalIndex = -1;
  let sawIndexZero = false;
  for (const key of Object.keys(selections)) {
    const parsed = parseBreakfastSlotKey(key);
    if (!parsed || parsed.form !== "canonical") continue;
    if (parsed.rawIndex === 0) sawIndexZero = true;
    if (parsed.rawIndex > highestCanonicalIndex) highestCanonicalIndex = parsed.rawIndex;
  }
  if (sawIndexZero) return "zero-based";
  const total = Number(numGuests);
  if (Number.isFinite(total) && total > 0 && highestCanonicalIndex >= total) {
    return "one-based";
  }
  return "zero-based";
}

/**
 * Resolve a stored slot key to the canonical 0-based guest
 * index.
 *
 * - A bare `<date>-<n>` key is 0-based → index `n`.
 * - A canonical `<date>-guest-<n>` key follows the
 *   booking's base → index `n` (0-based) or `n - 1`
 *   (1-based legacy).
 *
 * Returns `null` when the key is not a recognised form or
 * the index is out of range.
 */
export function resolveBreakfastSlotGuestIndex(
  slotKey: string,
  base: BreakfastSlotIndexBase = "zero-based"
): number | null {
  const parsed = parseBreakfastSlotKey(slotKey);
  if (!parsed) return null;
  const index = parsed.form === "bare" ? parsed.rawIndex : base === "one-based" ? parsed.rawIndex - 1 : parsed.rawIndex;
  if (index < 0) return null;
  return index;
}

/** One resolved breakfast slot. */
export interface NormalizedBreakfastSlot<T = any> {
  /** The canonical 0-based slot key (`${date}-guest-${index}`). */
  canonicalKey: string;
  /** The key exactly as it is stored on the booking doc. */
  storedKey: string;
  /** The 0-based guest index. */
  guestIndex: number;
  /** The service date (`yyyy-mm-dd`). */
  serviceDate: string;
  /** The stored entry payload. */
  entry: T;
}

export interface NormalizedBreakfastSelections<T = any> {
  /** The booking's detected slot-index base. */
  base: BreakfastSlotIndexBase;
  /** Resolved slots keyed by the canonical slot key. */
  slots: Map<string, NormalizedBreakfastSlot<T>>;
}

/**
 * Normalise a booking's `breakfastSelections` map into the
 * canonical slot-key space.
 *
 * Every recognised key form resolves to the SAME slot when it
 * denotes the same guest, so a booking that mixes the legacy
 * bare form with the canonical form cannot be double-counted:
 * the canonical-form entry wins (it is the form every writer
 * uses today) and the bare twin is folded into it.
 */
export function normalizeBreakfastSelections<T = any>(
  selections: Record<string, T> | null | undefined,
  numGuests?: number | null
): NormalizedBreakfastSelections<T> {
  const base = detectBreakfastSlotIndexBase(
    selections as Record<string, unknown> | null | undefined,
    numGuests
  );
  const slots = new Map<string, NormalizedBreakfastSlot<T>>();
  if (!selections || typeof selections !== "object") return { base, slots };

  for (const storedKey of Object.keys(selections)) {
    const parsed = parseBreakfastSlotKey(storedKey);
    if (!parsed) continue;
    const guestIndex = resolveBreakfastSlotGuestIndex(storedKey, base);
    if (guestIndex === null) continue;
    const canonicalKey = buildBreakfastSlotKey(parsed.serviceDate, guestIndex);
    const existing = slots.get(canonicalKey);
    if (existing) {
      // Two key forms denote the same guest. Keep ONE slot so
      // the kitchen never cooks the same meal twice. The
      // canonical form wins over the legacy bare form.
      const existingIsBare = parseBreakfastSlotKey(existing.storedKey)?.form === "bare";
      if (existingIsBare && parsed.form === "canonical") {
        slots.set(canonicalKey, {
          canonicalKey,
          storedKey,
          guestIndex,
          serviceDate: parsed.serviceDate,
          entry: selections[storedKey]
        });
      }
      continue;
    }
    slots.set(canonicalKey, {
      canonicalKey,
      storedKey,
      guestIndex,
      serviceDate: parsed.serviceDate,
      entry: selections[storedKey]
    });
  }

  return { base, slots };
}
