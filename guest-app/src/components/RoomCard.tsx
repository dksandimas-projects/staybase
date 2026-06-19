import { Users } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { Room } from "@spark-inn/shared";
import { staggerChild, DEFAULT_ROOM_TYPES } from "@spark-inn/shared";
import config from "@config";
import { formatPrice } from "../utils/format";
import { GhostButton } from "./GhostButton";
import { PrimaryButton } from "./PrimaryButton";
import { StatusBadge } from "./StatusBadge";

interface RoomCardProps {
  room: Pick<
    Room,
    | "id"
    | "name"
    | "type"
    | "description"
    | "amenities"
    | "bedDefinition"
    | "status"
  >;
  // Per `plan/features/SETTINGS.md §Room Types` and `plan/features/ROOMS-PAGE.md`:
  // the gallery and rate matrix are owned by the room type, not the
  // individual room. The caller resolves both (live from `useRoomTypes()`
  // or the static `ROOM_TYPE_IMAGES` / `ROOM_TYPE_RATES` fallbacks)
  // and passes the data here.
  typeImageUrls?: string[];
  // Per W3.6 — `plan/features/RATE-MANAGEMENT.md §W3.6`: pricing +
  // max occupancy are sourced from the type. The card uses the type's
  // `maxCapacity` for the "Up to N" label and `pricePerNight` for the
  // "From" price.
  typeMaxCapacity?: number;
  typePricePerNight?: number;
  onDetails?: () => void;
  bookingQuery?: string;
}

export function RoomCard({
  room,
  typeImageUrls = [],
  typeMaxCapacity,
  typePricePerNight,
  onDetails,
  bookingQuery = ""
}: RoomCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const typeLabel = DEFAULT_ROOM_TYPES.find((type) => type.value === room.type)?.shortLabel ?? room.type;
  const heroImage = typeImageUrls[0];
  const maxCapacity = typeMaxCapacity ?? DEFAULT_ROOM_TYPES.find((t) => t.value === room.type)?.maxCapacity ?? 0;
  const pricePerNight = typePricePerNight ?? DEFAULT_ROOM_TYPES.find((t) => t.value === room.type)?.pricePerNight ?? 0;

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
            alt={room.name}
            className="h-full w-full object-cover"
            transition={{ duration: 0.4, ease: "easeOut" }}
            whileHover={shouldReduceMotion ? undefined : { scale: 1.03 }}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-xs uppercase tracking-wider text-gray-400"
            aria-label={`No photo for ${room.name}`}
          >
            Photo coming soon
          </div>
        )}
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="rounded-full bg-primary-light px-3 py-1 text-xs font-semibold text-primary">{typeLabel}</span>
            <h3 className="mt-3 text-lg font-semibold text-gray-950">{room.name}</h3>
          </div>
          <StatusBadge label={room.status === "available" ? "Available" : "Blocked"} status={room.status} />
        </div>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-gray-600">{room.description}</p>
        <div className="mt-4 grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
          <span className="flex items-center gap-2">
            <Users size={16} className="text-primary" />
            Up to {maxCapacity}
          </span>
          <span className="truncate">{room.bedDefinition}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {room.amenities.slice(0, 4).map((amenity) => (
            <span key={amenity} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
              {amenity}
            </span>
          ))}
        </div>
        <div className="mt-5 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-gray-500">From</p>
            <p className="text-xl font-semibold text-gray-950">{formatPrice(pricePerNight)}</p>
          </div>
          <div className="flex gap-2">
            {onDetails ? (
              <GhostButton type="button" onClick={onDetails}>
                Details
              </GhostButton>
            ) : null}
            <PrimaryButton to={`/book?roomId=${room.id}${bookingQuery}`}>Book</PrimaryButton>
          </div>
        </div>
      </div>
    </motion.article>
  );
}
