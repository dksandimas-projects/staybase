import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const dataTableSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/DataTable.tsx"),
  "utf8"
);
const bookingsSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);
const membersSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/MembersPage.tsx"),
  "utf8"
);
const ratesSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/RatesPage.tsx"),
  "utf8"
);
const inquiriesSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/CorporateInquiriesPage.tsx"),
  "utf8"
);

describe("Phase 11.7 — DataTable mobile card view (P0)", () => {
  describe("DataTable component", () => {
    it("accepts an optional renderMobileCard prop", () => {
      expect(dataTableSrc).toMatch(/renderMobileCard\?:\s*\(row:\s*T\)\s*=>\s*ReactNode/);
    });

    it("accepts an optional emptyMessage prop", () => {
      expect(dataTableSrc).toMatch(/emptyMessage\?:\s*string/);
    });

    it("accepts an optional mobileCardShowChevron prop", () => {
      expect(dataTableSrc).toMatch(/mobileCardShowChevron\?:\s*boolean/);
    });

    it("branches on isMobile AND renderMobileCard to render the card list", () => {
      expect(dataTableSrc).toMatch(/isMobile\s*&&\s*renderMobileCard\s*!==\s*undefined/);
    });

    it("renders card-shaped skeletons (not row-shaped) on mobile loading", () => {
      expect(dataTableSrc).toMatch(/MobileCardSkeleton/);
    });

    it("renders an empty state for mobile cards (not just empty tbody)", () => {
      expect(dataTableSrc).toMatch(/emptyMessage/);
    });

    it("makes the card tappable via onRowClick with role=button + tabindex", () => {
      expect(dataTableSrc).toMatch(/role=\{onRowClick\s*\?\s*["']button["']\s*:\s*undefined\}/);
      expect(dataTableSrc).toMatch(/tabIndex=\{onRowClick\s*\?\s*0\s*:\s*undefined\}/);
    });

    it("supports Enter and Space keyboard activation on mobile cards", () => {
      expect(dataTableSrc).toMatch(/e\.key\s*===\s*["']Enter["']\s*\|\|\s*e\.key\s*===\s*["']\s*["']/);
    });

    it("preserves the original table view as the default (when renderMobileCard is not provided)", () => {
      expect(dataTableSrc).toMatch(/<table\s+className="min-w-full/);
    });

    it("also adds an empty state to the desktop table", () => {
      expect(dataTableSrc).toMatch(/<td\s+colSpan=\{columns\.length\}/);
    });
  });

  describe("BookingsPage passes renderMobileCard", () => {
    it("defines renderBookingCard and renderOrderCard", () => {
      // Per MRB-07 (2026-08-02, per decision #159): the card renderer
      // takes a `BookingListRow`, which is a `Booking` plus the list's
      // row-kind discriminator, so it can also render the reservation
      // summary card for a multi-room group.
      expect(bookingsSrc).toMatch(/const renderBookingCard\s*=\s*\(row:\s*BookingListRow\)/);
      expect(bookingsSrc).toMatch(/const renderOrderCard\s*=\s*\(row: any\)/);
    });

    it("passes renderMobileCard to the bookings DataTable", () => {
      expect(bookingsSrc).toMatch(/renderMobileCard=\{renderBookingCard\}/);
    });

    it("passes renderMobileCard to the orders DataTable", () => {
      expect(bookingsSrc).toMatch(/renderMobileCard=\{renderOrderCard\}/);
    });

    it("the booking card shows REF + status + name + dates + room + total", () => {
      expect(bookingsSrc).toMatch(/REF: \{row\.bookingRef\}/);
      expect(bookingsSrc).toMatch(/\{row\.guestName\}/);
      expect(bookingsSrc).toMatch(/\{row\.checkIn\} – \{row\.checkOut\}/);
      expect(bookingsSrc).toMatch(/Room \{row\.roomNumber\}/);
      expect(bookingsSrc).toMatch(/\{formatPrice\(row\.totalPrice\)\}/);
    });
  });

  describe("MembersPage passes renderMobileCard", () => {
    it("defines renderMemberCard", () => {
      expect(membersSrc).toMatch(/const renderMemberCard\s*=\s*\(row:\s*Member\)/);
    });

    it("passes renderMobileCard + mobileCardShowChevron to the DataTable", () => {
      expect(membersSrc).toMatch(/renderMobileCard=\{renderMemberCard\}/);
      expect(membersSrc).toMatch(/mobileCardShowChevron/);
    });

    it("the member card shows name + email + member since + points + status", () => {
      expect(membersSrc).toMatch(/\{row\.fullName\}/);
      expect(membersSrc).toMatch(/\{row\.email\}/);
      expect(membersSrc).toMatch(/Member Since/);
      expect(membersSrc).toMatch(/\{row\.rewardsPoints\} pts/);
    });
  });

  describe("RatesPage passes renderMobileCard", () => {
    it("defines renderVoucherCard and renderCorpCard", () => {
      expect(ratesSrc).toMatch(/const renderVoucherCard\s*=\s*\(row:\s*Voucher\)/);
      expect(ratesSrc).toMatch(/const renderCorpCard\s*=\s*\(row:\s*CorporateCode/);
    });

    it("passes renderMobileCard to both voucher and corp DataTables", () => {
      expect(ratesSrc).toMatch(/renderMobileCard=\{renderVoucherCard\}/);
      expect(ratesSrc).toMatch(/renderMobileCard=\{renderCorpCard\}/);
    });
  });

  describe("CorporateInquiriesPage passes renderMobileCard", () => {
    it("defines renderInquiryCard", () => {
      expect(inquiriesSrc).toMatch(/const renderInquiryCard\s*=\s*\(row:\s*CorporateInquiry\)/);
    });

    it("passes renderMobileCard to the inquiries DataTable", () => {
      expect(inquiriesSrc).toMatch(/renderMobileCard=\{renderInquiryCard\}/);
    });
  });
});
