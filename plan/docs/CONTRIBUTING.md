# Contributing & Documentation Lifecycles
> Requires: CLAUDE.md

Guidelines for maintaining documentation, proposing specs, intake of bug reports and feature requests, code auditing, and managing context token budgets in the Spark Inn codebase.

---

## Documentation Structure & Ownership Rules

Every concept has **one primary owner MD**. Other documents cross-reference it using relative markdown links (e.g. `[BACKEND.md](plan/docs/BACKEND.md)`) — **never duplicate** detailed definitions, schemas, or specs across files.

| Ownership Area | Primary Owner MD | Cross-Referenced By |
|---|---|---|
| Repository guidelines, agent instructions | `CLAUDE.md` | `AGENTS.md`, `GEMINI.md` |
| Master project context & tech stack | `plan/project/context/spark-inn-MASTER-CONTEXT.md` | `CLAUDE.md` |
| Active roadmap & item checklist | `plan/project/ROADMAP.md` | All feature specs |
| Architectural & feature decisions | `plan/docs/DECISIONS-FEATURES.md` | Feature MDs |
| Database schemas & Firebase rules | `plan/docs/BACKEND.md` | `API-ROUTES.md`, Feature MDs |
| Server API routes & authorization | `plan/docs/API-ROUTES.md` | `SECURITY.md`, Feature MDs |
| Security model, roles & rules | `plan/docs/SECURITY.md` | `BACKEND.md`, `API-ROUTES.md` |
| UI design system & components | `plan/docs/FRONTEND.md` | Feature MDs |
| Data types & interfaces | `plan/docs/TYPES.md` | All feature specs |
| Gotchas, lessons & rules that earned a place | `plan/docs/GOTCHAS.md` | `CLAUDE.md`, `ROADMAP.md` |
| Guest booking flow & availability | `plan/features/BOOKING-FLOW.md` | `ROADMAP.md`, `BACKEND.md` |
| Admin bookings management workspace | `plan/features/BOOKINGS-MANAGEMENT.md` | `ROADMAP.md`, `BACKEND.md` |
| Room management & status tracking | `plan/features/ROOM-MANAGEMENT.md` | `ROADMAP.md`, `BACKEND.md` |
| Rate & pricing rules | `plan/features/RATE-MANAGEMENT.md` | `ROADMAP.md`, `TYPES.md` |
| Dynamic settings & configuration | `plan/features/SETTINGS.md` | `ROADMAP.md`, `BACKEND.md` |
| Intercom guest chat & calls | `plan/features/INTERCOM-GUEST.md` | `ROADMAP.md`, `SECURITY.md` |
| Spark Rewards loyalty program | `plan/features/SPARK-REWARDS.md` | `ROADMAP.md`, `TYPES.md` |
| Corporate bookings & invoicing | `plan/features/CORPORATE-BOOKING.md` | `ROADMAP.md`, `API-ROUTES.md` |
| Reports, analytics & exports | `plan/features/REPORTS.md` | `ROADMAP.md`, `BACKEND.md` |
| Transactional email templates | `plan/features/EMAIL-PDF-STORAGE.md` | `ROADMAP.md`, `API-ROUTES.md` |
| Store & in-room ordering | `plan/features/STORE-MANAGEMENT.md` | `ROADMAP.md`, `SECURITY.md` |
| Environment test & staging reset | `plan/features/ENVIRONMENT-TEST-RESET.md` | `ROADMAP.md`, `BACKEND.md` |
| White-label configuration | `plan/docs/WHITE-LABEL.md` | `hotel.config.ts` |
| Deployment & production cutover | `plan/project/DEPLOY.md`, `PROD-CUTOVER-RUNBOOK.md` | `ROADMAP.md` |

---

## Feature Intake & Spec Workflow

### Before writing code

1. **Investigate first** — read the primary owner MD and inspect actual code (`src/`, `server/`, `shared/`) to confirm reality before writing specs.
2. **One fact, one home** — put schema changes in `BACKEND.md`, routes in `API-ROUTES.md`, types in `TYPES.md`, feature behavior in the relevant `plan/features/*.md`, and task items in `ROADMAP.md`.
3. **Spec format in ROADMAP.md** — every block gets a unique code (e.g. `MRB`, `PEX`, `DSC`), a preamble with context and file/line evidence, and numbered checklist items (`CODE-01..NN`).
4. **Reserve decision numbers** — state reserved numbers in preamble; write entries in `DECISIONS-FEATURES.md` when implementation lands.
5. **Run docs audit** — `npm run docs:audit` must pass with 0 errors before starting code changes.

---

## Spec Format for Phase 12 & Future Features

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
| **Ratchet exceptions** (oversized contract docs — ceiling set just above current size so further growth fails; compact toward the standard ceiling next time the feature is materially touched): `ADMIN-MOBILE.md` 10,500 · `SETTINGS.md` 9,000 · `BACKEND.md` 12,500. | — |
| Combined always-read (`CLAUDE.md` + `GOTCHAS.md`) | 10,000 |
| Entire active MD system | warn above 120,000 |

**Excluded from active totals:** `plan/project/archive/`, `plan/project/AUDIT-*.md`, `plan/project/AI-MD-SYSTEM-PROMPT.md`, `plan/project/context/spark-inn-MD-PLAN.md`, `plan/stitch/`, `node_modules`/build output.

**Compaction & Archive Verbatim Invariant Rules:**
- **Verbatim Text & Technical Context Preservation:** When compacting active documentation, NEVER summarize, shorten, or delete open task specifications or drop technical context details. Retain exact verbatim task descriptions for all open items in active docs.
- **Historical Archive Full Detail Rule:** For shipped phases, completed audit batches, and historical feature blocks moved to `plan/project/archive/` (with a `HISTORICAL ARCHIVE` marker), ALWAYS retain 100% of the exact verbatim text, detailed multi-paragraph implementation narratives, decision records, and code specs from pre-compaction sources without truncating or summarizing them. Because archive files are excluded from token budget limits, they preserve full historical fidelity.
- **One fact, one home:** Everything else links to the primary owner MD (see §MD Ownership Rules).
- **Timing:** Take an archive snapshot **before** materially compacting any large active document.
- **Keep active:** Current behavior, requirements, acceptance criteria, open task specifications with their verbatim technical context, unresolved risks, security/data invariants, and deferral decisions with their triggers.
- **Move out:** Branch/commit diaries, passing test logs, completed walkthroughs, and superseded proposals.
- Archives and historical audits are never part of a normal implementation read bundle.

**Review triggers** — run a documentation review (inventory, dedupe, compact/archive):
- Before starting a major roadmap phase, and after roughly five roadmap items ship
- Whenever `docs:audit` warns or fails
- When one task repeatedly needs > 30,000 documentation tokens to complete
- Before creating a new canonical MD
- When a single change grows a doc by more than 10% — decide explicitly: keep, compact, or archive
