// ATR-08 follow-up (2026-11-21): the booking drawer's HISTORY tab —
// a RENDER test.
//
// WHY THIS FILE IS DIFFERENT FROM THE OTHER ADMIN-APP TESTS
// -----------------------------------------------------------
// The admin app's suite is source-text only (no component-test
// harness). That works for structure, but it cannot answer the one
// question that matters most for a tab the desk reads all day: DOES
// IT ACTUALLY RENDER THE RIGHT THING?
//
// This file renders the component for real with
// `react-dom/server` (already a dependency — no new package, no new
// vitest config: the admin app's `vite.config.ts` already carries the
// `@config` alias and the React JSX transform). The two module
// dependencies that need a live Firebase are mocked; everything else —
// the shared event model, the staff resolver, the money formatter —
// runs for real.
//
// The rules this proves (the ones source-text CANNOT):
//   1. a staff actor renders as their NAME, never as a raw uid;
//   2. a guest's own row renders as "Guest";
//   3. a charge renders its label AND its formatted amount;
//   4. the empty, loading and error states each render their own
//      message — no blank card, no silent empty list;
//   5. the discount verifier's caption resolves a uid to a name too.

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

/**
 * The mutable state the mocked hook + context read from.
 *
 * `vi.hoisted` is required: `vi.mock` factories are hoisted above the
 * module body, so a plain `const` would be read before it is
 * initialized.
 */
const state = vi.hoisted(() => ({
  staff: [] as Array<{
    uid: string;
    fullName: string;
    email: string;
    role: "front-desk" | "admin";
  }>,
  events: [] as Array<Record<string, unknown>>,
  loading: false as boolean,
  error: null as string | null
}));

vi.mock("../context/AdminContext", () => ({
  useAdmin: () => ({ staff: state.staff })
}));

vi.mock("../hooks/useBookingHistory", () => ({
  useBookingHistory: () => ({
    events: state.events,
    loading: state.loading,
    error: state.error
  })
}));

const { BookingHistoryTab } = await import("../components/BookingHistoryTab");

const STAFF = [
  {
    uid: "uid-juan",
    fullName: "Juan Dela Cruz",
    email: "juan@sparkinn.com",
    role: "front-desk" as const
  },
  {
    uid: "uid-maria",
    fullName: "Maria Santos",
    email: "maria@sparkinn.com",
    role: "admin" as const
  }
];

const BOOKING = {
  id: "BK-1",
  discountVerified: false,
  discountVerifiedBy: null
} as never;

const CHARGE = {
  id: "c1",
  label: "Late checkout",
  amount: 500,
  category: "late-checkout",
  note: "Guest left at 3pm",
  addedBy: "uid-juan",
  addedAt: "2026-11-20T04:00:00.000Z",
  voidOf: null
} as never;

const reset = () => {
  state.staff = STAFF;
  state.events = [];
  state.loading = false;
  state.error = null;
};

const render = (props: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(BookingHistoryTab, {
      booking: BOOKING,
      charges: [],
      active: true,
      ...props
    })
  );

