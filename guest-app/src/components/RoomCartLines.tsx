import type { RoomTypeEntry } from "@shared/constants";
import { deriveRoomTypeCapacityFit } from "@shared/utils/roomTypes";
import type { BookingRoomCartItem } from "../utils/bookingRoomCart";

export interface GroupedCartLine {
  roomType: string;
  label: string;
  quantity: number;
  adults: number;
  children: number;
  extraBeds: number;
}

interface RoomCartLinesProps {
  rooms: BookingRoomCartItem[];
  roomTypes: RoomTypeEntry[];
  /** Prefix for the per-line test ids, so two instances can coexist. */
  idPrefix?: string;
}

/**
 * Group a flat `distributedRoomCart` into one line per distinct room type.
 *
 * Per CHD-12 (2026-08-04, decision #185) the cart is summarised by TYPE,
 * not by positional room ("Room 1 / Room 2 / Room N"). Positional names
 * are meaningless to a guest who picked three Delexes, and a per-room
 * occupancy list implied the guest had chosen a per-room split when the
 * numbers were an auto-rebalance result.
 *
 * Extracted in MBUX-03 so the desktop sidebar and the new mobile tray
 * render the SAME aggregation. Before this, the grouping lived in an
 * IIFE inside the Step 1 sidebar — a second surface would have meant
 * copying that block, and the two would drift.
 */
export function groupCartByType(
  rooms: BookingRoomCartItem[],
  roomTypes: RoomTypeEntry[]
): GroupedCartLine[] {
  const byType = new Map<string, GroupedCartLine>();
  for (const room of rooms) {
    const entry = byType.get(room.roomType) || {
      roomType: room.roomType,
      label: "",
      quantity: 0,
      adults: 0,
      children: 0,
      extraBeds: 0
    };
    entry.quantity += 1;
    entry.adults += room.numAdults;
    entry.children += room.numChildren;
    entry.extraBeds += room.extraBedCount || 0;
    if (!entry.label) {
      entry.label = roomTypes.find((t) => t.value === room.roomType)?.label || room.roomType;
    }
    byType.set(room.roomType, entry);
  }
  return Array.from(byType.values());
}

/**
 * The grouped cart read surface, shared by the desktop sidebar and the
 * mobile cart tray (MBUX-03).
 *
 * Each line re-derives its capacity state from `deriveRoomTypeCapacityFit`
 * — the same single helper the room-type card's Fits / Tight /
 * Doesn't fit chip uses (CHD-11 + CHD-12 composition). One helper, two
 * surfaces, so the sidebar can never disagree with the card.
 */
export function RoomCartLines({ rooms, roomTypes, idPrefix = "cart-line" }: RoomCartLinesProps) {
  const lines = groupCartByType(rooms, roomTypes);
  if (lines.length === 0) {
    return <p className="mt-2 text-xs text-gray-500">Add at least one room to begin.</p>;
  }

  return (
    <div className="mt-3 space-y-2">
      {lines.map((agg) => {
        const fit = deriveRoomTypeCapacityFit({
          type: roomTypes.find((t) => t.value === agg.roomType) || { maxCapacity: 0, maxChildren: 0, maxExtraBeds: 0 },
          numAdults: agg.adults,
          numChildren: agg.children,
          currentCartCount: agg.quantity
        });
        const fitChip =
          fit.state === "fits" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              Fits
            </span>
          ) : fit.state === "tight" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Tight
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-700">
              Doesn't fit
            </span>
          );
        return (
          <div
            key={agg.roomType}
            className="flex items-start justify-between gap-3 rounded-lg bg-white px-3 py-2 text-xs text-gray-600"
            data-testid={`${idPrefix}-${agg.roomType}`}
          >
            <span className="flex-1">
              <span className="block font-semibold text-gray-900">
                {agg.quantity}× {agg.label} {fitChip}
              </span>
              {agg.adults} adult{agg.adults === 1 ? "" : "s"}
              {agg.children > 0 ? ` · ${agg.children} child${agg.children === 1 ? "" : "ren"}` : ""}
            </span>
            {agg.extraBeds > 0 ? (
              <span className="rounded-full bg-primary-light px-2 py-1 font-semibold text-primary">
                {agg.extraBeds} extra bed{agg.extraBeds === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}