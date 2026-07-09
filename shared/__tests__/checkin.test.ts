import { describe, expect, test } from "vitest";
import { getCheckInReadiness } from "../utils/checkin";

const completeRegistration = {
  nationality: "Filipino",
  address: "Tagbilaran City",
  dateOfBirth: "1980-01-01",
  gender: "Female",
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
});
