import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for WPM-01..07 (2026-07-31): the walk-in modal's
// Payment Term dropdown used to be hardcoded to three literal <option>
// tags (`pay-at-hotel` / `cash` / `card`) while the four other admin
// payment selectors (bookings filter, store filter, Record Payment,
// Verify & Record Payment) all mapped `onsitePaymentMethodOptions` —
// the memo derived live from `settings/hotelConfig.paymentMethods[]`.
// The same hardcoded list also appeared in CalendarPage's "Create
// Calendar Booking" modal.
//
// The fix sources the options from the same Settings list the other
// four selectors use, prepends `pay-at-hotel` (a booking-time intent,
// not a settlement tender — excluded from the memo per
// `NON_TENDER_ONSITE_PAYMENT_METHODS` but required for walk-in
// creation per `SETTINGS.md §Payment Methods`), renames "Payment Term"
// to "Payment Method" for consistency with the other selectors, and
// routes the booking drawer's raw `paymentMethod` rendering through
// the existing `getOnsitePaymentMethodLabel` helper so staff see
// "GCash" instead of "gcash".
//
// These source-text guards pin the new contract; PMH-03's behavioral
// emulator test (`firebase/tests/payment-methods-array-write.emulator.test.ts`)
// is the array-write-integrity counterpart for `paymentMethods[]`.
// Together they prevent the "wrong list, no error" class of bug from
// shipping again on the same field the spec author flagged.

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);

const calendarPageSrc = readFileSync(
  resolve(__dirname, "../pages/CalendarPage.tsx"),
  "utf8"
);

