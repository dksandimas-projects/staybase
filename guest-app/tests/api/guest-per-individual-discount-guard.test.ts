// Per the per-individual discount guard (guest side,
// mirrors the admin-app drawer-edit fix shipped
// 2026-08-08 on `fix/discount-scope-guard-per-individual`):
// PWD and senior are per-individual legal entitlements
// (RA 7277 / RA 9442) — they must be applied to the
// specific guest's booking, not the whole multi-room
// cart. The guard in `guest-app/src/pages/BookingPage.tsx`
// disables the senior / PWD picker options when the cart
// has >1 room + auto-reverts the discount type to "none"
// if the cart grows past 1 while senior / PWD is
// selected. The single source of truth is the
// `isPerIndividualDiscount` derivation consumed by the
// picker disable + the auto-revert useEffect.
//
// This file pins the source-text contract. The
// behavioural round-trip (a guest adding >1 room with
// PWD selected auto-reverts to "none") is covered by
// the existing `booking-flow-multi-room.test.ts` suite
// (when extended by a future follow-up); the source-text
// guards below pin the contract at the source level so a
// future "I'll just remove the guard" refactor breaks the
// test instead of silently regressing.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md
// §Testing`): cheap, deterministic, <5s.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

describe("Per-individual discount guard — guest-app BookingPage", () => {
  it("the guard derivation exists + is the single source of truth", () => {
    // The `isPerIndividualDiscount` derivation is
    // the source of truth. The picker disable + the
    // auto-revert useEffect + the disabled-button
    // attribute all read from it. The `cartIsMultiRoom`
    // derivation is the second source of truth (the
    // cart length > 1 gate).
    expect(bookingPageSrc).toMatch(
      /const isPerIndividualDiscount = discountType === "senior" \|\| discountType === "pwd";/
    );
    expect(bookingPageSrc).toMatch(
      /const cartIsMultiRoom = distributedRoomCart\.length > 1;/
    );
  });

  it("the senior / PWD picker buttons are disabled when the cart is multi-room", () => {
    // Per the per-individual discount guard: the
    // senior / PWD buttons are disabled when the cart
    // has >1 room. The "None" button stays enabled (it's
    // the safe default). The disabled state is gated
    // on `disabledByGuard` which is the per-button
    // AND of `isPerIndividualType` (senior / pwd) +
    // `cartIsMultiRoom`.
    expect(bookingPageSrc).toMatch(
      /const isPerIndividualType = type === "senior" \|\| type === "pwd";/
    );
    expect(bookingPageSrc).toMatch(
      /const disabledByGuard = isPerIndividualType && cartIsMultiRoom;/
    );
    expect(bookingPageSrc).toMatch(/disabled=\{disabledByGuard\}/);
    expect(bookingPageSrc).toMatch(/aria-disabled=\{disabledByGuard\}/);
  });

  it("the disabled buttons carry the full per-individual explanation as a tooltip", () => {
    // The tooltip explains WHY the button is disabled
    // (per-individual entitlement + the right shape:
    // "book the senior / PWD guest's room separately").
    expect(bookingPageSrc).toMatch(
      /title=\{[\s\S]{0,500}?disabledByGuard[\s\S]{0,500}?Senior \/ PWD discounts are per-individual entitlements[\s\S]{0,500}?book the senior \/ PWD guest's room separately/
    );
  });

  it("the discount picker shows a multi-room hint when the cart has >1 room", () => {
    // When the cart is multi-room, the picker shows
    // a one-line hint explaining the per-individual
    // constraint + the recommended flow (book
    // separately, add the other rooms at check-in).
    expect(bookingPageSrc).toMatch(
      /\{seniorPwdOnlineEnabled && cartIsMultiRoom && \(/
    );
    expect(bookingPageSrc).toMatch(
      /If you need a senior or PWD discount, please book that guest's room in a separate booking/
    );
  });

  it("the auto-revert useEffect clears the discount type if the cart grows past 1 while senior / PWD is selected", () => {
    // Defense in depth: if the user picks "senior"
    // with a single-room cart, then adds a second
    // room to the cart (without re-clicking the
    // picker), the discount type auto-reverts to
    // "none" so the submit handler doesn't apply a
    // per-individual discount to a multi-room
    // booking. The same useEffect pattern as the
    // admin-app drawer-edit fix.
    expect(bookingPageSrc).toMatch(
      /useEffect\(\(\) => \{[\s\S]{0,200}?if \(isPerIndividualDiscount && cartIsMultiRoom\) \{[\s\S]{0,200}?setDiscountType\("none"\);[\s\S]{0,200}?clearDiscountIdUpload\(\);[\s\S]{0,200}?setDiscountIdUploadError\(""\);[\s\S]{0,200}?\}, \[isPerIndividualDiscount, cartIsMultiRoom, clearDiscountIdUpload\]\);/
    );
  });

  it("the per-individual buttons carry a `data-testid` for end-to-end tests", () => {
    // The picker buttons carry a `data-testid` so the
    // end-to-end suite can drive the picker without
    // selector heuristics. The test ids follow the
    // existing admin-side pattern.
    expect(bookingPageSrc).toMatch(
      /data-testid=\{`guest-discount-type-\$\{type\}`\}/
    );
  });

  it("the `roomCount` field is no longer sent in the BookingPage create request body (per BAR-02 / #203 dead-data cleanup)", () => {
    // Per BAR-02 (2026-08-08, per decision #203):
    // the `roomCount` field is no longer written
    // to the reservation header. The field is also
    // no longer sent in the create request body —
    // the server reads the children list directly
    // to compute the count. This pins the dead-data
    // cleanup: the pre-BAR-02 client sent
    // `roomCount: distributedRoomCart.length` in the
    // request body; BAR-02 deleted the writes on the
    // server side; this fix deletes the corresponding
    // field on the client side so the wire matches
    // the server contract.
    //
    // The negative match: the BookingPage request
    // body should NOT carry `roomCount:`.
    const roomCountSends = bookingPageSrc.match(
      /roomCount:\s*distributedRoomCart\.length,/g
    );
    expect(
      roomCountSends,
      "the BookingPage create request body must NOT carry `roomCount: distributedRoomCart.length` (per BAR-02 — derived at read time)"
    ).toBeNull();
  });
});

// Per BAR-02 (2026-08-08, per decision #203): the
// same dead-data cleanup on the corporate new-booking
// path. The pre-BAR-02 `CorporateBookingPage` sent
// `roomCount: distributedRoomCart.length` in the create
// request body; BAR-02 deleted the writes on the server
// side; this fix deletes the corresponding field on the
// client side so the wire matches the server contract.
describe("Per BAR-02 / #203 — corporate new-booking request body cleanup", () => {
  const corporatePageSrc = readFileSync(
    resolve(__dirname, "../../src/pages/CorporateBookingPage.tsx"),
    "utf8"
  );

  it("the `roomCount` field is no longer sent in the CorporateBookingPage create request body", () => {
    const roomCountSends = corporatePageSrc.match(
      /roomCount:\s*distributedRoomCart\.length,/g
    );
    expect(
      roomCountSends,
      "the CorporateBookingPage create request body must NOT carry `roomCount: distributedRoomCart.length` (per BAR-02 — derived at read time)"
    ).toBeNull();
  });
});
