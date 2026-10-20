// Per OCT-C5 (2026-10-20, audit
// `plan/project/AUDIT-OCTOBER-2026.md`): a walk-in booking must
// PERSIST the breakfast selections + the other add-ons the desk
// selected.
//
// The pre-fix walk-in transaction read the breakfast config and
// then threw the payload away: it hard-coded
// `lineBreakfastTotal = 0` and wrote `breakfastSelections: {}`
// onto the booking. The string `otherAddOn` appeared ZERO times
// in `bookings.ts`, and the walk-in schema had no field for the
// add-ons (a Zod `z.object()` strips unknown keys silently).
//
// The impact: the desk picked meals + an airport transfer, the
// modal showed a total, the booking was created — and the guest
// received NO breakfast and NO transfer, the kitchen list was
// empty, and the hotel was NEVER CHARGED for either.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WalkinBookingSchema } from "@spark-inn/shared";

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const adminSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

/** Strip comments so the pins match CODE only. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const code = codeOnly(handlerSrc);

const validWalkin = {
  bookingId: "walkin000001",
  roomId: "room-101",
  checkIn: "2026-10-25",
  checkOut: "2026-10-27",
  guests: 2,
  guestDetails: {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "+639171234567"
  },
  paymentMethod: "Cash"
};

describe("OCT-C5 — the walk-in persists breakfast + other add-ons", () => {
  describe("the walk-in schema accepts the payloads the desk sends", () => {
    it("accepts `breakfastSelections`", () => {
      const parsed = WalkinBookingSchema.safeParse({
        ...validWalkin,
        breakfastSelections: {
          "2026-10-25-guest-0": { mealId: "tapsilog", mealName: "Tapsilog", price: 350 }
        },
        breakfastTotal: 350
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts `otherAddOnSelections` — the pre-fix schema STRIPPED it silently", () => {
      const parsed = WalkinBookingSchema.safeParse({
        ...validWalkin,
        otherAddOnSelections: {
          "2026-10-25": [
            {
              addOnId: "airport-transfer",
              nameSnapshot: "Airport transfer",
              priceSnapshot: 500,
              quantity: 2,
              unitSnapshot: "per-person"
            }
          ]
        },
        otherAddOnTotal: 1000,
        hasAnyOtherAddOns: true
      });
      expect(parsed.success).toBe(true);
    });

    it("KEEPS the other-add-on payload instead of stripping it", () => {
      // A Zod `z.object()` strips unknown keys, so the pre-fix
      // schema silently discarded the desk's selections.
      const parsed = WalkinBookingSchema.parse({
        ...validWalkin,
        otherAddOnSelections: { "2026-10-25": [{ addOnId: "airport-transfer", quantity: 2 }] }
      });
      expect((parsed as any).otherAddOnSelections).toBeDefined();
      expect(Object.keys((parsed as any).otherAddOnSelections)).toContain("2026-10-25");
    });
  });

  describe("the walk-in handler persists them", () => {
    it("validates the walk-in breakfast selections", () => {
      expect(code).toMatch(/validateBreakfastSelections\(\s*\{[\s\S]{0,400}?selections:\s*requestedBreakfastSelections/);
    });

    it("marks the walk-in as staff-created so the per-date cut-off does not block the desk", () => {
      // A walk-in creates a NEW booking — there is no prior
      // selection for the cut-off to lock.
      expect(code).toMatch(/staffCreated:\s*true/);
    });

    it("attributes the validated breakfast total to the first room line", () => {
      expect(code).toMatch(
        /const lineBreakfastTotal = lineIdx === 0 \? walkinBreakfastTotal : 0;/
      );
    });

    it("writes the validated selections onto the booking doc", () => {
      expect(code).toMatch(
        /breakfastSelections:\s*validatedWalkinBreakfast\?\.entries \?\? \{\}/
      );
    });

    it("writes the denormalized breakfastTotal onto the booking doc", () => {
      expect(code).toMatch(/breakfastTotal:\s*breakfastTotal,/);
    });

    it("writes the other add-ons onto the booking doc", () => {
      expect(code).toMatch(/otherAddOnSelections:\s*walkinOtherAddOnSelections/);
      expect(code).toMatch(/otherAddOnTotal:\s*walkinOtherAddOnTotal/);
    });

    it("no longer hard-codes an empty breakfast map in the walk-in write", () => {
      // Scoped to the walk-in write: the `handleAddRoomToReservation`
      // path also writes an empty map, but that is a SEPARATE defect
      // (it inherits the reservation's `breakfastTotal` onto the new
      // room's subtotal while giving the room no meal slots — a
      // double charge). It is not the walk-in bug and it is not
      // fixed here; see the audit report.
      const walkinWrite = code.slice(
        code.indexOf("const walkinRoomStayFinancials"),
        code.indexOf("const newReservation = {", code.indexOf("const walkinRoomStayFinancials"))
      );
      expect(walkinWrite).not.toMatch(/breakfastSelections:\s*\{\},/);
      expect(walkinWrite).toMatch(
        /breakfastSelections:\s*validatedWalkinBreakfast\?\.entries \?\? \{\}/
      );
    });

    it("rebuilds the other add-on entries from the live catalog", () => {
      // The persisted price must be the CATALOG price, never the
      // client's (the OCT-C2 rule, applied to the walk-in path).
      expect(code).toMatch(/priceSnapshot:\s*Math\.max\(0,\s*Number\(live\.price\)\s*\|\|\s*0\)/);
      expect(code).toMatch(/nameSnapshot:\s*live\.name/);
    });

    it("rejects an add-on that is not in the live catalog with a 400", () => {
      expect(code).toMatch(/OTHER_ADDON_NOT_AVAILABLE_ERROR/);
      expect(code).toMatch(
        /error\.name === "BreakfastSelectionValidationError"\s*\|\|\s*errorMessage === OTHER_ADDON_NOT_AVAILABLE_ERROR/
      );
    });

    it("reads the add-on catalog inside the transaction (before any write)", () => {
      expect(code).toMatch(
        /await transaction\.get\(adminDb\.collection\("addOns"\)\)/
      );
    });

    it("recomputes the other-add-on total with the shared helper", () => {
      expect(code).toMatch(/recomputeOtherAddOnTotal\(rebuilt\)/);
    });
  });

  describe("the admin modal still sends the payloads", () => {
    it("sends the walk-in breakfast selections", () => {
      expect(adminSrc).toMatch(/breakfastSelections:\s*walkinBreakfast\.breakfastSelections/);
    });

    it("sends the walk-in other add-ons", () => {
      expect(adminSrc).toMatch(/otherAddOnSelections:\s*walkinOtherAddOns\.otherAddOnSelections/);
    });
  });
});
