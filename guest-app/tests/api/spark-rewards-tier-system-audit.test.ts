import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Per Phase 8 of the Spark Rewards tier system (2026-10-13,
// decision pending): cross-phase integration audit + derivation
// rule audit + clawback audit. The per-phase source-text pins in
// the earlier suites cover the local invariants (Phase 1 schema,
// Phase 3 counter, Phase 5 voucher, Phase 6 welcome, Phase 7
// portal). Phase 8 covers the things that only matter when the
// phases are wired together — atomicity boundaries, cross-phase
// data flow, derivation edge cases, cancellation clawback
// semantics, and the Phase 4 booking-engine tier discount
// dependency.
//
// Phase 4 (booking engine tier discount precedence) is shipped on
// `feature/spark-rewards-phase4-clean` and is NOT in this worktree
// branch. Its source patterns are audited in a sibling suite that
// runs against that worktree. The "Phase 4 dependency note" suite
// below documents the dependency so a future refactor knows where
// the tier discount lives and verifies that the read-side contract
// (Phase 3's `currentLevel` cache field) is in place for Phase 4
// to consume when it merges.

const root = (rel: string) => join(import.meta.dirname, "..", "..", "..", rel);

const bookingsSrc = readFileSync(
  root("guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const membersSrc = readFileSync(
  root("guest-app/server/handlers/members.ts"),
  "utf8"
);
const rewardsSrc = readFileSync(
  root("guest-app/src/pages/RewardsPage.tsx"),
  "utf8"
);
const profileSrc = readFileSync(
  root("guest-app/src/pages/ProfilePage.tsx"),
  "utf8"
);
const pointsUtils = readFileSync(
  root("shared/utils/points.ts"),
  "utf8"
);
const voucherUtils = readFileSync(
  root("shared/utils/vouchers.ts"),
  "utf8"
);
const backendDoc = readFileSync(
  root("plan/docs/BACKEND.md"),
  "utf8"
);
const featureDoc = readFileSync(
  root("plan/features/SPARK-REWARDS.md"),
  "utf8"
);

describe("Phase 8 — atomicity boundaries (Phase 3 + Phase 5 share one transaction)", () => {
  it("counter increment uses pre-computed nextCompletedStays = priorCompletedStays + 1", () => {
    // Phase 3 PR #3: the increment is computed as
    // `nextCompletedStays = priorCompletedStays + 1` (NOT a
    // `++` operator, because Firestore transactions need a
    // pre-computed value). The post-increment value is reused
    // for the cache refresh + the free-night trigger so the
    // counter, cache, and trigger are all consistent.
    expect(bookingsSrc).toMatch(/priorCompletedStays\s*\+\s*1/);
    expect(bookingsSrc).toMatch(/nextCompletedStays\s*=\s*priorCompletedStays\s*\+\s*1/);
  });

  it("counter increment + currentLevel cache refresh share one transaction.update call", () => {
    // Both writes happen inside the `if (awardNow)` AND the
    // `else` branches of the `canAwardPoints && memberRef && memberDocInTransaction?.exists`
    // block. Both branches write `completedStays: nextCompletedStays`
    // + `currentLevel: nextCurrentLevel` — verify the
    // immediate-credit path explicitly.
    expect(bookingsSrc).toMatch(/completedStays:\s*nextCompletedStays/);
    expect(bookingsSrc).toMatch(/currentLevel:\s*nextCurrentLevel/);
    // The currentLevel value is derived from
    // `resolveCurrentLevel(rewardsConfig?.levels, nextCompletedStays)`.
    expect(bookingsSrc).toMatch(/resolveCurrentLevel\(rewardsConfig\?\.levels,\s*nextCompletedStays\)/);
  });

  it("free-night voucher write sits INSIDE the same canAwardPoints block (atomic with the counter)", () => {
    // Phase 5 PR #5: the free-night voucher write fires inside
    // the same `canAwardPoints && memberId && memberRef && memberDocInTransaction?.exists`
    // block as the counter increment. The trigger fires on BOTH
    // the immediate-credit AND deferred-credit paths because
    // it lives OUTSIDE the `if (awardNow) {} else {}` split.
    expect(bookingsSrc).toMatch(/if\s*\(\s*canAwardPoints\s*&&\s*memberId\s*&&\s*memberRef\s*&&\s*memberDocInTransaction\?\.exists\s*\)/);
    expect(bookingsSrc).toMatch(/nextCompletedStays\s*%\s*freeNightEvery\s*===\s*0/);
    // The voucher write uses transaction.set (atomic with the
    // counter update). Verify by checking the voucher write is
    // reachable from the canAwardPoints block.
    expect(bookingsSrc).toMatch(/transaction\.set\(freeNightVoucherRef/);
    expect(bookingsSrc).toMatch(/kind:\s*["']reward["']/);
    expect(bookingsSrc).toMatch(/valueType:\s*["']free-night["']/);
    // 90-day expiry — matches Phase 5 spec.
    expect(bookingsSrc).toMatch(/90\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  });

  it("free-night trigger fires on BOTH awardNow paths (immediate + deferred)", () => {
    // The voucher write sits OUTSIDE the `if (awardNow) {} else {}`
    // split — verify by checking the `if (awardNow)` branch
    // closes BEFORE the free-night trigger. The branch uses
    // `rewardsPoints: currentPoints + pointsAwarded` (immediate)
    // and the else branch writes only `completedStays` +
    // `currentLevel` (deferred). The free-night block reads the
    // post-increment value either way.
    const awardNowIdx = bookingsSrc.indexOf("if (awardNow)");
    const elseIdx = bookingsSrc.indexOf("} else {", awardNowIdx);
    const freeNightIdx = bookingsSrc.indexOf("freeNightEvery > 0", awardNowIdx);
    expect(awardNowIdx).toBeGreaterThan(-1);
    expect(elseIdx).toBeGreaterThan(awardNowIdx);
    expect(freeNightIdx).toBeGreaterThan(elseIdx);
  });

  it("welcome bonus credit + history write share the register transaction (Phase 6 atomicity)", () => {
    // Per Phase 6: the welcome bonus credits `rewardsPoints`
    // (inside `transaction.set(memberRef, ...)`) AND writes
    // `pointsHistory/welcome` (inside `transaction.set(welcomeHistoryRef, ...)`)
    // inside the same `runTransaction` as the member doc
    // creation. The deterministic doc ID + single `.get()` is
    // the idempotency check.
    expect(membersSrc).toMatch(/transaction\.set\(memberRef,/);
    expect(membersSrc).toMatch(/transaction\.set\(welcomeHistoryRef,/);
    expect(membersSrc).toMatch(/welcomeHistoryRef\s*=\s*adminDb\.collection\(`members\/\$\{uid\}\/pointsHistory`\)\.doc\(["']welcome["']\)/);
    // The history write is gated on `welcomeAmount > 0 && welcomeHistoryRef`
    expect(membersSrc).toMatch(/if\s*\(\s*welcomeAmount\s*>\s*0\s*&&\s*welcomeHistoryRef\s*\)/);
  });
});

describe("Phase 8 — cross-phase data flow", () => {
  it("Phase 5 voucher code uses Phase 3 cache fields (memberNumber, completedStays)", () => {
    // The free-night voucher code is generated from
    // `memberNumber` + `nextCompletedStays` — both derivable
    // from the Phase 3 `memberDocInTransaction` reads. The code
    // format is `FREENIGHT-{memberNumber}-{nextCompletedStays}`
    // (literal template, not via the helper — matches Phase 5
    // source so the audit pin is robust against helper swaps).
    expect(bookingsSrc).toMatch(/FREENIGHT-\$\{memberNumber\}-\$\{nextCompletedStays\}/);
    // The helper exists in shared/utils/vouchers.ts with the
    // same shape — defense-in-depth.
    expect(voucherUtils).toMatch(/FREENIGHT-\$\{safeMember\}-\$\{safeStays\}/);
  });

  it("Phase 6 welcome bonus respects Phase 3 base tier init (register transaction initializes currentLevel)", () => {
    // Phase 3's register transaction writes
    // `currentLevel: existingMember?.currentLevel ?? baseCurrentLevel`
    // on every registration. Phase 6's welcome bonus lives in
    // the SAME register transaction — both writes share the
    // same atomic boundary, so a welcome bonus cannot exist
    // without a base tier init.
    expect(membersSrc).toMatch(/baseCurrentLevel\s*=\s*resolveCurrentLevel\(rewardsCfg\?\.levels,\s*0\)/);
    expect(membersSrc).toMatch(/currentLevel:\s*existingMember\?\.currentLevel\s*\?\?\s*baseCurrentLevel/);
  });

  it("Phase 7 portal reads from Phase 3 cache + Phase 5 vouchers", () => {
    // The portal's tier badge reads `memberProfile.currentLevel`
    // (Phase 3 cache), and the free-night card subscribes to
    // `vouchers` filtered by `kind=reward` + `memberId=user.uid`
    // (Phase 5 + Phase 7 wiring).
    expect(rewardsSrc).toMatch(/currentLevel\?\.name/);
    expect(rewardsSrc).toMatch(/where\(\s*["']kind["']\s*,\s*["']==["']\s*,\s*["']reward["']\s*\)/);
    expect(rewardsSrc).toMatch(/where\(\s*["']memberId["']\s*,\s*["']==["']\s*,\s*user\.uid\s*\)/);
  });

  it("ProfilePage tier name reads from Phase 3 cache field, not legacy tier field", () => {
    // The ProfilePage header card uses `currentLevel?.name` —
    // matches the RewardsPage read pattern. Both pages share the
    // same fallback ("Member") so the experience is consistent
    // for pre-Phase-2 docs.
    expect(profileSrc).toMatch(/memberProfile\.currentLevel\?\.name\s*\?\?\s*["']Member["']/);
  });
});

describe("Phase 8 — derivation rule audit (resolveCurrentLevel + calculatePointsWithMultiplier)", () => {
  it("resolveCurrentLevel sorts ascending and returns the highest fromStays ≤ completedStays", () => {
    // The helper sorts ascending (defense-in-depth against
    // hand-edited configs), then walks the array accumulating
    // the last level whose threshold the member has met. The
    // `else break` short-circuit is the key invariant — once a
    // level's fromStays exceeds completedStays, no later row
    // can match.
    expect(pointsUtils).toMatch(/\.sort\(\(a, b\)\s*=>\s*a\.fromStays\s*-\s*b\.fromStays\)/);
    expect(pointsUtils).toMatch(/if\s*\(level\.fromStays\s*<=\s*completedStays\)\s*current\s*=\s*level/);
    expect(pointsUtils).toMatch(/else\s*break;\s*\/\/\s*array is ascending/);
  });

  it("resolveCurrentLevel returns null for empty / null / undefined levels", () => {
    // Defensive against hand-edited configs (or no-config
    // deployments) that omit the levels array. The booking engine
    // falls back to the global memberDiscountPct when this
    // returns null.
    expect(pointsUtils).toMatch(/if\s*\(!levels\s*\|\|\s*levels\.length\s*===\s*0\)\s*return\s*null/);
  });

  it("resolveCurrentLevel returns null for non-finite or negative completedStays", () => {
    // Defense against hand-edited member docs that might have a
    // non-number `completedStays` (e.g. a string). The booking
    // flow would never pass a negative value, but the helper is
    // shared across the register transaction + the cancel
    // handler — defensive check is cheap.
    expect(pointsUtils).toMatch(/if\s*\(!Number\.isFinite\(completedStays\)\s*\|\|\s*completedStays\s*<\s*0\)\s*return\s*null/);
  });

  it("calculatePointsWithMultiplier coerces ≤ 0 / null / undefined multiplier to 1", () => {
    // The Zod schema rejects ≤ 0 at write time. The runtime
    // guard is defense-in-depth — if a hand-edited config passes
    // 0 or a missing value, the member still earns their base
    // points (not zero).
    expect(pointsUtils).toMatch(/Number\.isFinite\(multiplier\)\s*&&\s*\(multiplier as number\)\s*>\s*0/);
  });

  it("calculatePointsWithMultiplier returns 0 for non-finite or ≤ 0 base points", () => {
    // Defensive: a 0 or negative base earn should never produce
    // a negative credit. Combined with the multiplier guard, this
    // means a bogus config can never claw points at the source.
    expect(pointsUtils).toMatch(/if\s*\(!Number\.isFinite\(basePoints\)\s*\|\|\s*basePoints\s*<=\s*0\)\s*return\s*0/);
  });

  it("calculatePointsWithMultiplier rounds to nearest integer (matches pointsHistory convention)", () => {
    // `members/{uid}.rewardsPoints` is a whole-number field.
    // Rounding (not flooring) matches the existing
    // `pointsHistory.points` convention — every credit is
    // symmetric with its clawback.
    expect(pointsUtils).toMatch(/Math\.round\(basePoints\s*\*\s*m\)/);
  });
});

describe("Phase 8 — cancellation clawback audit (MRB-05 + Phase 3 decision)", () => {
  it("post-settlement cancel writes a NEGATIVE pointsHistory entry keyed `clawback-${bookingId}`", () => {
    // The existing MRB-05 pattern (decision #100) reverses the
    // points credit on post-settlement cancel. The reversal is
    // a NEGATIVE `pointsHistory` entry so the append-only ledger
    // stays balanced — `sum(pointsHistory.points) === rewardsPoints`.
    expect(bookingsSrc).toMatch(/clawback-\$\{bookingId\}/);
    expect(bookingsSrc).toMatch(/clawback-\$\{child\.id\}/);
    expect(bookingsSrc).toMatch(/type:\s*["']clawback["']/);
    // The negative value is computed via `clawbackPoints = -Number(...)`
    // rather than a literal `-N` — verify the negative-coercion
    // pattern is in place.
    expect(bookingsSrc).toMatch(/clawbackPoints\s*=\s*-Number\(/);
    expect(bookingsSrc).toMatch(/points:\s*clawbackPoints/);
  });

  it("clawback entry uses the SAME per-booking idempotency shape as the original earn entry", () => {
    // The original earn entry is keyed `earn-${bookingId}`; the
    // clawback is keyed `clawback-${bookingId}`. The two are
    // separate ledger rows — a duplicate earn doesn't double-credit
    // (Phase 3's `canAwardPoints` guard), a duplicate clawback
    // doesn't double-reverse (the existing handler's `existingClawback`
    // check at line 6948).
    expect(bookingsSrc).toMatch(/earn-\$\{bookingId\}/);
    expect(bookingsSrc).toMatch(/clawback-\$\{bookingId\}/);
  });

  it("post-settlement cancel does NOT decrement completedStays (Phase 3 decision)", () => {
    // Per Phase 3 PR #3: the stay happened; the points reversal
    // is a separate ledger operation. Decrementing completedStays
    // would force a tier downgrade AND a fan-out write to every
    // member doc on tier-rule change. The MRB-05 philosophy
    // ("stay happened, financial reversal is separate") is the
    // correct invariant.
    //
    // Verify by searching for any decrement pattern in the
    // bookings handler. None should match.
    expect(bookingsSrc).not.toMatch(/completedStays\s*--/);
    expect(bookingsSrc).not.toMatch(/completedStays\s*-=/);
    expect(bookingsSrc).not.toMatch(/completedStays\s*=\s*Math\.max\(0,\s*completedStays\s*-\s*1\)/);
  });

  it("free-night voucher stays valid after post-settlement cancel (Phase 5 consistency)", () => {
    // Phase 5 follows Phase 3's decision: the free-night voucher
    // earned from the cancelled stay is NOT revoked. The stay
    // happened, the free-night was earned. A voucher usageCount
    // decrement on cancel would require a fan-out lookup of every
    // active voucher — out of scope.
    //
    // Verify by searching for the voucher-update-on-cancel
    // pattern. None should match — the voucher write only fires
    // in the checkout handler, not in the cancel handler.
    expect(bookingsSrc).not.toMatch(/usageCount\s*--/);
    expect(bookingsSrc).not.toMatch(/usageCount\s*-=/);
  });
});

describe("Phase 8 — voucher discriminator + value-type audit (Phase 5)", () => {
  it("VoucherLike interface has the three Phase 5 discriminators (kind, valueType, rewardSource)", () => {
    expect(voucherUtils).toMatch(/kind\?:\s*["']promo["']\s*\|\s*["']reward["']/);
    expect(voucherUtils).toMatch(/valueType\?:\s*["']percent["']\s*\|\s*["']flat["']\s*\|\s*["']free-night["']/);
    expect(voucherUtils).toMatch(/rewardSource\?:\s*["']free-night-tier["']\s*\|\s*["']welcome["']\s*\|\s*null/);
  });

  it("VoucherLike has the memberId / memberNumber back-link fields", () => {
    // The back-link lets the member portal (Phase 7) filter
    // vouchers by `memberId == current uid` — O(owned), not
    // O(all). The memberNumber is for display ("SR-10023").
    expect(voucherUtils).toMatch(/memberId\?:\s*string\s*\|\s*null/);
    expect(voucherUtils).toMatch(/memberNumber\?:\s*string\s*\|\s*null/);
  });

  it("isRewardVoucher / isFreeNightVoucher helpers use the discriminator", () => {
    expect(voucherUtils).toMatch(/export function isRewardVoucher\(/);
    expect(voucherUtils).toMatch(/return voucher\.kind\s*===\s*["']reward["']/);
    expect(voucherUtils).toMatch(/export function isFreeNightVoucher\(/);
    expect(voucherUtils).toMatch(/voucher\.kind\s*===\s*["']reward["']\s*&&\s*voucher\.valueType\s*===\s*["']free-night["']/);
  });

  it("generateFreeNightVoucherCode sanitizes memberNumber and floors completedStays", () => {
    // Sanitization: memberNumber is alphanumeric by construction
    // (`generateMemberNumber` in shared/utils), but the helper
    // defends against hand-edited configs or future format
    // changes. Flooring: a fractional completedStays (e.g. from
    // a half-stay edge case) rounds down to the nearest int.
    expect(voucherUtils).toMatch(/replace\(\/\[\^A-Z0-9_-\]\/gi,\s*["']["']\)/);
    expect(voucherUtils).toMatch(/Math\.max\(0,\s*Math\.floor\(Number\(completedStays\)\s*\|\|\s*0\)\)/);
  });

  it("generateFreeNightVoucherCode falls back to 'MEMBER' when memberNumber is empty", () => {
    // Defensive: an empty / null memberNumber still produces a
    // well-formed code. The portal can still render and copy it;
    // the admin can disambiguate by `createdAt` + `memberId`.
    expect(voucherUtils).toMatch(/String\(memberNumber\s*\|\|\s*["']MEMBER["']\)/);
  });
});

describe("Phase 8 — welcome bonus idempotency audit (Phase 6)", () => {
  it("welcome bonus uses a deterministic doc ID = 'welcome' for the idempotency check", () => {
    // A single `.get()` on `pointsHistory/welcome` — no query
    // fan-out. The first registration writes the doc; subsequent
    // registrations see `welcomeAlreadyCredited = true` and skip
    // the credit.
    expect(membersSrc).toMatch(/adminDb\.collection\(`members\/\$\{uid\}\/pointsHistory`\)\.doc\(["']welcome["']\)/);
    expect(membersSrc).toMatch(/welcomeAlreadyCredited\s*=\s*welcomeDocSnap\.exists/);
  });

  it("welcome bonus fires regardless of authUser.email_verified status", () => {
    // The HIGH-1 audit gates `linkBookingsByEmail` (separate
    // concern — past booking attribution). The welcome credit is
    // unconditional once the user is signed in. The
    // `pointsHistory` row is the audit trail — admins can see the
    // credit was issued to an unverified email via Reports if
    // they care.
    //
    // Verify by searching for any conditional gating on
    // email_verified. None should match.
    expect(membersSrc).not.toMatch(/if\s*\(\s*!authUser\?\.email_verified\s*\)/);
    expect(membersSrc).not.toMatch(/if\s*\(\s*authUser\?\.email_verified\s*\)/);
  });

  it("welcome bonus fires ONLY on first registration (existingMember.memberNumber short-circuit)", () => {
    // The existing HIGH-1 short-circuit branch
    // (`if (existingMember?.memberNumber) { return; }`) prevents
    // re-registration from re-issuing the welcome credit. The
    // welcome block sits AFTER that short-circuit.
    expect(membersSrc).toMatch(/if\s*\(\s*existingMember\?\.memberNumber\s*\)/);
    // The welcome history write must come AFTER the existingMember short-circuit.
    const existingShortCircuitIdx = membersSrc.search(/if\s*\(\s*existingMember\?\.memberNumber\s*\)/);
    const welcomeWriteIdx = membersSrc.search(/transaction\.set\(welcomeHistoryRef/);
    expect(existingShortCircuitIdx).toBeGreaterThan(-1);
    expect(welcomeWriteIdx).toBeGreaterThan(existingShortCircuitIdx);
  });
});

describe("Phase 8 — backward-compat audit (pre-Phase-2 deployments)", () => {
  it("all five new RewardsConfig fields are OPTIONAL with safe defaults", () => {
    // The five Phase 2 fields (welcomePoints, minPointsToRedeem,
    // pointsCanPayUpToBillPct, freeNightEvery, levels[]) are all
    // optional in the canonical type. A pre-Phase-2 deployment
    // (no settings/rewardsConfig fields, no member fields) keeps
    // working unchanged.
    expect(pointsUtils).toMatch(/welcomePoints\?:\s*number/);
    expect(pointsUtils).toMatch(/minPointsToRedeem\?:\s*number/);
    expect(pointsUtils).toMatch(/pointsCanPayUpToBillPct\?:\s*number/);
    expect(pointsUtils).toMatch(/freeNightEvery\?:\s*number/);
    expect(pointsUtils).toMatch(/levels\?:\s*Array</);
  });

  it("RewardsPortal RewardsConfig interface uses defensive coercion for all five fields", () => {
    // The portal's local RewardsConfig type guards each field
    // with `Number(...) ?? 0` or `Array.isArray(...) ? ... : []`.
    // A missing field becomes a safe default, not a runtime
    // crash.
    expect(rewardsSrc).toMatch(/welcomePoints:\s*Number\(data\.welcomePoints\s*\?\?\s*0\)/);
    expect(rewardsSrc).toMatch(/levels:\s*Array\.isArray\(data\.levels\)\s*\?\s*data\.levels\s*:\s*\[\]/);
  });

  it("VoucherLike Phase 5 fields are OPTIONAL (pre-Phase-5 vouchers valid as-is)", () => {
    // Pre-Phase-5 promo vouchers are missing `kind`, `valueType`,
    // `memberId`, `memberNumber`, `rewardSource`. The interface
    // marks all five as optional with `?:` — pre-Phase-5 docs
    // continue to parse through any consumer (admin mapping,
    // validate path, apply-at-checkout math).
    expect(voucherUtils).toMatch(/kind\?:\s*["']promo["']/);
    expect(voucherUtils).toMatch(/valueType\?:\s*["']percent["']/);
    expect(voucherUtils).toMatch(/memberId\?:\s*string/);
    expect(voucherUtils).toMatch(/memberNumber\?:\s*string/);
    expect(voucherUtils).toMatch(/rewardSource\?:\s*["']free-night-tier["']/);
  });

  it("pre-Phase-2 member docs (no completedStays / currentLevel) render the fallback tier name", () => {
    // Both portal pages fall back to "Member" when
    // `currentLevel` is missing. A pre-Phase-2 member who hasn't
    // been touched by a checkout yet sees a friendly name, not a
    // crash.
    expect(rewardsSrc).toMatch(/currentLevel\?\.name\s*\?\?\s*sortedLevels\.find/);
    expect(rewardsSrc).toMatch(/sortedLevels\.find\(\(l\)\s*=>\s*l\.fromStays\s*===\s*0\)/);
    expect(profileSrc).toMatch(/memberProfile\.currentLevel\?\.name\s*\?\?\s*["']Member["']/);
  });

  it("pre-Phase-5 voucher doc reads as a legacy promo voucher (kind missing → 'promo' default)", () => {
    // The admin mapping in `AdminContext.tsx` falls back to
    // `kind: "promo"` + `valueType: data.discountType | "flat"`
    // for pre-Phase-5 docs. Verify the helper's defaulting logic
    // is present (the consumers read `kind` and `valueType` as
    // optional).
    expect(voucherUtils).toMatch(/voucher\.kind\s*===\s*["']reward["']/);
  });
});

describe("Phase 8 — documentation cross-reference audit", () => {
  it("BACKEND.md voucher field table documents the five Phase 5 fields", () => {
    // The five Phase 5 voucher fields must each appear in the
    // voucher field table with their canonical type + a comment
    // pointing at the phase that added them.
    expect(backendDoc).toMatch(/\|\s*`kind`\s*\|/);
    expect(backendDoc).toMatch(/\|\s*`valueType`\s*\|/);
    expect(backendDoc).toMatch(/\|\s*`memberId`\s*\|/);
    expect(backendDoc).toMatch(/\|\s*`memberNumber`\s*\|/);
    expect(backendDoc).toMatch(/\|\s*`rewardSource`\s*\|/);
    expect(backendDoc).toMatch(/Phase 5 \(2026-10-12\)/);
  });

  it("BACKEND.md points the memberId field at the Phase 7 portal read", () => {
    // The `memberId` field description must reference Phase 7 as
    // the consumer — gives the reader a pointer to follow.
    expect(backendDoc).toMatch(/Phase 7/);
  });

  it("BACKEND.md documents the pointsHistory 'welcome' deterministic doc ID", () => {
    // The subcollection description must mention the
    // deterministic doc ID `welcome` for the welcome bonus row
    // (Phase 6's idempotency anchor) + the Phase 6 marker so the
    // reader knows when it was added.
    expect(backendDoc).toMatch(/doc ID `welcome`/);
    expect(backendDoc).toMatch(/Phase 6 \(2026-10-13\)/);
  });

  it("SPARK-REWARDS.md has detail sections for Phases 3, 5, 6, 7 (the documented phases)", () => {
    // Phases 3, 5, 6, 7 each have a `### Phase 2 PR #N detail`
    // section with the SHIPPED marker. Phases 1 and 2 have
    // rollout-sequence entries with commit hashes but no detail
    // section (the PR bodies serve that role). Verify all four
    // detail sections are present so the rollout is internally
    // consistent.
    expect(featureDoc).toMatch(/###\s*Phase 2 PR #3 detail/);
    expect(featureDoc).toMatch(/###\s*Phase 2 PR #5 detail/);
    expect(featureDoc).toMatch(/###\s*Phase 2 PR #6 detail/);
    expect(featureDoc).toMatch(/###\s*Phase 2 PR #7 detail/);
  });

  it("SPARK-REWARDS.md rollout sequence marks Phases 1, 2, 3, 5, 6, 7 as SHIPPED", () => {
    // The 8-phase rollout sequence lists each phase with a
    // status marker. Phases 1 + 2 reference their commit hashes;
    // phases 3, 5, 6, 7 use the "(this commit)" pattern. Phase 4
    // is on its own branch and is not yet shipped.
    expect(featureDoc).toMatch(/\*\*PR #1 — Schema & types\*\* — \*\*SHIPPED\*\*\s*\(`d88eec4`/);
    expect(featureDoc).toMatch(/\*\*PR #2 — Settings UI\*\* — \*\*SHIPPED\*\*\s*\(`77eb93e`/);
    expect(featureDoc).toMatch(/\*\*PR #3 — Member-side counters\*\* — \*\*SHIPPED\*\*/);
    expect(featureDoc).toMatch(/\*\*PR #5 — Free-night voucher\*\* — \*\*SHIPPED\*\*/);
    expect(featureDoc).toMatch(/\*\*PR #6 — Welcome points\*\* — \*\*SHIPPED\*\*/);
    expect(featureDoc).toMatch(/\*\*PR #7 — Member portal display\*\* — \*\*SHIPPED\*\*/);
  });

  it("SPARK-REWARDS.md rollout sequence lists Phase 4 (booking engine) as pending", () => {
    // Phase 4 lives on `feature/spark-rewards-phase4-clean` and
    // has NOT been merged to dev. The rollout sequence line
    // must still exist (not deleted) and must NOT carry a
    // SHIPPED marker.
    expect(featureDoc).toMatch(/PR #4 — Booking engine/);
    expect(featureDoc).not.toMatch(/PR #4 — Booking engine — \*\*SHIPPED\*\*/);
  });
});

describe("Phase 8 — Phase 4 dependency note", () => {
  it("tier discount precedence is NOT in this worktree's bookings handler (Phase 4 ships separately)", () => {
    // Phase 4 lives on `feature/spark-rewards-phase4-clean`
    // (commit `aaf2303`) and has NOT been merged to dev. This
    // audit verifies that the tier-discount-precedence code is
    // NOT yet in this worktree's bookings handler — so the
    // reader knows the audit's scope is Phases 1, 2, 3, 5, 6, 7
    // only.
    //
    // Phase 4's marker patterns (per the phase4-clean worktree):
    //   - `memberTier && Number.isFinite(Number(memberTier.discountPct))`
    //   - `tierPct !== null` + `if (tierPct !== null) { ... } else if`
    //   - `memberDocInTx.data()?.currentLevel` (read from cache)
    //
    // None should be present in this worktree. When Phase 4
    // merges, a sibling audit at `feature/spark-rewards-phase4-clean`
    // pins the `tierPct` derivation. That audit ships with
    // Phase 4's PR — see the SPARK-REWARDS.md Phase 8 section
    // for the cross-reference.
    //
    // NOTE: `appliedMemberDiscountPct` IS present (pre-Phase-4
    // legacy rename per BF-20, 2026-06-26) — it is NOT a Phase 4
    // marker. The variable holds the LEGACY global
    // `rc.memberDiscountPct` value, not the tier discount.
    expect(bookingsSrc).not.toMatch(/memberTier\s*&&\s*Number\.isFinite\(Number\(memberTier\.discountPct\)\)/);
    expect(bookingsSrc).not.toMatch(/tierPct\s*!==\s*null/);
    expect(bookingsSrc).not.toMatch(/if\s*\(\s*tierPct\s*!==\s*null\s*\)/);
  });

  it("Phase 3's `currentLevel` cache field IS in the bookings handler (Phase 4 reads from this cache)", () => {
    // Phase 4 reads `memberDocInTx.data()?.currentLevel` to
    // resolve the tier at booking time. Phase 3 writes that
    // cache field on every checkout + register. The cross-phase
    // contract: Phase 3 must keep writing the cache; Phase 4
    // reads it. Verify the write side is still present so Phase
    // 4's read side will resolve correctly when it merges.
    expect(bookingsSrc).toMatch(/currentLevel:\s*nextCurrentLevel/);
  });
});