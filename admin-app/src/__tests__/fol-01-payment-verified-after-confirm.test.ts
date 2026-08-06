// Per FOL-01 (2026-08-06, off-roadmap bug fix, decision #197):
// the booking drawer's Folio + Overview "Pending" / "Verified"
// payment badges are derived through the shared
// `isPaymentVerified()` helper, not the transient
// `status === "payment-confirmed"` check. The pre-FOL-01
// surface had two related bugs that both stem from the same
// root cause (the transient-status read):
//
//   1. **Folio (line 5195-5208)**: the outer ternary
//      widened the rendered block to include `status ===
//      "confirmed"` (so the "View proof" CTA stayed
//      visible), but the inner ternary
//      `status === "payment-confirmed" ? "Verified" : ...
//      : "Pending"` never got the same widening. So a
//      booking the staff had clicked "Confirm Booking" on
//      (the common case after Verify & Record Payment
//      → Confirm Booking) showed "Pending" on the
//      payment card even though the payment had been
//      verified minutes earlier.
//
//   2. **Overview (line 4803-4811)**: the `status ===
//      "payment-confirmed"` badge check meant a
//      `confirmed` booking whose payment was verified
//      earlier showed NO badge at all in the Overview —
//      the staff had to click into the Folio section
//      to see the proof status. Same transient-status
//      root cause.
//
// The fix introduces a single source of truth — the
// shared `isPaymentVerified(booking)` helper that ORs
// the transient `status === "payment-confirmed"` axis
// with the durable `paymentConfirmedAt` timestamp
// (stamped by the server on full payment, never cleared
// by any other lifecycle handler). Both render sites
// route through the helper. The admin `BookingsPage`
// type now hydrates `paymentConfirmedAt` from the
// Firestore doc.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md
// §Testing`): cheap, deterministic, <5s. The behavioural
// round-trip (Firestore doc has
// `paymentConfirmedAt: <Date>` and
// `status: "confirmed"` → admin mapper hydrates the
// timestamp → `isPaymentVerified()` returns true → Folio
// renders "Verified" + Overview renders "Verified"
// badge) is covered by the `shared/__tests__/paymentVerification.test.ts`
// unit tests (24 cases) + the source-text guards below.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

const sharedTypesSrc = readFileSync(
  resolve(__dirname, "../../../shared/types/index.ts"),
  "utf8"
);

const sharedIndexSrc = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);

