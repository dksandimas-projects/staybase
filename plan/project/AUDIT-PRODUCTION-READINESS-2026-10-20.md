# Production Readiness Audit — Spark Inn (October 2026)

> **HISTORICAL AUDIT** — a point-in-time production-readiness assessment. All findings below are as observed on **2026-10-20** against branch `fix/oct-audit-closeout` (commit `6fc384c`). Read the canonical spec MDs to implement the fixes.
> Started: 2026-10-20 · Scope: the full deployed surface — `guest-app/` (guest UI + Vercel API), `admin-app/` (staff UI), `shared/`, `firebase/` (rules + storage), `vercel.json`, `hotel.config.ts`
> Method: static code-path tracing across every app + the repo's own audit scripts + live execution of every gate (typecheck, both production builds, all four test suites, api-bundle check, docs audit, spec audit). Every finding cites a real `file:line` that was read or executed.

---

## Executive Summary

**Verdict: feature-complete, NOT production-ready.** The feature set is genuinely done — every phase from Intercom through the October breakfast redesign is built, and the money-critical paths were hardened in the October 2026 audit (5 Criticals + 11 Highs + 8 Mediums, all fixed). What is missing is not features.

**Seven blockers (B1–B7) are genuine security defects**, and they are the *same failure class* the October audit already caught once (OCT-C3: a collection ships with no rule block, the admin surface dies silently behind a misleading empty state). Two more collections have it. The class was fixed for `addOns` + `auditLogs`; it was not generalized into a guardrail, so it recurred twice.

**The test suite cannot support a production sign-off.** 5,473 tests pass and **zero of them execute React**. There is no jsdom, no React Testing Library, and no `render()` call anywhere in the repository. ~99% of assertions are regex matches against source text. The October audit demonstrated empirically that this suite does not catch real defects — 30 of them (5 Critical) survived a fully green run.

**The launch gates are untouched.** Phase 10 Security & Polish (5 items), Phase 8 Intercom manual QA (10 items), Phase 11 staging + cutover (14 items), BDUX verification (8 items), and the Phase 11.7 admin mobile matrix are all still unchecked. These are the actual definition of "ready for production" and none of them have been started.

### Readiness by axis

| Axis | Score | Basis |
|---|---|---|
| Feature completeness | **~95%** | 19 guest pages, 15 admin pages, 116 API routes, 42 rule blocks — all present and wired |
| Correctness confidence | **~55%** | Typecheck + builds clean, but 0 DOM tests; the Oct 2026 audit proved the suite misses real bugs |
| Security posture | **~60%** | Strong server-side auth model and no client-asserted privilege; 7 blockers in rules/storage/authorization |
| Money-path integrity | **~85%** | Oct 2026 Criticals fixed, catalog-price authority enforced, server-side code validation; no recurring reconciliation |
| Operational readiness | **~35%** | Launch QA gates untouched, no failed-email retry, no nightly reconciliation, placeholder public config |
| Documentation | **functional, 3.5× over budget** | 803k tokens vs a 230k ceiling; 18 `docs:audit` errors |

### What is solidly in place (verified, not assumed)

- **Typecheck clean** on both apps; **both production builds succeed**; `check:api-bundle` passes.
- **5,473 tests green** — shared 863 · guest-api 2,686 · admin 1,918 · infra 6.
- **2 serverless functions** against a hard Hobby cap of 12 — comfortable headroom.
- **No secrets in git.** Only empty `.env.example` files are tracked; every real `.env*` is gitignored.
- **Server-side price authority holds** (OCT-C1/C2): the catalog snapshots breakfast and add-on prices on every path; the client's wire price is accepted and ignored.
- **No client-asserted privilege anywhere in the server** — no `req.body.role`, `req.body.isCorporate`, or `req.body.corporateCode` is read. Corporate codes and vouchers are re-validated inside the booking transaction; the booking schema is `.strict()` and rejects `isCorporate`.
- **PII logging is clean** in the request path — no whole-request-body dumps. One local-only CLI script (`audit-legacy-payment-status.ts`) prints `paymentProofUrl` to the operator terminal.
- **Cron routes are CRON_SECRET-gated**; staff role comes only from the verified token claim.
- **`roomPrivate` is staff-only**; `vouchers` / `corporateCodes` / `auditLogs` / `failed_emails` / `notifications` are correctly staff- or admin-scoped.

