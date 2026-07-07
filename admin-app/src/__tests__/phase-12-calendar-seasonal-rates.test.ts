import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/App.tsx"), "utf8");
const sidebarSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/components/Sidebar.tsx"), "utf8");
const calendarSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/pages/CalendarPage.tsx"), "utf8");
const ratesSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/pages/RatesPage.tsx"), "utf8");
const contextSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"), "utf8");
const bookingServerSrc = readFileSync(resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"), "utf8");
const bookingPageSrc = readFileSync(resolve(__dirname, "../../../guest-app/src/pages/BookingPage.tsx"), "utf8");
const apiRouterSrc = readFileSync(resolve(__dirname, "../../../guest-app/server/apiRouter.ts"), "utf8");
const roomBlocksSrc = readFileSync(resolve(__dirname, "../../../guest-app/server/handlers/room-blocks.ts"), "utf8");

describe("Phase 12 — calendar grid and seasonal rate overrides", () => {
  it("registers the admin booking calendar route and sidebar link", () => {
    expect(appSrc).toMatch(/import\s*\{\s*CalendarPage\s*\}/);
    expect(appSrc).toMatch(/<Route path="\/calendar" element=\{<CalendarPage \/>\}/);
    expect(sidebarSrc).toMatch(/\{ label: "Calendar", to: "\/calendar", icon: CalendarDays \}/);
  });

  it("calendar page renders an interactive room-by-date grid sourced from live bookings and room blocks", () => {
    expect(calendarSrc).toMatch(/gridTemplateColumns:\s*`150px repeat\(\$\{days\.length\}/);
    expect(calendarSrc).toMatch(/bookingsByRoom/);
    expect(calendarSrc).toMatch(/activeBlocksByRoom/);
    expect(calendarSrc).toMatch(/handleOpenDateClick/);
    expect(calendarSrc).toMatch(/rangeIncludesDate\(selection,\s*day\)/);
    expect(calendarSrc).toMatch(/Block dates/);
    expect(calendarSrc).toMatch(/Book dates/);
    expect(calendarSrc).toMatch(/Move booking/);
    expect(calendarSrc).toMatch(/roomBlockedOnLegacy/);
  });

  it("calendar actions use server-backed room block and reschedule APIs", () => {
    expect(contextSrc).toMatch(/roomBlocks:\s*RoomBlock\[\]/);
    expect(contextSrc).toMatch(/collection\(db,\s*"roomBlocks"\)/);
    expect(contextSrc).toMatch(/\/api\/room-blocks\/create/);
    expect(contextSrc).toMatch(/\/api\/bookings\/reschedule/);
    expect(apiRouterSrc).toMatch(/domain === "room-blocks"/);
    expect(apiRouterSrc).toMatch(/handleRescheduleBooking/);
    expect(roomBlocksSrc).toMatch(/assertRoomIsFreeForBlock/);
    expect(roomBlocksSrc).toMatch(/Cannot block dates that overlap an active booking/);
  });

  it("rates page persists seasonalRateOverrides under hotelConfig", () => {
    expect(contextSrc).toMatch(/seasonalRateOverrides:\s*\[\]/);
    expect(contextSrc).toMatch(/normalizeSeasonalRateOverrides\(hotelConfig\.seasonalRateOverrides\)/);
    expect(ratesSrc).toMatch(/Seasonal Rate Overrides/);
    expect(ratesSrc).toMatch(/updateSettings\("hotelConfig",\s*\{[\s\S]*seasonalRateOverrides:\s*next/);
  });

  it("server and guest booking pricing both use the shared seasonal calculator", () => {
    expect(bookingServerSrc).toMatch(/calculateSeasonalAwareRoomTotal/);
    expect(bookingServerSrc).toMatch(/normalizeSeasonalRateOverrides\(hotelConfig\.seasonalRateOverrides\)/);
    expect(bookingServerSrc).toMatch(/hasActiveRoomBlockConflict/);
    expect(bookingPageSrc).toMatch(/calculateSeasonalAwareRoomTotal/);
    expect(bookingPageSrc).toMatch(/seasonalRateOverrides/);
  });
});
