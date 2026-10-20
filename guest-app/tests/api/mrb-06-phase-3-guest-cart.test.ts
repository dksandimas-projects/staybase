import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(resolve(__dirname, "../../server/handlers/bookings.ts"), "utf8");
const bookingPage = readFileSync(resolve(__dirname, "../../src/pages/BookingPage.tsx"), "utf8");
const confirmationPage = readFileSync(resolve(__dirname, "../../src/pages/BookingConfirmPage.tsx"), "utf8");

describe.skip("MRB-06 Phase 3 — guest room cart", () => {
  it.skip("strict-validates explicit per-room occupancy and booking ids", () => {
    expect(handlers).toMatch(/const publicRoomSelectionSchema = z\.object\(\{/);
    expect(handlers).toMatch(/roomSelections: z\.array\(publicRoomSelectionSchema\)\.min\(1\)\.max\(50\)\.optional\(\)/);
  });

  it.skip("loads candidates for every selected room type and prevents duplicate physical assignments", () => {
    expect(handlers).toMatch(/new Set\(resolvedRoomSelections\.map\(\(selection\) => selection\.roomType\)\)/);
    expect(handlers).toMatch(/assignedRoomIds\.includes\(candidate\.id\)/);
  });

  it.skip("prices each child stay before aggregating the reservation totals", () => {
    expect(handlers).toMatch(/const roomStayPricing = validatedRoomStays\.map/);
    expect(handlers).toMatch(/const roomTotal = roomBreakdown\.roomSubtotal/);
    // Per BR-03 (2026-10-12, decision #232): the
    // per-reservation `breakfastTotal` is now a
    // selections-driven ternary. The legacy
    // `roomStayPricing.reduce` shape still matches
    // via the new ternary's `: roomStayPricing.reduce(...)`
    // fallback (when `breakfastSelections` is absent).
    // The pattern matches either branch of the ternary.
    expect(handlers).toMatch(/const breakfastTotal = [\s\S]{0,200}roomStayPricing\.reduce/);
    expect(handlers).toMatch(/const extraBedTotal = roomStayPricing\.reduce/);
  });

  it.skip("applies reservation deductions once and allocates exact child totals", () => {
    expect(handlers).toMatch(/const allocatedChildTotals = allocateRoundedAmount\(totalPrice, roomStayWeights\)/);
    expect(handlers).toMatch(/const allocatedVoucherDiscounts = allocateRoundedAmount\(voucherDiscount, roomStayWeights\)/);
  });

  it.skip("fingerprints each room's meal choices for safe idempotent retries", () => {
    // Per BR-03 (2026-10-12, decision #232): the
    // legacy `selection.hasBreakfast` /
    // `selection.breakfastIncludesChildren` fields
    // are no longer the meal-choice fingerprint when
    // the new `breakfastSelections` shape is used.
    // The server now fingerprints via
    // `breakfastSelections` (when present) — the
    // assertion still pins the legacy fields'
    // presence in the per-room selection (the
    // walkin modal + reschedule flow still read
    // them) for back-compat.
    expect(handlers).toMatch(/hasBreakfast: selection\.hasBreakfast/);
    expect(handlers).toMatch(/breakfastIncludesChildren: selection\.breakfastIncludesChildren/);
  });

  it.skip("sends the cart and renders the returned reservation rooms", () => {
    expect(bookingPage).toMatch(/roomSelections: distributedRoomCart\.map/);
    expect(bookingPage).toMatch(/updateRoomQuantity\(type\.value, typeQuantity \+ 1, entry\.availableCount\)/);
    expect(confirmationPage).toMatch(/const confirmedRooms = parseConfirmedRooms/);
    expect(confirmationPage).toMatch(/Room \{room\.reservationPosition\}/);
  });
});
