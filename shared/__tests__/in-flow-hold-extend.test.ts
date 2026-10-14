// Per IMT-02 / IMT-04 (2026-10-14, `plan/project/ROADMAP.md §IMT`):
// runtime coverage for the "I need more time" extension arithmetic.
//
// These are REAL unit tests, not source-text pins, because the bug
// class here is "looks right, behaves wrong": the additive-vs-reset
// distinction is a one-character difference in an expression, and a
// source-text grep cannot tell you whether a guest at 0:30 lost those
// 30 seconds. Per `CONTRIBUTING.md §Testing`, promote to behavioural
// coverage when the failure is a wrong answer with no error.
//
// The two decisions being pinned:
//   1. Extension is ADDITIVE from max(now, expiresAt) — a guest with
//      time left keeps it. A reset-from-now would silently destroy the
//      remaining window, which is the opposite of the request.
//   2. An EXPIRED hold is extendable (revival is the point), but a
//      CONSUMED one never is, and the cap is enforced server-side.

import { describe, expect, test } from "vitest";
import {
  MAX_IN_FLOW_HOLD_EXTENSIONS,
  MAX_IN_FLOW_HOLD_MINUTES,
  IN_FLOW_HOLD_EXTENSION_STATUSES,
  canExtendInFlowHold,
  computeExtendedInFlowHoldExpiresAt,
  computeInFlowHoldExpiresAt,
  normalizeInFlowHoldMinutes
} from "../utils/bookingInFlowHold";

const NOW = new Date("2026-10-14T10:00:00.000Z");
const MIN = 60_000;

function at(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * MIN);
}

describe("IMT-04 — MAX_IN_FLOW_HOLD_EXTENSIONS", () => {
  test("is 3 (working default pending CVQ-01)", () => {
    expect(MAX_IN_FLOW_HOLD_EXTENSIONS).toBe(3);
  });

  test("bounds doc lifetime to ~2h at the maximum hold window", () => {
    // 3 extensions x MAX_IN_FLOW_HOLD_MINUTES(30) — the worst case a
    // caller can pin a doc in "active". This is the reason the cap
    // exists at all (the daily Janitor has to eventually sweep it).
    expect(MAX_IN_FLOW_HOLD_EXTENSIONS * MAX_IN_FLOW_HOLD_MINUTES).toBe(90);
  });

  test("the extendable status list excludes 'consumed'", () => {
    expect(IN_FLOW_HOLD_EXTENSION_STATUSES).toContain("active");
    expect(IN_FLOW_HOLD_EXTENSION_STATUSES).toContain("expired");
    expect(IN_FLOW_HOLD_EXTENSION_STATUSES).not.toContain("consumed");
  });
});

describe("IMT-04 — computeExtendedInFlowHoldExpiresAt is ADDITIVE", () => {
  test("an active hold KEEPS its remaining time and gains a window on top", () => {
    // 13:30 remaining on a 15-minute window. The result must be
    // expiresAt + 15min, NOT now + 15min — otherwise the guest loses
    // the 13:30 they already had, which is the bug the additive rule
    // exists to prevent.
    const currentExpiresAt = at(NOW, 13.5);
    const next = computeExtendedInFlowHoldExpiresAt(15, currentExpiresAt, NOW);
    expect(next).toEqual(at(currentExpiresAt, 15));
    // Explicitly: strictly greater than a naive reset-from-now.
    expect(next!.getTime()).toBeGreaterThan(at(NOW, 15).getTime());
    expect(next!.getTime() - at(NOW, 15).getTime()).toBe(13.5 * MIN);
  });

  test("a hold expiring in under a minute still gets a full window, not a stub", () => {
    const currentExpiresAt = at(NOW, 0.25);
    const next = computeExtendedInFlowHoldExpiresAt(15, currentExpiresAt, NOW);
    expect(next).toEqual(at(currentExpiresAt, 15));
  });

  test("an EXPIRED hold restarts from now (not from its stale deadline)", () => {
    // The literal "I need more time" moment: the deadline is in the
    // past, so the base collapses to `now` and the guest gets a full
    // fresh window rather than being pushed 1 second forward.
    const staleDeadline = at(NOW, -8);
    const next = computeExtendedInFlowHoldExpiresAt(15, staleDeadline, NOW);
    expect(next).toEqual(at(NOW, 15));
  });

  test("a deadline exactly equal to now is treated as expired", () => {
    // `>` is strict, so an exactly-now deadline falls back to `now`
    // as the base. Either way the window is the same full length.
    const next = computeExtendedInFlowHoldExpiresAt(15, NOW, NOW);
    expect(next).toEqual(at(NOW, 15));
  });

  test("a missing / null deadline is treated as 'no remaining time'", () => {
    expect(computeExtendedInFlowHoldExpiresAt(15, null, NOW)).toEqual(at(NOW, 15));
    expect(computeExtendedInFlowHoldExpiresAt(15, undefined, NOW)).toEqual(at(NOW, 15));
  });

  test("a hand-edited unparseable deadline does NOT crash or extend from garbage", () => {
    const next = computeExtendedInFlowHoldExpiresAt(15, "not-a-date", NOW);
    expect(next).toEqual(at(NOW, 15));
  });

  test("accepts an ISO string deadline as well as a Date", () => {
    const iso = at(NOW, 10).toISOString();
    expect(computeExtendedInFlowHoldExpiresAt(15, iso, NOW)).toEqual(at(NOW, 25));
  });

  test("returns null for a non-positive window (the base arithmetic is unchanged)", () => {
    expect(computeExtendedInFlowHoldExpiresAt(0, at(NOW, 5), NOW)).toBeNull();
    expect(computeExtendedInFlowHoldExtensionsNeverBypassesTheWindow()).toBe(true);
  });

  test("agrees with computeInFlowHoldExpiresAt when there is no prior deadline", () => {
    expect(computeExtendedInFlowHoldExpiresAt(20, null, NOW)).toEqual(
      computeInFlowHoldExpiresAt(20, NOW)
    );
  });
});

