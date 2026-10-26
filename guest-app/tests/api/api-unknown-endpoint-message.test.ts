import { describe, expect, test } from "vitest";

// Per QA §3.8 (2026-10-26): the API's fallback 404 used to interpolate
// `/api/${domain}/${action}`. `action` is `undefined` for a
// single-segment path, so a request to `/api/version` answered
//
//   "Endpoint /api/version/undefined not found."
//
// — the word "undefined" in a user-facing error, on any unknown
// one-segment endpoint.
//
// This is a behavioural test of the formatter, plus a guard on the
// router's fallback so the old interpolation cannot come back.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatUnknownEndpoint } from "../../server/lib/apiPath";

const ROUTER_PATH = resolve(__dirname, "../../server/apiRouter.ts");

describe("QA §3.8 — the unknown-endpoint message never says \"undefined\"", () => {
  test("a single-segment path is echoed as it was asked for", () => {
    expect(formatUnknownEndpoint(["version"])).toBe("/api/version");
  });

  test("a multi-segment path is echoed whole", () => {
    expect(formatUnknownEndpoint(["bookings", "breakfast", "manage"])).toBe("/api/bookings/breakfast/manage");
  });

  test("an empty path falls back to /api", () => {
    expect(formatUnknownEndpoint([])).toBe("/api");
    expect(formatUnknownEndpoint([""])).toBe("/api");
  });

  test("the rendered message never contains the word undefined", () => {
    for (const segments of [["version"], ["nope"], ["a", "b"], []]) {
      expect(`Endpoint ${formatUnknownEndpoint(segments)} not found.`).not.toContain("undefined");
    }
  });

  test("the router's fallback uses the formatter, not the old interpolation", () => {
    const source = readFileSync(ROUTER_PATH, "utf8");
    expect(source).toContain("formatUnknownEndpoint(pathSegments)");
    // The old template is the defect — it must not be back.
    expect(source).not.toContain("`Endpoint /api/${domain}/${action} not found.`");
  });
});
