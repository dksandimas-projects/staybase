import { describe, expect, test } from "vitest";
import { validateCorporateCode, CorporateCodeLike } from "../utils/corporate-codes";

const activeCode: CorporateCodeLike = {
  isActive: true,
  expiresAt: new Date("2027-06-01T00:00:00Z"),
  usageCap: null,
  usageCount: 0,
};

describe("validateCorporateCode", () => {
  test("validates an active corporate code", () => {
    const res = validateCorporateCode(activeCode, new Date("2026-06-10T12:00:00Z"));
    expect(res.valid).toBe(true);
  });

  test("rejects an inactive corporate code", () => {
    const res = validateCorporateCode(
      { ...activeCode, isActive: false },
      new Date("2026-06-10T12:00:00Z")
    );
    expect(res.valid).toBe(false);
    expect(res.error).toContain("inactive");
  });

  test("rejects an expired corporate code", () => {
    const res = validateCorporateCode(
      { ...activeCode, expiresAt: new Date("2026-01-01T00:00:00Z") },
      new Date("2026-06-10T12:00:00Z")
    );
    expect(res.valid).toBe(false);
    expect(res.error).toContain("expired");
  });

  test("rejects a corporate code at usage cap", () => {
    const res = validateCorporateCode(
      { ...activeCode, usageCap: 5, usageCount: 5 },
      new Date("2026-06-10T12:00:00Z")
    );
    expect(res.valid).toBe(false);
    expect(res.error).toContain("usage limit");
  });

  test("rejects a corporate code over usage cap", () => {
    const res = validateCorporateCode(
      { ...activeCode, usageCap: 5, usageCount: 7 },
      new Date("2026-06-10T12:00:00Z")
    );
    expect(res.valid).toBe(false);
    expect(res.error).toContain("usage limit");
  });

  test("allows code with no expiry (null expiresAt)", () => {
    const res = validateCorporateCode(
      { ...activeCode, expiresAt: null },
      new Date("2026-06-10T12:00:00Z")
    );
    expect(res.valid).toBe(true);
  });

  test("allows code with no usage cap (null usageCap)", () => {
    const res = validateCorporateCode(activeCode, new Date("2026-06-10T12:00:00Z"));
    expect(res.valid).toBe(true);
  });

  test("allows code under usage cap", () => {
    const res = validateCorporateCode(
      { ...activeCode, usageCap: 10, usageCount: 3 },
      new Date("2026-06-10T12:00:00Z")
    );
    expect(res.valid).toBe(true);
  });

  test("expired check used supplied now date", () => {
    const res = validateCorporateCode(
      { ...activeCode, expiresAt: new Date("2026-06-15T00:00:00Z") },
      new Date("2026-06-20T12:00:00Z")
    );
    expect(res.valid).toBe(false);
    expect(res.error).toContain("expired");
  });

  // Per MRB-08 (2026-08-02, per decision #167): the cap
  // check must compare `usageCount + requestedUses` against
  // `usageCap`. The historical single-room contract is
  // preserved by defaulting `requestedUses` to 1.
  describe("validateCorporateCode — multi-room requested uses (MRB-08, decision #167)", () => {
    test("accepts a multi-room reservation that fits under the remaining cap", () => {
      // 4 of 10 used, requesting 3 → 4 + 3 = 7 ≤ 10, valid.
      const res = validateCorporateCode(
        { ...activeCode, usageCap: 10, usageCount: 4 },
        new Date("2026-06-10T12:00:00Z"),
        { requestedUses: 3 }
      );
      expect(res.valid).toBe(true);
    });

    test("rejects a multi-room reservation that would exceed the cap", () => {
      // 4 of 10 used, requesting 7 → 4 + 7 = 11 > 10, invalid.
      const res = validateCorporateCode(
        { ...activeCode, usageCap: 10, usageCount: 4 },
        new Date("2026-06-10T12:00:00Z"),
        { requestedUses: 7 }
      );
      expect(res.valid).toBe(false);
      expect(res.error).toContain("usage limit");
      // The user-facing copy names the requested N so the
      // desk can tell whether to split the block or ask for
      // a fresh code.
      expect(res.error).toContain("7-room");
    });

    test("accepts a multi-room reservation that exactly fills the remaining cap", () => {
      // 4 of 10 used, requesting 6 → 4 + 6 = 10 ≤ 10, valid
      // (≤, not < — the cap is the inclusive upper bound).
      const res = validateCorporateCode(
        { ...activeCode, usageCap: 10, usageCount: 4 },
        new Date("2026-06-10T12:00:00Z"),
        { requestedUses: 6 }
      );
      expect(res.valid).toBe(true);
    });

    test("treats a zero or negative requestedUses as one (the legacy default)", () => {
      // A defensive default: the cap check must not be
      // bypassable by passing 0. Zero is normalised to 1.
      const cap = validateCorporateCode(
        { ...activeCode, usageCap: 5, usageCount: 5 },
        new Date("2026-06-10T12:00:00Z"),
        { requestedUses: 0 }
      );
      expect(cap.valid).toBe(false);
      const neg = validateCorporateCode(
        { ...activeCode, usageCap: 5, usageCount: 5 },
        new Date("2026-06-10T12:00:00Z"),
        { requestedUses: -3 }
      );
      expect(neg.valid).toBe(false);
    });

    test("accepts the new (code, options) signature for call sites that have no `now`", () => {
      // The dispatch in the helper accepts the legacy
      // `(code, now, options)` form AND the new
      // `(code, options)` form. The latter is the shape the
      // create transaction will use once it has the
      // `requestedUses` count and no other clock input.
      const res = validateCorporateCode(
        { ...activeCode, usageCap: 10, usageCount: 2 },
        { requestedUses: 5 }
      );
      expect(res.valid).toBe(true);
    });

    test("null cap with any requestedUses still validates", () => {
      // `null` usageCap means unlimited; the multi-room
      // path must not falsely reject.
      const res = validateCorporateCode(
        { ...activeCode, usageCap: null, usageCount: 999 },
        new Date("2026-06-10T12:00:00Z"),
        { requestedUses: 50 }
      );
      expect(res.valid).toBe(true);
    });
  });
});
