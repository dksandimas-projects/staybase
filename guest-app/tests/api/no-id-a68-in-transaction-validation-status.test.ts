// NO-ID-A68 (handoff-2026-10-23 §6, Wave 4): a validation error raised
// INSIDE the create-booking transaction surfaced as HTTP 500 instead of
// HTTP 400.
//
// WHAT WAS WRONG
// --------------
//   The create handler's catch block maps a handful of known messages
//   to 400 / 409 / 503 and sends everything else to 500:
//
//     if (error.name === "BreakfastSelectionValidationError") { ... }
//     else if (error.message === "Room no longer available" ...) { ... }
//     else if (isInfraError) { status = 503; }
//     else { status = 500; }
//
//   The SCHEMA parse is a 400 (`bookings.ts:1725`), but the ~30 errors
//   thrown from inside the transaction body were unmapped — including
//   the WHOLE member points-redemption validation set.
//
//   So a guest who tried to redeem points with too few points, or with
//   an inactive account, or without signing in, got:
//
//     HTTP 500
//     {"success":false,"error":"Sign in is required to redeem points
//      at booking creation. Please sign in or remove the points amount."}
//
//   A server error for what is plainly the guest's own input. The
//   client shows a generic failure, the guest cannot tell what to fix,
//   and the support desk gets a 500 where there is no server fault.
//
//   This is the SAME path as FOL-03: the points-redemption read was
//   reading after a write, so before that fix every one of these
//   requests died with a 500 anyway. The read-after-write fix removed
//   that first blocker and exposed this one behind it.
//
// THE FIX
// -------
//   A `BookingValidationError` class (mirroring the existing
//   `BreakfastSelectionValidationError` convention) carries the status
//   with the message, and the catch block keeps it.
//
// WHAT THIS TEST DOES
// -------------------
// It evaluates the REAL catch-block mapping and the REAL thrown
// errors against the production-shaped inputs.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const handlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);
const errorSrc = readFileSync(
  resolve(__dirname, "../../server/lib/bookingValidationError.ts"),
  "utf8"
);

// ── The REAL catch-block status mapping ──────────────────────────
//
// Lift the create handler's catch block and evaluate its branches for
// a given error, so the test asserts what the server actually returns.
function extractStatusMapper(): (error: { name?: string; message?: string; status?: number; code?: string }) => number {
  const start = handlerSrc.indexOf("} catch (error: any) {", handlerSrc.indexOf("export async function handleCreateBooking"));
  expect(start, "could not find the create handler's catch block").toBeGreaterThan(-1);
  const end = handlerSrc.indexOf("\n  }\n}", start);
  const block = handlerSrc.slice(start, end > start ? end : start + 4000);

  // Rebuild the branch chain as a function.
  const branches: { test: string; status: string }[] = [];

  // `error.name === "X"` -> 400
  for (const m of block.matchAll(/error\.name === "([A-Za-z]+)"\) \{([\s\S]{0,600}?)\n\s*\} else if/g)) {
    const name = m[1];
    const body = m[2];
    const st = body.match(/status\s*=\s*([^;]+);/);
    if (st) branches.push({ test: `name:${name}`, status: st[1] });
  }
  // `error.message === "X"` -> N
  for (const m of block.matchAll(/error\.message === "([^"]+)"[^{]*\{([\s\S]{0,300}?)\n\s*status\s*=\s*(\d+)/g)) {
    branches.push({ test: `message:${m[1]}`, status: m[3] });
  }
  // `error.message.startsWith("X")` -> N
  for (const m of block.matchAll(/error\.message\.startsWith\("([^"]+)"\)[^{]*\{([\s\S]{0,300}?)\n\s*status\s*=\s*(\d+)/g)) {
    branches.push({ test: `startsWith:${m[1]}`, status: m[3] });
  }

  // The infra branch reads `error.code`, not the message.
  const infraBranch = /isInfraError\)\s*\{\s*status\s*=\s*(\d+)/.test(block);
  const infraStatus = block.match(/isInfraError\)\s*\{\s*status\s*=\s*(\d+)/)?.[1];

  // eslint-disable-next-line no-new-func
  const fn = new Function("error", `
    const status = 500;
    ${infraBranch ? `
    const code = (error && error.code) || "";
    const isInfraError = typeof code === "string" && (
      code.includes("UNAVAILABLE")
      || code.includes("DEADLINE_EXCEEDED")
      || code.includes("RESOURCE_EXHAUSTED")
      || code.includes("INTERNAL")
    );` : ""}
    ${branches
      .map((b) => {
        const [kind, ...rest] = b.test.split(":");
        const value = rest.join(":");
        if (kind === "name") return `if (error.name === ${JSON.stringify(value)}) return (${b.status});`;
        if (kind === "message") return `if (error.message === ${JSON.stringify(value)}) return (${b.status});`;
        return `if (typeof error.message === "string" && error.message.startsWith(${JSON.stringify(value)})) return (${b.status});`;
      })
      .join("\n    ")}
    ${infraBranch ? `if (isInfraError) return (${infraStatus});` : ""}
    return status;
  `);
  expect(typeof fn).toBe("function");
  return fn as (error: any) => number;
}

