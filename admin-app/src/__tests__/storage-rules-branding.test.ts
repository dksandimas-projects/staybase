import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for the Branding feature (Phase 11.10 + W3.13).
//
// Background: the Settings → Branding tab uploads hero photos and
// logo overrides to Firebase Storage at
// `assets/branding/{section}/{field}/{timestamp}-{filename}` — a
// nested path derived from the dot-key (e.g. "homepage.heroPhotoUrl"
// becomes `homepage/heroPhotoUrl/`). The storage rule for that
// folder must use the recursive `{allPaths=**}` wildcard; a single
// `{fileName}` segment would match only one path level and reject
// every actual upload with `storage/unauthorized` (bug observed
// in the wild). The same hazard would apply to any future rule
// that needs to match a nested upload path.
//
// This test locks in:
//   * The shape of the assets/branding rule (recursive wildcard)
//   * That every other storage rule is still intact (no regression
//     to the room-types / bookings / store rules added in earlier
//     phases)

const storageRulesSrc = readFileSync(
  resolve(__dirname, "../../../firebase/storage.rules"),
  "utf8"
);

describe("Storage rules — assets/branding supports the nested upload path", () => {
  it("declares the assets/branding match block", () => {
    const block = storageRulesSrc.match(
      /match \/assets\/branding\/\{[a-zA-Z]+(?:={1,2}\*+)?\}\s*\{[\s\S]*?\}/
    );
    expect(block, "expected assets/branding match block").toBeTruthy();
  });

  it("uses the recursive {allPaths=**} wildcard, not a single {fileName} segment", () => {
    // The naive {fileName} only matches a single path segment, which
    // is why the original rule rejected uploads like
    // `assets/branding/homepage/heroPhotoUrl/{ts}-{name}.jpg`. The
    // recursive {allPaths=**} wildcard matches the full subtree.
    expect(storageRulesSrc).toMatch(/match \/assets\/branding\/\{allPaths=\*\*\}\s*\{/);
    expect(storageRulesSrc).not.toMatch(/match \/assets\/branding\/\{fileName\}\s*\{/);
  });

  it("allows public read and staff-only write on assets/branding", () => {
    const block = storageRulesSrc.match(
      /match \/assets\/branding\/\{allPaths=\*\*\}\s*\{[\s\S]*?\}/
    );
    expect(block, "expected assets/branding match block").toBeTruthy();
    const body = block![0];
    expect(body).toMatch(/allow read:\s*if true/);
    expect(body).toMatch(/allow write:\s*if isStaff\(\)/);
  });
});

describe("Storage rules — regression check for existing rules", () => {
  // Snapshot of every match block the rest of the app depends on.
  // If any of these change shape or disappear, this test fails
  // loudly so we can investigate before deploying.
  const expectedBlocks = [
    { path: "rooms/{roomId}/{fileName}", description: "room photos (legacy + delete-only path)" },
    { path: "room-types/{typeValue}/{fileName}", description: "type photos (per W3.5)" },
    { path: "bookings/{bookingId}/payment-proof/{fileName}", description: "guest payment proof upload" },
    { path: "bookings/{bookingId}/discount-id/{fileName}", description: "senior/PWD discount ID upload" },
    { path: "bookings/{bookingId}/guest-id/{fileName}", description: "staff-only guest ID upload" },
    { path: "settings/website-content/{allPaths=**}", description: "admin-only website content writes" },
    { path: "settings/notification-sound/{fileName}", description: "staff notification sound" },
    { path: "store-items/{itemId}/{fileName}", description: "in-room store item photos" },
    { path: "store-orders/{roomNumber}/payment-proof/{fileName}", description: "GCash payment proof from guest" }
  ];

  for (const { path, description } of expectedBlocks) {
    it(`preserves the ${path} rule (${description})`, () => {
      // Build a regex from the path so single-segment and
      // allPaths=** wildcards both match. Escape all regex
      // metacharacters in the path (braces + asterisks + forward
      // slashes within the regex literal).
      const escaped = path.replace(/[{}*]/g, (c) => `\\${c}`);
      const re = new RegExp(`match\\s+/${escaped}\\s*\\{`);
      expect(storageRulesSrc.match(re), `expected match /${path}/ rule`).toBeTruthy();
    });
  }
});

describe("Storage rules — guard helper functions still exist", () => {
  // The branding rule relies on isStaff(); the website-content
  // rule relies on `request.auth.token.role == "admin"`. Make sure
  // neither got accidentally removed during a future refactor.
  it("defines the isStaff() helper", () => {
    expect(storageRulesSrc).toMatch(/function isStaff\s*\(/);
  });

  it("defines the signedIn() helper", () => {
    expect(storageRulesSrc).toMatch(/function signedIn\s*\(/);
  });
});