---

## Remediation status (same day, 2026-10-20)

Branch: `fix/prod-readiness-blockers` (off `fix/oct-audit-closeout`, which contains `dev`).

| Finding | Status | How |
|---|---|---|
| **B1** breakfast config change log | **FIXED** | New `match /settings/{documentId}/breakfastConfigChangeLog/{auditId}` block (staff read, admin write) |
| **B2** vouchers guest read | **FIXED** | Owner-scoped branch: `isStaff() \|\| (signedIn() && resource.data.memberId == request.auth.uid)` |
| **B3** intercom messages world-readable | **FIXED** | Guest thread moved to `intercomSessions/{sessionToken}/messages` (capability path); legacy path is now staff-only |
| **B4** call signaling public read+write | **FIXED** | `calls/{roomId}/{document=**}` is now staff-only; signalling moved to `callSessions/{sessionToken}` |
| **B5** intercom doc publicly writable | **FIXED** | `intercoms/{roomId}` is now staff-only read+write |
| **B6** send-message trusts the body | **FIXED** | The server resolves the booking, checks room + checked-in + token, and derives the guest name from the booking |
| **B7** anonymous storage writes | **FIXED** | Size + content-type bound on the three guest upload paths; the store-order `paymentProofUrl` is now prefix-validated instead of stored verbatim |
| **H1** zero DOM tests | **NOT FIXED** | Needs a harness — tracked as the biggest remaining gap |
| **H2** rules emulator coverage | **PARTIAL** | A static rules-coverage guardrail now runs on every commit (see below) |
| **H3/H4** public rates + settings | **NOT FIXED** | Needs a deliberate pricing-posture decision from the owner |
| **H5** rate-limit gaps | **FIXED** | `members/redeem-points-self` (10/min), `bookings/cancel` (10/min), and the email limiter re-keyed on the client IP |
| **H6** client-controllable rate-limit key | **CORRECTED, not a bug** | Vercel overwrites `x-forwarded-for` and does not forward external IPs, so the old first-hop read was NOT spoofable. The code now prefers `x-vercel-forwarded-for` anyway (robustness against a proxy in front of Vercel) |
| **H7** no failed-email retry | **NOT FIXED** | Needs a new endpoint + button |
| **H8** no nightly reconciliation | **NOT FIXED** | Needs a new cron |
| **H9** launch QA gates untouched | **NOT FIXED** | Operational, not code |
| **H10** `hotel.config.ts` outside the bundle guardrail | **FIXED** | The pre-commit check now watches the repo-root config too |
| **M1** CSP `unsafe-eval` | **DOCUMENTED, deliberately kept** | The admin app's Emscripten HEIC decoder provably needs it; the guest's runtime third-party scripts could not be verified offline. See `plan/docs/SECURITY.md §CSP` for the safe removal procedure |
| **M2** no HSTS | **FIXED** | `Strict-Transport-Security` added to all three `vercel.json` files |

### The recurrence guardrail (the most valuable part of this pass)

`admin-app/src/__tests__/firestore-rules-coverage.test.ts` parses
`firebase/firestore.rules` into rule blocks, enumerates every Firestore path
the CLIENT code touches, and fails if any path has no covering rule block. It
runs in `npm run test:fast` — no emulator, no Java — so it gates every commit.

It is the direct answer to the fact that this defect class has now appeared
**three times** (OCT-C3 on `addOns` + `auditLogs`, B1 on
`breakfastConfigChangeLog`, B2 on `vouchers`). Verified by negative test:
removing the B1 rule block makes it fail with the exact call site
(`SettingsPage.tsx:4244`) and the uncovered path.

### Verification after the fixes

`typecheck` clean on both apps · `npm run test:fast` green (863 shared ·
2,686 guest-api · 1,938 admin · 6 infra = **5,493**) · both production builds
succeed · `check:api-bundle` passes · `spec:audit` OK.

