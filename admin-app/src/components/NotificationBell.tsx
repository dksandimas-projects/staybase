import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Check, X, ShoppingBag, CalendarCheck, CalendarX, CreditCard, MessageSquareText, Inbox, Wallet } from "lucide-react";
import { useAdmin } from "../context/AdminContext";
import { useBreakpoint } from "../utils/useBreakpoint";
import { Drawer } from "./Drawer";
import type { Notification, NotificationType } from "@spark-inn/shared";

// Per Phase 12 — Notification Center (decision #120): header
// bell + live panel listing recent operational events. On
// desktop the panel is a small dropdown anchored to the
// bell; on mobile (<768px) it renders inside the shared
// full-screen Drawer (per ADMIN-MOBILE.md). Read state is
// per-staff via the `readBy` map on each `notifications`
// doc; "Mark all as read" stamps my UID into every
// currently-loaded unread doc.

const NOTIFICATION_TYPE_META: Record<NotificationType, {
  label: string;
  icon: typeof Bell;
  bgClass: string;
  iconClass: string;
}> = {
  booking: { label: "Booking", icon: CalendarCheck, bgClass: "bg-primary/10", iconClass: "text-primary" },
  payment: { label: "Payment", icon: CreditCard, bgClass: "bg-emerald-50", iconClass: "text-emerald-600" },
  message: { label: "Message", icon: MessageSquareText, bgClass: "bg-blue-50", iconClass: "text-blue-600" },
  arrival: { label: "Arrival", icon: CalendarCheck, bgClass: "bg-amber-50", iconClass: "text-amber-600" },
  departure: { label: "Departure", icon: CalendarX, bgClass: "bg-violet-50", iconClass: "text-violet-600" },
  "store-order": { label: "Store order", icon: ShoppingBag, bgClass: "bg-rose-50", iconClass: "text-rose-600" },
  // Per CRL-08 (2026-08-03, per decision #174):
  // the cancellation-refund surface. The wallet
  // icon + amber palette signal "money to
  // process" — the desk sees this when a
  // destructive cancel stamps a non-null
  // `cancellationLiability` (the bell alert
  // says "Cancellation refund pending —
  // SI-…(Pending refund, ₱1500)") and on
  // each state-change transition (e.g.
  // "Refund partially refunded — SI-…
  // (pending-processing → partially-processed)").
  "cancellation-refund": { label: "Cancellation refund", icon: Wallet, bgClass: "bg-amber-50", iconClass: "text-amber-600" }
};

const PANEL_DESKTOP_WIDTH = 380;

function formatRelative(date: Date): string {
  const now = Date.now();
  const ms = now - date.getTime();
  if (ms < 0) return "just now";
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return date.toLocaleDateString();
}

function resolveDeepLink(n: Notification): { path: string; open: "drawer" | "tab" } | null {
  switch (n.entityType) {
    case "booking":
      return { path: `/bookings?bookingId=${encodeURIComponent(n.entityId)}`, open: "drawer" };
    case "storeOrder":
      // The store-order list + drawer live inside the
      // Bookings page's "store" tab (see
      // `BookingsPage.tsx` `activeMainTab`). Deep-link to
      // `?tab=store&orderId=...` so the page opens the
      // matching order drawer.
      return { path: `/bookings?tab=store&orderId=${encodeURIComponent(n.entityId)}`, open: "tab" };
    case "intercom":
      return { path: `/intercom?room=${encodeURIComponent(n.entityId)}`, open: "tab" };
    default:
      return null;
  }
}

