import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * AI-BROWSER-QA (2026-10-23) — credential and configuration loading.
 *
 * NEVER COMMIT A PASSWORD. Credentials are read from the process
 * environment, optionally seeded from a gitignored local file
 * (`e2e/.qa.env.local` — see `e2e/.env.example` for the shape).
 *
 * If a credential is missing the test that needs it is SKIPPED with a
 * clear reason, never silently passed. A scenario that cannot run must
 * not masquerade as a pass.
 */

const LOCAL_ENV_FILE = resolve(__dirname, "../.qa.env.local");

function loadLocalEnv(): Record<string, string> {
  if (!existsSync(LOCAL_ENV_FILE)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(LOCAL_ENV_FILE, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

const local = loadLocalEnv();

function env(name: string): string | undefined {
  const v = process.env[name] ?? local[name];
  return v && v.length > 0 ? v : undefined;
}

/**
 * Read one QA environment value (process env first, then the gitignored
 * local file). Exported so a support module can read a value the same way
 * the identities are read — never from a hardcoded literal.
 */
export function qaEnv(name: string): string | undefined {
  return env(name);
}

export type Identity = { email: string; password: string };

export function identity(kind: "admin" | "frontdesk" | "member" | "memberB"): Identity | null {
  const email = env(`QA_${kind.toUpperCase()}_EMAIL`);
  const password = env(`QA_${kind.toUpperCase()}_PASSWORD`);
  if (!email || !password) return null;
  return { email, password };
}

export const adminIdentity = (): Identity | null => identity("admin");
export const frontDeskIdentity = (): Identity | null => identity("frontdesk");
export const memberIdentity = (): Identity | null => identity("member");
export const memberBIdentity = (): Identity | null => identity("memberB");

/** Credentials that must never be echoed into a report or a trace. */
export function redact(value: string | undefined): string {
  if (!value) return "<unset>";
  return value.length <= 4 ? "****" : `${value.slice(0, 2)}***${value.slice(-2)}`;
}

/**
 * The QA test-run id. Every booking / store order created during this pass
 * carries it, which makes "every record I created" a query rather than a
 * promise. The product stamps `isTestData: true` + `testRunId` on any
 * booking created with a valid run id.
 */
export const QA_RUN_ID = env("QA_TEST_RUN_ID");
export const QA_RUN_NAME = env("QA_TEST_RUN_NAME") || "AI-BROWSER-QA 2026-10-23";

export const ENV_CONFIG = {
  guestBaseUrl: env("QA_GUEST_BASE_URL") || "https://www.sparkinnbohol.com",
  adminBaseUrl: env("QA_ADMIN_BASE_URL") || "https://admin.sparkinnbohol.com",
  /**
   * Turnstile is enforced on every public guest write endpoint. A run
   * cannot complete the widget, so booking CREATION is expected to be
   * blocked in automation unless a token can be produced. Set to "true"
   * only when a token has been obtained out of band.
   */
  turnstileBypassExpected: env("QA_TURNSTILE_BYPASS") !== "false",
  /** Credentials are absent — authenticated specs skip with a reason. */
  hasAdmin: !!adminIdentity(),
  hasFrontDesk: !!frontDeskIdentity(),
  hasMember: !!memberIdentity(),
  hasMemberB: !!memberBIdentity()
};
