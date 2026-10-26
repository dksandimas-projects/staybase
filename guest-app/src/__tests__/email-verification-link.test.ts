// Per §3.20 + §3.21 (AI-BROWSER-QA 2026-10-26): the guest's email
// verification could not be completed, and the past bookings were never
// linked.
//
// THE DEFECTS THIS SUITE PINS
// ---------------------------
// 1. §3.21 — the verification link the guest receives is produced by the
//    server's `generateEmailVerificationLink`
//    (`guest-app/server/handlers/members.ts`), so it points at Firebase's
//    OWN action handler
//    (`https://<project>.firebaseapp.com/__/auth/action?…&oobCode=…&continueUrl=…`).
//    That handler performs the verification and redirects to the
//    `continueUrl` the server configured — `/account/profile?emailVerified=true`.
//    The app only ever looked for an `oobCode` on its own origin, so the
//    production landing shape (`?emailVerified=true`, NO `oobCode`) was
//    ignored entirely: the guest clicked the link and their email was
//    STILL unverified in the app, the "Verify your email" banner never
//    cleared, and the cached id token kept claiming
//    `email_verified: false` — which made `/api/members/stays` answer
//    403 EMAIL_NOT_VERIFIED.
//
// 2. §3.20 — the registration endpoint only links a guest's past
//    bookings when the email is verified ("Once verified, re-calling
//    `/api/members/register` re-runs the link"). The signup call runs
//    while the email is still unverified, and nothing ever called it
//    again for an already-enrolled member — the profile page's "Join
//    Rewards" button only renders when there is NO member profile. So
//    "My Stays" stayed empty for every email/password member.
//
// The wiring is source-checked here (the guest app's component tests
// are tripwire-style); the behavioural half of §3.20 — "an already
// linked booking is counted but not rewritten" — is pinned by
// `guest-app/tests/api/members-register.test.ts`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const srcRoot = resolve(__dirname, "..");

function read(path: string) {
  return readFileSync(resolve(srcRoot, path), "utf8");
}

describe("the guest email-verification link (§3.20 + §3.21)", () => {
  const authContext = read("context/GuestAuthContext.tsx");

  it("completes the action code when the link carries one", () => {
    expect(authContext).toContain("applyActionCode");
    expect(authContext).toContain('get("oobCode")');
  });

  it("handles the production landing shape — `?emailVerified=true`, no oobCode", () => {
    // Firebase's own action handler performs the verification and
    // redirects to the server's `continueUrl`
    // (`/account/profile?emailVerified=true`). The app must recognise
    // that marker, or the guest clicks the link and nothing changes.
    expect(authContext).toContain('get("emailVerified") === "true"');
  });

  it("refreshes the id token so the `email_verified` claim is true", () => {
    expect(authContext).toContain("getIdToken(true)");
  });

  it("re-runs the registration so the past bookings link", () => {
    expect(authContext).toContain("registerCurrentMember()");
  });

  it("waits for the session instead of refreshing on the first render", () => {
    // The Firebase SDK restores the session ASYNCHRONOUSLY — on the
    // first render `auth.currentUser` is still null. A refresh attempted
    // there silently does nothing and the cached token keeps claiming
    // `email_verified: false`, which is what makes
    // `/api/members/stays` answer 403 EMAIL_NOT_VERIFIED.
    expect(authContext).toMatch(/\[user,\s*verificationNonce\]/);
    expect(authContext).toContain("setVerificationNonce");
  });

  it("only re-registers once the address really is verified", () => {
    // The register endpoint gates the link on `email_verified`; calling it
    // with an unverified token is a no-op, but it must not be treated as
    // a successful link.
    expect(authContext).toMatch(/auth\.currentUser\?\.emailVerified\s*!==\s*true/);
  });

  it("takes the markers out of the URL so a reload does not replay them", () => {
    expect(authContext).toContain("history.replaceState");
  });

  it("the server still generates the link with `handleCodeInApp`", () => {
    const handler = readFileSync(
      resolve(srcRoot, "../server/handlers/members.ts"),
      "utf8"
    );
    expect(handler).toContain("handleCodeInApp: true");
  });

  it("the server's continue URL is the marker the app now reads", () => {
    const handler = readFileSync(
      resolve(srcRoot, "../server/handlers/members.ts"),
      "utf8"
    );
    expect(handler).toContain("/account/profile?emailVerified=true");
  });

  it("remembers a verification that landed on a device with no session", () => {
    // The link usually lands in the guest's phone while the session is
    // on their laptop. That landing has no session, so the registration
    // cannot run there — the flag carries it over to the next sign-in.
    expect(authContext).toContain("PENDING_VERIFICATION_KEY");
    expect(authContext).toContain("localStorage.setItem");
    expect(authContext).toContain("localStorage.removeItem");
  });

  it("re-runs the registration on the next sign-in with a verified address", () => {
    expect(authContext).toMatch(/auth\.currentUser\?\.emailVerified\s*!==\s*true/);
  });
});
