import { LogIn, LogOut, BedDouble, Settings, Bell, type LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../utils/cn";
import { useBreakpoint } from "../utils/useBreakpoint";

interface TabSpec {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
}

const BASE_TABS: TabSpec[] = [
  { id: "arrivals", label: "Arrivals", path: "/bookings?filter=arrivals", icon: LogIn },
  { id: "departures", label: "Departures", path: "/bookings?filter=departures", icon: LogOut },
  { id: "in-house", label: "In-House", path: "/bookings?filter=in-house", icon: BedDouble }
];

const ALERTS_TAB: TabSpec = { id: "alerts", label: "Alerts", path: "/intercom", icon: Bell };
const SETTINGS_TAB: TabSpec = { id: "settings", label: "Settings", path: "/settings", icon: Settings };

interface BottomTabBarProps {
  variant?: "bookings" | "settings";
  unreadAlertCount?: number;
}

export function BottomTabBar({ variant = "bookings", unreadAlertCount = 0 }: BottomTabBarProps) {
  const { isMobile } = useBreakpoint();
  const location = useLocation();
  const navigate = useNavigate();

  if (!isMobile) return null;

  const lastTab = variant === "settings" ? SETTINGS_TAB : ALERTS_TAB;
  const tabs = [...BASE_TABS, lastTab];

  const isActive = (tab: TabSpec) => {
    if (tab.path === location.pathname) return true;
    const [basePath, query] = tab.path.split("?");
    if (location.pathname !== basePath) return false;
    if (!query) return true;
    const currentParams = new URLSearchParams(location.search);
    const tabParams = new URLSearchParams(query);
    return tabParams.get("filter") === currentParams.get("filter");
  };

  return (
    <nav
      role="tablist"
      aria-label="Quick operational navigation"
      className="fixed inset-x-0 bottom-0 z-20 grid border-t border-gray-200 bg-white"
      style={{
        gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`,
        paddingBottom: "env(safe-area-inset-bottom)"
      }}
    >
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = isActive(tab);
        const showBadge = tab.id === "alerts" && unreadAlertCount > 0;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={active ? "page" : undefined}
            data-active={active}
            onClick={() => navigate(tab.path)}
            className={cn(
              "relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[10px] font-semibold transition",
              active ? "bg-primary text-white" : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            <span className="relative">
              <Icon size={18} aria-hidden="true" />
              {showBadge ? (
                <span
                  className="absolute -right-1.5 -top-0.5 inline-flex h-2 w-2 rounded-full bg-primary ring-2 ring-white"
                  aria-label={`${unreadAlertCount} unread`}
                />
              ) : null}
            </span>
            <span className="truncate">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
