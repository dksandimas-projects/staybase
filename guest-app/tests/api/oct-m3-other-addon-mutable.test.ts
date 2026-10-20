// Per OCT-M3 (2026-10-20, decision #291): one shared rule decides
// whether an other-add-on booking is mutable.
//
// The bug: the guest save path, the staff add/remove path and the
// mark-served path each decided "is this booking editable?"
// independently — and the GUEST path had no check at all. A guest
// could add an airport transfer to a `checked-out` or `cancelled`
// booking, and the staff path wrote a pending refund liability
// against a closed booking.
//
// The fix: `shared/utils/addOns.ts` owns `isOtherAddOnBookingMutable`
// + the canonical message, and all three handlers call it.
//
// This file pins the BEHAVIOUR (runtime assertions against the real
// shared helper) and the WIRING (source-text guards).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isOtherAddOnBookingMutable,
  OTHER_ADD_ON_READ_ONLY_ERROR
} from "@spark-inn/shared";

const repoRoot = resolve(__dirname, "../../..");

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), "utf8");
}

const staffUpdateSrc = read("guest-app/server/handlers/addons-staff-update.ts");
const markServedSrc = read("guest-app/server/handlers/addons-mark-served.ts");
const manageSaveSrc = read("guest-app/server/handlers/addons-manage-save.ts");

describe("OCT-M3 — the mutability rule (runtime behaviour)", () => {
  it("a pending booking is mutable", () => {
    expect(isOtherAddOnBookingMutable("pending")).toBe(true);
  });

  it("a confirmed booking is mutable", () => {
    expect(isOtherAddOnBookingMutable("confirmed")).toBe(true);
  });

  it("a checked-in booking is STILL mutable (a guest can buy a transfer on arrival)", () => {
    expect(isOtherAddOnBookingMutable("checked-in")).toBe(true);
  });

  it("a checked-out booking is NOT mutable", () => {
    expect(isOtherAddOnBookingMutable("checked-out")).toBe(false);
  });

  it("a cancelled booking is NOT mutable", () => {
    expect(isOtherAddOnBookingMutable("cancelled")).toBe(false);
  });

  it("the case + whitespace of the status does not matter", () => {
    expect(isOtherAddOnBookingMutable("CANCELLED")).toBe(false);
    expect(isOtherAddOnBookingMutable("  cancelled  ")).toBe(false);
    expect(isOtherAddOnBookingMutable("CHECKED-OUT")).toBe(false);
  });

  it("the canonical message is stable", () => {
    expect(OTHER_ADD_ON_READ_ONLY_ERROR).toBe("Booking is read-only.");
  });
});

describe("OCT-M3 — all three endpoints use the shared rule (wiring)", () => {
  it("the staff add/remove path uses the shared helper", () => {
    expect(staffUpdateSrc).toMatch(/isOtherAddOnBookingMutable/);
    expect(staffUpdateSrc).toMatch(/OTHER_ADD_ON_READ_ONLY_ERROR/);
  });

  it("the mark-served path uses the shared helper", () => {
    expect(markServedSrc).toMatch(/isOtherAddOnBookingMutable/);
    expect(markServedSrc).toMatch(/OTHER_ADD_ON_READ_ONLY_ERROR/);
    // The mark-served path reports the refusal with the shared
    // opCode so the client can render one message.
    expect(markServedSrc).toMatch(/BOOKING_READ_ONLY/);
  });

  it("the guest save path uses the shared helper", () => {
    expect(manageSaveSrc).toMatch(/isOtherAddOnBookingMutable/);
    expect(manageSaveSrc).toMatch(/OTHER_ADD_ON_READ_ONLY_ERROR/);
  });

  it("none of the three re-implements the rule inline", () => {
    // A local `status === "checked-out"` check would let the three
    // drift apart again — which is exactly how the bug happened.
    for (const src of [staffUpdateSrc, markServedSrc, manageSaveSrc]) {
      expect(src).not.toMatch(/status === ["']checked-out["']/);
      expect(src).not.toMatch(/status === ["']cancelled["']/);
    }
  });
});
