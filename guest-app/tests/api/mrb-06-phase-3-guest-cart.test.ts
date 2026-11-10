import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlers = readFileSync(resolve(__dirname, "../../server/handlers/bookings.ts"), "utf8");
const bookingPage = readFileSync(resolve(__dirname, "../../src/pages/BookingPage.tsx"), "utf8");
const confirmationPage = readFileSync(resolve(__dirname, "../../src/pages/BookingConfirmPage.tsx"), "utf8");

describe("MRB-06 Phase 3 — guest room cart", () => {
  it("strict-validates explicit per-room occupancy and booking ids", () => {
    expect(handlers).toMatch(/const publicRoomSelectionSchema = z\.object\(\{/);
    expect(handlers).toMatch(/roomSelections: z\.array\(publicRoomSelectionSchema\)\.min\(1\)\.max\(50\)\.optional\(\)/);
  });

  it("loads candidates for every selected room type and prevents duplicate physical assignments", () => {
    expect(handlers).toMatch(/new Set\(resolvedRoomSelections\.map\(\(selection\) => selection\.roomType\)\)/);
    expect(handlers).toMatch(/assignedRoomIds\.includes\(candidate\.id\)/);
  });

  it("prices each child stay before aggregating the reservation totals", () => {
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

  it("applies reservation deductions once and allocates exact child totals", () => {
    expect(handlers).toMatch(/const allocatedChildTotals = allocateRoundedAmount\(totalPrice, roomStayWeights\)/);
    expect(handlers).toMatch(/const allocatedVoucherDiscounts = allocateRoundedAmount\(voucherDiscount, roomStayWeights\)/);
  });

  it("fingerprints each room's meal choices for safe idempotent retries", () => {
    // Per BR-08 (2026-10-14, decision #238 — close-out): the legacy
    // `selection.hasBreakfast` / `selection.breakfastIncludesChildren`
    // flat-rate flags are deleted from the reservation request
    // fingerprint. The fingerprint now uses the rich
    // `breakfastSelections` map.
    //
    // The shared helper (`computeRequestFingerprint`) normalizes a
    // flat per-room ARRAY of `{ key, mealId, price }` — it stays
    // oblivious to the wire shape. The HOST code has to project the
    // request's record into that array form, so BOTH halves are
    // pinned here:
    //
    //   1. the shared helper carries `breakfastSelections` on the
    //      normalized room line, and
    //   2. the handler projects the request's selections into every
    //      fingerprint room line.
    //
    // Without (2) the fingerprint is blind to meal choices: a guest
    // who submits, loses the response, changes their meal, and
    // resubmits with the same preallocated `reservationId` would get
    // a REPLAY of the original booking — their new selection silently
    // dropped and the original amount charged.
    expect(handlers).toMatch(/breakfastSelections: fingerprintBreakfastSelections/);
    expect(handlers).toMatch(/breakfastSelections: walkinFingerprintBreakfastSelections/);
    expect(handlers).toMatch(/function projectBreakfastSelectionsForFingerprint\(/);
  });

  it("sends the cart and renders the returned reservation rooms", () => {
    expect(bookingPage).toMatch(/roomSelections: distributedRoomCart\.map/);
    expect(bookingPage).toMatch(/updateRoomQuantity\(type\.value, typeQuantity \+ 1, entry\.availableCount\)/);
    expect(confirmationPage).toMatch(/const confirmedRooms = parseConfirmedRooms/);
    expect(confirmationPage).toMatch(/Room \{room\.reservationPosition\}/);
  });
});
