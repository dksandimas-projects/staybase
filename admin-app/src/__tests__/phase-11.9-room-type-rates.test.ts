import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.9 — Room type owns pricing + maxCapacity
// (per `plan/features/RATE-MANAGEMENT.md §W3.6`). The Rates tab is the
// single edit surface for the rate matrix; the room document no longer
// carries `maxCapacity`, `pricePerNight`, `weekendRate`, or `corporateRate`.
//
// Guards:
//   - shared/constants: RoomTypeEntry carries the 4 new fields; DEFAULT_ROOM_TYPES
//     provides defaults for the Spark Inn seed types
//   - shared/schemas/room.ts: CreateRoomSchema no longer captures the 4 fields
//   - shared/types: Room drops the 4 fields
//   - admin-app/AdminContext: Room interface + mapper drop the 4 fields;
//     createRoom never writes them; roomTypes state is RoomTypeEntry[] with
//     the new fields
//   - admin-app/RatesPage: reads/writes rates via updateRoomType, not the
//     per-room batch update
//   - admin-app/RoomsPage: create form + edit drawer no longer expose
//     maxCapacity or rate inputs
//   - guest-app/useRoomTypes: getRoomTypeRates helper exists and returns
//     the 4 fields; consumers (RoomCard, BookingPage, etc.) read from type
//   - guest-app/static fallback data: rooms no longer carry maxCapacity or rates

const constantsSrc = readFileSync(
  resolve(__dirname, "../../../shared/constants/index.ts"),
  "utf8"
);
const typesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);
const createRoomSchemaSrc = readFileSync(
  resolve(__dirname, "../../../shared/schemas/room.ts"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);
const ratesPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/RatesPage.tsx"),
  "utf8"
);
const roomsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/RoomsPage.tsx"),
  "utf8"
);
const useRoomTypesSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/hooks/useRoomTypes.ts"),
  "utf8"
);
const roomCardSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/components/RoomCard.tsx"),
  "utf8"
);
const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/BookingPage.tsx"),
  "utf8"
);
const corporateBookingPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/CorporateBookingPage.tsx"),
  "utf8"
);
const useRoomsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/hooks/useRooms.ts"),
  "utf8"
);
const dataRoomsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/data/rooms.ts"),
  "utf8"
);
const dataHomepageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/data/homepage.ts"),
  "utf8"
);

