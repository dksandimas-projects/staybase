// Regression test for fix/walkin-split-name (2026-07-25).
// Mirrors the SEV-1 audit pattern in staff-accounts-tab.test.ts:
// reads the source as a string and pins the contract so a future
// refactor can't silently re-introduce the `guestName.split(" ")`
// kludge that broke single-name and compound-name walk-ins.
//
// The fix brought the admin walk-in flow into symmetry with the
// guest `/book` page — both now collect `firstName` + `lastName`
// as separate fields. The server combines them into
// `Booking.guestName` for storage. This is purely a UI/wire
// change; the booking doc still stores `guestName` as the source
// of truth for every reader (drawer, table, PDF, email).
//
// Coverage:
//   1. AdminContext.addWalkinBooking signature requires
//      firstName + lastName (and no longer requires guestName).
//   2. The wire payload sends `guestDetails.firstName` and
//      `guestDetails.lastName` from the input — not from a
//      `guestName.split(" ")` reconstruction.
//   3. The old kludge lines are gone (`split(" ")[0]`,
//      `slice(1).join(" ")`, the literal "Walkin" fallback).
//   4. BookingsPage walk-in modal has firstName + lastName
//      state (not single `guestName`) and a two-column form.
//   5. CalendarPage "Create Calendar Booking" modal mirrors
//      the same pattern.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

const calendarPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/CalendarPage.tsx"),
  "utf8"
);

