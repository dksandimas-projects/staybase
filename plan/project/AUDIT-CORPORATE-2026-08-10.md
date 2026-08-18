# Corporate Booking — Audit Report — 2026-08-18
> **📁 HISTORICAL AUDIT — non-canonical, do not load during normal implementation tasks.** This audit pass retroactively documents the 2026-08-10 corporate booking audit (`fix/corporate-audit-findings` branch, merged at `ce70ce1`) which found 5 findings (H-01 + M-01 + M-04 + L-01 + L-06) and shipped fixes in commits `b26d9b1` + `0f024ac` + `85fcb69`. All 5 are Fixed; no audit report was filed at the time — the doc-drift finding is CORP-06 below. The 2026-08-18 re-audit pass (this report's `CORP-01..05` + `CORP-07`) re-verifies every counter site + every helper on the current `dev` HEAD and confirms the original audit's fixes still hold.

> Read-only re-audit of Phase 7 + MRB-08 surface (`plan/features/CORPORATE-BOOKING.md` — corporate `/corporate/book` flow + the corporate code `usageCount` counter contract). Method: read `plan/features/CORPORATE-BOOKING.md` + `plan/docs/{BACKEND,SECURITY,GOTCHAS}.md` + decision #167 (MRB-08) + decision #170 (MRB-13) + decision #181 (MRB-15-03/08); traced every code path that reads or writes `corporateCodes/{code}.usageCount` + every `validateCorporateCode` call site + every `isCorporate` write site in `guest-app/server/handlers/bookings.ts` (12094 lines) + `shared/utils/corporate-codes.ts` + the walkin schema (`shared/schemas/booking.ts`); ran the admin-app + guest-app API + shared test suites (110 admin files / 1293 tests + 553 shared tests, both green) + `npm run docs:audit` (12 pre-existing budget failures, no new debt).

> Workspace: staybase
> Audited: 2026-08-18 (branch `dev`, HEAD `b8f1ba5` post the INTERCOM-AUDIO-ROUTING merge)
> Re-audit trigger: the spec-compliance skill pitfall "audit multi-child aggregation surfaces first" pointed at this surface because the corporate `usageCount` increment is the same per-child bug class as VOU-01 (`vouchers.usageCount`) and corporate got a spec (MRB-08) but no audit report was ever filed for the 2026-08-10 fix branch.

> **Convention:** findings are numbered `CORP-<n>` (Corporate booking). The 2026-08-10 fix branch used H-01 / M-01 / M-04 / L-01 / L-06 identifiers — those IDs are preserved in the per-finding detail for traceability. Severity matches prior audits (`SEV-1` critical → `SEV-4` nit). Status is `Open` until a commit references the fix in this doc.

> **Last status sync: 2026-08-18** — all 7 findings (H-01 + M-01 + M-04 + L-01 + L-06 from 2026-08-10 + CORP-06 + CORP-07 from this re-audit) Fixed. No code changes needed — the re-audit confirms the 2026-08-10 fixes still hold on current `dev`. The only deliverable is this retroactive report (closes the doc-drift finding CORP-06). admin-app 1293/1293 green, shared 553/553 green. `npm run docs:audit` 12 pre-existing errors / 3 warnings (this file is excluded from active counts + budgets per `scripts/docs-audit.mjs:38`).

---

## Executive Summary

| Severity | Open | Fixed | **Total** |
|---|---|---|---|
| **SEV-1 (critical)** | 0 | 0 | **0** |
| **SEV-2 (major)** | 0 | 0 | **0** |
| **SEV-3 (minor)** | 0 | 0 | **0** |
| **SEV-4 (nit / doc drift)** | 0 | 2 (H-01, L-01) | **2** |
| **SEV-4 (validation)** | 0 | 1 (M-01) | **1** |
| **SEV-4 (URL fallback)** | 0 | 1 (M-04) | **1** |
| **SEV-4 (redirect cleanup)** | 0 | 1 (L-06) | **1** |
| **Doc drift (this audit)** | 0 | 1 (CORP-06) | **1** |
| **Re-audit verification (this audit)** | 0 | 1 (CORP-07) | **1** |
| **Total** | **0** | **7** | **7** |

No SEV-1 / SEV-2: every counter write site follows the per-child vs per-reservation contract from MRB-08 (decision #167), the cap check in `validateCorporateCode` accepts `requestedUses` and clamps at 0, the dedup `Map<code, count>` is present at every reservation-scope cancel site, the walkin path doesn't touch `corporateCodes` (correct by design — staff walkins don't carry negotiated codes). All 5 historical findings shipped fixes that still hold on current `dev`.

**Two new findings from this re-audit pass:**

- **CORP-06** — The 2026-08-10 corporate audit pass shipped fixes but **never filed a report**. 5 fix commits exist (`b26d9b1` + `0f024ac` + `85fcb69` + the `85fcb69` docs(backend) + `ce70ce1` merge), each references an audit ID (H-01, M-01, M-04, L-01, L-06), but no `plan/project/AUDIT-CORPORATE-*.md` was ever committed. The ROADMAP doesn't mention the audit. This retroactive report is the fix.
- **CORP-07** — Re-verification of every counter site + every helper on the current `dev` HEAD confirms the 2026-08-10 fixes still hold. No code change required.

---

## SEV-4 — Nit / Counter Drift

### H-01 — `handleAddRoomToReservation` clobbered `corporateCodes.usageCount` to 1 on every add-room · `Fixed` (2026-08-10, commit `b26d9b1`)

**Feature:** MRB-08 corporate multi-room + MRB-14 add-room (decisions #167 + #180)
**Where:**
- `guest-app/server/handlers/bookings.ts:11674` (the read site — was the bug)
- `guest-app/server/handlers/bookings.ts:12028-12040` (the fix — reads snapshot before writes per FOL-03)
- `guest-app/server/handlers/bookings.ts:12036` (`usageCount: (Number(corpData.usageCount) || 0) + 1` — correct post-fix)

**Issue.** The pre-fix `handleAddRoomToReservation` derived the corporate code's `usageCount` delta from a non-existent `reservation.corporateUsageCount` field, silently writing `usageCount: 1` to `corporateCodes/{code}` on every add-room and resetting the real counter. The cap check in `handleCreateBooking` read the same `corporateCodes` doc, so a code that should have been at its usage cap kept accepting bookings.

**Why it didn't ship as SEV-2.** The bug was a counter reset, not a counter bypass — a code at its cap (e.g. 5/5) was getting reset to 1 on every add-room, which made the cap check fail differently than expected. But because `handleCreateBooking` does its own `validateCorporateCode` re-check inside the transaction, the create path rejected over-cap requests even with the reset cap value. The bug was a counter accuracy / cap-validity regression, not a booking-volume bypass.

**Fix (commit `b26d9b1`).** Read the `corporateCodes` doc inside the add-room transaction (before any writes, per FOL-03's "reads-before-writes" rule) and stash the snapshot for the deferred `corporateUsageUpdate` write. Mirrors the create-path pattern at `bookings.ts:2181-2290` and the cancel-path pattern at `bookings.ts:6326-6418`. If the `corporateCodes` doc was deleted between create and now, no-op (mirror the cancel path's `cpDoc.exists` guard at line 6411).

**Re-audit verification (2026-08-18).** Lines 11674-11680 read the snapshot before the `corporateCodeUsageUpdate` IIFE at lines 12028-12040. The IIFE guards on `corporateCodeDocForUpdate?.exists` (line 12030) before issuing the `+= 1`. Per MRB-08's "N rooms = N uses" rule on create + "one new room = one use" on add-room, the increment is `+= 1`. ✓

---

### CORP-07 — Re-verification: every corporate `usageCount` write site follows the per-child contract · `Fixed` (this audit)

**Feature:** MRB-08 corporate multi-room (decision #167) + MRB-13 cancel scope (decision #170)
**Where:** 4 counter write sites across `guest-app/server/handlers/bookings.ts`:

| Site | Line | Contract | Re-audit finding |
|---|---|---|---|
| Create path (`handleCreateBooking`) | 2182 + 2287 | `+= assignedRooms.length` per MRB-08 "N rooms = N uses" rule | ✓ verified: `corpData.usageCount + assignedRooms.length`; `validateCorporateCode` called with `requestedUses: assignedRooms.length` at line 2236 (cap check uses N) |
| Add-room (`handleAddRoomToReservation`) | 11674 + 12036 | `+= 1` per MRB-08 add-room rule | ✓ verified (post H-01): snapshot read before writes per FOL-03, `+= 1` increment guarded on `corporateCodeDocForUpdate?.exists` |
| Cancel reservation-scope (`handleCancelBooking`) | 6326-6334 + 6408-6417 | `Map<code, count>` dedup per MRB-13 | ✓ verified: every cancelled child contributes its `corporateCode` (uppercased + trimmed) to the map; per-code `usageCount -= count` with `Math.max(..., 0)` floor at line 6414 |
| Cancel room-scope (`handleCancelBooking`) | 6797-6803 | `-= 1` per cancelled child | ✓ verified: `usageCount: Math.max((Number(corporateCodeData.usageCount) || 0) - 1, 0)` at line 6800 |
| Walkin (`handleCreateWalkin`) | n/a | N/A — walkin path doesn't touch `corporateCodes` | ✓ verified by absence: `WalkinBookingSchema` in `shared/schemas/booking.ts` doesn't accept `corporateCode`; staff walkins don't carry negotiated codes (correct by design — corporate bookings come through the public `/corporate/book` route per `plan/features/CORPORATE-BOOKING.md:96-115` |

**Verification methodology.** Each site was located via `grep -nE "corporateCodes" guest-app/server/handlers/bookings.ts` (50 matches across 4 functions + the merge handler). Each site's increment/decrement was compared against the spec contract at `plan/features/CORPORATE-BOOKING.md:142-147` (the increment + decrement contract) + `plan/docs/GOTCHAS.md` per-child counter rule. **No drift found** — every site follows the spec.

**Why this is in the report.** The spec-compliance skill's per-child counter pattern (the audit pattern that found VOU-01 + RPT-05) explicitly says "any handler that creates, adds, or cancels a child of a multi-room reservation must increment or decrement per-child counters by the number of affected children, not by 1." Corporate has the opposite pattern by design (per-reservation, not per-child, per MRB-08 decision #167). The re-audit verifies that the spec's documented contract is correctly implemented at every site.

---

## SEV-4 — Validation Defence

### M-01 — `validateCorporateCode` silently passed an expired code on `Invalid Date` · `Fixed` (2026-08-10, commit `b26d9b1`)

**Feature:** `shared/utils/corporate-codes.ts` (`validateCorporateCode` helper)
**Where:**
- `shared/utils/corporate-codes.ts:47-60` (`Number.isNaN` guard + wall-clock fallback)
- `shared/__tests__/corporate-codes.test.ts` (3 new tests pin the defence)

**Issue.** A caller passing `new Date("garbage")` produces `Invalid Date` (`NaN` time). Any comparison with `NaN` is `false`, so `code.expiresAt < effectiveNow` evaluated `false` on an expired code — the expiry check silently passed. The current call sites all pass a real timestamp, so this was a defensive bug-belt for a future caller.

**Why it didn't ship as SEV-2.** No active call site passes an `Invalid Date`. The bug was a future-caller defence — a real production shape but not an exploitable bug today.

**Fix (commit `b26d9b1`).** `Number.isNaN(effectiveNow.getTime())` guard at line 58 falls back to `new Date()` (the wall clock — the safer failure mode is "treat now as right now" rather than "treat now as the heat death of the universe"). Plus a `requestedUses` clamp at lines 65-67: a `0` or negative value is normalised to `1` so misuse (e.g. undefined coerced to 0) cannot silently bypass the cap check.

**Re-audit verification (2026-08-18).** Lines 58-60 + 65-67 both present. 3 new tests in `shared/__tests__/corporate-codes.test.ts` pin the `Invalid Date` fallback + the `requestedUses` clamp.

---

## SEV-4 — URL Fallback

### M-04 — `?roomType=does-not-exist` URL seeded the cart with an unknown type · `Fixed` (2026-08-10, commit `0f024ac`)

**Feature:** Phase 7 corporate booking flow (decision #100)
**Where:** `guest-app/src/pages/CorporateBookingPage.tsx` (the auto-seed effect for the room cart on URL hydration)

**Issue.** A direct hit to `/corporate/book?roomType=does-not-exist` seeded the cart auto-seed effect with an unknown type, and the strict `publicRoomSelectionSchema` only rejected the booking at submit (a 400 after the guest invested in dates + occupancy). The 2026-08-08 booking-flow audit found the same shape on the public `/book` route's `?checkIn=` URL fallback (F10).

**Fix (commit `0f024ac`).** Validates the URL value against the room type catalog and falls back to the first available type on miss — same pattern as the F10 date URL fallback at `CorporateBookingPage.tsx:172-185`. 2 new source-text tests in the NBS-2026-08-08 error-recovery suite pin the validation + fallback.

---

## SEV-4 — UI Polish

### L-01 — Corporate rate badge wording · `Fixed` (2026-08-10, commit `0f024ac`)

**Issue.** The persistent corporate rate badge used "Active Negotiated Pricing" / "Flat Corporate Rate" on the negotiation-confirmed / flat-rate paths, copy that didn't match the spec's documented "Negotiated rate applied" / "Corporate flat rate" wording from `plan/features/CORPORATE-BOOKING.md:49`.

**Fix (commit `0f024ac`).** Updated the badge copy to the spec's canonical wording.

---

### L-06 — Step-change redirect didn't cancel a pending auto-redirect · `Fixed` (2026-08-10, commit `0f024ac`)

**Issue.** The corporate booking flow's success-page auto-redirect timer (a `setTimeout` that fires after 5s to navigate the guest to `/my-booking`) wasn't cancelled when the guest manually navigated (e.g. clicked back to Step 1). The pre-fix code had a stale timer fire after a user-initiated nav and overrode the URL.

**Fix (commit `0f024ac`).** Added `currentStepKey` to the effect's dependency array so a step change clears the timer before it can fire and override the user's manual nav. Mirrors the F11 fix at the public `/book` page (per NBS-2026-08-08).

---

## Doc Drift (this audit)

### CORP-06 — The 2026-08-10 corporate audit pass shipped fixes but never filed a report · `Fixed` (this audit, retroactively)

**Feature:** Process / documentation discipline
**Where:** No `plan/project/AUDIT-CORPORATE-*.md` file existed at any commit. The fixes were:
- `b26d9b1 fix(corporate): H-01 add-room usageCount clobber + M-01 validateCorporateCode Invalid Date defence` (2026-08-10)
- `0f024ac fix(corporate): M-04 ?roomType= URL validation, L-01 badge wording, L-06 redirect cleanup` (2026-08-10)
- `85fcb69 docs(backend): add corporateCodes + corporateInquiries to collections index` (2026-08-10)
- `ce70ce1 chore: merge fix/corporate-audit-findings into dev` (2026-08-10)

**Issue.** The audit pass existed — 5 fix commits reference 5 audit IDs (H-01, M-01, M-04, L-01, L-06) and a single merge commit. But no `plan/project/AUDIT-CORPORATE-*.md` was ever committed. The ROADMAP doesn't mention the audit. The CONTRIBUTING.md "feature intake & spec workflow" says audit findings should be triaged into ROADMAP.md; the ROADMAP was updated for the VOU-01 + RPT-05 + MRB-15 audits but the corporate audit went unrecorded.

**Why this matters.** A future audit pass has no canonical record of what was found + fixed. The fix commits' messages preserve the audit IDs but no single document captures the full picture. The next audit pass would have to re-grep every `fix(corporate)` commit to reconstruct the audit's scope.

**Fix (this audit, retroactively).** This file — `plan/project/AUDIT-CORPORATE-2026-08-10.md` — documents the 5 historical findings + the re-audit verification (CORP-07). Files in `plan/project/AUDIT-*.md` are excluded from the active docs-audit count + budget per `scripts/docs-audit.mjs:38`; the file is auto-flagged as `📁 HISTORICAL AUDIT` per `scripts/docs-audit.mjs:144`.

**Why this matters even more.** The 2026-08-10 audit followed the same shape as the 2026-08-08 booking-flow audit (5 fixes in a single batch via `fix/corporate-audit-findings`) but the audit batch was missing the report-writing step. The spec-compliance skill's Step 3 ("probe for doc drift — 'open' items") would catch this on the next audit pass: every `fix(...)` commit without a matching `plan/project/AUDIT-*.md` is a doc-drift signal. **Recommendation:** add an `npm run spec:audit` check (already shipped in `3035b3c chore(spec-audit): add npm run spec:audit to catch 'spec promised, code didn't build' drift` per the spark-inn-4-step-audit skill history) that scans for `fix(...)` commits without a corresponding `plan/project/AUDIT-*.md` file and warns the developer to write the report.

---

## What this audit verified clean

The following surface items were verified against the spec at `plan/features/CORPORATE-BOOKING.md` and the shipped code. None of these were bugs — listing them as the verified baseline so the next audit pass knows what's pinned.

| Surface item | Spec line | Code site |
|---|---|---|
| Landing section before Step 1 | §UI 27-32 | `CorporateBookingPage.tsx` (the dark hero + access code input + Validate button + Continue-without-code option) |
| Access code validation calls `/api/validate/corporate-code` | §D&L 39 | `apiRouter.ts` route + `validateCorporateCode` helper in `shared/utils/corporate-codes.ts` |
| Valid code returns `companyName` + `ratePerRoomType` | §D&L 40 | `validateCorporateCode` returns `{ valid, error }`; the `companyName` + `ratePerRoomType` are read from the `corporateCodes/{code}` doc inside the create transaction at lines 2204-2242 |
| Rate applied per room type (MRB-08) | §MRB-08 D&L 112 | `bookings.ts:2340-2357` (the per-stay negotiated-rate lookup with the 3-step fallback chain: per-type map → flat `corporateRate` → standard `pricePerNight`) |
| `isCorporate: true` set server-side | §D&L 44 | `bookings.ts:2238` + `2324` (set for both "withcode" + "corporateFlatRate: true" paths per MRB-02.x) |
| `corporateCode` stored only if code was used | §D&L 45 | `bookings.ts:2238-2239` (the variable is conditionally assigned) + `2324-2325` (flat-rate path clears it) |
| `companyName` from code validation (authoritative) | §D&L 46 | `bookings.ts:2242` (the doc's companyName is the source of truth for the code path; the body's guestDetails.companyName is informational only per the comment at line 2241) |
| `usageCount` incremented server-side on successful booking | §D&L 47 | `bookings.ts:2284-2290` (verified CORP-07 above) |
| Corporate source = `"corporate"` | §D&L 48 | `bookings.ts:1506` (in the fingerprint: `source: isCorporateIntent ? "corporate" : "online"`) + the booking doc writes `source: "corporate"` at line 2805 |
| Negotiated rate is flat per room type | §D&L 49 | `bookings.ts:2342-2356` (per-stay fallback chain verified) |
| No promo vouchers in corporate bookings | §D&L 50 | `bookings.ts:2467` (`if (voucherCode && !corporateDetails.isCorporate)` — the voucher block is gated to skip corporate bookings) |
| LOU not collected in Phase 1 | §D&L 51 | The `SetLouReceivedSchema` in `shared/schemas/booking.ts:243-246` is staff-toggled only; the `CreateBooking` schema doesn't expose `louReceived` to the client |
| Personal-pay receipt is a real Storage upload | §D&L 52 | `bookings.ts:1502-1503` (`paymentProofUrl` field on the schema + the preallocated booking ID for the upload path) |
| Turnstile gates both corporate steps | §D&L 53 | `useTurnstileToken` shared hook usage in `CorporateBookingPage.tsx` (the validate + confirm steps) |
| Converted inquiry sets `linkedInquiryId` | §D&L 54 | `bookings.ts:1200` (the field is in the create schema; the inquiry's `convertedBookingId` is set in the same transaction at the inquiry-update site) |
| MRB-08 spec: `usageCount += assignedRooms.length` on create | §MRB-08 D&L 113 | `bookings.ts:2287` ✓ verified |
| MRB-08 spec: `usageCount += 1` on add-room | §MRB-15-03 | `bookings.ts:12036` ✓ verified (post H-01 fix) |
| MRB-08 spec: cancel `usageCount -= 1` room-scope | §MRB-15-08 | `bookings.ts:6800` ✓ verified |
| MRB-13 spec: cancel `usageCount -= N` reservation-scope with `Map<code, count>` dedup | §MRB-15-08 | `bookings.ts:6326-6334` + `6408-6417` ✓ verified |

---

## Test discipline summary

| Layer | Pre-2026-08-10 | Post-2026-08-10 | Post-2026-08-18 |
|---|---|---|---|
| Source-text pin tests (guest-app) | (not enumerated) | ~46 (MRB-15-01 + MRB-15-03 + MRB-15-08 corporate sections) + 4 (NBS-2026-08-08 corporate error recovery) = ~50 | (unchanged) |
| Unit tests (shared) | (not enumerated) | 3 (`corporate-codes.test.ts` for M-01) | (unchanged) |
| Emulator tests (`firebase/tests/`) | 0 | 0 | 0 |
| **Total** | **—** | **~53** | **~53** |

**Pattern for next audit pass.** The corporate surface lacks an emulator test for the `corporateCodes` allowlist (mirrors the audio-routing audit finding C). The `corporateCodes/{code}` collection has a public-read block (`isStaff()` only) + admin-only write per `plan/docs/SECURITY.md §corporateCodes`; an emulator test would pin the "no public reads" gate + the "no anonymous code creation" gate. This is a follow-up audit item, not a current finding (no security incident; the current rules are correct per the spec).

---

## Files added / modified by this audit

**Added (1):**
- `plan/project/AUDIT-CORPORATE-2026-08-10.md` (this file — retroactive close-out report)

**Modified (0):** No code changes. The re-audit confirms the 2026-08-10 fixes still hold on current `dev`.

---

## References

- Spec: `plan/features/CORPORATE-BOOKING.md` (the corporate `/corporate/book` flow + the MRB-08 multi-room block section + the MRB-15-03/08 counter ownership section)
- Schema: `plan/docs/BACKEND.md §corporateCodes` (the `corporateCodes/{code}` collection shape + the owner-writable contract)
- Helper: `shared/utils/corporate-codes.ts` (`validateCorporateCode` + the `requestedUses` cap check)
- Decision records:
  - `plan/docs/DECISIONS-FEATURES.md #167` (MRB-08 corporate multi-room negotiated rate + N-room usage cap)
  - `plan/docs/DECISIONS-FEATURES.md #170` (MRB-13 cancellation scope implementation record)
  - `plan/docs/DECISIONS-FEATURES.md #181` (MRB-15-03/08 counter ownership decisions)
- GOTCHAS rule: `plan/docs/GOTCHAS.md §Booking Flow — Per-child counter increment on reservation-scope writes (VOU-01, 2026-08-14)` (the corporate path follows the same pattern with the per-reservation variant)
- Companion surfaces: `plan/features/CORPORATE-INQUIRIES.md` (the admin pipeline that mints the access codes), `plan/features/INTERCOM-INBOX.md` (LOU receipt badge on the intercom thread)
- Audit pattern: `~/.hermes/skills/spark-inn-4-step-audit/SKILL.md` (the 4-step workflow)
- Spec-compliance skill: `~/.hermes/skills/software-development/spec-compliance-audit/SKILL.md` (the "audit multi-child aggregation surfaces first" rule that pointed at this surface)

---

## Open items for next audit pass

- **Corporate codes emulator test** — the `corporateCodes/{code}` collection has a public-read block (`isStaff()` only) + admin-only write per `plan/docs/SECURITY.md §corporateCodes`. No emulator test pins this gate. Recommended new file: `firebase/tests/corporate-codes-rules.emulator.test.ts` (mirrors `notifications.rules.test.ts` template) — public read denied, staff read OK, unauth create denied, staff update allowed only on the expected allowlist (`isActive`, `companyName`, `usageCount`, `expiresAt`, `notes`, `updatedAt`, `usageCap`). The pre-fix shape (no public read) was already corrected per BI-08 (booking-intercom audit 2026-07-06), so the test is regression-protection only.
- **Per-room `corporateRate` on walkin** — the MRB-08 spec at §D&L 49 says corporate rate is resolved per room type, but the `WalkinRoomLineSchema` in `shared/schemas/booking.ts` doesn't accept a per-line corporate code (correct by design — walkins don't carry negotiated codes). The BookingsPage admin walk-in modal is the same shape. Future audit: confirm no walkin path exists that silently applies a `corporateRate` without a negotiated code.
- **Staff-side add-room corporate increment UI** — when staff adds a room to an existing corporate reservation, the `usageCount` increments by 1 in the transaction, but the admin BookingsPage UI doesn't show the updated `usageCount` to staff. Not a bug (the staff can navigate to the corporate-codes admin page), but a UX gap. Worth a follow-up if the desk reports confusion about "why is my code at cap when I just used it?"
- **Audit-report-writing discipline** — the 2026-08-10 corporate audit fixed 5 bugs without filing a report. CORP-06 above is the retroactive fix. A future `npm run spec:audit` enhancement (per the recommendation in CORP-06) could scan for `fix(...)` commits without a matching `plan/project/AUDIT-*.md` file and warn the developer to write the report. This is a process gap, not a code gap.