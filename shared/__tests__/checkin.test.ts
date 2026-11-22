import { describe, expect, test } from "vitest";
import { getCheckInReadiness, getIdVerificationState } from "../utils/checkin";

const completeRegistration = {
  nationality: "Filipino",
  address: "Tagbilaran City",
  dateOfBirth: "1980-01-01",
  gender: "Female",
  // Per Decision #121 (2026-07-23): purpose of stay is required at
  // physical check-in. Default to "Leisure" (the front-desk form
  // opens with Leisure selected).
  purposeOfStay: "leisure",
  idType: "Passport",
  idNumber: "P1234567",
  emergencyContact: "Juan Dela Cruz / 09171234567",
  signatureStatus: "signed",
  // Per Decision #338 (2026-11-22): the guest ID PHOTO is optional.
  // The desk's attestation that the physical ID was sighted is the
  // mandatory ID evidence.
  idSightStatus: "sighted"
};

describe("getCheckInReadiness", () => {
  test("is ready for confirmed bookings with a sighted ID, a photo, and complete registration", () => {
    expect(getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: completeRegistration
    })).toEqual({ ready: true, missingItems: [] });
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

  test("requires the desk attestation even when a photo is attached", () => {
    // The photo is evidence of the ID, not proof that the desk
    // verified it against the guest. The attestation is the mandatory
    // item.
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: {
        ...completeRegistration,
        idSightStatus: ""
      }
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missingItems).toContain("Guest ID sighted at the desk");
  });

  test("reports the missing attestation, required registration fields, signature, and status", () => {
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
      "Booking status must be confirmed or payment-confirmed",
      "Guest ID sighted at the desk",
      "ID number",
      "Guest signature marked signed"
    ]);
  });

  // Per Decision #121: purpose of stay is required at physical
  // check-in. The control opens with "Leisure" selected on the
  // admin form so the most common path doesn't need a staff action,
  // but the readiness gate still requires an explicit value to be
  // persisted (a blank string or missing field both fail the gate).
  test("reports missing purpose of stay (Decision #121)", () => {
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: {
        ...completeRegistration,
        purposeOfStay: ""
      }
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missingItems).toContain("Purpose of stay");
  });

  test("'Other' purpose requires the free-text reason (otherPurpose)", () => {
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: {
        ...completeRegistration,
        purposeOfStay: "other"
        // otherPurpose intentionally missing
      }
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missingItems).toContain("Purpose of stay (Other — reason required)");
  });

  test("'Other' with a reason passes the gate", () => {
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
    expect(readiness.missingItems).toEqual([]);
  });

  test("uppercase 'OTHER' is normalized and still requires the reason", () => {
    // The form normalizes to lowercase, but the gate also handles
    // legacy data or direct writes that might keep the original case.
    const readiness = getCheckInReadiness({
      status: "confirmed",
      guestIdPhotoUrl: "https://storage.example/guest-id.jpg",
      guestRegistration: {
        ...completeRegistration,
        purposeOfStay: "Other"
      }
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missingItems).toContain("Purpose of stay (Other — reason required)");
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
