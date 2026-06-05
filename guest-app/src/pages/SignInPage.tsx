import { useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Mail, Lock, Eye, EyeOff, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import config from "@config";
import { brandAsset } from "../utils/brand";
import { cn } from "../utils/cn";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { scaleIn } from "@spark-inn/shared";

export function SignInPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();

  // Inputs
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // States
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Show registration success banner if redirected
  const showRegisteredSuccess = searchParams.get("registered") === "true";

  const handleSignIn = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setInfoMessage("");

    if (!email || !password) {
      setErrorMsg("Please enter your email and password.");
      return;
    }

    setIsLoading(true);

    setTimeout(() => {
      setIsLoading(false);
      // Simulate successful auth
      sessionStorage.setItem("sim_auth_state", "logged-in-member");
      // Redirect to rewards landing page
      navigate("/rewards");
    }, 1200);
  };

  const handleGoogleSignIn = () => {
    setErrorMsg("");
    setInfoMessage("");
    setIsGoogleLoading(true);

    setTimeout(() => {
      setIsGoogleLoading(false);
      // Simulate successful auth
      sessionStorage.setItem("sim_auth_state", "logged-in-member");
      // Redirect
      navigate("/rewards");
    }, 1000);
  };

  const handleForgotPassword = () => {
    setErrorMsg("");
    setInfoMessage("");
    if (!email) {
      setErrorMsg("Please enter your email address first to reset password.");
      return;
    }
    setInfoMessage(`Password reset link sent to ${email} (simulated).`);
  };

  return (
    <main className="min-h-screen bg-section-bg font-body text-gray-900 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background blurs */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] bg-primary-light/50 rounded-full blur-[100px] pointer-events-none -z-10" />
      <div className="absolute bottom-[-10%] left-[-5%] w-[45%] h-[45%] bg-primary/5 rounded-full blur-[90px] pointer-events-none -z-10" />

      {/* Main card */}
      <motion.div
        className="w-full max-w-md bg-white rounded-card-lg shadow-xl border border-gray-150 p-8 sm:p-12 relative z-10"
        initial={shouldReduceMotion ? false : "hidden"}
        animate="visible"
        variants={scaleIn}
      >
        {/* Brand identity */}
        <div className="flex flex-col items-center text-center mb-8">
          <Link to="/" className="mb-6">
            <img
              src={brandAsset(config.logos.standard)}
              alt={config.brandName}
              className="h-10 w-auto object-contain"
            />
          </Link>
          <h1 className="font-heading text-3xl text-primary lowercase tracking-tight">
            Welcome back
          </h1>
          <p className="text-xs text-gray-500 mt-2">
            Sign in to manage your stays and experiences.
          </p>
        </div>

        {/* Notifications */}
        {showRegisteredSuccess && !infoMessage && (
          <div className="mb-6 rounded-lg bg-green-50 border border-green-200 p-4 text-xs text-green-700 flex gap-2.5 items-start">
            <CheckCircle2 size={16} className="shrink-0 text-green-600 mt-0.5" />
            <div>
              <p className="font-bold">Account Created Successfully!</p>
              <p className="mt-0.5">Welcome to Spark Rewards. Please sign in below to unlock member-only benefits.</p>
            </div>
          </div>
        )}

        {infoMessage && (
          <div className="mb-6 rounded-lg bg-primary-light border border-primary/20 p-4 text-xs text-primary flex gap-2.5 items-start">
            <Sparkles size={16} className="shrink-0 text-primary mt-0.5" />
            <span>{infoMessage}</span>
          </div>
        )}

        {errorMsg && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 p-4 text-xs text-red-700 flex gap-2.5 items-start">
            <AlertCircle size={16} className="shrink-0 text-red-600 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Sign In Form */}
        <form onSubmit={handleSignIn} className="space-y-5">
          {/* Email input */}
          <label className="grid gap-2 text-xs font-semibold text-gray-700">
            Email Address
            <span className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary">
                <Mail size={16} />
              </span>
              <input
                type="email"
                className="min-h-11 w-full rounded-lg border border-gray-200 bg-gray-50/50 py-2 pl-10 pr-3 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </span>
          </label>

          {/* Password input */}
          <div className="grid gap-2">
            <div className="flex justify-between items-center">
              <label className="text-xs font-semibold text-gray-700" htmlFor="pwd">Password</label>
              <button
                type="button"
                className="text-xs font-semibold text-primary hover:underline"
                onClick={handleForgotPassword}
              >
                Forgot password?
              </button>
            </div>
            <span className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-primary">
                <Lock size={16} />
              </span>
              <input
                id="pwd"
                type={showPassword ? "text" : "password"}
                className="min-h-11 w-full rounded-lg border border-gray-200 bg-gray-50/50 py-2 pl-10 pr-12 text-sm font-medium text-gray-900 outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-light"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
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

          {/* Sign In Button */}
          <div className="pt-2">
            <PrimaryButton
              type="submit"
              className="w-full text-sm font-semibold"
              disabled={isLoading || isGoogleLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Authenticating...
                </span>
              ) : (
                "Sign In"
              )}
            </PrimaryButton>
          </div>
        </form>

        {/* Divider */}
        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-gray-200"></div>
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-white px-3 font-semibold text-gray-400">or</span>
          </div>
        </div>

        {/* Google Sign In */}
        <div className="space-y-4">
          <button
            type="button"
            className="w-full min-h-11 inline-flex items-center justify-center gap-2.5 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50"
            onClick={handleGoogleSignIn}
            disabled={isLoading || isGoogleLoading}
          >
            {isGoogleLoading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            ) : (
              <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.77c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
            )}
            Sign In with Google
          </button>

          <GhostButton
            to="/signup"
            className="w-full text-sm font-semibold border-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Create Rewards Account
          </GhostButton>
        </div>

        {/* Back Link */}
        <div className="mt-8 text-center text-xs text-gray-500">
          <Link to="/rewards" className="hover:text-primary hover:underline font-medium">
            ← Return to Spark Rewards info
          </Link>
        </div>
      </motion.div>
    </main>
  );
}
