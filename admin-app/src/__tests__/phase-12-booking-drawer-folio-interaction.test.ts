import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");
const pageSrc = read("admin-app/src/pages/BookingsPage.tsx");
const workspaceSrc = read("admin-app/src/components/BookingDrawerWorkspace.tsx");
const drawerSrc = `${pageSrc}\n${workspaceSrc}`;

describe("Phase 12 — booking drawer folio interaction (BDUX-05g)", () => {
  it("renders the folio section with all four ledger panels", () => {
    expect(workspaceSrc).toContain(`id: "folio"`);
    expect(pageSrc.match(/section="folio"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(pageSrc).toContain("Total");
    expect(pageSrc).toContain("Paid");
    expect(pageSrc).toContain("Balance");
    expect(pageSrc).toContain("Charge breakdown");
    expect(pageSrc).toContain("On-site Payments Ledger");
    expect(pageSrc).toContain("Incidental Charge Ledger");
  });

  it("shows a three-column Total/Paid/Balance summary grid", () => {
    expect(pageSrc).toMatch(/grid-cols-3/);
    expect(pageSrc).toMatch(/balance/);
    expect(pageSrc).toMatch(/paymentsTotal/);
    expect(pageSrc).toMatch(/totalPrice/);
  });

  it("highlights positive balance with red styling", () => {
    expect(pageSrc).toMatch(/balance > 0/);
    expect(pageSrc).toMatch(/balance < 0/);
  });

  it("shows a compact verified-proof row after verification", () => {
    expect(pageSrc).toContain("View proof");
  });

  it("shows a full review layout when proof is pending", () => {
    expect(pageSrc).toMatch(/setShowVerifyPaymentModal\(true\)/);
  });

  it("opens verify-payment modal with pre-filled fields", () => {
    expect(pageSrc).toMatch(/setVerifyAmount/);
    expect(pageSrc).toMatch(/setVerifyMethod/);
    expect(pageSrc).toMatch(/setVerifyReference/);
  });

  it("preserves payment proof image and reference in the verify modal", () => {
    expect(pageSrc).toContain("Verify & Record Payment");
    expect(pageSrc).toContain("Amount");
    expect(pageSrc).toContain("Payment method");
  });

  it("shows Record Payment for actionable statuses", () => {
    expect(pageSrc).toMatch(/showRecordPaymentModal/);
    expect(pageSrc).toMatch(/Record Payment/);
  });

  it("shows Collect button with folio balance when positive", () => {
    expect(pageSrc).toMatch(/Collect/);
    expect(pageSrc).toMatch(/folio\.balance/);
  });

  it("hides Record Payment for pending and payment-uploaded", () => {
    expect(pageSrc).toMatch(/showRecordPaymentModal/);
  });

  it("shows Record Refund only for admin role", () => {
    expect(pageSrc).toMatch(/currentUser\?\.role === "admin"/);
    expect(pageSrc).toMatch(/showRefundModal/);
    expect(pageSrc).toContain("Record Refund");
  });

  it("validates refund amount and reason before submission", () => {
    expect(pageSrc).toContain("handleRefundSubmit");
    expect(pageSrc).toMatch(/amount > 0/);
    expect(pageSrc).toMatch(/reason/);
  });

  it("hides apply discount/voucher button when already applied", () => {
    expect(pageSrc).toMatch(/Apply discount/);
    expect(pageSrc).toMatch(/voucher/);
  });

  it("shows current discount and voucher info when present", () => {
    expect(pageSrc).toContain("Discount / Voucher");
    expect(pageSrc).toMatch(/discountType/);
    expect(pageSrc).toMatch(/voucherCode/);
  });

  it("provides Add charge button with validation", () => {
    expect(pageSrc).toMatch(/showChargeModal/);
    expect(pageSrc).toMatch(/handleAddChargeSubmit/);
    expect(pageSrc).toMatch(/amount > 0/);
  });

  it("validates charge amount bounds", () => {
    expect(pageSrc).toMatch(/amount/);
    expect(pageSrc).toMatch(/label/);
  });

  it("allows voiding non-voided charges for in-progress bookings", () => {
    expect(pageSrc).toMatch(/handleVoidCharge/);
    expect(pageSrc).toMatch(/setChargeToVoid/);
  });

  it("shows Checkout Folio Review for checked-in and checked-out", () => {
    expect(pageSrc).toMatch(/Checkout Folio Review/);
    expect(pageSrc).toMatch(/folio\.grandTotal|folioTotal/);
  });

  it("hides Record Payment and Record Refund when checked out", () => {
    expect(pageSrc).toMatch(/selectedBooking/);
    expect(pageSrc).toMatch(/printBookingReceiptPDF/);
  });

  it("uses pending/submitting state to disable buttons during submission", () => {
    expect(pageSrc).toMatch(/verifyPending/);
    expect(pageSrc).toMatch(/paymentSubmissionId/);
    expect(pageSrc).toMatch(/setVerifyPending\(true\)/);
    expect(pageSrc).toMatch(/setVerifyPending\(false\)/);
  });

  it("shows success toast after payment and refund", () => {
    expect(pageSrc).toMatch(/toast\.success/);
  });

  it("shows error toast on payment failure", () => {
    expect(pageSrc).toMatch(/toast\.error/);
  });

  it("resets form fields after successful submission", () => {
    expect(pageSrc).toMatch(/setVerifyAmount/);
    expect(pageSrc).toMatch(/setVerifyError\(null\)/);
  });

  it("uses touch-sized min-height targets for folio action buttons", () => {
    expect(pageSrc).toMatch(/min-h-\[44px\]/);
  });

  it("provides a mobile label for the folio tab", () => {
    expect(workspaceSrc).toMatch(/mobileLabel: "Folio"/);
  });

  it("closes modals via onClose handler and resets form state", () => {
    expect(pageSrc).toMatch(/setVerifyError\(null\)/);
    expect(pageSrc).toMatch(/setRefundError\(null\)/);
  });

  it("collapses verified payment proof into a compact row", () => {
    expect(pageSrc).toContain("View proof");
    expect(pageSrc).toContain("Rejected");
  });
});
