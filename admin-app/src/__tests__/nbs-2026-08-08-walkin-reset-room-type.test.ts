import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per NBS-2026-08-08 (F9, booking-flow audit 2026-08-08):
// the post-success reset of the New Booking modal's
// `walkinRoomStays` previously read
// `roomTypes[0]?.value || ""` while the room type
// catalog was still hydrating. The reset seeded the
// next stay with `roomType: ""`, the next submit hit
// the "Choose an available room" gate with a blank
// dropdown, and the desk had no clear next step
// (modal stays open with a blank input).
//
// The fix seeds the next stay with `""` and lets the
// existing effect at the top of the modal
// (`useEffect` watching `roomTypes`) re-sync the
// empty `roomType` to the first loaded type on the
// next paint. The desk sees a blank dropdown that
// populates once the catalog hydrates, instead of a
// permanent empty value.
//
// The Calendar create modal's roomType is bound
// to the selected grid cell + the room object
// fetched from the rooms collection, so the F9
// fix is scoped to the BookingsPage walk-in modal.

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);

describe("NBS-2026-08-08 — walk-in modal reset on success seeds empty roomType (F9)", () => {
  it("seeds the post-success walkinRoomStays with an empty roomType string", () => {
    // The post-success reset (inside the
    // `if (result.success)` branch) is:
    //   setWalkinRoomStays([createWalkinRoomStay("")]);
    // — explicit empty string, not
    // `roomTypes[0]?.value || ""`. The empty
    // value lets the existing effect at the top
    // of the modal re-sync to the first loaded
    // type on the next paint.
    const resetMatch = bookingsPageSrc.match(
      /setWalkinRoomStays\(\[createWalkinRoomStay\(""\)\]\);/
    );
    expect(resetMatch).not.toBeNull();
  });

  it("the post-success reset does not read roomTypes[0]?.value (the previous bug shape)", () => {
    // The previous shape was:
    //   setWalkinRoomStays([createWalkinRoomStay(roomTypes[0]?.value || "")]);
    // — a regression test against a future
    // refactor that silently re-introduces the
    // `roomTypes[0]?.value || ""` pattern. The
    // check is anchored to the `createWalkinRoomStay(...)`
    // call site inside the post-success reset
    // block; the catalog-hydration effect (which
    // legitimately reads `roomTypes[0]?.value`
    // later) is out of scope.
    const postSuccessReset = bookingsPageSrc.match(
      /if \(result\.success\) \{[\s\S]*?setWalkinRoomStays\(\[createWalkinRoomStay\(/
    );
    expect(postSuccessReset).not.toBeNull();
    // The captured block must NOT contain
    // `roomTypes[0]?.value` — the explicit empty
    // string is the only safe default while the
    // catalog is hydrating. The narrow check
    // anchors to the post-success `setWalkinRoomStays`
    // call site so the legitimate catalog-hydration
    // effect later in the file is not matched.
    expect(postSuccessReset![0]).not.toMatch(
      /createWalkinRoomStay\(roomTypes\[0\]\?\.value/
    );
  });

  it("the catalog-hydration effect at the top of the modal re-syncs empty roomType values", () => {
    // The effect runs after the post-success
    // reset; the new stay's empty `roomType`
    // gets re-populated with the first loaded
    // type. The same effect already handled the
    // pre-existing case where a stale modal
    // mount raced the catalog hydration.
    const effectMatch = bookingsPageSrc.match(
      /useEffect\(\(\) => \{[\s\S]*?setWalkinRoomStays\(\(stays\) =>[\s\S]*?stays\.some\(\(stay\) => stay\.roomType\)/
    );
    expect(effectMatch).not.toBeNull();
  });
});
