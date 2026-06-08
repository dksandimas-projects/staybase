# AI Prompt — Build an MD Documentation System for a Web App
> Reusable prompt for any new web app project.
> Copy everything below the line and paste it at the start of a new AI session.
> **Scale to your project's complexity** — not every section applies to every app. A simple single-surface CRUD app needs maybe 10 files. A multi-app, white-label, loyalty-program-having system like Spark Inn needs 42. Use your judgment.

---

## The Two-File System

This prompt works best as part of a two-file workflow:

| File | Purpose | Audience |
|---|---|---|
| `AI-MD-SYSTEM-PROMPT.md` (this file) | Reusable process — how to build any MD system | The AI agent starting a new project |
| `[project-name]-MASTER-CONTEXT.md` | Project-specific facts — what to build and why | Humans + AI agents resuming mid-project |

**How they work together:**
1. You build `MASTER-CONTEXT.md` first — write down everything about the project: goals, client, stack, features, all resolved decisions, budget, timeline, team.
2. When starting a new MD build session, you paste this prompt AND attach `MASTER-CONTEXT.md`. The AI reads the context file first and skips any clarifying questions already answered there.
3. Once the MD system is built, `MASTER-CONTEXT.md` serves as the human-readable project reference for future sessions — attach it to any new Claude session to restore full context instantly.

**What belongs in each file:**
- `MASTER-CONTEXT.md` → project-specific facts (client, stack, features, decisions, timeline)
- `AI-MD-SYSTEM-PROMPT.md` → the process (questions, rules, templates, audit checklist) — never project-specific content

**When to update MASTER-CONTEXT.md:**
- A major decision changes or is newly resolved → update Section 10 (All Decisions) immediately
- A phase completes → update the status line in Section 1 and development phases in Section 15
- A new feature is scoped or deferred → update Section 12 (Features)
- Target audience or business goals shift → update Sections 6–9
- At every milestone (end of phase, staging demo, launch) → bump the version number at the bottom

Never let MASTER-CONTEXT.md go more than one phase out of date — a stale context file is worse than no context file because it actively misleads the AI.

**When to split MASTER-CONTEXT.md:**
Split when the file exceeds ~400 lines or ~20KB — at that size, attaching it whole wastes tokens on sections irrelevant to the current task. Split along natural section boundaries into a **core file** (always attach) and **topic files** (attach only when relevant):

| File | Sections to move there | When to attach |
|---|---|---|
| `[project]-MASTER-CONTEXT.md` | About, Client, Developer, System Overview, All Decisions, How to Start a New Session | Every session — always |
| `[project]-CONTEXT-BUSINESS.md` | Problem Statement, Target Audience, Business Goals, Competitive Positioning, Marketing Plan | Product, copy, or UX sessions |
| `[project]-CONTEXT-TECHNICAL.md` | Tech Stack, Features, Data Model, Non-Functional Requirements | Build, API, or architecture sessions |
| `[project]-CONTEXT-BRAND.md` | Brand Identity, Design System, Typography, Logo Rules | UI, design, or content sessions |
| `[project]-CONTEXT-OPS.md` | Email flows, Booking flows, Receipt spec, Excel workflow, Operational detail | Feature-specific deep dives |

**Rules when splitting:**
- The core file (`MASTER-CONTEXT.md`) must always contain Section 1 (status), All Decisions, and How to Start a New Session — these are non-negotiable in every session
- Each split file starts with: `> Part of: [project]-MASTER-CONTEXT.md — attach the core file alongside this one`
- Update the "How to Start a New Session" section in the core file to list which topic files exist and when to attach each
- Never split a section across two files — keep each section whole in exactly one file

---

### MASTER-CONTEXT.md template

Use this structure when creating a new project's context file. Adapt sections as needed.

