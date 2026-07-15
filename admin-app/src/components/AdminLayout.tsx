import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Check, Lock, LogOut, MessageSquareText, PhoneCall, PhoneOff, Shield, User, Menu, Volume2, VolumeX, X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { BottomTabBar } from "./BottomTabBar";
import { NotificationBell } from "./NotificationBell";
import { ToastProvider } from "./Toast";
import { useAdmin } from "../context/AdminContext";
import { useBreakpoint } from "../utils/useBreakpoint";
import { useEffect, useMemo, useState } from "react";
import config from "@config";

type LatestUnreadIntercomMessage = {
  roomNumber: string;
  id: string;
  text: string;
  guestName: string;
};

export function AdminLayout() {
  const {
    authLoading,
    currentUser,
    signOut,
    intercoms,
    soundsEnabled,
    setSoundsEnabled,
    incomingCall,
    acceptCall,
    declineCall,
    markChatAsRead
  } = useAdmin();
  const location = useLocation();
  const navigate = useNavigate();
  const { isMobile } = useBreakpoint();

  const [isMobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [dismissedMessageId, setDismissedMessageId] = useState("");

  const unreadAlertCount = useMemo(
    () => Object.values(intercoms)
      .flat()
      .filter((m) => m.sender === "guest" && !m.isRead)
      .length,
    [intercoms]
  );

  const bottomTabVariant = location.pathname === "/settings" ? "settings" : "bookings";
  const normalizedPath = location.pathname.toLowerCase().replace(/\/+$/, "") || "/";
  const isIntercomRoute = normalizedPath === "/intercom";
  const latestUnreadMessage = useMemo<LatestUnreadIntercomMessage | null>(() => {
    let latest: LatestUnreadIntercomMessage | null = null;
    Object.entries(intercoms).forEach(([roomNumber, messages]) => {
      messages.forEach((message) => {
        if (message.sender !== "guest" || message.isRead) return;
        latest = {
          roomNumber,
          id: message.id,
          text: message.text,
          guestName: message.guestName || "Guest"
        };
      });
    });
    return latest;
  }, [intercoms]);
  const shouldShowMessagePopup = !!latestUnreadMessage && latestUnreadMessage.id !== dismissedMessageId && !isIntercomRoute;
  const shouldShowCallPopup = !!incomingCall && !isIntercomRoute;

  useEffect(() => {
    if (!isMobile && isMobileSidebarOpen) {
      setMobileSidebarOpen(false);
    }
  }, [isMobile, isMobileSidebarOpen]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 font-body text-gray-900">
        <div className="w-full max-w-sm rounded-card-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto h-12 w-12 rounded-full bg-primary-light" />
          <p className="mt-5 text-sm font-semibold text-gray-950">Checking staff session...</p>
          <p className="mt-2 text-xs leading-5 text-gray-500">Preparing the dashboard.</p>
        </div>
      </div>
    );
  }

  // Guard: Redirect to login if not logged in
  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Define restricted paths
  const restrictedPaths = ["/rates", "/members", "/settings"];
  const isPathRestricted = restrictedPaths.includes(normalizedPath);
  const isUserRestricted = currentUser.role !== "admin";

  return (
    <ToastProvider>
    <div className="flex min-h-screen bg-gray-50 font-body text-gray-900">
      {/* Sidebar Navigation — three-mode responsive per ADMIN-MOBILE.md */}
      <Sidebar
        isOpen={isMobileSidebarOpen}
        onClose={() => setMobileSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header Navbar — responsive per ADMIN-MOBILE.md §Header
            Mobile:   [☰] [spark inn wordmark] [contextual action]
            Tablet+:  [☰ or full nav] [page label] [avatar + role] [Sign Out] */}
        <header
          className="sticky top-0 z-30 flex shrink-0 items-center justify-between gap-2 border-b border-gray-200 bg-white sm:px-6 sm:py-4 lg:px-8"
          style={{
            paddingTop: isMobile ? "max(0.75rem, env(safe-area-inset-top))" : undefined,
            paddingLeft: isMobile ? "max(1rem, env(safe-area-inset-left))" : undefined,
            paddingRight: isMobile ? "max(1rem, env(safe-area-inset-right))" : undefined,
            paddingBottom: isMobile ? "0.75rem" : undefined
          }}
        >
          {/* Left zone */}
          <div className="flex min-w-0 items-center gap-2">
            {isMobile ? (
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open navigation menu"
                aria-expanded={isMobileSidebarOpen}
                aria-controls="admin-sidebar"
                className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-gray-700 hover:bg-gray-100 active:bg-gray-200"
              >
                <Menu size={20} aria-hidden="true" />
              </button>
            ) : (
              <span className="truncate text-xs font-semibold capitalize text-gray-500">
                Operational Dashboard
              </span>
            )}
          </div>

          {/* Center zone — mobile wordmark per Stitch design */}
          {isMobile && (
            <span
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 font-heading text-lg font-semibold text-primary"
              aria-hidden="true"
            >
              {config.brandName}
            </span>
          )}

          {/* Right zone */}
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Per Phase 12 — Notification Center (decision
                #120): the bell is reachable from every admin
                page (lives in the shared header) and surfaces
                the persistent event log so staff know what
                rang. The sound mute button below is unchanged. */}
            <NotificationBell />

            <button
              type="button"
              onClick={() => setSoundsEnabled(!soundsEnabled)}
              aria-label={soundsEnabled ? "Mute notifications" : "Unmute notifications"}
              className="flex h-11 w-11 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-100 hover:text-gray-900 active:bg-gray-200"
              title={soundsEnabled ? "Mute Sounds" : "Unmute Sounds"}
            >
              {soundsEnabled ? <Volume2 size={18} aria-hidden="true" /> : <VolumeX size={18} aria-hidden="true" />}
            </button>

            {isMobile ? (
              <button
                type="button"
                onClick={() => void signOut()}
                aria-label="Account and sign out"
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-primary/10 text-primary active:bg-primary/20"
                title="Sign out"
              >
                <User size={18} aria-hidden="true" />
              </button>
            ) : (
              <>
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                    <User size={16} aria-hidden="true" />
                  </div>
                  <div className="hidden text-left sm:block">
                    <p className="text-xs font-bold leading-none text-gray-900">{currentUser.email}</p>
                    <span className={`mt-1 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      currentUser.role === "admin" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
                    }`}>
                      {currentUser.role === "admin" ? "Admin" : "Front Desk"}
                    </span>
                  </div>
                </div>

                <div className="hidden h-6 w-px bg-gray-200 sm:block" />

                <button
                  onClick={() => void signOut()}
                  aria-label="Sign out"
                  className="flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3.5 text-xs font-bold text-gray-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                  title="Sign Out"
                >
                  <LogOut size={14} aria-hidden="true" />
                  <span>Sign Out</span>
                </button>
              </>
            )}
          </div>
        </header>

        {/* Content Body Container — responsive padding per ADMIN-MOBILE.md.
            On mobile, the bottom tab bar is 56px tall + safe-area-inset-bottom,
            so we add that much padding so the last row of content is not
            hidden under the bar. */}
        <main
          className="relative min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8"
          style={{
            paddingBottom: isMobile
              ? "max(5rem, calc(56px + env(safe-area-inset-bottom) + 1rem))"
              : undefined
          }}
        >
          {(shouldShowCallPopup || shouldShowMessagePopup) && (
            <div className="pointer-events-none fixed right-4 top-[5rem] z-40 flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-3 sm:right-6">
              {shouldShowCallPopup && incomingCall && (
                <div className="pointer-events-auto rounded-card border border-green-200 bg-white p-4 shadow-xl ring-4 ring-green-100">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-600 text-white">
                      <PhoneCall size={18} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-green-700">
                        {incomingCall.status === "ringing" ? "Incoming call" : "Active call"}
                      </p>
                      <h2 className="mt-0.5 truncate text-sm font-bold text-gray-950">
                        Room {incomingCall.roomId} · {incomingCall.guestName || "Guest"}
                      </h2>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {incomingCall.status === "ringing" && (
                          <button
                            type="button"
                            onClick={() => void acceptCall()}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-green-600 px-3 text-xs font-bold text-white hover:bg-green-700"
                          >
                            <Check size={14} aria-hidden="true" />
                            Accept
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void declineCall()}
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-600 hover:bg-red-50"
                        >
                          <PhoneOff size={14} aria-hidden="true" />
                          {incomingCall.status === "ringing" ? "Decline" : "End"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {shouldShowMessagePopup && latestUnreadMessage && (
                <div className="pointer-events-auto rounded-card border border-primary/20 bg-white p-4 shadow-xl ring-4 ring-primary/10">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                      <MessageSquareText size={18} aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-primary-dark">New guest message</p>
                      <h2 className="mt-0.5 truncate text-sm font-bold text-gray-950">
                        Room {latestUnreadMessage.roomNumber} · {latestUnreadMessage.guestName}
                      </h2>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-gray-600">{latestUnreadMessage.text}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => navigate(`/intercom?room=${encodeURIComponent(latestUnreadMessage.roomNumber)}`)}
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-bold text-white hover:bg-primary-dark"
                        >
                          <MessageSquareText size={14} aria-hidden="true" />
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => void markChatAsRead(latestUnreadMessage.roomNumber)}
                          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-gray-700 hover:bg-gray-50"
                        >
                          <Check size={14} aria-hidden="true" />
                          Read
                        </button>
                        <button
                          type="button"
                          onClick={() => setDismissedMessageId(latestUnreadMessage.id)}
                          aria-label="Dismiss message alert"
                          className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                        >
                          <X size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {isPathRestricted && isUserRestricted ? (
            /* Restricted Route Access Denied Overlay */
            <div className="flex h-full items-center justify-center">
              <div className="w-full max-w-md space-y-6 rounded-card-lg border border-gray-200 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-red-500 ring-4 ring-red-100">
                  <Lock size={32} />
                </div>
                <div className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-red-600">Access Denied</span>
                  <h2 className="font-heading text-3xl lowercase text-gray-950">Administrative Clearance Required</h2>
                  <p className="mx-auto max-w-xs text-xs leading-relaxed text-gray-650">
                    The requested page contains settings reserved exclusively for Administrators. Please log in with admin privileges to proceed.
                  </p>
                </div>
                <div className="space-y-1.5 rounded-lg border border-gray-150 bg-gray-50 p-4 text-left text-[10px] text-gray-500">
                  <p className="flex items-center gap-1 font-bold">
                    <Shield size={12} className="text-red-500" />
                    Security Protocol Note:
                  </p>
                  <p>
                    Your current credentials ({currentUser.email}) hold the Front Desk role. Manual rates editing and member loyalty config audits are logged restricted routes.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            /* Standard Subroute Page Content */
            <Outlet />
          )}
        </main>
      </div>

      {/* Bottom tab bar — mobile-only, persists across pages (and inside
          drawers per Stitch mobile design). The variant switches between
          "bookings" and "settings" based on the current route. */}
      <BottomTabBar variant={bottomTabVariant} unreadAlertCount={unreadAlertCount} />
    </div>
    </ToastProvider>
  );
}
