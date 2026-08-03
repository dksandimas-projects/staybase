export interface CorporateCodeLike {
  isActive: boolean;
  expiresAt: Date | null;
  usageCap: number | null;
  usageCount: number;
}

export interface ValidateCorporateCodeOptions {
  /**
   * Number of uses the caller is about to record against the
   * corporate code. Defaults to 1 to preserve the historical
   * single-room validation contract.
   *
   * Per MRB-08 (2026-08-02, per decision #167): multi-room
   * corporate reservations consume N uses in one create
   * (one room = one use), so the cap check must compare
   * `usageCount + requestedUses` against `usageCap`, not the
   * raw `usageCount`. A `requestedUses <= 0` value is
   * normalised to 1 so misuse (e.g. an undefined coerced to
   * 0) cannot silently bypass the cap.
   */
  requestedUses?: number;
}

export function validateCorporateCode(
  code: CorporateCodeLike,
  now: Date | ValidateCorporateCodeOptions = new Date(),
  options: ValidateCorporateCodeOptions = {}
) {
  // Per MRB-08 (2026-08-02, per decision #167): accept the
  // historical `(code, now)` signature AND the new
  // `(code, options)` signature. The legacy `now` arg is
  // anything that's a `Date` instance; the new `options`
  // arg is a plain object carrying `requestedUses`. The
  // dispatch is at the top of the body so the existing
  // call sites (gate validator, shared/__tests__) keep
  // working byte-equivalent.
  let effectiveNow: Date;
  let requestedUses: number;
  if (now instanceof Date) {
    effectiveNow = now;
    requestedUses = options.requestedUses ?? 1;
  } else {
    effectiveNow = new Date();
    requestedUses = now?.requestedUses ?? 1;
  }
  // `requestedUses` is always at least 1. A zero or
  // negative value would defeat the cap check; an
  // undefined value defaults to 1 (the historical
  // single-room contract).
  if (!Number.isFinite(requestedUses) || requestedUses < 1) {
    requestedUses = 1;
  }

  if (!code.isActive) {
    return { valid: false, error: "Corporate code is inactive." };
  }

  if (code.expiresAt && code.expiresAt < effectiveNow) {
    return { valid: false, error: "Corporate code has expired." };
  }

  if (code.usageCap !== null && code.usageCount + requestedUses > code.usageCap) {
    return {
      valid: false,
      error: requestedUses > 1
        ? `Corporate code usage limit reached: this code allows ${code.usageCap} use(s) and ${code.usageCount} are already recorded; the requested ${requestedUses}-room reservation would exceed the cap.`
        : "Corporate code usage limit reached."
    };
  }

  return { valid: true, error: "" };
}
