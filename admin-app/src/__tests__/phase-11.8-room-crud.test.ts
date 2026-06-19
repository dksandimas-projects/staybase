import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.8 — Room CRUD (create + delete).
//
// Guards:
//   - Shared CreateRoomSchema (Zod) exists, is exported, and validates
//     the documented required fields and the roomNumber uniqueness
//     contract
//   - AdminContext exposes createRoom, deleteRoom, and hasActiveBookings
//     on the context type and the provider value
//   - createRoom writes the documented shape to Firestore with
//     serverTimestamp for createdAt/updatedAt and defaults to
//     weekendRate = corporateRate = pricePerNight
//   - deleteRoom performs the cascade cleanup (Storage photos,
//     intercoms/{roomNumber} + messages, calls/{roomNumber} +
//     iceCandidates) and refuses when active bookings exist
//   - RoomsPage renders an "Add Room" CTA, a Create modal, and a
//     Delete action inside the edit drawer
//   - firestore.rules restricts room delete to admins only

const createRoomSchemaSrc = readFileSync(
  resolve(__dirname, "../../../shared/schemas/room.ts"),
  "utf8"
);
const sharedIndexSrc = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);
const roomsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/RoomsPage.tsx"),
  "utf8"
);
const firestoreRulesSrc = readFileSync(
  resolve(__dirname, "../../../firebase/firestore.rules"),
  "utf8"
);
const roomMgmtDocSrc = readFileSync(
  resolve(__dirname, "../../../plan/features/ROOM-MANAGEMENT.md"),
  "utf8"
);
const backendDocSrc = readFileSync(
  resolve(__dirname, "../../../plan/docs/BACKEND.md"),
  "utf8"
);

