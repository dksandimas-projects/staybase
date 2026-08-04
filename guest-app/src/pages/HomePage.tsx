import { BedDouble, Car, ChevronDown, Coffee, Gift, MapPin, Minus, Palmtree, Plus, Search, Sparkles, Star, Users, Wifi } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fadeUp, getDateKeyInTimezone, staggerChild, staggerContainer } from "@spark-inn/shared";
import config from "@config";
import { DateRangePicker } from "../components/DateRangePicker";
import { Footer } from "../components/Footer";
import { GhostButton } from "../components/GhostButton";
import { HeroImage } from "../components/HeroImage";
import { HeroSkeleton } from "../components/HeroSkeleton";
import { Navbar } from "../components/Navbar";
import { PrimaryButton } from "../components/PrimaryButton";
import { RoomCard } from "../components/RoomCard";
import { useRooms } from "../hooks/useRooms";
import { getRoomTypeImages, getRoomTypeRates, useRoomTypes } from "../hooks/useRoomTypes";
import { usePublicSiteContent } from "../hooks/usePublicSiteContent";
import { useGuestAuth } from "../context/GuestAuthContext";
import { MAX_FEATURED_TYPES } from "@spark-inn/shared";
import { HOMEPAGE_HERO_LQIP } from "../data/homepage";

const amenityIcons = [BedDouble, MapPin, Users, Sparkles, Wifi, Coffee];

function resolveIcon(name: string | undefined, fallbackIndex: number) {
  const iconMap: Record<string, typeof BedDouble> = {
    bed: BedDouble,
    map: MapPin,
    pin: MapPin,
    users: Users,
    people: Users,
    sparkles: Sparkles,
    star: Star,
    wifi: Wifi,
    coffee: Coffee,
    car: Car,
    palmtree: Palmtree,
    gift: Gift
  };
  if (name && iconMap[name]) return iconMap[name];
  return amenityIcons[fallbackIndex % amenityIcons.length];
}

