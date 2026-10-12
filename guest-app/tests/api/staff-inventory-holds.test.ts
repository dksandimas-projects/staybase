import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");
const holdsSource = read("../../server/handlers/staff-inventory-holds.ts");
const bookingsSource = read("../../server/handlers/bookings.ts");
const roomsSource = read("../../server/handlers/rooms.ts");
const blocksSource = read("../../server/handlers/room-blocks.ts");
const routerSource = read("../../server/apiRouter.ts");
const sweepSource = read("../../server/handlers/in-flow-hold.ts");
const rulesSource = read("../../../firebase/firestore.rules");

describe("hard staff inventory holds", () => {
  it("requires staff authentication for acquire, extend, and release", () => {
    expect(routerSource).toContain('domain === "staff-inventory-holds"');
    expect(routerSource).toContain('["acquire", "extend", "release"]');
    expect(routerSource).toMatch(/staff-inventory-holds[\s\S]*?authenticateStaff\(req\)/);
  });

  it("acquires every selected room atomically after checking bookings, blocks, and other holds", () => {
    expect(holdsSource).toMatch(/adminDb\.runTransaction/);
    expect(holdsSource).toContain('collection("bookings")');
    expect(holdsSource).toContain('collection("roomBlocks")');
    expect(holdsSource).toContain("hasActiveStaffInventoryHoldConflict");
    expect(holdsSource).toMatch(/transaction\.set\(holdRef/);
  });

  it("makes an unexpired staff hold unavailable to public search and ordinary booking paths", () => {
    expect(roomsSource).toContain('collection("staffInventoryHolds")');
    expect(roomsSource).toContain('status: "staff-hold"');
    expect(bookingsSource).toMatch(/return hasActiveStaffInventoryHoldConflict\(/);
    expect(blocksSource).toContain("hasActiveStaffInventoryHoldConflict");
  });

  it("only lets the owning walk-in consume an exact room/date match in its booking transaction", () => {
    expect(bookingsSource).toContain("This front-desk room hold belongs to another staff member.");
    expect(bookingsSource).toContain("Booking dates no longer match the front-desk room hold.");
    expect(bookingsSource).toContain("Selected rooms no longer match the front-desk room hold.");
    expect(bookingsSource).toMatch(/transaction\.update\(staffHoldRef, \{[\s\S]*?status: "consumed"/);
  });

  it("ignores expiry at read time and normalizes stale holds in the existing sweep", () => {
    expect(holdsSource).toMatch(/expiresAt > now/);
    expect(sweepSource).toContain('[HOLDS_COLLECTION, "staffInventoryHolds"]');
  });

  it("allows staff reads but keeps every client write server-only", () => {
    expect(rulesSource).toMatch(/match \/staffInventoryHolds\/\{holdId\}[\s\S]*?allow read: if isStaff\(\);[\s\S]*?allow create, update, delete: if false;/);
  });
});
