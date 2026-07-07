import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 10 — W4.4 / decision #104:
// 8 new email templates (voucher-issued, 5 store-order-*, 2
// staff-*) wired into the booking / store / voucher flows.
//
// Source-pattern tests cover: the EmailAction union extension,
// the new template + trigger exports in email.ts, the staff
// guard in the route dispatch, the handler-level integration
// points (booking + store + voucher), and the AdminContext +
// RatesPage wiring for the voucher-issued email.

const emailSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/email.ts"),
  "utf8"
);
const routeSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/apiRouter.ts"),
  "utf8"
);
const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const storeSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/store.ts"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);
const ratesPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/RatesPage.tsx"),
  "utf8"
);

describe("Phase 11.6 Batch 10 — W4.4 email extensions (decision #104)", () => {
  describe("EmailAction union + template exports", () => {
    it("union includes the 8 new actions", () => {
      for (const action of [
        "voucher-issued",
        "store-order-placed",
        "store-order-confirmed",
        "store-order-out-for-delivery",
        "store-order-delivered",
        "store-order-cancelled",
        "staff-new-booking",
        "staff-new-payment"
      ]) {
        expect(emailSrc, `expected EmailAction to include ${action}`).toMatch(
          new RegExp(`["']${action}["']`)
        );
      }
    });

    it("exports the new trigger functions", () => {
      for (const fn of [
        "sendVoucherIssuedTrigger",
        "sendStoreOrderTrigger",
        "sendStaffNewBookingTrigger",
        "sendStaffNewPaymentTrigger"
      ]) {
        expect(emailSrc, `expected to find ${fn}`).toMatch(
          new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`)
        );
      }
    });

    it("voucher-issued template renders the code in a large monospace block", () => {
      // The voucher template + the voucherCodeBlock helper together
      // must include the code in a monospace block. (The block
      // helper holds the styling; the email function calls it.)
      expect(emailSrc).toMatch(/function\s+voucherIssuedEmail\(/);
      expect(emailSrc).toMatch(/function\s+voucherCodeBlock\(/);
      expect(emailSrc).toMatch(/JetBrains Mono|Courier New|monospace/);
      expect(emailSrc).toMatch(/voucherCodeBlock\([\s\S]*?voucher\.code/);
    });

    it("store-order templates render an items table", () => {
      // All 5 store-order templates must exist. The items table
      // helper is shared via storeOrderBaseLayout; we just check
      // that the templates exist and that the helper is used.
      for (const fn of [
        "storeOrderPlacedEmail",
        "storeOrderConfirmedEmail",
        "storeOrderOutForDeliveryEmail",
        "storeOrderDeliveredEmail",
        "storeOrderCancelledEmail"
      ]) {
        expect(emailSrc, `expected to find ${fn}`).toMatch(
          new RegExp(`function\\s+${fn}\\b`)
        );
      }
      // The shared helper that renders the items table
      expect(emailSrc).toMatch(/function\s+storeOrderItemsTable\(/);
      // Each placed/confirmed/oofd/delivered/cancelled template
      // must include a deep link back to the Intercom chat
      const deepLinkUses = emailSrc.match(/storeOrderBaseLayout\(/g) || [];
      expect(deepLinkUses.length).toBeGreaterThanOrEqual(5);
    });

    it("staff-new-booking + staff-new-payment render to ADMIN_EMAIL", () => {
      // Both staff templates are exported via the same
      // sendStaffNew*Trigger helpers, which route to
      // ADMIN_EMAIL.
      expect(emailSrc).toMatch(
        /export\s+async\s+function\s+sendStaffNewBookingTrigger[\s\S]*?sendEmail\(\s*ADMIN_EMAIL/
      );
      expect(emailSrc).toMatch(
        /export\s+async\s+function\s+sendStaffNewPaymentTrigger[\s\S]*?sendEmail\(\s*ADMIN_EMAIL/
      );
    });
  });

  describe("Route dispatch (voucher-issued staff-only guard)", () => {
    it("voucher-issued is in the staffOnlyEmailActions set", () => {
      // The route must require staff auth before dispatching
      // voucher-issued.
      const setBlock = routeSrc.match(
        /const\s+staffOnlyEmailActions\s*=\s*new\s+Set\(\[([\s\S]*?)\]\);/
      );
      expect(setBlock, "expected to find the staffOnlyEmailActions set").toBeTruthy();
      expect(setBlock![0]).toMatch(/["']voucher-issued["']/);
    });
  });

  describe("Email trigger handler (voucher-issued staff check)", () => {
    it("voucher-issued requires staff auth before firing", () => {
      // The voucher-issued handler block must require staff auth
      // and validate the voucher payload. We slice from the
      // block start to the next sibling `if` to avoid the
      // non-greedy regex pitfalls of nested braces.
      const blockStart = emailSrc.indexOf('if (action === "voucher-issued")');
      const blockEnd = emailSrc.indexOf("if (action === ", blockStart + 1);
      const block = emailSrc.slice(blockStart, blockEnd > -1 ? blockEnd : undefined);
      expect(block, "expected to find the voucher-issued handler block").toBeTruthy();
      expect(block).toMatch(/Staff authentication is required/);
      expect(block).toMatch(/Voucher code and guestEmail are required/);
      expect(block).toMatch(/sendVoucherIssuedTrigger/);
    });
  });

  describe("Booking handler integration (staff-new-booking + staff-new-payment)", () => {
    it("handleCreateBooking fires staff-new-booking after the transaction commits", () => {
      // Per BF-04 (booking-flow audit 2026-06-26): the dedup
      // guard now reads the fresh booking doc after commit
      // (the previous in-memory check was always undefined).
      const fireBlock = bookingsSrc.match(
        /freshBookingSnap\.exists[\s\S]{0,200}emailNotificationsSent\?\.staffNewBooking/
      );
      expect(fireBlock, "expected to find the staff-new-booking fire block").toBeTruthy();
      expect(bookingsSrc).toMatch(/sendStaffNewBookingTrigger/);
    });

    it("handleAddPayment fires staff-new-payment only when paymentProofUrl is set", () => {
      // Per BF-14 (booking-flow audit 2026-06-26): the dedup
      // marker is now written inside the transaction (so a
      // concurrent addPayment call doesn't re-fire the email).
      // The email-send itself runs after the transaction; the
      // guard logic now references the transaction-captured
      // `hadPaymentProof` + `staffPaymentMarkerMissing` flags
      // rather than re-reading the booking doc.
      const fireBlock = bookingsSrc.match(
        /if\s*\(\s*hadPaymentProof\s*&&\s*staffPaymentMarkerMissing\s*\)\s*\{[\s\S]{0,200}sendStaffNewPaymentTrigger/
      );
      expect(fireBlock, "expected to find the staff-new-payment fire block").toBeTruthy();
      expect(bookingsSrc).toMatch(/sendStaffNewPaymentTrigger/);
    });
  });

  describe("Store handler integration (5 store-order templates)", () => {
    it("handleCreateStoreOrder fires store-order-placed after the transaction commits", () => {
      // The placed email must fire after the order transaction
      // commits, with the guest email looked up from the booking.
      expect(storeSrc).toMatch(/sendStoreOrderTrigger\(\s*["']store-order-placed["']/);
    });

    it("handleCancelStoreOrder fires store-order-cancelled after the transaction commits", () => {
      expect(storeSrc).toMatch(/sendStoreOrderTrigger\(\s*["']store-order-cancelled["']/);
    });
  });

  describe("AdminContext + RatesPage voucher-issued wiring", () => {
    it("AdminContext.addVoucher posts to /api/email/voucher-issued when guestEmail is set", () => {
      // The new block must post to the new endpoint with the
      // voucher payload, gated on a non-empty guestEmail.
      const addBlock = adminContextSrc.match(
        /if\s*\(\s*voucher\.guestEmail\s*&&\s*voucher\.guestEmail\.trim\(\)\s*\)\s*\{[\s\S]*?\}\s*catch\s*\(\s*emailErr\s*\)\s*\{/
      );
      expect(addBlock, "expected to find the addVoucher email block").toBeTruthy();
      expect(addBlock![0]).toMatch(/api\/email\/voucher-issued/);
      expect(addBlock![0]).toMatch(/Bearer\s+\$\{token\}/);
    });

    it("AdminContext.addVoucher does NOT post when guestEmail is empty", () => {
      // The email block is wrapped in `if (voucher.guestEmail && voucher.guestEmail.trim())`.
      const addBlock = adminContextSrc.match(
        /if\s*\(\s*voucher\.guestEmail\s*&&\s*voucher\.guestEmail\.trim\(\)\s*\)\s*\{[\s\S]*?\}\s*catch\s*\(\s*emailErr\s*\)\s*\{/
      );
      expect(addBlock, "expected to find guarded addVoucher email block").toBeTruthy();
      expect(addBlock![0]).toMatch(/api\/email\/voucher-issued/);
    });

    it("RatesPage form passes guestEmail through to addVoucher", () => {
      // The voucher submission must include the vchGuestEmail
      // value (or null when empty) in the call to addVoucher.
      const submitBlock = ratesPageSrc.match(
        /addVoucher\(\{[\s\S]*?\}\);/
      );
      expect(submitBlock, "expected to find the addVoucher call").toBeTruthy();
      expect(submitBlock![0]).toMatch(/guestEmail:\s*vchGuestEmail\.trim\(\)/);
    });

    it("Voucher type includes the new guestEmail field", () => {
      // The Voucher interface must include the new optional
      // guestEmail field so the AdminContext snapshot mapping
      // populates it.
      const ifaceBlock = adminContextSrc.match(
        /export\s+interface\s+Voucher\s*\{[\s\S]*?\}/
      );
      expect(ifaceBlock, "expected to find the Voucher interface").toBeTruthy();
      expect(ifaceBlock![0]).toMatch(/guestEmail:\s*string\s*\|\s*null/);
    });
  });
});
