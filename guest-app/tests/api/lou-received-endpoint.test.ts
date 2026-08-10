// Per LOW-1 (reports audit 2026-08-10) +
// `DECISIONS-FEATURES.md #99` (LOU workflow):
// source-text guards for the `handleSetLouReceived`
// handler + the `POST /api/bookings/set-lou-received`
// route + the create-path field stamp. The behavioural
// round-trip is the standard `runTransaction` write —
// the Java-emulator path is deferred to the
// local-environment that has the emulator (mirrors the
// MRB-11 / MRB-14 / MRB-15-08 precedent).
//
// The pre-LOW-1 spec declared `louReceived: boolean`
// on the booking type in `plan/docs/TYPES.md:293` but
// the field was never written or read by any code
// path — `grep -rn louReceived` returned zero hits
// across the codebase. The unwired spec meant the
// receivables widget's "Corporate AR" card was
// perpetually inflated by chargeback rows that had
// been resolved out-of-band. The fix wires the
// field end-to-end (schema + create write + API
// endpoint + AdminContext function) and pins every
// piece here so a future refactor cannot revert to
// the unwired state.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/apiRouter.ts"),
  "utf8"
);
const sharedBookingSchemaSrc = readFileSync(
  resolve(__dirname, "../../../shared/schemas/booking.ts"),
  "utf8"
);

describe("LOW-1 — handleSetLouReceived surface (reports audit 2026-08-10)", () => {
  it("validates the body via the shared `SetLouReceivedSchema` (strict Zod, same posture as every other staff-mutation schema)", () => {
    // The schema lives in `shared/schemas/booking.ts` so a
    // future client-side preview / display can import
    // the same shape. The handler must use it (mirrors
    // the existing pattern with `WalkinBookingSchema`
    // + `AddRoomBookingSchema` + `RescheduleBookingSchema`).
    expect(sharedBookingSchemaSrc).toMatch(
      /export const SetLouReceivedSchema = z\.object\(\{[\s\S]*?bookingId: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(64\)[\s\S]*?louReceived: z\.boolean\(\)[\s\S]*?\}\)\.strict\(\)/
    );
  });

  it("the handler validates the booking exists + is a corporate chargeback shape (isCorporate + paymentMethod: 'pay-at-hotel')", () => {
    // Per DECISIONS-FEATURES.md #99: the LOU flag
    // is the settlement trigger for corporate
    // chargebacks ONLY. Toggling it on a non-corporate
    // booking or a non-chargeback corporate booking
    // would corrupt the receivables widget's
    // filter math. The guard is the canonical
    // "isCorporate + paymentMethod === 'pay-at-hotel'"
    // shape.
    expect(bookingsSrc).toMatch(
      /if \(booking\.isCorporate !== true\) \{[\s\S]*?throw new Error\("LOU flag only applies to corporate chargeback bookings \(isCorporate: true\)\."\)/
    );
    expect(bookingsSrc).toMatch(
      /if \(booking\.paymentMethod !== "pay-at-hotel"\) \{[\s\S]*?throw new Error\("LOU flag only applies to chargeback bookings \(paymentMethod: 'pay-at-hotel'\)\."\)/
    );
  });

  it("stamps `louReceived` + `louReceivedAt` + `louReceivedBy` in one Firestore transaction", () => {
    // The toggle is a single-stamp field write. The
    // audit fields (timestamps + staff UID) ride on the
    // same write so the audit trail matches the existing
    // staff-mutation fields (`handledBy`,
    // `discountVerifiedBy`, `cancelledBy`, etc.).
    expect(bookingsSrc).toMatch(/louReceivedAt: now/);
    expect(bookingsSrc).toMatch(/louReceivedBy: staffUid/);
    expect(bookingsSrc).toMatch(
      /await adminDb\.runTransaction\(async \(transaction\) => \{[\s\S]*?const bookingRef = adminDb\.collection\("bookings"\)\.doc\(String\(bookingId\)\.trim\(\)\)/
    );
  });

  it("un-marking (`louReceived: false`) clears the audit fields (`louReceivedAt` + `louReceivedBy` set to null)", () => {
    // The rare "we marked it but the company withdrew"
    // case must be reversible. The un-mark branch sets
    // `louReceived: false` + clears the audit fields so
    // the audit trail doesn't lie about who/when
    // toggled it back.
    expect(bookingsSrc).toMatch(
      /louReceivedAt: null,/
    );
    expect(bookingsSrc).toMatch(
      /louReceivedBy: null/
    );
  });

  it("maps `Booking not found.` to a 404 + a generic message to a 400 (matches the existing `apply-discount` / `reject-discount` pattern)", () => {
    // Status mapping: 404 for the "not found" case, 400
    // for any other error. Mirrors the
    // `handleApplyBookingDiscount` pattern (which
    // itself mirrors `handleRecordCancellationException`
    // from CRL-07).
    expect(bookingsSrc).toMatch(
      /const status = message === "Booking not found\." \? 404 : 400;/
    );
  });
});

describe("LOW-1 — POST /api/bookings/set-lou-received route (reports audit 2026-08-10)", () => {
  it("the apiRouter registers the route with staff auth + a 30/min/IP rate-limit bucket", () => {
    // Staff-only mutation. The auth posture mirrors
    // `apply-discount` / `reject-discount` /
    // `reject-payment` / `cancellation-exception` —
    // the `authenticateStaff` middleware gates the
    // call. The 30/min/IP rate limit matches the other
    // staff tap-and-confirm booking mutations.
    expect(apiRouterSrc).toMatch(
      /if \(domain === "bookings" && action === "set-lou-received" && req\.method === "POST"\) \{/
    );
    expect(apiRouterSrc).toMatch(
      /isRateLimited\(`bookings-set-lou:\$\{ip\}`,\s*30,\s*60000\)/
    );
    expect(apiRouterSrc).toMatch(
      /const authResult = await authenticateStaff\(req\);/
    );
  });
});

describe("LOW-1 — create path stamps `louReceived` from the body (reports audit 2026-08-10)", () => {
  it("the createBookingSchema accepts `louReceived` as an optional boolean (default `false`)", () => {
    // Per the spec: the field exists on every booking
    // doc, defaulting to `false` (LOU not yet
    // received). The schema accepts `true` for the
    // rare case where the LOU arrived up-front and the
    // staff walks it in pre-marked. Strict Zod so a
    // client can't add unknown fields.
    expect(bookingsSrc).toMatch(
      /louReceived: z\.boolean\(\)\.optional\(\)\.default\(false\)/
    );
  });

  it("the public create handler writes `louReceived` to the booking doc on creation", () => {
    // The post-fix booking doc carries the field so
    // the receivables widget (MED-1) can read it
    // through the standard onSnapshot subscription.
    // Default `false` for the common case; `true` for
    // the rare "LOU arrived up-front" case.
    expect(bookingsSrc).toMatch(
      /louReceived: body\.louReceived === true/
    );
  });
});
