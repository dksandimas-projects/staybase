import { useEffect, useMemo, useState, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  Coins,
  Users,
  Briefcase,
  CheckCircle2,
  ShieldCheck,
  Wifi,
  ChevronRight,
  ArrowRight,
  Info,
  Calendar,
  Building,
  User,
  Mail,
  Phone,
  HelpCircle,
  type LucideIcon
} from "lucide-react";
import config from "@config";
import { Navbar } from "../components/Navbar";
import { Footer } from "../components/Footer";
import { PrimaryButton } from "../components/PrimaryButton";
import { GhostButton } from "../components/GhostButton";
import { Modal } from "../components/Modal";
import { CORPORATE_HERO_LQIP } from "../data/homepage";
import { useRooms } from "../hooks/useRooms";
import { useRoomTypes } from "../hooks/useRoomTypes";
import { brandAsset } from "../utils/brand";
import { cn } from "../utils/cn";
import { fadeUp, staggerContainer, staggerChild, DEFAULT_CORPORATE_PAGE_CONTENT, type RoomTypeEntry } from "@spark-inn/shared";
import { usePublicSiteContent } from "../hooks/usePublicSiteContent";
import type { ContentItem } from "@spark-inn/shared";
import { HeroImage } from "../components/HeroImage";
import { HeroSkeleton } from "../components/HeroSkeleton";

const PERK_ICON_MAP: Record<string, LucideIcon> = {
  coins: Coins,
  percent: Coins,
  money: Coins,
  users: Users,
  group: Users,
  briefcase: Briefcase,
  support: Briefcase,
  wifi: Wifi,
  network: Wifi,
  shield: ShieldCheck,
  security: ShieldCheck,
  calendar: Calendar,
  date: Calendar,
  help: HelpCircle,
  flexible: HelpCircle
};

function resolvePerkIcon(name: string | undefined, fallback: LucideIcon): LucideIcon {
  if (!name) return fallback;
  const icon = PERK_ICON_MAP[name.toLowerCase()];
  return icon ?? fallback;
}

