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
- `api/[...route].js` — the only function, and it's a **committed, build-generated bundle** (esbuild output of `guest-app/server/apiRouter.ts`). See "Build artifact requirements" below for why it's `.js`, committed, and not a plain `.ts` source file anymore.

**Forbidden inside `api/`** (each of these adds a function):
- `api/handlers/` — moved to `server/handlers/`
- `api/lib/` — moved to `server/lib/`
- `api/__tests__/` — moved to `tests/api/`
- Any other `.ts` / `.js` file at any depth under `api/`
- Subdirectories named anything other than route segments (e.g. `api/foo/bar.ts` is still a function at `/api/foo/bar`)
- **A `.ts` file at `api/[...route].ts` alongside the committed `.js`** — Vercel rejects a `.ts`/`.js` pair sharing the same path as a naming conflict. The router source must live at `server/apiRouter.ts`, never back in `api/`.

### Current layout

```
guest-app/
├── api/
│   └── [...route].js          ← THE ONLY function (counts as 1) — committed build artifact, not source
├── server/                    ← NOT a Vercel functions directory
│   ├── apiRouter.ts           ← real source for the catch-all (bundled into api/[...route].js)
│   ├── handlers/
│   │   ├── bookings.ts
│   │   ├── email.ts
│   │   ├── members.ts
│   │   └── ...                (10 files, all internal modules)
│   └── lib/
│       ├── firebase-admin.ts
│       └── resend.ts
├── tests/
│   └── api/                   ← Vitest integration tests, import from ../../server/apiRouter, not deployed
└── ...

api/[...route].ts               ← REPO ROOT (sibling of guest-app/), not guest-app/api/
                                   thin shim: export { default } from "../guest-app/api/[...route]"
                                   this is what Vercel actually deploys — Root Directory is the repo root
```

`server/` lives next to `api/` but is **not** scanned by Vercel. The catch-all's real logic imports handler modules via `./handlers/...` and `./lib/...` (relative to `server/apiRouter.ts`).

---

## Build artifact requirements (learned the hard way — 2026-07-01/02 outage)

`guest-app/api/[...route].js` exists because of a hard constraint: `@spark-inn/shared`'s `package.json` `exports` point directly at raw `.ts` source (fine for Vite, which transpiles it natively). Vercel's Node.js Function builder only compiles the `api/*.ts` entry point itself — it does **not** transpile TypeScript reached through `node_modules`/workspace packages. Any handler importing `@spark-inn/shared` needs it bundled into plain JS first, or it crashes at runtime with `Cannot find module '.../@spark-inn/shared/index.ts'`.

That forces three non-obvious rules, each discovered by a failed production deploy:

1. **`guest-app/package.json` must not set `"type": "module"`.** Otherwise every request crashes with `ERR_REQUIRE_ESM` (Vercel's Node builder emits CJS-style `require()` between files).
2. **The esbuild bundle output (`api/[...route].js`) and its source (`server/apiRouter.ts`) cannot share the same path.** An earlier attempt bundled to `api/[...route].js` and then deleted `api/[...route].ts` — this broke Vercel's build entirely (`Error: File not found: api/[...route].ts`, because Vercel's build step needs the source present *after* the build script runs, to detect the function). The fix: the router source lives at `server/apiRouter.ts` — `api/` never has a `.ts` file for this route at all, only the generated `.js`.
3. **The generated `.js` bundle must be committed to git, not gitignored.** Even with #1 and #2 fixed, a gitignored `api/[...route].js` regenerated fresh on every build still shipped **zero functions** — `vercel inspect <url>` showed `Builds: . [0ms]`, no `λ api/[...route]` entry, despite the file demonstrably existing on disk by the time the build script finished (visible in the build logs). Vercel's function-candidate detection for `api/` runs independently of the custom Build Command and doesn't see files that aren't in the git checkout. **Rebuild and recommit `guest-app/api/[...route].js` (`npm run build:api -w guest-app`) whenever `server/apiRouter.ts`, any `server/handlers/*`/`server/lib/*` file, or `@spark-inn/shared` changes.** There is no pre-commit hook enforcing this yet — it's a manual step.

Additionally, the **repo-root** `api/[...route].ts` shim (`export { default } from "../guest-app/api/[...route]"` — this is the file Vercel actually treats as the deployed function, since the project's Root Directory is the repo root, confirmed via runtime paths like `/var/task/guest-app/server/lib/...`) needs `"allowJs": true` in the repo-root `api/tsconfig.json`. Without it, `tsc` throws `TS7016` trying to resolve the shim's extensionless import to a `.js` file, and Vercel silently drops the function (a `404`, with no build error surfaced anywhere in the logs — this was the hardest of the four bugs to diagnose).

**If `/api/*` starts failing in production again:** check `vercel inspect --logs <deployment-url>` for the actual runtime error first, and `vercel inspect <deployment-url>` (no `--logs`) to confirm the `Builds` section actually lists `λ api/[...route]` — an empty `Builds: . [0ms]` means the function isn't even registered, which is a build-detection problem (see rules above), not a runtime crash. Local `vercel dev` is not reliable for this diagnosis — it has its own separate, flaky routing behavior in this environment.

---

## How to apply this when adding a new endpoint

1. Add the handler in `guest-app/server/handlers/<name>.ts` (alongside existing handlers).
2. Export its `handle...` function.
3. Import + dispatch it in `guest-app/server/apiRouter.ts` (one new `if (domain === ...)` block) — **not** `guest-app/api/[...route].ts`, which no longer exists as source.
4. Add the integration test in `guest-app/tests/api/<name>.test.ts`, importing the handler from `../../server/apiRouter`.
5. Run `npm run test:guest:api` to confirm the dispatch + handler work.
6. Rebuild and commit the bundle: `npm run build:api -w guest-app`, then `git add guest-app/api/[...route].js`. **This step is easy to forget and the deployed function will silently run stale code without it.**
7. **Never** create a new file at `guest-app/api/<name>.ts` (or `guest-app/api/[...route].ts`) — a new top-level file adds a second function and breaks the cap; a `.ts` at `[...route]` collides with the committed `.js` bundle and breaks the build.

If the request needs a helper module (e.g. a new lib wrapper), put it in `server/lib/`. If it needs shared types or constants, put them in `shared/` (the npm workspace).

---

## How to verify after deploy

After every Vercel deployment, confirm in the dashboard, or via `vercel inspect <deployment-url>` (no `--logs`):

1. **Vercel Dashboard → Project → Deployments → latest → Functions tab**, or check the `Builds` section of `vercel inspect` output.
2. The function list should show **exactly 1 entry**: `api/[...route]`. **An empty list (`Builds: . [0ms]`, no `λ` entry at all) is a real failure mode, not just "0 is fine"** — it means Vercel never registered a function and every `/api/*` call will 404. See "Build artifact requirements" above.
3. If the count is 2+, the build is picking up an extra file. Check `git status` and look for any new `.ts`/`.js` file under `api/` or its subdirectories (repo root or `guest-app/`).

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
