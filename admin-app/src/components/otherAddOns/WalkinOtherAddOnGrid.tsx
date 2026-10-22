// Per BR-12.1 (Phase 14 — Other Add-Ons admin UI surfaces,
// decision #247 reserved, 2026-10-15): the per-day ×
// per-add-on grid used in the walk-in modal at
// `BookingsPage.tsx` + the calendar-create modal at
// `CalendarPage.tsx`. Mirrors the BR-05
// `WalkinBreakfastGrid` shape (the per-day × per-guest
// grid for breakfast) but uses one quantity input per
// (date, addOnId) pair instead of a per-guest slot.
//
// The component fetches the public
// `/api/bookings/addons/config` payload on mount
// (same source the public Step 2 grid reads), renders
// a per-day section with a per-add-on row showing a
// quantity input, a row subtotal, and a remove button.
// The "Add row" at the bottom of each date surfaces a
// select of enabled add-ons + a quantity input +
// an Add button. The write-time path (walk-in /
// calendar-create) is always override-allowed — there
// is no cutoff lock UI; the front desk can edit any
// date with the same shape.
//
// The component is intentionally minimal — no
// override flow, no serve buttons, no audit modal.
// Those live in the booking-drawer "Other Add-Ons"
// tab (Surface 2). This grid is the write-time
// companion of the read-only / edit-only drawer tab.

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2
} from "lucide-react";
import {
  // NOTE: `getEnabledAddOnsByHotel` is deliberately NOT applied to the
  // public catalog payload. The endpoint already applied the `isEnabled`
  // filter and the hotel-wide master switch, and the public payload
  // carries no `isEnabled` field — re-filtering client-side would drop
  // every row.
  type AddOn
} from "@spark-inn/shared";
import { cn } from "../../utils/cn";
// Per P0-ADMIN-API-BASE (2026-10-22): the admin app must call the
// guest app's API through `getApiBaseUrl()`, never a relative `/api`.
import { getApiBaseUrl } from "../../utils/apiBaseUrl";

export interface WalkinOtherAddOnSelections {
  /** `yyyy-mm-dd` → array of selected add-on entries. */
  otherAddOnSelections: Record<string, WalkinOtherAddOnEntry[]>;
  otherAddOnTotal: number;
  hasAnyOtherAddOns: boolean;
}

export interface WalkinOtherAddOnEntry {
  addOnId: string;
  nameSnapshot: string;
  priceSnapshot: number;
  quantity: number;
  unitSnapshot: "per-person" | "per-stay";
  addedAt: string;
  addedBy: string;
  lastModifiedAt: string;
  lastModifiedBy: string;
  removedAt: null;
  removedBy: null;
  cutoffHoursBeforeCheckInSnapshot: number;
}

interface WalkinOtherAddOnGridProps {
  checkIn: string;
  checkOut: string;
  numGuests: number;
  staffUid: string;
  onChange: (selections: WalkinOtherAddOnSelections | null) => void;
}

