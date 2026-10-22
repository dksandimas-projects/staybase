// Per BR-05 (Phase 13 — Breakfast Redesign, decision
// #234, 2026-10-13): the meal-per-guest grid used in
// the walk-in modal at `BookingsPage.tsx` and the
// calendar-create modal at `CalendarPage.tsx`. Mirrors
// the BR-03 Step 2 grid so the staff sees the same
// shape the public booking-flow captures.
//
// The grid lives in this shared file because (a) both
// admin modals need the same per-date × per-guest
// shape, (b) the per-date cutoff warning + the walk-in
// "tonight vs tomorrow" edge case share one place to
// render, and (c) the rich `breakfastSelections` shape
// is identical across both entry points (server-side
// validation in `lib/breakfast-selections.ts
// validateBreakfastSelections` covers both paths via
// the BR-03 booking-create validator).

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2
} from "lucide-react";
import {
  computeBreakfastCutoffState,
  type PublicBreakfastConfig,
  type PublicBreakfastMeal
} from "@spark-inn/shared";
import { cn } from "../../utils/cn";
// Per P0-ADMIN-API-BASE (2026-10-22): the admin app must call the
// guest app's API through `getApiBaseUrl()`, never a relative `/api`.
import { getApiBaseUrl } from "../../utils/apiBaseUrl";
import {
  BREAKFAST_CATALOG_LOAD_ERROR,
  resolveBreakfastCatalogView,
  type PublicBreakfastConfigResponse
} from "../../utils/breakfastCatalogView";

export interface WalkinBreakfastSelections {
  breakfastSelections: Record<string, {
    mealId: string;
    mealName: string;
    price: number;
    addedAt: string;
    addedBy: string;
    lastModifiedAt: string;
    lastModifiedBy: string;
    removedAt: null;
    removedBy: null;
    overrideCutoff: boolean;
    overrideReason: string | null;
  }>;
  breakfastTotal: number;
  overrideCutoff: boolean;
  overrideReason: string | null;
}

interface WalkinBreakfastGridProps {
  /** Booking check-in (`yyyy-mm-dd`). */
  checkIn: string;
  /** Booking check-out (`yyyy-mm-dd`). */
  checkOut: string;
  /** Total guests for this booking (drives the per-date grid height). */
  numGuests: number;
  /** Staff UID (used as the `addedBy` audit field on every slot). */
  staffUid: string;
  /** Free-text override reason when continuing past the cutoff. */
  overrideReason: string;
  /** Setter for the override reason — the parent binds the
   * input control so the Cancel/Cancel flow can clear it. */
  onOverrideReasonChange: (value: string) => void;
  /** Pass the live selections + total back to the parent so
   * the booking-create call can stamp the rich shape. */
  onChange: (selections: WalkinBreakfastSelections | null) => void;
  /** Hotel timezone, default `Asia/Manila`. Falls back to the
   * shared hotel config when the parent doesn't supply one. */
  timezone?: string;
}

