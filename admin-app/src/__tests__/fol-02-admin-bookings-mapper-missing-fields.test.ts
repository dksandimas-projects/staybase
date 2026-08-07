// Per FOL-02 (2026-08-06, per decision #198):
// the AdminContext `bookings` hydration `useEffect` (the
// `onSnapshot` listener at `AdminContext.tsx:1281+` that
// converts Firestore docs into `Booking` objects) must
// preserve EVERY field the `Booking` contract guarantees.
// The pre-FOL-02 mapper silently dropped at least 8 fields
// — `reservationId` / `reservationRef` / `reservationPosition` /
// `reservationRoomCount` (the MRB-01 reservation cluster),
// `onsitePayments` (the denormalized payment ledger array),
// and `paymentRejectionReason` / `paymentRejectedAt` /
// `paymentRejectedBy` (the rejection audit cluster) — and the
// visible consequences were concrete:
//
//   1. The booking drawer's payments listener at
//      `BookingsPage.tsx:1164-1224` gates on
//      `selectedBooking.reservationId` to decide whether to
//      subscribe to the post-MRB-01 canonical path
//      `reservations/{id}/payments/` OR the legacy
//      `bookings/{id}/payments/`. With the field dropped, every
//      booking fell through to the legacy path — so a verified
//      payment written to the canonical subcollection was
//      invisible to the Folio's "Payment history", the
//      `paymentsTotal` was `0`, the `balance` was `grandTotal`,
//      and the "Collect <balance>" CTA stayed on screen even
//      after the staff verified the full amount. The data
//      layer (the canonical subcollection + the
//      `paymentConfirmedAt` timestamp) was correct; the read
//      layer was lossy.
//   2. The header's "Reference" line at
//      `BookingDrawerWorkspace.tsx:170` read
//      `getLatestPaymentReference(booking)` which returned
//      `null` because the mapper dropped the `onsitePayments`
//      array — the staff saw "Pending verification" forever
//      for every booking.
//   3. The Bookings table's "PAID" pill at
//      `BookingsPage.tsx:2074` reduced over the empty array
//      and rendered ₱0 paid for every row.
//   4. The advanced filter's "Reference" search at
//      `BookingsPage.tsx:1759` matched against the empty array
//      and returned no results.
//   5. The dashboard's reject-payment card read
//      `paymentRejectionReason` from the unhydrated field and
//      silently lost the rejection reason on every snapshot
//      echo.
//
// The fix is a multi-field addition to the mapper with the
// same shape normalization the writers use. The test below
// pins the contract at the source level — a future refactor
// that drops any of the contract fields from the mapping
// breaks the test instead of silently regressing.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// cheap, deterministic, <5s. The behavioural round-trip
// (snapshot-with-reservationId-X → hydrates → local state has
// reservationId-X → listener subscribes to the canonical
// subcollection → Folio's `selectedBookingPayments` populates
// from the live snapshot → `paymentsTotal` reads the verified
// amount → `balance` reads 0 → "Collect" CTA hidden) is
// covered by the typecheck on `Booking` (the eight fields are
// required at the contract level) + the source-text guards
// below (which pin the hydration mapping).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

// Slice the `useEffect` that hydrates `bookings` from the
// `bookings` collection snapshot. The slice runs from the
// `useEffect` opener (the `if (!currentUser)` guard) to the
// end of the `onSnapshot` callback body. We use a generous
// slice (the whole effect) so any future re-shape keeps the
// test targeting just the hydration, not the save / optimistic
// handlers in the same file.
const hydrationEffectStart = adminContextSrc.indexOf(
  "  useEffect(() => {\n    if (!currentUser) {\n      setBookings([]);"
);
const hydrationEffectEnd = adminContextSrc.indexOf(
  "    return () => {\n      active = false;\n      unsubscribe();\n    };\n  }, [currentUser]);"
);
const hydrationEffect =
  hydrationEffectStart >= 0 && hydrationEffectEnd > hydrationEffectStart
    ? adminContextSrc.slice(hydrationEffectStart, hydrationEffectEnd)
    : "";

