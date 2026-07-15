import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");
const pageSrc = read("admin-app/src/pages/BookingsPage.tsx");
const workspaceSrc = read("admin-app/src/components/BookingDrawerWorkspace.tsx");
const drawerSrc = `${pageSrc}\n${workspaceSrc}`;

describe("Phase 12 — booking drawer information architecture", () => {
  it("provides the four task-based sections with accessible tabs", () => {
    for (const id of ["overview", "check-in", "folio", "more"]) {
      expect(workspaceSrc).toContain(`id: "${id}"`);
    }
    expect(workspaceSrc).toMatch(/role="tablist"/);
    expect(workspaceSrc).toMatch(/role="tab"/);
    expect(workspaceSrc).toMatch(/aria-selected=\{active\}/);
    expect(workspaceSrc).toMatch(/aria-controls=\{`booking-drawer-panel-\$\{id\}`\}/);
    expect(workspaceSrc).toMatch(/role=\{primary \? "tabpanel" : undefined\}/);
    expect(workspaceSrc).toMatch(/id=\{primary \? `booking-drawer-panel-\$\{section\}` : undefined\}/);
    expect(workspaceSrc).toMatch(/hidden=\{activeSection !== section\}/);
  });

  it("resets new bookings to Overview while preserving mounted section state", () => {
    expect(pageSrc).toMatch(/setActiveBookingSection\("overview"\)/);
    expect(pageSrc).toMatch(/\[selectedBooking\?\.id\]/);
    expect(workspaceSrc).not.toMatch(/activeSection\s*!==\s*section\s*\?\s*null/);
  });

  it("shows a compact operational header and booking lifecycle", () => {
    expect(workspaceSrc).toMatch(/Room \{booking\.roomNumber\}/);
    expect(workspaceSrc).toMatch(/SummaryMetric label="Total"/);
    expect(workspaceSrc).toMatch(/SummaryMetric label="Paid"/);
    expect(workspaceSrc).toMatch(/aria-label="Booking lifecycle"/);
    expect(workspaceSrc).toMatch(/Payment proof needs review/);
    expect(workspaceSrc).toMatch(/Early check-in needs a decision/);
  });

  it("keeps guest and payment context above the section tabs", () => {
    const guestIndex = workspaceSrc.indexOf("Guest information");
    const paymentIndex = workspaceSrc.indexOf("Payment reference number");
    const navIndex = workspaceSrc.indexOf("Booking drawer sections");
    expect(guestIndex).toBeGreaterThan(0);
    expect(paymentIndex).toBeGreaterThan(guestIndex);
    expect(navIndex).toBeGreaterThan(paymentIndex);
    expect(pageSrc).toMatch(/onPaymentReferenceChange=\{\(value\) => persistSelectedBooking/);
  });

  it("keeps inactive panels hidden even when a responsive display class is present", () => {
    expect(workspaceSrc).toMatch(/activeSection !== section && "!hidden"/);
  });

  it("maps every existing drawer feature into a section", () => {
    for (const feature of [
      "Payment Proof",
      "Guest information",
      "Payment method",
      "Payment reference number",
      "Check-in Registration",
      "Guest ID Attachment",
      "Stay & Accommodation",
      "Move / Upgrade Room Workstation",
      "Financial Breakdown",
      "Breakfast Selections",
      "Apply discount / voucher",
      "Government Discount Verification",
      "Spark Rewards Redemption",
      "On-site Payments Ledger",
      "Early Check-In Request",
      "Resend Transactional Email",
      "Incidental Charge Ledger",
      "Checkout Folio Review",
      "Cancel Booking"
    ]) {
      expect(drawerSrc, `expected booking drawer feature: ${feature}`).toContain(feature);
    }
    expect(pageSrc.match(/<BookingDrawerSectionPanel/g)?.length).toBeGreaterThanOrEqual(12);
  });

  it("keeps check-in readiness visible and uses the shared gate for the primary action", () => {
    expect(pageSrc).toMatch(/<BookingCheckInReadiness/);
    expect(pageSrc).toMatch(/ready=\{selectedBookingCheckInReadiness\.ready\}/);
    expect(pageSrc).toMatch(/disabled=\{!selectedBookingCheckInReadiness\?\.ready\}/);
    expect(workspaceSrc).toMatch(/Complete these items before checking in the guest/);
  });

  it("maps status to one sticky primary action", () => {
    for (const status of ["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"]) {
      expect(pageSrc).toContain(`selectedBooking.status === "${status}"`);
    }
    expect(pageSrc).toMatch(/footer=\{selectedBooking \? \(/);
    expect(pageSrc).toMatch(/primaryAction=\{renderBookingPrimaryAction\(\)\}/);
    expect(pageSrc).toMatch(/Confirm pay-at-hotel booking/);
    expect(pageSrc).toMatch(/Mark payment confirmed/);
    expect(pageSrc).toMatch(/Verify guest ID & check in/);
    expect(pageSrc).toMatch(/Review folio & check out/);
    expect(pageSrc).toMatch(/View \/ print receipt/);
  });

  it("keeps secondary and destructive actions in More", () => {
    expect(pageSrc).toMatch(/section="more"[\s\S]*Move \/ upgrade room/);
    expect(pageSrc).toMatch(/section="more"[\s\S]*Cancel Booking/);
    expect(workspaceSrc).toMatch(/More actions/);
  });

  it("keeps mobile controls touch-sized and exposes mobile section labels", () => {
    expect(workspaceSrc).toMatch(/mobileLabel: "Summary"/);
    expect(workspaceSrc).toMatch(/mobileLabel: "Check-in"/);
    expect(workspaceSrc).toMatch(/min-h-\[44px\]/);
    expect(workspaceSrc).toMatch(/overflow-x-auto/);
  });
});
