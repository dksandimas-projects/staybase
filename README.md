# spark inn

White-label hotel booking and management system. Spark Inn (Bohol, Philippines) is the reference deployment.

## Start here

- **Agents / AI tools:** read `CLAUDE.md` first — it has the full project context, read bundles, and hard rules.
- **Setup:** follow `project/SETUP-GUIDE.md` to get the project running locally and deployed.
- **Build order:** see `project/ROADMAP.md` for the prioritized development checklist.

## Structure

```
guest-app/    ← Public booking website (www.sparkinnbohol.com)
admin-app/    ← Front desk dashboard (admin.sparkinnbohol.com)
shared/       ← Shared types, utils, VERSION
firebase/     ← Firestore + Storage rules
docs/         ← Technical reference MDs
features/     ← Feature spec MDs
project/      ← Project assets, context files, roadmap
```

## Stack

React 19 + TypeScript + Vite + Tailwind · Firebase (Auth, Firestore, Storage) · Vercel · Resend
