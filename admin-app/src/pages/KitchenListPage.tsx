// Per BR-07 (Phase 13 — Breakfast Redesign, decision
// #236, 2026-10-13): the admin "Kitchen list" page.
//
// Two surface templates from this file:
//
//   • `<KitchenListPage />` (default export) — the
//     interactive page at `/admin/kitchen-list`. Two-
//     column layout with the "Finalized at 8 PM" snapshot
//     on the left and the "Late changes" stream on the
//     right. STAFF-Token gated (admins + front-desk only).
//
//   • `<KitchenListPrintPage />` (named export) — the
//     printer-friendly view at
//     `/admin/kitchen-list/print?date=YYYY-MM-DD`. Same
//     data, no AdminLayout chrome, A4 paper-friendly grid.
//     Reachable from the "Print" button on the main page.
//
// The "Finalized" count is recomputed live from
// `breakfastSelections` per the BR-07 spec — a cancellation
// after the cut-off still appears in the "Late changes"
// column, NOT in the "Finalized" count (since the entry
// is filtered out by `removedAt !== null`). The cut-off
// time comes from `BreakfastConfig.cutoffTime` via the
// `computeBreakfastCutoffState` helper on the server.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ChefHat,
  Printer,
  Loader2,
  Coffee,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  X as XIcon,
  ArrowRight,
  CalendarRange,
  Hash
} from "lucide-react";
import { motion } from "framer-motion";
import { useAdmin } from "../context/AdminContext";
import { useToast } from "../components/Toast";
import { getApiBaseUrl } from "../utils/apiBaseUrl";
import { auth } from "../firebase/auth";
import config from "@config";
import { formatPrice } from "../utils/format";
import { dateKeyInTimeZone, shiftDateKey } from "../utils/finance";

// ---------- Server response mirror ----------

interface FinalizedEntry {
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

interface LateChangeEntry {
  auditId: string;
  bookingId: string;
  ref: string;
  roomNumber: string;
  guestName: string;
  guestIndex: number;
  action:
    | "add"
    | "change"
    | "remove"
    | "serve"
    | "unserve"
    | "override-add"
    | "override-change"
    | "override-remove";
  mealSnapshot: { mealId: string; mealName: string; price: number } | null;
  slotKey: string;
  occurredAt: string;
  occurredAfterCutoff: boolean;
  reason: string | null;
  actorRole: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

interface KitchenListSummary {
  totalMeals: number;
  byMeal: Record<string, number>;
}

interface KitchenListResponse {
  success: true;
  date: string;
  cutoffAt: string;
  cutoffPassed: boolean;
  finalized: FinalizedEntry[];
  lateChanges: LateChangeEntry[];
  summary: KitchenListSummary;
}

type ViewMode = "today" | "tomorrow" | "custom";

// ---------- Constants ----------

const HOTEL_TIMEZONE = config.timezone || "Asia/Manila";

function getDateKeyForViewMode(mode: ViewMode): string {
  return dateKeyInTimeZone(
    new Date(),
    HOTEL_TIMEZONE
  );
}

function tomorrowDateKey(): string {
  return shiftDateKey(dateKeyInTimeZone(new Date(), HOTEL_TIMEZONE), 1);
}

function describeAction(action: string): string {
  switch (action) {
    case "add":
      return "Added";
    case "change":
      return "Changed";
    case "remove":
      return "Removed";
    case "serve":
      return "Served";
    case "unserve":
      return "Un-served";
    case "override-add":
      return "Added (override)";
    case "override-change":
      return "Changed (override)";
    case "override-remove":
      return "Removed (override)";
    default:
      return action || "Updated";
  }
}

function describeReason(reason: string | null | undefined): string {
  if (!reason) return "";
  if (reason.startsWith("mark-refund-paid:")) {
    return "Refund marked paid";
  }
  return reason;
}

// `formatClock` renders `HH:MM` from an ISO timestamp;
// an empty string (or unparseable value) renders an em-
// dash so the page stays well-typed.
function formatClock(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  const parsed = Date.parse(isoString);
  if (!Number.isFinite(parsed)) return "—";
  try {
    return new Date(parsed).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "—";
  }
}

function formatLongDate(dateKey: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return dateKey;
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dateKey;
  const probe = new Date(Date.UTC(y, m - 1, d));
  try {
    return probe.toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC"
    });
  } catch {
    return dateKey;
  }
}

