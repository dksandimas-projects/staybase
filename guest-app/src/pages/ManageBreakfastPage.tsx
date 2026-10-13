// Per BR-04 (Phase 13 — Breakfast Redesign, decision #233,
// 2026-10-13): the guest Manage Breakfast page.
//
// The page is mounted at `/my-booking/breakfast?ref={bookingRef}&token={lookupToken}`
// — the same magic-link auth the existing /my-booking
// lookup page uses (H2). It loads the booking's current
// breakfast state via
// `GET /api/bookings/breakfast/manage?ref=...&token=...`,
// renders a per-date × per-guest meal grid (mirroring the
// BR-03 Step 2 layout), tracks edits locally, and POSTs a
// batched `add / change / remove` payload to
// `POST /api/bookings/breakfast/update`.
//
// The page is the POST-BOOKING edit surface for the
// `breakfastSelections` field — the FIRST post-booking
// edit surface for a non-room field (per the BREAKFAST.md
// spec). The staff-side equivalent lands in BR-05.
//
// Locking + audit semantics:
//   • A date is locked when `now > cutoffForDate(date)`
//     — the page disables the dropdown and renders
//     "Ordering closed".
//   • A served slot is locked forever (the BR-01 served
//     record); the page renders "Served at HH:MM" and a
//     struck-through name. Not editable.
//   • A removed slot shows "Removed on {date}" — also not
//     editable.
//   • The save button is disabled when nothing has changed
//     (`dirty === false`).
//   • A removed paid meal surfaces a "Refund due: ₱X"
//     banner under the date section. After save, the page
//     re-reads the persisted `refunds` array so the permanent
//     panel survives until staff records the actual refund
//     (BR-05 territory).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Loader2,
  Sparkles,
  Utensils,
  Wallet
} from "lucide-react";
import { computeBreakfastCutoffState } from "@spark-inn/shared";
import { formatPrice } from "../utils/format";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";

interface ManagePayload {
  readOnly: boolean;
  booking: {
    id: string;
    bookingRef: string;
    checkIn: string;
    checkOut: string;
    numNights: number;
    numGuests: number;
    numAdults: number;
    numChildren: number;
    totalPrice: number;
    breakfastTotal: number;
    paidAmount: number;
    balance: number;
    status: string;
  };
  breakfastSelections: Record<string, BreakfastSelectionEntry>;
  breakfastServed: Record<string, BreakfastServedEntry>;
  refunds: Array<{ id: string; amount: number; note?: string; breakfastRefundContext?: { slotKey: string; mealName: string; priceSnapshot: number } }>;
  breakfastConfig: PublicBreakfastConfig;
  cutoffStates: CutoffState[];
  servedGraceMinutes: number;
}

interface BreakfastSelectionEntry {
  mealId: string;
  mealName: string;
  price: number;
  addedAt: any;
  addedBy: string;
  lastModifiedAt: any;
  lastModifiedBy: string;
  removedAt: any;
  removedBy: string | null;
  overrideCutoff: boolean;
  overrideReason: string | null;
}

interface BreakfastServedEntry {
  servedAt: any;
  servedBy: string;
  unservedAt: any;
  unservedBy: string | null;
}

interface CutoffState {
  isLocked: boolean;
  minutesUntilCutoff: number;
  cutoffAt: string;
  serviceDate: string;
}

interface PublicBreakfastConfig {
  isEnabled: boolean;
  cutoffTime: string;
  cutoffTimezone: string;
  defaultMealInstructions: string;
  meals: Array<{ id: string; name: string; description: string; price: number; displayOrder: number }>;
}

interface PublicBreakfastMeal {
  id: string;
  name: string;
  description: string;
  price: number;
  displayOrder: number;
}

// The page's view of a "slot" — a (date, guestIndex) pair.
// The slot key is `${date}-${slotId}` (per BR-01's
// `BreakfastSlotKey` shape). We use `guest-N` as the slotId
// (the same convention BR-03 uses for Step 2).
type SlotKey = string;

interface SlotViewState {
  // Mirror of the server's `BreakfastSelectionEntry` for
  // this slot, or `null` if the slot is empty.
  selection: BreakfastSelectionEntry | null;
  // The dirty flag is computed by comparing the current
  // selection against the loaded one. We track it as a
  // `Set<string>` so the parent doesn't re-render on every
  // dropdown change (the dirty derivation lives in
  // `useMemo`).
}

