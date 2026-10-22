// Per BR-07 (Phase 13 — Breakfast Redesign, decision
// #236, 2026-10-13): the kitchen prep endpoint that
// powers the admin `/admin/kitchen-list` page.
//
//   GET  /api/bookings/breakfast/kitchen-list?date=YYYY-MM-DD
//   POST /api/bookings/breakfast/kitchen-list/acknowledge
//
// The GET handler reads two streams:
//
//   1. `finalized` — every `bookings/{id}/breakfastSelections[date-*]`
//      entry whose entry is NOT cancelled (`removedAt == null`).
//      This is the "Finalized at 8 PM" snapshot — the count
//      that locks at `cutoffForDate(date)`. Per spec §Decisions
//      Locked #5 the server recomputes this view live from
//      `breakfastSelections` so any post-cutoff change is
//      reflected in the "Late changes" column, NOT in this
//      count.
//
//   2. `lateChanges` — every `bookings/{id}/breakfastAudit/{autoId}`
//      entry where `slotKey.startsWith("YYYY-MM-DD-")` AND
//      `occurredAfterCutoff === true`. The `BR-04`/`BR-05`/`BR-06`
//      write paths stamp this flag at the write boundary —
//      no client-side flag means we don't trust the kitchen
//      list view to derive the late-vs-finalized split.
//
// The POST handler acknowledges a single audit doc by
// stamping `acknowledgedAt` + `acknowledgedBy` IN PLACE
// (no new entry — the spec said "same doc, not a new
// entry"). The page optimistically greys out the row
// after the click.
//
// Both routes are STAFF-Token gated (`admin` +
// `front-desk` roles) and rate-limited per IP. The
// GET is rate-limited at 30/min — the page is opened
// 4×/shift at most, but the auto-refresh interval
// keeps the IP quote generous. The acknowledge POST
// is rate-limited at 120/min — a single shift can
// acknowledge 60+ entries during the breakfast
// service window.
//
// The simple in-memory cache (Map + TTL) sits inside
// the handler module so it doesn't need a Redis hop.
// The 30s TTL is short enough to surface a fresh
// "Late changes" entry within the same shift. The
// cache key is the `date` only — `viewMode`
// (`today` / `tomorrow`) is purely a client-side tab
// toggle, the data shape is identical.
//
// ---------------------------------------------------------------------------
// BR-07 P0/P1/P2 fixes (2026-10-22)
// ---------------------------------------------------------------------------
//
// P0 — the sheet was permanently empty. The handler filtered
// on `where("hasAnyBreakfast", "==", true)`; the walk-in write
// path never wrote that flag, so the query matched nothing and
// every service date showed zero meals. The flag is now NOT
// read at all — the authoritative signal is a non-empty
// `breakfastSelections` map, filtered in memory.
//
// P1 — the slot keys. Three key forms exist in the wild (the
// canonical 0-based `<date>-guest-<n>`, the legacy bare
// `<date>-N`, and the legacy 1-based `<date>-guest-<n>` the
// pre-fix admin app wrote). Every slot is now resolved through
// the shared normaliser in `@spark-inn/shared`
// (`normalizeBreakfastSelections`), so a meal is attributed to
// the right guest row and the same guest is never counted
// twice.
//
// P2 — the cut-off. The handler hard-coded the DEFAULT cut-off
// time / timezone while the guest view and the staff view read
// the CONFIGURED ones. It now reads the same
// `settings/breakfastConfig` doc they do.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { z } from "zod";
import { Timestamp } from "firebase-admin/firestore";
import {
  computeBreakfastCutoffState,
  normalizeBreakfastSelections,
  resolveBreakfastSlotGuestIndex,
  type BreakfastSlotIndexBase,
  DEFAULT_BREAKFAST_CUTOFF_TIME,
  DEFAULT_BREAKFAST_CUTOFF_TIMEZONE
} from "@spark-inn/shared";
import { adminDb } from "../lib/firebase-admin";

// ---------- Wire schemas ----------

const dateStringSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be a YYYY-MM-DD calendar date.");

function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearStr, monthStr, dayStr] = value.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return false;
  if (month < 1 || month > 12) return false;
  // `new Date(year, monthIndex, day)` rolls invalid
  // day-of-month values (e.g. Feb 30) into the next
  // month, so compare the round-trip to the input.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

