import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase/config";
import {
  applyRoomTypeDefaults,
  DEFAULT_BED_SETUPS,
  DEFAULT_BOOKING_PREFERENCES,
  DEFAULT_ROOM_TYPES,
  normalizeSeasonalRateOverrides,
  type BedSetupOption,
  type BookingPreferenceOption,
  type RoomTypeEntry,
  type SeasonalRateOverride
} from "@spark-inn/shared";

interface UseRoomTypesResult {
  roomTypes: RoomTypeEntry[];
  seasonalRateOverrides: SeasonalRateOverride[];
  // Per SR-01..05 (2026-10-12): the admin-configurable
  // bed set-ups + additional preferences catalogs (both
  // live on `settings/hotelConfig`, the same doc the
  // room-type subscription reads from). Hydrated from the
  // same snapshot with the same "absent → seed default"
  // pattern used for room types.
  bedSetups: BedSetupOption[];
  bookingPreferences: BookingPreferenceOption[];
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
    DEFAULT_ROOM_TYPES.map((t) => ({
      ...t,
      imageUrls: [...t.imageUrls],
      amenities: [...t.amenities],
      bedSetupValues: Array.isArray(t.bedSetupValues) ? [...t.bedSetupValues] : []
    }))
  );
  const [loading, setLoading] = useState(true);
  const [seasonalRateOverrides, setSeasonalRateOverrides] = useState<SeasonalRateOverride[]>([]);
  // Per SR-01..05 (2026-10-12): the catalog state mirrors
  // the room-types pattern. Seed defaults so a fresh project
  // (no settings doc) renders the screenshot-accurate UI.
  const [bedSetups, setBedSetups] = useState<BedSetupOption[]>(() =>
    DEFAULT_BED_SETUPS.map((o) => ({ ...o }))
  );
  const [bookingPreferences, setBookingPreferences] = useState<BookingPreferenceOption[]>(() =>
    DEFAULT_BOOKING_PREFERENCES.map((o) => ({ ...o }))
  );
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, "settings", "hotelConfig"),
      (snap) => {
        const data = snap.data();
        const raw = Array.isArray(data?.roomTypes) ? (data!.roomTypes as unknown[]) : [];
        if (raw.length === 0) {
          setRoomTypes(
            DEFAULT_ROOM_TYPES.map((t) => ({
              ...t,
              imageUrls: [...t.imageUrls],
              amenities: [...t.amenities],
              bedSetupValues: Array.isArray(t.bedSetupValues) ? [...t.bedSetupValues] : []
            }))
          );
        } else {
          const normalized: RoomTypeEntry[] = raw
            .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
            .map((entry) => {
              const fallback = DEFAULT_ROOM_TYPES.find((d) => d.value === entry.value);
              // Per CHD-02/05 + EXB-01: every guest-side room-type
              // read must retain and normalize the child-cap and
              // extra-bed fields. The historical manual mapping
              // dropped all three, which made every live type look
              // like `maxChildren: 0` with no extra-bed allowance.
              return applyRoomTypeDefaults({
                value: String(entry.value ?? ""),
                label: String(entry.label ?? entry.value ?? ""),
                shortLabel: String(entry.shortLabel ?? entry.label ?? entry.value ?? ""),
                imageUrls: Array.isArray(entry.imageUrls)
                  ? (entry.imageUrls as unknown[]).filter((u): u is string => typeof u === "string")
                  : [],
                // Per W3.7 — bed, description, amenities, capacity,
                // and rates all live on the type. Fall back to the
                // DEFAULT_ROOM_TYPES seed for legacy entries that
                // may not yet have the W3.7 fields.
                bedDefinition: String(entry.bedDefinition ?? fallback?.bedDefinition ?? ""),
                description: String(entry.description ?? fallback?.description ?? ""),
                amenities: Array.isArray(entry.amenities)
                  ? (entry.amenities as unknown[]).filter((a): a is string => typeof a === "string")
                  : (fallback?.amenities ?? []),
                maxCapacity: Number(entry.maxCapacity) || fallback?.maxCapacity || 1,
                maxChildren: entry.maxChildren,
                pricePerNight: Number(entry.pricePerNight) || fallback?.pricePerNight || 0,
                weekendRate: Number(entry.weekendRate) || fallback?.weekendRate || 0,
                corporateRate: Number(entry.corporateRate) || fallback?.corporateRate || 0,
                maxExtraBeds: entry.maxExtraBeds ?? fallback?.maxExtraBeds,
                extraBedRate: entry.extraBedRate ?? fallback?.extraBedRate,
                // Per SR-01..05 (2026-10-12): the
                // per-type bed-set-up subset. `applyRoomTypeDefaults`
                // also normalizes this field — pass it through
                // explicitly here so the local mapping + the
                // helper agree on the wire shape.
                bedSetupValues: Array.isArray(entry.bedSetupValues)
                  ? (entry.bedSetupValues as unknown[]).filter((v): v is string => typeof v === "string")
                  : (fallback?.bedSetupValues ?? [])
              });
            })
            .filter((t) => t.value.length > 0);
          setRoomTypes(normalized);
        }
        setSeasonalRateOverrides(normalizeSeasonalRateOverrides(data?.seasonalRateOverrides));
        // Per SR-01..05 (2026-10-12): the catalog
        // hydration mirrors the room-types pattern. The
        // admin's write to `settings/hotelConfig.bedSetups`
        // / `.bookingPreferences` reaches us on the same
        // snapshot.
        setBedSetups(hydrateBedSetupCatalog((data as Record<string, unknown> | undefined)?.bedSetups));
        setBookingPreferences(
          hydrateBookingPreferenceCatalog((data as Record<string, unknown> | undefined)?.bookingPreferences)
        );
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

  function hydrateBedSetupCatalog(raw: unknown): BedSetupOption[] {
  if (!Array.isArray(raw)) return DEFAULT_BED_SETUPS.map((o) => ({ ...o }));
  const out: BedSetupOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = (entry as { value?: unknown }).value;
    const label = (entry as { label?: unknown }).label;
    if (typeof value !== "string" || typeof label !== "string") continue;
    const icon = (entry as { icon?: unknown }).icon;
    out.push({
      value,
      label,
      icon: typeof icon === "string" ? icon : undefined
    });
  }
  return out.length > 0 ? out : DEFAULT_BED_SETUPS.map((o) => ({ ...o }));
}