// Per BR-03: enumerate breakfast dates from check-in (incl)
// to check-out (excl) in the hotel timezone. The BR-03
// helper lives in `BookingPage.tsx`; we duplicate the logic
// here (the helper isn't in `@spark-inn/shared` because
// every consumer computes dates independently — the cost of
// a shared import exceeds the savings for a 12-line helper,
// and "N dates for an N-night stay" is the entire spec).
function enumerateBreakfastDates(checkIn: string, checkOut: string): string[] {
  const dates: string[] = [];
  const startMs = Date.parse(`${checkIn}T00:00:00Z`);
  const endMs = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return dates;
  const maxDays = 60;
  for (let ms = startMs, i = 0; ms < endMs && i < maxDays; ms += 86_400_000, i += 1) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

// Format a `YYYY-MM-DD` date as "Oct 14 (Tue)". The
// weekday name follows the spec's example; the output is
// locale-stable via the `+ 'T00:00:00Z'` UTC anchor.
function formatBreakfastDateLabel(date: string): string {
  try {
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return date;
    const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    const day = d.getUTCDate();
    const weekday = d.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" });
    return `${month} ${day} (${weekday})`;
  } catch {
    return date;
  }
}

// Format the cutoff clock-time as "8:00 PM" (the
// `HH:MM` 24h input from the config renders as 12h for
// display). Stable via `Intl.DateTimeFormat` so the
// section doesn't flicker across renders.
function formatCutoffClockLabel(hhmm: string): string {
  const parts = /^(0?[0-9]|1[0-9]|2[0-3]):([0-5][0-9])$/.exec(hhmm);
  if (!parts) return hhmm;
  let hour = Number(parts[1]);
  const minute = parts[2];
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${ampm}`;
}

// Format a Timestamp-from-Firestore (Date | Timestamp | string)
// as "HH:MM" for the served-at tooltip. Defensive against
// every shape the doc can come back as.
function formatServedClock(value: any): string {
  if (!value) return "";
  try {
    const d = value instanceof Date
      ? value
      : typeof value?.toDate === "function"
        ? value.toDate()
        : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch {
    return "";
  }
}

// Format a removed-at timestamp the same way. Returns the
// `date` for the spec's example "Removed on Oct 12".
function formatRemovedDate(value: any): string {
  if (!value) return "";
  try {
    const d = value instanceof Date
      ? value
      : typeof value?.toDate === "function"
        ? value.toDate()
        : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  } catch {
    return "";
  }
}

// The browser's `crypto.randomUUID()` is the canonical UUIDv4
// source (Chrome 92+, Firefox 95+, Safari 15.4+). Falls back
// to a reasonable v4-shape string so older browsers still
// get a valid `clientBatchId`.
function makeClientBatchId(): string {
  const g: any = globalThis as any;
  if (typeof g.crypto?.randomUUID === "function") {
    try {
      return String(g.crypto.randomUUID());
    } catch {
      // fall through
    }
  }
  const part = () =>
    Math.floor(Math.random() * 0xffff_ffff).toString(16).padStart(8, "0");
  const part4 = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  const part4b = (Math.floor(Math.random() * 0x0fff) | 0x4000).toString(16).padStart(4, "0");
  const part4c = (Math.floor(Math.random() * 0x3fff) | 0x8000).toString(16).padStart(4, "0");
  return `${part()}-${part4}-${part4b}-${part4c}-${part()}${part().slice(0, 4)}`;
}

// Compare two `Record<string, BreakfastSelectionEntry>`
// maps slot-by-slot. Returns the diff in three buckets:
//   • `add` — slots present in `next` but absent in `prior`
//   • `change` — slots present in both with differing
//     mealId / price
//   • `remove` — slots present in `prior` with
//     `removedAt === null` but absent in `next`
//
// The "removedAt" field carries the user-side "this slot
// is now removed" semantics: a slot that's in `prior`
// (live) but missing in `next` is treated as a removal.
// The `getValue()` callback normalizes the dirty-bit
// comparison since the loaded entries have Firestore
// timestamps and the locally-mutated entries have `Date`
// (or `null`) values.
function diffSelections(
  prior: Record<string, BreakfastSelectionEntry>,
  next: Record<string, BreakfastSelectionEntry>,
  slotKeys: string[]
): {
  add: Array<{ slotKey: string; mealId: string; mealName: string; price: number }>;
  change: Array<{ slotKey: string; mealId: string; mealName: string; price: number }>;
  remove: Array<{ slotKey: string }>;
} {
  const add: Array<{ slotKey: string; mealId: string; mealName: string; price: number }> = [];
  const change: Array<{ slotKey: string; mealId: string; mealName: string; price: number }> = [];
  const remove: Array<{ slotKey: string }> = [];
  const seen = new Set<string>();
  for (const key of slotKeys) {
    seen.add(key);
    const prev = prior[key];
    const now = next[key];
    if (!now) {
      // Local state cleared the slot — drop it from the
      // edit diff entirely (the page's "remove" semantics
      // are "the user picked 'No meal'" which becomes an
      // `add` op = remove). We only produce a real
      // remove diff when the prior state had an entry
      // with `removedAt === null` (live) and the new
      // state has no entry.
      if (prev && (prev.removedAt === null || prev.removedAt === undefined)) {
        remove.push({ slotKey: key });
      }
      continue;
    }
    if (!prev) {
      add.push({
        slotKey: key,
        mealId: now.mealId,
        mealName: now.mealName,
        price: now.price
      });
      continue;
    }
    const isLive = prev.removedAt === null || prev.removedAt === undefined;
    if (!isLive) {
      // Previous was already removed (by staff / by an
      // earlier save) — treat the new entry as a fresh
      // add.
      add.push({
        slotKey: key,
        mealId: now.mealId,
        mealName: now.mealName,
        price: now.price
      });
      continue;
    }
    if (prev.mealId !== now.mealId || Math.abs(Number(prev.price) - Number(now.price)) > 0.005) {
      change.push({
        slotKey: key,
        mealId: now.mealId,
        mealName: now.mealName,
        price: now.price
      });
    }
  }
  return { add, change, remove };
}

// The page itself. The page reads `ref` + `token` from the
// query string (same magic-link auth as `/my-booking`),
// loads the manage payload, and renders the editing
// surface. A `redirectTo: "/my-booking"` flag is raised
// when the server reports `readOnly: true` so the page
// can navigate back to the lookup view (per open item #6).
export default function ManageBreakfastPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ref = (searchParams.get("ref") || "").trim();
  const token = (searchParams.get("token") || "").trim();

  // -- Page-level state machine --
  //
  // The page has 4 high-level states:
  //   `loading` — initial mount, no data yet
  //   `loaded`  — payload present, form is interactive
  //   `error`   — load failed (bad token / no booking / etc.)
  //   `saving`  — POST in flight (button disabled)
  //
  // `error` is a single field; the page surfaces the
  // message + a "Back to /my-booking" link.
  const [payload, setPayload] = useState<ManagePayload | null>(null);
  const [status, setStatus] = useState<"loading" | "loaded" | "error" | "saving">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCancelledNotice, setIsCancelledNotice] = useState(false);
  const [redirectReason, setRedirectReason] = useState<string | null>(null);

  // -- Form state --
  //
  // We hold the LIVE selections as a slot-keyed map. The
  // map is initialised from `payload.breakfastSelections`
  // in the `useEffect` below; user edits mutate the map
  // locally and never touch the original payload.
  const [edits, setEdits] = useState<Record<SlotKey, BreakfastSelectionEntry | null>>({});

  // -- "Refund due" preview --
  //
  // When the user removes a paid meal, the banner under
  // the affected date shows the local-preview amount.
  // After save, the page reads the persisted `refunds`
  // array instead so the banner survives until staff
  // records the actual refund. We carry both views.
  const [savedSuccessMessage, setSavedSuccessMessage] = useState<string | null>(null);

  // -- Countdown timer --
  //
  // Per spec: the per-date countdown copy must tick live
  // ("Ordering closes in X hours Y minutes"). We bump a
  // `tick` state every 60s so the countdown copy advances
  // without a server round-trip.
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => (t + 1) % 1_000_000);
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // -- Mount: load the manage payload --
  //
  // Mirrors the BookingLookupPage's load pattern (no auth,
  // no snapshot — the ref + token is the credential).
  // On 404 we render the same "Booking not found" surface
  // the lookup page does. On `readOnly: true` we raise a
  // "View only" notice + show the booking summary but
  // disable every editable control.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!ref || !token) {
        setStatus("error");
        setErrorMessage("Missing booking reference or token.");
        return;
      }
      try {
        const response = await fetch(
          `/api/bookings/breakfast/manage?ref=${encodeURIComponent(ref)}&token=${encodeURIComponent(token)}`,
          { method: "GET" }
        );
        const json = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || !json || !json.success) {
          setStatus("error");
          setErrorMessage(
            (json && json.error) || "We couldn't load your booking. Please try again."
          );
          return;
        }
        const data = json.data as ManagePayload;
        setPayload(data);
        const initialEdits: Record<SlotKey, BreakfastSelectionEntry | null> = {};
        for (const key of Object.keys(data.breakfastSelections || {})) {
          initialEdits[key] = data.breakfastSelections[key];
        }
        setEdits(initialEdits);
        setIsCancelledNotice(data.booking.status === "cancelled");
        if (data.readOnly && data.booking.status === "checked-out") {
          setRedirectReason("This booking is checked out. View only.");
        }
        setStatus("loaded");
      } catch (err) {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage("We couldn't reach the server. Please check your connection and try again.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [ref, token]);

  // -- Guest slot enumeration --
  //
  // Same enumeration the BR-03 Step 2 form uses:
  // `numAdults + numChildren` = total guest slots.
  // Each slot is `guest-N` (zero-indexed) so the slot
  // key is `${date}-guest-N`. We label each slot with a
  // human-readable name (`Guest 1 (Adult)`,
  // `Child 1`, etc.).
  const guestSlots = useMemo(() => {
    const slots: Array<{ id: string; label: string }> = [];
    if (!payload) return slots;
    const numAdults = Math.max(0, Number(payload.booking.numAdults) || 0);
    const numChildren = Math.max(0, Number(payload.booking.numChildren) || 0);
    let counter = 0;
    for (let i = 0; i < numAdults; i += 1) {
      slots.push({ id: `guest-${counter}`, label: `Guest ${counter + 1} (Adult)` });
      counter += 1;
    }
    for (let i = 0; i < numChildren; i += 1) {
      slots.push({ id: `guest-${counter}`, label: `Child ${i + 1}` });
      counter += 1;
    }
    // Defensive fallback: if the booking is so legacy that
    // it has no `numAdults` / `numChildren` fields, use
    // `numGuests` as an adult-only count.
    if (slots.length === 0 && Number(payload.booking.numGuests) > 0) {
      for (let i = 0; i < payload.booking.numGuests; i += 1) {
        slots.push({ id: `guest-${i}`, label: `Guest ${i + 1} (Adult)` });
      }
    }
    return slots;
  }, [payload]);

  // -- Breakfast date enumeration --
  const breakfastDates = useMemo(() => {
    if (!payload) return [];
    return enumerateBreakfastDates(payload.booking.checkIn, payload.booking.checkOut);
  }, [payload]);

  // -- The complete slot-key universe (date × guest slot) --
  // The `diffSelections` helper uses this list to walk
  // every slot uniformly.
  const allSlotKeys = useMemo(() => {
    if (!payload) return [];
    const keys: string[] = [];
    for (const date of breakfastDates) {
      for (const slot of guestSlots) {
        keys.push(`${date}-${slot.id}`);
      }
    }
    return keys;
  }, [breakfastDates, guestSlots, payload]);

  // -- Per-date cutoff states (client-side recompute) --
  //
  // The server returns the initial states; we recompute
  // them locally as `now` advances so the countdown copy
  // ticks. The function is the same shared helper the
  // server uses — single source of truth.
  const perDateCutoff = useMemo(() => {
    if (!payload) return new Map<string, CutoffState>();
    const tz = payload.breakfastConfig.cutoffTimezone;
    const hhmm = payload.breakfastConfig.cutoffTime;
    const map = new Map<string, CutoffState>();
    const now = new Date();
    for (const date of breakfastDates) {
      map.set(
        date,
        computeBreakfastCutoffState({
          serviceDate: date,
          now,
          cutoffTime: hhmm,
          timezone: tz
        })
      );
    }
    return map;
  }, [payload, breakfastDates, /* tick implicitly */ Math.floor(Date.now() / 60_000)]);

  // -- Dirty derivation --
  //
  // Compare the live `edits` against the loaded
  // `payload.breakfastSelections`. Any difference marks
  // the page dirty. The diff itself is rebuilt only when
  // `edits` changes (so the Save button can show "X
  // changes" without re-running the diff).
  const diff = useMemo(() => {
    if (!payload) return { add: [], change: [], remove: [], dirty: false };
    const prior = payload.breakfastSelections || {};
    const next: Record<string, BreakfastSelectionEntry> = {};
    for (const key of allSlotKeys) {
      const v = edits[key];
      if (v) next[key] = v;
    }
    const result = diffSelections(prior, next, allSlotKeys);
    const dirty = result.add.length + result.change.length + result.remove.length > 0;
    return { ...result, dirty };
  }, [payload, allSlotKeys, edits]);

  // -- Refund-due banner math --
  //
  // When the user marks a paid meal for removal, the
  // banner under the date section shows "Refund due: ₱X".
  // X = sum of (entry.price) over the slots that are
  // being removed AND that look "paid" (the same
  // predicate the server uses: `price > 0`).
  const refundPreviewByDate = useMemo(() => {
    if (!payload) return new Map<string, number>();
    const map = new Map<string, number>();
    const prior = payload.breakfastSelections || {};
    for (const slotKey of allSlotKeys) {
      const prev = prior[slotKey];
      const next = edits[slotKey];
      if (!prev) continue;
      const wasLive = prev.removedAt === null || prev.removedAt === undefined;
      if (!wasLive) continue;
      const nowRemoved = !next;
      if (!nowRemoved) continue;
      const price = Number(prev.price || 0);
      if (price <= 0) continue;
      const date = slotKey.slice(0, 10);
      map.set(date, (map.get(date) || 0) + price);
    }
    return map;
  }, [payload, allSlotKeys, edits]);

  // -- Persisted refunds total --
  //
  // After save, the page reads the server's `refunds`
  // array (the pending breakfast-refund entries). We
  // sum them per-date so the permanent "Refund due"
  // panel under the date section matches the staff-side
  // pending-refunds counter.
  const refundsByDate = useMemo(() => {
    const map = new Map<string, number>();
    if (!payload) return map;
    for (const r of payload.refunds || []) {
      const key = (r && r.breakfastRefundContext && r.breakfastRefundContext.slotKey) || "";
      const date = key.slice(0, 10);
      // Refunds are negative on the wire (per CRL-01).
      // The page displays the absolute value.
      map.set(date, (map.get(date) || 0) + Math.abs(Number(r.amount || 0)));
    }
    return map;
  }, [payload]);

  // -- Handlers --
  const handleSelectMeal = useCallback(
    (slotKey: string, mealId: string | null) => {
      // Skip any edit on a locked slot (server-side
      // cutoff / served / removed). The dropdown is
      // `disabled` but the keydown handler can still
      // fire — belt-and-suspenders.
      const date = slotKey.slice(0, 10);
      const cutoff = perDateCutoff.get(date);
      if (cutoff && cutoff.isLocked) return;
      if (!payload) return;
      const served = payload.breakfastServed && payload.breakfastServed[slotKey];
      if (served) return;
      const prior = (payload.breakfastSelections && payload.breakfastSelections[slotKey]) || null;
      if (prior && prior.removedAt !== null && prior.removedAt !== undefined) return;

      setEdits((current) => {
        const next = { ...current };
        if (mealId === null) {
          next[slotKey] = null;
        } else {
          const meal = payload.breakfastConfig.meals.find((m) => m.id === mealId);
          if (!meal) return current;
          next[slotKey] = {
            mealId: meal.id,
            mealName: meal.name,
            price: meal.price,
            addedAt: new Date(),
            addedBy: "guest",
            lastModifiedAt: new Date(),
            lastModifiedBy: "guest",
            removedAt: null,
            removedBy: null,
            overrideCutoff: false,
            overrideReason: null
          };
        }
        return next;
      });
    },
    [payload, perDateCutoff]
  );

  const handleSave = useCallback(async () => {
    if (!payload || !diff.dirty) return;
    setStatus("saving");
    setErrorMessage(null);
    setSavedSuccessMessage(null);
    const clientBatchId = makeClientBatchId();
    // Read the Turnstile token lazily — the page is not
    // mounted inside a protected route, so we grab the
    // canonical widget's token. If the widget is not
    // present (test environment), the server accepts the
    // request anyway.
    const turnstileEl =
      typeof document !== "undefined"
        ? (document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null)
        : null;
    const turnstileToken = (turnstileEl && turnstileEl.value) || "";
    try {
      const response = await fetch("/api/bookings/breakfast/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingRef: ref,
          token,
          clientBatchId,
          turnstileToken,
          add: diff.add,
          change: diff.change,
          remove: diff.remove
        })
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json || !json.success) {
        const message =
          (json && json.error) ||
          "We couldn't save your changes. Please try again in a moment.";
        setStatus("loaded");
        setErrorMessage(message);
        return;
      }
      // Reload the page payload so the persisted
      // `breakfastSelections` + `refunds[]` reflect
      // the server's post-save state. We also clear
      // the local edits map (the form rebinds to the
      // new loaded selections).
      const reloadResponse = await fetch(
        `/api/bookings/breakfast/manage?ref=${encodeURIComponent(ref)}&token=${encodeURIComponent(token)}`,
        { method: "GET" }
      );
      const reloadJson = await reloadResponse.json().catch(() => null);
      if (reloadResponse.ok && reloadJson && reloadJson.success) {
        const fresh = reloadJson.data as ManagePayload;
        setPayload(fresh);
        const next: Record<SlotKey, BreakfastSelectionEntry | null> = {};
        for (const key of Object.keys(fresh.breakfastSelections || {})) {
          next[key] = fresh.breakfastSelections[key];
        }
        setEdits(next);
        setSavedSuccessMessage("Breakfast updated.");
      }
      setStatus("loaded");
    } catch (err) {
      setStatus("loaded");
      setErrorMessage("We couldn't reach the server. Please check your connection and try again.");
    }
  }, [diff, payload, ref, token]);

  // -- Refund-due banner copy --
  //
  // The banner says "Refund due: ₱X — recorded by staff
  // after cutoff" when the user removes a paid meal.
  // After save, the banner migrates to the persisted
  // `refunds[]` lookup so it survives until staff records
  // the actual refund.
  function renderDateRefundCopy(date: string): { message: string; isPreview: boolean } | null {
    const preview = refundPreviewByDate.get(date) || 0;
    const persisted = refundsByDate.get(date) || 0;
    if (preview > 0 && persisted === 0) {
      return {
        message: `Refund due: ${formatPrice(preview)} — recorded by staff after cutoff.`,
        isPreview: true
      };
    }
    if (persisted > 0) {
      return {
        message: `Refund due: ${formatPrice(persisted)} — pending staff processing.`,
        isPreview: false
      };
    }
    return null;
  }

  // -- Early-render states --
  if (status === "loading") {
    return (
      <main className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="mx-auto max-w-3xl px-4 py-16 text-center text-gray-600">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" aria-hidden="true" />
          <p className="mt-3 text-sm">Loading your breakfast selections…</p>
        </div>
        <Footer />
      </main>
    );
  }

  if (status === "error") {
    return (
      <main className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="mx-auto max-w-3xl px-4 py-16">
          <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm text-center">
            <AlertTriangle className="mx-auto h-10 w-10 text-amber-500" aria-hidden="true" />
            <h1 className="mt-4 text-xl font-bold text-gray-950">We couldn't load your booking</h1>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              {errorMessage || "Booking not found."}
            </p>
            <Link
              to="/my-booking"
              className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-white shadow-sm hover:opacity-90 transition"
            >
              Back to look up
            </Link>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  if (!payload) {
    return null;
  }

  // Cancelled-booking read-only surface
  if (isCancelledNotice) {
    return (
      <main className="min-h-screen bg-gray-50">
        <Navbar />
        <div className="mx-auto max-w-3xl px-4 py-12">
          <button
            type="button"
            onClick={() => navigate("/my-booking")}
            className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
          >
            <ArrowLeft size={16} />
            Back to my booking
          </button>
          <h1 className="mt-6 font-heading text-3xl text-gray-950">Manage Breakfast</h1>
          <p className="mt-1 text-sm text-gray-500 font-mono">
            {payload.booking.bookingRef}
          </p>
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-semibold">This booking is cancelled</p>
            <p className="mt-1 text-xs leading-relaxed">
              Breakfast edits are not available on a cancelled booking.
            </p>
          </div>
        </div>
        <Footer />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50">
      <Navbar />

      {/* Cloudflare Turnstile widget — the page mounts the
          shared site-wide widget so the save POST gets a
          valid token. The widget is invisible (`appearance:
          "interaction-only"` is the site default). */}
      <div
        className="cf-turnstile"
        data-sitekey={import.meta.env.VITE_TURNSTILE_SITE_KEY || ""}
        data-callback="onTurnstileSuccess"
        style={{ display: "none" }}
      />

      <section className="mx-auto max-w-3xl px-4 py-10 sm:py-12">
        <button
          type="button"
          onClick={() => navigate("/my-booking")}
          className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:underline"
        >
          <ArrowLeft size={16} />
          Back to my booking
        </button>

        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Manage Breakfast
            </span>
            <h1 className="mt-1 font-heading text-3xl text-gray-950 sm:text-4xl">
              <Utensils className="inline-block h-7 w-7 mr-2 text-primary" aria-hidden="true" />
              <span className="font-mono">{payload.booking.bookingRef}</span>
            </h1>
            <p className="mt-2 inline-flex items-center gap-2 text-sm text-gray-600">
              <Calendar className="h-4 w-4 text-primary" aria-hidden="true" />
              {formatBreakfastDateLabel(payload.booking.checkIn)} →{" "}
              {formatBreakfastDateLabel(payload.booking.checkOut)} ·{" "}
              {payload.booking.numNights} night
              {payload.booking.numNights === 1 ? "" : "s"} stay
            </p>
          </div>
          <div className="rounded-card-lg border border-primary/20 bg-primary-light px-5 py-3 text-right">
            <p className="text-xs font-semibold uppercase text-primary-dark">Balance</p>
            <p className="font-heading text-2xl font-bold text-primary-dark">
              {formatPrice(payload.booking.balance)}
            </p>
          </div>
        </div>

        {redirectReason && (
          <div className="mt-5 flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
            <div className="text-sm text-gray-700">
              <p className="font-semibold text-gray-900">View only</p>
              <p className="mt-1 text-xs leading-relaxed">{redirectReason}</p>
            </div>
          </div>
        )}

        {/* Default meal instructions. The BR-01
            `defaultMealInstructions` is the staff-set
            copy shown above the grid. */}
        {payload.breakfastConfig.defaultMealInstructions && (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-sm">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="leading-relaxed">{payload.breakfastConfig.defaultMealInstructions}</p>
          </div>
        )}

        {/* Per-date sections */}
        <div className="mt-6 space-y-5">
          {breakfastDates.map((date) => {
            const cutoff = perDateCutoff.get(date);
            const isLocked = Boolean(cutoff && cutoff.isLocked);
            const refundCopy = renderDateRefundCopy(date);
            const hoursLeft =
              cutoff && cutoff.minutesUntilCutoff > 0
                ? Math.floor(cutoff.minutesUntilCutoff / 60)
                : 0;
            const minutesLeft =
              cutoff && cutoff.minutesUntilCutoff > 0
                ? cutoff.minutesUntilCutoff % 60
                : 0;
            const cutoffLabel =
              isLocked || !cutoff
                ? "Ordering closed"
                : cutoff.minutesUntilCutoff > 60 * 24
                  ? `Order by ${formatCutoffClockLabel(payload.breakfastConfig.cutoffTime)} the evening before`
                  : cutoff.minutesUntilCutoff > 0
                    ? `Ordering closes in ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"} ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}`
                    : "Ordering closed";
            return (
              <div
                key={date}
                className={`rounded-xl border bg-white p-5 shadow-sm transition ${
                  isLocked ? "border-gray-200 bg-gray-50 opacity-80" : "border-gray-200"
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-semibold text-gray-950">{formatBreakfastDateLabel(date)}</p>
                    <p
                      className={`mt-1 text-xs ${
                        isLocked ? "text-gray-500" : "text-gray-600"
                      }`}
                    >
                      {cutoffLabel}
                    </p>
                  </div>
                  {isLocked && (
                    <span className="inline-flex items-center gap-1 self-start rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                      <AlertTriangle size={12} aria-hidden="true" /> Locked
                    </span>
                  )}
                </div>

                {refundCopy && (
                  <div
                    className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                      refundCopy.isPreview
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-primary/30 bg-primary-light text-primary-dark"
                    }`}
                  >
                    <Wallet className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="leading-snug">{refundCopy.message}</span>
                  </div>
                )}

                <ul className="mt-4 space-y-3">
                  {guestSlots.map((slot) => {
                    const slotKey = `${date}-${slot.id}`;
                    const served = payload.breakfastServed && payload.breakfastServed[slotKey];
                    const prior = (payload.breakfastSelections && payload.breakfastSelections[slotKey]) || null;
                    const current = Object.prototype.hasOwnProperty.call(edits, slotKey)
                      ? edits[slotKey]
                      : prior;
                    const isRemoved = prior && prior.removedAt !== null && prior.removedAt !== undefined;
                    const isLockedForSlot = isLocked || Boolean(served) || Boolean(isRemoved);
                    return (
                      <li
                        key={slotKey}
                        className="grid grid-cols-1 gap-2 sm:grid-cols-[12rem_1fr_auto] sm:items-center"
                      >
                        <p className="text-sm font-semibold text-gray-700">{slot.label}</p>
                        <div>
                          <select
                            aria-label={`Meal for ${slot.label} on ${formatBreakfastDateLabel(date)}`}
                            disabled={isLockedForSlot}
                            value={current ? current.mealId : ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              handleSelectMeal(slotKey, v ? v : null);
                            }}
                            className="min-h-11 w-full rounded-lg border border-gray-200 bg-white px-3 text-gray-950 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            <option value="">No meal — skip</option>
                            {payload.breakfastConfig.meals.map((meal) => (
                              <option key={meal.id} value={meal.id}>
                                {meal.name} — {formatPrice(meal.price)}
                              </option>
                            ))}
                          </select>
                          {current && (
                            <p className="mt-1 text-xs text-gray-500">
                              {current.mealName} · {formatPrice(current.price)}
                            </p>
                          )}
                          {served && (
                            <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                              <CheckCircle2 size={12} aria-hidden="true" /> Served at{" "}
                              {formatServedClock(served.servedAt)}
                            </p>
                          )}
                          {isRemoved && !served && (
                            <p className="mt-1 text-xs text-gray-500">
                              Removed on {formatRemovedDate(prior?.removedAt)} by {prior?.removedBy || "staff"}
                            </p>
                          )}
                        </div>
                        <div className="hidden sm:block" />
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Sticky save footer */}
        <div className="sticky bottom-0 left-0 right-0 z-10 mt-8 border-t border-gray-200 bg-white/95 px-4 py-4 shadow-md backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:mt-10">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-gray-500">
              {savedSuccessMessage ? (
                <span className="inline-flex items-center gap-1 font-semibold text-green-700">
                  <CheckCircle2 size={14} aria-hidden="true" /> {savedSuccessMessage}
                </span>
              ) : diff.dirty ? (
                <>
                  {diff.add.length + diff.change.length + diff.remove.length} change
                  {diff.add.length + diff.change.length + diff.remove.length === 1 ? "" : "s"} pending.
                </>
              ) : (
                "No changes yet."
              )}
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!diff.dirty || status === "saving"}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "saving" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Saving…
                </>
              ) : (
                "Save changes"
              )}
            </button>
          </div>
          {errorMessage && (
            <div className="mx-auto mt-2 max-w-3xl rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
              {errorMessage}
            </div>
          )}
        </div>
      </section>
      <Footer />
    </main>
  );
}
