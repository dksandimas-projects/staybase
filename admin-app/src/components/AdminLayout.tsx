import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Lock, LogOut, ShieldAlert, User, Shield } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { useAdmin } from "../context/AdminContext";

export function AdminLayout() {
  const { currentUser, signOut } = useAdmin();
  const location = useLocation();

  // Guard: Redirect to login if not logged in
  if (!currentUser) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  // Define restricted paths
  const restrictedPaths = ["/rates", "/members", "/settings"];
  const isPathRestricted = restrictedPaths.includes(location.pathname);
  const isUserRestricted = currentUser.role !== "admin";

  return (
    <div className="flex min-h-screen bg-gray-50 font-body text-gray-900">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header Navbar */}
        <header className="bg-white border-b border-gray-200 px-8 py-4 flex justify-between items-center z-10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 capitalize">
              Operational Dashboard
            </span>
          </div>

          {/* User Profile Info & Sign Out */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <User size={16} />
              </div>
              <div className="text-left hidden sm:block">
                <p className="text-xs font-bold text-gray-900 leading-none">{currentUser.email}</p>
                <span className={`inline-flex items-center gap-0.5 mt-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                  currentUser.role === "admin" ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"
                }`}>
                  {currentUser.role === "admin" ? "Admin" : "Front Desk"}
                </span>
              </div>
            </div>

            <div className="h-6 w-px bg-gray-200" />

            <button
              onClick={signOut}
              className="min-h-[36px] px-3.5 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white hover:bg-red-50 hover:text-red-600 text-xs font-bold text-gray-600 transition"
              title="Sign Out"
            >
              <LogOut size={14} />
              Sign Out
            </button>
          </div>
        </header>

        {/* Content Body Container */}
        <main className="flex-1 overflow-y-auto p-8 min-h-0">
          {isPathRestricted && isUserRestricted ? (
            /* Restricted Route Access Denied Overlay */
            <div className="h-full flex items-center justify-center">
              <div className="w-full max-w-md bg-white rounded-card-lg border border-gray-200 p-8 shadow-sm text-center space-y-6">
                <div className="h-16 w-16 rounded-full bg-red-50 flex items-center justify-center text-red-500 mx-auto ring-4 ring-red-100">
                  <Lock size={32} />
                </div>
                <div className="space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-red-600">Access Denied</span>
                  <h2 className="font-heading text-3xl text-gray-950 lowercase">Administrative Clearance Required</h2>
                  <p className="text-xs text-gray-650 leading-relaxed max-w-xs mx-auto">
                    The requested page contains settings reserved exclusively for Administrators. Please log in with admin privileges to proceed.
                  </p>
                </div>
                <div className="rounded-lg bg-gray-50 border border-gray-150 p-4 text-[10px] text-gray-500 text-left space-y-1.5">
                  <p className="font-bold flex items-center gap-1">
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
    </div>
  );
}
