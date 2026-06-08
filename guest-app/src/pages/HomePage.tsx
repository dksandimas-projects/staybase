import { BedDouble, Car, Gift, MapPin, Palmtree, Search, Sparkles, Star, Users } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fadeUp, staggerChild, staggerContainer } from "@spark-inn/shared";
import config from "@config";
import { DateRangePicker } from "../components/DateRangePicker";
import { Footer } from "../components/Footer";
import { GhostButton } from "../components/GhostButton";
import { Navbar } from "../components/Navbar";
import { PrimaryButton } from "../components/PrimaryButton";
import { RoomCard } from "../components/RoomCard";
import { amenities, featuredRooms, homepageHeroImage, rewardPerks, services } from "../data/homepage";

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
  const [checkIn, setCheckIn] = useState("2026-06-12");
  const [checkOut, setCheckOut] = useState("2026-06-14");
  const [guests, setGuests] = useState(2);

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
        <img
          src={homepageHeroImage}
          alt="Warm boutique hotel pool surrounded by calm tropical greenery"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gray-950/45" />
        <motion.div
          animate="visible"
          className="relative z-10 mx-auto max-w-4xl pt-16"
          initial={shouldReduceMotion ? false : "hidden"}
          variants={fadeUp}
        >
          <p className="font-heading text-lg italic text-white/90 sm:text-2xl">{config.tagline}</p>
          <h1 className="mt-6 font-heading text-5xl leading-tight text-white sm:text-7xl">Your sanctuary in Bohol</h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-white/90 sm:text-lg">
            A warm, minimalist stay where comfort feels natural and care is quietly intentional.
          </p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <PrimaryButton to="/book" className="shadow-lg">
              Book your stay
            </PrimaryButton>
            <GhostButton to="/rooms" className="border-white text-white hover:bg-white/10">
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
        <motion.div
          className="mx-auto mt-12 grid max-w-7xl gap-6 lg:grid-cols-3"
          variants={staggerContainer}
          {...entranceProps}
        >
          {featuredRooms.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </motion.div>
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
          {amenities.map((amenity, index) => {
            const icons = [BedDouble, MapPin, Users, Sparkles];
            const Icon = icons[index] ?? Sparkles;

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
          {services.map((service, index) => {
            const Icon = index === 0 ? Palmtree : Car;

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

      <section className="bg-sidebar px-4 py-16 text-white sm:px-6 lg:px-8">
        <motion.div
          className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1fr_1.1fr] md:items-center"
          variants={fadeUp}
          {...entranceProps}
        >
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Spark Rewards</p>
            <h2 className="mt-3 font-heading text-3xl sm:text-4xl">Stay often, feel known</h2>
            <p className="mt-4 max-w-xl leading-7 text-gray-300">
              Join the loyalty program built for repeat guests, corporate travelers, and anyone who wants a smoother next stay.
            </p>
            <PrimaryButton to="/rewards" className="mt-8">
              <Gift size={18} />
              Join Spark Rewards
            </PrimaryButton>
          </div>
          <motion.div className="grid gap-3" variants={staggerContainer}>
            {rewardPerks.map((perk) => (
              <motion.div
                key={perk}
                className="flex items-center gap-3 rounded-card bg-white/10 p-4 ring-1 ring-white/10"
                variants={staggerChild}
              >
                <Star size={18} className="text-primary" />
                <span className="font-medium">{perk}</span>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>
      </section>

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