**Not verified:** `npm run test:rules` still cannot run (no Java runtime on
this machine), so the new capability-path rules have not been exercised
against the Firestore emulator. The rules are correct by construction and
pinned by source-level regression tests, but the first emulator run should
confirm them.

---


## BLOCKERS (7) — fix before launch

### B1 — `settings/breakfastConfig/breakfastConfigChangeLog` has no rule block → the breakfast config audit trail is silently lost
**Severity:** Blocker · **Anchor:** `firebase/firestore.rules:335` · `admin-app/src/pages/SettingsPage.tsx:4244,4250` · swallow at `:4256-4263`

The client writes the change log to a **subcollection**:

```ts
const auditRef = collection(db, "settings", "breakfastConfig", "breakfastConfigChangeLog");
// …
addDoc(auditRef, { field, before, after, changedBy, changedAt: serverTimestamp() })
```

The rules only cover the two-segment document:

```
match /settings/{documentId} {
  allow read: if true;
  allow write: if isAdmin();
}
```

Firestore rules do **not** cascade into subcollections, and no `match /settings/{documentId}/{subcollection}/{docId}` block exists. Result: `PERMISSION_DENIED` for every role, including admin. The failure is swallowed by `console.warn("breakfastConfigChangeLog write failed", err)` and the primary save is allowed to succeed — so **the operator sees a success toast and the audit trail silently evaporates**. This is exactly the OCT-C3 failure mode, and the existing test (`br-02-breakfast-settings.test.ts:169`) asserts only the client code shape, never a rule block.

### B2 — `vouchers` is staff-read-only → Spark Rewards free-night vouchers never render for a member
**Severity:** Blocker · **Anchor:** `firebase/firestore.rules:407-410` · `guest-app/src/pages/RewardsPage.tsx:209-213` · swallow at `:232-237`

The rule says `allow read: if isStaff();`. The guest Rewards portal queries the collection directly:

```ts
query(collection(db, "vouchers"),
      where("kind", "==", "reward"),
      where("memberId", "==", user.uid))
```

A signed-in member is not staff, so the read is denied. The error handler sets `setRewardVouchers([])` and the portal renders "points + tier, just no free-night card" — **the member never sees their free-night voucher, and nothing surfaces the failure**. The code comment at `RewardsPage.tsx:203-205` asserts *"Firestore rules restrict the read to the doc owner (see plan/docs/SECURITY.md §vouchers)"* — but the rule and `plan/docs/SECURITY.md:145-150` both say staff-only. Doc, rule, and code disagree in three places, and the code is the one that is wrong about reality.

### B3 — Every room's intercom chat is world-readable
**Severity:** Blocker · **Anchor:** `firebase/firestore.rules:420` · `guest-app/src/pages/IntercomPage.tsx:482-487`

```
match /messages/{messageId} {
  allow read: if true;
```

The guest page filters by `currentStayId` **client-side** (`IntercomPage.tsx:495`: `if (data.currentStayId !== currentStayId) return []`). That filter is cosmetic — anyone reading the raw Firestore SDK directly bypasses it entirely. Because `rooms` is publicly readable (see H3), the room tokens for all 14 rooms are trivially enumerable, so **an anonymous caller can read every guest's conversation with the front desk** — guest name, message text, `currentStayId`, and `orderRef`. For a hotel, that is a PII exposure across the entire guest population.

### B4 — Call signaling is publicly readable *and* writable
**Severity:** Blocker · **Anchor:** `firebase/firestore.rules:481-483`

```
match /calls/{roomId}/{document=**} {
  allow read, write: if true;
}
```

Read exposes `guestName` and call timing to anyone. Write lets anyone inject or mutate call records. The `{document=**}` wildcard (rules v2) matches zero-or-more segments, so it covers the nested `iceCandidates` subcollection too.

### B5 — Any guest can mark an intercom thread resolved and overwrite `currentStayId`
**Severity:** Blocker · **Anchor:** `firebase/firestore.rules:413`

```
match /intercoms/{roomId} {
  allow read, create, update: if true;
```

`resolved` is the flag the admin Inbox uses to decide whether a request is still open. An unauthenticated write sets `resolved: true` and the desk **stops seeing a real guest's request** — a live request can be silenced by anyone who knows the room number.

