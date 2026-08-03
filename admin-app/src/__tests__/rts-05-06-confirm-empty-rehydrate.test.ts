import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for RTS-05 + RTS-06 (2026-08-01) — the two
// follow-up defects from the original RTS-01..04 batch. They were
// verified as real defects but NOT the user-visible mechanism the
// owner reported (RTS-04 was the actual swallow). Both ship here
// together because the fix surface is small (~30 lines each) and
// the regression-guard is the same shape as the RTS-01 source-text
// test.
//
// Background (per `plan/project/ROADMAP.md §RTS-05..06`):
//   - RTS-05: the room-type Delete button used a 3-second auto-disarm
//     "Click to confirm" pattern. The two-step confirm had no
//     countdown or progress affordance — a user who clicks Delete,
//     reads the label change, hesitates past 3s, and clicks again
//     simply RE-ARMS it. Repeat indefinitely and nothing ever deletes.
//     The fix is a proper Modal + ConfirmForm (matching the
//     RoomsPage delete flow), per the `ConfirmForm` primitive
//     Phase 11.7 already ships.
//   - RTS-06: the `roomTypes` sync effect in `AdminContext.tsx` was
//     guarded by `hotelConfig.roomTypes.length > 0`. A hotel that
//     deleted every room type had `[]` persisted correctly, but on
//     the next page load the effect skipped, leaving the local state
//     on its `DEFAULT_ROOM_TYPES` initializer — every deleted type
//     silently reappeared. The fix is a `roomTypesLoaded` flag
//     that flips to `true` after the first sync, so subsequent
//     snapshots (including `[]`) always re-sync the local state.

const settingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

describe("RTS-05 — room-type delete uses a Modal + ConfirmForm (no 3s auto-disarm)", () => {
  it("removes the 3-second auto-disarm timer on the room-type delete state", () => {
    // The historical bug: a `useEffect` on `pendingDeleteRoomType`
    // armed a 3-second `setTimeout` to reset the state to null. A
    // hesitant click re-armed it. The fix removes the timer entirely
    // (the Modal's onClose + the ConfirmForm's onCancel both reset
    // the state).
    // The store-item delete timer is left alone (it has the same
    // shape but is out of scope for this PR). Pin the *absence* of a
    // timer that targets `pendingDeleteRoomType`.
    expect(settingsPageSrc).not.toMatch(
      /setTimeout\([^)]*setPendingDeleteRoomType\(null\)/
    );
    // And confirm the timer is gone from the useEffect for the
    // room-type delete (the 3000ms is the smoking gun).
    expect(settingsPageSrc).not.toMatch(
      /if \(!pendingDeleteRoomType\)\s*return;\s*\n\s*const timer = setTimeout\(\(\) => setPendingDeleteRoomType\(null\), 3000\)/
    );
  });

  it("opens a Modal with a ConfirmForm when Delete is clicked", () => {
    // The Delete button now sets the state to the full type object
    // (not the value string), and a Modal opens containing a
    // ConfirmForm with `variant="danger"` + `reasonRequired` —
    // matching the RoomsPage delete flow.
    expect(settingsPageSrc).toMatch(/onClick=\{\(\) => setPendingDeleteRoomType\(type\)\}/);
    // The Modal title uses the pending type's label (no more
    // "Click to confirm" affordance).
    expect(settingsPageSrc).toMatch(/title=\{pendingDeleteRoomType \? `Delete · \$\{pendingDeleteRoomType\.label\}` : "Delete room type"\}/);
    // The confirm form has variant=danger + reasonRequired.
    expect(settingsPageSrc).toMatch(/variant="danger"/);
    expect(settingsPageSrc).toMatch(/reasonRequired/);
    // The Modal wires the confirm handler to handleDeleteRoomType.
    expect(settingsPageSrc).toMatch(/onConfirm=\{\(\) => void handleDeleteRoomType\(pendingDeleteRoomType\.value\)\}/);
  });

  it("shows the 'attached rooms' blocking form when the type is in use, instead of the destructive form", () => {
    // The same `Modal` shows a different `ConfirmForm` content
    // depending on whether the type is referenced by any room. The
    // blocking form uses `variant="primary"` (informational, not
    // destructive) and has a `testId="delete-room-type-blocked"`.
    // The destructive form has a `testId="delete-room-type-confirm"`.
    expect(settingsPageSrc).toMatch(/testId="delete-room-type-blocked"/);
    expect(settingsPageSrc).toMatch(/testId="delete-room-type-confirm"/);
    // The blocking form's confirm is a "Got it" acknowledgement, not
    // a destructive action.
    expect(settingsPageSrc).toMatch(/confirmLabel="Got it"/);
  });

  it("imports ConfirmForm from the same path as RoomsPage", () => {
    // Sanity check the new import. The path mirrors how BookingsPage
    // and RoomsPage import ConfirmForm.
    expect(settingsPageSrc).toMatch(/import\s*\{\s*ConfirmForm\s*\}\s*from\s*["']\.\.\/components\/ConfirmForm["']/);
  });
});

describe("RTS-06 — empty room-types snapshot re-syncs the local state", () => {
  it("adds a roomTypesLoaded flag that flips true after the first sync", () => {
    // The fix is a flag (per the spec's "null/loading flag alongside
    // the array" recommendation). The flag starts `false` and flips
    // to `true` inside the same effect that calls `setRoomTypes`.
    expect(adminContextSrc).toMatch(/const \[roomTypesLoaded, setRoomTypesLoaded\] = useState\(false\)/);
    expect(adminContextSrc).toMatch(/setRoomTypesLoaded\(true\)/);
  });

  it("drops the `length > 0` guard so empty snapshots still sync", () => {
    // The historical bug: the effect bailed out when the snapshot
    // value was `[]`, leaving the local state on its
    // `DEFAULT_ROOM_TYPES` initializer. The fix removes the guard —
    // any array value (including `[]`) syncs, and the loaded flag
    // tracks "the snapshot has been observed at least once".
    expect(adminContextSrc).not.toMatch(
      /if \(Array\.isArray\(hotelConfig\.roomTypes\) && hotelConfig\.roomTypes\.length > 0\)/
    );
    expect(adminContextSrc).toMatch(/if \(Array\.isArray\(hotelConfig\.roomTypes\)\)/);
  });

  it("keeps the roomTypes initializer on DEFAULT_ROOM_TYPES (no flash on first paint)", () => {
    // The initial paint before the snapshot arrives must show the
    // defaults so the UI isn't blank. The initializer is unchanged;
    // the new flag only gates subsequent syncs, not the first render.
    expect(adminContextSrc).toMatch(
      /const \[roomTypes, setRoomTypes\] = useState<RoomTypeEntry\[\]>\(\(\) => \{\s*\n\s*return DEFAULT_ROOM_TYPES\.map\(\(t\) => \(\{ \.\.\.t, imageUrls: \[\.\.\.t\.imageUrls\] \}\)\);\s*\n\s*\}\);/
    );
  });
});
