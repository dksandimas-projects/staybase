import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.8 — Room photos now live on the room TYPE,
// not the individual room document. Per `plan/features/SETTINGS.md §Room Types`
// and `plan/docs/BACKEND.md §settings/hotelConfig.roomTypes`.
//
// Guards:
//   - Shared types + constants: Room no longer has imageUrls; RoomTypeEntry
//     has imageUrls[]; MAX_ROOM_TYPE_PHOTOS is exported
//   - Guest-app useRoomTypes hook subscribes to settings/hotelConfig and
//     returns the normalized list with a getRoomTypeImages helper
//   - Guest-app consumers (RoomCard + the page-level readers) call
//     getRoomTypeImages(roomTypes, room.type) instead of room.imageUrls
//   - Storage rules allow public read on room-types/{value}/*

const constantsSrc = readFileSync(
  resolve(__dirname, "../../../shared/constants/index.ts"),
  "utf8"
);
const typesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
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
const useRoomsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/hooks/useRooms.ts"),
  "utf8"
);
const homePageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/HomePage.tsx"),
  "utf8"
);
const roomsPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/RoomsPage.tsx"),
  "utf8"
);
const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/BookingPage.tsx"),
  "utf8"
);
const corporateStaysPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/CorporateStaysPage.tsx"),
  "utf8"
);
const corporateBookingPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/CorporateBookingPage.tsx"),
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
const storageRulesSrc = readFileSync(
  resolve(__dirname, "../../../firebase/storage.rules"),
  "utf8"
);
const backendDocSrc = readFileSync(
  resolve(__dirname, "../../../plan/docs/BACKEND.md"),
  "utf8"
);
const typesDocSrc = readFileSync(
  resolve(__dirname, "../../../plan/docs/TYPES.md"),
  "utf8"
);
const settingsDocSrc = readFileSync(
  resolve(__dirname, "../../../plan/features/SETTINGS.md"),
  "utf8"
);
const roomMgmtDocSrc = readFileSync(
  resolve(__dirname, "../../../plan/features/ROOM-MANAGEMENT.md"),
  "utf8"
);

