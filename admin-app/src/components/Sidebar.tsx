import { VERSION, slideInLeft } from "@spark-inn/shared";
import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Award,
  BarChart3,
  BedDouble,
  CalendarDays,
  Home,
  MessageSquare,
  QrCode,
  Settings,
  Tag,
  Users,
  X
} from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { useAdmin } from "../context/AdminContext";
import { cn } from "../utils/cn";
import { useBreakpoint } from "../utils/useBreakpoint";
import { useFocusTrap } from "../utils/useFocusTrap";

const navItems = [
  { label: "Dashboard", to: "/", icon: Home },
  { label: "Bookings", to: "/bookings", icon: CalendarDays },
  { label: "Calendar", to: "/calendar", icon: CalendarDays },
  { label: "Rooms", to: "/rooms", icon: BedDouble },
  { label: "Rates", to: "/rates", icon: Tag },
  { label: "Reports", to: "/reports", icon: BarChart3 },
  { label: "Corporate", to: "/corporate", icon: Users },
  { label: "Intercom", to: "/intercom", icon: MessageSquare },
  { label: "QR", to: "/qr", icon: QrCode },
  { label: "Members", to: "/members", icon: Award },
  { label: "Settings", to: "/settings", icon: Settings }
];

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

interface NavContentProps {
  unreadIntercomCount: number;
  onClose?: () => void;
  showCloseButton: boolean;
  compact: boolean;
}

function NavContent({ unreadIntercomCount, onClose, showCloseButton, compact }: NavContentProps) {
  return (
    <>
      <div className={cn("flex items-center", compact ? "justify-center" : "justify-start")}>
        <img
          src={brandAsset(compact ? config.logos.icon : config.logos.white)}
          alt={config.brandName}
          className={cn("object-contain", compact ? "h-8 w-8" : "h-14 w-auto")}
        />
        {showCloseButton && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-300 hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        )}
      </div>

      <nav className={cn("mt-8 grid gap-1", compact && "mt-6")}>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              title={compact ? item.label : undefined}
              className={({ isActive }) =>
                cn(
                  "flex min-h-11 items-center rounded-lg text-sm font-medium transition",
                  compact ? "relative justify-center px-2" : "gap-3 px-3",
                  isActive ? "bg-primary text-white" : "text-gray-300 hover:bg-white/10 hover:text-white"
                )
              }
            >
              <Icon size={18} aria-hidden="true" />
              {!compact && <span className="flex-1">{item.label}</span>}
              {!compact && item.to === "/intercom" && unreadIntercomCount > 0 && (
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-white ring-1 ring-white/20">
                  {unreadIntercomCount > 99 ? "99+" : unreadIntercomCount}
                </span>
              )}
              {compact && item.to === "/intercom" && unreadIntercomCount > 0 && (
                <span className="absolute right-1.5 top-1.5 inline-flex h-2 w-2 rounded-full bg-primary ring-2 ring-sidebar" />
              )}
            </NavLink>
          );
        })}
      </nav>

      {!compact && (
        <p className="mt-auto px-3 text-xs text-gray-400">{config.brandName} v{VERSION}</p>
      )}
    </>
  );
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps = {}) {
  const { intercoms } = useAdmin();
  const { isMobile, isTablet } = useBreakpoint();
  const location = useLocation();
  const prefersReducedMotion = !!useReducedMotion();
  const prevPathnameRef = useRef(location.pathname);
  const trapRef = useFocusTrap<HTMLElement>(isOpen, () => onClose?.());

  const unreadIntercomCount = useMemo(
    () => Object.values(intercoms)
      .flat()
      .filter((message) => message.sender === "guest" && !message.isRead)
      .length,
    [intercoms]
  );

  useEffect(() => {
    if (!isMobile || !isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMobile, isOpen]);

  useEffect(() => {
    if (location.pathname === prevPathnameRef.current) return;
    prevPathnameRef.current = location.pathname;
    onClose?.();
  }, [location.pathname, onClose]);

  if (isMobile) {
    return (
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              key="sidebar-backdrop"
              initial={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-gray-950/50 backdrop-blur-sm"
              aria-hidden="true"
            />
            <motion.aside
              key="sidebar-panel"
              ref={trapRef}
              variants={prefersReducedMotion ? undefined : slideInLeft}
              initial="hidden"
              animate="visible"
              exit="exit"
              id="admin-sidebar"
              className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar px-4 py-5 text-white shadow-xl"
              role="dialog"
              aria-modal="true"
              aria-label="Main navigation"
            >
              <NavContent
                unreadIntercomCount={unreadIntercomCount}
                onClose={onClose}
                showCloseButton
                compact={false}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    );
  }

  if (isTablet) {
    return (
      <aside
        id="admin-sidebar"
        className="flex min-h-screen w-16 shrink-0 flex-col bg-sidebar px-2 py-5 text-white"
        aria-label="Main navigation"
      >
        <NavContent
          unreadIntercomCount={unreadIntercomCount}
          onClose={onClose}
          showCloseButton={false}
          compact
        />
      </aside>
    );
  }

  return (
    <aside
      id="admin-sidebar"
      className="flex min-h-screen w-60 shrink-0 flex-col bg-sidebar px-4 py-5 text-white"
      aria-label="Main navigation"
    >
      <NavContent
        unreadIntercomCount={unreadIntercomCount}
        onClose={onClose}
        showCloseButton={false}
        compact={false}
      />
    </aside>
  );
}
