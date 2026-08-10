import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per RFO-01 (Reservation-lookup Form-Open surface, 2026-08-10,
// decision #209): the MRB-09 reservation-scope emails expose
// the `R-YYYYMMDD-NNNNN` reservation ref to the guest, but the
// /my-booking page could not actually use it — the form's ref
// field was hardcoded to `SI-…` only, the auto-lookup useEffect
// only read `?ref=`, and `lookupUrl()` in email.ts generated
// `?ref=<SI>&token=<token>` deep links. The R- ref the guest
// saw in the email subject was decorative.
//
// This change wires the spec end-to-end:
// 1. The MRB-09 email deep link generates
//    `?reservationRef=…&email=…` for reservation-scope views
//    (the N=1 path stays byte-equivalent on `?ref=<SI>&token=`).
// 2. The page's auto-lookup useEffect reads `?reservationRef=`
//    in addition to `?ref=` + `?token=` + `?email=`.
// 3. The form's ref field accepts both `SI-…` and `R-…`,
//    routed client-side via the shared `RESERVATION_REF_REGEX`.
// 4. The reservation-scope path requires a second factor
//    (the lead guest's email), so a bare R- ref is not
//    enough to enumerate reservations (mirrors the
//    `handleLookupBooking` 400 response).

const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/email.ts"),
  "utf8"
);

const lookupPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingLookupPage.tsx"),
  "utf8"
);

const sharedIndexSrc = readFileSync(
  resolve(__dirname, "../../../shared/index.ts"),
  "utf8"
);

