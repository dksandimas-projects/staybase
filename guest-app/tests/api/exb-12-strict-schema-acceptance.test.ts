// Per EXB-12 (2026-07-31, per decision #145): the strict-schema
// regression guard.
//
// THE BUG THIS FILE EXISTS FOR: the top-level `createBookingSchema`
// is `.strict()`. When the client added a field the server schema
// did not declare, EVERY /book POST failed with
// `unrecognized_keys: ["<field>"]`. That shipped to production
// (v0.264.5) because the only test surface at the time was
// regex-based, grepping a different file — so the shape drift was
// invisible to CI.
//
// Per BR-08 (decision #238, 2026-10-14 — close-out): this file was
// left skipped after the legacy flat-rate breakfast fields
// (`hasBreakfast` / `breakfastIncludesChildren` /
// `extraBedBreakfast`) were deleted from the schemas. Its fixture
// still sent them, so every test in it failed — and the skip marker
// meant nobody noticed. Re-enabled on 2026-11-10.
//
// THE FIX — WHY THIS FILE IS NOW STRUCTURAL, NOT A HAND-KEPT
// FIXTURE: the original version kept a hand-written fixture body
// and asserted the schema accepted it. That fixture drifted the
// moment the schema changed (which is exactly how it ended up
// skipped in the first place). This version instead READS THE
// CLIENT'S ACTUAL create-payload keys out of `BookingPage.tsx` and
// asserts every one of them is declared by the server's strict
// schema.
//
// That catches the whole bug class directly: add a field to the
// client's body without adding it to the schema, and this test
// fails on the spot — no fixture to update, no fixture to forget.
// The runtime `safeParse` assertions are kept as a second layer
// (they catch shape/value-level rejections the key comparison
// cannot).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createBookingSchema,
  publicRoomSelectionSchema
} from "../../server/handlers/bookings";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const bookingPageSrc = read("guest-app/src/pages/BookingPage.tsx");

/**
 * Extracts the top-level keys of the guest create-payload body out
 * of `BookingPage.tsx`.
 *
 * The body is a `JSON.stringify({ ... })` literal inside the
 * `/api/bookings/create` fetch call. Its top-level properties are
 * written at a fixed indentation (10 spaces) — every nested object
 * literal inside it is indented deeper — so the top-level key set
 * is recoverable by indentation alone.
 */