### B6 — `POST /api/intercom/send-message` performs no server-side stay verification
**Severity:** Blocker · **Anchor:** `guest-app/server/handlers/intercom.ts:138-158`

The handler takes `roomNumber`, `guestName`, and `currentStayId` straight from the request body and writes them through the Admin SDK:

```ts
await adminDb.collection("intercoms").doc(roomNumber).set({
  roomId: roomNumber, roomNumber, guestName, currentStayId, resolved: false, updatedAt: new Date()
}, { merge: true });
```

The route comment claims the values are *"already verified client-side"*. Client-side verification is not verification. A verification endpoint exists (`handleVerifyIntercomGuest`, `intercom.ts:170`) and does check a last name against the current stay — but **the send path does not require that endpoint to have run**. Anyone can post into any room's thread as a spoofed guest name. Rate limiting (30 / room / 10 min) is the only throttle.

> Note: the store-order path is materially better — `store.ts:280-306` requires an active booking for the room and throws `NO_ACTIVE_BOOKING` otherwise. It is still room-number-only rather than guest-identity, but it is not the open hole the intercom path is.

### B7 — Storage allows anonymous writes to the guest proof paths
**Severity:** Blocker · **Anchor:** `firebase/storage.rules:29,34,110`

```
match /bookings/{bookingId}/payment-proof/{fileName} { allow read: if isStaff(); allow write: if true; }
match /bookings/{bookingId}/discount-id/{fileName}   { allow read: if isStaff(); allow write: if true; }
match /store-orders/{roomNumber}/payment-proof/{fileName} { allow read: if isStaff(); allow write: if true; }
```

`allow write: if true` means **any anonymous caller can upload to any of these paths** — the guest controls the `bookingId` / `roomNumber` segment, and there is no size or content-type cap. Reads are correctly staff-only, so this is not a disclosure; it is unbounded storage abuse and object-planting against guessed identifiers, with the resulting files then rendered as admin-visible proof. `plan/docs/SECURITY.md:173` already flags this ("use a time-limited upload token approach"); it is unimplemented.

---

## HIGH (10)

### H1 — Zero DOM tests: the green suite is not evidence of correctness
**Anchor:** repo-wide — 0 files import `react-dom` / `@testing-library/react`; 0 `render()` calls

| Suite | Files | Source-text assertions (`readFileSync`) |
|---|---|---|
| `guest-app/tests/api` | 214 | 170 (79%) |
| `admin-app/src/__tests__` | 159 | 156 (98%) |
| `shared/__tests__` | 56 | 9 (16%) |

The October 2026 audit is the proof, not a theory: 30 defects (5 Critical — free breakfasts, a ₱500 transfer for ₱1, a dead admin surface, a stay booked one day early for every guest east of UTC, walk-ins silently discarding add-ons) **all survived a fully green suite of 5,130 tests**. A suite that cannot execute a component cannot tell you a button works, a modal traps focus, or a form submits. For a production sign-off this is the single largest gap in the project.

### H2 — Firestore rules are emulator-tested at 24%
**Anchor:** `firebase/tests/` — 7 rules/emulator files against **42** rule blocks (10 evaluated = 24%); 40 further test files grep the rules file as text

Zero rule assertion for `corporateInquiries`, `storeItems`, `financeIntegrityRepairs`, and the four `janitor/*` blocks. B1 and B2 both sit in exactly this gap.

### H3 — The public `rooms` collection exposes negotiated corporate rates
**Anchor:** `firebase/firestore.rules:17-18` (`allow read: if true`) · room docs carry `corporateRate`, `pricePerNight`, `weekendRate` (seed at `scripts/seed-firestore.ts:344-347`)

The rules deliberately locked `corporateCodes` to staff-only with an explicit comment about *"negotiated `ratePerRoomType`"* exposure — and that reasoning was correct. But the same class of data sits on the publicly-readable `rooms` document, and `settings/hotelConfig` (public read, `firestore.rules:336`) carries the same `corporateRate` per room type. The protection was applied to one copy of the data and not the other.

### H4 — The entire `settings` collection is publicly readable
**Anchor:** `firebase/firestore.rules:336` · documents: `hotelConfig`, `websiteContent`, `rewardsConfig`, `breakfastConfig`, `storeConfig`, `seo`