```
# [PROJECT NAME] — MASTER CONTEXT FILE
### Complete project context for continuing work in a new session
> How to use: Attach or paste this file at the start of any new AI session.

## 1. About This Project
- Project name and one-paragraph description
- Client name and relationship (agency, freelance, in-house, etc.)
- Developer/team name
- Current status (e.g. "PRD complete, MD system complete, Phase 0 next")
- Budget, timeline, launch target date
- Payment terms (if freelance)

## 2. Client / Stakeholder Details
- Legal name, address, contact email
- Social media handles
- Domain name (who purchases, who manages DNS)

## 3. Developer / Team Profile
- Role and stack strengths
- Working style and tools (IDE, AI tools, etc.)
- How to collaborate effectively
- Project folder location and structure

## 4. System Overview
- How many apps/surfaces, what they do, who uses them
- Target URLs per surface
- Total page/screen count

## 5. Problem Statement
What is broken or painful today that this app fixes?
- What does the current workflow look like? (manual spreadsheets, phone calls, paper forms, etc.)
- What errors or inefficiencies does this cause?
- What does the ideal solution look like from the client's perspective?

## 6. Target Audience & User Personas
Who uses this app and why? Define at least the primary user and any secondary users.

| Persona | Who they are | Goal | Pain point |
|---|---|---|---|
| [Primary user] | e.g. tourist visiting Bohol | Book a room quickly on mobile | Doesn't know if the hotel is available |
| [Secondary user] | e.g. corporate travel manager | Book rooms for employees reliably | Needs invoicing and confirmation |
| [Admin user] | e.g. front desk staff | Manage bookings without errors | Currently using error-prone Excel |

Include: age range, device preference (mobile/desktop), tech comfort level, what they care about most.

## 7. Business Goals & Success Metrics
What does the client want to achieve? What KPIs define success?

| Goal | Metric | Target |
|---|---|---|
| e.g. Reduce manual booking errors | Overbooking incidents per month | 0 |
| e.g. Increase direct bookings | % of bookings via website vs phone | 60% within 6 months |
| e.g. Save staff time | Hours/week spent on manual admin | Reduce by 50% |

## 8. Competitive Positioning
What makes this product different from alternatives the target user could choose?
- Who are the direct competitors? (other local hotels, OTA platforms, etc.)
- What is the key differentiator? (price, experience, convenience, brand, niche?)
- What is the one-line positioning statement?

## 9. Marketing & Growth Plan
How will users find this? What happens after launch?
- Launch channels: (e.g. Facebook page, Google SEO, OTA listings, word of mouth)
- SEO strategy: target keywords, local SEO vs national
- Social media: which platforms, posting frequency, who manages
- Phase 2 growth features: (e.g. loyalty program, online payments, calendar OTA sync)
- Who is responsible for marketing — client, developer, or agency?

## 10. All Decisions — Fully Resolved
A table of every product and architecture decision that has been made.
No open questions should remain here — if something is undecided, mark it clearly.

## 11. Tech Stack & Architecture
Full stack table + architecture diagram or description.
Include: frontend, backend, database, hosting, auth, email, file storage, third-party services.

## 12. Features — Full List
All features by surface (public app, admin app, cross-cutting).
Include phase (Phase 1 / Phase 2 / Deferred) for each.

## 13. Data Model Summary
Key collections/tables and their most important fields.
(Detail lives in BACKEND.md and TYPES.md — this is a human-readable summary only.)

## 14. Brand & Design
Colors (hex), typography, logo files, tone of voice.
Link to design spec or Figma/Stitch file.

## 15. Compliance & Legal
Applicable laws, data privacy requirements, industry regulations.
DPO contact, data retention policy, breach notification rules.

## 16. Open Questions (if any)
Anything not yet resolved. Clear this section before starting Phase 0.

## 17. How to Start a New Session
Exact instructions for resuming this project in a new AI session:
1. Always attach: this file (core MASTER-CONTEXT.md)
2. Also attach based on task type:
   - UI / design work → attach CONTEXT-BRAND.md
   - Build / API work → attach CONTEXT-TECHNICAL.md
   - Product / strategy work → attach CONTEXT-BUSINESS.md
   - Feature-specific deep dive → attach CONTEXT-OPS.md
   (Skip this step if the file hasn't been split yet)
3. Also attach: design spec or wireframes if doing UI work
4. What to have ready: repo folder connected to workspace, asset folder accessible
5. What to say to the AI (one-line prompt to restore context)
6. Any warnings: decisions that are finalized and should not be re-asked

Example opening prompt:
> "I'm continuing work on [Project Name]. I've attached the master context file — use it as your complete reference. All decisions in Section X are finalized; no need to re-ask about anything listed there."
```

