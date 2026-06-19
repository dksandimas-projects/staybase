import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import { DEFAULT_ROOM_TYPES, type RoomTypeEntry } from "@spark-inn/shared";

interface UseRoomTypesResult {
  roomTypes: RoomTypeEntry[];
  loading: boolean;
  error: Error | null;
}

// Live subscription to the room type catalog stored at
// `settings/hotelConfig.roomTypes[]`. Falls back to
// `DEFAULT_ROOM_TYPES` from `@spark-inn/shared` when the field is
// missing or empty. Per `plan/features/SETTINGS.md §Room Types`,
// each entry carries its own `imageUrls[]` — the guest site joins
// this list on the room's `type` field to render the gallery.
export function useRoomTypes(): UseRoomTypesResult {
  const [roomTypes, setRoomTypes] = useState<RoomTypeEntry[]>(() =>
    DEFAULT_ROOM_TYPES.map((t) => ({ ...t, imageUrls: [...t.imageUrls] }))
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "settings", "hotelConfig"),
      (snap) => {
        const data = snap.data();
        const raw = Array.isArray(data?.roomTypes) ? (data!.roomTypes as unknown[]) : [];
        if (raw.length === 0) {
          setRoomTypes(DEFAULT_ROOM_TYPES.map((t) => ({ ...t, imageUrls: [...t.imageUrls] })));
        } else {
          const normalized: RoomTypeEntry[] = raw
            .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
            .map((entry) => ({
              value: String(entry.value ?? ""),
              label: String(entry.label ?? entry.value ?? ""),
              shortLabel: String(entry.shortLabel ?? entry.label ?? entry.value ?? ""),
              imageUrls: Array.isArray(entry.imageUrls)
                ? (entry.imageUrls as unknown[]).filter((u): u is string => typeof u === "string")
                : []
            }))
            .filter((t) => t.value.length > 0);
          setRoomTypes(normalized);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Error streaming room types:", err);
        setError(err);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, []);

  return { roomTypes, loading, error };
}

export function getRoomTypeImages(types: RoomTypeEntry[], typeValue: string): string[] {
  return types.find((t) => t.value === typeValue)?.imageUrls ?? [];
}
