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
});