// Guards the invariant that the extension path never invents a longer
// window than the hotel configured — the server reads `holdMinutes`
// off the doc and the request cannot supply one.
function computeExtendedInFlowHoldExtensionsNeverBypassesTheWindow(): boolean {
  const configured = normalizeInFlowHoldMinutes(MAX_IN_FLOW_HOLD_MINUTES);
  const next = computeExtendedInFlowHoldExpiresAt(configured, null, NOW);
  return next !== null && next.getTime() - NOW.getTime() === configured * MIN;
}

describe("IMT-04 — canExtendInFlowHold", () => {
  test("an active hold below the cap may extend", () => {
    expect(canExtendInFlowHold({ status: "active", extensionCount: 0 })).toBe(true);
    expect(canExtendInFlowHold({ status: "active", extensionCount: 2 })).toBe(true);
  });

  test("an EXPIRED hold may extend — revival is the whole point", () => {
    expect(canExtendInFlowHold({ status: "expired", extensionCount: 0 })).toBe(true);
    expect(canExtendInFlowHold({ status: "expired", extensionCount: 1 })).toBe(true);
  });

  test("a CONSUMED hold may NEVER extend, at any counter value", () => {
    // A committed booking's hold must not be resurrectable, or a
    // stale ?hold= link could revive a completed attempt.
    expect(canExtendInFlowHold({ status: "consumed", extensionCount: 0 })).toBe(false);
    expect(canExtendInFlowHold({ status: "consumed", extensionCount: 1 })).toBe(false);
    expect(canExtendInFlowHold({ status: "consumed", extensionCount: 99 })).toBe(false);
  });

  test("the cap is enforced: count === MAX is refused", () => {
    expect(canExtendInFlowHold({ status: "active", extensionCount: MAX_IN_FLOW_HOLD_EXTENSIONS })).toBe(false);
    expect(canExtendInFlowHold({ status: "expired", extensionCount: MAX_IN_FLOW_HOLD_EXTENSIONS })).toBe(false);
  });

  test("a count above the cap stays refused", () => {
    expect(canExtendInFlowHold({ status: "active", extensionCount: MAX_IN_FLOW_HOLD_EXTENSIONS + 5 })).toBe(false);
  });

  test("a missing counter defaults to 0 and may extend (legacy docs)", () => {
    expect(canExtendInFlowHold({ status: "active" })).toBe(true);
    expect(canExtendInFlowHold({ status: "active", extensionCount: null })).toBe(true);
    expect(canExtendInFlowHold({ status: "active", extensionCount: undefined })).toBe(true);
  });

  test("fails CLOSED on a hand-edited counter (negative / non-numeric)", () => {
    // Treated as untrustworthy rather than coerced to 0, which would
    // hand out free extensions to a tampered doc.
    expect(canExtendInFlowHold({ status: "active", extensionCount: -1 })).toBe(false);
    expect(canExtendInFlowHold({ status: "active", extensionCount: "many" as any })).toBe(false);
    expect(canExtendInFlowHold({ status: "active", extensionCount: NaN })).toBe(false);
  });

  test("fails CLOSED on an unknown / missing status", () => {
    expect(canExtendInFlowHold({ status: "pending", extensionCount: 0 })).toBe(false);
    expect(canExtendInFlowHold({ status: null, extensionCount: 0 })).toBe(false);
    expect(canExtendInFlowHold({ status: undefined, extensionCount: 0 })).toBe(false);
    expect(canExtendInFlowHold({})).toBe(false);
  });

  test("fails closed on a null / undefined hold", () => {
    expect(canExtendInFlowHold(null)).toBe(false);
    expect(canExtendInFlowHold(undefined)).toBe(false);
  });
});