function hydrateBookingPreferenceCatalog(raw: unknown): BookingPreferenceOption[] {
  if (!Array.isArray(raw)) return DEFAULT_BOOKING_PREFERENCES.map((o) => ({ ...o }));
  const out: BookingPreferenceOption[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = (entry as { value?: unknown }).value;
    const label = (entry as { label?: unknown }).label;
    if (typeof value !== "string" || typeof label !== "string") continue;
    const icon = (entry as { icon?: unknown }).icon;
    const surchargeNote = (entry as { surchargeNote?: unknown }).surchargeNote;
    out.push({
      value,
      label,
      icon: typeof icon === "string" ? icon : undefined,
      surchargeNote: typeof surchargeNote === "string" ? surchargeNote : undefined
    });
  }
  return out.length > 0 ? out : DEFAULT_BOOKING_PREFERENCES.map((o) => ({ ...o }));
}

return { roomTypes, seasonalRateOverrides, bedSetups, bookingPreferences, loading, error };
}

export function getRoomTypeImages(types: RoomTypeEntry[], typeValue: string): string[] {
  return types.find((t) => t.value === typeValue)?.imageUrls ?? [];
}

// Per W3.6 — `plan/features/RATE-MANAGEMENT.md §W3.6`: pricing + max
// occupancy live on the room type. This helper is the canonical lookup
// for the booking flow and the public room cards.
export function getRoomTypeRates(types: RoomTypeEntry[], typeValue: string): {
  maxCapacity: number;
  pricePerNight: number;
  weekendRate: number;
  corporateRate: number;
} | null {
  const t = types.find((entry) => entry.value === typeValue);
  if (!t) return null;
  return {
    maxCapacity: t.maxCapacity,
    pricePerNight: t.pricePerNight,
    weekendRate: t.weekendRate,
    corporateRate: t.corporateRate
  };
}
