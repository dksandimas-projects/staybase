// Per RPT-05 (QA pass 2026-10-21): the systemic gap behind six
// production crashes.
//
// THE GAP
// -------
// `guest-app/tsconfig.json` includes only `["src", "../hotel.config.ts",
// "../shared"]`. The `server/` directory — the whole API surface — is
// OUTSIDE the type-check. The API ships via esbuild, which does not
// type-check either. So a reference to an identifier that does not
// exist compiles, bundles, deploys, and throws a ReferenceError at
// runtime.
//
// The 2026-10-21 QA pass found SIX such identifiers in the live API:
//   bookings.ts            `finalReservationId`, `childLookupTokens`,
//                          `childBookingRefs`, `childPricing`,
//                          `resolvedRoomSelections`, `guestName`,
//                          `corporateDetails`  (the guest booking
//                          confirmation email — threw on EVERY guest
//                          booking create, so no confirmation email
//                          ever went out)
//   bookings.ts            `parsed` (the guest self-service cancel)
//   bookings.ts            `bookingReservationId` (the refund
//                          state-change email)
//   bookings.ts            `bookingData` (the already-confirmed
//                          verify-payment response)
//   bookings.ts            `DEFAULT_ROOM_TYPES` (add-a-room to a
//                          reservation)
//   corporate-inquiries.ts `actualBreakfastRate` (latent — the
//                          ternary short-circuited)
//
// WHY A tsc-BASED TEST
// --------------------
// The repo's test suite is ~99% source-regex assertions: they check
// that a string appears in a file. A regex can pin the FIX but can
// never PROVE that no undefined identifier remains. This test asks
// the compiler the only question that matters for this class of
// defect: "is every identifier you reference actually defined?"
//
// It is slow-ish (~4s) and that is the trade: it is the guardrail
// that makes the class of bug non-recurring.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../../..");
const TSC_BIN = resolve(REPO_ROOT, "node_modules/typescript/bin/tsc");
const SERVER_ENTRY = resolve(REPO_ROOT, "guest-app/server/apiRouter.ts");

/**
 * Error codes that mean "this identifier does not exist" — every one
 * of them is a guaranteed runtime crash (a ReferenceError) the moment
 * that line executes.
 *
 *   TS2304 — Cannot find name 'X'
 *   TS2552 — Cannot find name 'X'. Did you mean 'Y'?
 *   TS18004 — No value exists in scope for the shorthand property 'X'
 *   TS2448 — Block-scoped variable 'X' used before its declaration
 */
const UNDEFINED_IDENTIFIER_CODES = ["TS2304", "TS2552", "TS18004", "TS2448"];

function collectServerTypeErrors(): string[] {
  if (!existsSync(TSC_BIN) || !existsSync(SERVER_ENTRY)) {
    // The compiler is not available in this environment — skip
    // rather than fail the suite for an unrelated reason.
    return [];
  }
  let output = "";
  try {
    execFileSync(
      process.execPath,
      [
        TSC_BIN,
        "--noEmit",
        "--skipLibCheck",
        "--target",
        "es2022",
        "--module",
        "esnext",
        "--moduleResolution",
        "bundler",
        "--strict",
        "false",
        SERVER_ENTRY
      ],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (error: any) {
    output = String(error?.stdout || "") + String(error?.stderr || "");
  }
  return output
    .split("\n")
    .filter((line) => /error TS\d+:/.test(line))
    .map((line) => line.trim());
}

describe("RPT-05 — the API server has no undefined identifiers", () => {
  const errors = collectServerTypeErrors();

  it("the compiler is available and the server entry point type-checks", () => {
    // If the compiler could not be resolved the suite would be
    // vacuously green. Assert the wiring explicitly.
    expect(
      existsSync(TSC_BIN),
      "typescript must be resolvable from the repo root for this guard to mean anything"
    ).toBe(true);
    expect(existsSync(SERVER_ENTRY)).toBe(true);
  });

  it("NO identifier in guest-app/server is undefined", () => {
    const undefinedIdentifierErrors = errors.filter((line) =>
      UNDEFINED_IDENTIFIER_CODES.some((code) => line.includes(`error ${code}:`))
    );
    expect(
      undefinedIdentifierErrors,
      `guest-app/server references identifiers that do not exist (each one is a runtime ReferenceError):\n${undefinedIdentifierErrors.join("\n")}`
    ).toEqual([]);
  });

  it("no duplicate identifier declaration (a duplicate import binding is a SyntaxError under native ESM)", () => {
    const duplicateErrors = errors.filter((line) => line.includes("error TS2300:"));
    expect(
      duplicateErrors,
      `duplicate identifiers in guest-app/server:\n${duplicateErrors.join("\n")}`
    ).toEqual([]);
  });
});
