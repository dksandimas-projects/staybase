import { useEffect, useState } from "react";
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
import { usePublicHotelConfig } from "./usePublicHotelConfig";

interface UseRoomTypesResult {
  roomTypes: RoomTypeEntry[];
  seasonalRateOverrides: SeasonalRateOverride[];
  // Per SR-01..05 (2026-10-12): the admin-configurable
  // bed set-ups + additional preferences catalogs (both
  // live on `settings/hotelConfig`, the same doc the
  // room-type catalog is read from). Hydrated from the
  // same payload with the same "absent → seed default"
  // pattern used for room types.
  bedSetups: BedSetupOption[];
  bookingPreferences: BookingPreferenceOption[];
  loading: boolean;
  error: Error | null;
}

// The room type catalog (plus the seasonal overrides, the bed set-ups
// and the booking preferences) comes from the PUBLIC PROJECTION of
// `settings/hotelConfig` — `GET /api/public/hotel-config`.
//
// Per F09 / SEC-6 (2026-10-22): the hook used to open a Firestore
// `onSnapshot` on `settings/hotelConfig`. The rules allowed
// `allow read: if true` on `settings/{documentId}`, so that
// subscription — and every other anonymous client — could read the
// hotel's NEGOTIATED corporate rate ladder
// (`roomTypes[].corporateRate`) straight out of the document. The
// rules now keep the raw document away from unauthenticated clients
// and the guest app reads the corporate-rate-free projection instead.
//
// The projection never carries `corporateRate`, so every guest-side
// `RoomTypeEntry.corporateRate` is 0. The corporate rate is resolved
// SERVER-side on the corporate booking path.
export function useRoomTypes(): UseRoomTypesResult {
  const { config, isLoading, error: configError } = usePublicHotelConfig();
  const [roomTypes, setRoomTypes] = useState<RoomTypeEntry[]>(() =>
    DEFAULT_ROOM_TYPES.map((t) => ({
      ...t,
      imageUrls: [...t.imageUrls],
      amenities: [...t.amenities],
      bedSetupValues: Array.isArray(t.bedSetupValues) ? [...t.bedSetupValues] : []
    }))
  );
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
    if (!config) {
      if (configError) setError(new Error(configError));
      return;
    }
    const raw = Array.isArray(config.roomTypes) ? (config.roomTypes as unknown[]) : [];
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
            // Per F09 / SEC-6 (2026-10-22): the public projection
            // never carries `corporateRate` — the negotiated
            // corporate ladder must not reach a browser. The
            // corporate rate is resolved server-side on the
            // corporate booking path.
            corporateRate: 0,
            maxExtraBeds: entry.maxExtraBeds ?? fallback?.maxExtraBeds,
            extraBedRate: entry.extraBedRate ?? fallback?.extraBedRate,
            // Per SR-01..05 (2026-10-12): the per-type
            // bed-set-up subset. `applyRoomTypeDefaults`
            // also normalizes this field — pass it through
            // explicitly here so the local mapping + the
            // helper agree on the wire shape.
            //
            // Per OCT-M2 (2026-10-20, decision #290): this
            // field must NOT fall back to the
            // `DEFAULT_ROOM_TYPES` seed. The seed was the one
            // place the guest client and the server
            // disagreed:
            //
            //   | Surface            | Field absent → |
            //   |--------------------|---------------|
            //   | Guest `useRoomTypes` | seed defaults |
            //   | Shared normalizer   | `[]`          |
            //   | Admin mapper        | `[]`          |
            //   | Server              | `[]`          |
            //
            // The server VALIDATES the guest's choice against
            // the STORED type's subset, so for a room type
            // saved before SR-01 shipped (2026-10-12) the guest
            // was offered `large-bed` / `twin-beds` and the
            // server rejected BOTH with a 400 — and because the
            // radio group had no "no preference" escape, every
            // option 400'd and the guest was stuck with a
            // filled-in form they could not submit.
            //
            // The guest now matches the server (and the admin
            // mapper, and the shared normalizer): a stored type
            // with no `bedSetupValues` offers NO bed set-up
            // options, so the group does not render at all and
            // the guest can never pick an un-offered value.
            //
            // The `raw.length === 0` branch above is a
            // different case — the hotel has no stored room
            // types at all, so the whole catalog is the
            // seed — and it keeps the seed's own
            // `bedSetupValues`.
            bedSetupValues: Array.isArray(entry.bedSetupValues)
              ? (entry.bedSetupValues as unknown[]).filter((v): v is string => typeof v === "string")
              : []
          });
        })
        .filter((t) => t.value.length > 0);
      setRoomTypes(normalized);
    }
    setSeasonalRateOverrides(normalizeSeasonalRateOverrides(config.seasonalRateOverrides));
    // Per SR-01..05 (2026-10-12): the catalog
    // hydration mirrors the room-types pattern. The
    // admin's write to `settings/hotelConfig.bedSetups`
    // / `.bookingPreferences` reaches us on the same
    // payload.
    setBedSetups(hydrateBedSetupCatalog(config.bedSetups));
    setBookingPreferences(hydrateBookingPreferenceCatalog(config.bookingPreferences));
    setError(null);
  }, [config]);

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

return { roomTypes, seasonalRateOverrides, bedSetups, bookingPreferences, loading: isLoading, error };
}

export function getRoomTypeImages(types: RoomTypeEntry[], typeValue: string): string[] {
  return types.find((t) => t.value === typeValue)?.imageUrls ?? [];
}

// Per W3.6 — `plan/features/RATE-MANAGEMENT.md §W3.6`: pricing + max
// occupancy live on the room type. This helper is the canonical lookup
// for the booking flow and the public room cards.
//
// Per F09 / SEC-6 (2026-10-22): `corporateRate` is 0 for every
// guest-side room type — the negotiated corporate ladder never reaches
// the browser. The corporate booking path reads its rate from the
// server (`GET /api/corporate/rates`).
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