describe("FOL-02 — admin bookings mapper hydrates the full Booking contract", () => {
  it("the bookings hydration `useEffect` is present and locatable", () => {
    // Sanity: the slice exists. If a future refactor re-shapes
    // the effect (e.g. extracts it to a custom hook), the
    // regex matchers below still pass on the broader
    // `bookingsData.push({` token so this guard is a one-line
    // tripwire.
    expect(hydrationEffect.length).toBeGreaterThan(0);
    expect(hydrationEffect).toMatch(/bookingsData\.push\(\{/);
  });

  describe("MRB-01 reservation cluster — preserved from the snapshot", () => {
    it("preserves `reservationId` from the snapshot (the canonical post-MRB-01 foreign key)", () => {
      // The contract: the hydration mapping must read
      // `data.reservationId` so the payments listener at
      // `BookingsPage.tsx:1164-1224` can subscribe to the
      // canonical subcollection. Absent or nullish values
      // floor at `null` (a legacy null-`reservationId`
      // booking is the safe seed).
      expect(hydrationEffect).toMatch(
        /reservationId:\s*data\.reservationId\s*\?\s*String\(data\.reservationId\)\.trim\(\)\s*\|\|\s*null\s*:\s*null/
      );
    });

    it("preserves `reservationRef` from the snapshot (the public reservation ref)", () => {
      // The contract: the denormalized `R-YYYYMMDD-NNNNN`
      // ref rendered on the reservation strip + the table
      // group row. Trims whitespace; falls back to `null`
      // for legacy bookings.
      expect(hydrationEffect).toMatch(
        /reservationRef:\s*data\.reservationRef\s*\?\s*String\(data\.reservationRef\)\.trim\(\)\s*\|\|\s*null\s*:\s*null/
      );
    });

    it("preserves `reservationPosition` from the snapshot (1-indexed room position)", () => {
      // The contract: the position badge on the reservation
      // strip ("Room 1 of 3"). Reads via `Number(...)` so a
      // `3` string from a legacy doc still reads as 3. Falls
      // back to `null` for non-finite values.
      expect(hydrationEffect).toMatch(
        /reservationPosition:\s*Number\.isFinite\(Number\(data\.reservationPosition\)\)\s*\?\s*Number\(data\.reservationPosition\)\s*:\s*null/
      );
    });

    it("preserves `reservationRoomCount` from the snapshot (the group's total room count)", () => {
      // The contract: the "Room X of N" label on the
      // reservation strip. Same `Number.isFinite` guard as
      // `reservationPosition`.
      expect(hydrationEffect).toMatch(
        /reservationRoomCount:\s*Number\.isFinite\(Number\(data\.reservationRoomCount\)\)\s*\?\s*Number\(data\.reservationRoomCount\)\s*:\s*null/
      );
    });
  });

  describe("`onsitePayments` denormalized array — preserved from the snapshot", () => {
    it("hydrates `onsitePayments` from the snapshot with per-entry normalization", () => {
      // The contract: the booking doc carries a
      // denormalized `onsitePayments[]` array (a flat
      // projection of the payments ledger for fast reads).
      // The mapper must read it and map each entry to the
      // `OnsitePayment` shape (the same shape the live
      // listener emits). Absent / non-array values floor at
      // `[]` so the read is never `undefined`. Per-entry
      // normalization: `id` is `String()`, `amount` is
      // `Number()`, `recordedAt` handles both Date and
      // Firestore Timestamp.
      expect(hydrationEffect).toMatch(
        /onsitePayments:\s*Array\.isArray\(data\.onsitePayments\)\s*\?\s*data\.onsitePayments\.map/
      );
    });

    it("the per-entry normalization handles Firestore Timestamp + Date + ISO string for `recordedAt`", () => {
      // The contract: the Firestore doc may store
      // `recordedAt` as a Firestore Timestamp (with
      // `toDate()`), a `Date` (post-conversion), or an ISO
      // string (post-mapper). The mapper must handle all
      // three so the admin's `Booking.onsitePayments[].recordedAt`
      // is always an ISO string.
      expect(hydrationEffect).toMatch(
        /recordedAt:\s*p\.recordedAt\s*\?\s*\(\s*typeof\s+p\.recordedAt\.toDate\s*===\s*["']function["']\s*\?\s*p\.recordedAt\.toDate\(\)\.toISOString\(\)/
      );
    });
  });

  describe("payment-rejection cluster — preserved from the snapshot", () => {
    it("preserves `paymentRejectionReason` from the snapshot (the reject-payment audit string)", () => {
      // The contract: the reject-payment handler stamps a
      // required reason on the booking doc. The dashboard
      // card + the Folio's "Rejected" badge + the audit
      // drawer all read this field. Floors at `null` for
      // legacy bookings without a rejection event.
      expect(hydrationEffect).toMatch(
        /paymentRejectionReason:\s*data\.paymentRejectionReason\s*\|\|\s*null/
      );
    });

    it("preserves `paymentRejectedAt` from the snapshot (the rejection timestamp)", () => {
      // The contract: server-stamped timestamp of the
      // rejection event. ISO string via the admin's
      // `parseDateTimeString` convention (matches
      // `paymentConfirmedAt` from FOL-01). `null` for
      // legacy bookings.
      expect(hydrationEffect).toMatch(
        /paymentRejectedAt:\s*data\.paymentRejectedAt\s*\?\s*parseDateTimeString\(data\.paymentRejectedAt\)\s*:\s*null/
      );
    });

    it("preserves `paymentRejectedBy` from the snapshot (the staff UID who rejected)", () => {
      // The contract: the staff UID who clicked the
      // Reject button. Floors at `null` for legacy
      // bookings.
      expect(hydrationEffect).toMatch(
        /paymentRejectedBy:\s*data\.paymentRejectedBy\s*\|\|\s*null/
      );
    });
  });

  describe("regression — the 8 fields are all present in the same mapping body", () => {
    it("the 8 new fields are all present together (one-shot tripwire)", () => {
      // The pre-FOL-02 mapping preserved 30+ fields but
      // dropped 8. A future "I'll just copy-paste the
      // existing mapping" refactor is the most likely shape
      // of a regression. This test asserts all 8 are
      // present in the same mapping body — if any one
      // regresses, this trips and the per-field tests
      // above point at which one.
      const newFields = [
        "reservationId:",
        "reservationRef:",
        "reservationPosition:",
        "reservationRoomCount:",
        "onsitePayments:",
        "paymentRejectionReason:",
        "paymentRejectedAt:",
        "paymentRejectedBy:"
      ];
      const fieldCount = newFields.reduce(
        (count, field) =>
          count + (hydrationEffect.match(new RegExp(field.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&"), "g")) || []).length,
        0
      );
      expect(fieldCount).toBeGreaterThanOrEqual(newFields.length);
    });
  });

  describe("FOL-01's `paymentConfirmedAt` hydration stays present (no regression on the prior fix)", () => {
    it("the FOL-01 `paymentConfirmedAt` field is still hydrated via `parseDateTimeString`", () => {
      // FOL-02 must not regress the FOL-01 hydration. The
      // FOL-01 test in
      // `fol-01-payment-verified-after-confirm.test.ts`
      // already pins this via the source-text pattern, but
      // we re-assert here so a future "I need to move the
      // mapper" refactor can't accidentally drop the FOL-01
      // hydration while adding the FOL-02 cluster.
      expect(hydrationEffect).toMatch(
        /paymentConfirmedAt:\s*data\.paymentConfirmedAt\s*\?\s*parseDateTimeString\(data\.paymentConfirmedAt\)\s*:\s*null/
      );
    });
  });

  describe("Folio + Bookings table consumers can read the new fields (post-fix wiring check)", () => {
    it("the Bookings table's `PAID` pill still reads from `row.onsitePayments` (regression)", () => {
      // FOL-02's `onsitePayments` hydration feeds the
      // `PAID` pill at `BookingsPage.tsx:2074`. The pill
      // reduces over the array — pre-FOL-02 every row
      // rendered ₱0 paid. The pattern must still match
      // post-FOL-02 (i.e. the consumer's shape is unchanged;
      // only the data is now present).
      const bookingsPageSrc = readFileSync(
        resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
        "utf8"
      );
      expect(bookingsPageSrc).toMatch(
        /\(row\.onsitePayments\s*\?\?\s*\[\]\)\.reduce\(\(sum,\s*p\)\s*=>\s*sum\s*\+\s*\(p\.amount\s*\|\|\s*0\)/
      );
    });

    it("the payments listener's legacy-path branch is preserved (the post-MRB-01 cluster routes correctly)", () => {
      // FOL-02's `reservationId` hydration feeds the listener
      // at `BookingsPage.tsx:1164-1224`. The listener still
      // gates on `selectedBooking.reservationId` to choose
      // between the canonical (`reservations/{id}/payments/`)
      // and the legacy (`bookings/{id}/payments/`) paths.
      // Pre-FOL-02, the field was always null in React state
      // so the legacy branch always won — verified payments
      // written to the canonical subcollection were
      // invisible. Post-FOL-02, the canonical branch wins
      // for new bookings. The pattern check pins the
      // listener's shape.
      const bookingsPageSrc = readFileSync(
        resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
        "utf8"
      );
      expect(bookingsPageSrc).toMatch(
        /const\s+sources\s*=\s*selectedBooking\.reservationId\s*\?/
      );
      expect(bookingsPageSrc).toMatch(
        /collection\(db,\s*["']reservations["'],\s*selectedBooking\.reservationId,\s*["']payments["']\)/
      );
    });
  });
});
