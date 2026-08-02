# Contributing & Sync Protocol
> Requires: CLAUDE.md

---

## MD Ownership Rules

Each piece of information lives in exactly one MD. Reference it elsewhere — never repeat it.

| Information | Owned by |
|---|---|
| Architecture/stack/security/white-label decisions | `plan/docs/DECISIONS-ARCH.md` |
| Feature/product/compliance decisions | `plan/docs/DECISIONS-FEATURES.md` |
| Firestore schema (all collections) | `plan/docs/BACKEND.md` |
| TypeScript types | `plan/docs/TYPES.md` |
| Brand tokens, typography, component rules | `plan/docs/FRONTEND.md` |
| Environment variables | `plan/docs/ENV-SETUP.md` |
| Folder structure, naming conventions | `plan/docs/FILE-STRUCTURE.md` |
| "Never do this" rules | `plan/docs/GOTCHAS.md` |
| API route surface | `plan/docs/API-ROUTES.md` |
| Feature UI + logic checklists | Relevant `plan/features/*.md` |
| Wireframe workflow, screen checklist, Stitch asset map | `plan/docs/WIREFRAME-WORKFLOW.md` |
| IP ownership, ToS, GDPR, accessibility commitment, licensing, support terms | `plan/docs/LEGAL.md` |
| Master TOC + read bundles + hard rules | `CLAUDE.md` |
| Business context (client, personas, goals, contract) + doc index | `plan/project/context/spark-inn-MASTER-CONTEXT.md` |
| Current build status + open work | `plan/project/ROADMAP.md` (open items only — shipped detail moves to the archive) |
| Completed-phase history, closed audit fixes | `plan/project/archive/` + Git history |
| Audit findings (open MED/LOW of the current audit) | `plan/docs/AUDIT-E2E-REPORT.md` (closed audits: `plan/project/AUDIT-*.md`, historical) |
| Operational procedures (deploy, cutover, setup, QA scenarios) | `plan/project/DEPLOY.md` / `PROD-CUTOVER-RUNBOOK.md` / `SETUP-GUIDE.md` / `QA-SCENARIOS.md` |
| Contract goodwill / scope extras | `plan/project/GOODWILL-SCOPE-LOG.md` |

---

## When to Update Which MD

| What changed | Update these MDs |
|---|---|
| New architecture/stack decision | `plan/docs/DECISIONS-ARCH.md` + affected feature MD |
| New feature/product decision | `plan/docs/DECISIONS-FEATURES.md` + affected feature MD |
| Schema field added/changed | `plan/docs/BACKEND.md` + `plan/docs/TYPES.md` |
| New TypeScript type | `plan/docs/TYPES.md` only |
| New environment variable | `plan/docs/ENV-SETUP.md` only |
| New API route | `plan/docs/API-ROUTES.md` only |
| New "never do this" rule | `plan/docs/GOTCHAS.md` only |
| Feature scope changed | Relevant `plan/features/*.md` |
| Wireframe screen completed | `plan/docs/WIREFRAME-WORKFLOW.md` checklist (mark `[x]`) |
| New feature file added | `plan/docs/FILE-STRUCTURE.md` + `CLAUDE.md` TOC |
| New MD file created | `CLAUDE.md` TOC + this file's ownership table |
| Major feature/phase completed | `plan/project/context/spark-inn-MASTER-CONTEXT.md` |
| **A `feat:` / `fix:` / `refactor:` commit lands on `dev`** (roadmap item shipped, OR an off-roadmap fix/feature ships) | `plan/project/ROADMAP.md` — mark the item ✅ with a one-line shipped note + commit hash, or add a "Recently shipped (off-roadmap)" entry. **The roadmap is the source of truth for "what's open" — drift between the code and the roadmap makes the next person pick wrong work. Required on every merge to `dev`.** |

---

## How to Update MDs

1. Find the owning MD (table above)
2. Edit only that MD — do not duplicate content elsewhere
3. If a feature MD needs to reference the change, add a one-line reference: "See `plan/docs/BACKEND.md §bookings`"
4. Commit with a `docs:` prefix: `docs: update BACKEND.md with voucherDiscount field`

---

## Branching & Commit Rules

