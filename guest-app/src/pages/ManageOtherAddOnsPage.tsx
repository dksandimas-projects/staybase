// Per BR-12 (Phase 14 — Other Add-Ons, decision #245 reserved,
// 2026-10-14): the guest Manage Other Add-Ons page.
//
// Mounted at `/my-booking/addons?ref={bookingRef}&token={lookupToken}`.
// Mirrors `ManageBreakfastPage.tsx` (BR-04) exactly: same
// magic-link auth, same per-day layout, same batched POST with
// 60s `clientBatchId` idempotency, same cutoff countdown per
// date + per add-on, same refund-due banner.
//
// The page is the POST-BOOKING edit surface for the
// `otherAddOnSelections` field. Per-day × per-add-on
// quantity editing (NOT per-guest slot — the add-on is
// quantity-based, not guest-slot-based).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Calendar, CheckCircle2, Loader2, Wallet } from "lucide-react";
import { computeOtherAddOnCutoffState, recomputeOtherAddOnTotal, buildOtherAddOnManageOps, type OtherAddOnSelectionEntry, type AddOn } from "@spark-inn/shared";
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
    otherAddOnTotal: number;
    hasAnyOtherAddOns: boolean;
    paidAmount: number;
    balance: number;
    status: string;
  };
  otherAddOnSelections: Record<string, OtherAddOnSelectionEntry[]>;
  otherAddOnServed: Record<string, { servedAt: any; servedBy: string }>;
  refunds: Array<{ id: string; amount: number; note?: string; otherAddOnRefundContext?: { selectionKey: string; addOnName: string; priceSnapshot: number; quantitySnapshot: number } }>;
  addOns: Array<Pick<AddOn, "id" | "name" | "description" | "price" | "unit" | "cutoffHoursBeforeCheckIn" | "displayOrder">>;
  dateLockByAddOn: Array<{ date: string; addOnId: string; isLocked: boolean; cutoffAt: string; minutesUntilCutoff: number; reasonOrCutoff?: string }>;
}

