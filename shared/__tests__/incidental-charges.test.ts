import { describe, expect, it } from "vitest";
import type { IncidentalCharge } from "../types";

describe("IncidentalCharge type contract", () => {
  it("supports positive charges and append-only negative reversals", () => {
    const original: IncidentalCharge = {
      id: "charge-1",
      label: "Late checkout",
      amount: 500,
      category: "late-checkout",
      note: "Until 2 PM",
      addedBy: "staff-1",
      addedAt: new Date("2026-07-11T08:00:00Z"),
      voidOf: null
    };
    const reversal: IncidentalCharge = {
      ...original,
      id: "charge-2",
      label: "Reversal — Late checkout",
      amount: -500,
      voidOf: original.id
    };

    expect(original.amount + reversal.amount).toBe(0);
    expect(reversal.voidOf).toBe(original.id);
  });
});
