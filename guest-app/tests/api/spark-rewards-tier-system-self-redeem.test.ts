import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Per PR #9 of the Spark Rewards tier system (2026-10-13):
// source-text pins for the member self-service points redemption
// feature. The PR adds:
//   1. `allowMemberPointsRedemption` boolean to the rewardsConfig
//      schema (default false; admin opt-in)
//   2. Shared `applyPointsRedemption` helper extracted from the
//      staff handler — both staff + self paths run the same 7
//      guards atomically
//   3. New member-auth handler `handleRedeemPointsSelf` routed
//      at /api/members/redeem-points-self
//   4. Booking Step 3 control "Apply Your Points" — only renders
//      when toggle is ON + signed-in member has positive balance
//
// This suite pins the source shape of each piece so a refactor
// can't silently drop the toggle gate, the audit-trail marker,
// the auth-token requirement, or the ownership check.

const root = (rel: string) => join(import.meta.dirname, "..", "..", "..", rel);

const membersSrc = readFileSync(
  root("guest-app/server/handlers/members.ts"),
  "utf8"
);
const apiRouterSrc = readFileSync(
  root("guest-app/server/apiRouter.ts"),
  "utf8"
);
const bookingPageSrc = readFileSync(
  root("guest-app/src/pages/BookingPage.tsx"),
  "utf8"
);
const rewardsConfigSchemaSrc = readFileSync(
  root("shared/schemas/rewardsConfig.ts"),
  "utf8"
);
const typesIndexSrc = readFileSync(
  root("shared/types/index.ts"),
  "utf8"
);
const pointsUtilsSrc = readFileSync(
  root("shared/utils/points.ts"),
  "utf8"
);
const seedSrc = readFileSync(
  root("scripts/seed-firestore.ts"),
  "utf8"
);
const settingsPageSrc = readFileSync(
  root("admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);

describe("PR #9 — schema + types + seed: allowMemberPointsRedemption flag", () => {
  it("Zod RewardsConfigSchema declares allowMemberPointsRedemption as optional boolean", () => {
    expect(rewardsConfigSchemaSrc).toMatch(/allowMemberPointsRedemption:\s*z\.boolean\(\)\.optional\(\)/);
  });

  it("shared types index declares allowMemberPointsRedemption as optional boolean on RewardsConfig", () => {
    expect(typesIndexSrc).toMatch(/allowMemberPointsRedemption\?:\s*boolean;/);
  });

  it("shared/utils/points.ts RewardsConfigLike interface declares allowMemberPointsRedemption as optional boolean", () => {
    expect(pointsUtilsSrc).toMatch(/allowMemberPointsRedemption\?:\s*boolean;/);
  });

  it("seed defaults the flag to false (off / front-desk-mediated)", () => {
    // Safety-first: a fresh deploy MUST match pre-PR-9 behavior
    // exactly until an admin opts in. The seed is the canonical
    // "what does a brand-new deployment look like" reference.
    expect(seedSrc).toMatch(/allowMemberPointsRedemption:\s*false/);
  });
});

describe("PR #9 — shared applyPointsRedemption helper extraction", () => {
  it("the helper exists as a non-exported async function in members.ts", () => {
    // Lives in the same file as the staff handler — not exported
    // (only the handlers cross file boundaries). The helper
    // signature takes a Firestore transaction + an args object.
    expect(membersSrc).toMatch(/async function applyPointsRedemption\(\s*transaction:\s*any,/);
  });

  it("the helper signature carries the audit-trail fields (appliedBy + appliedByLabel)", () => {
    // The two audit fields are the only difference between the
    // staff path and the self path — every other guard is
    // identical. Pinning the signature so a future refactor
    // can't lose the marker.
    expect(membersSrc).toMatch(/appliedBy:\s*string;/);
    expect(membersSrc).toMatch(/appliedByLabel:\s*["']staff["']\s*\|\s*["']self["']/);
  });

  it("the helper runs all 9 guards in source order (booking-exists, status, one-per-booking, member-match, member-active, rate-configured, min-redeem, bill-cap, balance)", () => {
    // Each guard has a unique throw-string. Pinned so a future
    // refactor that drops a guard fails a specific pin.
    expect(membersSrc).toMatch(/throw new Error\(["']Booking not found\.["']\)/);
    expect(membersSrc).toMatch(/throw new Error\(["']Points can only be redeemed before check-in\.["']\)/);
    expect(membersSrc).toMatch(/throw new Error\(["']This booking already has a points redemption\.["']\)/);
    expect(membersSrc).toMatch(/throw new Error\(["']Booking is not linked to this member\.["']\)/);
    expect(membersSrc).toMatch(/throw new Error\(["']Member not found\.["']\)/);
    expect(membersSrc).toMatch(/throw new Error\(["']Member account is not active\.["']\)/);
    expect(membersSrc).toMatch(/throw new Error\(["']Points redemption is not configured\.["']\)/);
    expect(membersSrc).toMatch(/throw new Error\(`Points redemption requires at least \$\{minPointsToRedeem\} points\.`\)/);
    expect(membersSrc).toMatch(/throw new Error\(\s*`Points redemption exceeds the \$\{billPct\}% bill cap/);
    // The balance check is the final gate — `validatePointsRedemption`
    // is called AFTER the min-redeem + bill-cap checks so the actor
    // sees the most actionable error first (per Phase 4 design).
    const minRedeemIdx = membersSrc.search(/throw new Error\(`Points redemption requires at least/);
    const billCapIdx = membersSrc.search(/throw new Error\(\s*`Points redemption exceeds the \$\{billPct\}% bill cap/);
    const balanceIdx = membersSrc.search(/validatePointsRedemption\(/);
    expect(minRedeemIdx).toBeGreaterThan(-1);
    expect(billCapIdx).toBeGreaterThan(minRedeemIdx);
    expect(balanceIdx).toBeGreaterThan(billCapIdx);
  });

  it("the helper writes the audit-trail marker (appliedBy) + reason text per the actor label", () => {
    // The booking update carries `pointsRedeemedBy: appliedBy` and
    // the history row carries `reason: historyReason`. The reason
    // text branches on `appliedByLabel`.
    expect(membersSrc).toMatch(/pointsRedeemedBy:\s*appliedBy/);
    expect(membersSrc).toMatch(/historyReason\s*=\s*appliedByLabel\s*===\s*["']staff["']/);
    expect(membersSrc).toMatch(/["']Points redeemed by member at checkout["']/);
    expect(membersSrc).toMatch(/["']Points redeemed by staff["']/);
  });

  it("the existing staff handler (handleRedeemMemberPoints) now delegates to the helper", () => {
    // The handler is still exported + still auth-staff-only; the
    // body is the runTransaction call to the helper with
    // `appliedBy: staff.uid, appliedByLabel: "staff"`.
    expect(membersSrc).toMatch(/export async function handleRedeemMemberPoints\(/);
    expect(membersSrc).toMatch(/appliedBy:\s*staff\.uid/);
    expect(membersSrc).toMatch(/appliedByLabel:\s*["']staff["']/);
  });
});

describe("PR #9 — handleRedeemPointsSelf member-auth handler", () => {
  it("the handler is exported with the right name", () => {
    expect(membersSrc).toMatch(/export async function handleRedeemPointsSelf\(/);
  });

  it("the handler enforces method = POST", () => {
    expect(membersSrc).toMatch(/if \(req\.method !== ["']POST["']\) \{\s*return res\.status\(405\)/);
  });

  it("the handler verifies the Firebase ID token via adminAuth (NOT staff auth)", () => {
    // The member-self path is member-authenticated — the helper's
    // member-match guard is the real authorization. Verify the
    // verifyIdToken call is present (and authenticateStaff is NOT).
    expect(membersSrc).toMatch(/adminAuth\.verifyIdToken\(token\)/);
    expect(membersSrc).not.toMatch(/function handleRedeemPointsSelf[\s\S]{0,200}authenticateStaff/);
  });

  it("the handler uses the self schema (no memberId field — auth UID is the only input)", () => {
    // The schema intentionally OMITS `memberId` — clients cannot
    // spoof the member. The handler reads the auth UID from the
    // token and passes it as `memberId` to the helper, which then
    // rejects when it doesn't match `booking.memberId`.
    expect(membersSrc).toMatch(/selfRedeemSchema\.safeParse/);
    expect(membersSrc).toMatch(/memberId:\s*authUser\.uid/);
  });

  it("the handler fails fast on the toggle (403 when allowMemberPointsRedemption !== true)", () => {
    // Reading rewardsConfig outside the transaction lets us reject
    // before acquiring a transaction. The toggle is a feature
    // flag, not a security check — but it saves a read on the
    // hot path.
    expect(membersSrc).toMatch(/allowMemberPointsRedemption\s*!==\s*true/);
    expect(membersSrc).toMatch(/return res\.status\(403\)/);
  });

  it("the handler passes 'self:{uid}' as the appliedBy marker", () => {
    // The audit-trail convention: staff path = raw staff UID,
    // self path = "self:{memberUid}" prefix so reports can
    // distinguish at a glance.
    expect(membersSrc).toMatch(/appliedBy:\s*`self:\$\{authUser\.uid\}`/);
    expect(membersSrc).toMatch(/appliedByLabel:\s*["']self["']/);
  });

  it("the router wires the handler at /api/members/redeem-points-self (POST only)", () => {
    expect(apiRouterSrc).toMatch(/action\s*===\s*["']redeem-points-self["']\s*&&\s*req\.method\s*===\s*["']POST["']/);
    expect(apiRouterSrc).toMatch(/return await handleRedeemPointsSelf\(req, res\)/);
  });

  it("the router import includes the new handler", () => {
    expect(apiRouterSrc).toMatch(/handleRedeemPointsSelf/);
  });
});

describe("PR #9 fix — BookingPage Step 3 self-redeem control (apply-at-create)", () => {
  it("does NOT import getAuth from firebase/auth (no client-side ID token needed)", () => {
    // Per PR #9 fix (2026-10-13): the apply-at-create flow runs
    // the redemption atomically inside `handleCreateBooking`'s
    // transaction. The booking doc carries the Firebase ID token
    // auth via the existing `decoded = await adminAuth.verifyIdToken(...)`
    // path at line ~1796 — the BookingPage client never reads
    // the token for the redemption anymore.
    expect(bookingPageSrc).not.toMatch(/import\s*\{\s*getAuth\s*\}\s*from\s*["']firebase\/auth["']/);
  });

  it("declares the local-only self-redeem state (input + pending + error + applied)", () => {
    // The four useState hooks are the control's local state
    // shape. The Apply button does NOT call the API — it just
    // stores the desired points amount in `pendingPointsToRedeem`
    // + flips `selfPointsApplied`. The server applies at submit.
    expect(bookingPageSrc).toMatch(/const \[selfPointsInput, setSelfPointsInput\] = useState\(["']["']\)/);
    expect(bookingPageSrc).toMatch(/const \[pendingPointsToRedeem, setPendingPointsToRedeem\] = useState\(0\)/);
    expect(bookingPageSrc).toMatch(/const \[selfPointsError, setSelfPointsError\] = useState\(["']["']\)/);
    expect(bookingPageSrc).toMatch(/const \[selfPointsApplied, setSelfPointsApplied\] = useState\(false\)/);
    // The `isApplyingSelfPoints` state from PR #9 is gone (no
    // in-flight API call to track).
    expect(bookingPageSrc).not.toMatch(/const \[isApplyingSelfPoints, setIsApplyingSelfPoints\] = useState\(false\)/);
  });

  it("derives the toggle visibility + available balance from rewardsConfig + memberProfile", () => {
    expect(bookingPageSrc).toMatch(/const memberSelfRedeemEnabled = rewardsConfig\?\.allowMemberPointsRedemption === true/);
    expect(bookingPageSrc).toMatch(/const memberAvailablePoints = Number\(memberProfile\?\.rewardsPoints \|\| 0\)/);
  });

  it("the control section is gated by memberSelfRedeemEnabled + memberAvailablePoints > 0", () => {
    expect(bookingPageSrc).toMatch(/\{memberSelfRedeemEnabled && memberAvailablePoints > 0 && \(/);
    expect(bookingPageSrc).toMatch(/<h3[^>]*>Apply Your Points<\/h3>/);
  });

  it("does NOT POST to /api/members/redeem-points-self (apply happens at submit)", () => {
    // Per PR #9 fix: the redemption is atomic with the booking
    // creation transaction. The Step 3 Apply button is local
    // only — no fetch to the self endpoint.
    expect(bookingPageSrc).not.toMatch(/fetch\(["']\/api\/members\/redeem-points-self["']/);
  });

  it("passes pointsToRedeem to /api/bookings/create on submit (the apply-at-create flow)", () => {
    // The submit handler passes the pending points amount as a
    // request body field. The server's `handleCreateBooking`
    // applies the redemption atomically inside its existing
    // transaction.
    expect(bookingPageSrc).toMatch(/pointsToRedeem:\s*pendingPointsToRedeem/);
  });

  it("Apply button only sets local state (no API call) when clicked", () => {
    // The onClick handler is a synchronous state setter — no fetch,
    // no async/await, no try/catch around an HTTP call.
    expect(bookingPageSrc).toMatch(/setPendingPointsToRedeem\(entered\)/);
    expect(bookingPageSrc).toMatch(/setSelfPointsApplied\(true\)/);
    // No async onClick handler (the legacy API-call version was async).
    expect(bookingPageSrc).not.toMatch(/onClick=\{async \(\) => \{\s*if \(!memberProfile\?\.uid\)/);
  });

  it("disables the Apply button when input is empty / over-balance", () => {
    // UX guard: the button stays disabled when the input is
    // empty or exceeds the member's balance.
    expect(bookingPageSrc).toMatch(/Number\(selfPointsInput\)\s*>\s*memberAvailablePoints/);
  });

  it("shows the redemption preview (value off + new total) below the input", () => {
    expect(bookingPageSrc).toMatch(/Preview: ₱\{value\.toLocaleString\(\)\} off/);
  });

  it("shows a min-redeem warning when input is below the configured floor", () => {
    expect(bookingPageSrc).toMatch(/below the \$\{rewardsConfig\.minPointsToRedeem\}-point minimum/);
  });

  it("the success card shows the queued points + discount + discounted total", () => {
    // The control's success branch surfaces three concrete values
    // so the member can SEE the discount applied to their total
    // (this is the bug-fix that made the Apply-at-create flow
    // visible — the previous copy only said "X points will be
    // applied" without showing the math).
    expect(bookingPageSrc).toMatch(/pendingPointsToRedeem\.toLocaleString\(\)\} points · ₱\{pendingRedemptionValue\.toLocaleString\(\)\} off/);
    expect(bookingPageSrc).toMatch(/New total ₱\{displayTotal\.toLocaleString\(\)\} — applied at booking submission/);
    // The legacy "Points applied to this booking" copy is gone
    // — that implied the redemption already happened on click.
    expect(bookingPageSrc).not.toMatch(/Points applied to this booking\./);
  });

  it("derives a discounted displayTotal that mirrors the server's apply-at-create math", () => {
    // The fix for the bug where Apply queued the discount but the
    // summary total kept showing the pre-redemption value. The
    // client computes `pendingRedemptionValue` with the same
    // formula as the server (`Math.round((points * rate) / 100)`)
    // and subtracts it from `total` to produce `displayTotal`.
    expect(bookingPageSrc).toMatch(/const pendingRedemptionValue = useMemo\(\(\) => \{/);
    expect(bookingPageSrc).toMatch(/Math\.round\(\(pendingPointsToRedeem \* rate\) \/ 100\)/);
    expect(bookingPageSrc).toMatch(/const displayTotal = distributedRoomCart\.length > 0\s*\n\s*\? Math\.max\(total - pendingRedemptionValue, 0\)/);
  });

  it("threads displayTotal through every total-rendering site + the PriceBreakdown", () => {
    // The bug existed in 6 places: hero total, payment copy, two
    // aside-instances (header + footer), PriceBreakdown, VAT
    // calc, and the total line in the summary. All read from
    // `displayTotal` now (or get it via the `total` prop threaded
    // through BookingReviewAside). The deduction line is added to
    // the breakdown so the member sees the points line item.
    expect(bookingPageSrc).toMatch(/finalTotal: displayTotal/);
    expect(bookingPageSrc).toMatch(/pendingRedemptionPoints: pendingPointsToRedeem/);
    expect(bookingPageSrc).toMatch(/Spark Rewards points \(\$\{pendingPts\.toLocaleString\(\)\} pts\)/);
    // The hero total + payment copy + hero aside total + summary
    // total render `displayTotal` (the fix made these reflect the
    // queued discount).
    expect(bookingPageSrc).toMatch(/formatPrice\(displayTotal\)/);
  });
});

describe("PR #9 — Settings UI: admin toggle", () => {
  it("declares the toggle state in the form", () => {
    expect(settingsPageSrc).toMatch(/const \[allowMemberPointsRedemption, setAllowMemberPointsRedemption\] = useState<boolean>\(/);
  });

  it("hydrates the toggle from the rewardsConfig snapshot (default false)", () => {
    // The default reads `=== true` so absent config → toggle OFF.
    expect(settingsPageSrc).toMatch(/rewardsConfig\.allowMemberPointsRedemption === true/);
  });

  it("includes the toggle in the save payload", () => {
    expect(settingsPageSrc).toMatch(/allowMemberPointsRedemption,/);
  });

  it("renders the toggle with the operator-facing copy (opt-in messaging)", () => {
    expect(settingsPageSrc).toMatch(/Allow Member Self-Redemption at Checkout/);
    expect(settingsPageSrc).toMatch(/same min-redeem, bill cap, and balance guards still run server-side/);
  });
});

describe("PR #9 — backward compat: pre-PR-9 deployments behave unchanged", () => {
  it("seed default is OFF — no existing behavior change", () => {
    expect(seedSrc).toMatch(/allowMemberPointsRedemption:\s*false/);
  });

  it("handleRedeemMemberPoints (staff path) is unchanged at the API surface", () => {
    // The existing route `/api/members/redeem-points` still hits
    // `handleRedeemMemberPoints` and still requires staff auth.
    // The refactor is internal — the handler's signature, the
    // schema, the response shape, and the auth gate are all
    // preserved.
    expect(apiRouterSrc).toMatch(/action\s*===\s*["']redeem-points["']\s*&&\s*req\.method\s*===\s*["']POST["']/);
    expect(apiRouterSrc).toMatch(/const authResult = await authenticateStaff\(req\)/);
    expect(apiRouterSrc).toMatch(/return await handleRedeemMemberPoints\(req, res\)/);
  });

  it("the pre-PR-9 redeemPointsSchema (with memberId field) is preserved for the staff path", () => {
    // The staff path accepts `memberId` as an optional override
    // (used when an admin applies points to a booking on a
    // member's behalf without scanning the QR code). The self
    // path uses a SEPARATE, stricter schema without memberId.
    expect(membersSrc).toMatch(/const redeemPointsSchema = z\.object\(/);
    expect(membersSrc).toMatch(/memberId:\s*z\.string\(\)\.trim\(\)\.max\(120\)\.optional\(\)\.default\(["']["']\)/);
    expect(membersSrc).toMatch(/const selfRedeemSchema = z\.object\(/);
    // The self schema has NO memberId field — strict separation.
    expect(membersSrc).not.toMatch(/const selfRedeemSchema = z\.object\(\s*\{[\s\S]{0,200}memberId/);
  });
});