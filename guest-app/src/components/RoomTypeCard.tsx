import { Users } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { RoomTypeEntry } from "@spark-inn/shared";
import { staggerChild } from "@spark-inn/shared";
import { formatPrice } from "../utils/format";
import { GhostButton } from "./GhostButton";
import { PrimaryButton } from "./PrimaryButton";
import { StatusBadge } from "./StatusBadge";

interface RoomTypeCardProps {
  type: RoomTypeEntry;
  // Optional date-aware availability. When all three are provided, the
  // card shows the per-type availability StatusBadge ("X of Y available"
  // / "Sold out for these dates") and the Book CTA is disabled when no
  // room of the type is available. When omitted (catalog context), the
  // StatusBadge is hidden and the Book CTA always links to /book.
  availableCount?: number;
  totalCount?: number;
  firstAvailableRoomId?: string | null;
  bookingQuery?: string;
  onDetails?: () => void;
}

// Card used on the public rooms page (per `plan/features/ROOMS-PAGE.md`).
// Mirrors the visual language of `RoomCard` (12px rounded card, 4:3 hero,
// short-label pill, description, beds, capacity, amenity chips, From ₱X,
// Details + Book CTAs). The source of truth is the room TYPE, not an
// individual room.
//
// The same component supports two contexts:
//   1. Catalog (no availability props) — /rooms page: static card, Book
//      CTA always links to /book. Used since the catalog no longer
//      shows date-aware availability.
//   2. Date-aware availability (all three props passed) — disabled
//      "Sold out" CTA when 0 rooms of the type are available. Reserved
//      for any future surface that needs the variant.
export function RoomTypeCard({
  type,
  availableCount,
  totalCount,
  firstAvailableRoomId,
  bookingQuery = "",
  onDetails
}: RoomTypeCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const heroImage = type.imageUrls[0];
  const hasAvailabilityData =
    availableCount !== undefined && totalCount !== undefined && firstAvailableRoomId !== undefined;
  const isAvailable = hasAvailabilityData
    ? availableCount > 0 && Boolean(firstAvailableRoomId)
    : true;
  const availabilityLabel = hasAvailabilityData
    ? totalCount === 0
      ? "No rooms"
      : availableCount === 0
        ? "Sold out for these dates"
        : `${availableCount} of ${totalCount} available`
    : null;

  const bookTo = hasAvailabilityData
    ? `/book?roomId=${firstAvailableRoomId ?? ""}${bookingQuery}`
    : "/book";

  return (
    <motion.article
      className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200"
      transition={{ duration: 0.2, ease: "easeOut" }}
      variants={staggerChild}
      whileHover={shouldReduceMotion ? undefined : { y: -4 }}
    >
      <div className="aspect-[4/3] overflow-hidden bg-section-bg">
        {heroImage ? (
          <motion.img
            src={heroImage}
            alt={type.label}
            className="h-full w-full object-cover"
            transition={{ duration: 0.4, ease: "easeOut" }}
            whileHover={shouldReduceMotion ? undefined : { scale: 1.03 }}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-xs uppercase tracking-wider text-gray-400"
            aria-label={`No photo for ${type.label}`}
          >
            Photo coming soon
          </div>
        )}
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">
              {type.shortLabel}
            </span>
            <h3 className="mt-3 text-lg font-semibold text-gray-950">{type.label}</h3>
          </div>
          {availabilityLabel ? (
            <StatusBadge
              label={availabilityLabel}
              status={availableCount === 0 ? "occupied" : "available"}
            />
          ) : null}
        </div>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-gray-600">{type.description}</p>
        <div className="mt-4 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
          <span className="flex items-center gap-2">
            <Users size={16} className="text-primary" />
            Up to {type.maxCapacity}
          </span>
          <span className="truncate">{type.bedDefinition}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {type.amenities.slice(0, 4).map((amenity) => (
            <span key={amenity} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
              {amenity}
            </span>
          ))}
        </div>
        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">From</p>
            <p className="text-xl font-semibold text-gray-950">{formatPrice(type.pricePerNight)}</p>
          </div>
          <div className="flex gap-2">
            {onDetails ? (
              <GhostButton type="button" onClick={onDetails}>
                Details
              </GhostButton>
            ) : null}
            {isAvailable ? (
              <PrimaryButton to={bookTo}>Book</PrimaryButton>
            ) : (
              <PrimaryButton
                aria-disabled="true"
                className="pointer-events-none"
                tabIndex={-1}
                to="#"
              >
                Sold out
              </PrimaryButton>
            )}
          </div>
        </div>
      </div>
    </motion.article>
  );
}