describe("Phase 11.8 — Room CRUD (create + delete)", () => {
  describe("shared/schemas/room.ts — CreateRoomSchema", () => {
    it("exists and exports CreateRoomSchema", () => {
      expect(createRoomSchemaSrc).toMatch(/export const CreateRoomSchema\s*=\s*z\.object/);
    });

    it("exports CreateRoomInput as the inferred type", () => {
      expect(createRoomSchemaSrc).toMatch(/export type CreateRoomInput\s*=\s*z\.infer/);
    });

    it("exports ACTIVE_BOOKING_STATUSES with the 5 active statuses", () => {
      expect(createRoomSchemaSrc).toMatch(/export const ACTIVE_BOOKING_STATUSES/);
      const match = createRoomSchemaSrc.match(
        /ACTIVE_BOOKING_STATUSES\s*=\s*\[[\s\S]*?\]\s*as const/
      );
      expect(match, "expected to find ACTIVE_BOOKING_STATUSES array").toBeTruthy();
      const body = match![0];
      expect(body).toMatch(/["']pending["']/);
      expect(body).toMatch(/["']payment-uploaded["']/);
      expect(body).toMatch(/["']payment-confirmed["']/);
      expect(body).toMatch(/["']confirmed["']/);
      expect(body).toMatch(/["']checked-in["']/);
      expect(body).not.toMatch(/["']checked-out["']/);
      expect(body).not.toMatch(/["']cancelled["']/);
    });

    it("requires the documented fields: name, roomNumber, type, bedDefinition, status", () => {
      // Per W3.6 — `plan/features/RATE-MANAGEMENT.md §W3.6`:
      // `maxCapacity` and rates moved to the room type. The create
      // form only captures identity + display fields.
      const schemaMatch = createRoomSchemaSrc.match(
        /CreateRoomSchema\s*=\s*z\.object\(\{[\s\S]*?^\}\)/m
      );
      expect(schemaMatch, "expected to find CreateRoomSchema body").toBeTruthy();
      const body = schemaMatch![0];
      for (const field of ["name", "roomNumber", "type", "bedDefinition", "status"]) {
        const fieldMatch = body.match(new RegExp(`${field}\\s*:`));
        expect(fieldMatch, `expected ${field} in CreateRoomSchema`).toBeTruthy();
      }
    });

    it("does not capture maxCapacity or rates — they live on the room type", () => {
      const schemaMatch = createRoomSchemaSrc.match(
        /CreateRoomSchema\s*=\s*z\.object\(\{[\s\S]*?^\}\)/m
      );
      const body = schemaMatch![0];
      expect(body).not.toMatch(/maxCapacity\s*:/);
      expect(body).not.toMatch(/pricePerNight\s*:/);
      expect(body).not.toMatch(/weekendRate\s*:/);
      expect(body).not.toMatch(/corporateRate\s*:/);
    });

    it("re-exports the schema from the shared package barrel", () => {
      expect(sharedIndexSrc).toMatch(/export\s*\*\s*from\s*["']\.\/schemas\/room["']/);
    });
  });

  describe("AdminContext — createRoom", () => {
    it("imports CreateRoomInput and ACTIVE_BOOKING_STATUSES from @spark-inn/shared", () => {
      expect(adminContextSrc).toMatch(/import\s*\{[^}]*CreateRoomInput[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
      expect(adminContextSrc).toMatch(/import\s*\{[^}]*ACTIVE_BOOKING_STATUSES[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
    });

    it("declares createRoom, deleteRoom, and hasActiveBookings in the AdminContextType", () => {
      const iface = adminContextSrc.match(/AdminContextType[\s\S]*?\n\}/);
      expect(iface, "expected AdminContextType interface").toBeTruthy();
      const body = iface![0];
      expect(body).toMatch(/createRoom:\s*\(input:\s*CreateRoomInput\)/);
      expect(body).toMatch(/deleteRoom:\s*\(roomId:\s*string\)/);
      expect(body).toMatch(/hasActiveBookings:\s*\(roomId:\s*string\)\s*=>\s*number/);
    });

    it("createRoom rejects duplicate roomNumbers (case-insensitive trim compare)", () => {
      expect(adminContextSrc).toMatch(/const\s+createRoom\s*=\s*async/);
      expect(adminContextSrc).toMatch(/rooms\.find\s*\(/);
      expect(adminContextSrc).toMatch(/r\.roomNumber\.trim\(\)\.toLowerCase\(\)\s*===\s*normalizedNumber\.toLowerCase\(\)/);
      expect(adminContextSrc).toMatch(/is already in use/);
    });

    it("createRoom uses addDoc with serverTimestamp for createdAt/updatedAt", () => {
      expect(adminContextSrc).toMatch(/addDoc\(collection\(db,\s*["']rooms["']\)/);
      expect(adminContextSrc).toMatch(/createdAt:\s*serverTimestamp\(\)/);
      expect(adminContextSrc).toMatch(/updatedAt:\s*serverTimestamp\(\)/);
    });

    it("createRoom no longer writes pricePerNight, weekendRate, or corporateRate", () => {
      // Per W3.6 — pricing lives on the type; createRoom writes identity
      // + display fields only. The body should not contain any of the
      // three rate field writes.
      const fnMatch = adminContextSrc.match(
        /const\s+createRoom\s*=\s*async[\s\S]*?return\s*\{\s*success:\s*true/
      );
      expect(fnMatch, "expected to find createRoom body").toBeTruthy();
      const body = fnMatch![0];
      expect(body).not.toMatch(/pricePerNight\s*:/);
      expect(body).not.toMatch(/weekendRate\s*:/);
      expect(body).not.toMatch(/corporateRate\s*:/);
    });

    it("createRoom, deleteRoom, hasActiveBookings are all wired into the provider value", () => {
      const valueBlock = adminContextSrc.match(
        /AdminContext\.Provider[\s\S]*?value=\{\{([\s\S]*?)\}\}/
      );
      expect(valueBlock, "expected provider value object").toBeTruthy();
      const body = valueBlock![1];
      expect(body).toMatch(/createRoom,/);
      expect(body).toMatch(/deleteRoom,/);
      expect(body).toMatch(/hasActiveBookings,/);
    });
  });

  describe("AdminContext — deleteRoom", () => {
    it("hasActiveBookings filters bookings by ACTIVE_BOOKING_STATUSES", () => {
      expect(adminContextSrc).toMatch(/const\s+hasActiveBookings\s*=\s*\(roomId/);
      expect(adminContextSrc).toMatch(/bookings\.filter\s*\(/);
      expect(adminContextSrc).toMatch(/ACTIVE_BOOKING_STATUSES/);
    });

    it("deleteRoom short-circuits when active bookings exist and returns the count", () => {
      expect(adminContextSrc).toMatch(/const\s+deleteRoom\s*=\s*async\s*\(roomId/);
      expect(adminContextSrc).toMatch(/activeCount\s*=\s*hasActiveBookings\(roomId\)/);
      expect(adminContextSrc).toMatch(/if\s*\(\s*activeCount\s*>\s*0\s*\)/);
      expect(adminContextSrc).toMatch(/blockedByActiveBookings:\s*activeCount/);
    });

    it("deleteRoom cleans up Storage photos under rooms/{roomId}", () => {
      expect(adminContextSrc).toMatch(/storageRef\(storage,\s*`rooms\/\$\{roomId\}`\)/);
      expect(adminContextSrc).toMatch(/listAll\(folderRef\)/);
      expect(adminContextSrc).toMatch(/deleteObject\(item\)/);
    });

    it("deleteRoom cleans up intercoms/{roomNumber} + messages subcollection", () => {
      expect(adminContextSrc).toMatch(/`intercoms\/\$\{room\.roomNumber\}\/messages`/);
      expect(adminContextSrc).toMatch(/deleteDoc\(doc\(db,\s*["']intercoms["'],\s*room\.roomNumber\)/);
    });

    it("deleteRoom cleans up calls/{roomNumber} + iceCandidates subcollection", () => {
      expect(adminContextSrc).toMatch(/`calls\/\$\{room\.roomNumber\}\/iceCandidates`/);
      expect(adminContextSrc).toMatch(/deleteDoc\(doc\(db,\s*["']calls["'],\s*room\.roomNumber\)/);
    });

    it("deleteRoom finally removes the room document itself", () => {
      // There should be at least one deleteDoc targeting rooms/{roomId}.
      expect(adminContextSrc).toMatch(/deleteDoc\(doc\(db,\s*["']rooms["'],\s*roomId\)\)/);
    });
  });

  describe("AdminContext — Room type photos (W3.5 / type-driven gallery)", () => {
    it("roomTypes state is typed as RoomTypeEntry[] (no longer the legacy bare object)", () => {
      expect(adminContextSrc).toMatch(/useState<RoomTypeEntry\[\]>/);
    });

    it("imports RoomTypeEntry, MAX_ROOM_TYPE_PHOTOS, uploadBytes, and getDownloadURL from shared + storage SDKs", () => {
      expect(adminContextSrc).toMatch(/import\s*\{[^}]*RoomTypeEntry[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
      expect(adminContextSrc).toMatch(/import\s*\{[^}]*MAX_ROOM_TYPE_PHOTOS[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
      expect(adminContextSrc).toMatch(/import\s*\{[^}]*uploadBytes[^}]*\}\s*from\s*["']firebase\/storage["']/);
      expect(adminContextSrc).toMatch(/import\s*\{[^}]*getDownloadURL[^}]*\}\s*from\s*["']firebase\/storage["']/);
    });

    it("declares the photo CRUD methods on the AdminContextType", () => {
      const iface = adminContextSrc.match(/AdminContextType[\s\S]*?\n\}/);
      expect(iface, "expected AdminContextType interface").toBeTruthy();
      const body = iface![0];
      expect(body).toMatch(/uploadRoomTypePhoto:\s*\(typeValue:\s*string,\s*file:\s*File\)/);
      expect(body).toMatch(/removeRoomTypePhoto:\s*\(typeValue:\s*string,\s*url:\s*string\)/);
      expect(body).toMatch(/reorderRoomTypePhotos:\s*\(typeValue:\s*string,\s*imageUrls:\s*string\[\]\)/);
    });

    it("uploadRoomTypePhoto enforces the MAX_ROOM_TYPE_PHOTOS cap", () => {
      expect(adminContextSrc).toMatch(/type\.imageUrls\.length\s*>=\s*MAX_ROOM_TYPE_PHOTOS/);
      expect(adminContextSrc).toMatch(/Maximum \$\{MAX_ROOM_TYPE_PHOTOS\} photos per room type\./);
    });

    it("uploadRoomTypePhoto uploads to room-types/{typeValue}/ and appends the URL", () => {
      expect(adminContextSrc).toMatch(/`room-types\/\$\{typeValue\}\/\$\{Date\.now\(\)\}-\$\{safeName\}`/);
      expect(adminContextSrc).toMatch(/uploadBytes\(fileRef,\s*file\)/);
      expect(adminContextSrc).toMatch(/getDownloadURL\(fileRef\)/);
      expect(adminContextSrc).toMatch(/updateRoomType\(typeValue,\s*\{\s*imageUrls:\s*next\s*\}\)/);
    });

    it("removeRoomTypePhoto filters the URL out of the type's imageUrls and best-effort deletes from Storage", () => {
      expect(adminContextSrc).toMatch(/type\.imageUrls\.filter\(\s*\(u\)\s*=>\s*u\s*!==\s*url\s*\)/);
      expect(adminContextSrc).toMatch(/deleteObject\(fileRef\)/);
    });

    it("reorderRoomTypePhotos writes the new ordering via updateRoomType", () => {
      expect(adminContextSrc).toMatch(/updateRoomType\(typeValue,\s*\{\s*imageUrls\s*\}\)/);
    });

    it("addRoomType initializes an empty imageUrls array on new types", () => {
      expect(adminContextSrc).toMatch(/imageUrls:\s*Array\.isArray\(rt\.imageUrls\)\s*\?\s*rt\.imageUrls\s*:\s*\[\]/);
    });

    it("deleteRoomType cleans up the type's photos in Storage", () => {
      expect(adminContextSrc).toMatch(/storageRef\(storage,\s*`room-types\/\$\{value\}`\)/);
    });

    it("createRoom no longer writes imageUrls on the room document", () => {
      expect(adminContextSrc).not.toMatch(/imageUrls:\s*\[\]/);
    });

    it("Room mapper no longer reads imageUrls off the Firestore doc", () => {
      const roomTypeMatch = adminContextSrc.match(/export\s+interface\s+Room\s*\{[\s\S]*?\n\}/);
      expect(roomTypeMatch, "expected to find Room interface").toBeTruthy();
      const body = roomTypeMatch![0];
      expect(body).not.toMatch(/imageUrls/);
    });

    it("photo methods are wired into the provider value", () => {
      const valueBlock = adminContextSrc.match(
        /AdminContext\.Provider[\s\S]*?value=\{\{([\s\S]*?)\}\}/
      );
      expect(valueBlock, "expected provider value object").toBeTruthy();
      const body = valueBlock![1];
      expect(body).toMatch(/uploadRoomTypePhoto,/);
      expect(body).toMatch(/removeRoomTypePhoto,/);
      expect(body).toMatch(/reorderRoomTypePhotos,/);
    });
  });

  describe("RoomsPage — UI", () => {
    it("imports CreateRoomSchema, CreateRoomInput, useAdmin, Drawer, Modal, ConfirmForm", () => {
      expect(roomsPageSrc).toMatch(/import\s*\{[^}]*CreateRoomSchema[^}]*CreateRoomInput[^}]*\}\s*from\s*["']@spark-inn\/shared["']/);
      expect(roomsPageSrc).toMatch(/from\s*["']\.\.\/context\/AdminContext["']/);
      expect(roomsPageSrc).toMatch(/from\s*["']\.\.\/components\/Drawer["']/);
      expect(roomsPageSrc).toMatch(/from\s*["']\.\.\/components\/Modal["']/);
      expect(roomsPageSrc).toMatch(/from\s*["']\.\.\/components\/ConfirmForm["']/);
    });

    it("renders an Add Room button that opens the create modal", () => {
      const addButton = roomsPageSrc.match(/openCreateModal[\s\S]*?<\/button>/);
      expect(addButton, "expected to find Add Room button").toBeTruthy();
      expect(roomsPageSrc).toMatch(/Add Room/);
    });

    it("uses CreateRoomSchema.safeParse for form validation", () => {
      expect(roomsPageSrc).toMatch(/CreateRoomSchema\.safeParse\(createForm\)/);
    });

    it("renders a Delete Room button inside the edit drawer footer", () => {
      expect(roomsPageSrc).toMatch(/requestDelete\(selectedRoom\)/);
      expect(roomsPageSrc).toMatch(/Delete Room/);
    });

    it("disables the delete button when active bookings exist", () => {
      // The button's disabled attribute should be tied to hasActiveBookings
      expect(roomsPageSrc).toMatch(/disabled=\{hasActiveBookings\(selectedRoom\.id\)\s*>\s*0\}/);
    });

    it("uses ConfirmForm with reasonRequired for the destructive delete confirmation", () => {
      expect(roomsPageSrc).toMatch(/variant=["']danger["']/);
      expect(roomsPageSrc).toMatch(/reasonRequired/);
    });

    it("shows an active-bookings count on each room card", () => {
      expect(roomsPageSrc).toMatch(/active booking\$?\{/);
    });

    it("no longer uses confirm() or prompt()", () => {
      const confirmMatches = roomsPageSrc.match(/[^a-zA-Z]confirm\(/g) ?? [];
      const promptMatches = roomsPageSrc.match(/[^a-zA-Z]prompt\(/g) ?? [];
      expect(confirmMatches.length, `expected 0 confirm() in RoomsPage, found ${confirmMatches.length}`).toBe(0);
      expect(promptMatches.length, `expected 0 prompt() in RoomsPage, found ${promptMatches.length}`).toBe(0);
    });
  });

  describe("Firestore security — room delete is admin-only", () => {
    it("splits create/update from delete on the rooms collection", () => {
      const block = firestoreRulesSrc.match(/match \/rooms\/\{roomId\}\s*\{[\s\S]*?\n\s{4}\}/);
      expect(block, "expected to find rooms match block").toBeTruthy();
      const body = block![0];
      expect(body).toMatch(/allow read:\s*if true/);
      expect(body).toMatch(/allow create,\s*update:\s*if isStaff\(\)/);
      expect(body).toMatch(/allow delete:\s*if isAdmin\(\)/);
    });

    it("does not use the legacy blanket 'allow write: if isStaff()' for rooms", () => {
      const block = firestoreRulesSrc.match(/match \/rooms\/\{roomId\}\s*\{[\s\S]*?\n\s{4}\}/);
      const body = block![0];
      expect(body).not.toMatch(/allow write:\s*if isStaff\(\)/);
    });
  });

  describe("Documentation sync", () => {
    it("ROOM-MANAGEMENT.md documents Create + Delete flows", () => {
      expect(roomMgmtDocSrc).toMatch(/create.+read.+edit.+delete/s);
      expect(roomMgmtDocSrc).toMatch(/Active-booking guard/);
      expect(roomMgmtDocSrc).toMatch(/Delete Room/);
    });

    it("BACKEND.md notes admin-only room delete and the cascade cleanup", () => {
      expect(backendDocSrc).toMatch(/Create\/Update = Staff; Delete = Admin/);
      expect(backendDocSrc).toMatch(/rooms\/\{roomId\}\/\*/);
      expect(backendDocSrc).toMatch(/intercoms\/\{roomNumber\}/);
      expect(backendDocSrc).toMatch(/calls\/\{roomNumber\}/);
    });
  });
});