describe("FOL-01 — booking drawer payment badge reads through isPaymentVerified()", () => {
  describe("shared layer — single source of truth", () => {
    it("shared `Booking` type declares `paymentConfirmedAt`", () => {
      // The durable signal has to exist on the shared
      // type so the admin mapper can hydrate it and the
      // helper can read it. A future refactor that drops
      // the field from the type would break both the
      // mapper and the helper — this guard is the
      // tripwire.
      expect(sharedTypesSrc).toMatch(
        /paymentConfirmedAt\?:\s*Date\s*\|\s*null/
      );
    });

    it("shared `index.ts` exports the new helper module", () => {
      // The helper is the canonical read; if a future
      // refactor re-organises the shared `index.ts`
      // exports, the import in `BookingsPage.tsx` must
      // keep resolving. This guard pins the
      // `paymentVerification` module export.
      expect(sharedIndexSrc).toMatch(
        /export\s+\*\s+from\s+["']\.\/utils\/paymentVerification["']/
      );
    });
  });

  describe("admin mapper — hydrates `paymentConfirmedAt` from Firestore", () => {
    it("the bookings mapper reads `data.paymentConfirmedAt`", () => {
      // The mapper pushes a plain object onto
      // `bookingsData` with the hydrated `Booking`
      // shape. The new field must be read from
      // `data.paymentConfirmedAt` and passed through
      // `parseDateTimeString` (the admin's
      // Date → ISO-string convention). The exact
      // `paymentConfirmedAt:` key in the mapper is the
      // contract — if a future refactor re-shapes the
      // mapper and drops the field, the booking drawer
      // silently loses the verified signal.
      expect(adminContextSrc).toMatch(
        /paymentConfirmedAt:\s*data\.paymentConfirmedAt\s*\?\s*parseDateTimeString\(data\.paymentConfirmedAt\)\s*:\s*null/
      );
    });

    it("the admin `Booking` extension declares `paymentConfirmedAt`", () => {
      // The extension has to declare the field so the
      // mapper's `paymentConfirmedAt: ...` line typechecks.
      // The string-shape (`string | null`) mirrors the
      // shared `Date | null` shape after
      // `parseDateTimeString`.
      expect(adminContextSrc).toMatch(
        /paymentConfirmedAt\?:\s*string\s*\|\s*null/
      );
    });
  });

  describe("BookingsPage import — `isPaymentVerified` is imported from `@spark-inn/shared`", () => {
    it("the `isPaymentVerified` symbol is on the shared import line", () => {
      // The import is multi-line, with every helper
      // from `@spark-inn/shared` listed in alphabetical
      // order (the project's pre-FOL-01 convention).
      // The new `isPaymentVerified` is added next to
      // `getLatestPaymentReference` (the closest
      // semantic sibling — both are payment-derived
      // reads). The contract: a future refactor that
      // re-organises the import line must keep
      // `isPaymentVerified` resolving.
      expect(bookingsPageSrc).toMatch(
        /import\s*\{[^}]*\bisPaymentVerified\b[^}]*\}\s*from\s*["']@spark-inn\/shared["']/
      );
    });
  });

  describe("Folio render site (the original bug)", () => {
    it("the outer ternary includes the `isPaymentVerified()` check", () => {
      // The pre-FOL-01 outer ternary at line 5195 was:
      //   selectedBooking.status === "payment-confirmed"
      //   || selectedBooking.status === "confirmed"
      //   || selectedBooking.paymentRejectionReason
      // The post-FOL-01 form widens the verified axis
      // through the helper:
      //   isPaymentVerified(selectedBooking)
      //   || selectedBooking.status === "confirmed"
      //   || selectedBooking.paymentRejectionReason
      // — so a `confirmed` booking with a
      // `paymentConfirmedAt` timestamp renders this
      // block (with the "View proof" CTA visible).
      expect(bookingsPageSrc).toMatch(
        /isPaymentVerified\(selectedBooking\)\s*\|\|\s*selectedBooking\.status\s*===\s*["']confirmed["']\s*\|\|\s*selectedBooking\.paymentRejectionReason/
      );
    });

    it("the inner ternary reads the verified state through the helper (NOT the transient status check)", () => {
      // The pre-FOL-01 inner ternary at line 5202 was:
      //   selectedBooking.status === "payment-confirmed"
      //   ? "Verified" : ... : "Pending"
      // — the source of the "Pending on a confirmed
      // booking" bug. The post-FOL-01 form replaces the
      // transient status check with the helper so a
      // `confirmed` booking with a stamped
      // `paymentConfirmedAt` reads as "Verified".
      //
      // The negative assertion: the pre-FOL-01 pattern
      // `selectedBooking.status === "payment-confirmed" ? "Verified"`
      // is GONE from this render site. We assert the
      // new pattern is present AND the old pattern is
      // absent (in this specific render context — the
      // pattern is allowed elsewhere, e.g. the
      // DrawerWorkspaceHeader `needsPaymentReview`
      // check, which is a different concern).
      expect(bookingsPageSrc).toMatch(
        /isPaymentVerified\(selectedBooking\)\s*\?\s*["']Verified["']/
      );

      // Negative: the pre-FOL-01 `status === "payment-confirmed" ? "Verified"` pattern is gone.
      // The pattern is allowed in OTHER contexts (e.g.
      // DrawerWorkspaceHeader's `needsPaymentReview`),
      // but it must not be the source of the Folio's
      // "Verified" label. We assert by checking that
      // the specific `? "Verified"` ternary branch
      // doesn't reference `selectedBooking.status ===
      // "payment-confirmed"`.
      const folioBlockMatch = bookingsPageSrc.match(
        /\{selectedBooking\.paymentProofUrl && \([\s\S]*?Payment Proof[\s\S]*?\)\s*\(/
      );
      expect(folioBlockMatch).not.toBeNull();
      if (folioBlockMatch) {
        expect(folioBlockMatch[0]).not.toMatch(
          /selectedBooking\.status\s*===\s*["']payment-confirmed["']\s*\?\s*["']Verified["']/
        );
      }
    });
  });

  describe("Overview render site (the related bug — no badge on a confirmed booking)", () => {
    it("the Verified badge condition reads through the helper", () => {
      // The pre-FOL-01 Overview badge block had:
      //   selectedBooking.status === "payment-confirmed" && (
      //     <span ...>Verified</span>
      //   )
      // — so a `confirmed` booking with a stamped
      // `paymentConfirmedAt` rendered NO badge at all
      // (the staff had to click into the Folio section
      // to see the proof). The post-FOL-01 form widens
      // the read through the helper:
      //   isPaymentVerified(selectedBooking) && (
      //     <span ...>Verified</span>
      //   )
      expect(bookingsPageSrc).toMatch(
        /isPaymentVerified\(selectedBooking\)\s*&&\s*\(\s*<span[^>]*>\s*Verified\s*<\/span>/
      );
    });

    it("the Pending badge condition still gates on `payment-uploaded` AND NOT verified", () => {
      // The pre-FOL-01 "Pending" badge was:
      //   selectedBooking.status === "payment-uploaded" && (
      //     <span ...>Pending</span>
      //   )
      // — which would also have fired on a
      // `payment-uploaded` booking that ALREADY has a
      // stamped `paymentConfirmedAt` (e.g. a re-upload
      // after a verified-then-bounced-back flow). The
      // post-FOL-01 form is:
      //   selectedBooking.status === "payment-uploaded"
      //   && !isPaymentVerified(selectedBooking) && (
      //     <span ...>Pending</span>
      //   )
      // — so the "Pending" badge and the "Verified"
      // badge are mutually exclusive (a booking is one
      // or the other, not both). The `!isPaymentVerified`
      // guard is the new piece.
      expect(bookingsPageSrc).toMatch(
        /selectedBooking\.status\s*===\s*["']payment-uploaded["']\s*&&\s*!isPaymentVerified\(selectedBooking\)\s*&&\s*\(\s*<span[^>]*>\s*Pending\s*<\/span>/
      );
    });
  });

  describe("regression — the pre-FOL-01 inner ternary at the Folio site is gone", () => {
    it("the original `status === \"payment-confirmed\" ? \"Verified\" : ... : \"Pending\"` chain is not the Folio's source of truth", () => {
      // The pre-FOL-01 Folio inner ternary was the
      // entire source of the "Pending" bug. The
      // post-FOL-01 fix replaces the verified branch
      // with `isPaymentVerified(selectedBooking) ? "Verified"`.
      // This guard asserts the new pattern is present
      // AND the old pattern is absent (in the Folio's
      // render block specifically).
      const folioBlockMatch = bookingsPageSrc.match(
        /Payment Proof\s*<\/h3>([\s\S]*?)\)\s*\(/
      );
      expect(folioBlockMatch).not.toBeNull();
      if (folioBlockMatch) {
        const folioBody = folioBlockMatch[1];
        // The helper is the source of the "Verified" label.
        expect(folioBody).toMatch(
          /isPaymentVerified\(selectedBooking\)\s*\?\s*["']Verified["']/
        );
        // The pre-FOL-01 transient-status branch is gone from the Folio body.
        expect(folioBody).not.toMatch(
          /selectedBooking\.status\s*===\s*["']payment-confirmed["']\s*\?\s*["']Verified["']/
        );
      }
    });
  });
});
