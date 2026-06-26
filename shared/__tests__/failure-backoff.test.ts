import { describe, expect, test } from "vitest";
import { createFailureBackoffState } from "../utils/failureBackoff";

describe("createFailureBackoffState (S2)", () => {
  test("is empty for a fresh IP", () => {
    const state = createFailureBackoffState();
    expect(state.isInBackoff("1.1.1.1", 3)).toBe(false);
    expect(state.get("1.1.1.1")).toBeNull();
  });

  test("records failures and trips the threshold", () => {
    const state = createFailureBackoffState();
    expect(state.record("1.1.1.1", 60_000, 0)).toBe(1);
    expect(state.record("1.1.1.1", 60_000, 100)).toBe(2);
    expect(state.isInBackoff("1.1.1.1", 3, 100)).toBe(false);
    expect(state.record("1.1.1.1", 60_000, 200)).toBe(3);
    expect(state.isInBackoff("1.1.1.1", 3, 200)).toBe(true);
  });

  test("clear() drops the counter so the next lookup can try again", () => {
    const state = createFailureBackoffState();
    state.record("1.1.1.1", 60_000, 0);
    state.record("1.1.1.1", 60_000, 100);
    state.record("1.1.1.1", 60_000, 200);
    expect(state.isInBackoff("1.1.1.1", 3, 200)).toBe(true);
    state.clear("1.1.1.1");
    expect(state.isInBackoff("1.1.1.1", 3, 200)).toBe(false);
  });

  test("the window expires and the counter resets", () => {
    const state = createFailureBackoffState();
    state.record("1.1.1.1", 1000, 0);
    state.record("1.1.1.1", 1000, 500);
    state.record("1.1.1.1", 1000, 900);
    expect(state.isInBackoff("1.1.1.1", 3, 900)).toBe(true);
    // 1 second after the last record → past the
    // resetTime → cleared, and the next record starts
    // fresh at 1.
    expect(state.isInBackoff("1.1.1.1", 3, 2000)).toBe(false);
    expect(state.record("1.1.1.1", 1000, 2000)).toBe(1);
  });

  test("IPs are isolated", () => {
    const state = createFailureBackoffState();
    state.record("1.1.1.1", 60_000, 0);
    state.record("1.1.1.1", 60_000, 100);
    state.record("1.1.1.1", 60_000, 200);
    expect(state.isInBackoff("1.1.1.1", 3, 200)).toBe(true);
    expect(state.isInBackoff("2.2.2.2", 3, 200)).toBe(false);
  });

  test("a 1-hour window per the S2 design choice", () => {
    // 3 failures at t=0 within a 1-hour window → backoff.
    // At t=1h+1ms the counter has expired → fresh.
    const state = createFailureBackoffState();
    const WINDOW = 3_600_000;
    state.record("1.1.1.1", WINDOW, 0);
    state.record("1.1.1.1", WINDOW, 100);
    state.record("1.1.1.1", WINDOW, 200);
    expect(state.isInBackoff("1.1.1.1", 3, 200)).toBe(true);
    expect(state.isInBackoff("1.1.1.1", 3, WINDOW + 1)).toBe(false);
  });
});
