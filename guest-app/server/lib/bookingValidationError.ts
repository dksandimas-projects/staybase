// Per NO-ID-A68 (2026-10-27): a validation error raised INSIDE the
// create-booking transaction surfaced as HTTP 500 ("An unexpected
// error occurred during booking creation") instead of HTTP 400.
//
// WHY THIS EXISTS
// ---------------
// The create handler's catch block maps a handful of known messages to
// 400 / 409 / 503 and sends everything else to 500. The SCHEMA parse is
// a 400, but the ~30 errors thrown from inside the transaction body
// were unmapped — including the whole member points-redemption
// validation set.
//
// That means a guest who tried to redeem points with too few points,
// or with an inactive account, got a server error and a generic
// message instead of the reason their request was refused. The
// LOW-1 / BR-03 work already established the pattern this follows: a
// validation error carries its own status and the catch block keeps
// it intact.
//
// This class is that pattern, generalised. It is used ONLY for
// errors that are genuinely the CALLER's fault (their input, their
// account state, or a policy the caller can act on). A genuine
// server fault still surfaces as a 500 — a 500 that means "something
// is broken here" must keep meaning that.
//
// The `status` field is deliberately NOT always 400:
//   400 the request is wrong (too few points, an invalid value)
//   401 the caller must sign in
//   409 the caller's state conflicts with the request (an inactive
//       account, a feature that is switched off)

export class BookingValidationError extends Error {
  status: number;
  constructor(message: string, status: number = 400) {
    super(message);
    this.name = "BookingValidationError";
    this.status = status;
  }
}