describe("Phase 11.8 — Room type photos (type-driven gallery)", () => {
  describe("shared/constants + types", () => {
    it("DEFAULT_ROOM_TYPES now has imageUrls: [] on every entry", () => {
      const matches = constantsSrc.match(/imageUrls:\s*\[\]/g) ?? [];
      expect(matches.length, "expected every DEFAULT_ROOM_TYPES entry to declare imageUrls: []").toBeGreaterThanOrEqual(5);
    });

    it("RoomTypeEntry shape now includes imageUrls: string[]", () => {
      expect(constantsSrc).toMatch(/export type RoomTypeEntry\s*=\s*\{[\s\S]*?imageUrls:\s*string\[\][\s\S]*?\};/);
    });

    it("MAX_ROOM_TYPE_PHOTOS is exported with a sensible cap", () => {
      const match = constantsSrc.match(/export const MAX_ROOM_TYPE_PHOTOS\s*=\s*(\d+);/);
      expect(match, "expected MAX_ROOM_TYPE_PHOTOS constant").toBeTruthy();
      const cap = Number(match![1]);
      expect(cap).toBeGreaterThanOrEqual(1);
      expect(cap).toBeLessThanOrEqual(25);
    });

    it("Room interface no longer has imageUrls", () => {
      const roomIface = typesSrc.match(/export\s+interface\s+Room\s*\{[\s\S]*?\n\}/);
      expect(roomIface, "expected Room interface").toBeTruthy();
      expect(roomIface![0]).not.toMatch(/imageUrls/);
    });
  });

  describe("guest-app useRoomTypes hook", () => {
    it("lives at guest-app/src/hooks/useRoomTypes.ts and exports useRoomTypes + getRoomTypeImages", () => {
      expect(useRoomTypesSrc).toMatch(/export function useRoomTypes/);
      expect(useRoomTypesSrc).toMatch(/export function getRoomTypeImages/);
    });

    it("subscribes to settings/hotelConfig via onSnapshot", () => {
      expect(useRoomTypesSrc).toMatch(/doc\(db,\s*["']settings["'],\s*["']hotelConfig["']\)/);
      expect(useRoomTypesSrc).toMatch(/onSnapshot/);
    });

    it("falls back to DEFAULT_ROOM_TYPES when the field is missing or empty", () => {
      expect(useRoomTypesSrc).toMatch(/DEFAULT_ROOM_TYPES/);
      expect(useRoomTypesSrc).toMatch(/imageUrls:\s*\[\.\.\.t\.imageUrls\]/);
    });

    it("getRoomTypeImages returns the array for a matching value, or [] otherwise", () => {
      expect(useRoomTypesSrc).toMatch(/return types\.find\(\s*\(t\)\s*=>\s*t\.value\s*===\s*typeValue\s*\)\?\.imageUrls\s*\?\?\s*\[\]/);
    });
  });

  describe("guest-app useRooms hook drops imageUrls from the mapper", () => {
    it("Room mapper no longer reads or assigns imageUrls", () => {
      expect(useRoomsSrc).not.toMatch(/imageUrls/);
    });
  });

  describe("guest-app consumers render type images, not per-room images", () => {
    it("RoomCard accepts typeImageUrls prop and uses it as the hero image", () => {
      expect(roomCardSrc).toMatch(/typeImageUrls\?:\s*string\[\]/);
      expect(roomCardSrc).toMatch(/const heroImage\s*=\s*typeImageUrls\[0\]/);
      expect(roomCardSrc).not.toMatch(/room\.imageUrls/);
    });

    it("HomePage imports useRoomTypes and passes typeImageUrls to RoomCard", () => {
      expect(homePageSrc).toMatch(/import\s*\{[^}]*useRoomTypes[^}]*\}\s*from\s*["']\.\.\/hooks\/useRoomTypes["']/);
      expect(homePageSrc).toMatch(/getRoomTypeImages\(roomTypes,\s*room\.type\)/);
      expect(homePageSrc).not.toMatch(/room\.imageUrls/);
    });

    it("RoomsPage uses getRoomTypeImages for the grid cards and the detail modal", () => {
      expect(roomsPageSrc).toMatch(/getRoomTypeImages\(roomTypes,\s*room\.type\)/);
      expect(roomsPageSrc).not.toMatch(/selectedRoom\.imageUrls/);
    });

    it("BookingPage uses type images in the room list and the review aside", () => {
      expect(bookingPageSrc).toMatch(/getRoomTypeImages\(roomTypes,\s*room\.type\)/);
      expect(bookingPageSrc).toMatch(/typeImageUrls=\{selectedRoom\s*\?\s*getRoomTypeImages/);
    });

    it("CorporateStaysPage falls back to ROOM_TYPE_IMAGES when no live type is found", () => {
      expect(corporateStaysPageSrc).toMatch(/ROOM_TYPE_IMAGES/);
      expect(corporateStaysPageSrc).toMatch(/resolveTypeImages/);
    });

    it("CorporateBookingPage uses type images in both the room list and the review aside", () => {
      expect(corporateBookingPageSrc).toMatch(/getRoomTypeImages\(roomTypes,\s*selectedRoom\.type\)/);
      expect(corporateBookingPageSrc).toMatch(/typeImageUrls=/);
    });

    it("no consumer reads room.imageUrls or selectedRoom.imageUrls anymore", () => {
      const consumers = [homePageSrc, roomsPageSrc, bookingPageSrc, corporateStaysPageSrc, corporateBookingPageSrc];
      for (const src of consumers) {
        expect(src, "found a remaining imageUrls reference").not.toMatch(/\broom\.imageUrls\b/);
        expect(src, "found a remaining selectedRoom.imageUrls reference").not.toMatch(/selectedRoom\.imageUrls\b/);
      }
    });
  });

  describe("guest-app static fallback data", () => {
    it("data/rooms.ts no longer sets imageUrls on static rooms", () => {
      expect(dataRoomsSrc).not.toMatch(/imageUrls:/);
    });

    it("data/homepage.ts ships a ROOM_TYPE_IMAGES map keyed by type value", () => {
      expect(dataHomepageSrc).toMatch(/export const ROOM_TYPE_IMAGES/);
      expect(dataHomepageSrc).toMatch(/Record<string,\s*string\[\]>/);
      // The default Spark Inn types should be covered. The keys may be
      // either quoted or unquoted depending on whether the value is a
      // valid JS identifier, so we match either form.
      for (const key of ["executive", "standard-double", "family", "standard-twin", "single"]) {
        const rx = new RegExp(`(?:^|[{,\\s])(["']?)${key.replace(/-/g, "-")}\\1\\s*:`);
        expect(rx.test(dataHomepageSrc), `expected ROOM_TYPE_IMAGES to key ${key}`).toBe(true);
      }
    });
  });

  describe("Storage rules — room-types/{value}/* is public read, staff write", () => {
    it("declares the room-types match block", () => {
      const block = storageRulesSrc.match(
        /match \/room-types\/\{typeValue\}\/\{fileName\}\s*\{[\s\S]*?\}/
      );
      expect(block, "expected room-types match block").toBeTruthy();
      const body = block![0];
      expect(body).toMatch(/allow read:\s*if true/);
      expect(body).toMatch(/allow write:\s*if isStaff\(\)/);
    });
  });

  describe("Documentation sync", () => {
    it("BACKEND.md notes that room images, pricing, and capacity live on the type", () => {
      // Per W3.6 the type now owns images + pricing + maxCapacity.
      expect(backendDocSrc).toMatch(/Photos.*NOT stored on individual rooms/i);
      expect(backendDocSrc).toMatch(/room-types\/\{typeValue\}\/\{filename\}/);
    });

    it("BACKEND.md notes the type photos entry in settings/hotelConfig", () => {
      expect(backendDocSrc).toMatch(/`roomTypes\[\]`/);
      expect(backendDocSrc).toMatch(/Maximum 10 photos per type/);
    });

    it("TYPES.md adds a RoomType shape and notes the type-driven pricing + gallery", () => {
      expect(typesDocSrc).toMatch(/RoomType\s*\{/);
      expect(typesDocSrc).toMatch(/imageUrls:\s*string\[\]/);
      expect(typesDocSrc).toMatch(/maxCapacity:\s*number/);
      expect(typesDocSrc).toMatch(/pricePerNight:\s*number/);
    });

    it("SETTINGS.md documents the Room Types photo manager", () => {
      expect(settingsDocSrc).toMatch(/Room Type Photos/);
      expect(settingsDocSrc).toMatch(/imageUrls/i);
    });

    it("ROOM-MANAGEMENT.md no longer prescribes per-room imageUrls", () => {
      // The old spec said "upload and manage photos" per room. The new spec
      // defers that to Settings. We only require the spec to NOT carry the
      // legacy `imageUrls: string[]` field on the room doc.
      expect(roomMgmtDocSrc).not.toMatch(/Photo upload:\s*drag-and-drop or file picker/);
    });
  });
});