export function NotificationBell() {
  const {
    notifications,
    notificationsLoading,
    unreadNotificationCount,
    currentUser,
    markNotificationRead,
    markAllNotificationsRead
  } = useAdmin();
  const { isMobile } = useBreakpoint();
  const navigate = useNavigate();

  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const bellButtonRef = useRef<HTMLButtonElement | null>(null);
  const desktopPanelRef = useRef<HTMLDivElement | null>(null);

  // Close the desktop dropdown on outside-click + Escape.
  useEffect(() => {
    if (isMobile || !isPanelOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (bellButtonRef.current?.contains(target)) return;
      if (desktopPanelRef.current?.contains(target)) return;
      setIsPanelOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsPanelOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isMobile, isPanelOpen]);

  const handleSelect = useCallback(async (n: Notification) => {
    const link = resolveDeepLink(n);
    if (link) navigate(link.path);
    setIsPanelOpen(false);
    await markNotificationRead(n.id);
  }, [navigate, markNotificationRead]);

  const handleMarkAll = useCallback(async () => {
    await markAllNotificationsRead();
  }, [markAllNotificationsRead]);

  const panelBody = (
    <NotificationPanelBody
      notifications={notifications}
      loading={notificationsLoading}
      unreadCount={unreadNotificationCount}
      currentUid={currentUser?.uid || ""}
      onSelect={handleSelect}
      onMarkAll={handleMarkAll}
    />
  );

  if (isMobile) {
    return (
      <>
        <button
          ref={bellButtonRef}
          type="button"
          onClick={() => setIsPanelOpen(true)}
          aria-label={`Notifications, ${unreadNotificationCount} unread`}
          aria-expanded={isPanelOpen}
          className="relative flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200"
          title="Notifications"
        >
          <Bell size={18} aria-hidden="true" />
          {unreadNotificationCount > 0 && (
            <span
              className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white"
              aria-hidden="true"
            >
              {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
            </span>
          )}
        </button>
        <Drawer
          open={isPanelOpen}
          onClose={() => setIsPanelOpen(false)}
          title="Notifications"
        >
          {panelBody}
        </Drawer>
      </>
    );
  }

  return (
    <div className="relative">
      <button
        ref={bellButtonRef}
        type="button"
        onClick={() => setIsPanelOpen((prev) => !prev)}
        aria-label={`Notifications, ${unreadNotificationCount} unread`}
        aria-expanded={isPanelOpen}
        aria-haspopup="dialog"
        className="relative flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200"
        title="Notifications"
      >
        <Bell size={18} aria-hidden="true" />
        {unreadNotificationCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white"
            aria-hidden="true"
          >
            {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
          </span>
        )}
      </button>
      {isPanelOpen && (
        <div
          ref={desktopPanelRef}
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-12 z-40 flex max-h-[80vh] w-[380px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-card-lg border border-gray-200 bg-white shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-gray-950">Notifications</h2>
              <p className="text-[10px] uppercase tracking-wider text-gray-500">
                {unreadNotificationCount} unread
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleMarkAll}
                disabled={unreadNotificationCount === 0}
                className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-[11px] font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check size={12} aria-hidden="true" />
                Mark all
              </button>
              <button
                type="button"
                onClick={() => setIsPanelOpen(false)}
                aria-label="Close notifications"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {panelBody}
          </div>
        </div>
      )}
    </div>
  );
}

function NotificationPanelBody({
  notifications,
  loading,
  unreadCount,
  currentUid,
  onSelect,
  onMarkAll
}: {
  notifications: Notification[];
  loading: boolean;
  unreadCount: number;
  currentUid: string;
  onSelect: (n: Notification) => void;
  onMarkAll: () => void;
}) {
  if (loading && notifications.length === 0) {
    return (
      <ul className="divide-y divide-gray-100" aria-busy="true" aria-live="polite">
        {Array.from({ length: 4 }).map((_, i) => (
          <li key={i} className="flex items-start gap-3 px-4 py-3">
            <div className="h-9 w-9 animate-pulse rounded-full bg-gray-100" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3 w-3/4 animate-pulse rounded bg-gray-100" />
              <div className="h-2.5 w-1/2 animate-pulse rounded bg-gray-100" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (notifications.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          <Inbox size={20} aria-hidden="true" />
        </div>
        <p className="text-sm font-bold text-gray-950">You're all caught up</p>
        <p className="max-w-xs text-xs leading-relaxed text-gray-500">
          Operational alerts (new bookings, payments, arrivals, departures, and store orders) will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-gray-100">
      {notifications.map((n) => (
        <NotificationRow
          key={n.id}
          notification={n}
          isUnread={!n.readBy[currentUid]}
          onSelect={onSelect}
        />
      ))}
      <li className="px-4 py-3">
        <button
          type="button"
          onClick={onMarkAll}
          disabled={unreadCount === 0}
          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[11px] font-bold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={12} aria-hidden="true" className="mr-1 inline" />
          Mark all as read
        </button>
      </li>
    </ul>
  );
}

function NotificationRow({
  notification,
  isUnread,
  onSelect
}: {
  notification: Notification;
  isUnread: boolean;
  onSelect: (n: Notification) => void;
}) {
  const meta = NOTIFICATION_TYPE_META[notification.type] || NOTIFICATION_TYPE_META.booking;
  const Icon = meta.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => void onSelect(notification)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-gray-50 focus:bg-gray-50 focus:outline-none"
      >
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${meta.bgClass} ${meta.iconClass}`}>
          <Icon size={16} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {meta.label}
            </span>
            {isUnread && (
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-primary"
                aria-label="Unread"
              />
            )}
            <span className="ml-auto text-[10px] text-gray-400">
              {formatRelative(notification.createdAt)}
            </span>
          </div>
          <p className={`mt-0.5 truncate text-sm ${isUnread ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}>
            {notification.title}
          </p>
        </div>
      </button>
    </li>
  );
}