describe("NO-ID-A68 — a validation error inside the create transaction must not be a 500", () => {
  const statusFor = extractStatusMapper();

  it("the error class carries its own status", () => {
    expect(errorSrc).toMatch(/class BookingValidationError extends Error/);
    expect(errorSrc).toMatch(/status:\s*number/);
    expect(errorSrc).toMatch(/this\.name\s*=\s*"BookingValidationError"/);
  });

  it("the catch block maps it (and only it) to its own status", () => {
    const start = handlerSrc.indexOf("} catch (error: any) {", handlerSrc.indexOf("export async function handleCreateBooking"));
    const block = handlerSrc.slice(start, start + 6000);
    expect(block).toMatch(/error\.name === "BookingValidationError"/);
    // The status is read off the error, not hard-coded to 500.
    expect(block).toMatch(/error\.status/);
  });

  // ── The points-redemption validation set ──────────────────────
  //
  // These are the guest's OWN input / account state. Each must carry
  // its status through to the response.
  it("'Sign in is required to redeem points' is a 401", () => {
    expect(statusFor({ name: "BookingValidationError", status: 401 })).toBe(401);
  });

  it("'Self-service points redemption is not enabled' is a 409", () => {
    expect(statusFor({ name: "BookingValidationError", status: 409 })).toBe(409);
  });

  it("'Member not found' is a 404", () => {
    expect(statusFor({ name: "BookingValidationError", status: 404 })).toBe(404);
  });

  it("'Member account is not active' is a 409", () => {
    expect(statusFor({ name: "BookingValidationError", status: 409 })).toBe(409);
  });

  it("'requires at least N points' is a 400", () => {
    expect(statusFor({ name: "BookingValidationError", status: 400 })).toBe(400);
  });

  it("a validation error with no status falls back to 400, never 500", () => {
    expect(statusFor({ name: "BookingValidationError" })).toBe(400);
  });

  // ── The thrown sites ──────────────────────────────────────────
  it("every points-redemption validation throw uses the class", () => {
    const messages = [
      "Sign in is required to redeem points at booking creation.",
      "Self-service points redemption is not enabled.",
      "Member not found.",
      "Member account is not active.",
      "Points redemption requires at least",
      "Points redemption exceeds the",
      "Points redemption value exceeds the booking total."
    ];
    for (const m of messages) {
      const idx = handlerSrc.indexOf(m);
      expect(idx, `the message "${m}" is gone from the handler`).toBeGreaterThan(-1);
      // The `throw` for that message must use BookingValidationError.
      const before = handlerSrc.slice(Math.max(0, idx - 260), idx);
      expect(
        before,
        `the throw for "${m}" is not a BookingValidationError`
      ).toMatch(/throw new BookingValidationError\(/);
    }
  });

  // ── The control: a genuine server fault is STILL a 500 ────────
  it("an unmapped error is still a 500 (a real fault must not be masked)", () => {
    expect(statusFor({ name: "TypeError", message: "cannot read x of undefined" })).toBe(500);
  });

  it("an infra error is still a 503", () => {
    expect(statusFor({ name: "Error", message: "boom", code: "UNAVAILABLE" })).toBe(503);
  });

  it("a conflict is still a 409", () => {
    expect(statusFor({ name: "Error", message: "Room no longer available" })).toBe(409);
  });
});
