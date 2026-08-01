// Per CHD-02 (2026-08-01, per decision #144 + owner
// decision 2026-07-31 #2): normalize-on-read for the per-room-type
// `maxChildren` cap. The same permissive pattern used for the
// #111 surface flags and EXB-01's `maxExtraBeds` /
// `extraBedRate`. Absent `maxChildren` reads as the seed value
// derived from the room type's own value, NOT a hard-coded
// "2" — a Single that happens to be a couple's-extra-bedding
// custom type can be allowed 0 children, and a Family can
// have 2, without the helper overriding the admin's choice.
//
// `applyRoomTypeDefaults(type)` is the canonical "shape a
// raw settings doc into a `RoomTypeEntry`" helper. Callers
// that read `settings/hotelConfig.roomTypes[]` should route
// the entries through this helper so absent fields
// normalize cleanly. The shared admin context + the server's
// `handleCreateBooking` + `handleCreateWalkin` + room-blocks
// + the rates matrix all benefit from a single
// normalization point.

import type { RoomTypeEntry } from "../constants";

// Per CHD-02 (2026-08-01, per decision #144): the seed
// `maxChildren` is keyed on the room type's `maxCapacity` so
// the default makes sense per the product:
//   - 1 adult max (a Single) → 0 children
//   - 2 adult max → 1 child
//   - 3+ adult max → 2 children
// This matches the spec's "Single realistically allows 0
// children even though the client's stated default is 2"
// note. Admins can tune per-type via the Room Types editor
// (CHD-03); the helper just fills in when the field is
// missing (legacy settings, or a new type added by hand).
const DEFAULT_MAX_CHILDREN_BY_ADULT_CAPACITY: Record<number, number> = {
  1: 0,
  2: 1,
  3: 2,
  4: 2,
  5: 2,
  6: 2
};
const FALLBACK_MAX_CHILDREN = 2;

export function normalizeMaxChildren(raw: unknown, maxCapacity?: number): number {
  const value = Number(raw);
  if (Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  const cap = Number(maxCapacity);
  if (Number.isFinite(cap) && cap > 0 && DEFAULT_MAX_CHILDREN_BY_ADULT_CAPACITY[cap] !== undefined) {
    return DEFAULT_MAX_CHILDREN_BY_ADULT_CAPACITY[cap];
  }
  return FALLBACK_MAX_CHILDREN;
}

// Per EXB-03 (2026-08-01, per decision #145 + owner
// decision 2026-07-31 #1): the overflow rule. Extra beds grant
// additional occupant slots usable by an adult **or** a
// child, so the validation is **not** simply a higher cap
// on each. The precise rule:
//
//   max(0, adults − maxCapacity) + max(0, children − maxChildren)
//   ≤ extraBedCount
//
// i.e. the number of "extra people" beyond the per-type
// cap (split into adult and child overflows) is at most
// the number of extra beds. Each extra bed can serve 1
// extra person (adult or child).
//
// When `extraBedCount === 0`, the rule reduces to
// `max(0, adults − maxCapacity) + max(0, children − maxChildren) ≤ 0`,
// which is the two hard caps that CHD-04 was originally
// written to express. When `extraBedCount > 0`, the rule
// allows overflow up to the extra bed count. The single
// function replaces the two independent hard rejects with
// one generalized check, and it's the only authoritative
// capacity check on the create / walkin / reschedule
// transactions.
//
// Edge cases pinned by the source-text test:
//   - 2 adults in a Single (1 adult cap, 0 children, 0 extra
//     beds) → 1 overflow adult, 0 extra beds → reject.
//   - 2 adults in a Single with 1 extra bed → 1 overflow
//     adult, 1 extra bed → accept.
//   - 2 adults + 1 child in a Single (1 adult cap, 0
//     children, 1 extra bed) → 1 overflow adult + 1
//     overflow child = 2 overflow, 1 extra bed → reject
//     (the rule does not distinguish which extra bed
//     serves which overflow occupant).
export function requiredExtraBedsFor(input: {
  numAdults: number;
  numChildren: number;
  maxCapacity: number;
  maxChildren: number;
}): { overflowAdults: number; overflowChildren: number; requiredExtraBeds: number } {
  const adults = Math.max(0, Math.floor(Number(input.numAdults) || 0));
  const children = Math.max(0, Math.floor(Number(input.numChildren) || 0));
  const maxCapacity = Math.max(0, Math.floor(Number(input.maxCapacity) || 0));
  const maxChildren = Math.max(0, Math.floor(Number(input.maxChildren) || 0));
  const overflowAdults = Math.max(0, adults - maxCapacity);
  const overflowChildren = Math.max(0, children - maxChildren);
  return {
    overflowAdults,
    overflowChildren,
    requiredExtraBeds: overflowAdults + overflowChildren
  };
}

// Per CHD-02: apply the documented defaults to a raw room
// type entry. `maxChildren` is the only new field; `maxExtraBeds`
// and `extraBedRate` are EXB-01's defaults. The helper is the
// single normalization point — every read site routes through
// it so the documented contract is byte-equivalent everywhere.
//
// The helper accepts an unknown input so it works against
// raw Firestore data (the admin context's snapshot) and
// against the seed `DEFAULT_ROOM_TYPES` constant (the
// fallback when a hotel has no settings).
export function applyRoomTypeDefaults(raw: unknown): RoomTypeEntry {
  if (!raw || typeof raw !== "object") {
    // Defensive default — never null, never throw. The
    // schema-level reads filter this out before display.
    return {
      value: "",
      label: "",
      shortLabel: "",
      imageUrls: [],
      bedDefinition: "",
      description: "",
      amenities: [],
      maxCapacity: 0,
      maxChildren: 0,
      pricePerNight: 0,
      weekendRate: 0,
      corporateRate: 0,
      maxExtraBeds: 0,
      extraBedRate: 0
    };
  }
  const r = raw as Record<string, unknown>;
  const maxCapacity = Number(r.maxCapacity) || 0;
  return {
    value: String(r.value || ""),
    label: String(r.label || r.value || ""),
    shortLabel: String(r.shortLabel || r.label || r.value || ""),
    imageUrls: Array.isArray(r.imageUrls) ? (r.imageUrls as string[]).slice() : [],
    bedDefinition: String(r.bedDefinition || ""),
    description: String(r.description || ""),
    amenities: Array.isArray(r.amenities) ? (r.amenities as string[]).slice() : [],
    maxCapacity,
    maxChildren: normalizeMaxChildren(r.maxChildren, maxCapacity),
    pricePerNight: Number(r.pricePerNight) || 0,
    weekendRate: Number(r.weekendRate) || 0,
    corporateRate: Number(r.corporateRate) || 0,
    maxExtraBeds: Number(r.maxExtraBeds) || 0,
    extraBedRate: Number(r.extraBedRate) || 0
  };
}
