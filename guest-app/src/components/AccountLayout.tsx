import { type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { User, Calendar, Star, LogOut } from "lucide-react";
import config from "@config";
import { Navbar } from "./Navbar";
import { Footer } from "./Footer";
import { cn } from "../utils/cn";
import { useGuestAuth } from "../context/GuestAuthContext";

interface AccountLayoutProps {
  children: ReactNode;
  activeTab: "profile" | "stays" | "rewards";
  title: string;
  subtitle: string;
}

export function AccountLayout({ children, activeTab, title, subtitle }: AccountLayoutProps) {
  const { user, memberProfile, loading, signOut } = useGuestAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-body">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mx-auto"></div>
          <p className="mt-4 text-sm text-gray-500 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/signin" replace />;
  }

  if (memberProfile?.isActive === false) {
    return <Navigate to="/contact?member=disabled" replace />;
  }

  const navItems = [
    { id: "profile", label: "Profile", mobileLabel: "Profile", to: "/account/profile", icon: <User size={18} /> },
    { id: "stays", label: "My Stays", mobileLabel: "Stays", to: "/account/stays", icon: <Calendar size={18} /> },
    { id: "rewards", label: "My Rewards", mobileLabel: "Rewards", to: "/account/rewards", icon: <Star size={18} /> }
  ];

  return (
    <main className="min-h-screen min-w-0 bg-gray-50 font-body text-gray-900 flex flex-col justify-between">
      <div>
        <Navbar />

        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="grid min-w-0 gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
            <aside className="z-20 w-full min-w-0 max-w-full lg:sticky lg:top-28 lg:self-start">
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
                    onClick={signOut}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg font-semibold text-sm text-red-600 hover:bg-red-50 transition-all text-left"
                  >
                    <LogOut size={18} className="text-red-500" />
                    Sign Out
                  </button>
                </div>
              </nav>

              <nav aria-label="Account navigation" className="grid w-full min-w-0 grid-cols-4 gap-1 rounded-card bg-white p-2 shadow-sm ring-1 ring-gray-200 lg:hidden">
                {navItems.map((item) => (
                  <Link
                    key={item.id}
                    to={item.to}
                    aria-current={activeTab === item.id ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[10px] font-semibold leading-none transition sm:text-xs",
                      activeTab === item.id
                        ? "bg-primary text-white"
                        : "text-gray-600 hover:bg-gray-50"
                    )}
                  >
                    {item.icon}
                    <span className="max-w-full truncate">{item.mobileLabel}</span>
                  </Link>
                ))}
                <button
                  type="button"
                  onClick={signOut}
                  className="flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-[10px] font-semibold leading-none text-red-600 transition hover:bg-red-50 sm:text-xs"
                >
                  <LogOut size={18} className="text-red-500" />
                  <span className="max-w-full truncate">Sign out</span>
                </button>
              </nav>
            </aside>

            <section className="min-w-0 max-w-full flex-1">
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