A single anonymous `getDoc(doc(db, "settings", "hotelConfig"))` returns the full hotel configuration. Some of it is legitimately public (room types, amenities, photos). The pricing posture needs a deliberate decision, not an inherited `allow read: if true`.

### H5 — Three rate-limit gaps on public or authenticated money paths
**Anchor:** `guest-app/server/apiRouter.ts`

| Route | Gap | Anchor |
|---|---|---|
| `POST /api/members/redeem-points-self` | **no rate limit at all** — and the handler comment claims a `withRateLimit` middleware that **does not exist anywhere in the repo** | `apiRouter.ts:1623-1630`; `members.ts:677-680` |
| `POST /api/bookings/cancel` | **no IP limit** — Turnstile only; its read-only sibling has 10/min | `apiRouter.ts:904-927` (vs `:944`) |
| `POST /api/email/*` (17 actions) | 3/hour keyed on **client-supplied** `bookingRef \|\| bookingId \|\| inquiry.email \|\| email`, falling back to IP only when none are present | `apiRouter.ts:1912-1913` |

### H6 — The rate-limit key comes from a client-controllable header
**Anchor:** `guest-app/server/apiRouter.ts:467`

```ts
const rawIp = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.socket.remoteAddress || "unknown";
const ip = …String(rawIp).split(",")[0].trim();
```

The **first** hop of `x-forwarded-for` is client-supplied. A caller that varies the header gets a fresh rate-limit bucket per request, which defeats every limit in the table above.

### H7 — Failed emails have no retry path
**Anchor:** `guest-app/server/handlers/email.ts:1071-1096` (`retryCount: 0`) · `admin-app/src/components/FailedEmailsBanner.tsx` · `firebase/firestore.rules:560-567`

The DLQ exists and the `failed_emails` rule is correctly admin-read-only — but there is **no retry route** in the router and **no retry button** in the banner. The comment says "the operator can audit + retry"; the operator can only audit. `retryCount` is always 0 because nothing increments it. A guest whose confirmation email failed never receives it unless the desk re-sends manually.

### H8 — No recurring finance reconciliation
**Anchor:** `vercel.json:30-43` — only 3 crons (`email/checkin-reminder`, `janitor/storage-sweep`, `notifications/prune`)

`scripts/finance-integrity-scan.ts` is a **one-off, manual, review-first CLI** (last run 2026-07-14, 0 findings). Nothing reconciles the payment ledger against bookings nightly. For a business whose entire value is the night's revenue, this is the missing safety net.

### H9 — Every launch QA gate is untouched
**Anchor:** `plan/project/ROADMAP.md`

| Phase | Open items | Line |
|---|---|---|
| Phase 8 — Intercom manual QA | 10 (voice call, store order + stock restore, mobile loop ×2, QR regen, notification sound) | `:98-108` |
| Phase 10 — Security & Polish | 5 — **Firebase API key domain restriction**, performance audit, cross-browser QA, mobile QA, **WCAG 2.1 AA accessibility QA** | `:114-121` |
| Phase 11 — Staging & Launch | 14 — staging merge, client review, **PC-05 archive + carry-over**, **PC-06 cutover + smoke test**, first real Daily Close | `:130-156` |
| Phase 11.7 — Admin mobile | 18 screens × 6 breakpoints, real devices — deferred to P3 | `:158-163` |
| BDUX | 8 verification items | `:248-257` |
| Phase 11.9 — SEO | card validation + Search Console submission | `:172-178` |

None of these are code tasks. They are the definition of production readiness, and every one of them is still open.

### H10 — `hotel.config.ts` is bundled into the API but the bundle guardrail does not watch it
**Severity:** High · **Anchor:** `scripts/check-api-bundle.mjs:15-17,35-39` · `guest-app/server/apiRouter.ts:43` · `guest-app/server/handlers/{email,bookings,reference,breakfast-manage}.ts`

The API bundle is a committed build artifact, and the pre-commit hook rebuilds it to reject a stale one. But the hook only fires when a staged path starts with `guest-app/server/` or `shared/`:

