export type BookingRoomRateChoice = "room-only" | "room-breakfast";

export interface BookingRoomCartItem {
  bookingId: string;
  roomType: string;
  rateChoice: BookingRoomRateChoice;
  numAdults: number;
  numChildren: number;
  extraBedCount: number;
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
        extraBedCount: Math.max(0, Math.floor(Number(room.extraBedCount) || 0))
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
  const nextRooms = rooms.map((room) => ({
    ...room,
    numAdults: 0,
    numChildren: 0,
    extraBedCount: 0
  }));
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

  // Remaining guests may use configured rollaway slots. Allocate
  // adults first, then children, and snapshot the exact bed count
  // required by the resulting room occupancy.
  for (const room of nextRooms) {
    const type = capacities.get(room.roomType);
    let extraSlots = Math.max(0, Math.floor(Number(type?.maxExtraBeds) || 0));
    const overflowAdults = Math.min(adultsRemaining, extraSlots);
    room.numAdults += overflowAdults;
    adultsRemaining -= overflowAdults;
    extraSlots -= overflowAdults;
    const overflowChildren = Math.min(childrenRemaining, extraSlots);
    room.numChildren += overflowChildren;
    childrenRemaining -= overflowChildren;
    room.extraBedCount = overflowAdults + overflowChildren;
  }

  return {
    rooms: nextRooms,
    unassignedAdults: adultsRemaining,
    unassignedChildren: childrenRemaining
  };
}