// ---------- Data fetch + auth helpers ----------

async function fetchKitchenList(dateKey: string): Promise<KitchenListResponse> {
  const base = getApiBaseUrl().replace(/\/$/, "");
  if (!base) {
    throw new Error("API base URL is not configured.");
  }
  const token = await auth.currentUser?.getIdToken();
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(
    `${base}/api/bookings/breakfast/kitchen-list?date=${encodeURIComponent(dateKey)}`,
    { method: "GET", headers }
  );
  const data = await response.json();
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data as KitchenListResponse;
}

async function acknowledgeAuditEntry(input: {
  bookingId: string;
  auditId: string;
}): Promise<{ acknowledgedAt: string; acknowledgedBy: string }> {
  const base = getApiBaseUrl().replace(/\/$/, "");
  const token = await auth.currentUser?.getIdToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const response = await fetch(
    `${base}/api/bookings/breakfast/kitchen-list/acknowledge`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(input)
    }
  );
  const data = await response.json();
  if (!response.ok || !data?.success) {
    throw new Error(data?.error || `Request failed (${response.status})`);
  }
  return data.data as { acknowledgedAt: string; acknowledgedBy: string };
}

// ---------- Shared view helpers ----------

function groupFinalizedByMeal(
  finalized: FinalizedEntry[]
): Array<{ mealName: string; entries: FinalizedEntry[]; total: number }> {
  const bucket = new Map<string, FinalizedEntry[]>();
  for (const entry of finalized) {
    const key = entry.mealName || "Unnamed meal";
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push(entry);
  }
  const groups = Array.from(bucket.entries()).map(([mealName, entries]) => ({
    mealName,
    entries,
    total: entries.length
  }));
  // Stable alphabetical order — the chef reorders by
  // cook-station manually, so the alphabetical default
  // is the only sort we promise.
  groups.sort((a, b) => a.mealName.localeCompare(b.mealName));
  return groups;
}

// ---------- Main component: interactive page ----------

export default function KitchenListPage() {
  const { currentUser } = useAdmin();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const param = searchParams.get("view");
    if (param === "today" || param === "tomorrow" || param === "custom") return param;
    return "tomorrow";
  });
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const param = searchParams.get("date");
    if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) return param;
    return tomorrowDateKey();
  });
  const [data, setData] = useState<KitchenListResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedMeals, setExpandedMeals] = useState<Set<string>>(new Set());

  const role = currentUser?.role;
  const isAuthorized = role === "admin" || role === "front-desk";

  // Sync the viewMode + date in the URL so the Print
  // button just reads `?date=YYYY-MM-DD` from the same
  // address bar.
  useEffect(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.set("view", viewMode);
    next.set("date", selectedDate);
    setSearchParams(next, { replace: true });
    // We intentionally depend on the two tracked values
    // only — `searchParams.toString()` is a fresh object
    // each render, so reading it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedDate]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchKitchenList(selectedDate);
      setData(payload);
    } catch (err: any) {
      setError(err?.message || "Could not load the kitchen list.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }
    void reload();
    // Re-fetch on tab refocus so a kitchen shift
    // doesn't see stale late changes after their
    // colleague acknowledged a row 5 minutes ago.
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isAuthorized, reload]);

  const handleAcknowledge = async (entry: LateChangeEntry) => {
    try {
      const ack = await acknowledgeAuditEntry({
        bookingId: entry.bookingId,
        auditId: entry.auditId
      });
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          lateChanges: prev.lateChanges.map((row) =>
            row.auditId === entry.auditId && row.bookingId === entry.bookingId
              ? {
                  ...row,
                  acknowledgedAt: ack.acknowledgedAt,
                  acknowledgedBy: ack.acknowledgedBy
                }
              : row
          )
        };
      });
      toast.success("Acknowledged", `${describeAction(entry.action)} · ${entry.ref}`);
    } catch (err: any) {
      toast.error(
        "Could not acknowledge",
        err?.message || "The audit entry might have been updated. Refresh to try again."
      );
    }
  };

  const handleViewModeChange = (mode: ViewMode) => {
    const targetDate =
      mode === "today" ? getDateKeyForViewMode("today") : tomorrowDateKey();
    setViewMode(mode);
    setSelectedDate(targetDate);
  };

  const handleCustomDate = (next: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
    setViewMode("custom");
    setSelectedDate(next);
  };

  if (!isAuthorized) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6 py-12">
        <div className="rounded-card border border-gray-200 bg-white p-8 text-center shadow-sm">
          <AlertTriangle
            size={28}
            className="mx-auto mb-3 text-amber-600"
            aria-hidden="true"
          />
          <h1 className="text-lg font-semibold text-gray-900">
            Not authorized
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            The kitchen list is restricted to staff members. Sign in with a
            front-desk or admin account to view it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <KitchenListHeader
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        selectedDate={selectedDate}
        onSelectedDateChange={handleCustomDate}
        onReload={() => void reload()}
        loading={loading}
      />

      {error ? (
        <div className="mt-6 flex items-start gap-3 rounded-card border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-semibold">Could not load the kitchen list</p>
            <p className="text-xs">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => void reload()}
            className="flex min-h-11 items-center gap-1 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50"
          >
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      ) : null}

      {loading && !data ? (
        <div className="mt-12 flex items-center justify-center text-sm text-gray-600">
          <Loader2 size={20} className="mr-2 animate-spin" aria-hidden="true" />
          Loading kitchen list…
        </div>
      ) : null}

      {data ? (
        <KitchenListBody
          data={data}
          expandedMeals={expandedMeals}
          onToggleMeal={(meal) =>
            setExpandedMeals((prev) => {
              const next = new Set(prev);
              if (next.has(meal)) next.delete(meal);
              else next.add(meal);
              return next;
            })
          }
          onAcknowledge={(entry) => void handleAcknowledge(entry)}
        />
      ) : null}
    </div>
  );
}

