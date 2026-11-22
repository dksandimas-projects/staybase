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

  it("requires the desk ID attestation, registration fields, signed status, and eligible status", () => {
    expect(sharedSrc).toMatch(/CHECK_IN_ELIGIBLE_STATUSES = \["confirmed", "payment-confirmed"\]/);
    for (const label of [
      // Per Decision #338 (2026-11-22): the guest ID PHOTO is optional.
      // The mandatory ID evidence is the desk's attestation that the
      // physical ID was sighted, plus a reason when no photo is on file.
      "Guest ID sighted at the desk",
      "Reason for no ID photo attached",
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

  // Per Decision #338 (2026-11-22): the guest ID photo no longer
  // blocks the check-in. The photo is still uploaded (it is the
  // strongest evidence) but the desk attestation is what the gate
  // reads.
  it("no longer treats a missing guest ID photo as a check-in blocker", () => {
    expect(sharedSrc).not.toContain('missingItems.push("Guest ID photo")');
  });

  it("mounts the guest ID verification panel in the booking drawer", () => {
    expect(pageSrc).toMatch(/<GuestIdVerificationPanel/);
    expect(pageSrc).toMatch(/hasPhoto=\{Boolean\(selectedBooking\.guestIdPhotoUrl\)\}/);
    expect(pageSrc).toMatch(/onSave=\{handleIdSightSave\}/);
  });

  it("writes the attestation into guestRegistration and keeps it across a registry-form save", () => {
    const panelSrc = read("admin-app/src/components/GuestIdVerificationPanel.tsx");
    expect(panelSrc).toMatch(/idSightStatus/);
    expect(panelSrc).toMatch(/idSightNote/);
    expect(panelSrc).toMatch(/idSightBy/);
    expect(panelSrc).toMatch(/idSightAt/);
    // The registration form rewrites `guestRegistration` wholesale —
    // the attestation has to be carried across explicitly or saving
    // the registry form would silently wipe the desk's record.
    expect(pageSrc).toMatch(/existingSight\.idSightStatus/);
  });

  it("hides the readiness card once the booking has been checked in", () => {
    // The card's purpose is to drive staff toward the check-in
    // button. After the booking is `checked-in` (or past it) the
    // gate is irrelevant and the helper would otherwise report
    // "Booking status must be confirmed or payment-confirmed" as
    // a permanent "1 missing" — that's a confusing lie, so we hide
    // the card. The same applies to every status outside
    // CHECK_IN_ELIGIBLE_STATUSES.
    expect(pageSrc).toMatch(/CHECK_IN_ELIGIBLE_STATUSES\.includes\(selectedBooking\.status/);
  });
});
