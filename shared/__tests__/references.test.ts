import { describe, expect, test } from "vitest";
import { generateBookingRef, generateMemberNumber, generateStoreOrderRef, nextSequence, isValidBookingRef, BOOKING_REF_REGEX, generateLookupToken, isValidLookupToken, RESERVATION_REF_REGEX, isValidReservationRef, RESERVATION_ID_REGEX, isValidReservationId, generateReservationId } from "../utils/references";

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

describe("MRB-01 reservation ref + id utilities", () => {
  test("RESERVATION_REF_REGEX accepts the canonical shape (R-YYYYMMDD-NNNNN) and rejects everything else", () => {
    // Per MRB-01 (2026-08-02, per decision #159): the public
    // reservation ref uses the R- prefix (distinct from SI- for
    // bookings) so the public surface reads naturally and a
    // guess of one ref space gives no information about the
    // other. The 5-digit sequence width matches the H3
    // hardening batch's booking-ref widening.
    expect(RESERVATION_REF_REGEX.test("R-20260802-00001")).toBe(true);
    expect(RESERVATION_REF_REGEX.test("R-20260802-99999")).toBe(true);
    expect(RESERVATION_REF_REGEX.test("R-20260802-123")).toBe(true);  // 3-digit sequence is also accepted
    expect(RESERVATION_REF_REGEX.test("SI-20260802-00001")).toBe(false);  // wrong prefix
    expect(RESERVATION_REF_REGEX.test("R-20260802-100000")).toBe(false);  // 6-digit too wide
    expect(RESERVATION_REF_REGEX.test("R-2026-08-02-00001")).toBe(false);  // wrong date shape
    expect(RESERVATION_REF_REGEX.test("")).toBe(false);
  });

  test("isValidReservationRef is a thin wrapper around the regex (trim + accept)", () => {
    expect(isValidReservationRef("R-20260802-00001")).toBe(true);
    expect(isValidReservationRef("  R-20260802-00001  ")).toBe(true);
    expect(isValidReservationRef("not a ref")).toBe(false);
    expect(isValidReservationRef(null)).toBe(false);
  });

  test("RESERVATION_ID_REGEX accepts RFC4122 UUIDs (v1-v5 with the standard variant) and rejects the malformed forms", () => {
    // Per MRB-01: client preallocates a UUID as the
    // reservationId. The regex accepts any RFC4122 UUID with
    // a version digit in [1-5] and a variant digit in [8/9/a/b]
    // (the standard UUID shape). The all-zeros form is rejected
    // because it is the "nil" UUID and is not a valid identifier.
    // Server-side validation short-circuits malformed IDs
    // before hitting Firestore.
    expect(RESERVATION_ID_REGEX.test("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")).toBe(true);  // UUIDv4
    expect(RESERVATION_ID_REGEX.test("9b1deb4d-3b7d-1bad-9bdd-2b0d7b3dcb6d")).toBe(true);  // UUIDv1 (also accepted — the regex is RFC4122, not v4-only)
    expect(RESERVATION_ID_REGEX.test("00000000-0000-0000-0000-000000000000")).toBe(false);  // nil UUID
    expect(RESERVATION_ID_REGEX.test("9b1deb4d-3b7d-4bad-cbdd-2b0d7b3dcb6d")).toBe(false);  // wrong variant digit
    expect(RESERVATION_ID_REGEX.test("not a uuid")).toBe(false);
    expect(RESERVATION_ID_REGEX.test("")).toBe(false);
  });

  test("isValidReservationId is a thin wrapper around the regex (trim + accept)", () => {
    expect(isValidReservationId("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d")).toBe(true);
    expect(isValidReservationId("  9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d  ")).toBe(true);
    expect(isValidReservationId("not a uuid")).toBe(false);
    expect(isValidReservationId(null)).toBe(false);
  });

  test("generateReservationId returns a UUIDv4 that matches the regex (deterministic generator pin)", () => {
    // The injected `randomUUID` lets the test pin the output
    // without relying on the runtime's entropy source. The real
    // implementation (in `references.ts`) defaults to
    // `globalThis.crypto.randomUUID` with a `node:crypto`
    // fallback; the test uses a fixed string to assert the
    // shape contract.
    const id = generateReservationId(() => "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
    expect(id).toBe("9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d");
    expect(isValidReservationId(id)).toBe(true);
  });

  test("generateReservationId throws if the injected generator returns a non-conforming value", () => {
    // A missing or broken generator must surface immediately,
    // not silently produce an ID that the server rejects.
    expect(() => generateReservationId(() => "not a uuid")).toThrow(/did not match the expected UUIDv4 shape/);
  });
});
