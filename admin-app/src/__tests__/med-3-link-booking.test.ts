// Regression test for fix/spark-rewards-med-3-link-booking (2026-07-29).
// Per Spark Rewards audit 2026-07-18 MED-3 (decision #135) — the
// front-desk manual-link surface for "different email" booking
// reconciliation. The build variant is intentionally smaller than
// the guest self-service prompt, so this test pins the wiring so a
// future refactor can't silently drop the surface.
//
// Source-text pattern (matches walkin-split-name.test.ts and
// modal-backdrop-z-index.test.ts style) because the failure mode
// here is a wiring/copy regression, not a JS behavior — the JS
// behavior is covered by the server test
// `guest-app/tests/api/members-link-booking.test.ts`.
//
// Coverage:
//   1. Server route exists at /api/members/link-booking, is
//      POST-only, and is wired through authenticateStaff + admin-
//      only role gate (mirrors manual-adjust).
//   2. Server handler `handleLinkBookingToMember` exists in
//      `guest-app/server/handlers/members.ts`, returns the
//      expected response shape (bookingRef, alreadyLinked), and
//      refuses cancelled / test-run / already-different-member
//      bookings with the expected status codes.
//   3. AdminContext exposes a `linkBookingToMember` function with
//      the right shape and posts to the right endpoint with the
//      auth bearer token.
//   4. MembersPage renders a "Link Existing Booking" form inside
//      the drawer with the right fields + the right submit handler
//      + the right reasons copy.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const apiRouterSrc = read("guest-app/server/apiRouter.ts");
const membersHandlerSrc = read("guest-app/server/handlers/members.ts");
const adminContextSrc = read("admin-app/src/context/AdminContext.tsx");
const membersPageSrc = read("admin-app/src/pages/MembersPage.tsx");

