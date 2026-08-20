// Per FOL-02 (2026-08-06, per decision #198): the
// `BookingDrawerWorkspaceHeader`'s "Reference" line and the
// Folio's proof card "gcash · <reference>" line must route
// through a computed reference that prefers the live
// subcollection listener state (the canonical source for
// payments) and falls back to the booking's denormalized
// `onsitePayments[]` array. The pre-FOL-02 wiring read
// `getLatestPaymentReference(booking)` directly, which
// returned `null` for new bookings because the denormalized
// array is empty for new payments (the server's verify /
// add-payment handlers write to the subcollection, not the
// array — the array is a pre-MRB-04 relic that was never
// wired to the new write path). The post-FOL-02 fix:
//
//   1. A new `selectedBookingLatestReference` `useMemo` in
//      `BookingsPage.tsx` computes the reference from the
//      live state (preferred) + the persisted array
//      (fallback). Pattern matches the `getBookingFolio`
//      helper's live-vs-persisted disambiguation.
//   2. The `BookingDrawerWorkspaceHeader` gains a new
//      `latestPaymentReference` prop and uses it in the
//      "Reference" line. The header stays a pure function
//      of its inputs; the parent owns the live-vs-persisted
//      disambiguation.
//   3. The Folio's proof card "gcash · <reference>" line
//      uses the same `selectedBookingLatestReference` memo
//      so a verified reference renders on a `confirmed`
//      booking whose `onsitePayments[]` array is empty.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural round-trip
// (verify-and-record payment writes to the subcollection →
// listener fires → `selectedBookingPayments` populates →
// `selectedBookingLatestReference` recomputes → header +
// proof card render the new reference) is covered by the
// 24 unit tests in `shared/__tests__/paymentVerification.test.ts`
// for the `getLatestPaymentReference` helper + the source-text
// guards below (which pin the wiring).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

const drawerWorkspaceSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/BookingDrawerWorkspace.tsx"),
  "utf8"
);

