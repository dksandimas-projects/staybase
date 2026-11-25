export const CHECK_IN_ELIGIBLE_STATUSES = ["confirmed", "payment-confirmed"] as const;

export interface CheckInRegistration {
  nationality?: string | null;
  address?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  // Per Decision #121 (2026-07-23): purpose of stay defaults to
  // "Leisure". The admin drawer opens with Leisure selected and the
  // staff can choose another supported purpose before saving.
  // Free-text `otherPurpose` is captured when the staff picks "Other"
  // so the front desk has the actual reason (e.g. "wedding", "medical",
  // "long-stay relocation") not just a generic bucket. Per Decision
  // #344 (2026-11-25) neither the purpose nor its reason is required to
  // check a guest in — they are captured when the desk has them.
  purposeOfStay?: string | null;
  otherPurpose?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  emergencyContact?: string | null;
  signatureStatus?: string | null;
  // Per Decision #338 (2026-11-22): the guest ID PHOTO is OPTIONAL at
  // physical check-in, and per Decision #344 (2026-11-25) the desk's
  // attestation is optional too. The attestation is still the strongest
  // ID evidence the system holds, so it is still captured:
  //   - `idSightStatus` — "sighted" once the staff confirms it.
  //   - `idSightNote`   — an OPTIONAL note the desk may record (e.g.
  //     "guest declined"). Never a check-in requirement (decision #339).
  //   - `idSightBy`     — the acting staff member's name (a NAME, never
  //     a raw uid — per GOTCHAS "never render a raw staff uid").
  //   - `idSightAt`     — ISO timestamp of the attestation.
  //
  // PER DECISION #344 (2026-11-25) NOTHING in this interface is
  // REQUIRED to check a guest in any more. Every field is captured
  // when the desk has it, reported as an advisory item when it is
  // blank, and printed on the registration PDF — but a blank field
  // never blocks the check-in, on the client or on the server.
  //
  // COMPLIANCE NOTE (owner call, 2026-11-25): the Philippine guest
  // registry rules (RA 11862 / DOT) expect nationality, ID type and
  // ID number to be recorded for every guest. The desk can still
  // record all of them in one save — the form is right there in the
  // drawer's Check-in tab — but the hotel no longer REFUSES a check-in
  // that leaves them blank. Recording them stays the hotel's
  // operational practice; the refusal is what was removed.
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
  /**
   * True when NOTHING blocks the check-in.
   *
   * Per Decision #344 (2026-11-25) the only remaining hard blocker is
   * the booking STATUS — a booking that has not been confirmed cannot
   * be checked in. Every guest-registry field is optional now.
   */
  ready: boolean;
  /**
   * The HARD blockers. Empty for an eligible booking.
   *
   * This is the list the server reads when it refuses a check-in, so
   * it must stay free of anything advisory — a desk must never be
   * told "you are missing X" when X is optional.
   */
  missingItems: string[];
  /**
   * The guest records that are NOT filled in — ADVISORY ONLY.
   *
   * They are still captured when the desk fills them, they still show
   * on the registration summary + PDF, and they still appear in the
   * drawer's readiness card — but they NEVER block a check-in.
   */
  incompleteItems: string[];
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
  /**
   * True when the desk attested that the physical ID was sighted.
   *
   * Per Decision #344 (2026-11-25) this is EVIDENCE, not a check-in
   * requirement — the desk may check a guest in without it.
   */
  complete: boolean;
}

/**
 * Per Decision #344 (2026-11-25): the guest registry fields are NO
 * LONGER REQUIRED to check a guest in. They are still captured (the
 * desk fills in whatever it has), they still render on the
 * registration summary and the printed PDF, and a blank one is still
 * reported as an ADVISORY item — but a blank one never blocks the
 * check-in, on the client or on the server.
 *
 * The order is the order the desk reads them in.
 */
const ADVISORY_REGISTRATION_FIELDS: Array<{ key: keyof CheckInRegistration; label: string }> = [
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

  // The booking STATUS is the one hard blocker that survives decision
  // #344 — a booking that has not been confirmed is not a stay the
  // desk can check anybody into.
  if (!CHECK_IN_ELIGIBLE_STATUSES.includes(input.status as any)) {
    missingItems.push("Booking status must be confirmed or payment-confirmed");
  }

  const incompleteItems: string[] = [];
  const registration = input.guestRegistration || {};

  // Per Decision #338 (2026-11-22) the guest ID PHOTO was already
  // optional; per Decision #344 the desk's "physical ID sighted"
  // attestation is optional too. Both are still reported so the desk
  // knows what was never written down — neither blocks the check-in.
  const idVerification = getIdVerificationState({
    registration,
    hasPhoto: hasValue(input.guestIdPhotoUrl)
  });
  if (!idVerification.sighted) {
    incompleteItems.push("Guest ID sighted at the desk");
  }

  for (const field of ADVISORY_REGISTRATION_FIELDS) {
    if (!hasValue(registration[field.key])) {
      incompleteItems.push(field.label);
    }
  }

  // Per Decision #121 the "Other" purpose carries a free-text reason
  // ("wedding", "medical", …). It is still worth recording — but a
  // missing reason no longer blocks the check-in.
  if (
    typeof registration.purposeOfStay === "string" &&
    registration.purposeOfStay.trim().toLowerCase() === "other" &&
    !hasValue(registration.otherPurpose)
  ) {
    incompleteItems.push("Purpose of stay (Other — reason not recorded)");
  }

  // The signed physical registration form is still captured — and still
  // printed on the registration PDF — but it no longer gates the
  // check-in.
  if (registration.signatureStatus !== "signed") {
    incompleteItems.push("Guest signature");
  }

  return {
    ready: missingItems.length === 0,
    missingItems,
    incompleteItems
  };
}
