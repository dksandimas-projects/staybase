import { describe, expect, it } from "vitest";
import {
  computeRequestFingerprint,
  type FingerprintableReservationRequest,
  type FingerprintHasher
} from "../utils/reservationFingerprint";

const SAMPLE_REQUEST: FingerprintableReservationRequest = {
  reservationId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  roomLines: [
    { type: "Standard", quantity: 1, adults: 2, children: 0, extraBeds: 0 },
    { type: "Deluxe", quantity: 1, adults: 2, children: 1, extraBeds: 1 }
  ],
  checkIn: "2026-08-02",
  checkOut: "2026-08-05",
  leadGuestName: "  Ana Reyes  ",
  leadGuestEmail: "  ANA@example.com  ",
  leadGuestPhone: "  +63 917 555 1234  ",
  source: "  online  ",
  isCorporate: false,
  corporateCode: "  acme2026  ",
  companyName: "  Acme Corp  ",
  voucherCode: "  summer10  ",
  memberDiscountPct: 5,
  discountScope: {
    senior: { room: true, breakfast: true, extraBed: true },
    voucher: { room: true, breakfast: true, extraBed: true },
    member: { room: true, breakfast: true, extraBed: true }
  },
  termsVersion: "v1.2",
  privacyVersion: "v1.0"
};

// Deterministic hasher for unit tests. The real implementation
// uses SHA-256 via `node:crypto`; here we hash to a stable hex
// string of the input's length so byte-equivalence is trivially
// testable without spinning up Node's crypto at test time.
function deterministicHasher(): FingerprintHasher {
  return (input: string) => {
    let h = 5381;
    for (let i = 0; i < input.length; i += 1) {
      h = ((h << 5) + h) + input.charCodeAt(i);
      h = h & 0xffffffff;
    }
    return `test-${(h >>> 0).toString(16).padStart(8, "0")}-${input.length}`;
  };
}

describe("MRB-01 reservation request fingerprint", () => {
  it("is deterministic: the same request produces the same fingerprint", () => {
    const a = computeRequestFingerprint(SAMPLE_REQUEST, deterministicHasher());
    const b = computeRequestFingerprint(SAMPLE_REQUEST, deterministicHasher());
    expect(a).toBe(b);
  });

  it("normalizes whitespace + casing on the wire-equivalent fields", () => {
    // The wire form may have padded spaces + mixed casing
    // (the client builds the request from form fields). The
    // canonical form must strip whitespace + lowercase the
    // email + uppercase the corporate / voucher codes so
    // byte-equivalent requests produce the same fingerprint.
    const a = computeRequestFingerprint({
      ...SAMPLE_REQUEST,
      leadGuestName: "Ana Reyes",
      leadGuestEmail: "ana@example.com",
      leadGuestPhone: "+63 917 555 1234",
      source: "online",
      corporateCode: "ACME2026",
      companyName: "Acme Corp",
      voucherCode: "SUMMER10"
    }, deterministicHasher());
    const b = computeRequestFingerprint(SAMPLE_REQUEST, deterministicHasher());
    expect(a).toBe(b);
  });

  it("is order-independent on the room lines", () => {
    // The client may send the lines in any order. The canonical
    // sort by `(type, quantity)` makes the fingerprint
    // independent of the input order.
    const reordered = computeRequestFingerprint({
      ...SAMPLE_REQUEST,
      roomLines: [
        { type: "Deluxe", quantity: 1, adults: 2, children: 1, extraBeds: 1 },
        { type: "Standard", quantity: 1, adults: 2, children: 0, extraBeds: 0 }
      ]
    }, deterministicHasher());
    const original = computeRequestFingerprint(SAMPLE_REQUEST, deterministicHasher());
    expect(reordered).toBe(original);
  });

  it("rejects a different room count as a different fingerprint (the contract)", () => {
    // A same-`reservationId` + different-fingerprint replay
    // is a 409 at the server. The helper itself does not throw
    // — the comparison is the server's responsibility — but the
    // output must differ for byte-different inputs.
    const changed = computeRequestFingerprint({
      ...SAMPLE_REQUEST,
      roomLines: [
        { type: "Standard", quantity: 2, adults: 4, children: 0, extraBeds: 0 }
      ]
    }, deterministicHasher());
    const original = computeRequestFingerprint(SAMPLE_REQUEST, deterministicHasher());
    expect(changed).not.toBe(original);
  });

  it("rejects a different date range as a different fingerprint", () => {
    const changed = computeRequestFingerprint({
      ...SAMPLE_REQUEST,
      checkIn: "2026-08-03",
      checkOut: "2026-08-06"
    }, deterministicHasher());
    const original = computeRequestFingerprint(SAMPLE_REQUEST, deterministicHasher());
    expect(changed).not.toBe(original);
  });

  it("rejects a different lead-guest email as a different fingerprint (case + trim normalized)", () => {
    // After normalization, the lowercased + trimmed form is
    // the canonical input. A different email (even with extra
    // whitespace) must produce a different fingerprint.
    const changed = computeRequestFingerprint({
      ...SAMPLE_REQUEST,
      leadGuestEmail: "  bob@example.com  "
    }, deterministicHasher());
    const original = computeRequestFingerprint(SAMPLE_REQUEST, deterministicHasher());
    expect(changed).not.toBe(original);
  });

  it("clamps negative + non-finite numerics to 0 (defensive coercion)", () => {
    // `numGuests` and the discount pcts may come in as
    // `undefined` / negative / NaN from a partially-built form.
    // The fingerprint must treat them the same as 0 so a
    // later value-set vs value-unset comparison does not flip
    // the hash.
    const a = computeRequestFingerprint({
      ...SAMPLE_REQUEST,
      memberDiscountPct: -5
    }, deterministicHasher());
    const b = computeRequestFingerprint({
      ...SAMPLE_REQUEST,
      memberDiscountPct: 0
    }, deterministicHasher());
    expect(a).toBe(b);
  });

  it("treats a missing discountScope as the all-false default", () => {
    const a = computeRequestFingerprint({
      ...SAMPLE_REQUEST,
      discountScope: undefined
    } as unknown as FingerprintableReservationRequest, deterministicHasher());
    const b = computeRequestFingerprint({
      ...SAMPLE_REQUEST,
      discountScope: {
        senior: { room: false, breakfast: false, extraBed: false },
        voucher: { room: false, breakfast: false, extraBed: false },
        member: { room: false, breakfast: false, extraBed: false }
      }
    }, deterministicHasher());
    expect(a).toBe(b);
  });

  it("rejects a different discountScope as a different fingerprint", () => {
    const changed = computeRequestFingerprint({
      ...SAMPLE_REQUEST,
      discountScope: {
        senior: { room: true, breakfast: true, extraBed: false },
        voucher: { room: true, breakfast: true, extraBed: true },
        member: { room: true, breakfast: true, extraBed: true }
      }
    }, deterministicHasher());
    const original = computeRequestFingerprint(SAMPLE_REQUEST, deterministicHasher());
    expect(changed).not.toBe(original);
  });
});
