import { Users } from "lucide-react";
import type { Room } from "@spark-inn/shared";
import { formatPrice } from "../utils/format";
import { GhostButton } from "./GhostButton";
import { PrimaryButton } from "./PrimaryButton";
import { StatusBadge } from "./StatusBadge";

interface RoomCardProps {
  room: Pick<Room, "name" | "description" | "amenities" | "imageUrls" | "maxCapacity" | "pricePerNight" | "status">;
  onDetails?: () => void;
}

export function RoomCard({ room, onDetails }: RoomCardProps) {
  return (
    <article className="overflow-hidden rounded-card bg-white shadow-sm ring-1 ring-gray-200">
      <div className="aspect-[4/3] bg-section-bg">
        <img src={room.imageUrls[0]} alt={room.name} className="h-full w-full object-cover" />
      </div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-950">{room.name}</h3>
          <StatusBadge label={room.status === "available" ? "Available" : "Blocked"} status={room.status} />
        </div>
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-gray-600">{room.description}</p>
        <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
          <Users size={16} className="text-primary" />
          Up to {room.maxCapacity} guests
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
            <PrimaryButton to="/book">Book</PrimaryButton>
          </div>
        </div>
      </div>
    </article>
  );
}