---

## How to Use

1. Copy the prompt below
2. Create your `[project-name]-MASTER-CONTEXT.md` using the template above — fill in everything you already know
3. Start a new AI session
4. Paste this prompt AND attach your MASTER-CONTEXT.md
5. The AI reads the context file first, then asks only the clarifying questions not already answered
6. Give your go signal — the AI builds all MD files and saves them to your repo. How this works depends on your tool:
   - **Cowork / Claude Code:** files are written directly to your connected folder
   - **Chat interface:** AI outputs each file's content — copy and save manually, or ask it to output them one at a time

---

## THE PROMPT

I want you to build a structured MD documentation system for my web app project. These MDs are not the codebase itself — they are the context files that AI coding agents (Claude Code, Gemini CLI, Cursor, etc.) will read when building the actual codebase. Think of them as the single source of truth that any agent can load to understand the project deeply before writing a single line of code.

### Built for AI-powered solo developers and small teams

This system is designed for one developer or a small team augmented by AI agents. Every spec should be implementable by one person with AI assistance. Avoid enterprise patterns that require dedicated DevOps, legal, or QA departments — lean, practical equivalents are always preferred:

| Enterprise pattern | Solo/AI equivalent |
|---|---|
| Full CI/CD pipeline | Vercel/Netlify automatic preview deploys + one-click rollback |
| Dedicated QA team | Manual QA checklists + AI-assisted review before each phase sign-off |
| Legal department | Simple contract clause + AI-drafted ToS template |
| Security team | Documented config choices (CSP headers, session timeouts) + `npm audit` pre-deploy |
| DevOps engineer | Platform-managed infra (Vercel, Firebase) + Sentry free tier for monitoring |
| Accessibility team | WCAG 2.1 AA checklist (10 items) + AI-assisted contrast/aria checks during build |

When in doubt: use the platform's built-in capability first, add a tool only if the gap is real.

---

### What this system must achieve

- Any AI agent can read a small subset of these MDs and have everything it needs to build a specific feature correctly
- No information is duplicated — each piece of information lives in exactly one MD
- Agents load only what they need via a "read bundle" system defined in the master context file
- The system is token-efficient — lean files, no bloat, no repetition
- All decisions are captured so agents never re-ask questions that have already been resolved

---

### Minimum viable MD system (simpler projects)

Not every project needs 40+ files. Use this as a shortcut for single-app, no-shared-package projects:

| Minimum file | Why you always need it |
|---|---|
| `CLAUDE.md` | Master entry point — read bundles, hard rules, stack overview |
| `FRONTEND.md` | Design tokens, component conventions, animations, SEO |
| `BACKEND.md` | Schema, security rules |
| `DECISIONS-ARCH.md` | Stack and tooling decisions — prevents agents re-asking |
| `GOTCHAS.md` | What agents must never do |
| `[feature].md` (one per feature) | Feature checklists and QA |
| `ROADMAP.md` | Build order and phase checkboxes |

Add `TYPES.md`, `API-ROUTES.md`, `SECURITY.md`, `DECISIONS-FEATURES.md`, and app-level `CLAUDE.md` files as complexity grows. Skip `WHITE-LABEL.md`, `WIREFRAME-WORKFLOW.md`, and the shared package section if they don't apply.

---

### Before building anything — ask me these questions

Do not build a single file until you have answers to all of these. Ask them in one message, not one at a time.

**Project basics:**
1. What is the project? (one paragraph description)
2. Who are the users? (public users, admin users, both?)
3. What is the tech stack? (frontend framework, backend, database, hosting, auth, etc.)
4. What are the main features? (list them all, even rough ones)
5. Are there any features already decided vs. still open?

**Architecture:**
6. Is this a monorepo or separate repos?
7. Are there multiple apps sharing a backend? (e.g. public site + admin dashboard)
8. Where is it hosted? (Vercel, Netlify, AWS, etc.)
9. Is there a server-side API? If so, where does it live?
10. Is this white-label / reusable for multiple clients, or single-tenant?
11. Do you plan to release a native mobile app in the future? (affects PWA and Capacitor readiness decisions)
12. Does the project need a wireframe/static-first pass before connecting real data?