describe("fix/spark-rewards-med-3-link-booking — front-desk manual link (decision #135)", () => {
  // ─── 1. Server route wiring ─────────────────────────────────────

  describe("Server route /api/members/link-booking", () => {
    it("exists in apiRouter.ts, gated on POST + authenticateStaff + admin role", () => {
      // The route block must mirror the manual-adjust posture:
      // POST, staff auth, admin-only. A regression that loosens
      // the role gate (e.g. accepts front-desk) or drops the
      // staff auth check would let non-admins link arbitrary
      // bookings to arbitrary members.
      const routeBlock = apiRouterSrc.match(
        /domain === "members" && action === "link-booking"[\s\S]*?handleLinkBookingToMember\(req, res\)/
      );
      expect(routeBlock, "expected a /api/members/link-booking route block").not.toBeNull();
      expect(routeBlock?.[0]).toMatch(/req\.method === "POST"/);
      expect(routeBlock?.[0]).toMatch(/authenticateStaff\(req\)/);
      expect(routeBlock?.[0]).toMatch(/authResult\.role !== "admin"/);
      expect(routeBlock?.[0]).toMatch(/403/);
    });

    it("is rate-limited to 10/min/IP (mirrors manual-adjust + set-active)", () => {
      const routeBlock = apiRouterSrc.match(
        /domain === "members" && action === "link-booking"[\s\S]*?handleLinkBookingToMember\(req, res\)/
      );
      expect(routeBlock?.[0]).toMatch(/isRateLimited\(`members-link-booking:\$\{ip\}`, 10, 60000\)/);
      expect(routeBlock?.[0]).toMatch(/429/);
    });

    it("imports handleLinkBookingToMember from the members handler", () => {
      expect(apiRouterSrc).toMatch(
        /import \{[^}]*handleLinkBookingToMember[^}]*\} from "\.\/handlers\/members"/
      );
    });
  });

  // ─── 2. Server handler contract ─────────────────────────────────

  describe("handleLinkBookingToMember", () => {
    it("is exported from guest-app/server/handlers/members.ts", () => {
      expect(membersHandlerSrc).toMatch(/export async function handleLinkBookingToMember\(/);
    });

    it("uses a Zod schema that requires memberUid + bookingId + non-empty reason (1..500)", () => {
      const schemaBlock = membersHandlerSrc.match(
        /const linkBookingToMemberSchema = z\.object\(\{[\s\S]*?\}\)\.strict\(\)/
      );
      expect(schemaBlock, "expected the linkBookingToMemberSchema Zod schema").not.toBeNull();
      expect(schemaBlock?.[0]).toMatch(/memberUid:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(160\)/);
      expect(schemaBlock?.[0]).toMatch(/bookingId:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(160\)/);
      expect(schemaBlock?.[0]).toMatch(/reason:\s*z\.string\(\)\.trim\(\)\.min\(1\)\.max\(500\)/);
      expect(schemaBlock?.[0]).toMatch(/\.strict\(\)/);
    });

    it("rejects non-POST methods with 405", () => {
      const handlerBlock = membersHandlerSrc.match(
        /export async function handleLinkBookingToMember[\s\S]*?\n\}\n/
      );
      expect(handlerBlock?.[0]).toMatch(/req\.method !== "POST"/);
      expect(handlerBlock?.[0]).toMatch(/res\.status\(405\)/);
    });

    it("rejects front-desk callers with 403 + 'Only admins' copy", () => {
      const handlerBlock = membersHandlerSrc.match(
        /export async function handleLinkBookingToMember[\s\S]*?\n\}\n/
      );
      expect(handlerBlock?.[0]).toMatch(/staff\.role !== "admin"/);
      expect(handlerBlock?.[0]).toMatch(/res\.status\(403\)/);
      expect(handlerBlock?.[0]).toMatch(/Only admins can link bookings to a member/);
    });

    it("rejects cancelled bookings + test-run bookings with 400", () => {
      const handlerBlock = membersHandlerSrc.match(
        /export async function handleLinkBookingToMember[\s\S]*?\n\}\n/
      );
      expect(handlerBlock?.[0]).toMatch(/bookingStatus === "cancelled"/);
      expect(handlerBlock?.[0]).toMatch(/bookingTestRunId/);
      expect(handlerBlock?.[0]).toMatch(/Cancelled bookings cannot be linked to a member/);
      expect(handlerBlock?.[0]).toMatch(/Test-run bookings cannot be linked to a member/);
    });

    it("rejects bookings already linked to a different member with 409", () => {
      const handlerBlock = membersHandlerSrc.match(
        /export async function handleLinkBookingToMember[\s\S]*?\n\}\n/
      );
      expect(handlerBlock?.[0]).toMatch(/existingMemberId && existingMemberId !== memberUid/);
      // The 409 is computed in the catch block (`: 409` inside a
      // ternary that drives `res.status(status)`) rather than a
      // direct `res.status(409)` call — match the literal `409` in
      // either form.
      expect(handlerBlock?.[0]).toMatch(/409/);
      expect(handlerBlock?.[0]).toMatch(/already linked to a different member/i);
    });

    it("writes a bookings/audit/records/{id} audit row (mirrors erasure audit shape)", () => {
      const handlerBlock = membersHandlerSrc.match(
        /export async function handleLinkBookingToMember[\s\S]*?\n\}\n/
      );
      expect(handlerBlock?.[0]).toMatch(/collection\("bookings"\)\.doc\("audit"\)\.collection\("records"\)/);
      expect(handlerBlock?.[0]).toMatch(/action: "manual-link-member"/);
      expect(handlerBlock?.[0]).toMatch(/fromMemberId/);
      expect(handlerBlock?.[0]).toMatch(/toMemberId/);
      expect(handlerBlock?.[0]).toMatch(/staffUid: staff\.uid/);
      expect(handlerBlock?.[0]).toMatch(/staffRole: staff\.role/);
    });

    it("returns bookingRef + alreadyLinked on success", () => {
      const handlerBlock = membersHandlerSrc.match(
        /export async function handleLinkBookingToMember[\s\S]*?\n\}\n/
      );
      expect(handlerBlock?.[0]).toMatch(/bookingRef: bookingData\.bookingRef \|\| ""/);
      expect(handlerBlock?.[0]).toMatch(/alreadyLinked/);
      expect(handlerBlock?.[0]).toMatch(/res\.status\(200\)/);
    });
  });

  // ─── 3. AdminContext wiring ─────────────────────────────────────

  describe("AdminContext.linkBookingToMember", () => {
    it("is declared on the AdminContextValue interface with the right shape", () => {
      expect(adminContextSrc).toMatch(
        /linkBookingToMember:\s*\(memberUid:\s*string,\s*bookingId:\s*string,\s*reason:\s*string\)/
      );
      // The return type carries alreadyLinked + bookingRef so the
      // UI can render a softer "already linked" message vs a fresh
      // success toast.
      expect(adminContextSrc).toMatch(
        /Promise<\{\s*success:\s*boolean;\s*error\?:\s*string;\s*alreadyLinked\?:\s*boolean;\s*bookingRef\?:\s*string/
      );
    });

    it("posts to /api/members/link-booking with the staff ID token", () => {
      // The client must forward the auth bearer token so the
      // server-side authenticateStaff check works. A regression
      // that dropped the Authorization header would turn every
      // call into a 401.
      //
      // Anchor the match to the next function declaration
      // (`// Intercom log (inbox) state`) so the lazy `[\s\S]*?`
      // captures the whole linkBookingToMember body — including
      // both `Failed to link booking to member.` error returns
      // (try + catch) and the final closing `};`.
      const fnBlock = adminContextSrc.match(
        /const linkBookingToMember = async \([\s\S]*?const \[intercoms, setIntercoms\] = useState/
      );
      expect(fnBlock, "expected the linkBookingToMember function body").not.toBeNull();
      // The fetch call resolves `getApiBaseUrl()` + the route
      // string. We match the route literally and the URL-builder
      // shape loosely to avoid template-literal escaping noise.
      expect(fnBlock?.[0]).toMatch(/getApiBaseUrl\(\)\.replace/);
      expect(fnBlock?.[0]).toMatch(/\/api\/members\/link-booking/);
      expect(fnBlock?.[0]).toMatch(/Bearer \$\{token\}/);
      expect(fnBlock?.[0]).toMatch(/JSON\.stringify\(\{ memberUid, bookingId, reason \}\)/);
    });

    it("is exposed on the context value so MembersPage can read it", () => {
      expect(adminContextSrc).toMatch(/linkBookingToMember,/);
    });
  });

  // ─── 4. MembersPage drawer form ─────────────────────────────────

  describe("MembersPage 'Link Existing Booking' form", () => {
    it("renders the form inside the drawer, gated on selectedMember", () => {
      const formBlock = membersPageSrc.match(
        /<form onSubmit=\{handleLinkBooking\}[\s\S]*?<\/form>/
      );
      expect(formBlock, "expected the handleLinkBooking form").not.toBeNull();
      expect(formBlock?.[0]).toMatch(/Link Existing Booking/);
      expect(formBlock?.[0]).toMatch(/Booking ID or Reference/);
      expect(formBlock?.[0]).toMatch(/Audited Reason for Link/);
    });

    it("surfaces the member's email in the helper copy so the staff sees the mismatch context", () => {
      const formBlock = membersPageSrc.match(
        /<form onSubmit=\{handleLinkBooking\}[\s\S]*?<\/form>/
      );
      expect(formBlock?.[0]).toMatch(/selectedMember\.email/);
      // The copy should explicitly call out the "different email"
      // case the audit's MED-3 is about.
      expect(formBlock?.[0]).toMatch(/account email/i);
      expect(formBlock?.[0]).toMatch(/differs from/i);
    });

    it("forwards memberUid + bookingId + reason to the context", () => {
      const handlerBlock = membersPageSrc.match(
        /const handleLinkBooking = async \(e: React\.FormEvent\)[\s\S]*?setLinkReason\(""\);\s*\};/
      );
      expect(handlerBlock, "expected handleLinkBooking").not.toBeNull();
      expect(handlerBlock?.[0]).toMatch(/linkBookingToMember\(\s*selectedMember\.id/);
      expect(handlerBlock?.[0]).toMatch(/linkBookingRef\.trim\(\)/);
      expect(handlerBlock?.[0]).toMatch(/linkReason\.trim\(\)/);
    });

    it("shows a softer 'already linked' info toast when the server says alreadyLinked: true", () => {
      const handlerBlock = membersPageSrc.match(
        /const handleLinkBooking = async \(e: React\.FormEvent\)[\s\S]*?setLinkReason\(""\);\s*\};/
      );
      expect(handlerBlock?.[0]).toMatch(/result\.alreadyLinked/);
      expect(handlerBlock?.[0]).toMatch(/toast\.info/);
    });
  });
});