describe("RFO-01 — email lookupUrl emits reservationRef+email for reservation-scope", () => {
  it("the helper branches on reservationRef + guestEmail and emits ?reservationRef=…&email=…", () => {
    // The new branch reads both fields and
    // emits a different URL shape than the
    // per-child SI-+token path. The legacy
    // shape is the byte-equivalent fallback
    // for the N=1 + per-child email case.
    expect(emailHandlerSrc).toMatch(
      /function lookupUrl\(booking: any\) \{[\s\S]*?const reservationRef = String\(booking\.reservationRef \|\| ""\)\.trim\(\)/
    );
    expect(emailHandlerSrc).toMatch(
      /if \(reservationRef && leadGuestEmail\) \{/
    );
    expect(emailHandlerSrc).toMatch(
      /\/my-booking\?reservationRef=\$\{encodeURIComponent\(reservationRef\)\}&email=\$\{encodeURIComponent\(leadGuestEmail\.toLowerCase\(\)\)\}/
    );
  });

  it("the legacy SI-+token shape is the fallback when reservationRef is missing", () => {
    // N=1 (no reservation header) and the per-child
    // resend path keep the byte-equivalent
    // `?ref=<SI>&token=<token>` URL. The fallback
    // must still exist so the existing magic-link
    // emails continue to work.
    expect(emailHandlerSrc).toMatch(
      /if \(!ref \|\| !token\) return siteUrl\("\/my-booking"\)/
    );
    expect(emailHandlerSrc).toMatch(
      /return siteUrl\(`\/my-booking\?ref=\$\{ref\}&token=\$\{token\}`\)/
    );
  });

  it("the email lead-guest email is lowercased before URL-encoding", () => {
    // The server's `handleLookupBooking` lowercases
    // the email on read (the zod schema runs
    // `.toLowerCase()`), so the URL must match
    // case-insensitively. Encode the lowercased
    // value so the page's prefill + the server's
    // email-second-factor gate line up.
    expect(emailHandlerSrc).toMatch(
      /leadGuestEmail\.toLowerCase\(\)/
    );
  });
});

describe("RFO-01 — BookingLookupPage auto-lookup reads ?reservationRef=", () => {
  it("the useEffect reads searchParams.get(\"reservationRef\") and routes to performLookup", () => {
    expect(lookupPageSrc).toMatch(
      /const reservationRef = searchParams\.get\("reservationRef"\)/
    );
  });

  it("the reservationRef branch is taken in priority over the legacy ?ref= branch", () => {
    // When both are present (a malformed email, or a
    // backward-compat test), the reservation-scope
    // path wins. The signature guard keys off the
    // active ref to dedupe the auto-lookup.
    const effect = lookupPageSrc.match(
      /useEffect\(\(\) => \{[\s\S]*?\}, \[searchParams, turnstileToken\]\);/
    );
    expect(effect, "expected the auto-lookup useEffect").toBeTruthy();
    expect(effect![0]).toMatch(/const reservationRef = searchParams\.get\("reservationRef"\)/);
    expect(effect![0]).toMatch(/if \(reservationRef\) \{/);
    expect(effect![0]).toMatch(/void performLookup\("", email \|\| undefined, token \|\| undefined, reservationRef\)/);
  });

  it("a reservationRef deep link without a credential renders the form (not a hard error)", () => {
    // The bare R- path requires a credential
    // (email or token). The page should NOT
    // auto-lookup with a missing credential —
    // it returns early so the form is visible
    // and the guest can fill in the missing
    // piece. Mirrors the server's 400 reply.
    const effect = lookupPageSrc.match(
      /useEffect\(\(\) => \{[\s\S]*?\}, \[searchParams, turnstileToken\]\);/
    );
    expect(effect).toBeTruthy();
    expect(effect![0]).toMatch(
      /if \(reservationRef && !token && !email\) return/
    );
  });

  it("the prefill uses the reservationRef when present, the legacy ref otherwise", () => {
    const effect = lookupPageSrc.match(
      /useEffect\(\(\) => \{[\s\S]*?\}, \[searchParams, turnstileToken\]\);/
    );
    expect(effect).toBeTruthy();
    expect(effect![0]).toMatch(/if \(reservationRef\) \{[\s\S]*?setRefInput\(reservationRef\)/);
  });
});

describe("RFO-01 — BookingLookupPage form routes R- inputs through reservationRef", () => {
  it("imports the shared RESERVATION_REF_REGEX", () => {
    // The shared utility is the single source of
    // truth for the R-YYYYMMDD-NNNNN shape. The
    // server's lookupSchema and the page's form
    // both read from it; a regex drift would
    // surface as a 400 from the server.
    expect(sharedIndexSrc).toMatch(/export \* from "\.\/utils\/references"/);
    expect(lookupPageSrc).toMatch(
      /import \{ GUEST_CANCELLABLE_STATUSES, RESERVATION_REF_REGEX, resolvePaymentMethodLabel, scaleIn \} from "@spark-inn\/shared"/
    );
  });

  it("the form submit detects R-YYYYMMDD-NNNNN and routes to performLookup with reservationRef", () => {
    // The form's ref field is a single input that
    // accepts both SI- and R- shapes. Client-side
    // dispatch keeps the form's UX simple — the
    // guest pastes whatever the email subject
    // carries and the page figures out the rest.
    const handleSearch = lookupPageSrc.match(
      /const handleSearch = async \(e: React\.FormEvent\) => \{[\s\S]*?\};/
    );
    expect(handleSearch, "expected handleSearch").toBeTruthy();
    expect(handleSearch![0]).toMatch(/RESERVATION_REF_REGEX\.test\(trimmedRef\)/);
    expect(handleSearch![0]).toMatch(
      /await performLookup\("", trimmedEmail, undefined, trimmedRef\)/
    );
  });

  it("a bare R- ref without an email shows a clear inline error", () => {
    // The reservation-scope path requires a
    // second factor. The page mirrors the
    // server's 400 copy so the guest sees the
    // next step without round-tripping the
    // form. Copy is intentionally consistent
    // with `handleLookupBooking`'s reply.
    const handleSearch = lookupPageSrc.match(
      /const handleSearch = async \(e: React\.FormEvent\) => \{[\s\S]*?\};/
    );
    expect(handleSearch).toBeTruthy();
    expect(handleSearch![0]).toMatch(
      /Please enter the email you used to book alongside the reservation reference\./
    );
  });

  it("the ref input label + placeholder surface both reference shapes", () => {
    // The label and placeholder are the
    // guest's first hint that the field
    // accepts two ref types. The text is
    // concise so the form stays compact.
    expect(lookupPageSrc).toMatch(/Booking or Reservation Reference/);
    expect(lookupPageSrc).toMatch(
      /placeholder="e\.g\. SI-20260612-042 or R-20260815-00012"/
    );
  });
});

describe("RFO-01 — performLookup signature accepts reservationRef", () => {
  it("the function takes a 4th optional reservationRef arg and routes it in the payload", () => {
    // The signature is what enables both the
    // deep-link auto-lookup and the form submit
    // to share a single performLookup. The
    // payload branch is the runtime contract
    // the server's lookupSchema reads.
    const fn = lookupPageSrc.match(
      /const performLookup = async \(\s*bookingRef: string,\s*guestEmail\?: string,\s*token\?: string,\s*reservationRef\?: string\s*\) => \{[\s\S]*?\n  \};/m
    );
    expect(fn, "expected performLookup signature").toBeTruthy();
    expect(fn![0]).toMatch(/payload\.reservationRef = reservationRef/);
  });

  it("the reservationRef branch sets the auth mode to email when an email is supplied", () => {
    // The auth mode drives the cancel + resend
    // re-validation contract (H2 hardening).
    // For the reservation-scope path, the email
    // is the second factor so the mode is
    // "email" and the cached token stays empty.
    const fn = lookupPageSrc.match(
      /const performLookup = async \(\s*bookingRef: string,\s*guestEmail\?: string,\s*token\?: string,\s*reservationRef\?: string\s*\) => \{[\s\S]*?\n  \};/m
    );
    expect(fn).toBeTruthy();
    expect(fn![0]).toMatch(
      /if \(reservationRef\) \{[\s\S]*?setLookupAuthMode\("email"\)/
    );
  });
});
