import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, ShieldCheck, KeyRound, AlertCircle } from "lucide-react";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { useAdmin } from "../context/AdminContext";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, currentUser } = useAdmin();

  // Inputs
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // States
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Redirect if already logged in
  const from = (location.state as any)?.from?.pathname || "/";

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!email || !password) {
      setErrorMsg("Please fill in both email and password.");
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      // Simple validation for simulation
      if (email === "admin@sparkinn.com") {
        signIn(email, "admin");
        navigate(from, { replace: true });
      } else if (email === "frontdesk@sparkinn.com") {
        signIn(email, "front-desk");
        navigate(from, { replace: true });
      } else {
        setErrorMsg("Incorrect email or password. Try frontdesk@sparkinn.com or admin@sparkinn.com.");
      }
    }, 1000);
  };

  const handleQuickLogin = (role: "front-desk" | "admin") => {
    setErrorMsg("");
    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      const email = role === "admin" ? "admin@sparkinn.com" : "frontdesk@sparkinn.com";
      signIn(email, role);
      navigate(from, { replace: true });
    }, 600);
  };

  const handleForgotPasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setErrorMsg("Please enter your email address to receive reset link.");
      return;
    }
    setErrorMsg("");
    setIsLoading(true);
    setTimeout(() => {
      setIsLoading(false);
      setResetSent(true);
    }, 800);
  };

  return (
    <main className="min-h-screen bg-gray-950 font-body text-gray-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background blurs */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary/10 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-[-10%] left-[-5%] w-[45%] h-[45%] bg-white/5 rounded-full blur-[90px] pointer-events-none -z-10" />

      {/* Main card */}
      <div className="w-full max-w-md bg-white rounded-card-lg shadow-xl border border-gray-800/10 p-8 sm:p-12 relative z-10 space-y-8">
        
        {/* Brand identity */}
        <div className="flex flex-col items-center text-center">
          <img
            src={brandAsset(config.logos.standard)}
            alt={config.brandName}
            className="h-12 w-auto object-contain"
          />
          <h1 className="font-heading text-3xl text-gray-950 tracking-tight lowercase mt-4">
            staff portal
          </h1>
          <p className="text-xs text-gray-500 mt-2">
            Authenticate to access the hotel reservation & admin deck.
          </p>
        </div>

        {errorMsg && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-xs text-red-700 flex gap-2.5 items-start">
            <AlertCircle size={16} className="shrink-0 text-red-600 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {!showForgotPassword ? (
          /* STANDARD LOGIN VIEW */
          <div className="space-y-6">
            <form onSubmit={handleLogin} className="space-y-4">
              <label className="grid gap-2 text-xs font-semibold text-gray-700">
                Email Address
                <span className="relative block">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Mail size={16} />
                  </span>
                  <input
                    type="email"
                    required
                    placeholder="name@sparkinn.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 pl-10 pr-3 text-sm font-medium text-gray-950 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary-light"
                  />
                </span>
              </label>

              <div className="grid gap-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-gray-700" htmlFor="pwd">Password</label>
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary hover:underline"
                    onClick={() => {
                      setErrorMsg("");
                      setShowForgotPassword(true);
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <span className="relative block">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Lock size={16} />
                  </span>
                  <input
                    id="pwd"
                    type={showPassword ? "text" : "password"}
                    required
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-gray-250 bg-gray-50/50 py-2 pl-10 pr-12 text-sm font-medium text-gray-950 outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary-light"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-primary transition"
                    onClick={() => setShowPassword(p => !p)}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </span>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className="min-h-[44px] w-full px-6 inline-flex items-center justify-center gap-2 rounded-lg bg-primary hover:bg-primary-dark active:scale-[0.98] text-sm font-semibold text-white shadow-sm transition-all"
                >
                  {isLoading ? "Authenticating..." : "Sign In"}
                </button>
              </div>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-gray-200"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-3 font-semibold text-gray-400">Quick Testing Links</span>
              </div>
            </div>

            {/* Quick access buttons */}
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => handleQuickLogin("front-desk")}
                disabled={isLoading}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-250 bg-white hover:bg-blue-50 hover:border-blue-300 text-xs font-bold text-gray-700 shadow-sm active:scale-95 transition"
              >
                <KeyRound size={14} className="text-blue-500" />
                Login Front Desk
              </button>
              <button
                type="button"
                onClick={() => handleQuickLogin("admin")}
                disabled={isLoading}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-250 bg-white hover:bg-red-50 hover:border-red-300 text-xs font-bold text-gray-700 shadow-sm active:scale-95 transition"
              >
                <ShieldCheck size={14} className="text-red-500" />
                Login Admin
              </button>
            </div>
          </div>
        ) : (
          /* FORGOT PASSWORD VIEW */
          <div className="space-y-6">
            {resetSent ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-xs text-green-700">
                  <p className="font-bold">Reset Email Dispatched</p>
                  <p className="mt-1">Check your email {email} for instructions to reset your password (simulated).</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setResetSent(false);
                    setShowForgotPassword(false);
                  }}
                  className="w-full min-h-[44px] inline-flex items-center justify-center rounded-lg border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Return to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPasswordSubmit} className="space-y-4">
                <label className="grid gap-2 text-xs font-semibold text-gray-700">
                  Enter Account Email
                  <span className="relative block">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Mail size={16} />
                    </span>
                    <input
                      type="email"
                      required
                      placeholder="name@sparkinn.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="min-h-[44px] w-full rounded-lg border border-gray-255 bg-gray-50/50 py-2 pl-10 pr-3 text-sm font-medium text-gray-990 outline-none transition focus:border-primary focus:bg-white"
                    />
                  </span>
                </label>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMsg("");
                      setShowForgotPassword(false);
                    }}
                    className="flex-1 min-h-[44px] inline-flex items-center justify-center rounded-lg border border-gray-200 text-xs font-bold text-gray-700 hover:bg-gray-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-[2] min-h-[44px] rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm flex items-center justify-center transition"
                  >
                    Send Reset Link
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
