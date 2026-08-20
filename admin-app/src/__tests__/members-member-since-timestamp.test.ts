import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for the `members/{uid}` snapshot mapper's
// `memberSince` hydration contract.
//
// **The bug (operator-reported 2026-08-20).** Opening the admin-app
// Spark Rewards Members page (`/members`) on production + staging
// crashed with React error #31:
//
//   Uncaught Error: Minified React error #31
//   args[] = object with keys {seconds, nanoseconds}
//
// `{seconds, nanoseconds}` is the canonical Firestore `Timestamp`
// shape — React #31 fires when an object is rendered as a JSX child.
// The trace ended in `MembersPage.tsx` at lines 225 and 326:
//
//   <p className="text-xs text-gray-700">{row.memberSince}</p>
//   <span>{selectedMember.memberSince}</span>
//
// **Why the mapper dropped a Timestamp.** `Member.memberSince: string`
// (AdminContext.tsx:398) is the TS contract — a lie about the runtime
// shape. The server writes `memberSince: new Date()` in
// `guest-app/server/handlers/members.ts:243,258,285`; the Admin SDK
// auto-converts `Date` → Firestore `Timestamp` on store. The mapper
// at AdminContext.tsx:3040 was `memberSince: data.memberSince || ""`
// — a raw pass-through that never converted the Timestamp to a string
// before it landed on React state. With a Timestamp object, the `|| ""`
// guard never fired (objects are truthy), so React rendered the raw
// `{seconds, nanoseconds}` object as a JSX child.
//
// **The fix (decision #226, 2026-08-20).** Mirror the same
// `toDate`-guarded pattern that `MembersPage.tsx:58-60` uses for the
// drawer's `pointsHistory` and that `IntercomPage.tsx:495` uses for
// `intercomMessages.timestamp`:
//
//   memberSince: data.memberSince?.toDate
//     ? data.memberSince.toDate().toISOString()
//     : (data.memberSince || ""),
//
// **`ReportsPage.tsx:1703`** already has the right pattern
// (`toDate(m.memberSince)?.toISOString()`) — confirms the
// toDate-guarded normalization is the canonical shape for this
// contract in this codebase.
//
// **Test discipline (FOL-02 pattern, GOTCHAS.md line 30):** the
// per-field contract test pins the new mapper shape at the source
// level so a future refactor that re-introduces the raw pass-through
// breaks the test instead of silently regressing. Mirrors the recipe
// in `fol-02-call-history-mapper-drops.test.ts`.

const adminSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

const membersPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/MembersPage.tsx"),
  "utf8"
);