const acknowledgeBodySchema = z
  .object({
    bookingId: z.string().trim().min(8).max(80),
    // Firestore auto-id — a 20-char string is the typical
    // floor, but we accept the wider auto-id alphabet
    // to be future-proof.
    auditId: z.string().trim().min(8).max(80)
  })
  .passthrough();

// ---------- Cache (Map + TTL) ----------

interface CacheEntry {
  value: KitchenListResponse;
  cachedAt: number;
}

const CACHE_TTL_MS = 30_000;
// Bound the cache so a permabored shift (1000+ dates)
// doesn't leak memory. The last 64 dates is plenty —
// the kitchen only ever opens the page for "today"
// or "tomorrow" plus a small handful of future dates.
const CACHE_MAX_ENTRIES = 64;

const responseCache = new Map<string, CacheEntry>();

function cacheGet(date: string): KitchenListResponse | null {
  const entry = responseCache.get(date);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    responseCache.delete(date);
    return null;
  }
  // Hit — refresh insertion order so the FIFO survives
  // long idle sessions.
  responseCache.delete(date);
  responseCache.set(date, entry);
  return entry.value;
}

function cacheSet(date: string, value: KitchenListResponse): void {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(date, { value, cachedAt: Date.now() });
}

// Exported for the BR-07 source-text tripwire test — the
// page must reset the cache when a write lands. The
// acknowledge handler lives in the same module, so the
// simplest invalidation is "drop every cache entry for
// the audit doc's date". The audit's `slotKey` prefix
// is the natural key.
export function invalidateKitchenListCacheForSlotKey(slotKey: string): void {
  if (typeof slotKey !== "string" || slotKey.length < 10) return;
  const datePrefix = slotKey.slice(0, 10);
  // Drop the matching date (if any) — the `today` view
  // for the same date shares the cache entry with the
  // `tomorrow` view, so a single invalidate clears
  // both.
  if (responseCache.delete(datePrefix)) {
    // Re-checking other dates is overkill — the kitchen
    // never edits a past date's audit entry, and the
    // 30s TTL handles staleness if they do.
  }
}

// ---------- Response shape ----------

export interface KitchenListFinalizedEntry {
  bookingId: string;
  ref: string;
  roomNumber: string;
  guestName: string;
  guestIndex: number;
  slotKey: string;
  mealName: string;
  mealId: string;
  price: number;
  lastModifiedAt: string;
}

