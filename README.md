# spark inn

White-label hotel booking and management system. Spark Inn (Bohol, Philippines) is the reference deployment.

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