**Data:**
13. What are the main data entities? (e.g. users, orders, products)
14. What database are you using and is the schema defined yet?

**Code conventions:**
15. Any strong preferences on code style, naming, exports, state management?
16. Testing strategy? (automated, manual, none — if none, at minimum test critical financial/transactional logic)
17. Branching strategy? (gitflow, trunk-based, etc.)
18. Versioning? (semantic versioning, displayed somewhere in the UI?)

**UX & design:**
19. What animation aesthetic? (premium/calm, playful, minimal/none)
20. Are there existing design mockups or wireframes? (Figma, Stitch, etc.)
21. SEO requirements? (structured data, sitemap, per-page meta?)
22. What is the UX philosophy? (e.g. zero-friction/Apple-like "it just works", feature-rich/power-user, information-dense/dashboard-first) — this shapes how FRONTEND.md's UX Philosophy section is written and what the per-screen checklists enforce

**Security & compliance:**
23. Does the app handle PII (personal data)? If so, which country's laws apply?
24. Are there authentication requirements beyond standard login?
25. Any specific security concerns? (payments, file uploads, public APIs, etc.)
26. Any industry-specific compliance requirements? (e.g. hotel guest registration laws, health data, financial regulations)

**Integrations & scale:**
27. Does the app handle payments? If so, which provider? (Stripe, PayMongo, PayPal, etc.)
28. Are there third-party integrations? (CRMs, ERPs, external APIs, webhooks, analytics, etc.)
29. Does the app need to support multiple languages? (i18n/localization requirements?)

**White-label (if applicable):**
30. Will this codebase be reused for multiple clients?
31. What needs to be configurable per client? (branding, colors, fonts, logos, locale, currency, feature toggles?)
32. What is runtime-editable by the client admin vs. requires a redeploy by the developer?

**Operations & post-launch:**
33. What is the deployment workflow? (hosting platform CI/CD, staging environment, rollback plan)
34. How will errors be monitored in production? (Sentry, LogRocket, platform logs, etc.)
35. Who owns the codebase IP — the developer, the client, or a shared license? (critical if white-labeling)
36. What accessibility standard are you targeting? (WCAG 2.1 AA recommended — especially if serving users with disabilities)
37. Is there a post-launch support/maintenance plan? (bug fix SLA, retainer, or handover to client)

If the user has a context file or PRD, read it first before asking — skip any questions already answered there.

---

### MD system rules — follow these exactly

- **No code snippets in any MD** — high-level spec, rules, and checklists only. Exceptions: precise technical specs where high specificity prevents misinterpretation are acceptable (e.g. animation token definitions, test coverage tables)
- **Single source of truth** — each piece of information lives in exactly one MD; feature MDs reference, never repeat
- **Every MD starts with a `> Requires:` line** listing which other MDs to read first
- **Feature MDs use a standard template** (see below)
- **One decisions file per concern** — separate architecture decisions from feature/product decisions
- **GOTCHAS.md** captures all "never do this" rules — agents check it before every task
- **CLAUDE.md** (or equivalent) is the master entry point — defines read bundles so agents load only what they need
- **MDs stay in sync during implementation** — if an agent makes a decision that contradicts or extends an MD (schema change, renamed field, new edge case, new decision), it must update the relevant MD before moving on. Implementation drift is the #1 way an MD system becomes useless. When in doubt: update the MD, then continue building.
- **FRONTEND.md must include a UX Philosophy section** — written from the answer to question 22. At minimum it must define: the friction philosophy (zero-friction vs. feature-rich vs. info-dense), loading state approach (skeletons vs. spinners), validation timing (inline vs. on-submit), and a per-surface UX checklist that agents apply to every screen they build. This is not optional — it is what prevents agents from shipping confusing, inconsistent UIs.

---

### Feature MD template — use this for every feature file

