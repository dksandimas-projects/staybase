# AI Prompt — Build an MD Documentation System for a Web App
> Reusable prompt for any new web app project.
> Copy everything below the line and paste it at the start of a new AI session.

---

## How to Use

1. Copy the prompt below
2. Start a new AI session
3. Paste the prompt
4. Attach or paste your project context (brief description, stack, features, any decisions already made)
5. Let the AI ask clarifying questions before building anything
6. Give your go signal — the AI builds all MD files directly to your connected repo

---

---
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

**Data:**
11. What are the main data entities? (e.g. users, orders, products)
12. What database are you using and is the schema defined yet?

**Code conventions:**
13. Any strong preferences on code style, naming, exports, state management?
14. Testing strategy? (automated, manual, none)
15. Branching strategy? (gitflow, trunk-based, etc.)
16. Versioning? (semantic versioning, displayed somewhere in the UI?)

**Security & compliance:**
17. Does the app handle PII (personal data)? If so, which country's laws apply?
18. Are there authentication requirements beyond standard login?
19. Any specific security concerns? (payments, file uploads, public APIs, etc.)

**White-label (if applicable):**
20. Will this codebase be reused for multiple clients?
21. What needs to be configurable per client? (branding, features, content?)

If the user has a context file or PRD, read it first before asking — skip any questions already answered there.

---

### MD system rules — follow these exactly

- **No code snippets in any MD** — high-level spec, rules, and checklists only
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

#### 3. `plan/docs/` — reference MDs
At minimum, build these (add more as needed):
- `FRONTEND.md` — design tokens, component conventions, typography, breakpoints
- `BACKEND.md` — database schema (all collections/tables), security rules
- `API-ROUTES.md` — API surface, auth pattern, request/response shapes
- `TYPES.md` — canonical TypeScript types for all shared models
- `ENV-SETUP.md` — all environment variables
- `FILE-STRUCTURE.md` — full folder tree, naming conventions, monorepo setup
- `DECISIONS-ARCH.md` — architecture, stack, tooling, security decisions (one line each)
- `DECISIONS-FEATURES.md` — feature scope, product, business rules decisions (one line each)
- `GOTCHAS.md` — what agents must never do
- `CONTRIBUTING.md` — MD ownership rules, update triggers, deploy checklist
- `SECURITY.md` — auth rules, PII handling, compliance, bot prevention
- `WHITE-LABEL.md` — if applicable: config schema, per-client deployment guide

#### 4. App CLAUDEs
One `CLAUDE.md` per app (e.g. `plan/guest-app/CLAUDE.md`, `plan/admin-app/CLAUDE.md`):
- Pages and routes
- App-specific Firebase/DB usage
- Key conventions for that app

#### 5. `plan/features/` — feature MDs
One MD per feature using the template above. Group as:
- Public/guest app features
- Admin/dashboard features
- Cross-cutting features (auth, availability, email, etc.)

#### 6. Project folder
- `project/ROADMAP.md` — prioritized build checklist, phase by phase, with checkboxes
- `project/SETUP-GUIDE.md` — step-by-step local + production setup guide

---

### Read bundle system — define in CLAUDE.md

The read bundle system is what makes this token-efficient. In `CLAUDE.md`, define a table like:

| Task type | Read these MDs |
|---|---|
| Frontend UI task | `plan/docs/FRONTEND.md` + `[app]/CLAUDE.md` + relevant feature MD |
| Backend / API task | `plan/docs/BACKEND.md` + `plan/docs/TYPES.md` + `plan/docs/API-ROUTES.md` |
| Full feature build | All of the above + `plan/docs/DECISIONS-FEATURES.md` |
| Security / compliance | `plan/docs/SECURITY.md` + `plan/docs/GOTCHAS.md` |
| New architecture decision | `plan/docs/DECISIONS-ARCH.md` + `plan/docs/GOTCHAS.md` |

Tailor these to the actual project. Every read bundle should be the minimum set of MDs an agent needs — no more.

---

### Hard rules to enforce in CLAUDE.md

Always include these in the hard rules section (adapt as needed):

- Never hardcode brand values (colors, logos, fonts, names) — use config
- Never commit `.env` files
- Never log PII
- Never duplicate information across MDs
- All primary CTAs use the configured primary color token — never raw hex
- Availability/booking (if applicable) must use database transactions — never read-then-write
- Validate sensitive inputs server-side — never trust client
- Always unsubscribe real-time listeners in cleanup functions
- Named exports for components/hooks, default exports for pages only
- Conventional commits required

---

### Things to always check before declaring the system complete

Run a final audit:
- [ ] No hardcoded brand values (colors, logos, names) in feature MDs — all reference config
- [ ] No hardcoded counts (e.g. "14 rooms") — all dynamic references
- [ ] No hardcoded locale/currency/timezone — all config-driven
- [ ] No code snippets in any MD
- [ ] Every feature MD has a `> Requires:` line
- [ ] Every decision has a home in either `DECISIONS-ARCH.md` or `DECISIONS-FEATURES.md`
- [ ] `GOTCHAS.md` covers all "never do this" rules discovered during the session
- [ ] `ROADMAP.md` covers all phases with checkboxes
- [ ] `README.md` at repo root points to `CLAUDE.md`, `project/SETUP-GUIDE.md`, `project/ROADMAP.md`

---

### Ask for go signal before each phase

- After presenting the MD plan → ask for go signal before building
- After building each major group (plan/docs/, features/, etc.) → check in
- If any decision is ambiguous mid-build → stop and ask, don't guess
- If you discover a conflict or gap → flag it before proceeding

---

*This prompt was derived from the Spark Inn hotel booking system MD build — a 35+ file documentation system covering a full-stack React + Firebase + Vercel web app.*
*Adapt the file list and rules to your project's specific stack and needs.*
