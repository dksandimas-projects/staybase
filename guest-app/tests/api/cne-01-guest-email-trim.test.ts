// Per CNE-01 (2026-11-19): the client's email-notification trim.
//
// The client asked to cut the guest emails that carry no guest-
// visible news:
//
//   1. `booking-rescheduled` must NOT fire when the front desk
//      moves a booking to another PHYSICAL ROOM (same dates, same
//      room type, same price) — "it is only a backend change".
//      It still fires when the DATES, the room TYPE or the PRICE
//      changed, because those are things the guest sees or pays.
//   2. `store-order-placed` / `store-order-confirmed` /
//      `store-order-out-for-delivery` are removed outright — the
//      guest's Intercom panel shows the live order tracker.
//   3. `store-order-delivered` is FIXED: the template + the route
//      existed since W4.4 but no code path ever sent it.
//   4. The "Late served — please rate" breakfast email is removed.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md §Testing`):
// the reschedule handler's transaction body is ~1,000 lines deep,
// so a behavioural fixture for the guest-visible-change gate
// would be a brittle re-implementation of the handler. The
// RUNTIME contract for the resend route is pinned at
// `rsq-01-reschedule-email-resend.test.ts`.
//
// The behavioural pins that DO live here are the two store-order
// ones (the handler + the template map), because those are
// small, deterministic surfaces.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const bookingsSrc = read("guest-app/server/handlers/bookings.ts");
const storeSrc = read("guest-app/server/handlers/store.ts");
const emailSrc = read("guest-app/server/handlers/email.ts");
const apiRouterSrc = read("guest-app/server/apiRouter.ts");
const settingsSrc = read("admin-app/src/pages/SettingsPage.tsx");
const markServedSrc = read("guest-app/server/handlers/breakfast-mark-served.ts");

function sliceHandler(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 10);
  return src.slice(start, next < 0 ? src.length : next);
}

const reschedule = sliceHandler(bookingsSrc, "handleRescheduleBooking");

describe("CNE-01 — the guest email trim", () => {
  describe("1. the reschedule email fires only on a GUEST-VISIBLE change", () => {
    it("the gate is computed inside the transaction from the PRE-move booking", () => {
      // The gate needs three things the transaction already
      // has: the booking as it was, the target room, and the
      // new total. A pre-read outside the transaction would race
      // the commit.
      expect(reschedule).toMatch(/let guestVisibleChange = false;/);
      expect(reschedule).toMatch(
        /guestVisibleChange = \(\(\) => \{[\s\S]{0,600}?booking\.checkIn[\s\S]{0,400}?booking\.roomType[\s\S]{0,400}?finalTotalPrice[\s\S]{0,200}?\}\)\(\);/
      );
    });

    it("the gate compares the DATES, the room TYPE and the PRICE", () => {
      expect(reschedule).toMatch(/const datesChanged =/);
      expect(reschedule).toMatch(/const roomTypeChanged =/);
      expect(reschedule).toMatch(/const priceChanged =/);
      expect(reschedule).toMatch(/return datesChanged \|\| roomTypeChanged \|\| priceChanged;/);
    });

    it("the email send is gated on the flag", () => {
      // A room-number-only move must be SILENT — that is the
      // whole point of the client's request.
      expect(reschedule).toMatch(/if \(fullBookingForEmail && guestVisibleChange\) \{/);
    });

    it("the room NUMBER is deliberately NOT part of the gate", () => {
      // The guest email never renders the room number (the
      // room-number-visibility rule), so a number change is
      // invisible to the guest — which is exactly why the
      // client called it "only a backend change".
      expect(reschedule).not.toMatch(/guestVisibleChange =[^;]*roomNumber/);
    });
  });

  describe("2. the three store-order emails are gone", () => {
    it("no handler sends them", () => {
      for (const action of [
        "store-order-placed",
        "store-order-confirmed",
        "store-order-out-for-delivery"
      ]) {
        expect(storeSrc, `expected no send of ${action}`).not.toMatch(
          new RegExp(`sendStoreOrderTrigger\\(\\s*["']${action}["']`)
        );
      }
    });

    it("the action names are gone from the EmailAction union + the trigger map", () => {
      for (const action of [
        "store-order-placed",
        "store-order-confirmed",
        "store-order-out-for-delivery"
      ]) {
        expect(emailSrc, `expected ${action} to be removed from email.ts`).not.toMatch(
          new RegExp(`["']${action}["']`)
        );
      }
    });

    it("the router no longer accepts them (no staff resend route)", () => {
      for (const action of [
        "store-order-placed",
        "store-order-confirmed",
        "store-order-out-for-delivery"
      ]) {
        expect(apiRouterSrc, `expected ${action} to be removed from the allowlists`).not.toMatch(
          new RegExp(`"${action}"`)
        );
      }
    });

    it("the Settings catalog no longer advertises them", () => {
      for (const action of [
        "store-order-placed",
        "store-order-confirmed",
        "store-order-out-for-delivery"
      ]) {
        expect(settingsSrc, `expected ${action} to be removed from the catalog`).not.toMatch(
          new RegExp(`action:\\s*"${action}"`)
        );
      }
    });
  });

  describe("3. `store-order-delivered` now fires", () => {
    it("the delivery handler sends it", () => {
      // The fix: the template + the route existed since W4.4 but
      // NO code path ever sent it — "your order has arrived" was
      // dead code.
      expect(storeSrc).toMatch(
        /sendStoreOrderTrigger\(\s*["']store-order-delivered["']/
      );
    });

    it("it fires EXACTLY ONCE per delivery (not on an idempotent replay)", () => {
      // The handler's early-return branch answers an
      // already-delivered order without performing the
      // transition. The `justDelivered` flag is set only on the
      // real transition, so a retry does not re-send.
      expect(storeSrc).toMatch(/let justDelivered = false;/);
      expect(storeSrc).toMatch(/justDelivered = true;/);
      expect(storeSrc).toMatch(/justDelivered && responseData\.orderId/);
    });

    it("the guest email comes from the LINKED BOOKING", () => {
      // The order doc carries a `bookingId`; the guest's address
      // is on the booking. Same lookup the other store triggers
      // used.
      expect(storeSrc).toMatch(
        /collection\(["']bookings["']\)\.doc\(order\.bookingId\)\.get\(\)/
      );
    });

    it("the template + the action survive", () => {
      expect(emailSrc).toMatch(/function\s+storeOrderDeliveredEmail\b/);
      expect(emailSrc).toMatch(/["']store-order-delivered["']/);
    });
  });

  describe("4. the late-served breakfast email is gone", () => {
    it("the trigger + the template are removed", () => {
      expect(emailSrc).not.toMatch(/function\s+lateServedEmail\b/);
      expect(emailSrc).not.toMatch(/export\s+(?:async\s+)?function\s+sendLateServedTrigger\b/);
    });

    it("the mark-served handler no longer calls it", () => {
      expect(markServedSrc).not.toMatch(/sendLateServedTrigger/);
    });

    it("the OPERATIONAL half survives — the detector + the audit flag", () => {
      // The kitchen list (BR-07) reads the audit doc's
      // `occurredAfterCutoff` flag; that must keep working.
      expect(markServedSrc).toMatch(/computeBreakfastCutoffState/);
      expect(markServedSrc).toMatch(/reasonOrCutoff:\s*isLateServe/);
    });
  });
});
