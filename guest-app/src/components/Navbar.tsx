import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { cn } from "../utils/cn";
import { PrimaryButton } from "./PrimaryButton";

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
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(!overHero);
  const solid = !overHero || isScrolled || isOpen;

  useEffect(() => {
    if (!overHero) return;

    const onScroll = () => setIsScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [overHero]);

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
        </div>

        <button
          aria-label="Toggle menu"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-900 md:hidden"
          type="button"
          onClick={() => setIsOpen((value) => !value)}
        >
          {isOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </nav>

      {isOpen ? (
        <div className="border-t border-gray-100 bg-white px-4 py-4 shadow-sm md:hidden">
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
          </div>
        </div>
      ) : null}
    </header>
  );
}
