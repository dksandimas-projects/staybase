import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const page = fs.readFileSync(path.resolve(__dirname, "../pages/BookingsPage.tsx"), "utf8");
const context = fs.readFileSync(path.resolve(__dirname, "../context/AdminContext.tsx"), "utf8");

describe("admin booking drawer early check-in grant", () => {
  test("is visible only to admins for paid or confirmed bookings without an existing record", () => {
    expect(page).toContain('data-testid="admin-grant-early-checkin-panel"');
    expect(page).toContain('currentUser?.role === "admin"');
    expect(page).toContain('["payment-confirmed", "confirmed"].includes(selectedBooking.status)');
    expect(page).toContain("!selectedBooking.earlyCheckIn");
  });

  test("collects time and an optional guest-facing note", () => {
    expect(page).toContain("EARLY_CHECKIN_TIME_OPTIONS.map");
    expect(page).toContain("Staff Note (optional, sent to guest)");
    expect(page).toContain("Grant & notify guest");
  });

  test("uses the authenticated context mutation and tracks staff-granted source", () => {
    expect(context).toContain("grantEarlyCheckin:");
    expect(context).toContain("grantIfMissing: true");
    expect(page).toContain("await grantEarlyCheckin(selectedBooking.id");
    expect(page).toContain('source: "staff-granted"');
  });

  test("front desk sees admin grants as read-only", () => {
    expect(page).toContain("const canManage = !isStaffGranted || currentUser?.role === \"admin\"");
    expect(page).toContain("Admin access is required to change it.");
  });
});