function sectionTitle(eyebrow: string, title: string, description: string) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>
      <h2 className="mt-3 font-heading text-3xl text-gray-950 sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-7 text-gray-600">{description}</p>
    </div>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();
  const { rooms, loading } = useRooms();
  const { roomTypes } = useRoomTypes();
  const { homepage } = usePublicSiteContent();
  const { user, memberProfile } = useGuestAuth();
  const [checkIn, setCheckIn] = useState(() => getDateKeyInTimezone(config.timezone, 1));
  const [checkOut, setCheckOut] = useState(() => getDateKeyInTimezone(config.timezone, 2));
  // Per CHD-13 (2026-08-04, per decision #187): the
  // homepage "Guests" field is now a popover with two
  // steppers (Adults + Children) instead of a flat
  // 1-6 `<select>`. The split matches the `/book` picker
  // shape so the first-contact widget agrees with the
  // booking flow's pre-fill. Defaults mirror the
  // spec: Adults min 1 max 10 default 2, Children min 0
  // max 10 default 0. The `total` is derived as
  // `adults + children` (what the URL's `guests` param
  // already carries — the `/book` page's
  // `Math.max(0, guests - children)` derivation at
  // `BookingPage.tsx:221` is unchanged).
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const total = adults + children;
  // Popover open/close + the click-outside / Escape
  // dismissal (mirrors the Navbar dropdown pattern at
  // `Navbar.tsx:65-75`).
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!popoverOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current
        && !popoverRef.current.contains(e.target as Node)
        && triggerRef.current
        && !triggerRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [popoverOpen]);

  // Resolve `featuredTypeValues` to a list of physical rooms
  // for the "Stay with us" section. Each type value is matched
  // against the first *active* room of that type — the card
  // content (image, price, bed, amenities, description) all
  // comes from the type via `RoomCard` props, so the room ID is
  // only used for the `key` and the Book-Now deep link.
  //
  // - A type that has no active rooms is skipped silently (we
  //   don't render an empty card).
  // - An empty `featuredTypeValues` falls back to the first
  //   `MAX_FEATURED_TYPES` distinct types that have at least
  //   one active room. The previous model fell back to
  //   `rooms.slice(0, 3)` which could pick multiple rooms of
  //   the same type and miss others entirely.
  const featured = useMemo(() => {
    const typeValues = homepage.featuredTypeValues;
    const orderedTypes: string[] =
      typeValues.length > 0
        ? typeValues
        : (() => {
            const seen = new Set<string>();
            const out: string[] = [];
            for (const r of rooms) {
              if (r.isActive && !seen.has(r.type)) {
                seen.add(r.type);
                out.push(r.type);
                if (out.length >= MAX_FEATURED_TYPES) break;
              }
            }
            return out;
          })();

    const resolved: typeof rooms = [];
    for (const typeValue of orderedTypes) {
      if (resolved.length >= MAX_FEATURED_TYPES) break;
      const candidate = rooms.find((r) => r.type === typeValue && r.isActive);
      if (candidate) resolved.push(candidate);
    }
    return resolved;
  }, [rooms, homepage.featuredTypeValues]);

  // `homepage.heroPhotoUrl` is empty during the initial Firestore
  // load (skeleton shown below) and resolves to either the
  // admin's custom upload or the static `homepageHeroImage`
  // fallback once the hook finishes. The OR was previously
  // needed for the loading phase, but the hook now leaves the
  // field empty during load so the page never flashes the
  // fallback before the custom image arrives.
  const heroPhoto = homepage.heroPhotoUrl;
  const visibleServices = homepage.services.filter((s) => s.isEnabled !== false);
  const sparkRewardsVisible = homepage.sparkRewards.isEnabled !== false;
  const visibleRewards = sparkRewardsVisible
    ? homepage.sparkRewards.perks.filter((p) => p.isEnabled !== false)
    : [];
  const isRewardsMember = !!user && !!memberProfile?.isMember;
  const memberName = memberProfile?.fullName?.split(" ")[0] || user?.displayName?.split(" ")[0] || "there";

  function searchAvailability() {
    const params = new URLSearchParams({
      checkIn,
      checkOut,
      guests: String(total),
      // Per CHD-13 (2026-08-04, per decision #187): the
      // children's count is now part of the URL contract.
      // The `/book` page already reads
      // `searchParams.get("children")` at `BookingPage.tsx:220`
      // (the CHD-10 pre-fill), so the homepage widget just
      // needs to send the new param — the `/book` reader
      // is unchanged.
      children: String(children)
    });
    // Per the catalog-only /rooms refactor: the rooms page no longer
    // surfaces date-aware availability, so the homepage checker's
    // Search button sends guests straight into the booking flow with
    // the dates they just picked. The /rooms page is the
    // "browse all room types" entry point (navbar / footer).
    navigate(`/book?${params.toString()}`);
  }

  const address = `${config.address.street}, ${config.address.city}, ${config.address.region} ${config.address.postalCode}`;
  const mapQuery = encodeURIComponent(address);
  const entranceProps = shouldReduceMotion
    ? {}
    : {
        initial: "hidden",
        whileInView: "visible",
        viewport: { once: true, margin: "-80px" }
      };

  return (
    <main className="min-h-screen bg-white font-body text-gray-900">
      <Navbar overHero />

      <section className="relative -mt-20 flex min-h-screen items-center justify-center overflow-hidden px-4 pt-20 text-center">
        {heroPhoto ? (
          <HeroImage
            src={heroPhoto}
            alt="Warm boutique hotel pool surrounded by calm tropical greenery"
            placeholder={HOMEPAGE_HERO_LQIP}
          />
        ) : (
          <HeroSkeleton />
        )}
        {/* Stronger, directional gradient: light at the top so the
            photo + navbar read well, heavier through the middle
            and bottom so the centered text always pops. The old
            flat `bg-gray-950/45` was easy to read on dark photos
            but disappeared on lighter / high-contrast uploads. */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/55 to-black/70" />
        <motion.div
          animate="visible"
          className="relative z-10 mx-auto max-w-4xl pt-20 pb-20"
          initial={shouldReduceMotion ? false : "hidden"}
          variants={fadeUp}
        >
          {/* `drop-shadow-*` adds a soft glow behind the text so it
              reads on any background. lg on the headline, md on
              the supporting copy. */}
          <p className="font-heading text-lg italic text-white/90 drop-shadow-md sm:text-2xl">
            {homepage.heroEyebrow || config.tagline}
          </p>
          <h1 className="mt-6 font-heading text-5xl leading-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.65)] sm:text-7xl">
            {homepage.heroHeading}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-white/90 drop-shadow-md sm:text-lg">
            {homepage.heroSubtext}
          </p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <PrimaryButton to="/book" className="shadow-lg drop-shadow-md">
              Book your stay
            </PrimaryButton>
            <GhostButton to="/rooms" className="border-white text-white drop-shadow-sm hover:bg-white/10">
              View rooms
            </GhostButton>
          </div>
        </motion.div>
      </section>

      <section className="relative z-20 mx-auto -mt-20 max-w-5xl px-4 sm:px-6 lg:px-8">
        <motion.div
          animate="visible"
          className="rounded-card-lg bg-white p-4 shadow-xl ring-1 ring-gray-200 sm:p-6"
          initial={shouldReduceMotion ? false : "hidden"}
          variants={fadeUp}
        >
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
            <DateRangePicker
              checkIn={checkIn}
              checkOut={checkOut}
              onCheckInChange={setCheckIn}
              onCheckOutChange={setCheckOut}
              orientation="horizontal"
            />
            {/* Per CHD-13 (2026-08-04, per decision #187):
                the "Guests" field is now a popover with
                two steppers (Adults + Children) instead
                of a flat 1-6 `<select>`. The trigger
                shows the current split; the popover
                holds the two stepper rows + a "Done"
                button. The split is sent on Search via
                `guests=adults+children` + `children=N`
                (the `/book` page already reads both —
                `BookingPage.tsx:214` and `:220`). The
                popover dismisses on outside click
                (mousedown) and Escape key (mirrors
                the Navbar dropdown pattern at
                `Navbar.tsx:65-75`). The trigger's
                `aria-haspopup="dialog"` +
                `aria-expanded` + `aria-controls`
                pattern is the standard popover
                contract; the popover's
                `role="dialog"` + `aria-labelledby`
                gives screen readers a name. */}
            <div className="relative grid gap-2 text-sm font-medium text-gray-700 lg:min-w-36">
              <span id="guests-popover-title">Guests</span>
              <button
                ref={triggerRef}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={popoverOpen}
                aria-controls="guests-popover"
                onClick={() => setPopoverOpen((open) => !open)}
                data-testid="guests-trigger"
                className="flex min-h-11 items-center justify-between rounded-lg border border-gray-200 bg-white px-3 text-gray-950 outline-none transition hover:border-gray-300 focus:border-primary focus:ring-2 focus:ring-primary-light"
              >
                <span>
                  {adults} {adults === 1 ? "adult" : "adults"}
                  {children > 0
                    ? `, ${children} ${children === 1 ? "child" : "children"}`
                    : ""}
                </span>
                <ChevronDown
                  size={16}
                  className={`ml-2 shrink-0 text-gray-500 transition ${popoverOpen ? "rotate-180" : ""}`}
                />
              </button>
              {popoverOpen ? (
                <div
                  ref={popoverRef}
                  id="guests-popover"
                  role="dialog"
                  aria-labelledby="guests-popover-title"
                  data-testid="guests-popover"
                  className="absolute left-0 right-0 top-full z-30 mt-2 rounded-card-lg bg-white p-4 shadow-xl ring-1 ring-gray-200"
                >
                  <div className="space-y-3">
                    <div
                      className="flex items-center justify-between gap-3"
                      data-testid="adults-stepper"
                    >
                      <label
                        htmlFor="adults-stepper-input"
                        className="text-sm font-medium text-gray-700"
                      >
                        Adults
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label="Decrease adults count"
                          className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={adults <= 1}
                          onClick={() => setAdults(Math.max(1, adults - 1))}
                        >
                          <Minus size={16} />
                        </button>
                        <span
                          id="adults-stepper-input"
                          aria-live="polite"
                          aria-label="Adults count"
                          className="min-w-8 text-center text-sm font-semibold text-gray-950"
                        >
                          {adults}
                        </span>
                        <button
                          type="button"
                          aria-label="Increase adults count"
                          className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={adults >= 10}
                          onClick={() => setAdults(Math.min(10, adults + 1))}
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                    <div
                      className="flex items-center justify-between gap-3"
                      data-testid="children-stepper"
                    >
                      <label
                        htmlFor="children-stepper-input"
                        className="text-sm font-medium text-gray-700"
                      >
                        Children (0–11)
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label="Decrease children count"
                          className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={children <= 0}
                          onClick={() => setChildren(Math.max(0, children - 1))}
                        >
                          <Minus size={16} />
                        </button>
                        <span
                          id="children-stepper-input"
                          aria-live="polite"
                          aria-label="Children count"
                          className="min-w-8 text-center text-sm font-semibold text-gray-950"
                        >
                          {children}
                        </span>
                        <button
                          type="button"
                          aria-label="Increase children count"
                          className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-600 transition hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={children >= 10}
                          onClick={() => setChildren(Math.min(10, children + 1))}
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPopoverOpen(false)}
                    data-testid="guests-popover-done"
                    className="mt-4 w-full rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-primary-dark"
                  >
                    Done
                  </button>
                </div>
              ) : null}
            </div>
            <PrimaryButton type="button" className="lg:min-w-48" onClick={searchAvailability}>
              <Search size={18} />
              Search
            </PrimaryButton>
          </div>
        </motion.div>
      </section>

      <section className="px-4 pb-16 pt-28 sm:px-6 lg:px-8">
        {sectionTitle(
          homepage.sectionHeaders?.roomsEyebrow || "Stay with us",
          homepage.sectionHeaders?.roomsHeading || "Unassuming comfort, carefully kept",
          homepage.sectionHeaders?.roomsSubtext || "Rooms are intentionally simple: good rest, easy amenities, and the calm you want after exploring Bohol."
        )}
        {loading ? (
          <div className="mx-auto mt-12 grid max-w-7xl gap-6 lg:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <div key={n} className="animate-pulse overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200">
                <div className="aspect-[4/3] bg-gray-200" />
                <div className="p-5 space-y-4">
                  <div className="h-4 bg-gray-200 rounded w-1/4" />
                  <div className="h-6 bg-gray-200 rounded w-3/4" />
                  <div className="space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-full" />
                    <div className="h-4 bg-gray-200 rounded w-5/6" />
                  </div>
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                  <div className="flex justify-between items-center pt-2">
                    <div className="h-6 bg-gray-200 rounded w-1/4" />
                    <div className="h-10 bg-gray-200 rounded w-1/3" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <motion.div
            className="mx-auto mt-12 grid max-w-7xl gap-6 lg:grid-cols-3"
            variants={staggerContainer}
            {...entranceProps}
          >
            {featured.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                typeImageUrls={getRoomTypeImages(roomTypes, room.type)}
                typeMaxCapacity={getRoomTypeRates(roomTypes, room.type)?.maxCapacity}
                typePricePerNight={getRoomTypeRates(roomTypes, room.type)?.pricePerNight}
                typeBedDefinition={roomTypes.find((t) => t.value === room.type)?.bedDefinition}
                typeDescription={roomTypes.find((t) => t.value === room.type)?.description}
                typeAmenities={roomTypes.find((t) => t.value === room.type)?.amenities}
                showStatusBadge={false}
              />
            ))}
          </motion.div>
        )}
      </section>

      <section className="bg-section-bg px-4 py-16 sm:px-6 lg:px-8">
        {sectionTitle(
          homepage.sectionHeaders?.amenitiesEyebrow || "Amenities",
          homepage.sectionHeaders?.amenitiesHeading || "Everything important, nothing fussy",
          homepage.sectionHeaders?.amenitiesSubtext || "A boutique hotel should make the basics feel graceful. These are the details we keep steady."
        )}
        <motion.div
          className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4"
          variants={staggerContainer}
          {...entranceProps}
        >
          {homepage.amenities.map((amenity, index) => {
            const Icon = resolveIcon(amenity.icon, index);

            return (
              <motion.article
                key={amenity.title}
                className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200"
                variants={staggerChild}
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary-light text-primary">
                  <Icon size={20} />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-gray-950">{amenity.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{amenity.description}</p>
              </motion.article>
            );
          })}
        </motion.div>
      </section>

      {visibleServices.length > 0 && (
        <section className="px-4 py-16 sm:px-6 lg:px-8">
          {sectionTitle(
            homepage.sectionHeaders?.servicesEyebrow || "Services",
            homepage.sectionHeaders?.servicesHeading || "Plans made easier",
            homepage.sectionHeaders?.servicesSubtext || "For tours and transportation, our team can help coordinate the next step. No pressure, no hidden urgency."
          )}
          <motion.div
            className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2"
            variants={staggerContainer}
            {...entranceProps}
          >
            {visibleServices.map((service, index) => {
              const Icon = resolveIcon(service.icon, index);

              return (
                <motion.article
                  key={service.title}
                  className="rounded-card-lg bg-white p-6 shadow-sm ring-1 ring-gray-200"
                  variants={staggerChild}
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-light text-primary">
                    <Icon size={22} />
                  </span>
                  <h3 className="mt-5 text-xl font-semibold text-gray-950">{service.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-gray-600">{service.description}</p>
                  <GhostButton to="/contact" className="mt-6">
                    Contact us
                  </GhostButton>
                </motion.article>
              );
            })}
          </motion.div>
        </section>
      )}

      {sparkRewardsVisible && visibleRewards.length > 0 && (
        <section className="bg-sidebar px-4 py-16 text-white sm:px-6 lg:px-8">
          <motion.div
            className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1fr_1.1fr] md:items-center"
            variants={fadeUp}
            {...entranceProps}
          >
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-primary">{config.rewardsName}</p>
              <h2 className="mt-3 font-heading text-3xl sm:text-4xl">
                {isRewardsMember ? `Welcome back, ${memberName}` : homepage.sparkRewards.heading}
              </h2>
              <p className="mt-4 max-w-xl leading-7 text-gray-300">
                {isRewardsMember
                  ? "Your member perks and points are ready whenever you are."
                  : homepage.sparkRewards.description}
              </p>
              <PrimaryButton to={isRewardsMember ? "/account/rewards" : "/rewards"} className="mt-8">
                <Gift size={18} />
                {isRewardsMember ? "View My Rewards" : `Join ${config.rewardsName}`}
              </PrimaryButton>
            </div>
            {!isRewardsMember && (
            <motion.div className="grid gap-3" variants={staggerContainer}>
              {visibleRewards.map((perk) => {
                const Icon = resolveIcon(perk.icon, 0);
                return (
                  <motion.div
                    key={perk.title}
                    className="flex items-center gap-3 rounded-card bg-white/10 p-4 ring-1 ring-white/10"
                    variants={staggerChild}
                  >
                    <Icon size={18} className="text-primary" />
                    <div>
                      <p className="font-medium">{perk.title}</p>
                      {perk.description && (
                        <p className="text-sm text-gray-300">{perk.description}</p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
            )}
          </motion.div>
        </section>
      )}

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <motion.div
          className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center"
          variants={fadeUp}
          {...entranceProps}
        >
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Location</p>
            <h2 className="mt-3 font-heading text-3xl text-gray-950 sm:text-4xl">A practical base in Tagbilaran</h2>
            <p className="mt-4 leading-7 text-gray-600">
              Find us at {address}. Easy to reach, simple to return to, and close to the everyday routes guests need.
            </p>
          </div>
          <div className="overflow-hidden rounded-card-lg bg-gray-100 shadow-sm ring-1 ring-gray-200">
            <iframe
              title={`${config.brandName} map`}
              src={`https://www.google.com/maps?q=${mapQuery}&output=embed`}
              className="h-80 w-full border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </motion.div>
      </section>

      <Footer />
    </main>
  );
}
