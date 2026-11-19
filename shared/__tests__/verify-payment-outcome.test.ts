import { describe, expect, it } from "vitest";
import { resolveVerifyPaymentOutcome } from "../utils/verifyPaymentOutcome";

// Per VPM-01 (2026-11-19, decision #322): the shared money-verdict
// resolver. Before it existed, the admin dashboard's pending-payments
// card compared the collected total against the scope's `totalPrice`
// while the booking drawer compared the same number against the
// folio grand total (`totalPrice` + BR-12 other add-ons + charges).
// The two surfaces therefore reported DIFFERENT verdicts for the
// same payment — and the server's own two rules (status flip vs.
// threshold gate) disagreed with each other too.
//
// These tests pin the two questions separately, because they have
// different answers and both matter:
//   1. `bookingTotalCovered` — the server's status rule. Drives the
//      success modal's headline.
//   2. `folioSettled` / `remainingBalance` — the money rule. Drives
//      the CTA, and it is what the server's four-eyes threshold
//      gate measures.

describe("resolveVerifyPaymentOutcome — the booking-total rule (the server's status flip)", () => {
  it("reports the booking total covered once the collected total reaches it", () => {
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: 4000,
      amount: 1000,
      bookingTotal: 5000,
      otherAddOnTotal: 0,
      chargesTotal: 0
    });
    expect(outcome.collectedAfter).toBe(5000);
    expect(outcome.bookingTotalCovered).toBe(true);
  });

  it("reports the booking total NOT covered when the collected total falls short", () => {
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: 1000,
      amount: 1000,
      bookingTotal: 5000,
      otherAddOnTotal: 0,
      chargesTotal: 0
    });
    expect(outcome.bookingTotalCovered).toBe(false);
  });

  it("mirrors the server's `totalPrice > 0` guard — a zero-total booking reads as NOT covered", () => {
    // The server computes `fullyPaid = totalPrice > 0 && totalCollected >= totalPrice`,
    // so a zero-total booking is never auto-flipped to `payment-confirmed`.
    // The client must not claim "Payment confirmed" for it either.
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: 0,
      amount: 100,
      bookingTotal: 0,
      otherAddOnTotal: 0,
      chargesTotal: 0
    });
    expect(outcome.bookingTotalCovered).toBe(false);
  });
});

describe("resolveVerifyPaymentOutcome — the folio rule (the money that is still owed)", () => {
  it("treats a booking with an unpaid other add-on as NOT settled even when the room is paid", () => {
    // THE case the two surfaces disagreed on: the room total is
    // covered, but the ₱2,000 airport transfer (a BR-12 other
    // add-on, added ON TOP of `totalPrice`) is not.
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: 0,
      amount: 5000,
      bookingTotal: 5000,
      otherAddOnTotal: 2000,
      chargesTotal: 0
    });
    // The server flipped the status (room covered)…
    expect(outcome.bookingTotalCovered).toBe(true);
    // …but money is still owed, so the folio is NOT settled.
    expect(outcome.folioSettled).toBe(false);
    expect(outcome.remainingBalance).toBe(2000);
  });

  it("is settled when the collected total covers the room AND the other add-ons", () => {
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: 0,
      amount: 7000,
      bookingTotal: 5000,
      otherAddOnTotal: 2000,
      chargesTotal: 0
    });
    expect(outcome.bookingTotalCovered).toBe(true);
    expect(outcome.folioSettled).toBe(true);
    expect(outcome.remainingBalance).toBe(0);
  });

  it("counts store + incidental charges in the folio total", () => {
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: 5000,
      amount: 0,
      bookingTotal: 5000,
      otherAddOnTotal: 0,
      chargesTotal: 750
    });
    expect(outcome.folioTotal).toBe(5750);
    expect(outcome.folioSettled).toBe(false);
    expect(outcome.remainingBalance).toBe(750);
  });

  it("treats a zero-total folio as settled (nothing is owed)", () => {
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: 0,
      amount: 0,
      bookingTotal: 0,
      otherAddOnTotal: 0,
      chargesTotal: 0
    });
    expect(outcome.folioSettled).toBe(true);
    expect(outcome.remainingBalance).toBe(0);
  });

  it("floors the remaining balance at 0 when the payment exceeds the folio", () => {
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: 5000,
      amount: 1000,
      bookingTotal: 5000,
      otherAddOnTotal: 0,
      chargesTotal: 0
    });
    expect(outcome.collectedAfter).toBe(6000);
    expect(outcome.folioSettled).toBe(true);
    expect(outcome.remainingBalance).toBe(0);
  });
});

describe("resolveVerifyPaymentOutcome — defensive coercion", () => {
  it("collapses NaN / Infinity / negative inputs to 0 rather than inflating a balance", () => {
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: Number.NaN,
      amount: Number.POSITIVE_INFINITY,
      bookingTotal: -500,
      otherAddOnTotal: Number.NaN,
      chargesTotal: -1
    });
    expect(outcome.collectedAfter).toBe(0);
    expect(outcome.folioTotal).toBe(0);
    expect(outcome.remainingBalance).toBe(0);
    expect(outcome.bookingTotalCovered).toBe(false);
  });

  it("accepts numeric strings (the admin surfaces read totals off Firestore docs)", () => {
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: "1000" as unknown as number,
      amount: "500" as unknown as number,
      bookingTotal: "5000" as unknown as number,
      otherAddOnTotal: "0" as unknown as number,
      chargesTotal: "0" as unknown as number
    });
    expect(outcome.collectedAfter).toBe(1500);
    expect(outcome.folioTotal).toBe(5000);
    expect(outcome.remainingBalance).toBe(3500);
  });

  it("never returns a negative folio total or balance", () => {
    const outcome = resolveVerifyPaymentOutcome({
      collectedBefore: 0,
      amount: 0,
      bookingTotal: 100,
      otherAddOnTotal: 0,
      chargesTotal: 0
    });
    expect(outcome.folioTotal).toBe(100);
    expect(outcome.remainingBalance).toBe(100);
    expect(outcome.remainingBalance).toBeGreaterThanOrEqual(0);
  });
});