```js
const bundleInputsChanged = stagedFiles.some((file) =>
  file.startsWith("guest-app/server/") || file.startsWith("shared/")
);
```

`hotel.config.ts` lives at the **repo root** and is imported directly by the server (`import config from "../../hotel.config"` in `apiRouter.ts:43`, plus `lib/siteUrl.ts`, `handlers/email.ts`, `handlers/bookings.ts`, `handlers/reference.ts`, `handlers/breakfast-manage.ts`). It is bundled into the API — 146 config references are present in the committed 11.8 MB bundle. **A change to `hotel.config.ts` therefore ships without regenerating the bundle**, and Vercel deploys an API running the *old* config while the front-end (which Vite compiles directly) runs the new one.

The blast radius is not cosmetic: `config.timezone` drives the booking date math (the exact OCT-C4 failure class), `config.domain` / `config.adminDomain` drive the production host allowlist in `apiRouter.ts:81-89`, and `config.brandName` / `config.supportEmail` / `config.frontDeskPhone` are baked into every guest email. **This bites immediately on the M3 fix** — changing `frontDeskPhone` and `supportEmail` in `hotel.config.ts` without regenerating the bundle leaves the deployed emails and intercom contact details on the placeholder.

*Related, benign:* the committed bundle at `HEAD` embeds `VERSION = "2.18.1"` while `shared/VERSION.ts` is at `2.18.2` — the bundle is otherwise byte-identical to a fresh build (verified byte-diff: the only differing bytes are the version string). The Husky version bump lands after the pre-commit check, so the embedded version lags by one bump. Cosmetic only — the footer would show the previous version — and the bundle's *code* is current.

---

## MEDIUM (10)

| # | Finding | Anchor |
|---|---|---|
| **M1** | CSP `script-src` includes `'unsafe-eval'` — materially weakens XSS protection | `vercel.json:9` |
| **M2** | No `Strict-Transport-Security` header | `vercel.json` (absent) |
| **M3** | **Placeholder public config**: `frontDeskPhone: "+63-38-000-0000"`, `supportEmail: "sparkinn.dev@gmail.com"` (surfaces in footer, contact page, terms, intercom, and booking-lookup copy), `analyticsId: ""`, `whatsappNumber: ""`, `twitterHandle: ""` | `hotel.config.ts:62-71` → `Footer.tsx:27-28`, `ContactPage.tsx:22-23`, `TermsPage.tsx:194-195`, `IntercomPage.tsx:1251,1383-1384`, `BookingLookupPage.tsx:1910` |
| **M4** | Legacy `remarks` / `blockReason` on public `rooms` docs — auto-migrated on the first admin dashboard load, but **never swept proactively**; until an admin loads the page, legacy staff notes sit on a world-readable document | `admin-app/src/context/AdminContext.tsx:1395-1411,1432` |
| **M5** | Doc system at **803k tokens against its own 230k ceiling**; 18 `docs:audit` errors; always-read bundle 20.9k vs a 10k ceiling; `GOTCHAS.md` alone is 17k. Every agent turn pays this tax, and the rule set that agents must load is itself over budget | `npm run docs:audit` output |
| **M6** | The roadmap's "🔴 Still open" section is **stale** — bug #20/#21 (Members blank screen) is already fixed in code via decision #219 but still listed as needing a fix branch | `plan/project/ROADMAP.md:612-620` vs `admin-app/src/context/AdminContext.tsx:4026-4033` (the `getIdToken(true)` wrapper is present) |
| **M7** | **File size / maintainability**: `bookings.ts` 14,398 lines · `SettingsPage.tsx` 10,861 · `BookingsPage.tsx` 9,371 · `AdminContext.tsx` 8,328 · `BookingPage.tsx` 5,869 | repo-wide |
| **M8** | Admin bundle is a single 3.76 MB chunk (999 KB gzip), no code splitting; the perf gate is unchecked | `npm run build:admin` output |
| **M9** | `corporateInvoices` create is denied when `amount == 0` — a zero-outstanding invoice cannot be written | `firebase/firestore.rules:353`; `ReportsPage.tsx:1236` |
| **M10** | `charges` are staff-writable to ±1,000,000 with no reconciliation job watching them | `firebase/firestore.rules:142-145` |