```
# Feature Name
> App: [which app this belongs to]
> Phase: [Phase 1 — build now | Phase 2 — design for, don't build | Deferred — skip entirely]
> Requires: [list MDs to read first]
> Design ref: [design spec section if available]

## Overview
One paragraph — what this feature does and why it matters.

## Roles / Access
Who can access this feature? (e.g. public, authenticated users, admin only, specific roles)
List any role-based visibility differences within the feature.

## UI Checklist
- [ ] Component / layout item
- [ ] Interaction / state / variant

## UX Checklist (apply FRONTEND.md §UX Philosophy to this screen)
- [ ] Single primary action is obvious — user knows what to do next without reading
- [ ] Loading state uses skeleton, not spinner
- [ ] Validation is inline (on blur), not on submit
- [ ] Every error state has a plain-language message and a next step — no dead ends
- [ ] Destructive actions have a confirmation step; non-destructive actions are instant

## Data & Logic Checklist
- [ ] Database query / mutation
- [ ] API call / business rule / validation

## Edge Cases & States
- [ ] Loading state
- [ ] Empty state (explains why + what to do)
- [ ] Error handling (plain language + recovery action)
- [ ] Validation rules

## Manual QA
- [ ] Thing to verify manually before marking feature done

## References
- Related MDs (link, don't repeat)
- Design spec section
```

---

### Files to build — in this order

#### 1. Master context + plan (first)
Before building any MD, create two files in a `plan/project/context/` folder:
- `[project-name]-MASTER-CONTEXT.md` — complete project reference: stack, features, data model, brand, all decisions. This is for humans and session bootstrapping, not for agents.
- `[project-name]-MD-PLAN.md` — the full list of MD files to build with descriptions. Get approval before building.

#### 2. Root files
- `CLAUDE.md` — master TOC, stack overview, read bundles, hard rules
- `GEMINI.md` — one line: "See CLAUDE.md for full project context."
- `AGENTS.md` — one line: "See CLAUDE.md for full project context."
- `README.md` — brief project description with links to `CLAUDE.md`, `plan/project/SETUP-GUIDE.md`, and `plan/project/ROADMAP.md`

#### 3. `plan/` — full folder hierarchy

All MD files live under a `plan/` folder (or equivalent — adjust the name to match your project). The full structure:

```
plan/
├── docs/                       ← Reference MDs — loaded by agents per read bundle
│   ├── FRONTEND.md
│   ├── BACKEND.md
│   ├── API-ROUTES.md
│   ├── TYPES.md
│   ├── ENV-SETUP.md
│   ├── FILE-STRUCTURE.md
│   ├── DECISIONS-ARCH.md
│   ├── DECISIONS-FEATURES.md
│   ├── GOTCHAS.md
│   ├── CONTRIBUTING.md
│   ├── SECURITY.md
│   ├── WHITE-LABEL.md          ← if applicable
│   └── WIREFRAME-WORKFLOW.md   ← if doing a wireframe-first pass
├── features/                   ← One MD per feature
│   ├── [feature-name].md
│   └── ...
├── [app-name]/                 ← One folder per app
│   └── CLAUDE.md               ← App-specific pages, routes, DB/API usage
└── project/                    ← See section 8
```

#### 4. `docs/` — reference MDs
Adjust the folder name to match your project structure (e.g. `plan/docs/`, `docs/`, `.context/`). At minimum, build these (add more as needed).

