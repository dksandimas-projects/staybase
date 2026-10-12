import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const calendarSource = readFileSync(resolve(__dirname, "../pages/CalendarPage.tsx"), "utf8");
const bookingsSource = readFileSync(resolve(__dirname, "../pages/BookingsPage.tsx"), "utf8");
const contextSource = readFileSync(resolve(__dirname, "../context/AdminContext.tsx"), "utf8");

describe("Calendar bulk room/date actions", () => {
  it("keeps one shared date range while allowing several room rows to be selected", () => {
    expect(calendarSource).toMatch(/roomIds: string\[\]; startDate: string; endDate: string/);
    expect(calendarSource).toMatch(/const toggleSelectedRoom = \(room: Room\) =>/);
    expect(calendarSource).toContain("aria-label={`Select Room ${room.roomNumber}`}");
  });

  it("requires a summary confirmation before creating all room blocks", () => {
    expect(calendarSource).toMatch(/confirmationAction.*"block" \| "hold"/);
    expect(calendarSource).toContain("Confirm room block");
    expect(calendarSource).toContain("room-night");
    expect(calendarSource).toMatch(/await createBulkRoomBlocks\(\{/);
    expect(contextSource).toContain('/api/room-blocks/create-bulk');
  });

  it("acquires a hold before opening the multi-room booking form", () => {
    expect(calendarSource).toMatch(/await acquireStaffInventoryHold\(\{/);
    expect(calendarSource).toContain("staffHoldId: result.hold.id");
    expect(calendarSource).toContain("roomIds: result.hold.roomIds.join");
    expect(calendarSource).toContain("Hold rooms & continue");
  });
});

describe("Held-room booking handoff", () => {
  it("locks the selected rooms and dates into the existing multi-room form", () => {
    expect(bookingsSource).toContain('searchParams.get("staffHoldId")');
    expect(bookingsSource).toContain("setWalkinRoomStays(selectedRooms.map");
    expect(bookingsSource).toContain("disabled={Boolean(activeStaffHoldId)}");
  });

  it("shows an expiring hold, supports extension, and releases it on cancel", () => {
    expect(bookingsSource).toContain("Held from online booking");
    expect(bookingsSource).toContain("Extend 15 minutes");
    expect(bookingsSource).toMatch(/await extendStaffInventoryHold\(activeStaffHoldId\)/);
    expect(bookingsSource).toMatch(/await releaseStaffInventoryHold\(activeStaffHoldId\)/);
  });

  it("submits the hold id with the walk-in reservation", () => {
    expect(bookingsSource).toContain("staffHoldId: activeStaffHoldId || undefined");
    expect(contextSource).toContain("...(input.staffHoldId ? { staffHoldId: input.staffHoldId } : {})");
  });
});
