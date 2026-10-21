// Per RPT-04 (QA pass 2026-10-21): the BR-12 other-add-ons write
// path was 100% dead.
//
// THE DEFECT THIS SUITE PINS
// --------------------------
// `OtherAddOnUpdateSchema` (guest) and `StaffOtherAddOnUpdateSchema`
// (staff) both REQUIRED a `selections` field — a record of
// `serviceDate -> OtherAddOnSelectionEntry[]`.
//
// But the mutation contract those two schemas guard is the OP list:
// `add` / `change` / `remove`. Both handlers read the ops off the
// raw body via their own `readOps(body)` helper and NEVER read
// `selections` at all.
//
// The guest client (`ManageOtherAddOnsPage.tsx`) sends:
//
//   { bookingRef, lookupToken, clientBatchId, add, change, remove }
//
// and the staff drawer sends the staff-shaped equivalent. Neither
// sends `selections`. So `safeParse` failed on the missing field
// and BOTH endpoints answered "Invalid other-add-ons update
// payload." (HTTP 400) on every save.
//
// The whole BR-12 other-add-ons write path — guest and staff — could
// never be written. A guest adding an extra pillow at the front desk
// got a silent no-op.
//
// THE FIX
// -------
// `selections` is now optional on both schemas. The handlers still
// read the ops; a caller that DOES send a `selections` map still has
// it validated.
//
// This suite asserts the behavioural contract directly against the
// real schemas (not a source regex), and — crucially — asserts the
// exact payload shape the CLIENT sends.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  OtherAddOnUpdateSchema,
  StaffOtherAddOnUpdateSchema
} from "../../../shared/schemas/booking";

/** The payload the guest `ManageOtherAddOnsPage` actually sends. */
const guestPayload = {
  bookingRef: "SI-20261021-00001",
  lookupToken: "a".repeat(32),
  clientBatchId: "batch-20261021-0001",
  add: [
    {
      selectionKey: "2026-11-05-extra-pillow",
      addOnId: "extra-pillow",
      quantity: 1,
      priceSnapshot: 150,
      nameSnapshot: "Extra Pillow",
      unitSnapshot: "per-stay",
      cutoffHoursBeforeCheckInSnapshot: 24
    }
  ],
  change: [
    {
      selectionKey: "2026-11-05-late-checkout",
      addOnId: "late-checkout",
      quantity: 2,
      priceSnapshot: 300,
      nameSnapshot: "Late Checkout",
      unitSnapshot: "per-person",
      cutoffHoursBeforeCheckInSnapshot: 24
    }
  ],
  remove: [{ selectionKey: "2026-11-06-luggage-storage", addOnId: "luggage-storage" }],
  turnstileToken: undefined
};

/** The payload the staff drawer actually sends. */
const staffPayload = {
  bookingId: "aBcDeFgHiJkLmNoP",
  add: [
    {
      selectionKey: "2026-11-05-extra-pillow",
      addOnId: "extra-pillow",
      quantity: 1,
      priceSnapshot: 150,
      nameSnapshot: "Extra Pillow",
      unitSnapshot: "per-stay",
      cutoffHoursBeforeCheckInSnapshot: 24
    }
  ],
  change: [],
  remove: [],
  turnstileToken: undefined
};

describe("RPT-04 — the other-add-ons update schemas accept the op payload", () => {
  it("accepts the guest payload the client actually sends", () => {
    const parsed = OtherAddOnUpdateSchema.safeParse(guestPayload);
    expect(
      parsed.success,
      `guest payload rejected: ${parsed.success ? "" : parsed.error.issues.map((i) => i.message).join(", ")}`
    ).toBe(true);
  });

  it("accepts the staff payload the drawer actually sends", () => {
    const parsed = StaffOtherAddOnUpdateSchema.safeParse(staffPayload);
    expect(
      parsed.success,
      `staff payload rejected: ${parsed.success ? "" : parsed.error.issues.map((i) => i.message).join(", ")}`
    ).toBe(true);
  });

  it("keeps the ops on the parsed result (the handlers read the raw body, but the parse must not strip them)", () => {
    const parsed = OtherAddOnUpdateSchema.safeParse(guestPayload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const data = parsed.data as Record<string, unknown>;
    expect(Array.isArray(data.add)).toBe(true);
    expect(Array.isArray(data.change)).toBe(true);
    expect(Array.isArray(data.remove)).toBe(true);
  });

  it("still validates a `selections` map when one IS sent", () => {
    const parsed = OtherAddOnUpdateSchema.safeParse({
      ...guestPayload,
      selections: {
        "2026-11-05": [
          {
            addOnId: "extra-pillow",
            nameSnapshot: "Extra Pillow",
            priceSnapshot: 150,
            quantity: 1,
            unitSnapshot: "per-stay",
            addedAt: "2026-10-21T06:00:00.000Z",
            addedBy: "guest",
            lastModifiedAt: "2026-10-21T06:00:00.000Z",
            lastModifiedBy: "guest",
            cutoffHoursBeforeCheckInSnapshot: 24
          }
        ]
      }
    });
    expect(parsed.success).toBe(true);
  });

  it("still REJECTS a malformed `selections` map", () => {
    const parsed = OtherAddOnUpdateSchema.safeParse({
      ...guestPayload,
      selections: {
        "not-a-date": [
          {
            addOnId: "extra-pillow",
            nameSnapshot: "Extra Pillow",
            priceSnapshot: 150,
            quantity: 1,
            unitSnapshot: "per-stay",
            addedAt: "2026-10-21T06:00:00.000Z",
            addedBy: "guest",
            lastModifiedAt: "2026-10-21T06:00:00.000Z",
            lastModifiedBy: "guest",
            cutoffHoursBeforeCheckInSnapshot: 24
          }
        ]
      }
    });
    expect(parsed.success).toBe(false);
  });

  it("still rejects a payload with no credential at all", () => {
    const parsed = OtherAddOnUpdateSchema.safeParse({ add: [], change: [], remove: [] });
    expect(parsed.success).toBe(false);
  });

  it("the guest schema still requires `bookingRef` + `lookupToken` + `clientBatchId`", () => {
    const parsed = OtherAddOnUpdateSchema.safeParse({ add: [], change: [], remove: [] });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    const paths = parsed.error.issues.map((i) => i.path.join("."));
    expect(paths).toContain("bookingRef");
    expect(paths).toContain("lookupToken");
    expect(paths).toContain("clientBatchId");
  });
});

describe("RPT-04 — the handlers read the ops, not `selections` (tripwire)", () => {
  const guestHandlerSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/addons-manage-save.ts"),
    "utf8"
  );
  const staffHandlerSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/addons-staff-update.ts"),
    "utf8"
  );

  it("the guest handler reads the ops off the body", () => {
    expect(guestHandlerSrc).toMatch(/readOps\(req\.body/);
    expect(guestHandlerSrc).toMatch(/body\?\.add/);
    expect(guestHandlerSrc).toMatch(/body\?\.change/);
    expect(guestHandlerSrc).toMatch(/body\?\.remove/);
  });

  it("the staff handler reads the ops off the body", () => {
    expect(staffHandlerSrc).toMatch(/readOps\(req\.body/);
  });

  it("neither handler depends on `parsed.data.selections`", () => {
    // If a future edit starts reading `selections`, the two
    // contracts diverge again and the schema has to stay required.
    expect(guestHandlerSrc).not.toMatch(/parsed\.data\.selections/);
    expect(staffHandlerSrc).not.toMatch(/parsed\.data\.selections/);
  });
});