// ---------- Header subcomponent ----------

interface KitchenListHeaderProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  selectedDate: string;
  onSelectedDateChange: (next: string) => void;
  onReload: () => void;
  loading: boolean;
}

function KitchenListHeader({
  viewMode,
  onViewModeChange,
  selectedDate,
  onSelectedDateChange,
  onReload,
  loading
}: KitchenListHeaderProps) {
  const printHref = `/admin/kitchen-list/print?date=${encodeURIComponent(selectedDate)}`;
  return (
    <header className="flex flex-col gap-4 print:hidden">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-primary/10 text-primary">
            <ChefHat size={22} aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-primary">
              Kitchen operations
            </p>
            <h1 className="font-display text-2xl font-semibold text-gray-900">
              Kitchen list
            </h1>
            <p className="text-sm text-gray-600">
              Daily prep handoff for the breakfast service.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onReload}
            disabled={loading}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={loading ? "animate-spin" : ""}
            />
            Refresh
          </button>
          <Link
            to={printHref}
            className="flex min-h-11 items-center gap-2 rounded-lg border border-primary bg-white px-3 text-sm font-semibold text-primary hover:bg-primary/5"
          >
            <Printer size={16} aria-hidden="true" />
            Print view
          </Link>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Kitchen list view"
        className="flex flex-wrap items-center gap-3 rounded-card border border-gray-200 bg-white p-3 shadow-sm"
      >
        <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "today"}
            onClick={() => onViewModeChange("today")}
            className={`flex min-h-11 items-center gap-2 px-4 text-sm font-semibold transition ${
              viewMode === "today"
                ? "bg-primary text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            <Clock size={14} aria-hidden="true" />
            Today
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={viewMode === "tomorrow"}
            onClick={() => onViewModeChange("tomorrow")}
            className={`flex min-h-11 items-center gap-2 border-l border-gray-200 px-4 text-sm font-semibold transition ${
              viewMode === "tomorrow"
                ? "bg-primary text-white"
                : "bg-white text-gray-700 hover:bg-gray-50"
            }`}
          >
            <Coffee size={14} aria-hidden="true" />
            Tomorrow's prep
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs font-semibold text-gray-600">
          <CalendarRange size={14} aria-hidden="true" />
          Or pick a date
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => onSelectedDateChange(e.target.value)}
            className="h-11 rounded-lg border border-gray-200 bg-white px-3 text-sm font-normal text-gray-900 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </label>
      </div>
    </header>
  );
}

// ---------- Body subcomponent ----------

interface KitchenListBodyProps {
  data: KitchenListResponse;
  expandedMeals: Set<string>;
  onToggleMeal: (mealName: string) => void;
  onAcknowledge: (entry: LateChangeEntry) => void;
}

function KitchenListBody({
  data,
  expandedMeals,
  onToggleMeal,
  onAcknowledge
}: KitchenListBodyProps) {
  const groups = useMemo(
    () => groupFinalizedByMeal(data.finalized),
    [data.finalized]
  );
  const lateCount = data.lateChanges.length;
  const unackedCount = data.lateChanges.filter(
    (entry) => !entry.acknowledgedAt
  ).length;

  return (
    <>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <FinalizedColumn
          groups={groups}
          expandedMeals={expandedMeals}
          onToggleMeal={onToggleMeal}
          cutoffAt={data.cutoffAt}
        />
        <LateChangesColumn
          lateChanges={data.lateChanges}
          onAcknowledge={onAcknowledge}
          unackedCount={unackedCount}
        />
      </div>

      <SummaryFooter data={data} lateCount={lateCount} unackedCount={unackedCount} />
    </>
  );
}

interface FinalizedColumnProps {
  groups: Array<{ mealName: string; entries: FinalizedEntry[]; total: number }>;
  expandedMeals: Set<string>;
  onToggleMeal: (mealName: string) => void;
  cutoffAt: string;
}

function FinalizedColumn({
  groups,
  expandedMeals,
  onToggleMeal,
  cutoffAt
}: FinalizedColumnProps) {
  return (
    <section
      aria-label="Finalized at 8 PM"
      className="flex flex-col rounded-card border border-gray-200 bg-white shadow-sm"
    >
      <header className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Step 1
          </p>
          <h2 className="font-display text-lg font-semibold text-gray-900">
            Finalized at 8 PM
          </h2>
          <p className="mt-1 text-xs text-gray-600">
            Cutoff: {formatClock(cutoffAt)} · Live recompute from bookings
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
          <CheckCircle2 size={12} aria-hidden="true" />
          {groups.reduce((sum, group) => sum + group.total, 0)} meals
        </span>
      </header>

      <div className="flex-1 p-3">
        {groups.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
            No meals finalized for this date. The kitchen list will reflect
            whatever guests added before the cutoff.
          </p>
        ) : (
          <ul className="space-y-2">
            {groups.map((group) => {
              const expanded = expandedMeals.has(group.mealName);
              return (
                <li
                  key={group.mealName}
                  className="overflow-hidden rounded-lg border border-gray-100"
                >
                  <button
                    type="button"
                    onClick={() => onToggleMeal(group.mealName)}
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-gray-50"
                  >
                    <span className="font-semibold text-gray-900">
                      {group.mealName}
                    </span>
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
                      <Hash size={14} aria-hidden="true" />
                      {group.total}
                    </span>
                  </button>
                  {expanded ? (
                    <ul className="space-y-1 border-t border-gray-100 bg-gray-50 px-3 py-2">
                      {group.entries.map((entry) => (
                        <li
                          key={`${entry.bookingId}:${entry.slotKey}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white p-2 text-xs text-gray-700"
                        >
                          <span className="font-semibold">
                            Room {entry.roomNumber}
                          </span>
                          <span className="flex-1 truncate">{entry.guestName}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] uppercase tracking-wider text-gray-600">
                            {entry.ref}
                          </span>
                          <span className="text-[11px] font-semibold text-emerald-700">
                            {formatPrice(entry.price)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

interface LateChangesColumnProps {
  lateChanges: LateChangeEntry[];
  onAcknowledge: (entry: LateChangeEntry) => void;
  unackedCount: number;
}

function LateChangesColumn({
  lateChanges,
  onAcknowledge,
  unackedCount
}: LateChangesColumnProps) {
  return (
    <section
      aria-label="Late changes"
      className="flex flex-col rounded-card border border-gray-200 bg-white shadow-sm"
    >
      <header className="flex items-start justify-between gap-3 border-b border-gray-100 p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Step 2
          </p>
          <h2 className="font-display text-lg font-semibold text-gray-900">
            Late changes
          </h2>
          <p className="mt-1 text-xs text-gray-600">
            Sorted by occurred-at (most recent first)
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
            unackedCount > 0
              ? "bg-amber-50 text-amber-700"
              : "bg-emerald-50 text-emerald-700"
          }`}
        >
          <AlertTriangle
            size={12}
            aria-hidden="true"
            className={unackedCount > 0 ? "" : "hidden"}
          />
          {unackedCount > 0
            ? `${unackedCount} unacknowledged`
            : "All clear"}
        </span>
      </header>

      <div className="flex-1 p-3">
        {lateChanges.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
            No late changes recorded yet. Anything added or removed after
            the 8 PM cutoff will appear here.
          </p>
        ) : (
          <ul className="space-y-2">
            {lateChanges.map((entry) => (
              <LateChangeRow
                key={`${entry.bookingId}:${entry.auditId}`}
                entry={entry}
                onAcknowledge={() => onAcknowledge(entry)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function LateChangeRow({
  entry,
  onAcknowledge
}: {
  entry: LateChangeEntry;
  onAcknowledge: () => void;
}) {
  const acked = Boolean(entry.acknowledgedAt);
  const reasonText = describeReason(entry.reason);
  const mealLabel =
    entry.mealSnapshot?.mealName ||
    (entry.action === "remove" || entry.action === "override-remove"
      ? "(removed meal)"
      : "—");
  return (
    <li
      data-acked={acked ? "true" : "false"}
      className={`flex flex-col gap-2 rounded-lg border p-3 text-xs ${
        acked
          ? "border-gray-100 bg-gray-50 text-gray-500"
          : "border-amber-200 bg-amber-50/40 text-gray-800"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-700">
            Room {entry.roomNumber}
          </span>
          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-700">
            {entry.ref}
          </span>
          <span className="font-semibold text-gray-900">{entry.guestName}</span>
        </div>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          {formatClock(entry.occurredAt)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">
          <span className="text-primary">{describeAction(entry.action)}</span>{" "}
          <span className="text-gray-700">{mealLabel}</span>
          {entry.mealSnapshot?.price ? (
            <span className="ml-2 text-emerald-700">
              {formatPrice(entry.mealSnapshot.price)}
            </span>
          ) : null}
        </span>
        {reasonText ? (
          <span className="text-[11px] italic text-gray-600">"{reasonText}"</span>
        ) : null}
      </div>
      {acked ? (
        <p className="text-[11px] text-gray-500">
          <CheckCircle2
            size={11}
            className="mr-1 inline"
            aria-hidden="true"
          />
          Acknowledged at {formatClock(entry.acknowledgedAt)} by{" "}
          <span className="font-mono">{entry.acknowledgedBy ?? "—"}</span>
        </p>
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onAcknowledge}
            className="flex min-h-11 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-white hover:bg-primary/90"
          >
            <CheckCircle2 size={12} aria-hidden="true" />
            Acknowledge
          </button>
        </div>
      )}
    </li>
  );
}

function SummaryFooter({
  data,
  lateCount,
  unackedCount
}: {
  data: KitchenListResponse;
  lateCount: number;
  unackedCount: number;
}) {
  const mealRows = Object.entries(data.summary.byMeal).sort((a, b) =>
    a[0].localeCompare(b[0])
  );
  return (
    <section className="mt-6 grid gap-4 rounded-card border border-gray-200 bg-white p-5 text-sm text-gray-700 shadow-sm print:hidden sm:grid-cols-2 lg:grid-cols-4">
      <SummaryStat
        label="Total meals"
        value={String(data.summary.totalMeals)}
        icon={<Coffee size={16} aria-hidden="true" />}
      />
      <SummaryStat
        label="Late changes"
        value={String(lateCount)}
        icon={<AlertTriangle size={16} aria-hidden="true" />}
      />
      <SummaryStat
        label="Unacknowledged"
        value={String(unackedCount)}
        icon={<CheckCircle2 size={16} aria-hidden="true" />}
      />
      <SummaryStat
        label="Cutoff"
        value={formatClock(data.cutoffAt)}
        icon={<Clock size={16} aria-hidden="true" />}
      />
      {mealRows.length > 0 ? (
        <div className="sm:col-span-2 lg:col-span-4">
          <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
            Meals by name
          </p>
          <ul className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
            {mealRows.map(([name, count]) => (
              <li
                key={name}
                className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm"
              >
                <span className="truncate">{name}</span>
                <span className="font-semibold text-primary">{count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function SummaryStat({
  label,
  value,
  icon
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-gray-50 px-4 py-3">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
        {icon}
        {label}
      </p>
      <p className="font-display text-xl font-semibold text-gray-900">{value}</p>
    </div>
  );
}

// ---------- Print-friendly page ----------

export function KitchenListPrintPage() {
  const [searchParams] = useSearchParams();
  const [data, setData] = useState<KitchenListResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const dateKey = (() => {
    const param = searchParams.get("date");
    if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) return param;
    return tomorrowDateKey();
  })();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchKitchenList(dateKey)
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err?.message || "Could not load the kitchen list.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dateKey]);

  return (
    <div className="mx-auto w-full max-w-3xl bg-white p-8">
      <header className="border-b border-gray-200 pb-4">
        <p className="text-xs font-bold uppercase tracking-wider text-gray-500">
          Kitchen list · {config.brandName}
        </p>
        <h1 className="font-display text-2xl font-semibold text-gray-900">
          {formatLongDate(dateKey)}
        </h1>
        <p className="mt-1 text-sm text-gray-600">
          Finalized count locks at 8 PM hotel time. Late changes appear in
          the second column for the duration of the shift.
        </p>
      </header>

      {error ? (
        <p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading && !data ? (
        <p className="mt-8 text-sm text-gray-600">Loading…</p>
      ) : null}

      {data ? (
        <PrintLayout data={data} />
      ) : (
        <noscript>
          <p className="mt-6 text-sm text-gray-700">
            The kitchen list fetches dynamically — enable JavaScript or use
            the &quot;Print view&quot; button on the interactive page.
          </p>
        </noscript>
      )}
    </div>
  );
}

function PrintLayout({ data }: { data: KitchenListResponse }) {
  const groups = useMemo(
    () => groupFinalizedByMeal(data.finalized),
    [data.finalized]
  );
  return (
    <>
      <section className="mt-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Finalized at 8 PM ({data.summary.totalMeals} meals)
        </h2>
        {groups.length === 0 ? (
          <p className="mt-2 text-sm italic text-gray-500">
            No meals finalized for this date.
          </p>
        ) : (
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left text-xs uppercase tracking-wider text-gray-600">
                <th className="py-2 pr-2">Meal</th>
                <th className="py-2 pr-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.mealName} className="border-b border-gray-200 align-top">
                  <td className="py-2 pr-2 font-semibold text-gray-900">
                    {group.mealName}
                  </td>
                  <td className="py-2 pr-2 text-gray-700">{group.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ul className="mt-3 space-y-1 text-xs text-gray-700">
          {data.finalized.map((entry) => (
            <li
              key={`${entry.bookingId}:${entry.slotKey}`}
              className="break-inside-avoid border-b border-dashed border-gray-200 pb-1"
            >
              <span className="font-semibold">Room {entry.roomNumber}</span> ·{" "}
              {entry.guestName} · {entry.mealName} ·{" "}
              {formatPrice(entry.price)} · {entry.ref}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-gray-900">
          Late changes ({data.lateChanges.length})
        </h2>
        {data.lateChanges.length === 0 ? (
          <p className="mt-2 text-sm italic text-gray-500">
            No late changes recorded.
          </p>
        ) : (
          <ul className="mt-3 space-y-1 text-xs text-gray-700">
            {data.lateChanges.map((entry) => (
              <li
                key={`${entry.bookingId}:${entry.auditId}`}
                className="break-inside-avoid border-b border-dashed border-gray-200 pb-1"
              >
                <span className="font-semibold">
                  {formatClock(entry.occurredAt)}
                </span>{" "}
                · {describeAction(entry.action)} ·{" "}
                {entry.mealSnapshot?.mealName || "—"} ·{" "}
                <span className="font-mono">R{entry.roomNumber}</span> ·{" "}
                {entry.ref}{" "}
                {entry.acknowledgedAt ? (
                  <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                    Acked {formatClock(entry.acknowledgedAt)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// Hidden helpers kept exported for the BR-07 source-text
// tripwire test (the page must read the date from the
// query string OR default to tomorrow).
export const __kitchenListPageInternals = {
  tomorrowDateKey,
  describeAction,
  describeReason,
  getDateKeyForViewMode
};

// `motion` is unused at the top-level — kept as an
// indirect dependency so a follow-up BR-08 polish
// (animated row insertion on ack) can drop in a
// `<motion.ul>` without re-importing the package.
void motion;
void ArrowRight;
void XIcon;
