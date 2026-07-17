import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { useAdmin } from "../context/AdminContext";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { authLoading, currentUser, sendPasswordReset, signIn } = useAdmin();

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

  useEffect(() => {
    if (currentUser) {
      navigate(from, { replace: true });
    }
  }, [currentUser, from, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");

    if (!email || !password) {
      setErrorMsg("Please fill in both email and password.");
      return;
    }

    setIsLoading(true);
    try {
      await signIn(email, password);
      navigate(from, { replace: true });
    } catch (error) {
      setErrorMsg(getAuthErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setErrorMsg("Please enter your email address to receive reset link.");
      return;
    }
    setErrorMsg("");
    setIsLoading(true);
    try {
      await sendPasswordReset(email);
      setResetSent(true);
    } catch (error) {
      setErrorMsg(getPasswordResetErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const isSubmitting = isLoading || authLoading;

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
              <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                Email Address
                <span className="relative block">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Mail size={16} />
                  </span>
                  <input
                    type="email"
                    required
                    placeholder={`name@${config.domain}`}
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
                  disabled={isSubmitting}
                  className="min-h-[44px] w-full px-6 inline-flex items-center justify-center gap-2 rounded-lg bg-primary hover:bg-primary-dark active:scale-[0.98] text-sm font-semibold text-white shadow-sm transition-all"
                >
                  {isSubmitting ? "Authenticating..." : "Sign In"}
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* FORGOT PASSWORD VIEW */
          <div className="space-y-6">
            {resetSent ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-xs text-green-700">
                  <p className="font-bold">Reset Email Dispatched</p>
                  <p className="mt-1">Check your email for instructions to reset your password.</p>
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
                <label className="flex flex-col gap-2 text-xs font-semibold text-gray-700">
                  Enter Account Email
                  <span className="relative block">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Mail size={16} />
                    </span>
                    <input
                      type="email"
                      required
                      placeholder={`name@${config.domain}`}
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
                    disabled={isSubmitting}
                    className="flex-[2] min-h-[44px] rounded-lg bg-primary hover:bg-primary-dark text-xs font-semibold text-white shadow-sm flex items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isSubmitting ? "Sending..." : "Send Reset Link"}
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

function getAuthErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

  if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found") {
    return "Incorrect email or password.";
  }

  if (code === "auth/too-many-requests") {
    return "Too many sign-in attempts. Please wait a moment, then try again.";
  }

  if (code === "auth/network-request-failed") {
    return "Unable to connect. Check your internet connection.";
  }

  if (code === "auth/user-disabled") {
    return "This staff account has been disabled. Please contact the administrator.";
  }

  return "Unable to sign in right now. Please check your details and try again.";
}

function getPasswordResetErrorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

  if (code === "auth/user-not-found" || code === "auth/invalid-email") {
    return "No account found with that email.";
  }

  if (code === "auth/network-request-failed") {
    return "Unable to connect. Check your internet connection.";
  }

  return "Unable to send the reset link right now. Please try again.";
}
