import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
const src = (path: string) => readFileSync(resolve(root, path), "utf8");
const repo = (path: string) => readFileSync(resolve(root, "..", path), "utf8");

const adminContext = src("src/context/AdminContext.tsx");
const bookingsPage = src("src/pages/BookingsPage.tsx");
const corporatePage = src("src/pages/CorporateInquiriesPage.tsx");
const dashboardPage = src("src/pages/DashboardPage.tsx");
const roomsPage = src("src/pages/RoomsPage.tsx");
const ratesPage = src("src/pages/RatesPage.tsx");
const settingsPage = src("src/pages/SettingsPage.tsx");
const firestoreRules = repo("firebase/firestore.rules");
const backendDoc = repo("plan/docs/BACKEND.md");
const adminDoc = repo("plan/admin-app/CLAUDE.md");
const vouchersDoc = repo("plan/features/VOUCHERS.md");
const settingsDoc = repo("plan/features/SETTINGS.md");
const reportsDoc = repo("plan/features/REPORTS.md");

describe("Admin audit SEV-4 fixes — 2026-07-07", () => {
  it("AA-23 documents booking-level breakfast selections and removes the unused collection rule", () => {
    expect(backendDoc).toMatch(/bookings\/\{bookingId\}\.breakfastSelections/);
    expect(adminDoc).toMatch(/breakfast selections map/);
    expect(reportsDoc).toMatch(/bookings\.breakfastSelections/);
    expect(firestoreRules).not.toMatch(/match \/breakfastSelections/);
  });

  it("AA-24/AA-25 makes inquiry notes atomic/newest-first and keeps code issuance out of conversion", () => {
    expect(adminContext).toMatch(/notes:\s*arrayUnion\(newNote\)/);
    expect(adminContext).toMatch(/updatedAt:\s*serverTimestamp\(\)/);
    expect(adminContext).toMatch(/staff\.find\(\(member\) => member\.uid === currentUser\?\.uid\)\?\.fullName/);
    expect(corporatePage).toMatch(/newestNotes/);
    expect(corporatePage).toMatch(/\["negotiating", "converted"\]\.includes\(selectedInquiry\.status\)/);
    expect(corporatePage).not.toMatch(/status:\s*"converted",\s*accessCodeId/);
  });

  it("AA-26 through AA-29 remain closed in code", () => {
    expect(dashboardPage).toMatch(/\["confirmed", "checked-in", "checked-out"\]\.includes\(b\.status\)/);
    expect(dashboardPage).toMatch(/b\.checkOut === todayKey && b\.status === "checked-in"/);
    expect(dashboardPage).toMatch(/isInProgress/);
    expect(ratesPage).toMatch(/Weekend Rate \(Sat\/Sun\)/);
    expect(bookingsPage).not.toMatch(/walkin@guest\.com|frontdesk-staff/);
    expect(adminContext).toMatch(/if \(!currentUser\) \{\s*setIntercomThreads\(\{\}\)/);
    expect(adminContext).toMatch(/if \(!currentUser\) \{\s*setIncomingCall\(null\)/);
  });

  it("AA-30 uses reliable jsPDF fallback fonts and derives receipt discounts from stored totals", () => {
    expect(bookingsPage).toMatch(/registerBrandPdfFonts/);
    expect(bookingsPage).toMatch(/pdf\.setFont\("helvetica", "normal"\)/);
    expect(bookingsPage).not.toMatch(/addFileToVFS\("APOLLO\.otf"/);
    expect(bookingsPage).not.toMatch(/Inter-Regular\.ttf/);
    expect(bookingsPage).toMatch(/storedDiscountBase - b\.totalPrice - \(b\.voucherDiscount \|\| 0\) - \(b\.pointsRedeemedValue \|\| 0\)/);
    expect(bookingsPage).not.toMatch(/subtotal \* \(b\.discountPct \/ 100\)/);
  });

  it("AA-31 gives dashboard, rooms, rates, and settings first-load skeletons", () => {
    expect(adminContext).toMatch(/dashboardLoading: roomsLoading \|\| bookingsLoading/);
    expect(adminContext).toMatch(/ratesLoading: settingsLoading \|\| vouchersLoading/);
    expect(dashboardPage).toMatch(/dashboardLoading/);
    expect(roomsPage).toMatch(/roomsLoading/);
    expect(ratesPage).toMatch(/ratesLoading/);
    expect(settingsPage).toMatch(/settingsLoading/);
    for (const page of [dashboardPage, roomsPage, ratesPage, settingsPage]) {
      expect(page).toMatch(/animate-pulse/);
    }
  });

  it("AA-32/AA-33 syncs docs to actual components and admin-only voucher/settings surfaces", () => {
    expect(adminDoc).toMatch(/restricted routes show an access-denied state/);
    expect(adminDoc).toMatch(/DataTable\.tsx/);
    expect(adminDoc).not.toMatch(/BookingTable\.tsx|RoomForm\.tsx|OccupancyChart\.tsx/);
    expect(vouchersDoc).toMatch(/Management lives on the admin-only Rates page/);
    expect(settingsDoc).toMatch(/Admin-only — Front Desk records guest selections/);
    expect(settingsDoc).toMatch(/Admin-only — Front Desk processes store orders/);
  });
});
