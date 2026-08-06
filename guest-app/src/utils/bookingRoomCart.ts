export type BookingRoomRateChoice = "room-only" | "room-breakfast";

export interface BookingRoomCartItem {
  bookingId: string;
  roomType: string;
  rateChoice: BookingRoomRateChoice;
  numAdults: number;
  numChildren: number;
  extraBedCount: number;
  /**
   * Per EXB-12 (2026-08-06, per decision #199): whether the
   * guest wants breakfast for the extra-bed occupant(s).
   * When `true`, all `extraBedCount` beds in this room are
   * counted toward the breakfast total. Defaults to `false`
   * (no breakfast for extra beds). The server validates that
   * `extraBedBreakfast` can only be `true` when `extraBedCount > 0`.
   */
  extraBedBreakfast?: boolean;
}

export interface BookingRoomCapacity {
  value: string;
  maxCapacity: number;
  maxChildren?: number;
  maxExtraBeds?: number;
}

export interface GuestDistributionResult {
  rooms: BookingRoomCartItem[];
  unassignedAdults: number;
  unassignedChildren: number;
}

export function serializeBookingRoomCart(rooms: BookingRoomCartItem[]): string {
  return JSON.stringify(rooms);
}

export function parseBookingRoomCart(value: string | null): BookingRoomCartItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((room) => {
      if (
        !room
        || typeof room.bookingId !== "string"
        || typeof room.roomType !== "string"
        || !["room-only", "room-breakfast"].includes(room.rateChoice)
      ) {
        return [];
      }
      return [{
        bookingId: room.bookingId,
        roomType: room.roomType,
        rateChoice: room.rateChoice as BookingRoomRateChoice,
        numAdults: Math.max(0, Math.floor(Number(room.numAdults) || 0)),
        numChildren: Math.max(0, Math.floor(Number(room.numChildren) || 0)),
        extraBedCount: Math.max(0, Math.floor(Number(room.extraBedCount) || 0)),
        // Per EXB-12: preserve the extra-bed breakfast toggle
        // from the URL. Nullish / false / non-boolean → false
        // (no breakfast for extra beds). The server enforces
        // the invariant `extraBedBreakfast implies extraBedCount > 0`.
        extraBedBreakfast: room.extraBedBreakfast === true
      }];
    });
  } catch {
    return [];
  }
}

export function rebalanceGuestDistribution(
  rooms: BookingRoomCartItem[],
  roomTypes: BookingRoomCapacity[],
  totalAdults: number,
  totalChildren: number
): GuestDistributionResult {
  const capacities = new Map(roomTypes.map((type) => [type.value, type]));
  // Per EXB-11 (2026-08-04, per decision #186): the user is
  // in control of the extra-bed count. The cart's per-room
  // `extraBedCount` is the source of truth — we clamp it to
  // the type's `maxExtraBeds` cap but otherwise preserve it.
  // The previous behaviour auto-computed the bed count from
  // the overflow rule, which silently overrode the user
  // choice and hid the price until Step 3.
  const nextRooms = rooms.map((room) => {
    const type = capacities.get(room.roomType);
    const maxExtraBeds = Math.max(0, Math.floor(Number(type?.maxExtraBeds) || 0));
    const requestedBeds = Math.max(0, Math.floor(Number(room.extraBedCount) || 0));
    return {
      ...room,
      numAdults: 0,
      numChildren: 0,
      extraBedCount: Math.min(requestedBeds, maxExtraBeds)
    };
  });
  let adultsRemaining = Math.max(0, Math.floor(totalAdults));
  let childrenRemaining = Math.max(0, Math.floor(totalChildren));

  // Every occupied room needs an adult. This also makes an
  // impossible "three rooms, two adults" distribution explicit.
  for (const room of nextRooms) {
    if (adultsRemaining <= 0) break;
    room.numAdults = 1;
    adultsRemaining -= 1;
  }

  for (const room of nextRooms) {
    const type = capacities.get(room.roomType);
    const adultCap = Math.max(1, Math.floor(Number(type?.maxCapacity) || 1));
    const roomForAdults = Math.min(adultsRemaining, Math.max(adultCap - room.numAdults, 0));
    room.numAdults += roomForAdults;
    adultsRemaining -= roomForAdults;
  }

  for (const room of nextRooms) {
    const type = capacities.get(room.roomType);
    const childCap = Math.max(0, Math.floor(Number(type?.maxChildren) || 0));
    const roomForChildren = Math.min(childrenRemaining, childCap);
    room.numChildren += roomForChildren;
    childrenRemaining -= roomForChildren;
  }

  // Remaining guests may use the user-set rollaway slots.
  // Allocate adults first, then children; the bed count on
  // the room is whatever the user picked (clamped to the
  // type cap), not a derived overflow count. If the user
  // picked fewer beds than the group needs, the overflow
  // is surfaced as `unassignedAdults` / `unassignedChildren`
  // and the Step 1 submit gate (per CHD-11) catches it.
  for (const room of nextRooms) {
    let extraSlots = room.extraBedCount;
    const overflowAdults = Math.min(adultsRemaining, extraSlots);
    room.numAdults += overflowAdults;
    adultsRemaining -= overflowAdults;
    extraSlots -= overflowAdults;
    const overflowChildren = Math.min(childrenRemaining, extraSlots);
    room.numChildren += overflowChildren;
    childrenRemaining -= overflowChildren;
  }

  return {
    rooms: nextRooms,
    unassignedAdults: adultsRemaining,
    unassignedChildren: childrenRemaining
  };
}
