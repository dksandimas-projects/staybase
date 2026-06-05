# AI Prompt — Build an MD Documentation System for a Web App
> Reusable prompt for any new web app project.
> Copy everything below the line and paste it at the start of a new AI session.
> **Scale to your project's complexity** — not every section applies to every app. A simple single-surface CRUD app needs maybe 10 files. A multi-app, white-label, loyalty-program-having system like Spark Inn needs 42. Use your judgment.

---

## How to Use

1. Copy the prompt below
2. Start a new AI session
3. Paste the prompt
4. Attach or paste your project context (brief description, stack, features, any decisions already made)
5. Let the AI ask clarifying questions before building anything
6. Give your go signal — the AI builds all MD files directly to your connected repo

---

## THE PROMPT

I want you to build a structured MD documentation system for my web app project. These MDs are not the codebase itself — they are the context files that AI coding agents (Claude Code, Gemini CLI, Cursor, etc.) will read when building the actual codebase. Think of them as the single source of truth that any agent can load to understand the project deeply before writing a single line of code.

### What this system must achieve

- Any AI agent can read a small subset of these MDs and have everything it needs to build a specific feature correctly
- No information is duplicated — each piece of information lives in exactly one MD
- Agents load only what they need via a "read bundle" system defined in the master context file
- The system is token-efficient — lean files, no bloat, no repetition
- All decisions are captured so agents never re-ask questions that have already been resolved

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

**Security & compliance:**
22. Does the app handle PII (personal data)? If so, which country's laws apply?
23. Are there authentication requirements beyond standard login?
24. Any specific security concerns? (payments, file uploads, public APIs, etc.)
25. Any industry-specific compliance requirements? (e.g. hotel guest registration laws, health data, financial regulations)

**White-label (if applicable):**
26. Will this codebase be reused for multiple clients?
27. What needs to be configurable per client? (branding, colors, fonts, logos, locale, currency, feature toggles?)
28. What is runtime-editable by the client admin vs. requires a redeploy by the developer?

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

---

### Feature MD template — use this for every feature file

```
# Feature Name
> App: [which app this belongs to]
> Requires: [list MDs to read first]
> Design ref: [design spec section if available]

## Overview
One paragraph — what this feature does and why it matters.

## UI Checklist
- [ ] Component / layout item
- [ ] Interaction / state / variant

## Data & Logic Checklist
- [ ] Database query / mutation
- [ ] API call / business rule / validation

## Edge Cases & States
- [ ] Loading state
- [ ] Empty state
- [ ] Error handling
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

#### 3. `docs/` — reference MDs
Adjust the folder name to match your project structure (e.g. `plan/docs/`, `docs/`, `.context/`). At minimum, build these (add more as needed):
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
- `SECURITY.md` — auth rules, PII handling, compliance, data retention, breach protocol
- `WHITE-LABEL.md` — if applicable: full `config` schema, runtime-editable vs deploy-time table, per-client deploy guide, asset checklist
- `WIREFRAME-WORKFLOW.md` — if doing a wireframe-first pass: Stitch/Figma → React component process, screen checklist, agent rules, definition of done

#### 4. App CLAUDEs
One `CLAUDE.md` per app (e.g. `guest-app/CLAUDE.md`, `admin-app/CLAUDE.md`):
- Pages and routes
- App-specific database/API usage — every collection, table, or external service the app touches
- Key conventions for that app

#### 5. `features/` — feature MDs
One MD per feature using the template above. Group as:
- Public/guest app features
- Admin/dashboard features
- Cross-cutting features (auth, availability, email, etc.)

#### 6. Project folder
- `project/ROADMAP.md` — prioritized build checklist, phase by phase, with checkboxes. If doing a wireframe pass, include it as Phase 0.5 with a copy-paste AI starter prompt embedded in the file
- `project/SETUP-GUIDE.md` — step-by-step local + production setup guide, including how to run integration tests locally (emulator, Docker, test DB, etc. depending on your stack)
- `project/context/[project-name]-MASTER-CONTEXT.md` — human-readable project reference, updated at major milestones
- `project/context/[project-name]-MD-PLAN.md` — MD system inventory: file list with descriptions, decisions made, changes from prior versions
- `project/AI-MD-SYSTEM-PROMPT.md` — this file; keep updated with lessons learned so it improves for the next project

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

- **Agent branching rule** — always include this in `CLAUDE.md` under the Branching Strategy section:
  1. Before starting any task, run `git branch --show-current`
  2. If not already on the right branch, create one off `dev` using the appropriate prefix:
     - **Wireframe pass** → one shared branch for the entire phase: `git checkout -b feature/wireframe` — no per-screen branches
     - New feature → `git checkout -b feature/<task-name>`
     - Bug fix → `git checkout -b fix/<task-name>`
     - Docs-only change → `git checkout -b docs/<task-name>`
  3. Never work directly on `dev` or `main`
  4. Do not merge back to `dev` without the developer's explicit instruction
  5. If already on a correctly-named branch, continue on it; if unsure which prefix to use, ask before starting
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
| `hotel.config.ts` imported via `@config` alias — never relative paths | Keeps white-label swappable without touching components | Use path aliases for any globally-shared config to avoid brittle relative imports |

---

### Things to always check before declaring the system complete

Run a final audit:
- [ ] No hardcoded brand values (colors, logos, names) in feature MDs — all reference config
- [ ] No hardcoded counts (e.g. "14 rooms") — all dynamic references
- [ ] No hardcoded locale/currency/timezone — all config-driven
- [ ] No code snippets in any MD (exceptions: animation variants, test coverage tables)
- [ ] Every feature MD has a `> Requires:` line
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

---

### Ask for go signal before each phase

- After presenting the MD plan → ask for go signal before building
- After building each major group (plan/docs/, features/, etc.) → check in
- If any decision is ambiguous mid-build → stop and ask, don't guess
- If you discover a conflict or gap → flag it before proceeding

---

*Author: DK (Daniel Kenneth Sandimas) — derived from the Spark Inn hotel booking system MD build, a 42-file documentation system covering a full-stack React + Firebase + Vercel web app with white-labelling, PWA, loyalty program, in-room store, WebRTC, SEO, animations, and targeted Vitest testing.*
*Adapt the file list, questions, and rules to your project's specific stack and needs.*
*Last updated: June 4, 2026 — v3.0 (updated to reflect lessons learned from Spark Inn full build MDs session)*