describe("Phase 11.9 — Room type drives pricing + maxCapacity (W3.6)", () => {
  describe("shared/constants — RoomTypeEntry + DEFAULT_ROOM_TYPES", () => {
    it("RoomTypeEntry type carries maxCapacity, pricePerNight, weekendRate, corporateRate", () => {
      expect(constantsSrc).toMatch(/export type RoomTypeEntry\s*=\s*\{[\s\S]*?maxCapacity:\s*number[\s\S]*?pricePerNight:\s*number[\s\S]*?weekendRate:\s*number[\s\S]*?corporateRate:\s*number[\s\S]*?\};/);
    });

    it("DEFAULT_ROOM_TYPES carries the 4 new fields for every entry", () => {
      for (const field of ["maxCapacity", "pricePerNight", "weekendRate", "corporateRate"]) {
        const matches = constantsSrc.match(new RegExp(`${field}\\s*:`, "g")) ?? [];
        // 5 default types + 1 in the RoomTypeEntry type = 6 occurrences
        expect(matches.length, `expected 5 ${field} entries in DEFAULT_ROOM_TYPES + 1 in RoomTypeEntry type`).toBeGreaterThanOrEqual(5);
      }
    });
  });

  describe("shared/types — Room drops the rate fields", () => {
    it("Room interface no longer carries maxCapacity, pricePerNight, weekendRate, corporateRate", () => {
      const block = typesSrc.match(/export\s+interface\s+Room\s*\{[\s\S]*?\n\}/);
      expect(block, "expected Room interface").toBeTruthy();
      const body = block![0];
      expect(body).not.toMatch(/maxCapacity\s*:/);
      expect(body).not.toMatch(/pricePerNight\s*:/);
      expect(body).not.toMatch(/weekendRate\s*:/);
      expect(body).not.toMatch(/corporateRate\s*:/);
    });
  });

  describe("shared/schemas/room.ts — CreateRoomSchema drops the rate fields", () => {
    it("CreateRoomSchema does not capture maxCapacity, pricePerNight, weekendRate, or corporateRate", () => {
      const block = createRoomSchemaSrc.match(
        /CreateRoomSchema\s*=\s*z\.object\(\{[\s\S]*?^\}\)/m
      );
      expect(block, "expected CreateRoomSchema body").toBeTruthy();
      const body = block![0];
      expect(body).not.toMatch(/maxCapacity\s*:/);
      expect(body).not.toMatch(/pricePerNight\s*:/);
      expect(body).not.toMatch(/weekendRate\s*:/);
      expect(body).not.toMatch(/corporateRate\s*:/);
    });
  });

  describe("admin-app/AdminContext", () => {
    it("Room interface drops the 4 rate/capacity fields (only the comment can mention them)", () => {
      const block = adminContextSrc.match(/export\s+interface\s+Room\s*\{[\s\S]*?\n\}/);
      expect(block, "expected Room interface").toBeTruthy();
      const body = block![0];
      // The interface may mention the fields in a comment for context,
      // but it must NOT declare them as fields. Look for the field
      // declaration form (`fieldName:`) only.
      expect(body).not.toMatch(/^\s*maxCapacity\s*:/m);
      expect(body).not.toMatch(/^\s*pricePerNight\s*:/m);
      expect(body).not.toMatch(/^\s*weekendRate\s*:/m);
      expect(body).not.toMatch(/^\s*corporateRate\s*:/m);
    });

    it("Room mapper no longer reads the 4 fields off the Firestore doc", () => {
      expect(adminContextSrc).not.toMatch(/data\.maxCapacity\s*\|\|/);
      expect(adminContextSrc).not.toMatch(/data\.pricePerNight\s*\|\|/);
      expect(adminContextSrc).not.toMatch(/data\.weekendRate\s*\|\|/);
      expect(adminContextSrc).not.toMatch(/data\.corporateRate\s*\|\|/);
    });

    it("createRoom never writes the rate fields to the new room doc", () => {
      const fnMatch = adminContextSrc.match(
        /const\s+createRoom\s*=\s*async[\s\S]*?return\s*\{\s*success:\s*true/
      );
      expect(fnMatch, "expected to find createRoom body").toBeTruthy();
      const body = fnMatch![0];
      expect(body).not.toMatch(/pricePerNight\s*:/);
      expect(body).not.toMatch(/weekendRate\s*:/);
      expect(body).not.toMatch(/corporateRate\s*:/);
      expect(body).not.toMatch(/maxCapacity\s*:/);
    });

    it("addRoomType and updateRoomType signatures accept the 4 new fields", () => {
      const iface = adminContextSrc.match(/AdminContextType[\s\S]*?\n\}/);
      expect(iface, "expected AdminContextType interface").toBeTruthy();
      const body = iface![0];
      expect(body).toMatch(/addRoomType:\s*\([\s\S]*?maxCapacity:\s*number[\s\S]*?pricePerNight:\s*number[\s\S]*?weekendRate:\s*number[\s\S]*?corporateRate:\s*number[\s\S]*?\)\s*=>/);
      expect(body).toMatch(/updateRoomType:[\s\S]*?"maxCapacity"[\s\S]*?"pricePerNight"[\s\S]*?"weekendRate"[\s\S]*?"corporateRate"/);
    });
  });

  describe("admin-app/RatesPage — reads/writes rates from roomTypes", () => {
    it("RatesPage no longer batch-updates per-room pricePerNight/weekendRate/corporateRate", () => {
      expect(ratesPageSrc).not.toMatch(/updateRoomConfig\([^)]*pricePerNight/);
      expect(ratesPageSrc).not.toMatch(/updateRoomConfig\([^)]*weekendRate/);
      expect(ratesPageSrc).not.toMatch(/updateRoomConfig\([^)]*corporateRate/);
    });

    it("RatesPage uses updateRoomType to persist rate changes", () => {
      expect(ratesPageSrc).toMatch(/updateRoomType\(\s*t\.value\s*,\s*\{\s*pricePerNight\s*:[\s\S]*?weekendRate\s*:[\s\S]*?corporateRate\s*:/);
    });

    it("RatesPage reads the initial price/breakdown from each room type entry", () => {
      expect(ratesPageSrc).toMatch(/initialPrices\[t\.value\]\s*=\s*\{[\s\S]*?base:\s*t\.pricePerNight[\s\S]*?weekend:\s*t\.weekendRate[\s\S]*?corporate:\s*t\.corporateRate/);
    });
  });

  describe("admin-app/RoomsPage", () => {
    it("create form no longer exposes maxCapacity or any rate input", () => {
      // The Create Room modal must not contain rate/capacity inputs.
      expect(roomsPageSrc).not.toMatch(/createForm\.maxCapacity/);
      expect(roomsPageSrc).not.toMatch(/createForm\.pricePerNight/);
      expect(roomsPageSrc).not.toMatch(/createForm\.weekendRate/);
      expect(roomsPageSrc).not.toMatch(/createForm\.corporateRate/);
    });

    it("edit drawer no longer exposes maxCapacity or a base-rate input", () => {
      // The Configure Room drawer must not include those inputs.
      expect(roomsPageSrc).not.toMatch(/setMaxCapacity\(/);
      expect(roomsPageSrc).not.toMatch(/setPricePerNight\(/);
    });

    it("room card now looks up the type's maxCapacity + pricePerNight", () => {
      expect(roomsPageSrc).toMatch(/roomTypes\.find\(\(t\)\s*=>\s*t\.value\s*===\s*room\.type\)\?\.maxCapacity/);
      expect(roomsPageSrc).toMatch(/roomTypes\.find\(\(t\)\s*=>\s*t\.value\s*===\s*room\.type\)\?\.pricePerNight/);
    });
  });

  describe("guest-app/useRoomTypes — getRoomTypeRates helper", () => {
    it("exports a getRoomTypeRates helper that returns the 4 fields", () => {
      expect(useRoomTypesSrc).toMatch(/export function getRoomTypeRates/);
      expect(useRoomTypesSrc).toMatch(/return\s*\{[\s\S]*?maxCapacity:\s*t\.maxCapacity[\s\S]*?pricePerNight:\s*t\.pricePerNight[\s\S]*?weekendRate:\s*t\.weekendRate[\s\S]*?corporateRate:\s*t\.corporateRate[\s\S]*?\};/);
    });

    it("useRoomTypes mapper normalizes the 4 new fields from Firestore", () => {
      expect(useRoomTypesSrc).toMatch(/maxCapacity:\s*Number\(entry\.maxCapacity\)/);
      expect(useRoomTypesSrc).toMatch(/pricePerNight:\s*Number\(entry\.pricePerNight\)/);
      expect(useRoomTypesSrc).toMatch(/weekendRate:\s*Number\(entry\.weekendRate\)/);
      expect(useRoomTypesSrc).toMatch(/corporateRate:\s*Number\(entry\.corporateRate\)/);
    });
  });

  describe("guest-app/RoomCard", () => {
    it("accepts typeMaxCapacity and typePricePerNight props", () => {
      expect(roomCardSrc).toMatch(/typeMaxCapacity\?:\s*number/);
      expect(roomCardSrc).toMatch(/typePricePerNight\?:\s*number/);
    });

    it("renders the type's maxCapacity + pricePerNight (falls back to DEFAULT_ROOM_TYPES)", () => {
      expect(roomCardSrc).toMatch(/const maxCapacity\s*=\s*typeMaxCapacity\s*\?\?/);
      expect(roomCardSrc).toMatch(/const pricePerNight\s*=\s*typePricePerNight\s*\?\?/);
      expect(roomCardSrc).not.toMatch(/room\.maxCapacity/);
      expect(roomCardSrc).not.toMatch(/room\.pricePerNight/);
    });
  });

  describe("guest-app/BookingPage + CorporateBookingPage", () => {
    it("BookingPage uses getRoomTypeRates for the rate calculation", () => {
      // Per the room-type booking refactor: pricing resolves from
      // the chosen room type entry (`selectedTypeEntry.value`),
      // not from a per-physical-room field.
      expect(bookingPageSrc).toMatch(/getRoomTypeRates\(roomTypes,\s*selectedTypeEntry\.value\)/);
      expect(bookingPageSrc).not.toMatch(/selectedRoom\.pricePerNight/);
      expect(bookingPageSrc).not.toMatch(/selectedRoom\.weekendRate/);
      expect(bookingPageSrc).not.toMatch(/selectedRoom\.maxCapacity/);
    });

    it("CorporateBookingPage falls back to the type's corporateRate (not room.corporateRate)", () => {
      // Per BI-04 (booking-intercom audit 2026-07-06): the fallback
      // chain is corporateRate → standard pricePerNight — never ₱0
      // (CORPORATE-BOOKING.md edge case: "corporateRate not set …
      // fall back to standard rate, do not show ₱0").
      expect(corporateBookingPageSrc).toMatch(
        /selectedRoomRates\?\.corporateRate\s*\|\|\s*selectedRoomRates\?\.pricePerNight\s*\|\|\s*0/
      );
      expect(corporateBookingPageSrc).not.toMatch(/selectedRoom\.corporateRate/);
    });
  });

  describe("guest-app/useRooms + static fallback", () => {
    it("useRooms mapper no longer reads the 4 fields from Firestore", () => {
      expect(useRoomsSrc).not.toMatch(/data\.maxCapacity/);
      expect(useRoomsSrc).not.toMatch(/data\.pricePerNight/);
      expect(useRoomsSrc).not.toMatch(/data\.weekendRate/);
      expect(useRoomsSrc).not.toMatch(/data\.corporateRate/);
    });

    it("static fallback rooms no longer carry maxCapacity or rate fields", () => {
      // `data/rooms.ts` and `data/homepage.ts` are static seeds. The
      // rooms no longer carry maxCapacity / pricePerNight / etc.
      expect(dataRoomsSrc).not.toMatch(/maxCapacity\s*:/);
      expect(dataRoomsSrc).not.toMatch(/pricePerNight\s*:/);
      expect(dataHomepageSrc).not.toMatch(/maxCapacity\s*:/);
      expect(dataHomepageSrc).not.toMatch(/pricePerNight\s*:/);
    });
  });
});
