import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("BookingsPage check-in gate", () => {
  const pageSrc = read("admin-app/src/pages/BookingsPage.tsx");
  const workspaceSrc = read("admin-app/src/components/BookingDrawerWorkspace.tsx");
  const handlerSrc = read("guest-app/server/handlers/bookings.ts");
  const sharedSrc = read("shared/utils/checkin.ts");

  it("uses the shared check-in readiness helper in the admin drawer", () => {
    expect(pageSrc).toMatch(/getCheckInReadiness/);
    expect(pageSrc).toMatch(/selectedBookingCheckInReadiness/);
    expect(pageSrc).toMatch(/<BookingCheckInReadiness/);
    expect(pageSrc).toMatch(/missingItems=\{selectedBookingCheckInReadiness\.missingItems\}/);
    expect(pageSrc).toMatch(/disabled=\{!selectedBookingCheckInReadiness\?\.ready\}/);
    expect(workspaceSrc).toMatch(/Check-in readiness/);
    expect(workspaceSrc).toMatch(/missingItems\.map/);
  });

  it("uses the same readiness helper in the server check-in handler", () => {
    expect(handlerSrc).toMatch(/getCheckInReadiness/);
    expect(handlerSrc).toMatch(/Booking is not ready for check-in/);
    expect(handlerSrc).toMatch(/readiness\.missingItems\.join/);
  });

  it("requires guest ID, registration fields, signed status, and eligible status", () => {
    expect(sharedSrc).toMatch(/CHECK_IN_ELIGIBLE_STATUSES = \["confirmed", "payment-confirmed"\]/);
    for (const label of [
      "Guest ID photo",
      "Nationality",
      "Residential address",
      "Date of birth",
      "Gender",
      "ID type",
      "ID number",
      "Emergency contact",
      "Guest signature marked signed"
    ]) {
      expect(sharedSrc).toContain(label);
    }
  });
});
