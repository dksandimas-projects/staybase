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

  // ─── 5. MED-3 G1 build-variant follow-up (operator-reported 2026-08-20) ──
  // Per `plan/features/SPARK-REWARDS.md §Front-desk manual
  // link` follow-up note: the pre-G1 surface only did
  // `bookings.doc(bookingId).get()` so pasting a `SPK-…`
  // or `R-…` ref returned `{ exists: false }` and the
  // catch mapped it to 400 with the verbatim "Booking was
  // not found." message. G1 extends the resolver to accept
  // all three input shapes + tightens the not-found
  // branches to 404 + structured `code: BOOKING_NOT_FOUND`
  // / `code: RESERVATION_NOT_FOUND`.

  describe("MED-3 G1 — resolver accepts bookingRef + reservationRef + doc id", () => {
    it("imports BOOKING_REF_REGEX + RESERVATION_REF_REGEX from @spark-inn/shared", () => {
      expect(membersHandlerSrc).toMatch(
        /import \{[\s\S]*?BOOKING_REF_REGEX[\s\S]*?\} from "@spark-inn\/shared"/
      );
      expect(membersHandlerSrc).toMatch(
        /import \{[\s\S]*?RESERVATION_REF_REGEX[\s\S]*?\} from "@spark-inn\/shared"/
      );
    });

    it("declares the resolveBookingForLink helper with a discriminated-union return type", () => {
      // The helper is the gate the production
      // handler enters BEFORE the transaction. Its
      // return type is the source-of-truth for
      // the toasts + the audit row shape.
      expect(membersHandlerSrc).toMatch(
        /async function resolveBookingForLink\(input: string\)/
      );
      expect(membersHandlerSrc).toMatch(
        /\{ ok: true; bookingId: string; reservationId: string \| null \}/
      );
      expect(membersHandlerSrc).toMatch(
        /\{ ok: false; code: "BOOKING_NOT_FOUND" \| "RESERVATION_NOT_FOUND"; message: string \}/
      );
    });

    // Slice the resolver body from the function
    // declaration to its matching closing `}`. The
    // body has nested braces (the `if`/`else if`
    // branches + the return-object literals), so we
    // use a brace-counting helper (the FOL-02
    // mapper pattern from
    // `fol-02-call-history-mapper-drops.test.ts`).
    function sliceResolverBody(src: string): string {
      const start = src.indexOf("async function resolveBookingForLink(");
      if (start < 0) return "";
      // Must skip past the preceding JSDoc `/** ... */`
      // block — its `{` / `}` (in the type-def lines) would
      // prematurely close the counter. The function's
      // return type also has nested `{` / `}` (the
      // discriminated union), so we find the
      // `> {` pattern (return-type end + body start)
      // rather than the first `{`.
      const jsdocEnd = src.lastIndexOf("*/", start);
      const searchFrom = jsdocEnd > 0 ? jsdocEnd + 2 : start;
      // Look for `> {` — the body opening brace
      // (the return type's `>` is always followed
      // by a space and the body `{`).
      const bodyOpenMatch = src.slice(searchFrom).match(/>\s*\{/);
      if (!bodyOpenMatch || bodyOpenMatch.index === undefined) return "";
      const openIdx = searchFrom + bodyOpenMatch.index + bodyOpenMatch[0].length - 1;
      let depth = 1;
      let i = openIdx + 1;
      while (i < src.length && depth > 0) {
        const ch = src[i];
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        i++;
      }
      return src.slice(start, i);
    }

    it("routes R-… input via reservations.doc(input).get() + reads leadBookingId", () => {
      // The R-… path is the new MRB-aware surface.
      // The pre-G1 doc-id lookup never resolved an
      // R-… ref at all (the doc id was the
      // reservationRef shape, not a Firestore auto-id).
      const resolverBlock = sliceResolverBody(membersHandlerSrc);
      expect(resolverBlock).toMatch(/RESERVATION_REF_REGEX\.test\(trimmed\)/);
      expect(resolverBlock).toMatch(/adminDb\.collection\("reservations"\)\.doc\(trimmed\)\.get\(\)/);
      expect(resolverBlock).toMatch(/leadBookingId/);
    });

    it("routes SPK-… input via bookings.where(bookingRef).limit(1).get()", () => {
      const resolverBlock = sliceResolverBody(membersHandlerSrc);
      expect(resolverBlock).toMatch(/BOOKING_REF_REGEX\.test\(trimmed\)/);
      expect(resolverBlock).toMatch(/where\("bookingRef", "==", trimmed\)/);
      expect(resolverBlock).toMatch(/\.limit\(1\)/);
    });

    it("falls through to the raw doc id path for legacy pre-MRB-01 bookings", () => {
      // Backwards compat: the pre-G1 surface only
      // did `bookings.doc(bookingId).get()`; the
      // raw-id path keeps that contract for
      // pre-MRB-01 + post-MRB-01 child doc ids
      // that staff paste from the bookings table.
      const resolverBlock = sliceResolverBody(membersHandlerSrc);
      expect(resolverBlock).toMatch(/bookingId: trimmed/);
    });

    it("tightens the not-found catch to 404 + structured code: BOOKING_NOT_FOUND / RESERVATION_NOT_FOUND", () => {
      // The pre-G1 mapping was 400 + prose. G1
      // branches on the throw's `BOOKING_NOT_FOUND:`
      // / `RESERVATION_NOT_FOUND:` prefix and
      // surfaces the structured code on the JSON
      // response (per the silent-rate-limit-fallback
      // skill's AFTER pattern). The anchor is the
      // unique `MED-3 G1` docstring + the
      // `RESERVATION_NOT_FOUND:` literal (only the
      // G1 catch block has both).
      const catchBlock = membersHandlerSrc.match(
        /MED-3 G1[\s\S]*?RESERVATION_NOT_FOUND:[\s\S]*?return res\.status\(500\)\.json/
      );
      expect(catchBlock?.[0]).toMatch(/404/);
      expect(catchBlock?.[0]).toMatch(/BOOKING_NOT_FOUND/);
      expect(catchBlock?.[0]).toMatch(/RESERVATION_NOT_FOUND/);
    });

    it("the form placeholder surfaces all three input shapes (SPK-…, R-…, doc id)", () => {
      // The pre-G1 placeholder read "e.g.
      // SPK-2026-0142 or booking doc id" — the
      // staff saw a date that no longer matches
      // any current booking ref AND the
      // reservation ref was missing entirely.
      const placeholder = membersPageSrc.match(
        /placeholder="e\.g\. SPK-20260820-\d+, R-20260820-\d+, or booking doc id"/
      );
      expect(placeholder, "expected the G1 placeholder").not.toBeNull();
    });
  });
});
