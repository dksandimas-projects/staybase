import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.9 / W3.7 — bed description, description,
// and amenities move off the room document and onto the room type,
// joining the existing maxCapacity + rate fields (W3.6). The Room
// Types section of Settings also gains an Edit modal so staff can
// update every type field from one place.
//
// Guards:
//   - shared/constants: RoomTypeEntry now includes bedDefinition,
//     description, amenities; DEFAULT_ROOM_TYPES seeds values
//   - shared/types: Room drops bedDefinition, description, amenities
//   - shared/schemas: CreateRoomSchema no longer captures them
//   - admin-app/AdminContext: Room interface + mapper + createRoom
//     drop them; addRoomType / updateRoomType signatures accept them
//   - admin-app/SettingsPage: add form has the 3 new fields; a new
//     Edit button + Edit modal exists in the table
//   - admin-app/RoomsPage: create form no longer carries the fields;
//     card looks up the type
//   - guest-app: useRoomTypes + consumers read bed/description/
//     amenities from the type

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
const settingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
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

const countMatches = (src: string, re: RegExp) => (src.match(re) ?? []).length;

describe("Phase 11.9 — Room type carries bed/description/amenities (W3.7)", () => {
  describe("shared/constants + types", () => {
    it("RoomTypeEntry type carries bedDefinition, description, amenities", () => {
      const block = constantsSrc.match(/export type RoomTypeEntry\s*=\s*\{[\s\S]*?\};/);
      expect(block, "expected RoomTypeEntry type").toBeTruthy();
      const body = block![0];
      expect(body).toMatch(/bedDefinition:\s*string/);
      expect(body).toMatch(/description:\s*string/);
      expect(body).toMatch(/amenities:\s*string\[\]/);
    });

    it("DEFAULT_ROOM_TYPES seeds bedDefinition, description, amenities for all 5 types", () => {
      // Find the start of the array literal and the closing `];` for
      // the export. This avoids matching `]` inside the amenities
      // arrays of the entries.
      const startIdx = constantsSrc.indexOf("DEFAULT_ROOM_TYPES");
      expect(startIdx, "DEFAULT_ROOM_TYPES must exist").toBeGreaterThanOrEqual(0);
      // Advance to the first `[` after the `=`.
      const arrStart = constantsSrc.indexOf("[", startIdx);
      const arrEnd = constantsSrc.indexOf("];", arrStart);
      expect(arrStart, "[ after =").toBeGreaterThanOrEqual(0);
      expect(arrEnd, "]; closing the array").toBeGreaterThan(arrStart);
      const body = constantsSrc.slice(arrStart, arrEnd);
      for (const field of ["bedDefinition", "description", "amenities"]) {
        const matches = countMatches(body, new RegExp(`${field}\\s*:`, "g"));
        expect(matches, `expected 5 ${field} entries in DEFAULT_ROOM_TYPES`).toBe(5);
      }
    });

    it("Room interface no longer carries bedDefinition, description, amenities", () => {
      const block = typesSrc.match(/export\s+interface\s+Room\s*\{[\s\S]*?\n\}/);
      expect(block, "expected Room interface").toBeTruthy();
      const body = block![0];
      expect(body).not.toMatch(/^\s*bedDefinition\s*:/m);
      expect(body).not.toMatch(/^\s*description\s*:/m);
      expect(body).not.toMatch(/^\s*amenities\s*:/m);
    });
  });

  describe("shared/schemas/room.ts", () => {
    it("CreateRoomSchema no longer captures bedDescription or description", () => {
      const block = createRoomSchemaSrc.match(
        /CreateRoomSchema\s*=\s*z\.object\(\{[\s\S]*?^\}\)/m
      );
      const body = block![0];
      expect(body).not.toMatch(/bedDefinition\s*:/);
      expect(body).not.toMatch(/description\s*:/);
    });
  });

  describe("admin-app/AdminContext", () => {
    // Extract the Room interface block (start to first `}` at column 0).
    const roomIfaceBlock = (() => {
      const m = adminContextSrc.match(/export\s+interface\s+Room\s*\{[\s\S]*?\n\}/);
      return m ? m[0] : "";
    })();

    // The Room mapper sits between the onSnapshot for `rooms` and the
    // next major declaration. The mapper uses the literal `data = doc.data()`
    // and emits the per-room fields. Find it by anchoring on the
    // "rooms/" path in the onSnapshot call.
    const roomsMapperBlock = (() => {
      const m = adminContextSrc.match(
        /onSnapshot\([\s\S]*?setRooms\([\s\S]*?\}\);[\s\S]*?\}/m
      );
      return m ? m[0] : "";
    })();

    // The createRoom function is the action wired into the context
    // for room creation.
    const createRoomBlock = (() => {
      const m = adminContextSrc.match(
        /const\s+createRoom\s*=\s*async[\s\S]*?\n\s*\};/
      );
      return m ? m[0] : "";
    })();

    it("Room interface drops bedDefinition, description, amenities", () => {
      expect(roomIfaceBlock, "expected Room interface").toBeTruthy();
      expect(roomIfaceBlock).not.toMatch(/^\s*bedDefinition\s*:/m);
      expect(roomIfaceBlock).not.toMatch(/^\s*description\s*:/m);
      expect(roomIfaceBlock).not.toMatch(/^\s*amenities\s*:/m);
    });

    it("Room mapper drops bedDefinition, description, amenities", () => {
      expect(roomsMapperBlock, "expected rooms onSnapshot mapper").toBeTruthy();
      expect(roomsMapperBlock).not.toMatch(/data\.bedDefinition/);
      expect(roomsMapperBlock).not.toMatch(/data\.description/);
      expect(roomsMapperBlock).not.toMatch(/data\.amenities/);
    });

    it("createRoom never writes bedDefinition, description, or amenities", () => {
      expect(createRoomBlock, "expected createRoom body").toBeTruthy();
      expect(createRoomBlock).not.toMatch(/bedDefinition\s*:/);
      expect(createRoomBlock).not.toMatch(/description\s*:/);
      expect(createRoomBlock).not.toMatch(/amenities\s*:/);
    });

    it("addRoomType and updateRoomType signatures accept the 3 new fields", () => {
      const iface = adminContextSrc.match(/AdminContextType[\s\S]*?\n\}/);
      expect(iface, "expected AdminContextType interface").toBeTruthy();
      const body = iface![0];
      expect(body).toMatch(/addRoomType:[\s\S]*?bedDefinition:\s*string/);
      expect(body).toMatch(/addRoomType:[\s\S]*?description:\s*string/);
      expect(body).toMatch(/addRoomType:[\s\S]*?amenities:\s*string\[\]/);
      expect(body).toMatch(/updateRoomType:[\s\S]*?"bedDefinition"[\s\S]*?"description"[\s\S]*?"amenities"/);
    });

    it("roomTypes stream mapper normalizes the 3 new fields from Firestore", () => {
      expect(adminContextSrc).toMatch(/bedDefinition:\s*([a-zA-Z_$][\w$]*\.bedDefinition\s*\|\|\s*"")/);
      expect(adminContextSrc).toMatch(/description:\s*[a-zA-Z_$][\w$]*\.description\s*\|\|\s*""/);
      expect(adminContextSrc).toMatch(/Array\.isArray\([a-zA-Z_$][\w$]*\.amenities\)/);
    });
  });

  describe("admin-app/SettingsPage — Edit Room Type modal", () => {
    it("add-type form captures bed, description, amenities", () => {
      expect(settingsPageSrc).toMatch(/name="bed"/);
      expect(settingsPageSrc).toMatch(/name="desc"/);
      expect(settingsPageSrc).toMatch(/name="amen"/);
    });

    it("room types table has a per-row Edit button (mobile + desktop)", () => {
      // The Edit button is rendered for both mobile and desktop tables.
      const editButtonOpens = settingsPageSrc.match(
        /onClick=\{\(\)\s*=>\s*setEditType\(type\)\s*\}/
      );
      expect(editButtonOpens, "expected Edit button click handler").toBeTruthy();
      const count = countMatches(
        settingsPageSrc,
        /onClick=\{\(\)\s*=>\s*setEditType\(type\)\s*\}/g
      );
      expect(count, "expected Edit button in mobile + desktop tables").toBeGreaterThanOrEqual(2);
    });

    it("Edit Room Type modal exists and saves via updateRoomType", () => {
      // The Edit modal title is computed from the type label.
      expect(settingsPageSrc).toMatch(
        /title=\{editType\s*\?\s*`Edit\s*·\s*\$\{editType\.label\}`\s*:\s*"Edit room type"\}/
      );
      const editForm = settingsPageSrc.match(
        /id="edit-room-type-form"[\s\S]*?<\/form>/
      );
      expect(editForm, "expected to find the Edit Room Type form").toBeTruthy();
      expect(editForm![0]).toMatch(/name="bed"/);
      expect(editForm![0]).toMatch(/name="desc"/);
      expect(editForm![0]).toMatch(/name="amen"/);
      // The save path calls updateRoomType with the new + rate fields.
      expect(settingsPageSrc).toMatch(
        /updateRoomType\(editType\.value,\s*\{[\s\S]*?bedDefinition[\s\S]*?description[\s\S]*?amenities[\s\S]*?maxCapacity[\s\S]*?pricePerNight[\s\S]*?weekendRate[\s\S]*?corporateRate/
      );
    });
  });

  describe("admin-app/RoomsPage — no per-room bed/description/amenities in create form", () => {
    it("create form does not reference bedDefinition, description, or amenities", () => {
      expect(roomsPageSrc).not.toMatch(/createForm\.bedDefinition/);
      expect(roomsPageSrc).not.toMatch(/createForm\.description/);
      expect(roomsPageSrc).not.toMatch(/createForm\.amenities/);
      expect(roomsPageSrc).not.toMatch(/createErrors\.bedDefinition/);
      expect(roomsPageSrc).not.toMatch(/createErrors\.description/);
    });

    it("edit drawer no longer has per-room bed state; card looks up the type", () => {
      expect(roomsPageSrc).not.toMatch(/setBedDefinition\(/);
      expect(roomsPageSrc).toMatch(
        /roomTypes\.find\(\(t\)\s*=>\s*t\.value\s*===\s*room\.type\)\?\.bedDefinition/
      );
    });
  });

  describe("guest-app — useRoomTypes returns the 3 new fields", () => {
    it("useRoomTypes mapper normalizes bedDefinition, description, amenities from Firestore", () => {
      expect(useRoomTypesSrc).toMatch(/bedDefinition:\s*String\(entry\.bedDefinition\s*\?\?\s*fallback/);
      expect(useRoomTypesSrc).toMatch(/description:\s*String\(entry\.description\s*\?\?\s*fallback/);
      expect(useRoomTypesSrc).toMatch(/Array\.isArray\(entry\.amenities\)/);
    });
  });

  describe("guest-app — RoomCard", () => {
    it("accepts typeBedDefinition, typeDescription, typeAmenities props", () => {
      expect(roomCardSrc).toMatch(/typeBedDefinition\?:\s*string/);
      expect(roomCardSrc).toMatch(/typeDescription\?:\s*string/);
      expect(roomCardSrc).toMatch(/typeAmenities\?:\s*string\[\]/);
    });

    it("renders the type's bed/description/amenities (falls back to DEFAULT_ROOM_TYPES)", () => {
      expect(roomCardSrc).toMatch(/const\s+bedDefinition\s*=\s*typeBedDefinition\s*\?\?\s*fallback/);
      expect(roomCardSrc).toMatch(/const\s+description\s*=\s*typeDescription\s*\?\?\s*fallback/);
      expect(roomCardSrc).toMatch(/const\s+amenities\s*=\s*typeAmenities\s*\?\?\s*fallback/);
    });
  });

  describe("guest-app — useRooms + static fallback data", () => {
    it("useRooms mapper no longer reads bedDefinition, description, amenities", () => {
      expect(useRoomsSrc).not.toMatch(/data\.bedDefinition/);
      expect(useRoomsSrc).not.toMatch(/data\.description/);
      expect(useRoomsSrc).not.toMatch(/data\.amenities/);
    });

    it("static fallback data (rooms.ts) does not carry bed/description/amenities fields", () => {
      // Look only for the field declarations of the room seeds. The
      // docstring comments above are allowed to mention these words.
      expect(dataRoomsSrc).not.toMatch(/^\s*bedDefinition\s*:/m);
      expect(dataRoomsSrc).not.toMatch(/^\s*description\s*:/m);
      expect(dataRoomsSrc).not.toMatch(/^\s*amenities\s*:/m);
    });

    it("static fallback data (homepage.ts) does not carry bed/description/amenities in featuredRooms", () => {
      // The `featuredRooms` array in homepage.ts is the room seed.
      // Slice the array body and assert no room fields.
      const idx = dataHomepageSrc.indexOf("featuredRooms");
      expect(idx, "expected featuredRooms in homepage.ts").toBeGreaterThanOrEqual(0);
      const arrStart = dataHomepageSrc.indexOf("[", idx);
      const arrEnd = dataHomepageSrc.indexOf("];", arrStart);
      const body = dataHomepageSrc.slice(arrStart, arrEnd);
      expect(body).not.toMatch(/^\s*bedDefinition\s*:/m);
      expect(body).not.toMatch(/^\s*description\s*:/m);
      expect(body).not.toMatch(/^\s*amenities\s*:/m);
    });
  });
});
