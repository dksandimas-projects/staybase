import { Filter, SlidersHorizontal, Users } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fadeUp, staggerContainer, DEFAULT_ROOM_TYPES } from "@spark-inn/shared";
import config from "@config";
import { DateRangePicker } from "../components/DateRangePicker";
import { Drawer } from "../components/Drawer";
import { Footer } from "../components/Footer";
import { GhostButton } from "../components/GhostButton";
import { Modal } from "../components/Modal";
import { Navbar } from "../components/Navbar";
import { PrimaryButton } from "../components/PrimaryButton";
import { RoomCard } from "../components/RoomCard";
import { StatusBadge } from "../components/StatusBadge";
import { useRooms } from "../hooks/useRooms";
import { getRoomTypeImages, useRoomTypes } from "../hooks/useRoomTypes";
import { cn } from "../utils/cn";
import { formatPrice } from "../utils/format";

export function RoomsPage() {
  const shouldReduceMotion = useReducedMotion();
  const [searchParams, setSearchParams] = useSearchParams();
  const { rooms, loading } = useRooms();
  const { roomTypes } = useRoomTypes();
  const [selectedType, setSelectedType] = useState("all");
  const [guests, setGuests] = useState(Number(searchParams.get("guests") ?? 2));
  const [checkIn, setCheckIn] = useState(searchParams.get("checkIn") ?? "2026-06-12");
  const [checkOut, setCheckOut] = useState(searchParams.get("checkOut") ?? "2026-06-14");
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const filteredRooms = useMemo(
    () =>
      rooms.filter((room) => {
        const typeMatches = selectedType === "all" || room.type === selectedType;
        return room.isActive && typeMatches && room.maxCapacity >= guests;
      }),
    [rooms, guests, selectedType]
  );
  const selectedRoom = rooms.find((room) => room.id === selectedRoomId) ?? null;
  const bookingQuery = `&checkIn=${checkIn}&checkOut=${checkOut}`;
  const entranceProps = shouldReduceMotion
    ? {}
    : {
        initial: "hidden",
        whileInView: "visible",
        viewport: { once: true, margin: "-80px" }
      };

  function updateDateParams(nextCheckIn = checkIn, nextCheckOut = checkOut, nextGuests = guests) {
    setSearchParams({
      checkIn: nextCheckIn,
      checkOut: nextCheckOut,
      guests: String(nextGuests)
    });
  }

  function resetFilters() {
    setSelectedType("all");
    setGuests(1);
    updateDateParams(checkIn, checkOut, 1);
  }

  function renderFilters(showApplyButton = false) {
    return (
      <div className="space-y-6">
        <DateRangePicker
          checkIn={checkIn}
          checkOut={checkOut}
          onCheckInChange={(value) => {
            setCheckIn(value);
            updateDateParams(value, checkOut, guests);
          }}
          onCheckOutChange={(value) => {
            setCheckOut(value);
            updateDateParams(checkIn, value, guests);
          }}
        />

        <label className="grid gap-2 text-sm font-medium text-gray-700">
          Guests
          <div className="flex min-h-11 items-center justify-between rounded-lg border border-gray-200 px-3">
            <button
              className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
              type="button"
              onClick={() => {
                const next = Math.max(1, guests - 1);
                setGuests(next);
                updateDateParams(checkIn, checkOut, next);
              }}
            >
              -
            </button>
            <span className="flex items-center gap-2 text-sm text-gray-700">
              <Users size={16} className="text-primary" />
              {guests} {guests === 1 ? "guest" : "guests"}
            </span>
            <button
              className="flex h-8 w-8 items-center justify-center rounded bg-gray-100 text-gray-600"
              type="button"
              onClick={() => {
                const next = Math.min(6, guests + 1);
                setGuests(next);
                updateDateParams(checkIn, checkOut, next);
              }}
            >
              +
            </button>
          </div>
        </label>

        <div>
          <p className="text-sm font-medium text-gray-700">Room type</p>
          <div className="mt-3 grid gap-2">
            {[{ value: "all", label: "All Types" }, ...DEFAULT_ROOM_TYPES].map((type) => (
              <button
                key={type.value}
                className={cn(
                  "flex min-h-11 items-center justify-between rounded-lg border px-3 text-sm font-medium transition",
                  selectedType === type.value
                    ? "border-primary bg-primary-light text-primary"
                    : "border-gray-200 bg-white text-gray-700 hover:border-primary"
                )}
                type="button"
                onClick={() => setSelectedType(type.value)}
              >
                {type.label}
                {selectedType === type.value ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
              </button>
            ))}
          </div>
        </div>

        {showApplyButton ? (
          <PrimaryButton type="button" className="w-full" onClick={() => setIsFilterOpen(false)}>
            Show {filteredRooms.length} rooms
          </PrimaryButton>
        ) : null}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 font-body text-gray-900">
      <Navbar />
      <section className="mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 lg:px-8">
        <motion.div
          animate="visible"
          className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end"
          initial={shouldReduceMotion ? false : "hidden"}
          variants={fadeUp}
        >
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Rooms & rates</p>
            <h1 className="mt-3 font-heading text-4xl text-gray-950 sm:text-5xl">Our rooms</h1>
            <p className="mt-4 max-w-2xl leading-7 text-gray-600">
              Browse comfortable rooms for solo stays, business trips, family visits, and easy Bohol weekends.
            </p>
          </div>
          <PrimaryButton to={`/book?checkIn=${checkIn}&checkOut=${checkOut}`}>Book selected dates</PrimaryButton>
        </motion.div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 sm:px-6 lg:grid-cols-[280px_1fr] lg:px-8">
        <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
          <div className="rounded-card bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-gray-950">
                <Filter size={18} className="text-primary" />
                Filter by
              </h2>
              <button className="text-sm font-semibold text-primary" type="button" onClick={resetFilters}>
                Reset
              </button>
            </div>
            <div className="mt-5">{renderFilters()}</div>
          </div>
        </aside>

        <div>
          <motion.div
            className="mb-5 flex flex-col gap-3 rounded-card bg-white p-4 shadow-sm ring-1 ring-gray-200 sm:flex-row sm:items-center sm:justify-between"
            variants={fadeUp}
            {...entranceProps}
          >
            <div>
              <p className="font-semibold text-gray-950">{filteredRooms.length} rooms match your stay</p>
              <p className="text-sm text-gray-600">Real-time room availability streamed from Firestore.</p>
            </div>
            <GhostButton type="button" className="lg:hidden" onClick={() => setIsFilterOpen(true)}>
              <SlidersHorizontal size={16} />
              Filters
            </GhostButton>
          </motion.div>

          {loading ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
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
          ) : filteredRooms.length > 0 ? (
            <motion.div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3" variants={staggerContainer} {...entranceProps}>
              {filteredRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  typeImageUrls={getRoomTypeImages(roomTypes, room.type)}
                  bookingQuery={bookingQuery}
                  onDetails={() => setSelectedRoomId(room.id)}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div className="rounded-card bg-white p-8 text-center shadow-sm ring-1 ring-gray-200" variants={fadeUp} {...entranceProps}>
              <h2 className="text-xl font-semibold text-gray-950">No rooms match your filters</h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-600">
                Try a smaller guest count or choose all room types to see more options.
              </p>
              <PrimaryButton type="button" className="mt-6" onClick={resetFilters}>
                Reset filters
              </PrimaryButton>
            </motion.div>
          )}
        </div>
      </section>

      <Drawer title="Filter rooms" open={isFilterOpen} onClose={() => setIsFilterOpen(false)}>
        <div className="mb-5 flex items-center justify-between">
          <p className="text-sm font-medium text-gray-600">Adjust dates, guests, and room type.</p>
          <button className="text-sm font-semibold text-primary" type="button" onClick={resetFilters}>
            Reset
          </button>
        </div>
        {renderFilters(true)}
      </Drawer>

      <Modal title={selectedRoom?.name ?? "Room details"} open={Boolean(selectedRoom)} onClose={() => setSelectedRoomId(null)}>
        {selectedRoom ? (
          <div className="space-y-6">
            <div className="overflow-hidden rounded-card bg-section-bg">
              <img
                src={getRoomTypeImages(roomTypes, selectedRoom.type)[0]}
                alt={selectedRoom.name}
                className="h-72 w-full object-cover"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge label={selectedRoom.status === "available" ? "Available" : "Blocked"} status={selectedRoom.status} />
              <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">
                {DEFAULT_ROOM_TYPES.find((type) => type.value === selectedRoom.type)?.label ?? selectedRoom.type}
              </span>
            </div>
            <p className="leading-7 text-gray-600">{selectedRoom.description}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Beds</p>
                <p className="mt-1 font-semibold text-gray-950">{selectedRoom.bedDefinition}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Capacity</p>
                <p className="mt-1 font-semibold text-gray-950">Up to {selectedRoom.maxCapacity}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Weekend</p>
                <p className="mt-1 font-semibold text-gray-950">{formatPrice(selectedRoom.weekendRate)}</p>
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-950">Amenities</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedRoom.amenities.map((amenity) => (
                  <span key={amenity} className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
                    {amenity}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-end justify-between gap-4 border-t border-gray-200 pt-5">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">From</p>
                <p className="text-2xl font-semibold text-gray-950">{formatPrice(selectedRoom.pricePerNight)}</p>
              </div>
              <PrimaryButton to={`/book?roomId=${selectedRoom.id}${bookingQuery}`}>Book this room</PrimaryButton>
            </div>
          </div>
        ) : null}
      </Modal>

      <Footer />
    </main>
  );
}