export function WalkinBreakfastGrid({
  checkIn,
  checkOut,
  numGuests,
  staffUid,
  overrideReason,
  onOverrideReasonChange,
  onChange,
  timezone = "Asia/Manila"
}: WalkinBreakfastGridProps) {
  // Live breakfast config (one-shot fetch on mount). The
  // shared `/api/bookings/breakfast/config` endpoint serves
  // the same payload the public Step 2 page reads.
  const [config, setConfig] = useState<PublicBreakfastConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  // Per P0-9 (2026-10-22): a FAILED read is not the same thing as
  // "breakfast is switched off". The old code swallowed the failure and
  // fell through to "Breakfast not enabled" — wrong twice over (the
  // request failed, and the grid never re-read the catalog, so the
  // wrong message stuck until the page reloaded).
  const [configError, setConfigError] = useState<string | null>(null);
  const [configRetryToken, setConfigRetryToken] = useState(0);

  // Local selected-meal map (slotKey -> mealId | null).
  // `null` means "no meal for this slot" — the rich
  // `breakfastSelections` shape omits null slots entirely,
  // so the parent receives a pre-filtered map.
  const [selected, setSelected] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setConfigLoading(true);
    setConfigError(null);
    (async () => {
      try {
        // Per P0-ADMIN-API-BASE (2026-10-22): the guest API lives on a
        // different origin than the admin app, whose catch-all rewrite
        // serves the SPA shell for any unmatched path. The pre-fix
        // `window.location.origin` fetch returned HTML, `res.json()`
        // threw, and the grid rendered "Breakfast not enabled".
        const res = await fetch(
          `${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/breakfast/config`,
          { method: "GET" }
        );
        // The breakfast config endpoint answers
        // `{ success, data: { isEnabled, meals, ... } }` — the config
        // lives under `data` (this is the endpoint whose shape the
        // ADD-ONS consumers used to read by mistake; decision #313).
        const data: PublicBreakfastConfigResponse<PublicBreakfastConfig> =
          await res.json();
        if (cancelled) return;
        if (!res.ok || !data?.success || !data?.data) {
          setConfig(null);
          setConfigError(BREAKFAST_CATALOG_LOAD_ERROR);
          return;
        }
        setConfig(data.data);
      } catch {
        if (cancelled) return;
        setConfig(null);
        setConfigError(BREAKFAST_CATALOG_LOAD_ERROR);
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [configRetryToken]);

  const dates = useMemo(() => {
    const startMs = Date.parse(`${checkIn.slice(0, 10)}T00:00:00Z`);
    const endMs = Date.parse(`${checkOut.slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
    const out: string[] = [];
    for (let ms = startMs, i = 0; ms < endMs && i < 60; ms += 86_400_000, i += 1) {
      const d = new Date(ms);
      out.push(
        `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
      );
    }
    return out;
  }, [checkIn, checkOut]);

  const slots = useMemo(() => {
    const n = Math.max(1, Number(numGuests || 1));
    const out: Array<{ id: string; label: string }> = [];
    // Per BR-07-P1 (2026-10-22): the slot id is the
    // 0-based guest index, matching the CANONICAL breakfast
    // slot key (`${date}-guest-${guestIndex}`, 0-based) that
    // the guest app writes and the server resolves. The
    // pre-fix code used a 1-based index (`guest-1` …
    // `guest-n`), so a walk-in meal the desk recorded for the
    // FIRST guest landed on the guest app's `guest-1` slot
    // (the SECOND guest) and was invisible to the guest.
    for (let i = 0; i < n; i += 1) out.push({ id: `guest-${i}`, label: `Guest ${i + 1}` });
    return out;
  }, [numGuests]);

  const sortedMeals = useMemo(() => {
    const list = config?.meals || [];
    return [...list].sort((a, b) => {
      const ao = Number(a.displayOrder ?? Number.MAX_SAFE_INTEGER);
      const bo = Number(b.displayOrder ?? Number.MAX_SAFE_INTEGER);
      if (ao !== bo) return ao - bo;
      return String(a.name).localeCompare(String(b.name));
    });
  }, [config]);

  const cutoffTime = String(config?.cutoffTime || "20:00");
  const tz = String(config?.cutoffTimezone || timezone);

  const perDayLocked = useMemo(() => {
    const out: Record<string, boolean> = {};
    // Per BR-10 (2026-10-14, decision #244 reserved —
    // Phase 14): thread the cut-off enforcement toggle
    // through. The walk-in / calendar-create grids share
    // the same rule as the public flow — when the admin
    // has cut-offs off on the config, every date is
    // open and the dropdowns stay enabled for the desk.
    const cutoffsEnabled =
      ((config as { cutoffsEnabled?: boolean })?.cutoffsEnabled) !== false;
    for (const d of dates) {
      const c = computeBreakfastCutoffState({
        serviceDate: d,
        now: new Date(),
        cutoffTime,
        timezone: tz,
        cutoffsEnabled
      });
      out[d] = Boolean(c.isLocked);
    }
    return out;
  }, [dates, cutoffTime, tz]);

  // The walk-in "tonight" edge case: if the desk is
  // creating a booking for a guest that arrives NOW for
  // tonight's stay, they can order breakfast for
  // tomorrow onward — but tomorrow IS the first
  // breakfast date, and the cutoff has usually passed
  // (default 8 PM). The override flow carries the
  // reason through the same `overrideReason` field the
  // drawer uses.
  const anyLocked = useMemo(
    () => dates.some((d) => perDayLocked[d] === true),
    [dates, perDayLocked]
  );

  // Build the rich `breakfastSelections` shape + total
  // and surface to the parent.
  useEffect(() => {
    if (!config || !config.isEnabled) {
      onChange(null);
      return;
    }
    const out: WalkinBreakfastSelections["breakfastSelections"] = {};
    let total = 0;
    for (const [slotKey, mealId] of Object.entries(selected)) {
      if (!mealId) continue;
      const meal: PublicBreakfastMeal | undefined = sortedMeals.find(
        (m) => m.id === mealId
      );
      if (!meal) continue;
      const nowIso = new Date().toISOString();
      out[slotKey] = {
        mealId: meal.id,
        mealName: meal.name,
        price: meal.price,
        addedAt: nowIso,
        addedBy: staffUid || "staff",
        lastModifiedAt: nowIso,
        lastModifiedBy: staffUid || "staff",
        removedAt: null,
        removedBy: null,
        // Walk-ins can include tomorrow's locked dates
        // if `overrideReason` is provided — the parent
        // handler (handleCreateWalkin) reads the same
        // flag pattern the drawer's staff-update uses.
        overrideCutoff: anyLocked,
        overrideReason: anyLocked ? overrideReason || null : null
      };
      total += meal.price;
    }
    if (Object.keys(out).length === 0) {
      onChange(null);
      return;
    }
    onChange({
      breakfastSelections: out,
      breakfastTotal: total,
      overrideCutoff: anyLocked,
      overrideReason: anyLocked ? overrideReason || null : null
    });
  }, [config, sortedMeals, selected, anyLocked, overrideReason, staffUid, onChange]);

  // Per P0-9: ONE resolver decides what this surface shows, so the
  // "a failed read is never rendered as an empty catalog" rule is unit
  // tested instead of only observable in a running browser.
  const breakfastView = resolveBreakfastCatalogView({
    loading: configLoading,
    error: configError,
    config
  });

  if (breakfastView.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading breakfast catalog…
      </div>
    );
  }

  if (breakfastView.kind === "error") {
    // Per P0-9: the failed read gets its own state — the "not enabled"
    // copy is only true when the server actually said so.
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] text-red-800"
        data-testid="walkin-breakfast-error"
      >
        <p className="font-bold">{breakfastView.message}</p>
        <p className="mt-1 text-red-700">
          The meals on this booking are untouched — only the catalog list failed to load.
        </p>
        <button
          type="button"
          onClick={() => setConfigRetryToken((n) => n + 1)}
          className="mt-2 inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
        >
          Try again
        </button>
      </div>
    );
  }

  if (breakfastView.kind === "disabled") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800">
        <p className="font-bold">Breakfast not enabled</p>
        <p className="mt-1 text-amber-700">
          Ask an admin to enable the breakfast service in Settings.
        </p>
      </div>
    );
  }

  if (dates.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-500">
        No breakfast dates for this stay — check-in and check-out cover the same calendar day.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="walkin-breakfast-grid">
      <header className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-gray-800">Breakfast meals</p>
        <p className="text-[11px] text-gray-500">
          Pick a meal per guest per day, or skip with "No meal".
        </p>
      </header>

      {anyLocked && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] text-red-800">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} aria-hidden="true" />
            <p className="font-bold">Cutoff passed for some dates</p>
          </div>
          <p className="mt-1">
            Today is past the {cutoffTime} cutoff. Selecting a meal for a locked date requires a
            reason below — it will be recorded in the breakfast audit trail.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {dates.map((date) => {
          const locked = perDayLocked[date] === true;
          return (
            <section
              key={date}
              className={cn(
                "rounded-lg border p-3",
                locked
                  ? "border-red-200 bg-red-50/40"
                  : "border-gray-200 bg-white"
              )}
            >
              <header className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-gray-800">{date}</p>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold",
                    locked
                      ? "bg-red-100 text-red-800"
                      : "bg-status-green-bg text-status-green-text"
                  )}
                >
                  {locked ? (
                    <>
                      <AlertTriangle size={12} aria-hidden="true" /> Locked
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={12} aria-hidden="true" /> Open
                    </>
                  )}
                </span>
              </header>
              <ul className="space-y-2">
                {slots.map((slot) => {
                  const slotKey = `${date}-${slot.id}`;
                  return (
                    <li
                      key={slotKey}
                      className="grid grid-cols-[7rem_1fr] items-center gap-2"
                    >
                      <p className="text-[11px] font-semibold text-gray-700">{slot.label}</p>
                      <select
                        value={selected[slotKey] || ""}
                        onChange={(e) =>
                          setSelected((p) => ({
                            ...p,
                            [slotKey]: e.target.value
                          }))
                        }
                        className="min-h-[36px] w-full rounded border border-gray-250 bg-white px-2 text-[11px] text-gray-950"
                      >
                        <option value="">No meal — skip</option>
                        {sortedMeals.map((meal) => (
                          <option key={meal.id} value={meal.id}>
                            {meal.name} — {formatPriceShort(meal.price)}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      {anyLocked && (
        <label className="flex flex-col gap-1 text-[11px] text-gray-700">
          <span className="text-[10px] font-bold uppercase tracking-wider text-red-700">
            Override reason (required when selecting locked-date meals)
          </span>
          <textarea
            value={overrideReason}
            onChange={(e) => onOverrideReasonChange(e.target.value)}
            rows={2}
            placeholder="e.g. Late check-in; guest asked for tomorrow's breakfast at the desk."
            className="min-h-[60px] w-full rounded border border-red-200 bg-white px-2 py-1 text-[11px]"
          />
        </label>
      )}
    </div>
  );
}

function formatPriceShort(value: number): string {
  // Walk-in/Settings pages use a localized "₱X,XXX" prefix;
  // the shared `formatPrice` helper lives in
  // `admin-app/src/utils/format.ts`. We replicate the
  // formatting inline to avoid a circular import
  // (`utils/format.ts` would import the hotel config +
  // a few other deps — keeping this helper small keeps
  // the grid component dependency-free).
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "₱0";
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2
  }).format(n);
}
