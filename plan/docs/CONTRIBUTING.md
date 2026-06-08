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
| Session bootstrapping context | `plan/project/context/spark-inn-MASTER-CONTEXT.md` |

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

---

## How to Update MDs

1. Find the owning MD (table above)
2. Edit only that MD — do not duplicate content elsewhere
3. If a feature MD needs to reference the change, add a one-line reference: "See `plan/docs/BACKEND.md §bookings`"
4. Commit with a `docs:` prefix: `docs: update BACKEND.md with voucherDiscount field`

---

## Branching & Commit Rules

**Branch naming:**
- `feature/booking-flow` — new feature
- `feature/admin-dashboard` — new feature
- `fix/availability-locking` — bug fix
- `plan/docs/update-backend-schema` — documentation only

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

## Adding a New MD

If a new feature or concern warrants a new MD:
1. Create the file in the appropriate folder (`plan/docs/` or `plan/features/`)
2. Add it to `CLAUDE.md` Table of Contents
3. Add it to the ownership table in this file
4. Add a `> Requires:` line at the top listing its dependencies
5. Commit with `docs:` prefix