export function WalkinOtherAddOnGrid({
  checkIn,
  checkOut,
  numGuests,
  staffUid,
  onChange
}: WalkinOtherAddOnGridProps) {
  const [addOns, setAddOns] = useState<AddOn[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Per-date, per-addOnId live quantity (0 = no selection).
  // The "add" action stamps a new entry; "remove" deletes
  // the entry from the map.
  const [live, setLive] = useState<Record<string, Record<string, number>>>({});
  // Per-date pending "add" form: { addOnId, quantity }.
  const [pendingAdd, setPendingAdd] = useState<
    Record<string, { addOnId: string; quantity: number }>
  >({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // Per P0-ADMIN-API-BASE (2026-10-22): the guest API lives on a
        // different origin than the admin app, whose catch-all rewrite
        // serves the SPA shell for any unmatched path. The pre-fix
        // `window.location.origin` fetch returned HTML, `res.json()`
        // threw, and the grid rendered no add-on rows at all.
        const res = await fetch(
          `${getApiBaseUrl().replace(/\/$/, "")}/api/bookings/addons/config`,
          { method: "GET" }
        );
        const data: any = await res.json();
        // The public add-ons catalog endpoint answers
        // `{ success, addOns: [...], otherAddOnsEnabled, preSeeded }` —
        // the rows live under `addOns`, NOT under `data` (that is the
        // BREAKFAST config endpoint's shape). The pre-fix check read
        // `data.data`, which is always undefined here, so the grid
        // rendered no add-on rows at all.
        //
        // The rows are used AS-IS: the endpoint already applied the
        // `isEnabled` filter and the hotel-wide master switch, and the
        // public payload does not carry `isEnabled` at all — so
        // re-running `getEnabledAddOnsByHotel` client-side would drop
        // EVERY row.
        if (!cancelled && data?.success && Array.isArray(data?.addOns)) {
          setAddOns(data.addOns as AddOn[]);
        }
      } catch {
        // silent — keep null
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dates = useMemo(() => {
    const startMs = Date.parse(`${(checkIn || "").slice(0, 10)}T00:00:00Z`);
    const endMs = Date.parse(`${(checkOut || "").slice(0, 10)}T00:00:00Z`);
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

  // Build the rich `otherAddOnSelections` shape + total
  // and surface to the parent on every change.
  useEffect(() => {
    if (!addOns || addOns.length === 0) {
      onChange(null);
      return;
    }
    const byAddOn = new Map(addOns.map((a) => [a.id, a]));
    const out: WalkinOtherAddOnSelections["otherAddOnSelections"] = {};
    let total = 0;
    let hasAny = false;
    for (const date of dates) {
      const day = live[date] || {};
      const list: WalkinOtherAddOnEntry[] = [];
      for (const [addOnId, quantity] of Object.entries(day)) {
        const q = Math.max(0, Math.floor(Number(quantity) || 0));
        if (q <= 0) continue;
        const cat = byAddOn.get(addOnId);
        if (!cat) continue;
        const nowIso = new Date().toISOString();
        list.push({
          addOnId,
          nameSnapshot: cat.name,
          priceSnapshot: cat.price,
          quantity: q,
          unitSnapshot: cat.unit,
          addedAt: nowIso,
          addedBy: staffUid || "staff",
          lastModifiedAt: nowIso,
          lastModifiedBy: staffUid || "staff",
          removedAt: null,
          removedBy: null,
          cutoffHoursBeforeCheckInSnapshot: cat.cutoffHoursBeforeCheckIn
        });
        total += cat.price * q;
        hasAny = true;
      }
      if (list.length > 0) out[date] = list;
    }
    if (!hasAny) {
      onChange(null);
      return;
    }
    onChange({
      otherAddOnSelections: out,
      otherAddOnTotal: total,
      hasAnyOtherAddOns: hasAny
    });
  }, [addOns, dates, live, staffUid, onChange]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading add-on catalog…
      </div>
    );
  }

  if (!addOns || addOns.length === 0) {
    return (
      <div
        data-testid="walkin-addons-empty"
        className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800"
      >
        <p className="font-bold">Add-ons are currently disabled</p>
        <p className="mt-1 text-amber-700">
          Ask an admin to enable add-ons in Settings → Other Add-Ons.
        </p>
      </div>
    );
  }

  if (dates.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-[11px] text-gray-500">
        No stay dates — check-in and check-out cover the same calendar day.
      </div>
    );
  }

  const maxGuests = Math.max(1, Math.floor(Number(numGuests) || 1));

  const handleSetQuantity = (date: string, addOnId: string, value: number) => {
    const q = Math.max(0, Math.min(maxGuests, Math.floor(Number(value) || 0)));
    setLive((p) => {
      const day = { ...(p[date] || {}) };
      if (q === 0) {
        delete day[addOnId];
      } else {
        day[addOnId] = q;
      }
      return { ...p, [date]: day };
    });
  };

  const handleRemove = (date: string, addOnId: string) => {
    setLive((p) => {
      const day = { ...(p[date] || {}) };
      delete day[addOnId];
      return { ...p, [date]: day };
    });
  };

  const handleAdd = (date: string) => {
    const pending = pendingAdd[date];
    if (!pending || !pending.addOnId || pending.quantity <= 0) return;
    setLive((p) => ({
      ...p,
      [date]: { ...(p[date] || {}), [pending.addOnId]: pending.quantity }
    }));
    setPendingAdd((p) => ({ ...p, [date]: { addOnId: "", quantity: 1 } }));
  };

  return (
    <div className="space-y-3" data-testid="walkin-addons-grid">
      <header className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-gray-800">Other add-ons</p>
        <p className="text-[11px] text-gray-500">
          Pick a quantity per add-on per day, or skip with the Step-2 ghost button.
        </p>
      </header>

      <div className="space-y-3">
        {dates.map((date) => {
          const day = live[date] || {};
          const entries = Object.entries(day);
          const pending = pendingAdd[date] || { addOnId: "", quantity: 1 };
          // Filter out add-ons already in the day's list
          // so the "add" select doesn't offer duplicates.
          const available = addOns.filter((a) => !day[a.id]);
          return (
            <section
              key={date}
              data-testid={`walkin-addons-day-${date}`}
              className={cn(
                "rounded-lg border border-gray-200 bg-white p-3"
              )}
            >
              <header className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-gray-800">{date}</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-status-green-bg px-2 py-0.5 text-[10px] font-bold text-status-green-text">
                  <CheckCircle2 size={12} aria-hidden="true" /> Open
                </span>
              </header>
              <ul className="space-y-2">
                {entries.length === 0 ? (
                  <li className="rounded-lg border border-dashed border-gray-200 p-2 text-[11px] text-gray-500">
                    No add-ons for this date yet.
                  </li>
                ) : (
                  entries.map(([addOnId, quantity]) => {
                    const cat = addOns.find((a) => a.id === addOnId);
                    if (!cat) return null;
                    const subtotal = cat.price * quantity;
                    return (
                      <li
                        key={addOnId}
                        data-testid={`walkin-addons-row-${date}-${addOnId}`}
                        className="grid grid-cols-[1fr_5rem_6rem_2rem] items-center gap-2"
                      >
                        <div>
                          <p className="text-[11px] font-semibold text-gray-800">
                            {cat.name}
                          </p>
                          <p className="text-[10px] text-gray-500">
                            ₱{cat.price.toLocaleString()} / {cat.unit === "per-person" ? "guest" : "stay"}
                          </p>
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={maxGuests}
                          value={quantity}
                          onChange={(e) => handleSetQuantity(date, addOnId, Number(e.target.value))}
                          aria-label={`${cat.name} quantity for ${date}`}
                          className="min-h-[36px] w-full rounded border border-gray-250 bg-white px-2 text-center text-[11px]"
                        />
                        <p className="text-right text-[11px] font-semibold text-gray-800">
                          ₱{subtotal.toLocaleString()}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleRemove(date, addOnId)}
                          aria-label={`Remove ${cat.name} for ${date}`}
                          className="inline-flex h-8 w-8 items-center justify-center rounded text-gray-500 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              {available.length > 0 ? (
                <div className="mt-2 flex items-center gap-2 border-t border-gray-100 pt-2">
                  <select
                    value={pending.addOnId}
                    onChange={(e) =>
                      setPendingAdd((p) => ({
                        ...p,
                        [date]: { ...pending, addOnId: e.target.value }
                      }))
                    }
                    aria-label={`Add-on to add for ${date}`}
                    className="min-h-[36px] flex-1 rounded border border-gray-250 bg-white px-2 text-[11px]"
                  >
                    <option value="">— Select add-on —</option>
                    {available.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} — ₱{a.price.toLocaleString()}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={maxGuests}
                    value={pending.quantity}
                    onChange={(e) =>
                      setPendingAdd((p) => ({
                        ...p,
                        [date]: { ...pending, quantity: Math.max(1, Math.min(maxGuests, Number(e.target.value) || 1)) }
                      }))
                    }
                    aria-label={`Quantity for ${date}`}
                    className="min-h-[36px] w-16 rounded border border-gray-250 bg-white px-2 text-center text-[11px]"
                  />
                  <button
                    type="button"
                    onClick={() => handleAdd(date)}
                    disabled={!pending.addOnId || pending.quantity <= 0}
                    aria-label={`Add add-on for ${date}`}
                    className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-primary px-3 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    <Plus size={12} aria-hidden="true" /> Add
                  </button>
                </div>
              ) : (
                <p className="mt-2 flex items-center gap-1 text-[10px] text-amber-700">
                  <AlertTriangle size={12} aria-hidden="true" /> All enabled add-ons already added.
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