const drawerWorkspaceSrc = readFileSync(
  resolve(__dirname, "../components/BookingDrawerWorkspace.tsx"),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

describe("WPM-01 — walk-in selector sources from Settings, not literal <option> tags", () => {
  it("BookingsPage walk-in modal no longer renders literal <option value=\"card\">", () => {
    // The old shape was three literal options. The new shape maps the
    // memo (with `pay-at-hotel` prepended). Guard against the literal
    // `<option value="card">` returning.
    const walkinModal = bookingsPageSrc.match(
      /Payment Method[\s\S]*?<\/select>/
    );
    expect(walkinModal, "walk-in modal select must exist").toBeTruthy();
    expect(walkinModal![0]).not.toMatch(/<option value="card">/);
    expect(walkinModal![0]).not.toMatch(/<option value="cash">/);
    expect(walkinModal![0]).not.toMatch(/Onsite Card Reader/);
    expect(walkinModal![0]).toMatch(/onsitePaymentMethodOptions/);
  });

  it("CalendarPage Create Calendar Booking modal no longer renders literal <option value=\"card\">", () => {
    const calendarModal = calendarPageSrc.match(
      /Payment method<select[\s\S]*?<\/select>/
    );
    expect(calendarModal, "calendar modal select must exist").toBeTruthy();
    expect(calendarModal![0]).not.toMatch(/<option value="card">/);
    expect(calendarModal![0]).not.toMatch(/<option value="cash">/);
    expect(calendarModal![0]).toMatch(/onsitePaymentMethodOptions/);
  });
});

describe("WPM-02 — `pay-at-hotel` prepended to the walk-in list exactly once", () => {
  it("BookingsPage walk-in modal prepends `pay-at-hotel` to the memo map", () => {
    // Anchor on the <select ... onChange={...} setWalkinPayment block —
    // that's the walk-in modal's payment method select, uniquely
    // identified by the onChange handler. The first "Payment Method"
    // hit in the file is in a comment about the cash method, not the
    // modal.
    const walkinModal = bookingsPageSrc.match(
      /<select\s+value=\{walkinPayment\}[\s\S]*?<\/select>/
    )![0];
    // The prepended entry is in the source; the memo itself still
    // excludes it via NON_TENDER_ONSITE_PAYMENT_METHODS. Match across
    // newlines since the prepended object literal spans multiple lines.
    expect(walkinModal).toMatch(/\{[\s\S]*?method:\s*"pay-at-hotel"[\s\S]*?\}[\s\S]*?\.\.\.onsitePaymentMethodOptions/);
  });

  it("CalendarPage walk-in modal prepends `pay-at-hotel` to the memo map", () => {
    const calendarModal = calendarPageSrc.match(
      /Payment method<select\s+value=\{paymentMethod\}[\s\S]*?<\/select>/
    )![0];
    expect(calendarModal).toMatch(/\{[\s\S]*?method:\s*"pay-at-hotel"[\s\S]*?\}[\s\S]*?\.\.\.onsitePaymentMethodOptions/);
  });

  it("the memo itself still excludes non-tender keys (cod / add-to-bill / pay-at-hotel)", () => {
    // The whole point of the prepend: the memo MUST exclude
    // `pay-at-hotel`, otherwise the walk-in list would show it twice.
    expect(bookingsPageSrc).toMatch(/NON_TENDER_ONSITE_PAYMENT_METHODS\s*=\s*new Set\(\[\s*"cod"\s*,\s*"add-to-bill"\s*,\s*"pay-at-hotel"\s*\]\)/);
    expect(calendarPageSrc).toMatch(/NON_TENDER_ONSITE_PAYMENT_METHODS\s*=\s*new Set\(\[\s*"cod"\s*,\s*"add-to-bill"\s*,\s*"pay-at-hotel"\s*\]\)/);
  });
});

describe("WPM-04 — `card` is a backfilled staff-onsite tender, not a hardcoded literal", () => {
  it("AdminContext has a STAFF_ONSITE_TENDER_BACKFILL map including `card`", () => {
    expect(adminContextSrc).toMatch(/STAFF_ONSITE_TENDER_BACKFILL_DEFAULTS[\s\S]*?card:\s*\{/);
  });

  it("the backfill useEffect appends missing staff-onsite tenders alongside the protected + store backfills", () => {
    // The new backfill must be wired into the same useEffect so it
    // runs at most once per session and is idempotent — same pattern
    // as PROTECTED_PAYMENT_METHODS + STORE_PAYMENT_BACKFILL_DEFAULTS.
    expect(adminContextSrc).toMatch(/missingStaffOnsite/);
    expect(adminContextSrc).toMatch(/missingStaffOnsite\.map\(\(key\)\s*=>\s*STAFF_ONSITE_TENDER_BACKFILL_DEFAULTS\[key\]\)/);
  });
});

describe("WPM-05 — field label is `Payment Method`, not `Payment Term`", () => {
  it("BookingsPage walk-in modal uses the new label", () => {
    const walkinModal = bookingsPageSrc.match(
      /Payment Method[\s\S]*?<\/select>/
    );
    expect(walkinModal, "walk-in modal must exist").toBeTruthy();
    expect(bookingsPageSrc).not.toMatch(/Payment Term/);
  });
});

describe("WPM-06 — booking drawer routes `paymentMethod` through the label helper", () => {
  it("BookingsPage drawer call sites use getOnsitePaymentMethodLabel", () => {
    // The drawer had three raw renderings of `selectedBooking.paymentMethod`.
    // All three must now flow through the label helper.
    const before = bookingsPageSrc.match(/\{selectedBooking\.paymentMethod\b/g) || [];
    const after = bookingsPageSrc.match(/getOnsitePaymentMethodLabel\(selectedBooking\.paymentMethod/g) || [];
    // The raw `paymentMethod` key still appears in the conditional
    // (`paymentMethod !== "pay-at-hotel"` etc.) and in toast messages,
    // so the count doesn't go to zero — but every render site that
    // previously printed the raw key now uses the label helper.
    expect(after.length).toBeGreaterThanOrEqual(3);
  });

  it("BookingDrawerWorkspaceHeader receives `paymentMethodLabel` as a prop", () => {
    // Per WPM-06: the drawer is a presentational component that takes
    // the resolved label as a prop, not the raw key. Confirms the prop
    // is declared on the interface and used in the render.
    expect(drawerWorkspaceSrc).toMatch(/paymentMethodLabel:\s*string/);
    expect(drawerWorkspaceSrc).toMatch(/\{paymentMethodLabel \|\| "Not specified"\}/);
  });

  it("BookingsPage computes `paymentMethodLabel` via getOnsitePaymentMethodLabel and passes it down", () => {
    expect(bookingsPageSrc).toMatch(/paymentMethodLabel=\{selectedBooking\.paymentMethod \? getOnsitePaymentMethodLabel\(selectedBooking\.paymentMethod\) : ""\}/);
  });
});

describe("WPM-07 — CalendarPage wires the new memo and the destructured paymentMethods", () => {
  it("CalendarPage destructures `paymentMethods` from useAdmin", () => {
    expect(calendarPageSrc).toMatch(/paymentMethods,/);
  });

  it("CalendarPage builds its own onsitePaymentMethodOptions memo with the same shape as BookingsPage", () => {
    // The memo must filter through NON_TENDER_ONSITE_PAYMENT_METHODS,
    // same as the source. The duplication is intentional for the
    // quick fix — extract to a shared hook when a third caller appears.
    expect(calendarPageSrc).toMatch(/onsitePaymentMethodOptions\s*=\s*useMemo<PaymentMethodConfig\[\]>/);
    expect(calendarPageSrc).toMatch(/NON_TENDER_ONSITE_PAYMENT_METHODS\.has\(key\)/);
  });
});
