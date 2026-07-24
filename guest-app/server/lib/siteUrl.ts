// Per `plan/docs/ENV-SETUP.md` and the env-aware URL fix (2026-07-24):
// every link emitted by the server (email templates, deep links, etc.)
// must respect the current environment so the staff can click test
// emails against the staging deployment and clients can click booking
// confirmations against the live site.
//
// Resolution order (highest to lowest):
//   1. Explicit `SITE_URL` / `ADMIN_SITE_URL` env var (whitespace-trimmed,
//      trailing slashes stripped). Used by white-label clients whose
//      staging host doesn't follow the `stg.<domain>` convention.
//   2. `VERCEL_ENV=production` → `https://www.${config.domain}` for guest
//      and `https://${config.adminDomain}` for admin.
//   3. Otherwise (Vercel preview/development, local) → `https://stg.${config.domain}`
//      and `https://stg-admin.${config.domain}`.
//
// `getServerBaseUrl` and `getServerAdminBaseUrl` are intentionally
// exported as pure functions that take `env` as a parameter so they
// can be unit-tested with `process.env` overrides — the email handler
// imports the no-arg form.

import config from "../../../hotel.config";

export function getServerBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  if (env.VERCEL_ENV === "production") {
    return `https://www.${config.domain}`;
  }
  return `https://stg.${config.domain}`;
}

export function getServerAdminBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.ADMIN_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  if (env.VERCEL_ENV === "production") {
    return `https://${config.adminDomain}`;
  }
  return `https://stg-admin.${config.domain}`;
}
