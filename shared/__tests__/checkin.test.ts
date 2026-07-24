import { describe, expect, test } from "vitest";
import { getCheckInReadiness } from "../utils/checkin";

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
  signatureStatus: "signed"
};

describe("getCheckInReadiness", () => {
  test("is ready for confirmed bookings with guest ID and complete registration", () => {
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

  test("reports missing guest ID, required registration fields, signature, and status", () => {
    const readiness = getCheckInReadiness({
      status: "pending",
      guestIdPhotoUrl: "",
      guestRegistration: {
        ...completeRegistration,
        idNumber: "",
        signatureStatus: "pending"
      }
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.missingItems).toEqual([
      "Booking status must be confirmed or payment-confirmed",
      "Guest ID photo",
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
