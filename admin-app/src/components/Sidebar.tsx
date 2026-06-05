import { VERSION } from "@spark-inn/shared";
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
  Users
} from "lucide-react";
import { NavLink } from "react-router-dom";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { cn } from "../utils/cn";

const navItems = [
  { label: "Dashboard", to: "/", icon: Home },
  { label: "Bookings", to: "/bookings", icon: CalendarDays },
  { label: "Rooms", to: "/rooms", icon: BedDouble },
  { label: "Rates", to: "/rates", icon: Tag },
  { label: "Reports", to: "/reports", icon: BarChart3 },
  { label: "Corporate", to: "/corporate", icon: Users },
  { label: "Intercom", to: "/intercom", icon: MessageSquare },
  { label: "QR", to: "/qr", icon: QrCode },
  { label: "Members", to: "/members", icon: Award },
  { label: "Settings", to: "/settings", icon: Settings }
];

export function Sidebar() {
  return (
    <aside className="flex min-h-screen w-60 shrink-0 flex-col bg-sidebar px-4 py-5 text-white">
      <img src={brandAsset(config.logos.white)} alt={config.brandName} className="h-14 w-auto object-contain object-left" />
      <nav className="mt-8 grid gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium transition",
                  isActive ? "bg-primary text-white" : "text-gray-300 hover:bg-white/10 hover:text-white"
                )
              }
            >
              <Icon size={18} />
              {item.label}
            </NavLink>
          );
        })}
      </nav>
      <p className="mt-auto px-3 text-xs text-gray-400">{config.brandName} v{VERSION}</p>
    </aside>
  );
}