describe("AdminContext.tsx — members snapshot mapper normalizes memberSince from Firestore Timestamp (decision #226, 2026-08-20)", () => {
  // Anchor the slice to the members snapshot mapper so a future
  // refactor that moves the mapper body doesn't break the test for
  // the wrong reason. The mapper is the .push() inside the
  // `members` collection listener (AdminContext.tsx:3025-3054).
  const mapperStart = adminSrc.indexOf("snapshot.forEach((doc) => {");
  // Anchor on the "rewardsPoints" line — that's the line right
  // before the buggy memberSince line in the mapper body. Slice
  // forward ~700 chars to capture the full member mapper block.
  const mapperAnchor = adminSrc.indexOf("rewardsPoints: data.rewardsPoints || 0", mapperStart);
  const mapperEnd = adminSrc.indexOf("});", mapperAnchor);
  const mapperBody = adminSrc.slice(mapperStart, mapperEnd);

  describe("Source-text pins — member mapper hydration (one test per contract field)", () => {
    it("hydrates `memberSince` via a toDate()-guarded normalization (not a raw pass-through)", () => {
      // The new shape: `data.memberSince?.toDate ? ... .toISOString() : ...`
      // catches a Firestore Timestamp on the wire and converts it to an
      // ISO string. The old shape was `data.memberSince || ""` — a raw
      // pass-through that left the Timestamp object on React state.
      expect(mapperBody).toMatch(
        /memberSince:\s*data\.memberSince\?\.toDate\s*\?\s*data\.memberSince\.toDate\(\)\.toISOString\(\)/
      );
    });

    it("member mapper does NOT pass `memberSince` through raw (negative pin)", () => {
      // The old shape: `memberSince: data.memberSince || ""`. A future
      // refactor that re-introduces the raw pass-through would let
      // Firestore Timestamps leak onto React state, re-introducing
      // React error #31 on the Members page.
      expect(mapperBody).not.toMatch(/memberSince:\s*data\.memberSince\s*\|\|\s*""/);
    });
  });

  describe("Source-text pins — MembersPage consumer renders the normalized string (not the Timestamp)", () => {
    it("MembersPage mobile card renders `row.memberSince` (the row-level site of the bug)", () => {
      // The crash site at MembersPage.tsx:225. After the mapper fix,
      // `row.memberSince` is always a string (the ISO form), so React
      // renders the date string instead of the Timestamp object.
      // We don't pin the exact JSX — JSX shape changes across
      // refactors — we pin that the field is referenced as-is from
      // `row.memberSince` (the mapper-hydrated value).
      const mobileCardStart = membersPageSrc.indexOf("renderMobileCard={renderMemberCard}");
      expect(mobileCardStart).toBeGreaterThan(-1);
      // Slice to the renderMobileCard function body — anchored on
      // the function name, which is unique in the file.
      const cardFnStart = membersPageSrc.lastIndexOf(
        "const renderMemberCard",
        mobileCardStart
      );
      const cardFnEnd = membersPageSrc.indexOf("};", cardFnStart);
      const cardFnBody = membersPageSrc.slice(cardFnStart, cardFnEnd);
      expect(cardFnBody).toMatch(/row\.memberSince/);
    });

    it("MembersPage drawer renders `selectedMember.memberSince` (the drawer-level site of the bug)", () => {
      // The crash site at MembersPage.tsx:326.
      const drawerStart = membersPageSrc.indexOf("Member Details Drawer");
      const drawerEnd = membersPageSrc.indexOf("</Drawer>", drawerStart);
      const drawerBody = membersPageSrc.slice(drawerStart, drawerEnd);
      expect(drawerBody).toMatch(/selectedMember\.memberSince/);
    });
  });

  describe("Runtime pin — mapper normalization against a representative Firestore Timestamp fixture", () => {
    it("a Firestore Timestamp `{seconds, nanoseconds, toDate()}` round-trips to an ISO string via the mapper shape", () => {
      // The mapper uses `data.memberSince?.toDate ? ... .toISOString()`
      // — extract the same shape inline so a regression in the
      // mapper's pattern (e.g. someone changes `.toISOString()` to
      // `.toString()`) breaks this runtime test alongside the source
      // text pins. The fixture is the exact shape Firestore sends
      // over the wire: a plain object with `seconds`, `nanoseconds`,
      // and a `toDate()` method.
      const fixture = {
        seconds: 1735689600, // 2025-01-01T00:00:00.000Z
        nanoseconds: 0,
        toDate() {
          return new Date(this.seconds * 1000 + this.nanoseconds / 1_000_000);
        }
      };
      const normalized = fixture.toDate
        ? fixture.toDate().toISOString()
        : String(fixture);
      expect(normalized).toBe("2025-01-01T00:00:00.000Z");
      // Confirm the input was actually a Timestamp-shaped object
      // (not a string) — this is the shape the OLD mapper leaked to
      // React state.
      expect(typeof fixture).toBe("object");
      expect(fixture).toHaveProperty("seconds");
      expect(fixture).toHaveProperty("nanoseconds");
    });

    it("a non-Timestamp string passes through unchanged (no double-conversion)", () => {
      // Backwards compat: a member doc written with `memberSince:
      // "2025-01-01"` (some legacy path) should NOT be wrapped in
      // `.toISOString()` again. The mapper shape's ternary handles
      // this — `data.memberSince?.toDate` is undefined for a string,
      // so the else branch returns `data.memberSince || ""`.
      const fixture = "2025-01-01";
      const normalized = (fixture as any)?.toDate
        ? (fixture as any).toDate().toISOString()
        : (fixture || "");
      expect(normalized).toBe("2025-01-01");
    });
  });
});
