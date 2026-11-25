import { describe, expect, test } from "vitest";
import { getCheckInReadiness, getIdVerificationState } from "../utils/checkin";

const completeRegistration = {
  nationality: "Filipino",
  address: "Tagbilaran City",
  dateOfBirth: "1980-01-01",
  gender: "Female",
  // Per Decision #121 (2026-07-23): purpose of stay defaults to
  // "Leisure" (the front-desk form opens with Leisure selected).
  // Per Decision #344 (2026-11-25) it is captured, not required.
  purposeOfStay: "leisure",
  idType: "Passport",
  idNumber: "P1234567",
  emergencyContact: "Juan Dela Cruz / 09171234567",
  signatureStatus: "signed",
  // Per Decision #338 (2026-11-22): the guest ID PHOTO is optional.
  // The desk's attestation that the physical ID was sighted is the
  // strongest ID evidence. Per Decision #344 it is optional too.
  idSightStatus: "sighted"
};

describe("getCheckInReadiness", () => {
  test("is ready for confirmed bookings with a sighted ID, a photo, and complete registration", () => {
    expect(getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: completeRegistration
    })).toEqual({ ready: true, missingItems: [], incompleteItems: [] });
  });

  test("allows payment-confirmed bookings to check in directly", () => {
    expect(getCheckInReadiness({
      status: "payment-confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: completeRegistration
    }).ready).toBe(true);
  });

  // Per Decision #338 (2026-11-22): the ID photo is OPTIONAL. A desk
  // that sighted the physical ID but did not photograph it must still
  // be able to check the guest in — with a recorded reason.
  test("is ready with NO ID photo when the ID was sighted and a reason is recorded", () => {
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "",
      guestRegistration: {
        ...completeRegistration,
        idSightNote: "Guest declined to be photographed"
      }
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.missingItems).toEqual([]);
  });

  // Per Decision #339 (2026-11-22): the desk's note is OPTIONAL. The
  // attestation alone is the evidence — a missing photo with no reason
  // is no longer a blocked check-in.
  test("is ready with no ID photo AND no reason when the ID was sighted", () => {
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "",
      guestRegistration: completeRegistration
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.missingItems).toEqual([]);
  });

  // Per Decision #344 (2026-11-25): EVERY guest record is optional.
  // A booking with no registry at all is still ready to check in — the
  // blanks are reported as ADVISORY items, never as blockers.
  test("is ready when NOTHING is filled in — every guest record is optional", () => {
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "",
      guestRegistration: {}
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.missingItems).toEqual([]);
    expect(readiness.incompleteItems).toEqual([
      "Guest ID sighted at the desk",
      "Nationality",
      "Residential address",
      "Date of birth",
      "Gender",
      "Purpose of stay",
      "ID type",
      "ID number",
      "Emergency contact",
      "Guest signature"
    ]);
  });

  test("a missing registration is advisory, never a hard blocker", () => {
    // The blank registry fields land in `incompleteItems`, and
    // `missingItems` stays empty — the server reads `missingItems`,
    // so a blank field can never refuse a check-in.
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: {
        ...completeRegistration,
        idSightStatus: "",
        idNumber: "",
        signatureStatus: "pending"
      }
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.missingItems).toEqual([]);
    expect(readiness.incompleteItems).toContain("Guest ID sighted at the desk");
    expect(readiness.incompleteItems).toContain("ID number");
    expect(readiness.incompleteItems).toContain("Guest signature");
  });

  test("the booking STATUS is the only hard blocker", () => {
    const readiness = getCheckInReadiness({
      status: "pending",
      guestIdPhotoUrl: "",
      guestRegistration: {
        ...completeRegistration,
        idSightStatus: "",
        idNumber: "",
        signatureStatus: "pending"
      }
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missingItems).toEqual([
      "Booking status must be confirmed or payment-confirmed"
    ]);
    // The advisory list still reports what was never written down.
    expect(readiness.incompleteItems).toContain("ID number");
    expect(readiness.incompleteItems).toContain("Guest signature");
  });

  // Per Decision #121: purpose of stay is captured at physical
  // check-in. Per Decision #344 it is no longer REQUIRED — a blank
  // value is reported, not refused.
  test("reports a missing purpose of stay as advisory (Decision #344)", () => {
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: {
        ...completeRegistration,
        purposeOfStay: ""
      }
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.missingItems).toEqual([]);
    expect(readiness.incompleteItems).toContain("Purpose of stay");
  });

  test("'Other' purpose reports the missing reason as advisory", () => {
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: {
        ...completeRegistration,
        purposeOfStay: "other"
        // otherPurpose intentionally missing
      }
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.missingItems).toEqual([]);
    expect(readiness.incompleteItems).toContain("Purpose of stay (Other — reason not recorded)");
  });

  test("'Other' with a reason is not reported as incomplete", () => {
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: {
        ...completeRegistration,
        purposeOfStay: "other",
        otherPurpose: "Wedding at Loboc Church"
      }
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.incompleteItems).not.toContain("Purpose of stay (Other — reason not recorded)");
  });

  test("uppercase 'OTHER' is normalized and still reports the missing reason", () => {
    // The form normalizes to lowercase, but the helper also handles
    // legacy data or direct writes that might keep the original case.
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: {
        ...completeRegistration,
        purposeOfStay: "Other"
      }
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.incompleteItems).toContain("Purpose of stay (Other — reason not recorded)");
  });
});

describe("getIdVerificationState", () => {
  test("reports sighted + photo on file as complete", () => {
    expect(getIdVerificationState({
      registration: {
        idSightStatus: "sighted",
        idSightBy: "Front Desk",
        idSightAt: "2026-11-22T09:00:00.000Z"
      },
      hasPhoto: true
    })).toEqual({
      sighted: true,
      hasPhoto: true,
      note: "",
      sightedBy: "Front Desk",
      sightedAt: "2026-11-22T09:00:00.000Z",
      complete: true
    });
  });

  test("sighted with a reason and no photo is complete", () => {
    const state = getIdVerificationState({
      registration: { idSightStatus: "sighted", idSightNote: "Foreign ID, no camera" },
      hasPhoto: false
    });

    expect(state.sighted).toBe(true);
    expect(state.hasPhoto).toBe(false);
    expect(state.note).toBe("Foreign ID, no camera");
    expect(state.complete).toBe(true);
  });

  test("sighted with no photo and no reason is still complete", () => {
    // Per Decision #339 (2026-11-22): the note is optional.
    const state = getIdVerificationState({
      registration: { idSightStatus: "sighted" },
      hasPhoto: false
    });

    expect(state.sighted).toBe(true);
    expect(state.complete).toBe(true);
  });

  test("a photo alone is not an attestation", () => {
    const state = getIdVerificationState({
      registration: {},
      hasPhoto: true
    });

    expect(state.sighted).toBe(false);
    expect(state.complete).toBe(false);
  });

  test("the status is case-insensitive and whitespace-tolerant", () => {
    const state = getIdVerificationState({
      registration: { idSightStatus: "  Sighted " },
      hasPhoto: true
    });

    expect(state.sighted).toBe(true);
  });
});
