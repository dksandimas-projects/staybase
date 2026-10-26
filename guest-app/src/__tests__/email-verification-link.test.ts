// Per §3.20 + §3.21 (AI-BROWSER-QA 2026-10-26): the guest's email
// verification could not be completed, and the past bookings were never
// linked.
//
// THE DEFECTS THIS SUITE PINS
// ---------------------------
// 1. §3.21 — the server generates the verification link with
//    `handleCodeInApp: true`
//    (`guest-app/server/handlers/members.ts` →
//    `generateEmailVerificationLink`), so the link carries an `oobCode`
//    and the APP has to finish it. The app never called
//    `applyActionCode` / `signInWithEmailLink`, so the guest clicked
//    the link, landed back on
//    `/account/profile?emailVerified=true&oobCode=…`, and their email
//    was STILL unverified. The "Verify your email" banner never
//    cleared.
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

  it("completes the action code the link carries", () => {
    expect(authContext).toContain("applyActionCode");
    expect(authContext).toContain('get("oobCode")');
  });

  it("refreshes the id token so the `email_verified` claim is true", () => {
    expect(authContext).toContain("getIdToken(true)");
  });

  it("re-runs the registration so the past bookings link", () => {
    expect(authContext).toContain("registerCurrentMember()");
  });

  it("takes the code out of the URL so a reload does not replay it", () => {
    expect(authContext).toContain("history.replaceState");
  });

  it("the server still generates the link with `handleCodeInApp`", () => {
    const handler = readFileSync(
      resolve(srcRoot, "../server/handlers/members.ts"),
      "utf8"
    );
    expect(handler).toContain("handleCodeInApp: true");
  });
});
