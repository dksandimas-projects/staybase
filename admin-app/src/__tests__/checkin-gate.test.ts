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
      // physical ID was sighted. Per Decision #339 the desk's note is
      // optional too — the attestation alone is enough.
      "Guest ID sighted at the desk",
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

  // Per Decision #339 (2026-11-22): the desk's note is optional, so
  // the gate never asks for a reason either.
  it("never asks for a reason for the missing ID photo", () => {
    const formSrc = read("admin-app/src/components/BookingRegistrationForm.tsx");
    expect(sharedSrc).not.toContain("Reason for no ID photo attached");
    expect(formSrc).not.toContain("Reason for no ID photo");
    expect(formSrc).toContain("Note (optional)");
  });

  // Per Decision #340 (2026-11-23): the guest registry and the desk's
  // ID attestation are ONE form with ONE save button.
  it("records the attestation in the registration form, not a second form", () => {
    const formSrc = read("admin-app/src/components/BookingRegistrationForm.tsx");
    expect(formSrc).toMatch(/name="idSightStatus"/);
    expect(formSrc).toMatch(/name="idSightNote"/);
    expect(formSrc).toMatch(/I sighted and verified the guest/);
    // The photo strip rides inside the same card.
    expect(formSrc).toMatch(/photoSlot/);
    expect(pageSrc).toMatch(/photoSlot=\{guestIdPhotoSlot\}/);
  });

  it("writes the attestation into guestRegistration from the ONE save handler", () => {
    expect(pageSrc).toMatch(/formData\.get\("idSightStatus"\)/);
    expect(pageSrc).toMatch(/formData\.get\("idSightNote"\)/);
    expect(pageSrc).toMatch(/idSightBy:/);
    expect(pageSrc).toMatch(/idSightAt:/);
  });

  it("has exactly ONE save button in the check-in section", () => {
    const formSrc = read("admin-app/src/components/BookingRegistrationForm.tsx");
    // One submit button on the form...
    const submits = formSrc.match(/type="submit"/g) || [];
    expect(submits.length).toBe(1);
    expect(formSrc).toMatch(/Save Registration/);
    // ...and the retired second save button is gone for good.
    expect(pageSrc).not.toMatch(/handleIdSightSave/);
    expect(pageSrc).not.toMatch(/Save ID verification/);
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
