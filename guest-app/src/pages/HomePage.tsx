import { BedDouble, Car, Coffee, Gift, MapPin, Palmtree, Search, Sparkles, Star, Users, Wifi } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { fadeUp, staggerChild, staggerContainer } from "@spark-inn/shared";
import config from "@config";
import { DateRangePicker } from "../components/DateRangePicker";
import { Footer } from "../components/Footer";
import { GhostButton } from "../components/GhostButton";
import { HeroSkeleton } from "../components/HeroSkeleton";
import { Navbar } from "../components/Navbar";
import { PrimaryButton } from "../components/PrimaryButton";
import { RoomCard } from "../components/RoomCard";
import { useRooms } from "../hooks/useRooms";
import { getRoomTypeImages, getRoomTypeRates, useRoomTypes } from "../hooks/useRoomTypes";
import { usePublicSiteContent } from "../hooks/usePublicSiteContent";
import { MAX_FEATURED_TYPES } from "@spark-inn/shared";

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
  const [checkIn, setCheckIn] = useState("2026-06-12");
  const [checkOut, setCheckOut] = useState("2026-06-14");
  const [guests, setGuests] = useState(2);

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

  function searchAvailability() {
    const params = new URLSearchParams({
      checkIn,
      checkOut,
      guests: String(guests)
    });
    navigate(`/rooms?${params.toString()}`);
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
          <img
            src={heroPhoto}
            alt="Warm boutique hotel pool surrounded by calm tropical greenery"
            className="absolute inset-0 h-full w-full object-cover"
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
          className="relative z-10 mx-auto max-w-4xl pt-16"
          initial={shouldReduceMotion ? false : "hidden"}
          variants={fadeUp}
        >
          {/* `drop-shadow-*` adds a soft glow behind the text so it
              reads on any background. lg on the headline, md on
              the supporting copy. */}
          <p className="font-heading text-lg italic text-white/90 drop-shadow-md sm:text-2xl">
            {config.tagline}
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
            <label className="grid gap-2 text-sm font-medium text-gray-700 lg:min-w-36">
              Guests
              <select
                className="min-h-11 rounded-lg border border-gray-200 px-3 text-gray-950 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light"
                value={guests}
                onChange={(event) => setGuests(Number(event.target.value))}
              >
                {[1, 2, 3, 4, 5, 6].map((value) => (
                  <option key={value} value={value}>
                    {value} {value === 1 ? "guest" : "guests"}
                  </option>
                ))}
              </select>
            </label>
            <PrimaryButton type="button" className="lg:min-w-48" onClick={searchAvailability}>
              <Search size={18} />
              Search
            </PrimaryButton>
          </div>
        </motion.div>
      </section>

      <section className="px-4 pb-16 pt-28 sm:px-6 lg:px-8">
        {sectionTitle(
          "Stay with us",
          "Unassuming comfort, carefully kept",
          "Rooms are intentionally simple: good rest, easy amenities, and the calm you want after exploring Bohol."
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
              />
            ))}
          </motion.div>
        )}
      </section>

      <section className="bg-section-bg px-4 py-16 sm:px-6 lg:px-8">
        {sectionTitle(
          "Amenities",
          "Everything important, nothing fussy",
          "A boutique hotel should make the basics feel graceful. These are the details we keep steady."
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
            "Services",
            "Plans made easier",
            "For tours and transportation, our team can help coordinate the next step. No pressure, no hidden urgency."
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
              <p className="text-sm font-semibold uppercase tracking-wide text-primary">Spark Rewards</p>
              <h2 className="mt-3 font-heading text-3xl sm:text-4xl">{homepage.sparkRewards.heading}</h2>
              <p className="mt-4 max-w-xl leading-7 text-gray-300">{homepage.sparkRewards.description}</p>
              <PrimaryButton to="/rewards" className="mt-8">
                <Gift size={18} />
                Join Spark Rewards
              </PrimaryButton>
            </div>
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
