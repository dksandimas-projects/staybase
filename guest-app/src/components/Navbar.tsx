import { Menu, X, User, ChevronDown, LogOut, Award, History, UserCircle } from "lucide-react";
import { useEffect, useState, useRef } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { cn } from "../utils/cn";
import { PrimaryButton } from "./PrimaryButton";
import { useGuestAuth } from "../context/GuestAuthContext";

const navItems = [
  { label: "Rooms", to: "/rooms" },
  { label: "Corporate", to: "/corporate" },
  { label: "Rewards", to: "/rewards" },
  { label: "Contact", to: "/contact" }
];

interface NavbarProps {
  overHero?: boolean;
}

export function Navbar({ overHero = false }: NavbarProps) {
  const location = useLocation();
  const { user, memberProfile, signOut } = useGuestAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(!overHero);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const solid = !overHero || isScrolled || isOpen;

  useEffect(() => {
    if (!overHero) return;
    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overHero]);

  useEffect(() => {
    setIsOpen(false);
    setShowDropdown(false);
  }, [location.pathname]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  const handleSignOut = async () => {
    setShowDropdown(false);
    await signOut();
  };

  const displayName = memberProfile?.fullName || user?.displayName || user?.email?.split("@")[0] || "Member";

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition",
        solid ? "bg-white/95 shadow-sm backdrop-blur" : "bg-transparent"
      )}
    >
      <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center">
          <img src={brandAsset(config.logos.navbar)} alt={config.brandName} className="h-10 w-auto object-contain" />
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "text-sm font-medium transition",
                  isActive ? "text-primary" : solid ? "text-gray-700 hover:text-primary" : "text-white hover:text-primary-light"
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
          <PrimaryButton to="/book">Book now</PrimaryButton>

          {/* Member state */}
          {user ? (
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowDropdown((v) => !v)}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition",
                  solid ? "text-gray-700 hover:bg-gray-100" : "text-white hover:bg-white/10"
                )}
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white text-xs font-bold">
                  {displayName.charAt(0).toUpperCase()}
                </span>
                <span className="hidden lg:inline max-w-[100px] truncate">{displayName}</span>
                <ChevronDown size={14} className={cn("transition", showDropdown && "rotate-180")} />
              </button>

              {showDropdown && (
                <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-gray-200 bg-white py-2 shadow-lg z-50">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-xs font-bold text-gray-900 truncate">{displayName}</p>
                    {memberProfile?.memberNumber && (
                      <p className="text-[10px] text-primary font-semibold">{memberProfile.memberNumber}</p>
                    )}
                  </div>
                  <Link
                    to="/account/profile"
                    className="flex items-center gap-2.5 px-4 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-primary transition"
                  >
                    <UserCircle size={14} />
                    My Profile
                  </Link>
                  <Link
                    to="/account/stays"
                    className="flex items-center gap-2.5 px-4 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-primary transition"
                  >
                    <History size={14} />
                    My Stays
                  </Link>
                  <Link
                    to="/account/rewards"
                    className="flex items-center gap-2.5 px-4 py-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-primary transition"
                  >
                    <Award size={14} />
                    My Rewards
                    {memberProfile?.rewardsPoints != null && memberProfile.rewardsPoints > 0 && (
                      <span className="ml-auto rounded-full bg-primary-light px-2 py-0.5 text-[9px] font-bold text-primary">
                        {memberProfile.rewardsPoints} pts
                      </span>
                    )}
                  </Link>
                  <div className="border-t border-gray-100 mt-1 pt-1">
                    <button
                      type="button"
                      onClick={handleSignOut}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs font-medium text-gray-700 hover:bg-red-50 hover:text-red-600 transition"
                    >
                      <LogOut size={14} />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              to="/signin"
              className={cn(
                "text-sm font-medium transition",
                solid ? "text-gray-700 hover:text-primary" : "text-white hover:text-primary-light"
              )}
            >
              Sign in
            </Link>
          )}
        </div>

        <button
          aria-controls="guest-mobile-menu"
          aria-expanded={isOpen}
          aria-label="Toggle menu"
          className={cn(
            "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg transition md:hidden",
            solid ? "text-gray-900 hover:bg-gray-100" : "text-white hover:bg-white/10"
          )}
          type="button"
          onClick={() => setIsOpen((value) => !value)}
        >
          {isOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      {isOpen ? (
        <div id="guest-mobile-menu" className="border-t border-gray-100 bg-white px-4 py-4 shadow-sm md:hidden">
          <div className="flex flex-col gap-2">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn("rounded-lg px-3 py-3 text-sm font-medium", isActive ? "bg-primary-light text-primary" : "text-gray-700")
                }
                onClick={() => setIsOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
            <PrimaryButton to="/book" onClick={() => setIsOpen(false)}>
              Book now
            </PrimaryButton>

            {/* Mobile member state */}
            {user ? (
              <>
                <div className="border-t border-gray-100 pt-3 mt-2">
                  <p className="px-3 text-xs font-bold text-gray-900 mb-2">{displayName}</p>
                  {memberProfile?.memberNumber && (
                    <p className="px-3 text-[10px] text-primary font-semibold mb-2">{memberProfile.memberNumber}</p>
                  )}
                </div>
                <Link
                  to="/account/profile"
                  className="rounded-lg px-3 py-3 text-sm font-medium text-gray-700"
                  onClick={() => setIsOpen(false)}
                >
                  My Profile
                </Link>
                <Link
                  to="/account/stays"
                  className="rounded-lg px-3 py-3 text-sm font-medium text-gray-700"
                  onClick={() => setIsOpen(false)}
                >
                  My Stays
                </Link>
                <Link
                  to="/account/rewards"
                  className="rounded-lg px-3 py-3 text-sm font-medium text-gray-700"
                  onClick={() => setIsOpen(false)}
                >
                  My Rewards
                </Link>
                <button
                  type="button"
                  onClick={async () => { setIsOpen(false); await signOut(); }}
                  className="rounded-lg px-3 py-3 text-sm font-medium text-left text-gray-700"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <Link
                to="/signin"
                className="rounded-lg px-3 py-3 text-sm font-medium text-gray-700"
                onClick={() => setIsOpen(false)}
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
