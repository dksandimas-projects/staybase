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
  // Per Decision #338 (2026-11-22): the guest ID PHOTO is OPTIONAL at
  // physical check-in. The mandatory ID evidence is the staff
  // attestation that the guest's physical ID was sighted and verified
  // at the desk:
  //   - `idSightStatus` — "sighted" once the staff confirms it.
  //   - `idSightNote`   — an OPTIONAL note the desk may record (e.g.
  //     "guest declined"). Never a check-in requirement (decision #339).
  //   - `idSightBy`     — the acting staff member's name (a NAME, never
  //     a raw uid — per GOTCHAS "never render a raw staff uid").
  //   - `idSightAt`     — ISO timestamp of the attestation.
  //
  // The legal registry minimum is unchanged: nationality, ID type and
  // ID number stay REQUIRED (RA 11862 / DOT guest registry). Only the
  // photo COPY of the ID became optional.
  idSightStatus?: string | null;
  idSightNote?: string | null;
  idSightBy?: string | null;
  idSightAt?: string | null;
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

export interface IdVerificationState {
  /** The staff attested that the guest's physical ID was sighted. */
  sighted: boolean;
  /** A photo copy of the ID is on file (optional evidence). */
  hasPhoto: boolean;
  /** An optional note recorded with the attestation. */
  note: string;
  /** The acting staff member's name, as recorded at attestation time. */
  sightedBy: string;
  /** ISO timestamp of the attestation. */
  sightedAt: string;
  /** True when the attestation is complete enough for a check-in. */
  complete: boolean;
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

export function getIdVerificationState(input: {
  registration?: CheckInRegistration | null;
  hasPhoto?: boolean;
}): IdVerificationState {
  const reg = input.registration || {};
  const sighted = (reg.idSightStatus || "").trim().toLowerCase() === "sighted";
  const hasPhoto = input.hasPhoto === true;
  const note = (reg.idSightNote || "").trim();
  return {
    sighted,
    hasPhoto,
    note,
    sightedBy: (reg.idSightBy || "").trim(),
    sightedAt: (reg.idSightAt || "").trim(),
    // The attestation alone is the evidence: BOTH the photo and the
    // note are optional (decision #339).
    complete: sighted
  };
}

export function getCheckInReadiness(input: CheckInReadinessInput): CheckInReadiness {
  const missingItems: string[] = [];
  if (!CHECK_IN_ELIGIBLE_STATUSES.includes(input.status as any)) {
    missingItems.push("Booking status must be confirmed or payment-confirmed");
  }

  const registration = input.guestRegistration || {};

  // Per Decision #338 (2026-11-22): the guest ID PHOTO is no longer a
  // check-in blocker. The mandatory ID evidence is the staff
  // attestation that the physical ID was sighted. Per Decision #339
  // the desk's note is OPTIONAL too — the attestation alone is enough.
  const idVerification = getIdVerificationState({
    registration,
    hasPhoto: hasValue(input.guestIdPhotoUrl)
  });
  if (!idVerification.sighted) {
    missingItems.push("Guest ID sighted at the desk");
  }

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
