import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Admin audit 2026-07-07 SEV-2 fixes", () => {
  const contextSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"), "utf8");
  const bookingsSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"), "utf8");
  const settingsSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"), "utf8");
  const ratesSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/pages/RatesPage.tsx"), "utf8");
  const corporateSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/pages/CorporateInquiriesPage.tsx"), "utf8");
  const dashboardSrc = readFileSync(resolve(__dirname, "../../../admin-app/src/pages/DashboardPage.tsx"), "utf8");
  const rulesSrc = readFileSync(resolve(__dirname, "../../../firebase/firestore.rules"), "utf8");

  it("AA-04 uploads guest ID photos to booking Storage instead of storing data URLs", () => {
    expect(bookingsSrc).toMatch(/bookings\/\$\{selectedBooking\.id\}\/guest-id\/\$\{Date\.now\(\)\}-\$\{safeName\}/);
    expect(bookingsSrc).toMatch(/uploadBytes\(fileRef,\s*image\.file\)/);
    expect(bookingsSrc).toMatch(/getDownloadURL\(fileRef\)/);
    expect(bookingsSrc).not.toMatch(/guestIdPhotoUrl:\s*image\.dataUrl/);
  });

  it("AA-05 uploads store item photos to Storage and migrates existing data URLs", () => {
    expect(contextSrc).toMatch(/store-items\/\$\{itemId\}\/\$\{Date\.now\(\)\}-\$\{safeName\}/);
    expect(contextSrc).toMatch(/uploadBytes\(fileRef,\s*file\)/);
    expect(contextSrc).toMatch(/item\.imageUrl\.startsWith\(["']data:image\//);
    expect(settingsSrc).toMatch(/imageFile:\s*storeItemPhotoFile/);
  });

  it("AA-06 keeps rates and breakfast form buffers synced until dirty", () => {
    expect(ratesSrc).toMatch(/dirtyRateFields/);
    expect(ratesSrc).toMatch(/dirtyCorporateRateTypes/);
    expect(ratesSrc).toMatch(/bfRateDirty/);
    expect(ratesSrc).toMatch(/dirtyRateFields\.has\(`\$\{t\.value\}\.base`\)/);
    expect(ratesSrc).not.toMatch(/if \(!updated\[t\.value\]\)/);
  });

  it("AA-07 and AA-08 create corporate codes dynamically, persist inquiry links, and reject duplicates", () => {
    expect(corporateSrc).toMatch(/roomTypes\.map\(\(type\) => \[/);
    expect(corporateSrc).toMatch(/accessCodeId:\s*code/);
    expect(corporateSrc).not.toMatch(/executivo/);
    expect(corporateSrc).not.toMatch(/corporateDoubleRate|corporateExecRate/);
    expect(contextSrc).toMatch(/runTransaction\(db,\s*async\s*\(transaction\)/);
    expect(contextSrc).toMatch(/Corporate code already exists/);
    expect(rulesSrc).toMatch(/match \/corporateCodes\/\{code\}[\s\S]*allow write: if isStaff\(\);/);
  });

  it("AA-09 adds dashboard operational sections and removes fabricated trend copy", () => {
    expect(dashboardSrc).toMatch(/pendingPayments/);
    expect(dashboardSrc).toMatch(/todaysArrivals/);
    expect(dashboardSrc).toMatch(/todaysDepartures/);
    expect(dashboardSrc).toMatch(/recentBookings/);
    expect(dashboardSrc).toMatch(/updateBookingStatus\(bookingId,\s*["']confirmed["']\)/);
    expect(dashboardSrc).not.toMatch(/\+8% from last week/);
  });
});
