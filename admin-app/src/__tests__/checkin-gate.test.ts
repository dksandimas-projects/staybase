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
    expect(pageSrc).toMatch(/incompleteItems=\{selectedBookingCheckInReadiness\.incompleteItems\}/);
    expect(pageSrc).toMatch(/disabled=\{!selectedBookingCheckInReadiness\?\.ready\}/);
    expect(workspaceSrc).toMatch(/Check-in readiness/);
    expect(workspaceSrc).toMatch(/missingItems\.map/);
  });

  it("uses the same readiness helper in the server check-in handler", () => {
    expect(handlerSrc).toMatch(/getCheckInReadiness/);
    expect(handlerSrc).toMatch(/Booking is not ready for check-in/);
    expect(handlerSrc).toMatch(/readiness\.missingItems\.join/);
  });

  // Per Decision #344 (2026-11-25): EVERY guest record that used to
  // block a check-in is optional now. The labels still exist — they
  // are the ADVISORY list, so the desk still sees what was never
  // written down — but they must be pushed into `incompleteItems`,
  // never into `missingItems` (the list the server reads when it
  // refuses a check-in).
  it("keeps every guest record OUT of the hard blocker list", () => {
    expect(sharedSrc).toMatch(/CHECK_IN_ELIGIBLE_STATUSES = \["confirmed", "payment-confirmed"\]/);

    // The booking STATUS is the only hard blocker.
    expect(sharedSrc).toMatch(/missingItems\.push\("Booking status must be confirmed or payment-confirmed"\)/);

    // The guest records are pushed as ADVISORY items.
    for (const label of [
      // Per Decision #338 (2026-11-22): the guest ID PHOTO is optional.
      // Per Decision #339 the desk's note is optional too.
      // Per Decision #344 the desk's attestation is optional as well.
      "Guest ID sighted at the desk",
      "Nationality",
      "Residential address",
      "Date of birth",
      "Gender",
      "ID type",
      "ID number",
      "Emergency contact",
      "Guest signature"
    ]) {
      expect(sharedSrc).toContain(label);
      // The label must NOT be a blocker.
      expect(sharedSrc).not.toContain(`missingItems.push("${label}")`);
    }

    // The registry field loop writes to the advisory list only.
    expect(sharedSrc).toMatch(/incompleteItems\.push\(field\.label\)/);
    expect(sharedSrc).not.toMatch(/missingItems\.push\(field\.label\)/);

    // The registry list is named as ADVISORY, not REQUIRED.
    expect(sharedSrc).toContain("ADVISORY_REGISTRATION_FIELDS");
    expect(sharedSrc).not.toContain("REQUIRED_REGISTRATION_FIELDS");
  });

  // Per Decision #344 (2026-11-25): the desk attestation and the
  // signed form no longer refuse a check-in.
  it("no longer treats a missing attestation or signature as a blocker", () => {
    expect(sharedSrc).not.toContain('missingItems.push("Guest signature marked signed")');
    expect(sharedSrc).not.toContain("Purpose of stay (Other — reason required)");
    expect(sharedSrc).toContain("Purpose of stay (Other — reason not recorded)");
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

  // Per Decision #344 (2026-11-25): the drawer header no longer
  // carries a "N check-in items missing" alert — nothing about a
  // booking's records can put it behind another task any more. The
  // advisory list lives in the readiness card, where the form is.
  it("drops the header's check-in-items-missing alert", () => {
    // The chip's label was a template (`${n} check-in item(s) missing`)
    // and the prop that fed it was `missingCheckInItems` — both gone.
    expect(workspaceSrc).not.toMatch(/check-in item\$\{/);
    expect(workspaceSrc).not.toMatch(/missingCheckInItems/);
    expect(pageSrc).not.toMatch(/missingCheckInItems/);
  });

  // The advisory list still RENDERS — the desk should see what was
  // never written down, just not as a blocker.
  it("renders the optional records in the readiness card", () => {
    expect(workspaceSrc).toMatch(/Optional records not filled/);
    expect(workspaceSrc).toMatch(/incompleteItems\.map/);
    expect(workspaceSrc).toMatch(/Ready to check in/);
  });

  // The registration form must not tell the desk a field is required.
  it("drops the required wording from the registration form", () => {
    const formSrc = read("admin-app/src/components/BookingRegistrationForm.tsx");
    expect(formSrc).not.toContain("required if Purpose = Other");
    expect(formSrc).toContain("Note (optional)");
  });

  // Per Decision #345 (2026-11-25): the registration SAVE must be
  // visible. Since #344 every guest record is optional, so the old
  // collapse trigger ("every field is filled") almost never fired and
  // a successful save was completely silent — the desk clicked Save
  // and nothing appeared to happen.
  it("collapses the registration card once a registration is CAPTURED, not once every field is filled", () => {
    const formSrc = read("admin-app/src/components/BookingRegistrationForm.tsx");
    // The trigger is the presence of a captured registration...
    expect(formSrc).toMatch(/hasCapturedRegistration/);
    expect(formSrc).toMatch(/Object\.keys\(reg \|\| \{\}\)\.length > 0/);
    expect(formSrc).toMatch(/\(hasCapturedRegistration \|\| isReadOnly\) && !showEdit/);
    // ...and the old "everything filled" trigger is gone.
    expect(formSrc).not.toContain("const isComplete =");
  });

  it("awaits the registration save and reports the outcome", () => {
    const pageSrc = read("admin-app/src/pages/BookingsPage.tsx");
    // The write is AWAITED — an unawaited write cannot be reported.
    expect(pageSrc).toMatch(
      /const result = await updateBookingStatus\(selectedBooking\.id, selectedBooking\.status, \{\s*guestRegistration\s*\}\);/
    );
    // A success toast, and the local state update happens ONLY after
    // the write landed (so a refused write never collapses the card).
    expect(pageSrc).toMatch(/if \(!result\) return;/);
    expect(pageSrc).toMatch(/syncSelectedBooking\(\{ guestRegistration \}\);/);
    expect(pageSrc).toMatch(/toast\.success\(\s*"Registration saved"/);
  });

  // The `updateBookingStatus` contract: an object on success, `null`
  // on failure. Without it a caller cannot tell "saved" from
  // "refused" — the desk was told a check-in had happened when the
  // server had refused it.
  it("makes updateBookingStatus resolve with an object on success and null on failure", () => {
    const contextSrc = read("admin-app/src/context/AdminContext.tsx");
    expect(contextSrc).toMatch(/return data\?\.data \?\? \{\};/);
    expect(contextSrc).not.toMatch(/return data\?\.data \?\? null;/);
    // The client-side write branch returns an object too (it used to
    // return null, which was ambiguous with failure).
    expect(contextSrc).toMatch(/handledBy: currentUser\?\.uid \|\| ""\s*\}\);\s*\n\s*\/\/[^\n]*\n(?:[^\n]*\n)*?\s*return \{\};/);
  });

  it("keeps the check-in modal open when the server refuses the check-in", () => {
    const pageSrc = read("admin-app/src/pages/BookingsPage.tsx");
    const handler = pageSrc.match(/const handleConfirmCheckIn = async \(\) => \{[\s\S]*?\n  \};/);
    expect(handler).not.toBeNull();
    expect(handler![0]).toMatch(/const result = await updateBookingStatus\(selectedBooking\.id, "checked-in"\);/);
    expect(handler![0]).toMatch(/if \(!result\) \{/);
    // The local status is only flipped AFTER the server accepted it.
    const resultIndex = handler![0].indexOf("if (!result)");
    const statusIndex = handler![0].indexOf('status: "checked-in"');
    expect(resultIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeGreaterThan(resultIndex);
  });
});
