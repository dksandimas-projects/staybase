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
    | "imageUrls"
    | "maxCapacity"
    | "bedDefinition"
    | "pricePerNight"
    | "status"
  >;
  onDetails?: () => void;
  bookingQuery?: string;
}

export function RoomCard({ room, onDetails, bookingQuery = "" }: RoomCardProps) {
  const shouldReduceMotion = useReducedMotion();
  const typeLabel = DEFAULT_ROOM_TYPES.find((type) => type.value === room.type)?.shortLabel ?? room.type;

  return (
    <motion.article
      className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200"
      transition={{ duration: 0.2, ease: "easeOut" }}
      variants={staggerChild}
      whileHover={shouldReduceMotion ? undefined : { y: -4 }}
    >
      <div className="aspect-[4/3] overflow-hidden bg-section-bg">
        <motion.img
          src={room.imageUrls[0]}
          alt={room.name}
          className="h-full w-full object-cover"
          transition={{ duration: 0.4, ease: "easeOut" }}
          whileHover={shouldReduceMotion ? undefined : { scale: 1.03 }}
        />
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
            Up to {room.maxCapacity}
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
            <p className="text-xl font-semibold text-gray-950">{formatPrice(room.pricePerNight)}</p>
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