function extractClientCreateBodyKeys(src: string): string[] {
  // Anchor on the create call FIRST — the file contains other
  // `JSON.stringify({ ... })` payloads, and the first one in the
  // file is not the create body.
  const createCall = src.indexOf('await fetch("/api/bookings/create"');
  expect(createCall, "the /api/bookings/create fetch call was not found").toBeGreaterThan(-1);

  const startMarker = "body: JSON.stringify({";
  const start = src.indexOf(startMarker, createCall);
  expect(start, "the /api/bookings/create body builder was not found").toBeGreaterThan(-1);

  // The body literal closes with `\n        })` (8 spaces) — the
  // `JSON.stringify` call's own closing paren.
  const end = src.indexOf("\n        })", start);
  expect(end, "the end of the create body literal was not found").toBeGreaterThan(-1);

  const body = src.slice(start, end);
  const keys: string[] = [];
  for (const line of body.split("\n")) {
    // 10 spaces of indent == a top-level property of the body.
    const match = line.match(/^ {10}([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/**
 * Extracts the keys of ONE `roomSelections[i]` entry out of the
 * client's `roomSelections: distributedRoomCart.map(...)` builder.
 * Those entries are written at 12 spaces of indent.
 */
function extractClientRoomSelectionKeys(src: string): string[] {
  const createCall = src.indexOf('await fetch("/api/bookings/create"');
  const startMarker = "roomSelections: distributedRoomCart.map((room, index) => ({";
  const start = src.indexOf(startMarker, createCall);
  expect(start, "the roomSelections builder was not found").toBeGreaterThan(-1);

  const end = src.indexOf("}))", start);
  expect(end, "the end of the roomSelections builder was not found").toBeGreaterThan(-1);

  const block = src.slice(start, end);
  const keys: string[] = [];
  for (const line of block.split("\n")) {
    // 12 spaces of indent == a property of one room-selection entry.
    const match = line.match(/^ {12}([A-Za-z_][A-Za-z0-9_]*)\s*[:,]/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/**
 * The declared keys of a Zod schema.
 *
 * `createBookingSchema` is a plain `ZodObject` (`.shape` is a
 * getter). `publicRoomSelectionSchema` is a `ZodEffects` — the
 * `.superRefine(...)` wrapper around the object — so its declared
 * shape lives one level down on `_def.schema.shape`.
 */
function declaredSchemaKeys(schema: any): string[] {
  const inner = schema?._def?.schema ?? schema;
  return Object.keys(inner?.shape ?? {});
}

const clientBodyKeys = extractClientCreateBodyKeys(bookingPageSrc);
const clientRoomSelectionKeys = extractClientRoomSelectionKeys(bookingPageSrc);

// The current client body shape (mirrors `BookingPage.tsx`'s
// `JSON.stringify({ ... })` payload). Kept as a realistic runtime
// fixture for the `safeParse` assertions — the KEY comparison
// above is what protects it from drifting.
const baseBookingBody = {
  bookingId: "abc123def456ghi789",
  reservationId: "12345678-90ab-4cde-9f01-23456789abcd",
  roomType: "Deluxe Queen",
  roomSelections: [
    {
      bookingId: "abc123def456ghi789",
      roomType: "Deluxe Queen",
      numAdults: 2,
      numChildren: 0,
      extraBedCount: 0,
      bedSetup: ""
    }
  ],
  checkIn: "2099-01-01",
  checkOut: "2099-01-03",
  guests: 2,
  numAdults: 2,
  numChildren: 0,
  extraBedCount: 0,
  // Per BR-03: the rich per-guest × per-date meal map replaces the
  // deleted flat-rate flags.
  breakfastSelections: {
    "2099-01-01-guest-0": { mealId: "tapsilog", mealName: "Tapsilog", price: 300 }
  },
  otherAddOnSelections: {},
  guestDetails: {
    firstName: "Maria",
    lastName: "Santos",
    email: "maria@example.com",
    phone: "+639171234567",
    consent: true
  },
  discountType: "",
  discountIdPhotoUrl: null,
  discountIdPhotoPath: null,
  voucherCode: "",
  paymentMethod: "bank-transfer",
  paymentProofUrl: null,
  paymentProofPath: null,
  turnstileToken: "test-token",
  _hp: ""
};

describe("EXB-12 — strict server schemas accept the EXB-12 client body shape", () => {
  it("TEST-EXB-12-STRICT-001: createBookingSchema.safeParse accepts the full /book body (no Firebase)", () => {
    // The single most important assertion in this file.
    // Pre-v0.264.6 this would have failed with
    // `unrecognized_keys: ["extraBedBreakfast"]` because
    // the top-level `createBookingSchema` is `.strict()`
    // and did not declare the field. The bug shipped to
    // production because the regex-only test surface
    // greps a different file.
    const result = createBookingSchema.safeParse(baseBookingBody);
    expect(result.success).toBe(true);
    if (!result.success) {
      // Fail loudly with the actual Zod issue list so a
      // future regression isn't silently masked.
      throw new Error(
        `createBookingSchema rejected the client body: ${JSON.stringify(result.error.issues, null, 2)}`
      );
    }
  });

  it("TEST-EXB-12-STRICT-002: publicRoomSelectionSchema.safeParse accepts each roomSelections[i]", () => {
    // The per-room strict schema must also accept the
    // client's room-selection shape.
    const result = publicRoomSelectionSchema.safeParse(baseBookingBody.roomSelections[0]);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(
        `publicRoomSelectionSchema rejected the client room line: ${JSON.stringify(result.error.issues, null, 2)}`
      );
    }
  });

  it("TEST-EXB-12-STRICT-003: every key the client sends is declared by the strict schema", () => {
    // THE BUG-CLASS GUARD. The client's create body is read out
    // of `BookingPage.tsx` and every key it sends is checked
    // against the server's `.strict()` schema. A new client field
    // that the schema does not declare is exactly the
    // production-breaking defect this file exists to catch.
    const schemaKeys = new Set(declaredSchemaKeys(createBookingSchema));
    const unknown = clientBodyKeys.filter((key) => !schemaKeys.has(key));
    expect(
      unknown,
      `the client sends ${unknown.length} field(s) the strict createBookingSchema does not declare: ${unknown.join(", ")}`
    ).toEqual([]);
  });

  it("TEST-EXB-12-STRICT-004: every key the client sends per room is declared by the strict room schema", () => {
    // The same guard for the per-room selection shape.
    const schemaKeys = new Set(declaredSchemaKeys(publicRoomSelectionSchema));
    const unknown = clientRoomSelectionKeys.filter((key) => !schemaKeys.has(key));
    expect(
      unknown,
      `the client sends ${unknown.length} per-room field(s) the strict publicRoomSelectionSchema does not declare: ${unknown.join(", ")}`
    ).toEqual([]);
  });

  it("TEST-EXB-12-STRICT-005: extraBedCount > 0 is accepted with no schema-level breakfast invariant", () => {
    // Per BR-08 the legacy `extraBedBreakfast: boolean` toggle is
    // deleted — extra-bed occupants are ordinary meal slots in the
    // Step 2 per-meal picker, so the create payload carries no
    // per-room breakfast flag at all. The schema accepts the
    // physical `extraBedCount`; the meal choice rides in the
    // root-level `breakfastSelections` map. This pins the split
    // of concerns: schema = shape, handler = business rules.
    const body = {
      ...baseBookingBody,
      roomSelections: [
        {
          ...baseBookingBody.roomSelections[0],
          extraBedCount: 1
        }
      ]
    };
    const result = createBookingSchema.safeParse(body);
    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error(
        `createBookingSchema rejected an extra-bed body: ${JSON.stringify(result.error.issues, null, 2)}`
      );
    }
  });
});
