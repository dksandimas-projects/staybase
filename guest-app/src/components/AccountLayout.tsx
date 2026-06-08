import { ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useNavigate, Navigate } from "react-router-dom";
import { User, Calendar, Star, LogOut, ChevronRight } from "lucide-react";
import config from "@config";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { cn } from "../utils/cn";

interface AccountLayoutProps {
  children: ReactNode;
  activeTab: "profile" | "stays" | "rewards";
  title: string;
  subtitle: string;
}

export function AccountLayout({ children, activeTab, title, subtitle }: AccountLayoutProps) {
  const navigate = useNavigate();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  // Auth check
  useEffect(() => {
    const authState = sessionStorage.getItem("sim_auth_state");
    if (authState === "logged-in-member") {
      setIsAuthenticated(true);
    } else {
      setIsAuthenticated(false);
    }
  }, []);

  const handleSignOut = () => {
    sessionStorage.removeItem("sim_auth_state");
    navigate("/rewards");
  };

  // Redirect to signin if not authenticated
  if (isAuthenticated === false) {
    return <Navigate to="/signin" replace />;
  }

  // Loading state
  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-body">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="mt-4 text-sm text-gray-500 font-medium">Securing session...</p>
        </div>
      </div>
    );
  }

  const navItems = [
    { id: "profile", label: "Profile", to: "/account/profile", icon: <User size={18} /> },
    { id: "stays", label: "My Stays", to: "/account/stays", icon: <Calendar size={18} /> },
    { id: "rewards", label: "My Rewards", to: "/account/rewards", icon: <Star size={18} /> }
  ];

  return (
    <main className="min-h-screen bg-gray-50 font-body text-gray-900 flex flex-col justify-between">
      <div>
        <Navbar />

        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
            {/* Sidebar navigation */}
            <aside className="w-full lg:sticky lg:top-28 lg:self-start z-20">
              {/* Desktop Sidebar */}
              <nav className="hidden lg:flex flex-col gap-2 rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200">
                {navItems.map((item) => (
                  <Link
                    key={item.id}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm transition-all group",
                      activeTab === item.id
                        ? "bg-primary text-white shadow-sm"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-950"
                    )}
                  >
                    <span className={activeTab === item.id ? "text-white" : "text-primary"}>
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                ))}
                <div className="mt-6 pt-6 border-t border-gray-150">
                  <button
                    onClick={handleSignOut}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm text-red-600 hover:bg-red-50 transition-all text-left"
                  >
                    <LogOut size={18} className="text-red-500" />
                    Sign Out
                  </button>
                </div>
              </nav>

              {/* Mobile horizontal tabs row */}
              <nav className="flex lg:hidden overflow-x-auto rounded-card bg-white p-2 shadow-sm ring-1 ring-gray-200 gap-1.5 scrollbar-none">
                {navItems.map((item) => (
                  <Link
                    key={item.id}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-xs transition whitespace-nowrap shrink-0",
                      activeTab === item.id
                        ? "bg-primary text-white"
                        : "text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                ))}
                <div className="w-px bg-gray-150 mx-1 shrink-0" />
                <button
                  onClick={handleSignOut}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-xs text-red-600 hover:bg-red-50 transition whitespace-nowrap shrink-0"
                >
                  <LogOut size={14} className="text-red-500" />
                  Sign Out
                </button>
              </nav>
            </aside>

            {/* Right page content area */}
            <section className="flex-1">
              <header className="mb-8">
                <h1 className="font-heading text-3xl text-gray-950 sm:text-4xl">{title}</h1>
                <p className="text-sm text-gray-600 mt-2">{subtitle}</p>
              </header>

              <div className="min-h-[40vh]">{children}</div>
            </section>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}
