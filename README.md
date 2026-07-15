# spark inn

White-label hotel booking and management system. Spark Inn (Bohol, Philippines) is the reference deployment.

> **Phase 11.7 — Admin Mobile UX is shipped (v0.90.0).** The admin dashboard now has a three-mode responsive sidebar, a sticky mobile header with the brand wordmark, full-screen bottom-sheet drawers, a `DataTable` mobile card view, and a persistent bottom tab bar on operational pages. The full design contract is in `plan/features/ADMIN-MOBILE.md`; the implementation status is in `plan/project/ROADMAP.md §Phase 11.7`. Manual device testing on iPhone SE / iPhone 14 / Pixel 7 / iPad is the only remaining P3 work.

## Start here

- **Agents / AI tools:** read `CLAUDE.md` first — it has the full project context, read bundles, and hard rules.
- **Setup:** follow `plan/project/SETUP-GUIDE.md` to get the project running locally and deployed.
- **Build order:** see `plan/project/ROADMAP.md` for the prioritized development checklist.
- **Production launch:** see `plan/project/DEPLOY.md` for the staging → production cutover procedure.

## Structure

```
guest-app/    ← Public booking website (www.sparkinnbohol.com)
admin-app/    ← Front desk dashboard (admin.sparkinnbohol.com)
shared/       ← Shared types, utils, VERSION
firebase/     ← Firestore + Storage rules
docs/         ← Technical reference MDs
features/     ← Feature spec MDs
plan/project/ ← Project assets, context files, roadmap
```

## Stack

React 19 + TypeScript + Vite + Tailwind · Firebase (Auth, Firestore, Storage) · Vercel · Resend

## Local checks

```bash
npm run build:guest
npm run build:admin
npm run test:shared
npm run test:guest:api
```

## Firebase emulator tests

The API integration test stubs are designed for the Firebase Local Emulator Suite. Once the API routes are implemented, run the emulator in one terminal:

```bash
npx firebase-tools emulators:start --only auth,firestore,storage
```

Then run the guest API integration tests in another terminal:

```bash
npm run test:guest:api
```

These tests must use emulator credentials only. Do not point integration tests at the live Firebase project.

### Firestore security-rules tests

`firebase/tests/*.rules.test.ts` load the real `firebase/firestore.rules` into the Firestore emulator and evaluate actual access decisions (unlike the source-pattern rule tests in the apps, which only grep the rule text). Run them with:

```bash
npm run test:rules
```

This wraps the suite in `firebase emulators:exec --only firestore`, so the emulator is started and torn down automatically — you do **not** need a separate terminal. Requires Java (the Firestore emulator dependency). These are intentionally **not** part of `npm test` because they need the emulator; run them whenever `firestore.rules` changes. NC-02d added the first of these (the `notifications` collection) after an invalid-but-present rule (`keys().union(...)`) shipped undetected by the grep-only tests.
