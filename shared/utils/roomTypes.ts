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

// Per CHD-11 (2026-08-04, per decision #184): the per-type
// capacity-fit indicator. Drives the Fits / Tight / Doesn't fit
// chip on each room-type card on `/book` and (per CHD-12) the
// small capacity chip on each line of the cart summary. The
// helper is the single derivation point — both surfaces read
// from it so the two indicators can never disagree.
//
// State derivation:
//   - "doesnt-fit": the cart's total extra-bed capacity is
//     insufficient to cover the group overflow. The user must
//     pick a different room type, add a second room of this
//     type, or reduce the group.
//   - "tight": the cart exactly accommodates the group (no
//     unused adult slot AND no unused child slot) OR the cart
//     accommodates the group with extra beds covering the
//     overflow. The user is at the edge; the room type works
//     but has no headroom.
//   - "fits": the cart accommodates the group with unused
//     capacity. The user has headroom for the existing selection.
//
// `roomsNeeded` is the minimum number of rooms of this type the
// user would need to fit the group (regardless of how many are
// already in the cart). It uses the ceiling of
// `numAdults / maxCapacity` and `numChildren / maxChildren`
// (whichever is higher) and assumes the user splits evenly.
// Extra beds are NOT counted toward `roomsNeeded` — the per-bed
// overflow is captured in `extraBedsNeeded` instead, so the
// two outputs decompose: `roomsNeeded` is the room count, and
// `extraBedsNeeded` is the total extra beds across those rooms.
//
// `extraBedsNeeded` is the total extra beds across the cart
// required to fit the overflow (or 0 if the group fits without
// any extra beds). It's the per-cart `requiredExtraBedsFor` sum
// — same shape as the EXB-03 overflow rule but aggregated
// across `currentCartCount` rooms instead of a single room.
export type RoomTypeCapacityFitState = "fits" | "tight" | "doesnt-fit";

export interface RoomTypeCapacityFitInput {
  // `Partial<>` because the underlying `RoomTypeEntry` declares
  // `maxCapacity` / `maxChildren` / `maxExtraBeds` as optional
  // (the admin can clear them in the Settings → Room Types
  // editor). The helper normalises nullish / NaN / negative
  // values to 0 inside the body.
  type: Partial<{ maxCapacity: number; maxChildren: number; maxExtraBeds: number }>;
  numAdults: number;
  numChildren: number;
  currentCartCount: number;
}

export interface RoomTypeCapacityFitResult {
  state: RoomTypeCapacityFitState;
  roomsNeeded: number;
  extraBedsNeeded: number;
}

export function deriveRoomTypeCapacityFit(input: RoomTypeCapacityFitInput): RoomTypeCapacityFitResult {
  const maxCapacity = Math.max(0, Math.floor(Number(input.type.maxCapacity) || 0));
  const maxChildren = Math.max(0, Math.floor(Number(input.type.maxChildren) || 0));
  const maxExtraBeds = Math.max(0, Math.floor(Number(input.type.maxExtraBeds) || 0));
  // The input type is `{ maxCapacity: number | null | undefined; ... }`
  // because the underlying `RoomTypeEntry` type has those fields as
  // optional (the admin can clear them in the Settings → Room
  // Types editor). The `Number(x) || 0` coercion above already
  // handles nullish + NaN + negative → 0, so the rest of the math
  // is safe.
  const numAdults = Math.max(0, Math.floor(Number(input.numAdults) || 0));
  const numChildren = Math.max(0, Math.floor(Number(input.numChildren) || 0));
  const currentCartCount = Math.max(0, Math.floor(Number(input.currentCartCount) || 0));

  // Per the room-type / cart math: total capacity available in
  // the current cart is the per-type cap times the cart count.
  const totalAdultCap = currentCartCount * maxCapacity;
  const totalChildrenCap = currentCartCount * maxChildren;
  const totalExtraBeds = currentCartCount * maxExtraBeds;

  // Overflow follows the EXB-03 rule (overflowAdults +
  // overflowChildren) but aggregated across the whole cart.
  const overflowAdults = Math.max(0, numAdults - totalAdultCap);
  const overflowChildren = Math.max(0, numChildren - totalChildrenCap);
  const totalOverflow = overflowAdults + overflowChildren;

  // State: cover the three cases.
  let state: RoomTypeCapacityFitState;
  // Empty group is always "fits" — no constraint to satisfy.
  // This is defensive (the /book page requires at least 1 adult)
  // but the helper is general-purpose and should not throw on 0/0.
  if (numAdults === 0 && numChildren === 0) {
    state = "fits";
  } else if (totalOverflow > totalExtraBeds) {
    // Cart has insufficient extra beds → doesn't fit.
    state = "doesnt-fit";
  } else if (totalOverflow === 0) {
    // No overflow. Differentiate "tight" (exactly at cap) from
    // "fits" (has unused slots). The cap is "at the per-type
    // cap" — when the group's adults hit the adult cap AND the
    // group's children hit the children cap exactly, the cart
    // has no headroom.
    const adultsAtCap = numAdults === totalAdultCap;
    const childrenAtCap = numChildren === totalChildrenCap;
    state = adultsAtCap && childrenAtCap ? "tight" : "fits";
  } else {
    // Overflow is covered by extra beds. The cart accommodates
    // the group but is at the edge (no headroom — every extra
    // bed is used). The EXB-03 shape: "fits because extra beds
    // cover the overflow" reads as "tight" because there's no
    // slack left.
    state = "tight";
  }

  // Minimum number of rooms of this type to fit the group.
  // The group's adults and children split across rooms in any
  // combination; the worst case is `ceil(adults / maxCap)` or
  // `ceil(children / maxChildren)`, whichever is higher.
  // Extra beds are NOT counted — the per-bed overflow is in
  // `extraBedsNeeded`, not in the room count.
  const safeAdultCap = Math.max(1, maxCapacity);
  const safeChildrenCap = Math.max(1, maxChildren);
  const roomsNeeded = Math.max(
    1,
    Math.ceil(numAdults / safeAdultCap),
    Math.ceil(numChildren / safeChildrenCap)
  );

  // Total extra beds needed across the cart (or 0 if the
  // group fits the cart's natural capacity with no extra beds).
  const extraBedsNeeded = totalOverflow > 0 && totalOverflow <= totalExtraBeds ? totalOverflow : 0;

  return { state, roomsNeeded, extraBedsNeeded };
}