describe("fix/walkin-split-name — admin walk-in mirrors guest /book (decision #127)", () => {
  describe("AdminContext.addWalkinBooking — contract", () => {
    it("accepts firstName + lastName and no longer requires guestName", () => {
      // The type signature in the AdminContextValue declaration
      // and the function declaration must both express the new
      // contract. We pin the Omit on `guestName` so a future
      // refactor can't quietly re-add it.
      expect(adminContextSrc).toMatch(
        /addWalkinBooking:\s*\(\s*input:\s*Omit<Booking,\s*[^>]*"guestName"/
      );
      expect(adminContextSrc).toMatch(/firstName:\s*string;\s*lastName:\s*string/);
    });

    it("function declaration matches the new contract", () => {
      expect(adminContextSrc).toMatch(
        /const\s+addWalkinBooking\s*=\s*async\s*\(\s*input:\s*Omit<Booking,\s*[^>]*"guestName"/
      );
    });

    it("wire payload uses input.firstName + input.lastName directly (no split-on-space)", () => {
      // The wire body must reference input.firstName and
      // input.lastName, not booking.guestName.split(" ").
      const wireMatch = adminContextSrc.match(
        /body:\s*JSON\.stringify\(\s*\{[\s\S]*?guestDetails:\s*\{[\s\S]*?\}\s*,[\s\S]*?\}\s*\)/
      );
      expect(wireMatch).not.toBeNull();
      const wire = wireMatch![0];
      expect(wire).toMatch(/firstName:\s*trimmedFirst/);
      expect(wire).toMatch(/lastName:\s*trimmedLast/);
    });

    it("rejects empty firstName or lastName before the network call", () => {
      // Belt-and-suspenders: the form already requires both
      // fields, but the context itself should refuse rather
      // than send a half-empty payload.
      expect(adminContextSrc).toMatch(/First name and last name are required/);
    });

    it("old split-on-space kludge is gone", () => {
      // The exact lines we're retiring:
      //   firstName: booking.guestName.split(" ")[0] || "Guest",
      //   lastName: booking.guestName.split(" ").slice(1).join(" ") || "Walkin",
      expect(adminContextSrc).not.toMatch(/booking\.guestName\.split/);
      expect(adminContextSrc).not.toMatch(/split\(" "\)/);
      expect(adminContextSrc).not.toMatch(/"Walkin"/);
    });
  });

  describe("BookingsPage walk-in modal — form state + UI", () => {
    it("local state is firstName + lastName (not a single guestName)", () => {
      // The modal's useState declarations should reflect the
      // new shape. We check for the canonical naming pattern.
      expect(bookingsPageSrc).toMatch(/const\s+\[walkinFirstName\s*,\s*setWalkinFirstName\]\s*=\s*useState/);
      expect(bookingsPageSrc).toMatch(/const\s+\[walkinLastName\s*,\s*setWalkinLastName\]\s*=\s*useState/);
    });

    it("two-field form with given-name / family-name autoComplete hints (flex layout, mobile-stacks)", () => {
      // The walk-in modal form should render the two name
      // fields with browser-driven autocomplete hints. We use
      // a flex row (not a grid) so the Phase 11.7 "single
      // column on mobile" rule stays intact — the two fields
      // stack on phones and sit side-by-side on sm+.
      const walkinFormMatch = bookingsPageSrc.match(
        /<form\s+onSubmit=\{handleWalkinSubmit\}[\s\S]*?<\/form>/
      );
      expect(walkinFormMatch).not.toBeNull();
      const form = walkinFormMatch![0];
      expect(form).toMatch(/autoComplete="given-name"/);
      expect(form).toMatch(/autoComplete="family-name"/);
      // Flex (not grid) for the name pair — keeps the form
      // single-column on mobile.
      expect(form).toMatch(/flex\s+flex-col[^"]*sm:flex-row/);
    });

    it("submit handler validates both fields and uses firstName + lastName in the wire", () => {
      // The submit handler must check both fields and pass
      // them to addWalkinBooking, not a single guestName.
      const submitMatch = bookingsPageSrc.match(
        /const\s+handleWalkinSubmit\s*=\s*async\s*\(e:\s*React\.FormEvent\)[\s\S]*?\};\s*\n\s*const\s+selectedBookingFolio/
      );
      expect(submitMatch).not.toBeNull();
      const handler = submitMatch![0];
      expect(handler).toMatch(/trimmedFirst/);
      expect(handler).toMatch(/trimmedLast/);
      expect(handler).toMatch(/firstName:\s*trimmedFirst/);
      expect(handler).toMatch(/lastName:\s*trimmedLast/);
      // No more single guestName in the wire literal.
      expect(handler).not.toMatch(/guestName:\s*(?![\s\S]{0,40}split)/);
    });

    it("old single-input label is gone (no more 'Guest Full Name' single input)", () => {
      // The "Guest Full Name" label + single input combo is
      // retired. We assert the old phrasing is gone.
      expect(bookingsPageSrc).not.toMatch(/Guest Full Name/);
    });
  });

  describe("CalendarPage 'Create Calendar Booking' modal — same shape", () => {
    it("local state is firstName + lastName (not a single guestName)", () => {
      expect(calendarPageSrc).toMatch(/const\s+\[firstName\s*,\s*setFirstName\]\s*=\s*useState/);
      expect(calendarPageSrc).toMatch(/const\s+\[lastName\s*,\s*setLastName\]\s*=\s*useState/);
    });

    it("two-column form with given-name / family-name autoComplete hints", () => {
      const formMatch = calendarPageSrc.match(
        /<form\s+onSubmit=\{handleCreateBooking\}[\s\S]*?<\/form>/
      );
      expect(formMatch).not.toBeNull();
      const form = formMatch![0];
      expect(form).toMatch(/autoComplete="given-name"/);
      expect(form).toMatch(/autoComplete="family-name"/);
    });

    it("submit handler passes firstName + lastName to addWalkinBooking", () => {
      const submitMatch = calendarPageSrc.match(
        /const\s+handleCreateBooking\s*=\s*async\s*\(e:\s*React\.FormEvent\)[\s\S]*?\};\s*\n\s*const\s+openBookingDrawer/
      );
      expect(submitMatch).not.toBeNull();
      const handler = submitMatch![0];
      expect(handler).toMatch(/firstName:\s*trimmedFirst/);
      expect(handler).toMatch(/lastName:\s*trimmedLast/);
    });
  });
});
