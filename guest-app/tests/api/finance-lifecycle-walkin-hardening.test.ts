import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(__dirname, "../../..");
const bookingsHandler = readFileSync(resolve(root, "guest-app/server/handlers/bookings.ts"), "utf8");
const adminBookings = readFileSync(resolve(root, "admin-app/src/pages/BookingsPage.tsx"), "utf8");
const adminContext = readFileSync(resolve(root, "admin-app/src/context/AdminContext.tsx"), "utf8");

describe("Finance Lifecycle FL-06 and FL-07", () => {
  test("walk-in validation runs before the Firestore transaction", () => {
    const start = bookingsHandler.indexOf("export async function handleCreateWalkin");
    const end = bookingsHandler.indexOf("export async function handleApplyBookingDiscount", start);
    const handler = bookingsHandler.slice(start, end);

    expect(handler).toMatch(/WalkinBookingSchema\.safeParse\(req\.body \|\| \{\}\)/);
    expect(handler.indexOf("WalkinBookingSchema.safeParse")).toBeLessThan(handler.indexOf("adminDb.runTransaction"));
    expect(handler).toMatch(/parsedWalkin\.data/);
  });

  test("reschedule preserves a locked manual nightly rate", () => {
    const start = bookingsHandler.indexOf("export async function handleRescheduleBooking");
    const handler = bookingsHandler.slice(start);

    expect(handler).toMatch(/getLockedManualNightlyRate/);
    expect(handler).toMatch(/roomSubtotal: Math\.round\(manualNightlyRate \* numNights\)/);
    expect(handler).toMatch(/source: "manual" as const/);
    expect(handler).toMatch(/ratePerNight: manualNightlyRate \?\? activeRoomRate/);
    expect(handler).toMatch(/pricingBasis: manualNightlyRate !== null \? "manual" : "recalculated"/);
  });

  test("admin preview and confirmation explain the preserved basis", () => {
    expect(adminBookings).toMatch(/getLockedManualNightlyRate\(booking\.rateBreakdown\)/);
    expect(adminBookings).toMatch(/Locked manual rate will be preserved/);
    expect(adminBookings).toMatch(/target room's standard rate will not replace it/);
    expect(adminContext).toMatch(/return \{ success: true, data: data\.data \}/);
    expect(adminBookings).toMatch(/rateBreakdown: result\.data\?\.rateBreakdown/);
    expect(adminBookings).toMatch(/setSelectedBooking\(\(previous\) => previous \? \{ \.\.\.previous, \.\.\.updatedFields \}/);
  });
});
