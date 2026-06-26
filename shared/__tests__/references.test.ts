import { describe, expect, test } from "vitest";
import { generateBookingRef, generateMemberNumber, generateStoreOrderRef, nextSequence, isValidBookingRef, BOOKING_REF_REGEX, generateLookupToken, isValidLookupToken } from "../utils/references";

describe("reference utilities", () => {
  const testDate = new Date("2026-06-08T12:00:00Z");

  test("generates booking reference correctly", () => {
    // Per H3 (hardening batch 2026-06-26): the sequence
    // width is now 5 digits (was 3). Expected format:
    // Prefix-YYYYMMDD-NNNNN.
    const ref = generateBookingRef("SI", testDate, 5);
    expect(ref).toMatch(/^SI-\d{8}-00005$/);
  });

  test("generates member number correctly", () => {
    // Expected format: Prefix-NNNNN
    const ref = generateMemberNumber("SR", 42);
    expect(ref).toBe("SR-00042");
  });

  test("generates store order reference correctly", () => {
    // Per H3 (hardening batch 2026-06-26): sequence
    // width is now 5 digits (was 3). Expected format:
    // SO-YYYYMMDD-NNNNN.
    const ref = generateStoreOrderRef(testDate, 12);
    expect(ref).toMatch(/^SO-\d{8}-00012$/);
  });

  test("calculates next sequence number", () => {
    expect(nextSequence(null)).toBe(1);
    expect(nextSequence(undefined)).toBe(1);
    expect(nextSequence(15)).toBe(16);
  });

  // Per BF-21 (booking-flow audit 2026-06-26): the
  // booking-ref regex + helper gate the public
  // self-service endpoints from malformed input.
  describe("BOOKING_REF_REGEX / isValidBookingRef (BF-21)", () => {
    test("accepts the canonical shape", () => {
      expect(isValidBookingRef("SI-20260615-001")).toBe(true);
      expect(isValidBookingRef("INQ-20260615-12345")).toBe(true);
      expect(BOOKING_REF_REGEX.test("SI-20260615-001")).toBe(true);
    });

    test("trims whitespace before checking", () => {
      expect(isValidBookingRef("  SI-20260615-001  ")).toBe(true);
    });

    test("rejects malformed shapes", () => {
      expect(isValidBookingRef("garbage")).toBe(false);
      expect(isValidBookingRef("SI-26-15-001")).toBe(false);
      expect(isValidBookingRef("SI-20260615-XXX")).toBe(false);
      expect(isValidBookingRef("SI-20260615-")).toBe(false);
      expect(isValidBookingRef("SI-20260615-1")).toBe(false);
    });

    test("rejects non-strings", () => {
      expect(isValidBookingRef(null)).toBe(false);
      expect(isValidBookingRef(undefined)).toBe(false);
      expect(isValidBookingRef(123)).toBe(false);
      expect(isValidBookingRef({})).toBe(false);
    });
  });

  // Per H2 (hardening batch 2026-06-26): the lookup
  // token replaces the raw `guestEmail` URL param. It
  // must be exactly 32 lowercase hex characters.
  describe("generateLookupToken / isValidLookupToken (H2)", () => {
    test("generates a 32-char lowercase hex string", () => {
      // Deterministic generator so the test is
      // reproducible — the production runtime falls
      // through to node:crypto.randomBytes.
      const deterministic: number[] = [];
      for (let i = 0; i < 16; i++) deterministic.push(i);
      const token = generateLookupToken((n) => new Uint8Array(deterministic.slice(0, n)));
      expect(token).toBe("000102030405060708090a0b0c0d0e0f");
      expect(token).toMatch(/^[a-f0-9]{32}$/);
    });

    test("uses node:crypto when no generator is provided", () => {
      const token = generateLookupToken();
      expect(token).toMatch(/^[a-f0-9]{32}$/);
    });

    test("validates the canonical shape", () => {
      expect(isValidLookupToken("000102030405060708090a0b0c0d0e0f")).toBe(true);
      expect(isValidLookupToken("a".repeat(32))).toBe(true);
    });

    test("rejects malformed tokens", () => {
      expect(isValidLookupToken("")).toBe(false);
      expect(isValidLookupToken("a".repeat(31))).toBe(false);
      expect(isValidLookupToken("a".repeat(33))).toBe(false);
      expect(isValidLookupToken("g".repeat(32))).toBe(false);
      expect(isValidLookupToken("not a token")).toBe(false);
    });
  });
});
