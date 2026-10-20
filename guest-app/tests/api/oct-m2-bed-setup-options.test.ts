// Per OCT-M2 (2026-10-20, decision #290): the guest's bed-setup
// options must match the server's accepted set.
//
// The bug: `useRoomTypes.ts` seeded the guest's `bedSetupValues`
// from `DEFAULT_ROOM_TYPES`, so the Special Requests block offered
// a "Twinning setup" (and friends) that the server REJECTS —
// `handleCreateBooking` checks the submitted `bedSetup` against the
// room type's ACCEPTED set, and the shared normalizer resolves to
// `[]`. The guest was the only surface inventing options.
//
// Because the radio group had no "no preference" option, EVERY
// option 400'd and the guest was stuck — the only way out was a
// page reload.
//
// This file pins the BEHAVIOUR (the shared normalizer) and the
// WIRING (the guest hook + the radio group).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const useRoomTypesSrc = read("guest-app/src/hooks/useRoomTypes.ts");
const specialRequestsSrc = read("guest-app/src/components/SpecialRequestsBlock.tsx");
const roomTypesSharedSrc = read("shared/utils/roomTypes.ts");
const bookingsHandlerSrc = read("guest-app/server/handlers/bookings.ts");

describe("OCT-M2 — the guest's bed-setup options (wiring)", () => {
  it("the guest does NOT seed the bed-setup options from DEFAULT_ROOM_TYPES", () => {
    // The regression: the stored-room-type branch used to read
    // `DEFAULT_ROOM_TYPES` and copy its `bedSetupValues`.
    expect(useRoomTypesSrc).not.toMatch(
      /bedSetupValues:\s*DEFAULT_ROOM_TYPES/
    );
  });

  it("the stored-room-type branch uses an EMPTY accepted set", () => {
    // `[]` is what the shared normalizer, the admin mapper and the
    // server all resolve to. The shape is a conditional filter with
    // an `[]` fallback (an absent field is NOT an error — it just
    // offers no options).
    expect(useRoomTypesSrc).toMatch(
      /bedSetupValues:\s*Array\.isArray\(entry\.bedSetupValues\)[\s\S]{0,220}?:\s*\[\]/
    );
  });

  it("the shared normalizer still resolves an absent field to []", () => {
    expect(roomTypesSharedSrc).toMatch(/bedSetupValues/);
  });

  it("the server checks the submitted bedSetup against the room type's ACCEPTED set", () => {
    expect(bookingsHandlerSrc).toMatch(/is not offered for room type/);
  });

  it("the radio group offers an explicit 'No preference' option", () => {
    // The value is the empty string — the server always accepts it,
    // so the guest can never be trapped on a 400.
    expect(specialRequestsSrc).toMatch(/No preference/i);
  });

  it("the 'No preference' option's value is the empty string", () => {
    expect(specialRequestsSrc).toMatch(/value=\{?""|value:\s*""|value=""[\s\S]{0,120}No preference|No preference[\s\S]{0,120}value=""/);
  });

  it("the radio options still use a stable DOM id / React key for the empty value", () => {
    // An empty `value` would collapse the key to the same string as
    // every other empty-valued option, so the key falls back to a
    // named sentinel.
    expect(specialRequestsSrc).toMatch(/no-preference/);
  });
});