> **These file names are suggestions — rename or split as your architecture requires. The principle is one file per concern.** For example, a project with a separate backend (Django, Rails, Laravel, FastAPI) might use `API-CONTRACTS.md` instead of `API-ROUTES.md`, or `DB-SCHEMA.md` instead of `BACKEND.md`. What matters is that every concern has exactly one home.
- `FRONTEND.md` — design tokens, component conventions, typography, breakpoints, **animation spec** (which surfaces animate, easing, duration — stack-agnostic; reference your animation library), **SEO** (meta tags, structured data, sitemap, robots.txt, per-page descriptions)
- `BACKEND.md` — database schema (all collections/tables + subcollections), security rules
- `API-ROUTES.md` — API surface, auth pattern, request/response shapes, bot prevention, rate limiting
- `TYPES.md` — canonical TypeScript types for all shared models
- `ENV-SETUP.md` — all environment variables
- `FILE-STRUCTURE.md` — full folder tree, naming conventions, monorepo setup, **test file locations** (wherever unit and integration tests live for your stack)
- `DECISIONS-ARCH.md` — architecture, stack, tooling, security decisions (one line each) + **Testing Strategy section** (which logic areas get unit vs integration tests, what stays manual QA)
- `DECISIONS-FEATURES.md` — feature scope, product, business rules decisions (one line each)
- `GOTCHAS.md` — what agents must never do
- `CONTRIBUTING.md` — MD ownership rules, update triggers, deploy checklist, **branching strategy** (branch names, commit prefixes, version bump rules), **agent branching rule** (check branch before every task, never work on `dev`/`main` directly)
- `SECURITY.md` — auth rules, PII handling, compliance, session management, CSP headers, data retention, breach protocol
- `DEVOPS.md` — deployment workflow, staging environment, error monitoring, database backup, rollback plan, dependency scanning, pre-deploy checklist
- `LEGAL.md` — IP ownership, guest ToS summary, GDPR awareness, accessibility commitment, white-label licensing model
- `WHITE-LABEL.md` — if applicable: full `config` schema, runtime-editable vs deploy-time table, per-client deploy guide, asset checklist, licensing/pricing model
- `WIREFRAME-WORKFLOW.md` — if doing a wireframe-first pass: Stitch/Figma → React component process, screen checklist, agent rules, definition of done

#### 5. App CLAUDEs
One `CLAUDE.md` per app (e.g. `guest-app/CLAUDE.md`, `admin-app/CLAUDE.md`):
- Pages and routes
- App-specific database/API usage — every collection, table, or external service the app touches
- Key conventions for that app

#### 6. Shared package (monorepos only)
If the project has a shared package (`shared/`, `packages/common/`, etc.) used by multiple apps, document it in `FILE-STRUCTURE.md` with:
- Its full folder tree (types, utils, constants, schemas, animations, tests)
- What each utility file is responsible for
- Test file locations and which test runner covers them
- How it's imported across apps (workspace package name, path alias)

This is easy to forget because it's not an app — but agents building features in any app will need to know what shared utils exist before reinventing them.

#### 7. `features/` — feature MDs
One MD per feature using the template above. Group as:
- Public/guest app features
- Admin/dashboard features
- Cross-cutting features (auth, availability, email, etc.)

#### 8. Project folder

```
project/
├── ROADMAP.md                  ← Prioritized build checklist, phase by phase, with checkboxes.
│                                  If doing a wireframe pass, include it as Phase 0.5 with a
│                                  copy-paste AI starter prompt embedded in the file
├── SETUP-GUIDE.md              ← Step-by-step local + production setup guide, including how to
│                                  run integration tests locally (emulator, Docker, test DB, etc.)
├── AI-MD-SYSTEM-PROMPT.md      ← This file; keep updated with lessons learned so it improves
│                                  for the next project
├── branding/                   ← Logos, fonts, raw brand assets — tracked
├── design/                     ← Design specs, mockups, Stitch/Figma exports — tracked
├── documents/                  ← Proposals, PRD, contracts, spreadsheets — tracked
└── context/
    ├── [project-name]-MASTER-CONTEXT.md  ← Human-readable project reference, updated at milestones
    └── [project-name]-MD-PLAN.md         ← MD system inventory: file list, decisions, changelog
```

---

### Read bundle system — define in CLAUDE.md

The read bundle system is what makes this token-efficient. In `CLAUDE.md`, define a table like:

| Task type | Read these MDs |
|---|---|
| Frontend UI task | `FRONTEND.md` + `[app]/CLAUDE.md` + relevant feature MD |
| Backend / API task | `BACKEND.md` + `TYPES.md` + `API-ROUTES.md` |
| Full feature build | All of the above + `DECISIONS-FEATURES.md` |
| Security / compliance | `SECURITY.md` + `GOTCHAS.md` |
| New architecture decision | `DECISIONS-ARCH.md` + `GOTCHAS.md` |
| White-label deployment | `WHITE-LABEL.md` + `DECISIONS-ARCH.md` |
| Wireframe task | `WIREFRAME-WORKFLOW.md` + `FRONTEND.md` + relevant feature MD |

