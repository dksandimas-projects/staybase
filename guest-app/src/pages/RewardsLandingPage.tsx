import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { 
  UserPlus, 
  Hotel, 
  Gift, 
  Clock, 
  Tag, 
  Megaphone, 
  CheckCircle,
  ArrowRight,
  Sparkles,
  Info,
  LogOut,
  User
} from "lucide-react";
import config from "@config";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { fadeUp, staggerContainer, staggerChild } from "@spark-inn/shared";
import { cn } from "../utils/cn";

type AuthState = "logged-out" | "logged-in-non-member" | "logged-in-member";

export function RewardsLandingPage() {
  const shouldReduceMotion = useReducedMotion();

  // Simulated Auth State (synced with sessionStorage to persist on quick navigation/refresh)
  const [authState, setAuthState] = useState<AuthState>(() => {
    return (sessionStorage.getItem("sim_auth_state") as AuthState) ?? "logged-out";
  });

  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    sessionStorage.setItem("sim_auth_state", authState);
  }, [authState]);

  const entranceProps = shouldReduceMotion
    ? {}
    : {
        initial: "hidden",
        whileInView: "visible",
        viewport: { once: true, margin: "-80px" }
      };

  const handleEnroll = () => {
    setEnrolling(true);
    setTimeout(() => {
      setEnrolling(false);
      setAuthState("logged-in-member");
    }, 1000);
  };

  return (
    <main className="min-h-screen bg-gray-50 font-body text-gray-900 overflow-x-hidden relative">
      {/* Sticky transparent-to-solid Navbar */}
      <Navbar overHero />

      {/* Hero Section */}
      <section className="relative -mt-20 flex min-h-[90vh] items-center justify-center overflow-hidden bg-gray-950 pt-20 px-4">
        <div className="absolute inset-0 z-0 opacity-40">
          <img
            className="w-full h-full object-cover"
            alt="Warm boutique hotel lobby interior at sunset"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuDxE3ob-vSO4zxT_VMu0OviqdIAMTOtgsJXzWeddVJ-6-QmLSHHkERJKmN_zfFFeGvMrFhzST6Xoc-MNtubwhDrYU3ZjBFSjACtuAwnlBaH4z6Ts-UB0kYlC38ol_42OAWXX2iUGuPhL2ZSvUac1bc6j0zvNGyAyCNMnyrg9X2dwyDXafz7n_EIfEX_xAI6S2D_XhfdiedtLyzdH-SxVWzm25SwLm9ovUul16TnLGbrr9fj2Jmezvw2N3x4T49eU2RDAchvC4pc-2UY"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/65 to-transparent z-0" />

        <motion.div
          animate="visible"
          className="relative z-10 mx-auto max-w-4xl text-center pt-16"
          initial={shouldReduceMotion ? false : "hidden"}
          variants={fadeUp}
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/20 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary-light mb-6 backdrop-blur-sm">
            <Sparkles size={14} /> Spark Rewards Loyalty Program
          </div>
          <h1 className="font-heading text-4xl leading-none text-white sm:text-7xl lg:text-8xl tracking-tight">
            Earn Every Stay
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-gray-200 sm:text-lg">
            Join Spark Rewards and unlock a world of exclusive benefits and heartfelt hospitality. Experience the pinnacle of boutique comfort with personalized rewards tailored just for you.
          </p>

          <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row sm:items-center">
            {authState === "logged-out" && (
              <>
                <PrimaryButton to="/signup" className="min-w-[220px] shadow-lg">
                  Join Spark Rewards
                </PrimaryButton>
                <GhostButton
                  to="/signin"
                  className="min-w-[220px] border-white text-white hover:bg-white/10"
                >
                  Sign In
                </GhostButton>
              </>
            )}

            {authState === "logged-in-non-member" && (
              <PrimaryButton
                type="button"
                onClick={handleEnroll}
                className="min-w-[240px] shadow-lg"
                disabled={enrolling}
              >
                {enrolling ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Enrolling...
                  </span>
                ) : (
                  "Enroll in Spark Rewards (One-Click)"
                )}
              </PrimaryButton>
            )}

            {authState === "logged-in-member" && (
              <PrimaryButton to="/account/rewards" className="min-w-[240px] shadow-lg">
                Go to My Rewards Dashboard <ArrowRight size={16} />
              </PrimaryButton>
            )}
          </div>
        </motion.div>
      </section>

      {/* How It Works Section */}
      <section className="py-24 bg-white relative z-10 border-b border-gray-150">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="text-center mb-16"
            variants={fadeUp}
            {...entranceProps}
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Simple Steps</p>
            <h2 className="mt-3 font-heading text-3xl text-gray-950 sm:text-4xl">How It Works</h2>
            <div className="mt-4 mx-auto w-12 h-1 bg-primary rounded" />
          </motion.div>

          <motion.div 
            className="grid gap-12 sm:grid-cols-2 lg:grid-cols-3" 
            variants={staggerContainer} 
            {...entranceProps}
          >
            {/* Step 1 */}
            <motion.div 
              className="flex flex-col items-center text-center p-6 rounded-xl hover:shadow-sm transition group"
              variants={staggerChild}
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-light text-primary group-hover:scale-110 transition duration-300">
                <UserPlus size={28} />
              </div>
              <h3 className="mt-6 text-lg font-semibold text-gray-900">1. Join for free</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 max-w-xs">
                Create your account in seconds and unlock immediate access to member-only privileges.
              </p>
            </motion.div>

            {/* Step 2 */}
            <motion.div 
              className="flex flex-col items-center text-center p-6 rounded-xl hover:shadow-sm transition group"
              variants={staggerChild}
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-light text-primary group-hover:scale-110 transition duration-300">
                <Hotel size={28} />
              </div>
              <h3 className="mt-6 text-lg font-semibold text-gray-900">2. Stay &amp; Earn</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 max-w-xs">
                Earn 10 points for every night spent with us, plus bonus multipliers for longer escapes.
              </p>
            </motion.div>

            {/* Step 3 */}
            <motion.div 
              className="flex flex-col items-center text-center p-6 rounded-xl hover:shadow-sm transition group"
              variants={staggerChild}
            >
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-light text-primary group-hover:scale-110 transition duration-300">
                <Gift size={28} />
              </div>
              <h3 className="mt-6 text-lg font-semibold text-gray-900">3. Redeem &amp; Relax</h3>
              <p className="mt-3 text-sm leading-relaxed text-gray-600 max-w-xs">
                Use points for free nights, bespoke room upgrades, and local experiential packages.
              </p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Member Perks (Bento Style Grid) */}
      <section className="py-24 bg-section-bg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="flex flex-col md:flex-row justify-between items-end mb-16 gap-6"
            variants={fadeUp}
            {...entranceProps}
          >
            <div className="max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Member Privileges</p>
              <h2 className="mt-3 font-heading text-3xl text-gray-950 sm:text-4xl">Your World of Perks</h2>
              <p className="mt-4 text-sm text-gray-600">
                Beyond points redemption, Spark Rewards offers a suite of exclusive privileges designed to elevate your stay.
              </p>
            </div>
            {authState === "logged-out" && (
              <PrimaryButton to="/signup" className="text-xs shrink-0">
                Register as Member <ArrowRight size={14} className="ml-1.5" />
              </PrimaryButton>
            )}
          </motion.div>

          <motion.div 
            className="grid gap-6 sm:grid-cols-2"
            variants={staggerContainer}
            {...entranceProps}
          >
            {/* Bento Perk 1 */}
            <motion.div 
              className="bg-white p-8 md:p-10 rounded-card border border-gray-200 shadow-sm hover:shadow-md transition relative overflow-hidden group flex flex-col justify-between"
              variants={staggerChild}
              whileHover={shouldReduceMotion ? undefined : { y: -3 }}
            >
              <div className="relative z-10">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-light text-primary mb-6">
                  <Tag size={24} />
                </div>
                <h4 className="font-heading text-xl md:text-2xl text-gray-950">Member-Only Rates</h4>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 max-w-md">
                  Always get the lowest price guaranteed. Save up to 15% on every booking when you sign in.
                </p>
              </div>
              <div className="mt-6 pt-6 border-t border-gray-100 flex flex-wrap gap-4 text-xs font-semibold text-primary">
                <span className="flex items-center gap-1.5"><CheckCircle size={14} /> Best Rate Guarantee</span>
                <span className="flex items-center gap-1.5"><CheckCircle size={14} /> No Booking Fees</span>
              </div>
              <div className="absolute -bottom-6 -right-6 text-gray-100 opacity-20 pointer-events-none group-hover:scale-110 transition duration-300">
                <Tag size={120} />
              </div>
            </motion.div>

            {/* Bento Perk 2 */}
            <motion.div 
              className="bg-white p-8 md:p-10 rounded-card border border-gray-200 shadow-sm hover:shadow-md transition relative overflow-hidden group flex flex-col justify-between"
              variants={staggerChild}
              whileHover={shouldReduceMotion ? undefined : { y: -3 }}
            >
              <div className="relative z-10">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-light text-primary mb-6">
                  <Clock size={24} />
                </div>
                <h4 className="font-heading text-xl md:text-2xl text-gray-950">Early Check-in Priority</h4>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 max-w-md">
                  Your vacation starts when you arrive. Subject to availability, enjoy your room sooner than standard timing.
                </p>
              </div>
              <div className="mt-6">
                <span className="inline-block px-3 py-1 bg-primary-light text-primary rounded-full text-xs font-semibold">
                  Standard Member Benefit
                </span>
              </div>
              <div className="absolute -bottom-6 -right-6 text-gray-100 opacity-20 pointer-events-none group-hover:scale-110 transition duration-300">
                <Clock size={120} />
              </div>
            </motion.div>

            {/* Bento Perk 3 */}
            <motion.div 
              className="bg-white p-8 md:p-10 rounded-card border border-gray-200 shadow-sm hover:shadow-md transition relative overflow-hidden group flex flex-col justify-between"
              variants={staggerChild}
              whileHover={shouldReduceMotion ? undefined : { y: -3 }}
            >
              <div className="relative z-10">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-light text-primary mb-6">
                  <Gift size={24} />
                </div>
                <h4 className="font-heading text-xl md:text-2xl text-gray-950">Welcome Gift</h4>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 max-w-md">
                  Feel at home immediately. A little welcome item, from local Bohol snacks to hand-packaged amenities, is placed in your room on arrival.
                </p>
              </div>
              <div className="mt-6 text-xs italic text-gray-500">
                Curated by our Bohol organic farm partners
              </div>
              <div className="absolute -bottom-6 -right-6 text-gray-100 opacity-20 pointer-events-none group-hover:scale-110 transition duration-300">
                <Gift size={120} />
              </div>
            </motion.div>

            {/* Bento Perk 4 */}
            <motion.div 
              className="bg-white p-8 md:p-10 rounded-card border border-gray-200 shadow-sm hover:shadow-md transition relative overflow-hidden group flex flex-col justify-between"
              variants={staggerChild}
              whileHover={shouldReduceMotion ? undefined : { y: -3 }}
            >
              <div className="relative z-10">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-light text-primary mb-6">
                  <Megaphone size={24} />
                </div>
                <h4 className="font-heading text-xl md:text-2xl text-gray-950">Exclusive Presales</h4>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 max-w-md">
                  Be the first to hear about seasonal discounts and limited-edition package deals with 48-hour member early access.
                </p>
              </div>
              <div className="mt-6 flex gap-2">
                <span className="bg-yellow-50 text-yellow-700 border border-yellow-250 px-2.5 py-0.5 rounded text-[10px] font-semibold">
                  Summer Presales
                </span>
                <span className="bg-purple-50 text-purple-700 border border-purple-250 px-2.5 py-0.5 rounded text-[10px] font-semibold">
                  Holiday Releases
                </span>
              </div>
              <div className="absolute -bottom-6 -right-6 text-gray-100 opacity-20 pointer-events-none group-hover:scale-110 transition duration-300">
                <Megaphone size={120} />
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* CTA Signup Banner */}
      <section className="py-20 bg-primary relative overflow-hidden shadow-inner">
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
            <path d="M0 100 Q 25 50 50 100 T 100 100" fill="none" stroke="white" strokeWidth="0.5"></path>
            <path d="M0 80 Q 25 30 50 80 T 100 80" fill="none" stroke="white" strokeWidth="0.5"></path>
          </svg>
        </div>
        <div className="container mx-auto px-6 text-center relative z-10">
          <h2 className="font-heading text-3xl md:text-4xl text-white mb-4">Start earning today.</h2>
          <p className="text-white/90 text-sm md:text-base mb-8 max-w-xl mx-auto leading-relaxed">
            Join our community of travelers and experience a more rewarding way to stay in Tagbilaran City, Bohol.
          </p>

          {authState === "logged-out" && (
            <Link 
              to="/signup" 
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary shadow-lg transition hover:bg-gray-50 active:scale-95"
            >
              Create Member Account
            </Link>
          )}

          {authState === "logged-in-non-member" && (
            <button 
              onClick={handleEnroll}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary shadow-lg transition hover:bg-gray-50 active:scale-95"
              disabled={enrolling}
            >
              {enrolling ? "Enrolling..." : "Join Spark Rewards"}
            </button>
          )}

          {authState === "logged-in-member" && (
            <Link 
              to="/account/rewards" 
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary shadow-lg transition hover:bg-gray-50 active:scale-95"
            >
              My Rewards Dashboard
            </Link>
          )}
        </div>
      </section>

      {/* Footer */}
      <Footer />

      {/* SIMULATED AUTH CONTROLLER WIDGET FOR INTERACTIVE TESTING */}
      <div className="fixed bottom-24 right-4 z-50 bg-white border border-gray-200 rounded-card shadow-2xl p-4 max-w-xs font-body text-xs text-gray-800 ring-1 ring-black/5 animate-bounce-short">
        <div className="flex items-center justify-between border-b border-gray-150 pb-2 mb-3">
          <span className="font-bold text-gray-900 flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
            <Sparkles size={12} className="text-primary" /> Wireframe Tester Panel
          </span>
          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-semibold">
            G-10 Page
          </span>
        </div>
        
        <p className="text-gray-600 leading-normal mb-3">
          Toggle the simulated authorization states to test how this landing page adjusts buttons, flows, and enrollment links dynamically:
        </p>

        <div className="space-y-2">
          {/* State 1: Logged Out */}
          <button
            type="button"
            className={cn(
              "w-full px-3 py-2 rounded text-left border font-semibold flex items-center justify-between",
              authState === "logged-out"
                ? "bg-primary-light border-primary text-primary"
                : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
            )}
            onClick={() => setAuthState("logged-out")}
          >
            <span>Logged Out (Default)</span>
            <LogOut size={12} />
          </button>

          {/* State 2: Logged In Non-Member */}
          <button
            type="button"
            className={cn(
              "w-full px-3 py-2 rounded text-left border font-semibold flex items-center justify-between",
              authState === "logged-in-non-member"
                ? "bg-primary-light border-primary text-primary"
                : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
            )}
            onClick={() => setAuthState("logged-in-non-member")}
          >
            <span>Logged In (Non-Member)</span>
            <User size={12} />
          </button>

          {/* State 3: Logged In Member */}
          <button
            type="button"
            className={cn(
              "w-full px-3 py-2 rounded text-left border font-semibold flex items-center justify-between",
              authState === "logged-in-member"
                ? "bg-primary-light border-primary text-primary"
                : "bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100"
            )}
            onClick={() => setAuthState("logged-in-member")}
          >
            <span>Logged In (Member)</span>
            <CheckCircle size={12} />
          </button>
        </div>

        <div className="mt-3 pt-2 border-t border-gray-150 text-[10px] text-gray-500 leading-normal flex items-start gap-1">
          <Info size={12} className="shrink-0 mt-0.5 text-primary" />
          <span>
            Upgrading to **Member** simulates a database write to the loyalty collection.
          </span>
        </div>
      </div>
    </main>
  );
}