**Branch naming:**
- `feature/<phase-n>-<short-slug>` — new feature (e.g. `feature/phase-9-booking-lookup`, `feature/phase-4-booking-flow`)
- `fix/<phase-n>-<short-slug>` — bug fix (e.g. `fix/phase-5-availability-locking`)
- `docs/<phase-n>-<short-slug>` — documentation-only (e.g. `docs/phase-9-update-roadmap`)
- Audit fix branches use the audit ID: `fix/audit-24-store-charges-schema`

**Why include the phase number:**
- A glance at any open or recent branch tells you which phase of the roadmap it belongs to, even after the work is merged and the commit history is months old.
- Branch names stay stable if work spans multiple phase boundaries (don't rename mid-flight just because scope drifted).
- The phase number is the project's primary planning unit (see `plan/project/ROADMAP.md`). Putting it on the branch keeps branches and roadmap in lockstep.
- The `phase-` prefix is required; bare `feature/<name>` is reserved for cross-cutting work that doesn't fit a single phase (rare — prefer scoping it to a phase).

**Conventional Commits:**

| Prefix | When to use | Version bump |
|---|---|---|
| `feat:` | New feature or significant addition | MINOR |
| `fix:` | Bug fix | PATCH |
| `release:` | Production release | MAJOR |
| `docs:` | MD or documentation update only | None |
| `chore:` | Tooling, config, dependencies | None |
| `refactor:` | Code change with no behavior change | PATCH |
| `style:` | Formatting, whitespace | None |

Husky's `commit-msg` hook auto-bumps `shared/VERSION.ts` based on the prefix.

**Branch retention (do not delete merged branches):**
- Once a feature/fix/docs branch is merged into `dev`, **leave the branch in place** — locally and on origin. Merged branches are cheap, and the commit history is the source of truth for "what was in this feature/fix before it landed." Deleting a merged branch throws away its human-readable label (e.g. `feature/email-system`) and makes it harder to grep, bisect, or re-cherry-pick later.
- If a branch was force-pushed, rebased, or otherwise lost, recreate it at the original tip commit: `git branch <name> <sha>`. The SHA is recoverable from `dev`'s log.
- Do **not** run `git branch -d` / `git branch -D` / `git push origin --delete` on merged branches without explicit user instruction.
- The only acceptable reasons to delete a branch are: (a) the user explicitly asks, or (b) the branch was created by mistake and never merged anywhere (e.g. typo'd name, abandoned spike).

---

## Testing

Three test layers, each with a different purpose. **Pick the right one for the bug you're guarding against** — the wrong layer silently misses whole bug classes.

| Layer | What it tests | Cost | Catches |
|---|---|---|---|
| Source-text (default `npm test`) | Asserts that source patterns exist (string matches, import paths, interface shapes). Cheap, deterministic, no setup. | <5s per workspace | Regressions of structure — "did someone rename this function?" "did someone remove this import?" "does the interface still declare this method?" |
| Emulator-based rules (`firebase/tests/*.rules.test.ts`, runs under `npm run test:rules`) | Loads `firestore.rules` into the Firestore emulator and exercises real read/write attempts with the right auth contexts. | ~15s emulator startup + test time | Invalid-but-present rules (NC-02c shipped a `keys().union(...)` rule that passed every grep test but errored at evaluation time). Access-control regressions. |
| Emulator-based behavioral (`firebase/tests/*.emulator.test.ts`, same `npm run test:rules`) | Replicates the write pattern against a real Firestore and asserts the contract. Does not import application code (which is React-context code, hard to load in Node). | ~15s emulator startup + test time | Wrong-answer-no-error-no-test-failure bugs. The exact class RTS-01 was — the success toast fired, the values snapped back on the next snapshot, and no source-text test could ever catch it. |

**Rules that earned their place:**

- **Default to source-text.** It is fast and catches the common case. Do not write emulator tests for things source-text already covers (string presence, import paths, function signatures).
- **Promote to emulator when the bug class is "looks right, behaves wrong."** A behavioral test for a write race, a money math path, an availability transaction, a discount calculation, an idempotency key, a timestamp invariant — any contract that Firestore evaluates at runtime, not at parse time. The first such test is `firebase/tests/room-types-array-write.emulator.test.ts` (PMH-03, 2026-07-31) — pins the RTS-01 fix at the Firestore layer.
- **Test pattern for `*.emulator.test.ts` files** — seed via the admin context, exercise the write pattern, assert the contract. Do not import `AdminContext` or other React-context code; replicate the write semantics directly. The harness loads `firestore.rules` automatically, so any rule change that breaks a write will surface here too.
- **The Java requirement is real.** `npm run test:rules` boots the Firestore emulator, which needs Java. `npm run test:fast` skips it. CI uses `npm test` (full chain) so emulator tests must pass before merge.

**Scripts:**

- `npm test` — full chain: shared + api + admin + infra + rules. Includes the emulator. Requires Java.
- `npm run test:fast` — source-text only: shared + api + admin + infra. Sub-30s. No Java required.
- `npm run test:rules` — emulator only (`firebase emulators:exec --only firestore` + `vitest run --config vitest.rules.config.ts`). Includes both `*.rules.test.ts` and `*.emulator.test.ts`.
- `npm run test:shared` / `test:guest:api` / `test:infra` — individual layers.

**Naming convention:**

- `*.rules.test.ts` — security-rule evaluation (existing).
- `*.emulator.test.ts` — behavioral write-path test (new in PMH-03).
- `*.test.ts` (anywhere else) — source-text test, picked up by the app's own vitest config.

---

## Deploy Checklist (merge `dev → main`)

- [ ] All features for this milestone are complete and manually QA'd
- [ ] No `.env` files staged or committed
- [ ] `shared/VERSION.ts` is bumped (Husky handles automatically — verify it ran)
- [ ] Footer displays correct version on both apps
- [ ] Firestore security rules tested in emulator
- [ ] Firebase Storage CORS configured
- [ ] Vercel environment variables set for production
- [ ] `robots.txt` domain updated for production URL
- [ ] `sitemap.xml` domain updated for production URL
- [ ] `hotel.config.ts → address` fields populated (used in JSON-LD structured data)
- [ ] `hotel.config.ts → ogImage` exists at `public/brand/` in correct 1200×630px dimensions
- [ ] Structured data validated with [Google Rich Results Test](https://search.google.com/test/rich-results) on homepage and rooms page
- [ ] Google Search Console — site verified and sitemap submitted
- [ ] Client has been notified of deploy

---

## No-Repetition Enforcement

If you find the same information in two MDs, that is a bug. Fix it by:
1. Identifying which MD owns the information (table above)
2. Keeping the content only in the owning MD
3. Replacing the duplicate with a reference line

---

## Definition of Done (per phase)

A phase is not complete until every item below is checked. DK signs off before starting the next phase.

- [ ] All P0 features for this phase are built and manually QA'd against their feature MD checklists
- [ ] No known critical bugs (broken flows, data errors, security issues)
- [ ] Accessibility checklist passed on all new screens (see `plan/docs/FRONTEND.md §Accessibility`)
- [ ] All new Firestore collections have security rules tested in emulator
- [ ] No `.env` values hardcoded anywhere in committed code
- [ ] `shared/VERSION.ts` bumped correctly
- [ ] Staging (Vercel `dev` branch preview) reviewed and approved by DK
- [ ] Client has seen a demo and given written (chat/email) go-ahead to proceed

---

## Change Request Process

Scope is defined per phase. If the client requests a change mid-phase:

1. **Minor clarification** (same feature, clearer spec) → implement immediately, no process needed
2. **Small addition** (new field, new email trigger, new status) → log in `DECISIONS-FEATURES.md`, implement if it fits within phase timeline, otherwise defer to next phase
3. **New feature or significant scope change** → stop, discuss with client, get written confirmation, add to `ROADMAP.md` as a new phase item or separate quote

Rule of thumb: **if it changes the data model, adds a screen, or takes more than 2 hours — it's a change request, not a clarification.** Never implement unconfirmed scope changes silently.

---

## Feature Intake & Spec Workflow

How a request becomes a roadmap block. Established 2026-07-31; every block from `WPM` onward follows it. Use it for anything that qualifies as a change request above — do not start coding from a chat message.

### The loop

1. **Investigate before answering.** Read the actual code paths the request touches. Count the call sites. Name the files and line numbers.
2. **Verify every claim against code, never against an MD.** The docs drift. On 2026-07-31 `DECISIONS-FEATURES.md #115` stated the system exports a 12% VAT / VATable / VAT-Exempt breakdown; a repo-wide search returned **zero** occurrences. `FIN-06` had been closed as "decision logged", which was true — the calculation never followed. If an MD claims a behaviour exists, grep for it before repeating the claim.
3. **Surface what the investigation found**, separately from what was asked. Requests and findings are different things and should be labelled as such (see "Findings" below).
4. **Ask only the decisions that change the work.** Each question needs a stated recommendation and a working default. Anything answerable from the codebase or from convention is not a question — decide it and say so.
5. **Spec it as a block** (anatomy below), with dependencies and sequencing made explicit.
6. **Commit and merge** per the git flow below. No code in the same commit.

### Block anatomy

Every block is a `### ` section in `ROADMAP.md §Phase 12` with a three-letter code:

- **Heading** — `### Name (CODE) — proposed|reported YYYY-MM-DD` plus a size or priority marker where useful (`· P1`, `· large, phased`, `· small`).
- **Preamble blockquote** — the request in one line; what exists today with file/line evidence; the owner's decisions, dated; dependencies and what this gates; anything already half-built that the work can reuse. Flag cost-changing consequences with **⚠**.
- **Numbered items** — `- ⬜ **CODE-01 — Short imperative title** — detail.` Each item is independently reviewable. The last item is always **Tests + MD sync**, naming every MD that must change.

### Rules that earned their place

- **Reserve a decision number** in the preamble (`#141`, `#142`, …); write the entry in `DECISIONS-FEATURES.md` only when the implementation lands. Reserving avoids collisions across parallel blocks; deferring the write avoids documenting decisions that get revised.
- **Label findings distinctly from requests.** Work discovered during investigation — `RTS-01`, `NBS-08`, `DSC-06`, `EXB-10`, `WRV-01` — is marked in the item text (**CONFIRMED**, **ADJACENT FINDING**, **the real trap**). These are the items most likely to be dropped, because nobody asked for them.
- **State the failure mode, not just the fix.** "Reports silently drops unknown sources — no error, no warning" is actionable. "Make Reports dynamic" is not.
- **Record rejected alternatives and why.** `MRB` records why one document holding `rooms[]` was rejected over `groupId`; `NBS-02` records why the API route is not renamed. Without this, the next reader re-opens a settled question.
- **Make dependencies explicit both ways.** If A gates B, say so in A *and* in B. Keep the running order in the `Last updated` line so it survives without reading every block.
- **Supersede, don't delete.** When a decision reverses (`CVQ-01` flipped the child-breakfast rule and moved `CHD` behind the extraction), strike the old text and record the reversal with its consequence. The history is why the sequencing looks the way it does.

### Client Validation Queue (CVQ)

Decisions taken quickly need validating against how the hotel actually operates. Log them as a compact table — question, working default, affected items, why it matters — so **nothing hard-blocks** on a client meeting. Mark which single question changes engineering *cost* rather than a config value, and ask that one first. Fold each row into its decision entry when answered; delete the section when empty.

### Git flow

- Branch `docs/<topic>` off `dev` — never work on `dev` directly, even for docs.
- Commit `docs: update ROADMAP.md — <summary>`. The body carries the reasoning: what was found, what was decided, what it costs. `docs:` does not bump `VERSION`.
- `npm run docs:audit` before committing.
- Merge with `--no-ff` and a `chore: merge <branch>` message, matching the existing history.
- One block per branch. Cross-block edits (dependency updates, supersessions) ride along with the block that caused them.

### Lifecycle

Block specced → items ship (`⬜` → `✅`) → when every item is done, move the detail to `plan/project/archive/` and leave a one-line ✅ pointer, per §Documentation Budgets & Lifecycle. Open follow-ups stay in the roadmap; they do not go to the archive with their parent block.

### Block code registry

Keep codes unique. In use as of 2026-07-31 — open: `WRV` `WPM` `NBS` `DSC` `PEX` `CVQ` `CHD` `EXB` `PMH` `MRB` `RTS` `BDUX` `FSO` `ETR` `FLR` `PC` `CRL`. Archived: `GCR` `CWB` `LCE` `ECE` `GSD` `BSP` `MBP` `WSN` `HSD` `MBZ` `FIN` `FR` `FL` `PF` `QA` `NC` `AUD` `SA`.

---

## Adding a New MD

If a new feature or concern warrants a new MD:
1. First check whether an existing MD already owns the topic (table above) — extend it instead of creating a near-duplicate
2. Create the file in the appropriate folder (`plan/docs/` or `plan/features/`)
3. Add it to `CLAUDE.md` Table of Contents
4. Add it to the ownership table in this file
5. Add a `> Requires:` line at the top listing its dependencies
6. Run `npm run docs:audit` and commit with `docs:` prefix

---

## Documentation Budgets & Lifecycle

`npm run docs:audit` (also part of `npm run preflight`) enforces these limits. Estimated tokens ≈ character count ÷ 4. The audit warns at 90% of a ceiling and fails above it (links and markers fail outright).

| Active context | Ceiling (est. tokens) |
|---|---:|
| `CLAUDE.md` (always-read agent entry) | 5,000 |
| `plan/project/ROADMAP.md` | 6,000 — above the 3,000 default because the project is mid-launch with several parallel open operational checklists (Phase 8/10/11 QA, cutover, E2E-audit fixes); open work is never deleted to satisfy a budget. Re-tighten to 3,000 after launch. |
| `plan/project/context/spark-inn-MASTER-CONTEXT.md` | 5,000 |
| Any single `plan/features/*.md` | 8,000 |
| Any single `plan/docs/*.md` (domain doc) | 10,000 |
| **Ratchet exceptions** (oversized contract docs — ceiling set just above current size so further growth fails; compact toward the standard ceiling next time the feature is materially touched): `ADMIN-MOBILE.md` 10,500 · `SETTINGS.md` 9,000 · `BACKEND.md` 12,500 (grew for the 2026-07-17 PRC/UCO/ETR schema sync). `BOOKINGS-MANAGEMENT.md` was compacted back under the standard ceiling on 2026-07-17 and no longer has an exception. | — |
| Combined always-read (`CLAUDE.md` + `GOTCHAS.md`) | 10,000 |
| Entire active MD system | warn above 120,000 |

**Excluded from active totals:** `plan/project/archive/`, `plan/project/AUDIT-*.md`, `plan/project/AI-MD-SYSTEM-PROMPT.md`, `plan/project/context/spark-inn-MD-PLAN.md`, `plan/stitch/`, `node_modules`/build output.

**Compaction & Archive Verbatim Invariant Rules:**
- **Verbatim Text & Technical Context Preservation:** When compacting active documentation, NEVER summarize, shorten, or delete open task specifications or drop technical context details. Retain exact verbatim task descriptions for all open items in active docs.
- **Historical Archive Full Detail Rule:** For shipped phases, completed audit batches, and historical feature blocks moved to `plan/project/archive/` (with a `HISTORICAL ARCHIVE` marker), ALWAYS retain 100% of the exact verbatim text, detailed multi-paragraph implementation narratives, decision records, and code specs from pre-compaction sources without truncating or summarizing them. Because archive files are excluded from token budget limits, they preserve full historical fidelity.
- **One fact, one home:** Everything else links to the primary owner MD (see §MD Ownership Rules).
- **Timing:** Take an archive snapshot **before** materially compacting any large active doc.
- **Keep active:** Current behavior, requirements, acceptance criteria, open task specifications with their verbatim technical context, unresolved risks, security/data invariants, and deferral decisions with their triggers.
- **Move out:** Branch/commit diaries, passing test logs, completed walkthroughs, and superseded proposals.
- Archives and historical audits are never part of a normal implementation read bundle.

**Review triggers** — run a documentation review (inventory, dedupe, compact/archive):
- Before starting a major roadmap phase, and after roughly five roadmap items ship
- Whenever `docs:audit` warns or fails
- When one task repeatedly needs > 30,000 documentation tokens to complete
- Before creating a new canonical MD
- When a single change grows a doc by more than 10% — decide explicitly: keep, compact, or archive
