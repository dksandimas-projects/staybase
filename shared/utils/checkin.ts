export const CHECK_IN_ELIGIBLE_STATUSES = ["confirmed", "payment-confirmed"] as const;

export interface CheckInRegistration {
  nationality?: string | null;
  address?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  // Per Decision #121 (2026-07-23): purpose of stay is required at
  // physical check-in, defaults to "Leisure". The admin drawer opens
  // with Leisure selected and the staff can choose another supported
  // purpose before saving. Free-text `otherPurpose` is captured when
  // the staff picks "Other" so the front desk has the actual reason
  // (e.g. "wedding", "medical", "long-stay relocation") not just
  // a generic bucket.
  purposeOfStay?: string | null;
  otherPurpose?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  emergencyContact?: string | null;
  signatureStatus?: string | null;
}

export interface CheckInReadinessInput {
  status?: string | null;
  guestIdPhotoUrl?: string | null;
  guestRegistration?: CheckInRegistration | null;
}

export interface CheckInReadiness {
  ready: boolean;
  missingItems: string[];
}

const REQUIRED_REGISTRATION_FIELDS: Array<{ key: keyof CheckInRegistration; label: string }> = [
  { key: "nationality", label: "Nationality" },
  { key: "address", label: "Residential address" },
  { key: "dateOfBirth", label: "Date of birth" },
  { key: "gender", label: "Gender" },
  { key: "purposeOfStay", label: "Purpose of stay" },
  { key: "idType", label: "ID type" },
  { key: "idNumber", label: "ID number" },
  { key: "emergencyContact", label: "Emergency contact" }
];

function hasValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

export function getCheckInReadiness(input: CheckInReadinessInput): CheckInReadiness {
  const missingItems: string[] = [];
  if (!CHECK_IN_ELIGIBLE_STATUSES.includes(input.status as any)) {
    missingItems.push("Booking status must be confirmed or payment-confirmed");
  }
  if (!hasValue(input.guestIdPhotoUrl)) {
    missingItems.push("Guest ID photo");
  }

  const registration = input.guestRegistration || {};
  for (const field of REQUIRED_REGISTRATION_FIELDS) {
    if (!hasValue(registration[field.key])) {
      missingItems.push(field.label);
    }
  }
  // Per Decision #121: when the staff picks "Other" for purpose of stay
  // they must record the actual reason — "wedding", "medical", etc.
  // Without the reason the bucket is useless to the front desk.
  if (
    typeof registration.purposeOfStay === "string" &&
    registration.purposeOfStay.trim().toLowerCase() === "other" &&
    !hasValue(registration.otherPurpose)
  ) {
    missingItems.push("Purpose of stay (Other — reason required)");
  }
  if (registration.signatureStatus !== "signed") {
    missingItems.push("Guest signature marked signed");
  }

  return {
    ready: missingItems.length === 0,
    missingItems
  };
}
