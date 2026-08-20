import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for RM-05 / decision #220 (2026-08-19): the Delete
// Room affordance in `admin-app/src/pages/RoomsPage.tsx` and the
// `deleteRoom` handler in `admin-app/src/context/AdminContext.tsx`
// were both gated on `currentUser?.role !== "admin"` after the
// operator reported that Front Desk accounts could click Delete
// Room only to hit a `permission-denied` toast. The server rule
// (`firestore.rules:23` `allow delete: if isAdmin()`) was already
// correct; the audit-skill pattern is to also gate at the handler
// + UI layers (defense in depth + clean error UX).
//
// These are SOURCE-TEXT pins (cheap, deterministic, no Firestore
// emulator needed). The runtime contract — that the handler
// returns `{ success: false, error: "Only administrators can …" }`
// for non-admin callers — is exercised by the daily e2e suite.

describe("RM-05 — Delete Room is admin-only (decision #220)", () => {
  const adminContext = readFileSync(
    resolve(__dirname, "../../src/context/AdminContext.tsx"),
    "utf8"
  );

  describe("AdminContext.tsx — deleteRoom handler", () => {
    // Sliced from `const deleteRoom = async` to the actual closing
    // `\n  };\n` of the function (anchored on the `await deleteDoc(doc(db, "rooms", roomId))`
    // we know lives just before the function's close, then take the
    // next `\n  };\n` after it). Robust against template literal
    // braces that throw off brace-counting and against any
    // intermediate `};\n` that lazy regex might match first.
    function sliceDeleteRoom() {
      const idx = adminContext.indexOf("const deleteRoom = async");
      const refIdx = adminContext.indexOf('deleteDoc(doc(db, "rooms", roomId))');
      const closeIdx = adminContext.indexOf("\n  };\n", refIdx);
      return adminContext.substring(idx, closeIdx + 5);
    }

    it("returns early with a 'only administrators' error when role !== admin", () => {
      const handler = sliceDeleteRoom();
      expect(handler).toMatch(
        /if\s*\(\s*currentUser\?\.role\s*!==\s*["']admin["']\s*\)/
      );
      // The handler returns `{ success: false, error }` (shorthand
      // property). Pin the error string with the variable declaration
      // — that's the literal the surface uses, so the toast reads
      // "Cannot delete room / Only administrators can delete rooms."
      expect(handler).toMatch(
        /const\s+error\s*=\s*["']Only\s+administrators\s+can\s+delete\s+rooms\.["']/
      );
      expect(handler).toMatch(/notify\.error\(["']Cannot\s+delete\s+room["']\s*,\s*error\)/);
    });

    it("does the role gate BEFORE the room-existence check", () => {
      // Order matters: the role gate has to short-circuit before
      // any storage / Firestore cleanup so a non-admin staff
      // member cannot trigger partial writes (storage cleanup,
      // intercom thread delete, call doc delete, roomPrivate
      // delete) on a room they don't have permission for.
      const handler = sliceDeleteRoom();
      const roleGateIdx = handler.indexOf("currentUser?.role");
      const roomCheckIdx = handler.indexOf("rooms.find");
      expect(roleGateIdx).toBeGreaterThan(-1);
      expect(roomCheckIdx).toBeGreaterThan(-1);
      expect(roleGateIdx).toBeLessThan(roomCheckIdx);
    });
  });

  describe("RoomsPage.tsx — Delete Room button", () => {
    const roomsPage = readFileSync(
      resolve(__dirname, "../../src/pages/RoomsPage.tsx"),
      "utf8"
    );

    it("destructures currentUser from useAdmin()", () => {
      // The component now needs `currentUser?.role !== "admin"` to
      // gate the button. If a future refactor removes `currentUser`
      // from the destructure, the gate silently breaks (toggles
      // back to the pre-#220 "render unconditionally" shape).
      const destructureMatch = roomsPage.match(
        /const\s*\{[\s\S]*?\}\s*=\s*useAdmin\(\);/
      );
      expect(destructureMatch).not.toBeNull();
      const destructure = destructureMatch![0];
      expect(destructure).toMatch(/\bcurrentUser\b/);
    });

    it("disables the Delete Room button for non-admin staff", () => {
      // The button is in the edit drawer footer. The disabled
      // prop should now include `currentUser?.role !== "admin"`
      // in addition to the pre-existing active-bookings guard.
      const buttonMatch = roomsPage.match(
        /<button[\s\S]*?onClick=\{\(\)\s*=>\s*requestDelete\(selectedRoom\)\}[\s\S]*?Delete Room\s*<\/button>/
      );
      expect(buttonMatch).not.toBeNull();
      const button = buttonMatch![0];
      expect(button).toMatch(/currentUser\?\.role\s*!==\s*["']admin["']/);
    });

    it("surfaces an admin-only tooltip when role is not admin", () => {
      // Tooltip phrasing is the operator-visible UX — when a
      // Front Desk staff hover the disabled button they should
      // see a clear explanation, not the silent "Delete this
      // room" tooltip.
      const buttonMatch = roomsPage.match(
        /<button[\s\S]*?onClick=\{\(\)\s*=>\s*requestDelete\(selectedRoom\)\}[\s\S]*?Delete Room\s*<\/button>/
      );
      expect(buttonMatch).not.toBeNull();
      const button = buttonMatch![0];
      expect(button).toMatch(/Only administrators can delete rooms/);
    });
  });

  describe("firestore.rules — defense in depth (no client contract regression)", () => {
    const rules = readFileSync(
      resolve(__dirname, "../../../firebase/firestore.rules"),
      "utf8"
    );

    it("`/rooms/{roomId}` delete rule is still `isAdmin()`", () => {
      // The handler + UI gate is belt-and-braces; the server
      // rule is the canonical authority. If someone refactors
      // the rule to `isStaff()`, the UI gate becomes the only
      // defense — pin the rule so future audits catch that.
      expect(rules).toMatch(
        /match\s+\/rooms\/\{roomId\}\s*\{[\s\S]*?allow\s+delete:\s*if\s+isAdmin\(\)/
      );
    });
  });
});
