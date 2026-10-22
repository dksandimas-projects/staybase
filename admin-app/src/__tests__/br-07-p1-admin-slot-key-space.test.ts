// Per BR-07-P1 (2026-10-22): the admin app and the guest app
// must address the SAME breakfast slot.
//
// THE DEFECT
// ----------
// The guest app wrote `<date>-guest-0` (0-based). EVERY admin
// read path looked up `<date>-guest-1` (1-based):
//
//   - `BookingDrawerWorkspace.tsx` — `for (let i = 1; i <= n; i++)`
//   - `BookingsPage.tsx` (registration-form pre-fill + PDF)
//   - `ReportsPage.tsx` (daily kitchen prep)
//   - `DashboardPage.tsx` (today's breakfast widget)
//
// For a 2-guest booking the drawer showed guest 2's meal on
// guest 1's row, guest 1's row read "no meal", and guest 2's
// meal was never shown to staff. Staff also WROTE to
// `-guest-2` — a key the guest page's universe does not contain
// — so a staff-added meal for the last guest was invisible to
// the guest.
//
// THE FIX
// -------
// The canonical base is 0-based. The admin app now builds every
// slot key through the SHARED helpers in `@spark-inn/shared`
// (`buildBreakfastSlotKey` / `buildBreakfastSlotId` +
// `normalizeBreakfastSelections`), so the two apps cannot drift
// apart again.
//
// The file reads the source of each admin file (no runtime
// fixtures, no JSDOM) so each pin is byte-stable — the same
// convention as `br-05-staff-breakfast-drawer.test.ts`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildBreakfastSlotId,
  buildBreakfastSlotKey,
  normalizeBreakfastSelections
} from "@spark-inn/shared";

const drawerSrc = readFileSync(
  resolve(__dirname, "../components/BookingDrawerWorkspace.tsx"),
  "utf8"
);
const walkinGridSrc = readFileSync(
  resolve(__dirname, "../components/breakfast/WalkinBreakfastGrid.tsx"),
  "utf8"
);
const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);
const reportsPageSrc = readFileSync(
  resolve(__dirname, "../pages/ReportsPage.tsx"),
  "utf8"
);
const dashboardPageSrc = readFileSync(
  resolve(__dirname, "../pages/DashboardPage.tsx"),
  "utf8"
);

/**
 * Strip the `//` comment lines so a tripwire only inspects
 * CODE. The fix's own explanatory comments quote the pre-fix
 * key shapes on purpose, and a naive `toContain` would match
 * them.
 */
function codeOnly(src: string): string {
  return src
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

describe("BR-07-P1 — the admin app uses the canonical 0-based breakfast slot key", () => {
  it("the booking drawer enumerates its guest slots 0-BASED", () => {
    // The pre-fix code was `for (let i = 1; i <= n; i += 1) {
    // slots.push({ id: `guest-${i}`, label: `Guest ${i}` }); }`.
    expect(codeOnly(drawerSrc)).not.toMatch(/for \(let i = 1; i <= n; i \+= 1\)/);
    expect(codeOnly(drawerSrc)).toMatch(/for \(let i = 0; i < n; i \+= 1\)/);
    // The label stays 1-based for humans; the KEY is 0-based.
    expect(drawerSrc).toContain('id: `guest-${i}`');
    expect(drawerSrc).toContain('label: `Guest ${i + 1}`');
  });

  it("the walk-in grid enumerates its guest slots 0-BASED", () => {
    // The walk-in grid is a WRITE path: the slot id it produces
    // becomes the key the guest page reads back.
    expect(codeOnly(walkinGridSrc)).not.toMatch(/for \(let i = 1; i <= n; i \+= 1\)/);
    expect(codeOnly(walkinGridSrc)).toMatch(/for \(let i = 0; i < n; i \+= 1\)/);
    expect(walkinGridSrc).toContain('id: `guest-${i}`');
    expect(walkinGridSrc).toContain('label: `Guest ${i + 1}`');
  });

  it("no admin read path builds a 1-based slot key any more", () => {
    // The pre-fix code interpolated `guest-${g + 1}` / `guest-${g}`
    // with a 1-based loop counter. Nothing may build a slot key
    // from a 1-based counter any more.
    expect(codeOnly(bookingsPageSrc)).not.toContain("`${date}-guest-${guestIndex + 1}`");
    expect(codeOnly(bookingsPageSrc)).not.toContain("`${date}-guest-${g + 1}`");
    expect(codeOnly(reportsPageSrc)).not.toContain("`${dateStr}-guest-${g}`");
    expect(codeOnly(dashboardPageSrc)).not.toContain("`${todayKey}-guest-${g}`");
  });

  it("every admin surface resolves slots through the SHARED normaliser", () => {
    // The shared helper is what folds the two legacy key forms
    // (the bare `<date>-N` form and the legacy 1-based
    // `<date>-guest-N` form) into the canonical space.
    expect(drawerSrc).toContain("normalizeBreakfastSelections");
    expect(bookingsPageSrc).toContain("normalizeBreakfastSelections");
    expect(reportsPageSrc).toContain("normalizeBreakfastSelections");
    expect(dashboardPageSrc).toContain("normalizeBreakfastSelections");
  });

  it("the admin app builds its keys with the shared canonical builder", () => {
    expect(drawerSrc).toContain("buildBreakfastSlotKey");
    expect(drawerSrc).toContain("buildBreakfastSlotKeyForBase");
    expect(bookingsPageSrc).toContain("buildBreakfastSlotKey");
  });
});

describe("BR-07-P1 — the guest key and the admin key resolve to the same slot", () => {
  it("both apps address guest index 0 with the identical key", () => {
    // The guest app's slot id (0-based, per
    // `guest-app/src/pages/BookingPage.tsx`
    // `enumerateGuestSlots`) + the admin app's canonical builder
    // must produce the same key.
    const guestSlotId = buildBreakfastSlotId(0);
    const guestKey = `2026-11-05-${guestSlotId}`;
    const adminKey = buildBreakfastSlotKey("2026-11-05", 0);

    expect(guestSlotId).toBe("guest-0");
    expect(guestKey).toBe("2026-11-05-guest-0");
    expect(adminKey).toBe(guestKey);
  });

  it("the normaliser resolves the guest key and the admin key to the same guest index", () => {
    const selections = {
      "2026-11-05-guest-0": { mealId: "tapsilog", mealName: "Tapsilog", price: 100 }
    };
    const { slots } = normalizeBreakfastSelections(selections, 2);
    const guestKey = `2026-11-05-${buildBreakfastSlotId(0)}`;
    const adminKey = buildBreakfastSlotKey("2026-11-05", 0);

    expect(guestKey).toBe(adminKey);
    expect(slots.get(guestKey)?.guestIndex).toBe(0);
    expect(slots.get(adminKey)?.guestIndex).toBe(0);
  });
});