---

## Recommended sequence

**Step 1 — the seven blockers.** They are small, surgical, and mostly one-file changes. B1 and B2 are one `match` block each. B3/B4/B5 are rule tightenings. B6 needs a server-side stay check on the send path. B7 needs an upload-token or at minimum a size/content-type cap. Two of the seven (B1, B2) are the *same* class the October audit already caught — fixing them without adding the guardrail means the third recurrence is a matter of time.

**Step 1b — one-line fix that prevents a whole class.** Widen the bundle guardrail to watch `hotel.config.ts` (`scripts/check-api-bundle.mjs:15-17` and `:35-39`). It is a two-token change that closes a source≠production hole that the M3 fix would otherwise walk straight into.

**Step 2 — close the two launch gates that only exist in Firebase Console + the QA matrix.** The Firebase API key domain restriction and the WCAG 2.1 AA pass are contractual obligations (RA 10173 for the privacy side, and `plan/docs/FRONTEND.md §Accessibility` for the rest). They are not optional and they are not code.

**Step 3 — add a DOM harness for the surfaces that carry money.** The booking flow, the folio, and the lifecycle modals. This is the only way the suite stops being a tripwire for the source text rather than for the software.

**Step 4 — the operational layer.** A retry path for failed emails, a nightly reconciliation, and a real `email/support@` + real front-desk phone in `hotel.config.ts`.

### The one judgment call that needs a green light

**Should the intercom read/write surface be tightened (B3–B6) before launch, or scheduled as post-launch?** The intercom is the front desk's primary guest channel and the QR-in-room flow is the feature's whole premise. Tightening `intercoms/{roomId}/messages` to staff-read breaks the *guest's* ability to see the conversation — so the fix is not a rule edit, it is a design decision: move the guest's message read behind a token-scoped API route (the same shape the booking-lookup credential already uses), which is a real piece of work rather than a one-line rule change.

**My recommendation: fix it before launch.** The intercom carries guest PII, the QR tokens are enumerable, and B6 means anyone can post as a guest into the channel the desk trusts. The alternative — shipping it and scheduling the fix — means the first incident is a stranger messaging the front desk as a guest. Given this is a 14-room hotel where the desk physically knows who is in which room, the exposure is modest; but "modest exposure in a channel staff are told to trust" is the exact profile of the issues that make a front-desk system hard to trust in production.

---

## Verification method

**Executed:** `npm run typecheck` (clean) · `npm run test:fast` (5,473 passed) · `npm run build:guest` (success) · `npm run build:admin` (success) · `npm run check:api-bundle` (pass) · `npm run docs:audit` (18 errors) · `npm run spec:audit` (OK — 166 handler mentions, 100 handlers indexed) · `git ls-files` secret scan · Firestore/Storage rules read in full · client SDK call-site enumeration across `guest-app/src` + `admin-app/src` · API router read in full (2,267 lines) · every money handler traced.

**Not executed (and therefore not claimed):**
- `npm run test:rules` — the Firestore emulator needs a Java runtime, which is not installed on this machine. Every rule verdict above (B1–B5, H3, H4, M9, M10) is derived from rule semantics and Firebase's documented v2 wildcard behavior, **not** from an observed emulator denial. The first run of `npm run test:rules` on a machine with Java should confirm or refute B1 and B2 in minutes.
- No live request was made; no staging or production environment was touched.
- The `hotel.config.ts` placeholders (M3) were confirmed by reading the config and the components that consume it — the actual Firebase `settings/hotelConfig` document may already override them at runtime. The **config defaults** are placeholders regardless, and `supportEmail` / `frontDeskPhone` fall back to `config` whenever the Firestore document omits the field (`usePublicSiteContent.ts:305-306`).

**Delegated and independently re-verified:** the API-surface and Firestore-rules sweeps were run by separate read-only agents. Every headline claim above was then re-read and confirmed against the source by hand, and two claims were **corrected downward** on that second pass — the `email/booking-submitted` trigger *is* guest-match-guarded (`email.ts:1177-1219`), and the store-order path *does* require an active booking (`store.ts:280-306`).