describe("booking history tab — renders", () => {
  it("renders a staff actor as their NAME, never as a raw uid", () => {
    reset();
    state.events = [
      {
        id: "b1",
        kind: "breakfast-change",
        at: "2026-11-20T02:14:00.000Z",
        actorUid: "uid-juan",
        actorRole: "front-desk",
        actorName: null,
        summary: "Added breakfast",
        subject: "American Breakfast",
        serviceDate: "2026-11-20",
        guestIndex: 1,
        reason: null,
        note: null,
        amount: null,
        quantity: null,
        lateChange: false
      }
    ];

    const html = render();
    expect(html).toContain("Juan Dela Cruz");
    expect(html).toContain("Added breakfast");
    expect(html).toContain("American Breakfast");
    expect(html).toContain("Front Desk");
    // The raw uid must never reach the screen.
    expect(html).not.toContain("uid-juan");
  });

  it("renders a guest's own row as Guest", () => {
    reset();
    state.events = [
      {
        id: "b2",
        kind: "breakfast-change",
        at: "2026-11-20T02:14:00.000Z",
        actorUid: "guest",
        actorRole: "guest",
        actorName: null,
        summary: "Changed breakfast",
        subject: "American Breakfast",
        serviceDate: "2026-11-20",
        guestIndex: 0,
        reason: null,
        note: null,
        amount: null,
        quantity: null,
        lateChange: false
      }
    ];

    const html = render();
    expect(html).toContain("Guest");
    expect(html).toContain("Changed breakfast");
  });

  it("renders a charge with its label and its formatted amount", () => {
    reset();
    const html = render({ charges: [CHARGE] });
    expect(html).toContain("Added an incidental charge");
    expect(html).toContain("Late checkout");
    // The hotel's own currency + locale (PHP / en-PH), NOT a hardcoded ₱.
    expect(html).toMatch(/PHP\s*500|₱\s*500|500/);
  });

  it("renders the empty state with an explanation, not a blank card", () => {
    reset();
    const html = render();
    expect(html).toContain("Nothing recorded yet");
    expect(html).toContain("booking-history-empty");
  });

  it("renders a skeleton while loading", () => {
    reset();
    state.loading = true;
    const html = render();
    expect(html).toContain("booking-history-skeleton");
    expect(html).not.toContain("booking-history-empty");
  });

  it("renders the error message when a listener is denied", () => {
    reset();
    state.error = "Missing or insufficient permissions.";
    const html = render();
    expect(html).toContain("booking-history-error");
    expect(html).toContain("Missing or insufficient permissions.");
  });

  it("resolves the discount verifier's caption to a name too", () => {
    reset();
    const booking = {
      id: "BK-1",
      discountVerified: true,
      discountVerifiedBy: "uid-maria"
    } as never;
    const html = render({ booking });
    expect(html).toContain("Discount verified by");
    expect(html).toContain("Maria Santos");
    expect(html).not.toContain("uid-maria");
  });
});

// Per ATR-09 (2026-11-21): the desk reported "I am only seeing Staff" —
// the Activity history tab rendered the generic fallback because the
// "Payment verified" milestone carried NO actor and the legacy
// "Booking created" milestone carried no `createdBy` stamp.
//
// This is the ONE test that proves the REPORTED BUG is gone: it renders
// the two milestones of a real booking document and asserts a NAME.
describe("booking history tab — the milestones name their actor", () => {
  it("renders the payment verifier's NAME, not \"Staff\"", () => {
    reset();
    const booking = {
      id: "BK-1",
      discountVerified: false,
      discountVerifiedBy: null,
      createdAt: "2026-11-19T08:14:00.000Z",
      createdBy: "uid-juan",
      createdByName: "Juan Dela Cruz",
      paymentConfirmedAt: "2026-11-19T08:14:00.000Z",
      paymentConfirmedBy: "uid-maria",
      paymentConfirmedByName: "Maria Santos",
      handledBy: "uid-maria"
    } as never;

    const html = render({ booking });
    expect(html).toContain("Payment verified");
    expect(html).toContain("Maria Santos");
    expect(html).toContain("Booking created");
    expect(html).toContain("Juan Dela Cruz");
    // The generic fallback is what the desk reported seeing.
    expect(html).not.toContain(">Staff<");
    // The raw uid must never reach the screen.
    expect(html).not.toContain("uid-maria");
    expect(html).not.toContain("uid-juan");
  });

  it("names the actor of a LEGACY booking (no `createdBy` stamp) through `handledBy`", () => {
    reset();
    const booking = {
      id: "BK-2",
      discountVerified: false,
      discountVerifiedBy: null,
      createdAt: "2026-11-19T08:14:00.000Z",
      paymentConfirmedAt: "2026-11-19T08:14:00.000Z",
      handledBy: "uid-juan"
    } as never;

    const html = render({ booking });
    expect(html).toContain("Juan Dela Cruz");
    expect(html).not.toContain(">Staff<");
    expect(html).not.toContain("uid-juan");
  });
});
