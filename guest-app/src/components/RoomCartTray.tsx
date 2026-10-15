import { useState } from "react";
import { ChevronDown, ChevronUp, ShoppingBag } from "lucide-react";
import type { RoomTypeEntry } from "@shared/constants";
import { RoomCartLines, groupCartByType } from "./RoomCartLines";
import type { BookingRoomCartItem } from "../utils/bookingRoomCart";

interface RoomCartTrayProps {
  rooms: BookingRoomCartItem[];
  roomTypes: RoomTypeEntry[];
  /** Formats the aggregate room total for the stay. */
  formatTotal: (value: number) => string;
  aggregateTotal: number;
  /** Whether the group is fully placed in the selected rooms. */
  fitComplete: boolean;
}

/**
 * The mobile multi-room cart tray (MBUX-03).
 *
 * **Why it exists.** After MBUX-02 made the room card itself the
 * selection target, a guest could select three different room types
 * and Step 1 had no way to show them what they had actually picked —
 * the per-card counters no longer summed to anything visible on a
 * phone. The desktop sidebar already answered this question; mobile
 * did not. The tray is that answer at phone widths.
 *
 * **Why it lives above the sticky footer.** That is the only region a
 * thumb reaches and the only region that is never scrolled away from.
 * Putting the tray in the page body would make it scroll off, which is
 * exactly the regression MBUX-01 just fixed elsewhere.
 *
 * **Grouped, never positional.** The expanded lines are the same
 * `<RoomCartLines>` component the desktop sidebar renders, so the tray
 * shows `2× Deluxe Room` — never "Room 1", "Room 2" (CHD-12).
 *
 * **Collapsed by default.** The collapsed row carries the four facts
 * that change the next decision: how many rooms, the fit state, the
 * aggregate total, and whether to expand. The full breakdown is one
 * tap away but never in the way.
 */
export function RoomCartTray({ rooms, roomTypes, formatTotal, aggregateTotal, fitComplete }: RoomCartTrayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (rooms.length === 0) return null;

  const lines = groupCartByType(rooms, roomTypes);
  const totalRooms = lines.reduce((sum, line) => sum + line.quantity, 0);
  const adults = lines.reduce((sum, line) => sum + line.adults, 0);
  const children = lines.reduce((sum, line) => sum + line.children, 0);

  return (
    <div
      className="rounded-card border border-gray-200 bg-gray-50 px-4 py-3"
      data-testid="room-cart-tray"
    >
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        aria-expanded={isExpanded}
        aria-controls="room-cart-tray-lines"
        className="flex min-h-11 w-full items-center gap-3 text-left"
      >
        <ShoppingBag size={18} className="shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-950">
            {totalRooms} {totalRooms === 1 ? "room" : "rooms"} selected
          </span>
          <span className="block text-xs text-gray-600">
            {adults} adult{adults === 1 ? "" : "s"}
            {children > 0 ? ` · ${children} child${children === 1 ? "" : "ren"}` : ""}
            {!fitComplete ? " · still need a room" : ""}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-gray-950">{formatTotal(aggregateTotal)}</span>
        {isExpanded ? (
          <ChevronUp size={18} className="shrink-0 text-gray-500" aria-hidden />
        ) : (
          <ChevronDown size={18} className="shrink-0 text-gray-500" aria-hidden />
        )}
      </button>
      <div id="room-cart-tray-lines" hidden={!isExpanded}>
        <RoomCartLines rooms={rooms} roomTypes={roomTypes} idPrefix="cart-tray-line" />
      </div>
    </div>
  );
}