describe("FOL-02 — live reference wiring (header + Folio proof card)", () => {
  describe("BookingsPage — `selectedBookingLatestReference` memo", () => {
    it("the memo is present and locatable in `BookingsPage.tsx`", () => {
      // Sanity: the memo exists. If a future refactor
      // re-shapes the memo (e.g. extracts it to a custom
      // hook), the regex matchers below still pass on the
      // broader `selectedBookingLatestReference` symbol so
      // this guard is a one-line tripwire.
      expect(bookingsPageSrc).toMatch(
        /const\s+selectedBookingLatestReference\s*=\s*useMemo/
      );
    });

    it("the memo prefers the live `selectedBookingPayments` state when present", () => {
      // The contract: when the listener has emitted at
      // least one payment, the live state is the canonical
      // source. The `selectedBookingPayments.length > 0`
      // guard prevents an empty listener initial state
      // from masking a non-empty persisted array.
      expect(bookingsPageSrc).toMatch(
        /if\s*\(\s*selectedBookingPayments\.length\s*>\s*0\s*\)\s*\{\s*return\s+getLatestPaymentReference\(\s*\{\s*onsitePayments:\s*selectedBookingPayments\s*\}\s*\)/
      );
    });

    it("the memo falls back to the booking's persisted `onsitePayments[]` array when the live state is empty", () => {
      // The contract: a legacy booking with a populated
      // persisted array (no reservationId, listener
      // subscribes to the legacy path but the listener
      // also returns the array via `selectedBookingPayments`)
      // — the fallback path renders the persisted
      // reference. Same helper signature as the live
      // path; the helper accepts the booking object
      // directly (the `getLatestPaymentReference` shared
      // helper reads `booking.onsitePayments`).
      expect(bookingsPageSrc).toMatch(
        /return\s+getLatestPaymentReference\(\s*selectedBooking\s*\)/
      );
    });

    it("the memo recomputes when `selectedBooking` or `selectedBookingPayments` changes", () => {
      // The contract: the dep array is exactly the two
      // inputs the memo reads. A future refactor that
      // drops a dep would cause the memo to serve a stale
      // reference after a verify / reject / refund
      // action. The pin ensures the dep array stays
      // correct.
      expect(bookingsPageSrc).toMatch(
        /selectedBookingLatestReference\s*=\s*useMemo\(\(\)\s*=>\s*\{[\s\S]*?\},\s*\[selectedBooking,\s*selectedBookingPayments\]\)/
      );
    });
  });

  describe("BookingDrawerWorkspaceHeader — new `latestPaymentReference` prop", () => {
    it("the header's props interface declares the new prop", () => {
      // The contract: the new prop is on the
      // `BookingDrawerWorkspaceHeaderProps` interface with
      // the correct type. A future refactor that re-shapes
      // the props (e.g. renames or splits the interface)
      // must keep this prop.
      expect(drawerWorkspaceSrc).toMatch(
        /interface\s+BookingDrawerWorkspaceHeaderProps\s*\{[\s\S]*?latestPaymentReference\?:\s*string\s*\|\s*null\s*;[\s\S]*?\}/
      );
    });

    it("the header destructures the new prop in the function signature", () => {
      // The contract: the function signature must pull the
      // prop off the props object so the JSX can read it.
      // A future refactor that adds the prop to the
      // interface but forgets to destructure it would
      // fail this guard.
      expect(drawerWorkspaceSrc).toMatch(
        /export\s+function\s+BookingDrawerWorkspaceHeader\([\s\S]*?latestPaymentReference[\s\S]*?\)\s*\{/
      );
    });

    it("the header's \"Reference\" line uses the new prop as the primary source", () => {
      // The contract: the JSX uses
      // `latestPaymentReference ?? getLatestPaymentReference(booking)`
      // — the computed prop (live state via parent) is
      // the primary read; the inline helper call is the
      // fallback for when the parent didn't pass a
      // computed value (e.g. the prop is `undefined`).
      // The parens around the `??` chain are required
      // for the `||` fallback to the italic text — TS
      // would error on the un-parenthesized form.
      expect(drawerWorkspaceSrc).toMatch(
        /\{\s*\(\s*latestPaymentReference\s*\?\?\s*getLatestPaymentReference\(booking\)\s*\)\s*\|\|/
      );
    });
  });

  describe("BookingsPage — header prop wiring", () => {
    it("the `BookingDrawerWorkspaceHeader` usage passes `latestPaymentReference={selectedBookingLatestReference}`", () => {
      // The contract: the parent (BookingsPage) wires the
      // computed memo into the header's new prop. A
      // future refactor that re-organises the JSX must
      // keep the prop wiring; otherwise the header falls
      // through to the inline helper call (which returns
      // `null` for new bookings) and the bug returns.
      expect(bookingsPageSrc).toMatch(
        /<BookingDrawerWorkspaceHeader[\s\S]*?latestPaymentReference=\{selectedBookingLatestReference\}[\s\S]*?\/>/
      );
    });
  });

  describe("BookingsPage — Folio proof card wiring", () => {
    it("the Folio's proof card \"gcash · <reference>\" line uses the computed memo", () => {
      // The contract: the proof card's reference line
      // also routes through `selectedBookingLatestReference`
      // so a verified reference renders on a `confirmed`
      // booking whose `onsitePayments[]` array is empty.
      // The pre-FOL-02 line read
      // `getLatestPaymentReference(selectedBooking)` directly
      // and rendered "No reference" for new bookings.
      expect(bookingsPageSrc).toMatch(
        /selectedBooking\.paymentMethod\s*\}\s*·\s*\{\s*selectedBookingLatestReference\s*\|\|\s*["']No reference["']/
      );
    });
  });

  describe("regression — the pre-FOL-02 wiring is gone from the Folio", () => {
    it("the pre-FOL-02 `getLatestPaymentReference(selectedBooking) || \"No reference\"` pattern is gone from the Folio", () => {
      // The pre-FOL-02 line in the Folio's proof card
      // was `{selectedBooking.paymentMethod} · {getLatestPaymentReference(selectedBooking) || "No reference"}`.
      // The post-FOL-02 line uses
      // `selectedBookingLatestReference || "No reference"`
      // (the memo prefers the live state). The
      // `getLatestPaymentReference(selectedBooking)` call
      // is gone from the Folio's proof card specifically
      // — the helper is still imported (the inline
      // fallback in the header still uses it) but the
      // Folio doesn't read it directly anymore.
      //
      // The negative regex matches the pre-FOL-02 line
      // shape. If a future refactor re-introduces the
      // pre-FOL-02 pattern in the Folio, this trips.
      const folioBlockMatch = bookingsPageSrc.match(
        /Payment Proof\s*<\/h3>([\s\S]*?)\)\s*\(/
      );
      expect(folioBlockMatch).not.toBeNull();
      if (folioBlockMatch) {
        const folioBody = folioBlockMatch[1];
        expect(folioBody).toMatch(
          /selectedBooking\.paymentMethod\s*\}\s*·\s*\{\s*selectedBookingLatestReference/
        );
        expect(folioBody).not.toMatch(
          /getLatestPaymentReference\(selectedBooking\)\s*\|\|\s*["']No reference["']/
        );
      }
    });
  });
});
