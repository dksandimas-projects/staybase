import { motion, useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { fadeUp, staggerContainer } from "@spark-inn/shared";
import { Footer } from "../components/Footer";
import { Modal } from "../components/Modal";
import { Navbar } from "../components/Navbar";
import { PrimaryButton } from "../components/PrimaryButton";
import { RoomTypeCard } from "../components/RoomTypeCard";
import { useRoomTypes } from "../hooks/useRoomTypes";
import { formatPrice } from "../utils/format";

// Catalog-only rooms page. Renders one card per room type from
// `settings/hotelConfig.roomTypes[]` (with the `DEFAULT_ROOM_TYPES`
// fallback from `@spark-inn/shared`). No filters, no availability
// surface, no date handling — that's all the booking flow's job now.
// Per `plan/features/ROOMS-PAGE.md`.
//
// The homepage availability checker's "Search" button now navigates
// straight to `/book` (see `HomePage.tsx`), so this page is the
// "browse all our types" entry point from the navbar / footer.
export function RoomsPage() {
  const shouldReduceMotion = useReducedMotion();
  const { roomTypes, loading } = useRoomTypes();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedTypeValue, setSelectedTypeValue] = useState<string | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);

  const typeParam = searchParams.get("type");

  useEffect(() => {
    if (typeParam && roomTypes.length > 0) {
      const match = roomTypes.find((t) => t.value === typeParam);
      if (match) {
        setSelectedTypeValue(match.value);
      }
    }
  }, [typeParam, roomTypes]);

  const selectedTypeEntry = selectedTypeValue
    ? roomTypes.find((t) => t.value === selectedTypeValue) ?? null
    : null;
  const selectedPhotos = selectedTypeEntry?.imageUrls.filter(Boolean) ?? [];
  const selectedPhoto = selectedPhotos[selectedPhotoIndex] ?? null;

  useEffect(() => {
    setSelectedPhotoIndex(0);
  }, [selectedTypeValue]);

  const handleCloseModal = () => {
    setSelectedTypeValue(null);
    if (searchParams.has("type")) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete("type");
      setSearchParams(newParams);
    }
  };

  const entranceProps = shouldReduceMotion
    ? {}
    : {
        initial: "hidden",
        whileInView: "visible",
        viewport: { once: true, margin: "-80px" }
      };

  return (
    <main className="min-h-screen bg-gray-50 font-body text-gray-900">
      <Navbar />

      <section className="mx-auto max-w-7xl px-4 pb-10 pt-12 sm:px-6 lg:px-8">
        <motion.div
          animate="visible"
          className="grid gap-3"
          initial={shouldReduceMotion ? false : "hidden"}
          variants={fadeUp}
        >
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">Rooms & rates</p>
          <h1 className="font-heading text-4xl text-gray-950 sm:text-5xl">Our rooms</h1>
          <p className="max-w-2xl leading-7 text-gray-600">
            Browse every room type we offer, then pick your dates in the next step.
          </p>
        </motion.div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
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
        ) : roomTypes.length > 0 ? (
          <motion.div
            className="grid gap-6 md:grid-cols-2 xl:grid-cols-3"
            variants={staggerContainer}
            {...entranceProps}
          >
            {roomTypes.map((type) => (
              <RoomTypeCard
                key={type.value}
                type={type}
                onDetails={() => setSelectedTypeValue(type.value)}
              />
            ))}
          </motion.div>
        ) : (
          <div className="rounded-card bg-white p-8 text-center shadow-sm ring-1 ring-gray-200">
            <h2 className="text-xl font-semibold text-gray-950">No room types available right now</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-gray-600">
              Our room catalog is being updated. Please check back in a few minutes, or contact us for help.
            </p>
          </div>
        )}
      </section>

      <Modal
        title={selectedTypeEntry?.label ?? "Room type details"}
        open={Boolean(selectedTypeEntry)}
        onClose={handleCloseModal}
      >
        {selectedTypeEntry ? (
          <div className="space-y-6">
            <div className="overflow-hidden rounded-card bg-section-bg">
              {selectedPhoto ? (
                <div className="relative">
                  <img
                    src={selectedPhoto}
                    alt={`${selectedTypeEntry.label} photo ${selectedPhotoIndex + 1}`}
                    className="h-72 w-full object-cover"
                  />
                  {selectedPhotos.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setSelectedPhotoIndex((index) => (index - 1 + selectedPhotos.length) % selectedPhotos.length)}
                        className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-sm transition hover:bg-white"
                        aria-label="Previous room photo"
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedPhotoIndex((index) => (index + 1) % selectedPhotos.length)}
                        className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-gray-900 shadow-sm transition hover:bg-white"
                        aria-label="Next room photo"
                      >
                        <ChevronRight size={20} />
                      </button>
                      <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2">
                        {selectedPhotos.map((photo, index) => (
                          <button
                            key={`${photo}-${index}`}
                            type="button"
                            onClick={() => setSelectedPhotoIndex(index)}
                            className={`h-2.5 w-2.5 rounded-full transition ${index === selectedPhotoIndex ? "bg-white" : "bg-white/50"}`}
                            aria-label={`Show room photo ${index + 1}`}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div
                  className="flex h-72 w-full items-center justify-center text-xs uppercase tracking-wider text-gray-400"
                  aria-label={`No photo for ${selectedTypeEntry.label}`}
                >
                  Photo coming soon
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">
                {selectedTypeEntry.shortLabel}
              </span>
            </div>
            <p className="leading-7 text-gray-600">{selectedTypeEntry.description || "—"}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Beds</p>
                <p className="mt-1 font-semibold text-gray-950">{selectedTypeEntry.bedDefinition || "—"}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Capacity</p>
                <p className="mt-1 font-semibold text-gray-950">Up to {selectedTypeEntry.maxCapacity ?? "—"}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-4">
                <p className="text-xs uppercase tracking-wide text-gray-500">Weekend</p>
                <p className="mt-1 font-semibold text-gray-950">{formatPrice(selectedTypeEntry.weekendRate)}</p>
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-950">Amenities</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedTypeEntry.amenities.map((amenity) => (
                  <span key={amenity} className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-600">
                    {amenity}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-end justify-between gap-4 border-t border-gray-200 pt-5">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">From</p>
                <p className="text-2xl font-semibold text-gray-950">{formatPrice(selectedTypeEntry.pricePerNight)}</p>
              </div>
              <PrimaryButton to="/book">Book this type</PrimaryButton>
            </div>
          </div>
        ) : null}
      </Modal>

      <Footer />
    </main>
  );
}
