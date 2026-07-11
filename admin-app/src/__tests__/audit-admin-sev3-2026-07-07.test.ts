import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const src = (path: string) => readFileSync(resolve(root, path), "utf8");

const adminLayout = src("src/components/AdminLayout.tsx");
const adminContext = src("src/context/AdminContext.tsx");
const bookingsPage = src("src/pages/BookingsPage.tsx");
const dashboardPage = src("src/pages/DashboardPage.tsx");
const ratesPage = src("src/pages/RatesPage.tsx");
const reportsPage = src("src/pages/ReportsPage.tsx");
const roomsPage = src("src/pages/RoomsPage.tsx");
const settingsPage = src("src/pages/SettingsPage.tsx");
const firestoreRules = readFileSync(resolve(root, "../firebase/firestore.rules"), "utf8");

describe("Admin audit SEV-3 fixes — 2026-07-07", () => {
  it("AA-10/AA-11 normalizes restricted paths and mobile sign-out works", () => {
    expect(adminLayout).toMatch(/toLowerCase\(\)\.replace\(\/\\\/\+\$\/,\s*""\)/);
    expect(adminLayout).toMatch(/onClick=\{\(\) => void signOut\(\)\}/);
  });

  it("AA-12 uses hotel-local dates for booking today/defaults", () => {
    expect(bookingsPage).toMatch(/getManilaDateInfo\(config\.timezone\)\.todayStr/);
    expect(bookingsPage).not.toMatch(/new Date\(\)\.toISOString\(\)\.split\("T"\)\[0\]/);
  });

  it("AA-13/AA-14 exports full backup sheets and uses configured low-stock threshold", () => {
    for (const sheet of ["Bookings", "Payments", "Members", "Store Orders", "Store Catalog", "Breakfast Selections", "Vouchers", "Corporate Inquiries"]) {
      expect(reportsPage).toContain(sheet);
    }
    expect(reportsPage).toMatch(/storeConfig\.lowStockThreshold/);
    expect(reportsPage).not.toMatch(/stock\s*<=\s*5/);
    expect(reportsPage).toMatch(/Print/);
  });

  it("AA-15/AA-16 rooms edit/delete paths persist real fields and guard type deletion", () => {
    expect(roomsPage).toMatch(/setRoomName\(room\.name\)/);
    expect(roomsPage).toMatch(/isActive:\s*editIsActive/);
    expect(roomsPage).toMatch(/blockReason:\s*status === "blocked"/);
    expect(adminContext).toMatch(/roomDeletionAudit/);
    expect(settingsPage).toMatch(/countRoomsUsingType/);
    expect(adminContext).toMatch(/rooms\.filter\(\(room\) => room\.type === value\)/);
    expect(firestoreRules).toMatch(/match \/roomDeletionAudit\/\{auditId\}/);
  });

  it("AA-17/AA-18 fixes voucher uniqueness and payment-confirmed transition", () => {
    expect(adminContext).toMatch(/doc\(db,\s*"vouchers",\s*voucherCode\)/);
    expect(ratesPage).toMatch(/createdBy:\s*currentUser\?\.uid \|\| "staff"/);
    expect(ratesPage).toMatch(/corpExpiresAt/);
    expect(ratesPage).toMatch(/corpUsageCap/);
    expect(bookingsPage).toMatch(/value="payment-confirmed"/);
    expect(bookingsPage).toMatch(/handleStatusTransition\("payment-confirmed"\)/);
    expect(adminContext).toMatch(/\/api\/email\/payment-confirmed/);
  });

  it("AA-19/AA-20/AA-22 closes rewards, white-label, and API fallback gaps", () => {
    expect(bookingsPage).toMatch(/\/api\/members\/redeem-points/);
    expect(bookingsPage).toMatch(/\/api\/members\/undo-redemption/);
    expect(bookingsPage).toMatch(/hexToRgb\(config\.colors\.primary\)/);
    expect(reportsPage).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
    expect(dashboardPage).not.toMatch(/#[0-9A-Fa-f]{3,6}/);
    expect(adminContext).not.toMatch(/VITE_GUEST_APP_URL \|\| ""/);
    expect(bookingsPage).not.toMatch(/VITE_GUEST_APP_URL \|\| ""/);
  });

  it("AA-21/AA-29 fixes settings merge and auth-gated listeners", () => {
    expect(adminContext).toMatch(/setHotelConfig\(\(prev\) => \(\{ \.\.\.prev, \.\.\.\(data as Partial/);
    expect(adminContext).toMatch(/updateSettings\("hotelConfig",\s*\{\s*roomTypes/);
    expect(adminContext).toMatch(/if \(!currentUser\) \{\s*setIntercomThreads\(\{\}\)/);
    expect(adminContext).toMatch(/if \(!currentUser\) \{\s*setIncomingCall\(null\)/);
    expect(adminContext).toMatch(/collection\(db,\s*"corporateCodes"\)/);
  });

  it("AA-26/AA-27/AA-28 fixes dashboard drift and identity literals", () => {
    expect(dashboardPage).toMatch(/\["confirmed", "checked-in", "checked-out"\]\.includes\(b\.status\)/);
    expect(dashboardPage).toMatch(/isInProgress/);
    expect(ratesPage).toMatch(/Weekend Rate \(Sat\/Sun\)/);
    expect(bookingsPage).not.toMatch(/walkin@guest\.com|frontdesk-staff/);
    expect(adminContext).not.toMatch(/guestName:\s*sender === "guest" \? "Guest" : currentUser\?\.email/);
  });
});
