import { describe, expect, test } from "vitest";
import { generateBookingRef, generateMemberNumber, generateStoreOrderRef, nextSequence } from "../utils/references";

describe("reference utilities", () => {
  const testDate = new Date("2026-06-08T12:00:00Z");

  test("generates booking reference correctly", () => {
    // Expected format: Prefix-YYYYMMDD-NNN
    // Wait, compactDate uses local timezone (which can vary depending on local runner), so let's adjust expectations
    // to check format rather than exact string, or mock the date to verify components.
    const ref = generateBookingRef("SI", testDate, 5);
    expect(ref).toMatch(/^SI-\d{8}-005$/);
  });

  test("generates member number correctly", () => {
    // Expected format: Prefix-NNNNN
    const ref = generateMemberNumber("SR", 42);
    expect(ref).toBe("SR-00042");
  });

  test("generates store order reference correctly", () => {
    // Expected format: SO-YYYYMMDD-NNN
    const ref = generateStoreOrderRef(testDate, 12);
    expect(ref).toMatch(/^SO-\d{8}-012$/);
  });

  test("calculates next sequence number", () => {
    expect(nextSequence(null)).toBe(1);
    expect(nextSequence(undefined)).toBe(1);
    expect(nextSequence(15)).toBe(16);
  });
});