function enumerateDates(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return out;
  for (let ms = a, i = 0; ms < b && i < 60; ms += 86_400_000, i += 1) {
    const d = new Date(ms);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

function formatDateLabel(date: string): string {
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

function selectionKey(date: string, addOnId: string): string {
  return `${date}-${addOnId}`;
}

function generateBatchId(): string {
  const g: any = globalThis as any;
  if (typeof g.crypto?.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  return `batch-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

export default function ManageOtherAddOnsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const ref = searchParams.get("ref") || "";
  const token = searchParams.get("token") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<ManagePayload | null>(null);
  const [draftSelections, setDraftSelections] = useState<Record<string, OtherAddOnSelectionEntry[]>>({});
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const clientBatchRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!ref || !token) {
        setError("Missing bookingRef or token.");
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(`/api/bookings/addons/manage?ref=${encodeURIComponent(ref)}&token=${encodeURIComponent(token)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json.success) {
          setError(json.error || "Could not load add-ons.");
          setLoading(false);
          return;
        }
        setPayload(json.data);
        setDraftSelections(json.data.otherAddOnSelections || {});
        setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Network error.");
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [ref, token]);

  const dates = useMemo(() => {
    if (!payload) return [];
    return enumerateDates(payload.booking.checkIn, payload.booking.checkOut);
  }, [payload]);

  const addOnById = useMemo(() => {
    const m = new Map<string, ManagePayload["addOns"][number]>();
    if (!payload) return m;
    for (const a of payload.addOns) m.set(a.id, a);
    return m;
  }, [payload]);

  const lockByKey = useMemo(() => {
    const m = new Map<string, ManagePayload["dateLockByAddOn"][number]>();
    if (!payload) return m;
    for (const l of payload.dateLockByAddOn) m.set(`${l.date}|${l.addOnId}`, l);
    return m;
  }, [payload]);

  const dirty = useMemo(() => {
    if (!payload) return false;
    if (removedKeys.size > 0) return true;
    const orig = payload.otherAddOnSelections || {};
    const origKeys = Object.keys(orig);
    const draftKeys = Object.keys(draftSelections);
    if (origKeys.length !== draftKeys.length) return true;
    for (const date of new Set([...origKeys, ...draftKeys])) {
      const a = orig[date] || [];
      const b = draftSelections[date] || [];
      if (a.length !== b.length) return true;
      for (let i = 0; i < a.length; i += 1) {
        const ae = a[i];
        const be = b[i];
        if (!ae || !be) return true;
        if (ae.addOnId !== be.addOnId) return true;
        if (ae.quantity !== be.quantity) return true;
        if (ae.priceSnapshot !== be.priceSnapshot) return true;
        if (ae.removedAt !== be.removedAt) return true;
      }
    }
    return false;
  }, [payload, draftSelections, removedKeys]);

  const draftTotal = useMemo(() => recomputeOtherAddOnTotal(draftSelections), [draftSelections]);

  const setQuantity = useCallback(
    (date: string, addOnId: string, quantity: number) => {
      const key = selectionKey(date, addOnId);
      const lock = lockByKey.get(`${date}|${addOnId}`);
      if (lock && lock.isLocked) return;
      setDraftSelections((prev) => {
        const next: typeof prev = { ...prev };
        const list = [...(next[date] || [])];
        const idx = list.findIndex((e) => e && e.addOnId === addOnId);
        const liveAddOn = addOnById.get(addOnId);
        if (!liveAddOn) return prev;
        const nowIso = new Date().toISOString();
        if (idx === -1) {
          if (quantity === 0) return prev;
          list.push({
            addOnId,
            nameSnapshot: liveAddOn.name,
            priceSnapshot: liveAddOn.price,
            quantity,
            unitSnapshot: liveAddOn.unit,
            addedAt: nowIso,
            addedBy: "guest",
            lastModifiedAt: nowIso,
            lastModifiedBy: "guest",
            removedAt: null,
            removedBy: null,
            cutoffHoursBeforeCheckInSnapshot: liveAddOn.cutoffHoursBeforeCheckIn
          });
        } else {
          if (quantity === 0) {
            list[idx] = {
              ...list[idx],
              quantity: 0,
              removedAt: nowIso,
              removedBy: "guest",
              lastModifiedAt: nowIso,
              lastModifiedBy: "guest"
            };
            setRemovedKeys((p) => {
              const ns = new Set(p);
              ns.add(key);
              return ns;
            });
          } else {
            list[idx] = {
              ...list[idx],
              quantity,
              lastModifiedAt: nowIso,
              lastModifiedBy: "guest"
            };
            setRemovedKeys((p) => {
              if (!p.has(key)) return p;
              const ns = new Set(p);
              ns.delete(key);
              return ns;
            });
          }
        }
        next[date] = list.filter((e) => e && e.quantity > 0 && e.removedAt === null).concat(
          list.filter((e) => e && (e.quantity === 0 || e.removedAt !== null))
        );
        return next;
      });
    },
    [addOnById, lockByKey]
  );

  const onSave = useCallback(async () => {
    if (!payload) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    if (!clientBatchRef.current) clientBatchRef.current = generateBatchId();
    const clientBatchId = clientBatchRef.current;

    // The batch is assembled by the shared helper so the guest page and
    // the server agree on what a quantity of 0 means: a REMOVAL, never a
    // change with quantity 0. The old inline assembly emitted BOTH for
    // the same line, and the server — which processes removals first —
    // then failed the change op with SELECTION_NOT_ORDERED and answered
    // "Nothing to change — add the add-on first." even though the
    // removal HAD been applied. Found by the AI-BROWSER-QA pass
    // (2026-10-25, scenario AO-08).
    const ops = buildOtherAddOnManageOps({
      original: payload.otherAddOnSelections || {},
      draft: draftSelections,
      catalog: (payload.addOns || []).map((a) => ({
        id: a.id,
        name: a.name,
        price: a.price,
        unit: a.unit,
        cutoffHoursBeforeCheckIn: a.cutoffHoursBeforeCheckIn
      }))
    });
    const addOps: any[] = ops.add;
    const changeOps: any[] = ops.change;
    const removeOps: any[] = ops.remove;

    try {
      const res = await fetch("/api/bookings/addons/update", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookingRef: ref,
          lookupToken: token,
          clientBatchId,
          add: addOps,
          change: changeOps,
          remove: removeOps,
          turnstileToken: undefined
        })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setSaveError(json.error || "Save failed.");
        setSaving(false);
        return;
      }
      setSaveSuccess(true);
      // Re-read the persisted state.
      const reread = await fetch(`/api/bookings/addons/manage?ref=${encodeURIComponent(ref)}&token=${encodeURIComponent(token)}`);
      const rereadJson = await reread.json();
      if (reread.ok && rereadJson.success) {
        setPayload(rereadJson.data);
        setDraftSelections(rereadJson.data.otherAddOnSelections || {});
        setRemovedKeys(new Set());
      }
      clientBatchRef.current = null;
    } catch (err: any) {
      setSaveError(err?.message || "Network error.");
    } finally {
      setSaving(false);
    }
  }, [payload, draftSelections, addOnById, ref, token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-gray-950">
        <Navbar />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <div className="flex items-center gap-2 text-gray-600">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading your add-ons…
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  if (error || !payload) {
    return (
      <div className="min-h-screen bg-white text-gray-950">
        <Navbar />
        <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <Link to="/my-booking" className="text-sm text-primary hover:underline">
            <ArrowLeft className="inline h-4 w-4" /> Back to my booking
          </Link>
          <h1 className="mt-6 font-heading text-3xl">Could not load add-ons</h1>
          <p className="mt-2 text-gray-600">{error || "Unknown error."}</p>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-950">
      <Navbar />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <Link to="/my-booking" className="text-sm text-primary hover:underline">
          <ArrowLeft className="inline h-4 w-4" /> Back to my booking
        </Link>
        <div className="mt-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Other Add-Ons</p>
          <h1 className="mt-3 font-heading text-4xl">Manage your add-ons</h1>
          <p className="mt-3 max-w-2xl leading-7 text-gray-600">
            Add or remove optional extras for each day of your stay. Each add-on has its own
            cut-off — once it passes, the day is locked.
          </p>
        </div>

        {payload.readOnly && (
          <div className="mt-6 rounded-card border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            This booking is read-only — add-ons can no longer be edited.
          </div>
        )}

        {payload.refunds && payload.refunds.length > 0 && (
          <div className="mt-6 rounded-card border border-rose-200 bg-rose-50 p-4">
            <p className="font-semibold text-rose-900">
              <Wallet className="mr-2 inline h-4 w-4" />
              Refund due
            </p>
            <ul className="mt-2 space-y-1 text-sm text-rose-900">
              {payload.refunds.map((r) => (
                <li key={r.id}>
                  {formatPrice(Math.abs(Number(r.amount || 0)))} —{" "}
                  {r.otherAddOnRefundContext?.addOnName || "Add-on"}{" "}
                  {r.otherAddOnRefundContext?.quantitySnapshot
                    ? `(×${r.otherAddOnRefundContext.quantitySnapshot})`
                    : ""}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-rose-900/80">
              Pending — staff processes the payout.
            </p>
          </div>
        )}

        {saveSuccess && (
          <div className="mt-6 rounded-card border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
            <CheckCircle2 className="mr-2 inline h-4 w-4" />
            Add-ons saved.
          </div>
        )}
        {saveError && (
          <div className="mt-6 rounded-card border border-rose-200 bg-rose-50 p-4 text-rose-900">
            <AlertTriangle className="mr-2 inline h-4 w-4" />
            {saveError}
          </div>
        )}

        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            {payload.addOns.length === 0 && (
              <p className="rounded-card border border-gray-200 bg-gray-50 p-5 text-sm text-gray-600">
                No add-ons available right now.
              </p>
            )}
            {payload.addOns.map((addOn) => (
              <div key={addOn.id} className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-heading text-lg text-gray-950">{addOn.name}</p>
                    <p className="mt-1 text-sm text-gray-600">{addOn.description}</p>
                    <p className="mt-2 text-sm text-gray-950">
                      {formatPrice(addOn.price)} <span className="text-xs text-gray-500">per {addOn.unit === "per-stay" ? "stay" : "guest"}</span>
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Cut-off: {addOn.cutoffHoursBeforeCheckIn}h before each check-in day
                    </p>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  {dates.map((date) => {
                    const lock = lockByKey.get(`${date}|${addOn.id}`);
                    const isLocked = !!(lock && lock.isLocked);
                    const list = draftSelections[date] || [];
                    const entry = list.find((e) => e && e.addOnId === addOn.id);
                    const quantity = entry ? Math.max(0, Math.floor(Number(entry.quantity) || 0)) : 0;
                    const maxGuests = Math.max(1, payload.booking.numGuests || 1);
                    return (
                      <div key={date} className="rounded-lg bg-gray-50 p-3 ring-1 ring-gray-100">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-gray-500" />
                            <p className="text-sm font-semibold text-gray-950">{formatDateLabel(date)}</p>
                          </div>
                          <p className="text-xs text-gray-600">
                            {isLocked ? "Ordering closed" : "Open"}
                          </p>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <label className="text-sm text-gray-700">Guests</label>
                          <input
                            type="number"
                            min={0}
                            max={maxGuests}
                            value={quantity}
                            disabled={isLocked || payload.readOnly}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(maxGuests, Math.floor(Number(e.target.value || 0))));
                              setQuantity(date, addOn.id, v);
                            }}
                            data-testid={`addons-qty-${date}-${addOn.id}`}
                            className="h-11 w-20 rounded-lg border border-gray-200 bg-white px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                          />
                          <span className="text-xs text-gray-500">/ {maxGuests} guests</span>
                          <span className="ml-auto text-sm font-semibold text-gray-950">
                            {formatPrice(quantity * addOn.price)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <aside className="space-y-4">
            <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
              <p className="font-heading text-lg text-gray-950">Add-ons total</p>
              <p className="mt-2 text-3xl font-semibold text-gray-950" data-testid="addons-total">
                {formatPrice(draftTotal)}
              </p>
              <p className="mt-2 text-xs text-gray-500">
                {dirty ? "Unsaved changes." : "Saved."}
              </p>
              <button
                type="button"
                disabled={!dirty || saving || payload.readOnly}
                onClick={onSave}
                data-testid="addons-save"
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Save changes
              </button>
            </div>
            <div className="rounded-card bg-gray-50 p-5 ring-1 ring-gray-200">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Booking {payload.booking.bookingRef}
              </p>
              <p className="mt-2 text-sm text-gray-700">
                {formatDateLabel(payload.booking.checkIn)} → {formatDateLabel(payload.booking.checkOut)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {payload.booking.numGuests} guest{payload.booking.numGuests === 1 ? "" : "s"}
              </p>
              <p className="mt-3 text-xs text-gray-500">
                Status: <span className="font-semibold">{payload.booking.status}</span>
              </p>
            </div>
          </aside>
        </div>
      </main>
      <Footer />
    </div>
  );
}