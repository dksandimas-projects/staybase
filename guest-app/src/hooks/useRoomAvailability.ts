import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase/rooms";
import { useRooms } from "./useRooms";
import { useRoomTypes } from "./useRoomTypes";

export interface RoomTypeAvailability {
  total: number;
  available: number;
  firstAvailableRoomId: string | null;
}

interface UseRoomAvailabilityResult {
  byType: Record<string, RoomTypeAvailability>;
  loading: boolean;
}

// Date-aware availability per room type. Joins the live `rooms` and
// `bookings` collections against `settings/hotelConfig.roomTypes[]`
// and returns, for each type, the total number of bookable rooms
// (active + not blocked + fits the guest count) and how many of them
// have no overlapping active booking for the requested window.
//
// Per `plan/features/ROOMS-PAGE.md` — the public rooms page is now
// type-driven. The booking flow's date-overlap logic
// (`guest-app/src/pages/BookingPage.tsx`) and the status filter
// (`status != "cancelled"`) are reused here so both surfaces report
// the same availability.
//
// `firstAvailableRoomId` is pre-picked for the "Book" CTA handoff
// from the rooms page → `/book?roomId=...`. If the page has zero
// available rooms for the type it stays `null` and the CTA is
// disabled.
export function useRoomAvailability(
  checkIn: string,
  checkOut: string,
  guests: number
): UseRoomAvailabilityResult {
  const { rooms, loading: roomsLoading } = useRooms();
  const { roomTypes } = useRoomTypes();
  const [bookings, setBookings] = useState<{ roomId: string; checkIn: Date; checkOut: Date }[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "bookings"), where("status", "!=", "cancelled"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            roomId: data.roomId,
            checkIn: data.checkIn?.toDate() ?? new Date(),
            checkOut: data.checkOut?.toDate() ?? new Date()
          };
        });
        setBookings(list);
        setBookingsLoading(false);
      },
      (err) => {
        console.error("Bookings subscription error:", err);
        setBookingsLoading(false);
      }
    );
    return unsubscribe;
  }, []);

  const byType = useMemo<Record<string, RoomTypeAvailability>>(() => {
    const reqStart = new Date(`${checkIn}T00:00:00Z`);
    const reqEnd = new Date(`${checkOut}T00:00:00Z`);

    const result: Record<string, RoomTypeAvailability> = {};
    for (const type of roomTypes) {
      result[type.value] = { total: 0, available: 0, firstAvailableRoomId: null };
    }

    for (const room of rooms) {
      const cap = roomTypes.find((t) => t.value === room.type)?.maxCapacity ?? 0;
      if (!room.isActive || room.status === "blocked" || cap < guests) continue;
      const entry = result[room.type];
      if (!entry) continue;
      entry.total += 1;

      const hasOverlap = bookings.some((b) => {
        if (b.roomId !== room.id) return false;
        return b.checkIn < reqEnd && b.checkOut > reqStart;
      });
      if (hasOverlap) continue;
      entry.available += 1;
      if (!entry.firstAvailableRoomId) entry.firstAvailableRoomId = room.id;
    }
    return result;
  }, [rooms, roomTypes, bookings, checkIn, checkOut, guests]);

  return {
    byType,
    loading: roomsLoading || bookingsLoading
  };
}