export interface KitchenListLateChangeEntry {
  auditId: string;
  bookingId: string;
  ref: string;
  roomNumber: string;
  guestName: string;
  guestIndex: number;
  action: string;
  mealSnapshot: { mealId: string; mealName: string; price: number } | null;
  slotKey: string;
  occurredAt: string;
  occurredAfterCutoff: boolean;
  reason: string | null;
  actorRole: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface KitchenListSummary {
  totalMeals: number;
  byMeal: Record<string, number>;
}

export interface KitchenListResponse {
  success: true;
  date: string;
  cutoffAt: string;
  cutoffPassed: boolean;
  finalized: KitchenListFinalizedEntry[];
  lateChanges: KitchenListLateChangeEntry[];
  summary: KitchenListSummary;
}

const STAFF_ROLES = ["admin", "front-desk"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

function readStaff(req: VercelRequest): { uid: string; role: StaffRole } | null {
  const anyReq = req as any;
  const staff = anyReq.staff;
  if (!staff || !staff.uid) return null;
  const role = String(staff.role || "");
  if (role !== "admin" && role !== "front-desk") return null;
  return { uid: String(staff.uid), role };
}

// `extractGuestNameFromSlotKey` resolves the slot's guest
// index to a display name from the booking's `guests[]`
// array.
//
// The index is NOT re-derived from the key string here — the
// caller passes the ALREADY-RESOLVED 0-based index that
// `normalizeBreakfastSelections` produced. That matters
// because three key forms exist in the wild (canonical
// `guest-0`, the legacy bare `-0`, and the legacy 1-based
// `guest-1`) and only the shared normaliser knows which
// index each one denotes.
//
// Slots indexed past the array length OR with a non-numeric
// tail fall back to the first guest (`guests[0]?.name` or
// the booking's top-level `guestName`) so the kitchen list
// always shows a caller label.
function extractGuestNameFromSlotKey(
  booking: any,
  guestIndex: number
): { guestIndex: number; guestName: string } {
  const guests = Array.isArray(booking?.guests) ? booking.guests : [];
  const slotGuest = guests[guestIndex];
  if (slotGuest && typeof slotGuest === "object") {
    const first = typeof slotGuest.firstName === "string" ? slotGuest.firstName : "";
    const last = typeof slotGuest.lastName === "string" ? slotGuest.lastName : "";
    const combined = `${first} ${last}`.trim();
    if (combined.length > 0) return { guestIndex, guestName: combined };
    if (typeof slotGuest.name === "string" && slotGuest.name.trim().length > 0) {
      return { guestIndex, guestName: slotGuest.name.trim() };
    }
  }
  // Fallback: first guest, then the booking's top-level
  // `guestName` denormalization.
  const firstGuest = guests[0];
  if (firstGuest && typeof firstGuest === "object") {
    const first = typeof firstGuest.firstName === "string" ? firstGuest.firstName : "";
    const last = typeof firstGuest.lastName === "string" ? firstGuest.lastName : "";
    const combined = `${first} ${last}`.trim();
    if (combined.length > 0) return { guestIndex: 0, guestName: combined };
    if (typeof firstGuest.name === "string" && firstGuest.name.trim().length > 0) {
      return { guestIndex: 0, guestName: firstGuest.name.trim() };
    }
  }
  if (typeof booking?.guestName === "string" && booking.guestName.trim().length > 0) {
    return { guestIndex, guestName: booking.guestName.trim() };
  }
  return { guestIndex, guestName: "Guest" };
}

function bookingRoomNumber(booking: any): string {
  // The BR-06 refund flow + the BR-04 manage page both
  // read `booking.roomNumber` as the canonical field.
  // Multi-room reservations expand to multiple bookings
  // (per the BAR data-model), so this one always
  // resolves to the single room for the booking.
  const direct = booking?.roomNumber;
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  if (typeof direct === "number" && Number.isFinite(direct)) return String(direct);
  // Legacy fallback — some pre-BAR bookings may still
  // carry `rooms[0].number`. Treat defensively.
  const rooms = booking?.rooms;
  if (Array.isArray(rooms) && rooms.length > 0) {
    const candidate = rooms[0]?.number;
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate.trim();
    if (typeof candidate === "number" && Number.isFinite(candidate)) return String(candidate);
  }
  return "—";
}

function bookingRef(booking: any): string {
  const ref = booking?.ref ?? booking?.reference ?? booking?.bookingRef;
  if (typeof ref === "string" && ref.length > 0) return ref;
  return "—";
}

function slotKeyDatePrefixMatches(slotKey: unknown, datePrefix: string): boolean {
  return typeof slotKey === "string" && slotKey.startsWith(`${datePrefix}-`);
}

function toIsoString(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value && typeof value === "object" && "_seconds" in (value as any)) {
    const seconds = Number((value as any)._seconds);
    if (Number.isFinite(seconds)) return new Date(seconds * 1000).toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  // Fallback — the audit entry was malformed. Empty
  // string keeps the response well-typed; the page
  // renders an em-dash for missing timestamps.
  return "";
}

interface ProjectionBooking {
  id: string;
  ref: string;
  roomNumber: string;
  guestName: string;
  guests: any[];
  /** The booking's guest count — used to detect the legacy 1-based slot space. */
  numGuests?: number;
  breakfastSelections?: Record<string, any> | null;
}

/**
 * Compute the kitchen list response for one date.
 * Pulled out as an internal helper so the rate-limit /
 * auth wrappers + the cache can share the same body.
 */
async function computeKitchenList(date: string): Promise<KitchenListResponse> {
  const datePrefix = date; // "YYYY-MM-DD"
  // Per BR-10 (2026-10-14, decision #244 reserved —
  // Phase 14): read the live `cutoffsEnabled` toggle so
  // the kitchen list honors the admin-side flip. When
  // `cutoffsEnabled === false`, every date appears
  // "still open" in the response — the finalised /
  // late-change split collapses because there is no
  // cut-off moment to be late against.
  //
  // Per BR-07-P2 (2026-10-22): the CONFIGURED cut-off time
  // + timezone are read from the same settings doc. The
  // pre-fix code hard-coded `DEFAULT_BREAKFAST_CUTOFF_TIME`
  // / `DEFAULT_BREAKFAST_CUTOFF_TIMEZONE`, so when the hotel
  // changed the cut-off in Settings the guest view
  // (`breakfast-manage.ts`) and the staff view
  // (`breakfast-mark-served.ts`) followed the new value while
  // the kitchen list kept the built-in default. It is now the
  // same single settings read the other two views do.
  const cutoffConfig = await loadKitchenListCutoffConfig();
  const cutoffsEnabled = cutoffConfig.cutoffsEnabled;
  // The cutoff AT for this date is `(date - 1)` at the
  // configured cut-off time in the configured timezone. We
  // piggy-back on `computeBreakfastCutoffState` (in
  // @spark-inn/shared) for the canonical rule.
  const cutoffState = computeBreakfastCutoffStateSafe(
    date,
    cutoffsEnabled,
    cutoffConfig.cutoffTime,
    cutoffConfig.cutoffTimezone
  );
  const cutoffAtIso = cutoffState.cutoffAt.toISOString();
  const cutoffPassed = cutoffState.isLocked;

  // 1. Read the `bookings` collection.
  //
  // Per BR-07-P0 (2026-10-22): the pre-fix code filtered on the
  // `hasAnyBreakfast` field being `true` and treated the result
  // as a "best-effort filter" over the real `breakfastSelections`
  // map. It was NOT best-effort — it was the ONLY gate, and the
  // walk-in write path never wrote the flag, so the query returned
  // zero rows for every booking in production and the chef's sheet
  // was permanently empty.
  //
  // The flag is a DENORMALIZATION and it drifts: Firestore
  // cannot OR two fields in one query, and a `!=` query does
  // NOT match documents where the field is absent (verified
  // against production: `where("hasAnyBreakfast","!=",false)`
  // returns 0 rows for the 49 flag-absent bookings), so
  // there is no cheap server-side query that finds "every
  // booking with a non-empty `breakfastSelections`".
  //
  // The AUTHORITATIVE signal is the map itself, so the
  // handler reads the collection and filters in memory. The
  // collection is small (69 documents as of 2026-10-22) and
  // the admin app already streams the whole collection
  // (`onSnapshot(collection(db, "bookings"))` in
  // `AdminContext.tsx`), so this is not a new access pattern.
  // The response is cached for 30s.
  const bookings: ProjectionBooking[] = [];
  try {
    const snap = await adminDb.collection("bookings").get();
    snap.forEach((doc) => {
      bookings.push({ id: doc.id, ...(doc.data() as any) });
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[breakfast-kitchen-list] booking scan failed:", err?.message || err);
  }

  // 2. Project the finalized entries for this date.
  // Each entry is one per-guest slot — the same shape
  // the Manage Breakfast + Step 2 UI works with.
  //
  // The slot keys are resolved through the shared
  // normaliser (`normalizeBreakfastSelections`), which
  // folds the legacy bare `<date>-N` form and the legacy
  // 1-based `<date>-guest-N` form into the canonical
  // 0-based `<date>-guest-N` space. Without it the kitchen
  // list would attribute a guest's meal to the wrong row
  // and could count the same guest twice.
  const finalized: KitchenListFinalizedEntry[] = [];
  for (const booking of bookings) {
    const selections = booking.breakfastSelections;
    if (!selections || typeof selections !== "object") continue;
    const bookingId = booking.id;
    const roomNumber = bookingRoomNumber(booking);
    const ref = bookingRef(booking);
    const { slots } = normalizeBreakfastSelections(
      selections as Record<string, any>,
      (booking as any).numGuests
    );
    for (const slot of slots.values()) {
      if (slot.serviceDate !== datePrefix) continue;
      const entry = slot.entry;
      if (!entry || typeof entry !== "object") continue;
      // `removedAt` non-null means cancelled before
      // the cut-off (the kitchen list skips cancelled
      // entries — a removal after the cut-off still
      // appears in the "Late changes" column instead).
      //
      // This is the ONLY cancellation gate. A booking whose
      // `hasAnyBreakfast` flag is `false` (the cancel path
      // writes it) but whose slot was never removed still
      // shows up — the flag is not authoritative, the
      // per-slot `removedAt` is.
      if (entry.removedAt !== null && entry.removedAt !== undefined && entry.removedAt !== "") {
        continue;
      }
      const { guestIndex, guestName } = extractGuestNameFromSlotKey(booking, slot.guestIndex);
      finalized.push({
        bookingId,
        ref,
        roomNumber,
        guestName,
        guestIndex,
        slotKey: slot.storedKey,
        mealId: typeof entry.mealId === "string" ? entry.mealId : "",
        mealName: typeof entry.mealName === "string" ? entry.mealName : "Unnamed meal",
        price: Number.isFinite(Number(entry.price)) ? Number(entry.price) : 0,
        lastModifiedAt: toIsoString(entry.lastModifiedAt)
      });
    }
  }

  // 3. Compute the summary (total + byMeal). Sorted
  // by meal name so the "Finalized" column renders in
  // alphabetical meal order — the kitchen re-orders by
  // cook-station anyway, so this is the only stable
  // string the page can promise.
  const byMeal: Record<string, number> = {};
  for (const entry of finalized) {
    const key = entry.mealName || "Unnamed meal";
    byMeal[key] = (byMeal[key] || 0) + 1;
  }
  const summary: KitchenListSummary = {
    totalMeals: finalized.length,
    byMeal
  };

  // 4. Project the late changes via collectionGroup.
  // Firestore collectionGroup queries are server-side
  // index-friendly for audit-style subcollections;
  // the page expects the full filtered stream so the
  // ack flag is right next to the source entry.
  const lateChanges: KitchenListLateChangeEntry[] = [];
  try {
    const auditGroup = adminDb.collectionGroup("breakfastAudit");
    const auditSnap = await auditGroup
      .where("occurredAfterCutoff", "==", true)
      .get();
    // Build a tiny booking lookup so the audit row can
    // surface room number + guest name without a
    // second round-trip per audit entry.
    const bookingById = new Map<string, ProjectionBooking>();
    // Per-booking slot-index base — the audit entry's
    // `slotKey` is resolved through the SAME normaliser the
    // finalized column uses, so a late change on a legacy
    // booking is attributed to the same guest row as the
    // meal it changed.
    const bookingBaseById = new Map<string, BreakfastSlotIndexBase>();
    for (const booking of bookings) {
      bookingById.set(booking.id, booking);
      bookingBaseById.set(
        booking.id,
        normalizeBreakfastSelections(
          (booking.breakfastSelections || {}) as Record<string, any>,
          (booking as any).numGuests
        ).base
      );
    }
    auditSnap.forEach((doc) => {
      const data = doc.data() as any;
      if (!data) return;
      if (!slotKeyDatePrefixMatches(data.slotKey, datePrefix)) return;
      // The audit doc path is `bookings/{id}/breakfastAudit/{auditId}`.
      // `doc.ref.parent.parent` is the booking reference —
      // `parent.parent.id` is the bookingId.
      const bookingRefDoc = doc.ref.parent.parent;
      if (!bookingRefDoc) return;
      const bookingId = bookingRefDoc.id;
      const matchingBooking = bookingById.get(bookingId);
      // The audit may belong to a booking whose
      // `hasAnyBreakfast` was just cleared — still
      // surface it (the kitchen wants to know).
      const roomNumber = matchingBooking
        ? bookingRoomNumber(matchingBooking)
        : "—";
      const ref = matchingBooking ? bookingRef(matchingBooking) : "—";
      const resolvedIndex = resolveBreakfastSlotGuestIndex(
        typeof data.slotKey === "string" ? data.slotKey : "",
        bookingBaseById.get(bookingId) || "zero-based"
      );
      const { guestIndex, guestName } = extractGuestNameFromSlotKey(
        matchingBooking || { guests: [] },
        resolvedIndex === null ? 0 : resolvedIndex
      );
      const mealSnapshot =
        data.mealSnapshot && typeof data.mealSnapshot === "object"
          ? {
              mealId: String(data.mealSnapshot.mealId || ""),
              mealName: String(data.mealSnapshot.mealName || ""),
              price: Number.isFinite(Number(data.mealSnapshot.price))
                ? Number(data.mealSnapshot.price)
                : 0
            }
          : null;
      lateChanges.push({
        auditId: doc.id,
        bookingId,
        ref,
        roomNumber,
        guestName,
        guestIndex,
        action: typeof data.action === "string" ? data.action : "",
        mealSnapshot,
        slotKey: typeof data.slotKey === "string" ? data.slotKey : "",
        occurredAt: toIsoString(data.occurredAt),
        occurredAfterCutoff: data.occurredAfterCutoff === true,
        reason: typeof data.reason === "string" ? data.reason : null,
        actorRole: typeof data.actorRole === "string" ? data.actorRole : "",
        acknowledgedAt:
          data.acknowledgedAt !== null && data.acknowledgedAt !== undefined
            ? toIsoString(data.acknowledgedAt)
            : null,
        acknowledgedBy:
          typeof data.acknowledgedBy === "string" ? data.acknowledgedBy : null
      });
    });
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.error("[breakfast-kitchen-list] audit scan failed:", err?.message || err);
  }

  // 5. Sort the late changes by `occurredAt` desc — the
  // freshest change is on top so the chef reads the
  // latest cook-update first.
  lateChanges.sort((a, b) => {
    if (a.occurredAt < b.occurredAt) return 1;
    if (a.occurredAt > b.occurredAt) return -1;
    return 0;
  });

  return {
    success: true,
    date,
    cutoffAt: cutoffAtIso,
    cutoffPassed,
    finalized,
    lateChanges,
    summary
  };
}

/**
 * Cutoff state without throwing. The shared
 * `computeBreakfastCutoffState` returns the canonical
 * `cutoffAt` ISO; we wrap it so a parse failure on a
 * bogus `date` string yields a present-time fallback
 * (the same posture `breakfast-config` uses).
 */
function computeBreakfastCutoffStateSafe(
  date: string,
  cutoffsEnabled = true,
  cutoffTime: string = DEFAULT_BREAKFAST_CUTOFF_TIME,
  timezone: string = DEFAULT_BREAKFAST_CUTOFF_TIMEZONE
): {
  cutoffAt: Date;
  isLocked: boolean;
} {
  try {
    const state = computeBreakfastCutoffState({
      serviceDate: date,
      now: new Date(),
      // Per BR-07-P2 (2026-10-22): the CONFIGURED cut-off
      // time + timezone, read from `settings/breakfastConfig`
      // — the same source the guest view + the staff view
      // use. The pre-fix code passed the built-in defaults
      // here, so the kitchen list ignored a Settings change.
      //
      // Per BR-10 the `cutoffsEnabled` toggle IS re-read on
      // every uncached request via `loadKitchenListCutoffConfig`
      // so the late-change split honors the admin-side flip
      // immediately.
      cutoffTime,
      timezone,
      cutoffsEnabled
    });
    return {
      cutoffAt: state.cutoffAt instanceof Date ? state.cutoffAt : new Date(state.cutoffAt),
      isLocked: Boolean(state.isLocked)
    };
  } catch {
    return {
      cutoffAt: new Date(),
      isLocked: false
    };
  }
}

// Per BR-10 (2026-10-14, decision #244 reserved —
// Phase 14): fetch the BR-02 cut-off triple
// (`cutoffTime` + `cutoffTimezone`) + the `cutoffsEnabled`
// toggle from the live settings doc. The read is wrapped in
// a try / catch so a transient Firestore outage degrades to
// the conservative posture (cut-offs enforced at the default
// time) rather than silently locking every date open.
//
// Per BR-07-P2 (2026-10-22): the pre-fix loader read ONLY
// `cutoffsEnabled` and the handler hard-coded the default
// cut-off time / timezone. The guest view
// (`breakfast-manage.ts`) and the staff view
// (`breakfast-mark-served.ts`) both read the CONFIGURED
// values, so a Settings change moved the cut-off for the
// guest + the staff but not for the kitchen list. This loader
// is now the same shape as `loadCutoffConfig` in
// `breakfast-mark-served.ts`.
interface KitchenListCutoffConfig {
  cutoffTime: string;
  cutoffTimezone: string;
  cutoffsEnabled: boolean;
}

let cutoffConfigCache: { value: KitchenListCutoffConfig; at: number } | null = null;
const KITCHEN_LIST_CUTOFFS_CACHE_MS = 30_000;
async function loadKitchenListCutoffConfig(): Promise<KitchenListCutoffConfig> {
  const now = Date.now();
  if (
    cutoffConfigCache &&
    now - cutoffConfigCache.at < KITCHEN_LIST_CUTOFFS_CACHE_MS
  ) {
    return cutoffConfigCache.value;
  }
  try {
    const snap = await adminDb
      .collection("settings")
      .doc("breakfastConfig")
      .get();
    const source: any = snap.exists ? snap.data() : null;
    const rawCutoff = String((source && source.cutoffTime) || "").trim();
    const rawZone = String((source && source.cutoffTimezone) || "").trim();
    const value: KitchenListCutoffConfig = {
      // The configured time / timezone are used only when they
      // are well-formed; a malformed settings doc falls back to
      // the built-in defaults (the same posture
      // `breakfast-mark-served.ts` takes).
      cutoffTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(rawCutoff)
        ? rawCutoff
        : DEFAULT_BREAKFAST_CUTOFF_TIME,
      cutoffTimezone: rawZone.length > 0 ? rawZone : DEFAULT_BREAKFAST_CUTOFF_TIMEZONE,
      cutoffsEnabled: source?.cutoffsEnabled !== false
    };
    cutoffConfigCache = { value, at: now };
    return value;
  } catch {
    // Conservative posture on a Firestore blip:
    // assume cut-offs are enforced (the pre-BR-10
    // default). The 30s cache window means the
    // fallback only applies briefly during an
    // outage.
    return {
      cutoffTime: DEFAULT_BREAKFAST_CUTOFF_TIME,
      cutoffTimezone: DEFAULT_BREAKFAST_CUTOFF_TIMEZONE,
      cutoffsEnabled: true
    };
  }
}

// ---------- Handlers ----------

export async function handleGetKitchenList(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = readStaff(req);
  if (!staff) {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Access restricted to staff members."
    });
  }

  // `date` is required + must match `YYYY-MM-DD` AND
  // round-trip through the JS Date parser. The page
  // always sends a value (default = `tomorrow`), so
  // a missing param surfaces 400 to keep the contract
  // honest.
  const dateRaw =
    typeof req.query.date === "string"
      ? req.query.date.trim()
      : Array.isArray(req.query.date) && typeof req.query.date[0] === "string"
      ? req.query.date[0].trim()
      : "";

  if (!dateRaw) {
    return res.status(400).json({
      success: false,
      error: "date is required (YYYY-MM-DD)."
    });
  }

  const dateParse = dateStringSchema.safeParse(dateRaw);
  if (!dateParse.success || !isValidCalendarDate(dateRaw)) {
    return res.status(400).json({
      success: false,
      error: "Invalid date — must match YYYY-MM-DD and be a real calendar date."
    });
  }

  const cacheKey = dateRaw;
  const cached = cacheGet(cacheKey);
  if (cached) {
    // Per the spec, the cache response is fresh for
    // 30s. Surface a `X-Cache: HIT` header so the
    // BR-07 source-text test can prove the second
    // call skips Firestore (the page + the tripwire
    // look for the header).
    res.setHeader("X-Cache", "HIT");
    return res.status(200).json(cached);
  }

  const payload = await computeKitchenList(dateRaw);
  cacheSet(cacheKey, payload);
  res.setHeader("X-Cache", "MISS");
  return res.status(200).json(payload);
}

export async function handleAcknowledgeKitchenListAudit(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ success: false, error: "Method not allowed." });
  }

  const staff = readStaff(req);
  if (!staff) {
    return res.status(403).json({
      success: false,
      error: "Forbidden: Access restricted to staff members."
    });
  }

  const parsed = acknowledgeBodySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: "Invalid acknowledge payload."
    });
  }

  const { bookingId, auditId } = parsed.data;

  const auditRef = adminDb
    .collection("bookings")
    .doc(bookingId)
    .collection("breakfastAudit")
    .doc(auditId);

  const auditSnap = await auditRef.get();
  if (!auditSnap.exists) {
    return res.status(404).json({
      success: false,
      error: "Audit entry not found."
    });
  }

  const acknowledgedAt = Timestamp.now();
  await auditRef.update({
    acknowledgedAt,
    acknowledgedBy: staff.uid,
    // The BR-06 follow-up also stamps
    // `acknowledgedByRole` so the page can show
    // "Acked by Front Desk · Jane" instead of an
    // opaque UID — keeping the field name singular
    // mirrors the `addedBy` / `removedBy` convention
    // on `BreakfastSelectionEntry`.
    acknowledgedByRole: staff.role
  });

  // Invalidate the cached response for the ack's
  // date so the next GET roundtrip reflects the
  // acknowledgement in the `lateChanges[i].acknowledgedAt`.
  const existing = auditSnap.data() || {};
  if (typeof existing.slotKey === "string") {
    invalidateKitchenListCacheForSlotKey(existing.slotKey);
  }

  return res.status(200).json({
    success: true,
    data: {
      auditId,
      bookingId,
      acknowledgedAt: acknowledgedAt.toDate().toISOString(),
      acknowledgedBy: staff.uid,
      acknowledgedByRole: staff.role
    }
  });
}