export function CorporateStaysPage() {
  const shouldReduceMotion = useReducedMotion();
  const formRef = useRef<HTMLDivElement>(null);

  // Form states
  const [companyName, setCompanyName] = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roomsCount, setRoomsCount] = useState("1");
  const [preferredDates, setPreferredDates] = useState("");
  const [specialRequirements, setSpecialRequirements] = useState("");
  
  // Honeypot state
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  
  // Submission states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [formError, setFormError] = useState("");

  // Type details modal — holds a `RoomTypeEntry` directly (no per-room
  // indirection). See the `accommodationTypes` derivation below for why
  // the rooms-overview section is now type-driven.
  const [selectedType, setSelectedType] = useState<RoomTypeEntry | null>(null);

  // Live data sources: rooms (for the "has at least one active room"
  // filter) + room types (canonical for the overview cards).
  const { rooms } = useRooms();
  const { roomTypes } = useRoomTypes();

  // Room types for the public rooms overview section. Previously this
  // was derived from a hardcoded `data/rooms.ts` fallback via
  // `uniqueRooms = rooms.reduce(...)`, which meant any new type the
  // admin added via Settings → Room Types would silently fail to
  // appear on the corporate page. Now sourced directly from
  // `useRoomTypes()` (already live on Firestore) and filtered to
  // types that have at least one active room — same end condition as
  // the old `current.isActive` check, but type-driven.
  const accommodationTypes = useMemo(
    () => roomTypes.filter((type) => rooms.some((r) => r.isActive && r.type === type.value)),
    [roomTypes, rooms]
  );

  const entranceProps = shouldReduceMotion
    ? {}
    : {
        initial: "hidden",
        whileInView: "visible",
        viewport: { once: true, margin: "-80px" }
      };

  const { corporate } = usePublicSiteContent();
  const corpHeroPhoto = corporate.heroPhotoUrl;
  const corpHeroEyebrow = corporate.heroEyebrow;
  const corpHeading = corporate.heroHeading;
  const corpSubtext = corporate.heroSubtext;
  const perkFallbacks: LucideIcon[] = [Coins, Users, Briefcase, Wifi, ShieldCheck, HelpCircle];

  const scrollToForm = (interestRoomName?: string) => {
    if (interestRoomName) {
      setSpecialRequirements(prev => {
        const text = `Inquiring about corporate stay rates for ${interestRoomName}.`;
        return prev ? `${prev}\n${text}` : text;
      });
    }
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Mount the Turnstile widget explicitly via `turnstile.render()` rather
  // than relying on the implicit auto-render triggered by the
  // `cf-turnstile` class. Explicit render lets us:
  //   - Pass `expired-callback` / `error-callback` so the form degrades
  //     gracefully when the widget fails or the token expires.
  //   - Capture the returned widget id and `turnstile.remove()` it on
  //     unmount — without this, React re-renders of the form (e.g. after
  //     "Submit Another Inquiry") leave stale widget instances attached
  //     to detached DOM nodes, which is what produced the 400 / 110200
  //     storms in production.
  //   - Avoid the global `window.onCorporateInquiryTurnstileSuccess`
  //     callback that races with React state updates.
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (isSubmitted) return;

    const container = turnstileContainerRef.current;
    if (!container) return;

    const isProductionDomain = window.location.hostname === config.domain || window.location.hostname === `www.${config.domain}`;
    const siteKey = isProductionDomain
      ? String(import.meta.env.VITE_TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA")
      : "1x00000000000000000000AA";
    let cancelled = false;
    let widgetId: string | null = null;
    let pollHandle: ReturnType<typeof setTimeout> | null = null;

    const ensureScript = (): void => {
      const scriptId = "turnstile-script";
      if (document.getElementById(scriptId)) return;
      const script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    };

    const renderWidget = (): void => {
      if (cancelled || !window.turnstile || !container.isConnected) return;
      widgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (token) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => {
          // Widget failed to render (network blip, site-key mismatch,
          // etc). Clear the token so the submit handler can decide
          // whether to allow the request through or surface an error.
          setTurnstileToken("");
        }
      });
      turnstileWidgetIdRef.current = widgetId;
    };

    const tryRender = (): void => {
      if (cancelled) return;
      if (window.turnstile) {
        renderWidget();
      } else {
        pollHandle = setTimeout(tryRender, 100);
      }
    };

    ensureScript();
    tryRender();

    return () => {
      cancelled = true;
      if (pollHandle !== null) clearTimeout(pollHandle);
      const id = turnstileWidgetIdRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          // Widget may already be gone (e.g. parent reloaded). Safe to
          // ignore — the next mount will allocate a fresh id.
        }
      }
      turnstileWidgetIdRef.current = null;
    };
  }, [isSubmitted]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    // Honeypot check
    if (websiteUrl) {
      setIsSubmitting(true);
      setTimeout(() => {
        setIsSubmitting(false);
        setIsSubmitted(true);
      }, 1000);
      return;
    }

    // Validation
    if (!companyName.trim() || !contactPerson.trim() || !email.trim() || !phone.trim() || !preferredDates.trim()) {
      setFormError("Please fill out all required fields.");
      return;
    }

    // Per BI-02 (booking-intercom audit 2026-07-06): the endpoint
    // is Turnstile-gated for real now — don't burn a request that
    // will 400 while the widget is still resolving.
    if (!turnstileToken) {
      setFormError("The security check hasn't finished yet. Please wait a moment and try again.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/corporate/inquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          contactPerson,
          email,
          phone,
          numRooms: Number(roomsCount),
          preferredDates,
          specialRequirements,
          _hp: websiteUrl,
          turnstileToken
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error || "We could not submit your inquiry right now. Please try again.");
      }

      setIsSubmitting(false);
      setIsSubmitted(true);
      setCompanyName("");
      setContactPerson("");
      setEmail("");
      setPhone("");
      setRoomsCount("1");
      setPreferredDates("");
      setSpecialRequirements("");
      setWebsiteUrl("");
      setTurnstileToken("");
    } catch (error: any) {
      setIsSubmitting(false);
      setFormError(error?.message || "We could not submit your inquiry right now. Please try again.");
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 font-body text-gray-900 overflow-x-hidden">
      {/* Sticky transparent-to-solid Navbar */}
      <Navbar overHero />

      {/* Dark Hero Section */}
      <section className="relative -mt-20 flex min-h-[85vh] items-center justify-center overflow-hidden bg-gray-950 pt-20 px-4">
        <div className="absolute inset-0 z-0 opacity-30">
          {corpHeroPhoto ? (
            <HeroImage
              className="absolute inset-0 w-full h-full object-cover"
              alt="Sophisticated corporate meeting room and lounge"
              src={corpHeroPhoto}
              placeholder={CORPORATE_HERO_LQIP}
            />
          ) : (
            <HeroSkeleton />
          )}
        </div>
        {/* Lighter gradient than the home / about / rewards heroes
            because the corporate page already sits on a
            `bg-gray-950` section — the photo only needs a
            modest dark wash to read, not a 90% black blanket.
            The drop-shadow on the text (added in
            `feat/hero-text-legibility`) carries the rest of the
            legibility load. */}
        <div className="absolute inset-0 bg-gradient-to-b from-gray-950/20 via-gray-950/40 to-gray-950/60 z-0" />

        <motion.div
          animate="visible"
          className="relative z-10 mx-auto max-w-4xl text-center pt-12"
          initial={shouldReduceMotion ? false : "hidden"}
          variants={fadeUp}
        >
          <p className="font-heading text-lg italic text-primary-light sm:text-2xl tracking-wider drop-shadow-md">
            {corpHeroEyebrow}
          </p>
          <h1 className="mt-4 font-heading text-4xl leading-tight text-white sm:text-6xl lg:text-7xl drop-shadow-[0_2px_12px_rgba(0,0,0,0.7)]">
            {corpHeading}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-gray-300 sm:text-lg drop-shadow-md">
            {corpSubtext}
          </p>
          <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row sm:items-center">
            <PrimaryButton to="/corporate/book" className="min-w-[220px] shadow-lg drop-shadow-md">
              Book with Corporate Rate
            </PrimaryButton>
            <GhostButton
              type="button"
              className="min-w-[220px] border-white text-white drop-shadow-sm hover:bg-white/10"
              onClick={() => scrollToForm()}
            >
              Submit an Inquiry
            </GhostButton>
          </div>
          <div className="mt-6 text-sm text-gray-400 drop-shadow-sm">
            Have a negotiated corporate access code?{" "}
            <Link to="/corporate/book" className="text-primary hover:underline font-medium">
              Validate here
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Corporate Perks Grid */}
      <section className="py-24 bg-section-bg">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div 
            className="text-center mb-16"
            variants={fadeUp}
            {...entranceProps}
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Exclusive Client Benefits</p>
            <h2 className="mt-3 font-heading text-3xl text-gray-950 sm:text-4xl">
              Unrivaled Professional Perks
            </h2>
            <div className="mt-4 mx-auto w-16 h-1 bg-primary rounded" />
          </motion.div>

          <motion.div
            className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3"
            variants={staggerContainer}
            {...entranceProps}
          >
            {corporate.perks.map((perk: ContentItem, index: number) => {
              const fallback = perkFallbacks[index % perkFallbacks.length];
              const Icon = resolvePerkIcon(perk.icon, fallback);
              return (
                <motion.div
                  key={perk.title}
                  className="rounded-card bg-white p-8 shadow-sm ring-1 ring-gray-100 hover:shadow-md transition group"
                  variants={staggerChild}
                  whileHover={shouldReduceMotion ? undefined : { y: -4 }}
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-light text-primary group-hover:bg-primary group-hover:text-white transition">
                    <Icon size={24} />
                  </div>
                  <h3 className="mt-6 text-lg font-semibold text-gray-900">{perk.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-gray-600">{perk.description}</p>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* Integration Process */}
      <section className="py-24 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            {/* Process description */}
            <motion.div variants={fadeUp} {...entranceProps}>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Onboarding Flow</p>
              <h2 className="mt-3 font-heading text-3xl text-gray-950 sm:text-4xl">
                Simple Integration, Superior Results
              </h2>
              <p className="mt-4 text-base text-gray-600">
                Setting up a corporate account with {config.brandName} is designed to be as frictionless as our check-in process.
              </p>

              <div className="mt-10 space-y-8 relative">
                {/* Connector line */}
                <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-gray-100 -z-0" />
                
                {/* Step 1 */}
                <div className="flex gap-6 relative z-10">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-white font-semibold shadow-sm">
                    01
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Inquiry Submission</h3>
                    <p className="mt-1 text-sm text-gray-600 leading-relaxed">
                      Submit the form below with your company details and expected monthly travel volume.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-6 relative z-10">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-white font-semibold shadow-sm">
                    02
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Rate Negotiation</h3>
                    <p className="mt-1 text-sm text-gray-600 leading-relaxed">
                      Our corporate relations manager will contact you within 24 hours to propose a customized rate map.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-6 relative z-10">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-white font-semibold shadow-sm">
                    03
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Instant Corporate Booking</h3>
                    <p className="mt-1 text-sm text-gray-600 leading-relaxed">
                      Access our booking site using your unique corporate code to unlock rates immediately for employees.
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Illustration */}
            <motion.div 
              className="relative"
              variants={fadeUp}
              {...entranceProps}
            >
              <div className="absolute -top-4 -right-4 h-full w-full rounded-card-lg bg-primary-light -z-10" />
              <img
                src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=800&q=80"
                alt="Corporate team collaborating in a bright workspace"
                className="aspect-video w-full rounded-card-lg object-cover shadow-xl lg:aspect-square"
              />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Rooms Overview Grid (NO PRICES) */}
      <section className="py-24 bg-gray-50 border-t border-gray-200">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            className="text-center mb-16"
            variants={fadeUp}
            {...entranceProps}
          >
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">
              {corporate.roomsOverviewEyebrow || DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.eyebrow}
            </p>
            <h2 className="mt-3 font-heading text-3xl text-gray-950 sm:text-4xl">
              {corporate.roomsOverviewHeading || DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.heading}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm text-gray-600 leading-relaxed">
              {corporate.roomsOverviewDescription || DEFAULT_CORPORATE_PAGE_CONTENT.roomsOverview.description}
            </p>
            <div className="mt-4 mx-auto w-16 h-1 bg-primary rounded" />
          </motion.div>

          <motion.div
            className="grid gap-8 md:grid-cols-2 lg:grid-cols-3"
            variants={staggerContainer}
            {...entranceProps}
          >
            {accommodationTypes.map((type) => {
              // The corporate page shows only live uploads from
              // `useRoomTypes` — there is no curated static fallback.
              // When a type has no photo yet, the conditional render
              // below shows a "Photo coming soon" placeholder so the
              // fallback URLs in `data/homepage.ts` are never fetched
              // by the guest app.
              const heroImage = type.imageUrls[0];
              return (
                <motion.article
                  key={type.value}
                  className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200 flex flex-col h-full hover:shadow-md transition"
                  variants={staggerChild}
                  whileHover={shouldReduceMotion ? undefined : { y: -4 }}
                >
                  <div className="aspect-[4/3] overflow-hidden bg-section-bg relative">
                    {heroImage ? (
                      <img
                        src={heroImage}
                        alt={type.label}
                        className="h-full w-full object-cover transition duration-300 hover:scale-105"
                      />
                    ) : (
                      <div
                        className="flex h-full w-full items-center justify-center text-xs uppercase tracking-wider text-gray-400"
                        aria-label={`No photo for ${type.label}`}
                      >
                        Photo coming soon
                      </div>
                    )}
                    <div className="absolute top-3 left-3">
                      <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary shadow-sm">
                        {type.shortLabel}
                      </span>
                    </div>
                  </div>

                  <div className="p-6 flex flex-col flex-1">
                    <h3 className="text-lg font-semibold text-gray-950">{type.label}</h3>
                    <p className="mt-3 text-sm leading-6 text-gray-600 flex-1 line-clamp-3">
                      {type.description}
                    </p>

                    <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-between gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1.5">
                        <Users size={14} className="text-primary" />
                        Up to {type.maxCapacity} {type.maxCapacity === 1 ? "guest" : "guests"}
                      </span>
                      <span>{type.bedDefinition}</span>
                    </div>

                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {type.amenities.slice(0, 3).map((amenity) => (
                        <span key={amenity} className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600">
                          {amenity}
                        </span>
                      ))}
                      {type.amenities.length > 3 && (
                        <span className="rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-500">
                          +{type.amenities.length - 3} more
                        </span>
                      )}
                    </div>

                    <div className="mt-6 grid grid-cols-2 gap-2 pt-2">
                      <GhostButton
                        type="button"
                        className="text-xs h-[40px] min-h-[40px]"
                        onClick={() => setSelectedType(type)}
                      >
                        Type Details
                      </GhostButton>
                      <PrimaryButton
                        type="button"
                        className="text-xs h-[40px] min-h-[40px]"
                        onClick={() => scrollToForm(type.label)}
                      >
                        Inquire
                      </PrimaryButton>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </motion.div>
        </div>
      </section>

      {/* Retreat CTA Banner */}
      <section className="py-16 px-4">
        <div className="mx-auto max-w-6xl bg-primary rounded-card-lg p-10 md:p-16 text-center relative overflow-hidden shadow-xl">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-32 -mt-32 pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full -ml-24 -mb-24 pointer-events-none" />
          <h2 className="font-heading text-3xl md:text-4xl text-white mb-4 relative z-10">
            {corporate.retreatHeading || DEFAULT_CORPORATE_PAGE_CONTENT.retreat.heading}
          </h2>
          <p className="font-body text-base md:text-lg text-white/90 mb-8 max-w-2xl mx-auto relative z-10">
            {corporate.retreatDescription || DEFAULT_CORPORATE_PAGE_CONTENT.retreat.description}
          </p>
          <button
            className="bg-white text-primary px-8 py-3 rounded-lg font-semibold hover:bg-primary-light transition active:scale-95 relative z-10 min-h-11 shadow-sm"
            onClick={() => scrollToForm()}
          >
            {corporate.retreatCtaLabel || DEFAULT_CORPORATE_PAGE_CONTENT.retreat.ctaLabel}
          </button>
        </div>
      </section>

      {/* Inquiry Form Section */}
      <section ref={formRef} className="py-24 bg-white border-t border-gray-100 scroll-mt-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="font-h2 font-heading text-3xl text-gray-900">Corporate Inquiry Form</h2>
            <p className="mt-3 text-sm text-gray-600">
              Fill out this form and a corporate accounts specialist will reach out within 24 hours.
            </p>
          </div>

          <div className="rounded-card bg-gray-50 p-6 md:p-10 shadow-sm ring-1 ring-gray-150 relative">
            {isSubmitted ? (
              <motion.div 
                className="text-center py-10"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-green-600">
                  <CheckCircle2 size={32} />
                </div>
                <h3 className="mt-6 text-xl font-semibold text-gray-900">Inquiry Submitted Successfully</h3>
                <p className="mx-auto mt-3 max-w-md text-sm text-gray-600 leading-relaxed">
                  Thank you for your interest! A corporate accounts representative will review your request and contact you via email at your provided address within 24 hours.
                </p>
                <div className="mt-8 flex justify-center">
                  <GhostButton 
                    type="button" 
                    onClick={() => setIsSubmitted(false)}
                    className="text-sm"
                  >
                    Submit Another Inquiry
                  </GhostButton>
                </div>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                {formError && (
                  <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600 flex items-start gap-2.5">
                    <Info size={18} className="shrink-0 mt-0.5" />
                    <span>{formError}</span>
                  </div>
                )}

                {/* Honeypot field (hidden from users) */}
                <div className="absolute -left-[9999px] top-auto h-px w-px opacity-0 pointer-events-none" aria-hidden="true">
                  <label htmlFor="websiteUrl">Do not fill this out if you are human</label>
                  <input
                    id="websiteUrl"
                    type="text"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  {/* Company Name */}
                  <label className="grid gap-2 text-sm font-medium text-gray-700">
                    <span className="flex items-center gap-1.5">
                      <Building size={16} className="text-gray-400" />
                      Company Name <span className="text-red-500">*</span>
                    </span>
                    <input
                      type="text"
                      className="min-h-11 rounded-lg border border-gray-200 px-3.5 text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                      placeholder="e.g. Acme Corp"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      required
                    />
                  </label>

                  {/* Contact Person */}
                  <label className="grid gap-2 text-sm font-medium text-gray-700">
                    <span className="flex items-center gap-1.5">
                      <User size={16} className="text-gray-400" />
                      Contact Person <span className="text-red-500">*</span>
                    </span>
                    <input
                      type="text"
                      className="min-h-11 rounded-lg border border-gray-200 px-3.5 text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                      placeholder="e.g. Maria Santos"
                      value={contactPerson}
                      onChange={(e) => setContactPerson(e.target.value)}
                      required
                    />
                  </label>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  {/* Contact Email */}
                  <label className="grid gap-2 text-sm font-medium text-gray-700">
                    <span className="flex items-center gap-1.5">
                      <Mail size={16} className="text-gray-400" />
                      Contact Email <span className="text-red-500">*</span>
                    </span>
                    <input
                      type="email"
                      className="min-h-11 rounded-lg border border-gray-200 px-3.5 text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                      placeholder="e.g. maria@acme.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </label>

                  {/* Contact Phone */}
                  <label className="grid gap-2 text-sm font-medium text-gray-700">
                    <span className="flex items-center gap-1.5">
                      <Phone size={16} className="text-gray-400" />
                      Contact Phone <span className="text-red-500">*</span>
                    </span>
                    <input
                      type="tel"
                      className="min-h-11 rounded-lg border border-gray-200 px-3.5 text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                      placeholder={`${config.phoneCountryCode} 917 000 0000`}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                    />
                  </label>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  {/* Rooms Required */}
                  <label className="grid gap-2 text-sm font-medium text-gray-700">
                    <span>Rooms Required <span className="text-red-500">*</span></span>
                    <select
                      className="min-h-11 rounded-lg border border-gray-200 px-3.5 text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light bg-white"
                      value={roomsCount}
                      onChange={(e) => setRoomsCount(e.target.value)}
                      required
                    >
                      <option value="1">1-2 rooms</option>
                      <option value="3">3-5 rooms</option>
                      <option value="5">5-10 rooms</option>
                      <option value="10">10+ rooms</option>
                    </select>
                  </label>

                  {/* Preferred Dates */}
                  <label className="grid gap-2 text-sm font-medium text-gray-700">
                    <span className="flex items-center gap-1.5">
                      <Calendar size={16} className="text-gray-400" />
                      Preferred Dates / Month <span className="text-red-500">*</span>
                    </span>
                    <input
                      type="text"
                      className="min-h-11 rounded-lg border border-gray-200 px-3.5 text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                      placeholder="e.g. October 2026 or Oct 12-16"
                      value={preferredDates}
                      onChange={(e) => setPreferredDates(e.target.value)}
                      required
                    />
                  </label>
                </div>

                {/* Special Requirements */}
                <label className="grid gap-2 text-sm font-medium text-gray-700">
                  <span>Special Requirements or Travel Notes</span>
                  <textarea
                    rows={4}
                    className="rounded-lg border border-gray-200 p-3.5 text-gray-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                    placeholder="Describe any special requirements, catering needs, check-in logistics, or questions..."
                    value={specialRequirements}
                    onChange={(e) => setSpecialRequirements(e.target.value)}
                  />
                </label>

                <div
                  ref={turnstileContainerRef}
                  className="flex justify-center"
                ></div>

                <div className="pt-2">
                  <PrimaryButton
                    type="submit"
                    className="w-full text-base font-semibold"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? (
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Submitting Inquiry...
                      </span>
                    ) : (
                      "Submit Corporate Inquiry"
                    )}
                  </PrimaryButton>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* Type Details Modal — opens with a `RoomTypeEntry` directly
          (no per-room indirection). Mirrors the card layout: hero
          image, type label, full description, beds, max occupancy,
          amenity list, and an "Inquire About" CTA that scrolls to
          the inquiry form with the type label pre-filled. */}
      <Modal
        title={selectedType?.label ?? "Room Type Details"}
        open={Boolean(selectedType)}
        onClose={() => setSelectedType(null)}
      >
        {selectedType ? (
          <div className="space-y-6">
            <div className="overflow-hidden rounded-card bg-section-bg">
              {(() => {
                const heroImage = selectedType.imageUrls[0];
                return heroImage ? (
                  <img
                    src={heroImage}
                    alt={selectedType.label}
                    className="h-72 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-72 w-full items-center justify-center text-xs uppercase tracking-wider text-gray-400">
                    Photo coming soon
                  </div>
                );
              })()}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">
                {selectedType.shortLabel}
              </span>
              <span className="text-xs text-gray-500 font-medium">
                Corporate Rates Negotiable
              </span>
            </div>

            <p className="leading-7 text-gray-600">{selectedType.description}</p>

            <div className="grid gap-3 grid-cols-2">
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Beds</p>
                <p className="mt-1 font-semibold text-gray-950">{selectedType.bedDefinition || "—"}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Max Occupancy</p>
                <p className="mt-1 font-semibold text-gray-950">Up to {selectedType.maxCapacity} Guests</p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold text-gray-950">Included Amenities</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedType.amenities.map((amenity) => (
                  <span key={amenity} className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
                    {amenity}
                  </span>
                ))}
              </div>
            </div>

            <div className="border-t border-gray-200 pt-5 flex items-center justify-between gap-4">
              <p className="text-xs text-gray-500">
                Submit an inquiry to receive a contract custom rate proposal for your company.
              </p>
              <PrimaryButton
                type="button"
                onClick={() => {
                  const label = selectedType.label;
                  setSelectedType(null);
                  scrollToForm(label);
                }}
              >
                Inquire About This Type
              </PrimaryButton>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Footer */}
      <Footer />
    </main>
  );
}
