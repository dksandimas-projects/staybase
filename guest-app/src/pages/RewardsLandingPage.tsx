import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  AlertCircle
} from "lucide-react";
import config from "@config";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { HeroImage } from "../components/HeroImage";
import { HeroSkeleton } from "../components/HeroSkeleton";
import { fadeUp, staggerContainer, staggerChild } from "@spark-inn/shared";
import { useGuestAuth } from "../context/GuestAuthContext";
import { usePublicSiteContent } from "../hooks/usePublicSiteContent";
import { REWARDS_HERO_LQIP } from "../data/homepage";

export function RewardsLandingPage() {
  const shouldReduceMotion = useReducedMotion();
  const navigate = useNavigate();
  const { user, memberProfile, loading, refreshMemberProfile, registerCurrentMember } = useGuestAuth();
  const { rewards } = usePublicSiteContent();
  const heroPhoto = rewards.heroPhotoUrl;
  const heroEyebrow = rewards.heroEyebrow;
  const heroHeading = rewards.heroHeading;
  const heroSubtext = rewards.heroSubtext;

  // Real enroll state — per audit S2.4 / decision #49 this is now
  // wired to the server-side /api/members/register route. The
  // previous UI mock (sessionStorage + setTimeout + Wireframe Tester
  // Panel) has been removed.
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState("");

  useEffect(() => {
    if (!loading && user && memberProfile?.isMember) {
      navigate("/account/rewards", { replace: true });
    }
  }, [loading, memberProfile?.isMember, navigate, user]);

  const entranceProps = shouldReduceMotion
    ? {}
    : {
        initial: "hidden",
        whileInView: "visible",
        viewport: { once: true, margin: "-80px" }
      };

  const handleEnroll = async () => {
    if (!user) return;
    setEnrolling(true);
    setEnrollError("");
    try {
      await registerCurrentMember();
      // Refresh the local member profile from Firestore so the UI
      // flips to the "member" state without a hard reload.
      await refreshMemberProfile();
      navigate("/account/rewards");
    } catch (err) {
      console.error("Member enrollment failed:", err);
      setEnrollError("We could not join Spark Rewards right now. Please try again.");
      setEnrolling(false);
    }
  };

  const isMember = !!user && !!memberProfile?.isMember;
  const showAuthGatedView = !loading && !!user && !isMember;

  return (
    <main className="min-h-screen bg-gray-50 font-body text-gray-900 overflow-x-hidden relative">
      <Navbar overHero />

      <section className="relative -mt-20 flex min-h-[90vh] items-center justify-center overflow-hidden bg-gray-950 pt-20 px-4">
        <div className="absolute inset-0 z-0 opacity-40">
          {heroPhoto ? (
            <HeroImage
              className="absolute inset-0 w-full h-full object-cover"
              alt="Warm boutique hotel lobby interior at sunset"
              src={heroPhoto}
              placeholder={REWARDS_HERO_LQIP}
            />
          ) : (
            <HeroSkeleton />
          )}
        </div>
        {/* Stronger gradient + drop-shadow on the text so the
            hero reads on any background photo. */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-950/40 via-gray-950/70 to-gray-950/90 z-0" />

        <motion.div
          animate="visible"
          className="relative z-10 mx-auto max-w-4xl text-center pt-16"
          initial={shouldReduceMotion ? false : "hidden"}
          variants={fadeUp}
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/20 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary-light mb-6 backdrop-blur-sm drop-shadow-md">
            <Sparkles size={14} /> {config.rewardsName} {heroEyebrow}
          </div>
          <h1 className="font-heading text-4xl leading-none text-white sm:text-7xl lg:text-8xl tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)]">
            {heroHeading}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-gray-200 sm:text-lg drop-shadow-md">
            {heroSubtext}
          </p>

          <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row sm:items-center">
            {/* Logged-out: standard CTAs */}
            {!loading && !user && (
              <>
                <PrimaryButton to="/signup" className="min-w-[220px] shadow-lg drop-shadow-md">
                  Join Spark Rewards
                </PrimaryButton>
                <GhostButton
                  to="/signin"
                  className="min-w-[220px] border-white text-white drop-shadow-sm hover:bg-white/10"
                >
                  Sign In
                </GhostButton>
              </>
            )}

            {/* Auth still loading: show nothing to avoid a flash */}
            {loading && null}

            {/* Authenticated but not a member: one-click enroll via
                server-side /api/members/register */}
            {showAuthGatedView && (
              <PrimaryButton
                type="button"
                onClick={handleEnroll}
                className="min-w-[240px] shadow-lg drop-shadow-md"
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

            {isMember && (
              <PrimaryButton to="/account/rewards" className="min-w-[240px] shadow-lg drop-shadow-md">
                Go to My Rewards Dashboard <ArrowRight size={16} />
              </PrimaryButton>
            )}
          </div>

          {enrollError ? (
            <div
              role="alert"
              className="mx-auto mt-4 inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/95 px-3 py-2 text-xs text-red-700"
            >
              <AlertCircle size={14} />
              {enrollError}
            </div>
          ) : null}
        </motion.div>
      </section>

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
            {!loading && !user && (
              <PrimaryButton to="/signup" className="text-xs shrink-0">
                Register as Member <ArrowRight size={14} className="ml-1.5" />
              </PrimaryButton>
            )}
            {isMember && (
              <PrimaryButton to="/account/rewards" className="text-xs shrink-0">
                My Rewards <ArrowRight size={14} className="ml-1.5" />
              </PrimaryButton>
            )}
          </motion.div>

          <motion.div
            className="grid gap-6 sm:grid-cols-2"
            variants={staggerContainer}
            {...entranceProps}
          >
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

            <motion.div
              className="bg-white p-8 md:p-10 rounded-card border border-gray-200 shadow-sm hover:shadow-md transition relative overflow-hidden group flex flex-col justify-between"
              variants={staggerChild}
              whileHover={shouldReduceMotion ? undefined : { y: -3 }}
            >
              <div className="relative z-10">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-light text-primary mb-6">
                  <Gift size={24} />
                </div>
                <h4 className="font-heading text-xl md:text-2xl text-gray-950">Welcome to the Program</h4>
                <p className="mt-3 text-sm leading-relaxed text-gray-600 max-w-md">
                  Earn points on every stay, redeem for complimentary nights and curated local experiences. We're glad to have you.
                </p>
              </div>
              <div className="mt-6 text-xs italic text-gray-500">
                No welcome email for Phase 1 — per `DECISIONS-FEATURES.md #93`
              </div>
              <div className="absolute -bottom-6 -right-6 text-gray-100 opacity-20 pointer-events-none group-hover:scale-110 transition duration-300">
                <Gift size={120} />
              </div>
            </motion.div>

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

          {!loading && !user && (
            <Link
              to="/signup"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary shadow-lg transition hover:bg-gray-50 active:scale-95"
            >
              Create Member Account
            </Link>
          )}

          {showAuthGatedView && (
            <button
              type="button"
              onClick={handleEnroll}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary shadow-lg transition hover:bg-gray-50 active:scale-95 disabled:opacity-60"
              disabled={enrolling}
            >
              {enrolling ? "Enrolling..." : "Join Spark Rewards"}
            </button>
          )}

          {isMember && (
            <Link
              to="/account/rewards"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-white px-8 py-3.5 text-sm font-semibold text-primary shadow-lg transition hover:bg-gray-50 active:scale-95"
            >
              My Rewards Dashboard
            </Link>
          )}

          {enrollError ? (
            <p
              role="alert"
              className="mx-auto mt-4 inline-flex items-center gap-2 rounded-lg border border-white/30 bg-white/10 px-3 py-2 text-xs text-white"
            >
              <AlertCircle size={14} />
              {enrollError}
            </p>
          ) : null}
        </div>
      </section>

      <Footer />
    </main>
  );
}