Adjust paths to match your project's folder structure. Every read bundle should be the minimum set of MDs an agent needs — no more. Add project-specific bundles (e.g. "auth task", "payment task", "store task") as needed.

---

### Hard rules to enforce in CLAUDE.md

Split into two groups. Universal rules go in every project unchanged. Stack-specific rules are examples — replace with your own equivalents.

#### Universal — apply to every project, every stack

- **Agent task-start order** — always include this in `CLAUDE.md` as a numbered sequence under the Branching Strategy section. Agents must follow all 5 steps before writing a single line of code:
  1. **Check branch** — run `git branch --show-current`. Create one off `dev` if not already on the right branch:
     - Wireframe pass → `git checkout -b feature/wireframe` (one shared branch — no per-screen branches)
     - New feature → `git checkout -b feature/<task-name>`
     - Bug fix → `git checkout -b fix/<task-name>`
     - Docs-only → `git checkout -b docs/<task-name>`
     - Never work directly on `dev` or `main`
  2. **Load read bundle** — identify task type in the Read Bundles table and load only those MDs
  3. **Read GOTCHAS.md** — always, every task, before writing any code
  4. **Build** — implement against the feature MD checklist; apply `FRONTEND.md §UX Philosophy` to every UI screen
  5. **Update MDs** — if any decision was made that changes or extends an MD, update it before closing the task
  
  Without all 5 steps, agents either work on the wrong branch, load too many MDs (slow), skip critical rules (dangerous), or let the docs drift from the code (fatal long-term). Do not skip any step even for simple tasks.
- **Never commit `.env` files** — use `.env.example` with placeholder values
- **Never log PII** — names, emails, payment data, government IDs never appear in console or logs
- **Never duplicate information across MDs** — each piece of information lives in exactly one MD; others reference it
- **Never hardcode brand values** (colors, logos, fonts, names) in UI components — always use a config or token
- **Validate sensitive inputs server-side** — never trust client-submitted values for pricing, discounts, roles, or permissions
- **Conventional commits required** — `feat:` / `fix:` / `refactor:` / `release:` / `docs:` / `chore:` prefixes
- **Test critical financial and transactional logic** — even if the rest of the project is manual QA only, write unit tests for anything that touches money, inventory, or concurrent writes
- **All public pages have a per-page meta description** — never rely solely on the site-wide default
- **Every decision has a home** — architecture decisions in `DECISIONS-ARCH.md`, product/feature decisions in `DECISIONS-FEATURES.md`; never scatter decisions across feature MDs

#### Stack-specific — adapt these for your project

The examples below come from the Spark Inn React + Firebase build. Replace with your own equivalents.

| Spark Inn rule | Why | Your equivalent |
|---|---|---|
| All primary CTAs use the `primary` Tailwind token — never raw hex | Brand changes should require zero component edits | Define your own token/variable system |
| Availability locking must use Firestore transactions — never read-then-write | Prevents double-booking under concurrent requests | Apply transactions to any concurrent write problem (inventory, seat reservations, appointment slots) |
| Always unsubscribe Firestore `onSnapshot` listeners in `useEffect` cleanup | Memory leak / stale data risk | Unsubscribe/teardown any real-time connection (WebSocket, SSE, pub/sub) on component unmount |
| Named exports for components/hooks, default exports for pages only | Consistent import style across monorepo | Define your own export convention and stick to it |
| All animations use shared variants from `shared/animations.ts` — never inline | Ensures consistent motion language across the app | Define animation tokens in a shared file regardless of animation library |
| `[project].config.ts` imported via `@config` alias — never relative paths (Spark Inn uses `hotel.config.ts`) | Keeps white-label swappable without touching components | Name this file after your project or domain (e.g. `clinic.config.ts`, `store.config.ts`) and use a path alias so components never import it via fragile relative paths |

---

### Things to always check before declaring the system complete

