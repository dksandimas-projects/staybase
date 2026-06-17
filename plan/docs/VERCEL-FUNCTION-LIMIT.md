# Vercel Function Limit Strategy (Hobby Plan)
> Requires: CLAUDE.md, `plan/docs/FILE-STRUCTURE.md`

How we keep the guest-app deployment under Vercel's **12 serverless function** Hobby-plan cap, and the rules future agents must follow so we never hit it again.

---

## The problem

Vercel's Hobby plan hard-caps deployments at **12 serverless functions**. Exceeding it produces:

> No more than 12 Serverless Functions can be added to a Deployment on the Hobby plan. Create a team (Pro plan) to deploy more.

This is a hard limit — there is no `vercel.json` setting to raise it. The only way around it on Hobby is to keep the function count at or below 12.

Pro plan raises this to 48. We stay on Hobby for now.

---

## How Vercel counts functions

Vercel treats any `.ts` / `.js` / `.mjs` file inside the deployed `api/` directory as a candidate function. This includes:

- The catch-all at `api/[...route].ts` (counts as 1)
- **Every `.ts` file in `api/handlers/*.ts`** (each is its own function at `/api/handlers/...`)
- **Every `.ts` file in `api/lib/*.ts`** (each is its own function at `/api/lib/...`)
- Test files at `api/__tests__/*.test.ts` (Vercel *does* bundle `.test.ts` files as separate functions in some build modes — never rely on it being skipped)

So a perfectly "logical" code layout with `api/handlers/bookings.ts`, `api/handlers/email.ts`, etc. silently produces 1 + N functions, and the deployment fails the moment N ≥ 12.

This caught us on the original layout (10 handlers + 2 lib + 1 catch-all = 13).

---

## The strategy: one catch-all, everything else outside `api/`

Vercel's catch-all routing (`[...route].ts`) means we never need per-endpoint files. A single function can dispatch to many handlers internally. The fix is purely a **file-layout rule**:

**Allowed inside `api/`:**
- `api/[...route].ts` — the only function. Imports handlers from `../server/`.

**Forbidden inside `api/`** (each of these adds a function):
- `api/handlers/` — moved to `server/handlers/`
- `api/lib/` — moved to `server/lib/`
- `api/__tests__/` — moved to `tests/api/`
- Any other `.ts` / `.js` file at any depth under `api/`
- Subdirectories named anything other than route segments (e.g. `api/foo/bar.ts` is still a function at `/api/foo/bar`)

### Current layout

```
guest-app/
├── api/
│   └── [...route].ts          ← THE ONLY function (counts as 1)
├── server/                    ← NOT a Vercel functions directory
│   ├── handlers/
│   │   ├── bookings.ts
│   │   ├── email.ts
│   │   ├── members.ts
│   │   └── ...                (10 files, all internal modules)
│   └── lib/
│       ├── firebase-admin.ts
│       └── resend.ts
├── tests/
│   └── api/                   ← Vitest integration tests, not deployed
└── ...
```

`server/` lives next to `api/` but is **not** scanned by Vercel. The catch-all imports its modules via `../server/handlers/...` and `../server/lib/...`.

---

## How to apply this when adding a new endpoint

1. Add the handler in `guest-app/server/handlers/<name>.ts` (alongside existing handlers).
2. Export its `handle...` function.
3. Import + dispatch it in `guest-app/api/[...route].ts` (one new `if (domain === ...)` block).
4. Add the integration test in `guest-app/tests/api/<name>.test.ts`.
5. Run `npm run test:guest:api` to confirm the dispatch + handler work.
6. **Never** create a new file at `guest-app/api/<name>.ts` — that would add a second function and break the cap.

If the request needs a helper module (e.g. a new lib wrapper), put it in `server/lib/`. If it needs shared types or constants, put them in `shared/` (the npm workspace).

---

## How to verify after deploy

After every Vercel deployment, confirm in the dashboard:

1. **Vercel Dashboard → Project → Deployments → latest → Functions tab.**
2. The function list should show **exactly 1 entry**: `api/[...route].ts` (sometimes displayed as `api/_catch-all` or `index`).
3. If the count is 2+, the build is picking up an extra file. Check `git status` and look for any new `.ts` file under `api/` or its subdirectories.

Also: the `vercel.json` `buildCommand` is set to `npm run build:guest` and `outputDirectory` to `guest-app/dist`. Don't change these without also re-verifying the function count.

---

## What we explicitly tried and rejected

| Approach | Why it doesn't work |
|---|---|
| `vercel.json` `functions` key with only the catch-all listed | The `functions` key is for per-function **config** (memory, maxDuration), not for restricting which files become functions. Unlisted files are still deployed. |
| Renaming the subdirectories to start with `_` (e.g. `api/_internal/`) | Vercel still walks the directory. Underscore prefix is a convention, not a signal. |
| Filtering files via `ignoreCommand` in `vercel.json` | `ignoreCommand` is per-file and applies during git deployment tracking, not the build phase. It is also easy to get wrong. |
| Using Vite build hooks to rewrite the `api/` tree at build time | Works but adds magic to a build that should stay simple. The structural fix is cheaper. |
| Upgrading to Pro | Works but costs $20/mo per member. Not needed for the project size. |

---

## If we genuinely need more functions in the future

The 12-cap is a hard Hobby limit, but we have headroom before it bites:

- Today: **1 function** (catch-all). 11 slots of headroom.
- A new endpoint does **not** add a function as long as it lives behind the catch-all.
- A new top-level file at `api/<name>.ts` would add 1 function (11 → 10 slots).

**Decision threshold:** if a future feature truly cannot be expressed as a path segment in the catch-all (rare — the catch-all already handles arbitrary `/api/<domain>/<action>` paths and the `domain`/`action` values come from `pathSegments`), we can either:
- Add it behind the catch-all (always preferred, costs 0 functions).
- Bump to Pro if the project genuinely needs N independent functions for isolation, scale, or auth boundaries.

---

## Related docs

- `plan/docs/FILE-STRUCTURE.md` — the folder tree this doc assumes.
- `plan/docs/API-ROUTES.md` — every endpoint the catch-all handles.
- `plan/docs/DECISIONS-ARCH.md` — decision #3 (catch-all pattern) and the new decision on function count.
- `plan/docs/GOTCHAS.md` — the one-line "never put helpers in `api/`" rule.