Run a final audit:
- [ ] No hardcoded brand values (colors, logos, names) in feature MDs — all reference config
- [ ] No hardcoded counts (e.g. "14 rooms") — all dynamic references
- [ ] No hardcoded locale/currency/timezone — all config-driven
- [ ] No code snippets in any MD (exceptions: animation variants, test coverage tables)
- [ ] Every feature MD has a `> Requires:` line
- [ ] Every feature MD has a `> Phase:` line — the ROADMAP phase it belongs to (e.g. `> Phase: Phase 4 — Booking Flow`). Agents use this to know when to build it and whether to skip it entirely
- [ ] Every UI-facing feature MD has a `## UX Checklist` section placed directly after Overview — use guest-app, admin-app, or both variants depending on the surface. Backend-only MDs (no user-facing screens) are exempt
- [ ] Every decision has a home in either `DECISIONS-ARCH.md` or `DECISIONS-FEATURES.md`
- [ ] `GOTCHAS.md` covers all "never do this" rules discovered during the session
- [ ] `ROADMAP.md` covers all phases with checkboxes, and includes a copy-paste AI starter prompt for the wireframe phase
- [ ] `README.md` at repo root points to `CLAUDE.md`, `project/SETUP-GUIDE.md`, `project/ROADMAP.md`
- [ ] `TYPES.md` reflects all fields added to the database schema — check for drift after feature additions
- [ ] App-level `CLAUDE.md` files have complete DB/API usage tables — every collection, table, or external service the app touches is listed
- [ ] `SECURITY.md` "What We Collect" table matches all PII fields in the database schema
- [ ] `WHITE-LABEL.md` config schema covers all values referenced via `config.*` in feature MDs
- [ ] `FRONTEND.md §Animations` specifies every animated surface — no surface should animate without a spec
- [ ] `DECISIONS-ARCH.md §Testing Strategy` exists if any automated tests are planned — lists exactly what is and isn't tested
- [ ] `ROADMAP.md` Phase 0 includes scaffolding items for: shared utils files, test stubs, animation variants file, PWA setup (if applicable)
- [ ] `[project-name]-MD-PLAN.md` updated to v-next with all new files and changed decisions
- [ ] `README.md` at repo root exists and links to `CLAUDE.md`, `SETUP-GUIDE.md`, and `ROADMAP.md`
- [ ] `CONTRIBUTING.md` includes the agent branching rule (check branch before every task, correct prefix, never work on `dev`/`main`)
- [ ] `ROADMAP.md` wireframe starter prompt explicitly names the `feature/wireframe` branch — no per-screen branches
- [ ] `FILE-STRUCTURE.md` documents the full `plan/` folder hierarchy and, if applicable, the shared package with its utils, types, test locations, and import alias
- [ ] `DEVOPS.md` exists — deployment workflow, staging URL, error monitoring tool, rollback procedure, and pre-deploy checklist are all documented
- [ ] `LEGAL.md` exists — IP ownership is unambiguous, guest ToS is summarized, GDPR awareness noted if any EU users possible
- [ ] `SECURITY.md` covers session management (persistence mode, auto-logout duration) and CSP headers
- [ ] `FRONTEND.md §Accessibility` specifies the WCAG target level and lists the 10 minimum checks
- [ ] `FRONTEND.md §Analytics` lists every tracked event and what decision each one informs
- [ ] `CONTRIBUTING.md` has a definition of done checklist for each phase and a change request rule
- [ ] Post-launch support plan documented — bug fix SLA, who to contact, maintenance model

---

### Ask for go signal before each phase

- After presenting the MD plan → ask for go signal before building
- After building each major group (plan/docs/, features/, etc.) → check in
- If any decision is ambiguous mid-build → stop and ask, don't guess
- If you discover a conflict or gap → flag it before proceeding

---

*Author: DK (Daniel Kenneth Sandimas) — derived from the Spark Inn hotel booking system MD build, a 42-file documentation system covering a full-stack React + Firebase + Vercel web app with white-labelling, PWA, loyalty program, in-room store, WebRTC, SEO, animations, and targeted Vitest testing.*
*Adapt the file list, questions, and rules to your project's specific stack and needs.*
*Last updated: June 7, 2026 — v4.0 (Gap fixes for AI-readability: (1) agent task-start order added to CLAUDE.md hard rules — 5-step sequence before any code; (2) > Phase: indicator now required on every feature MD header; (3) ## UX Checklist section now required in every UI-facing feature MD after Overview; all 3 gaps noted in audit checklist)*
