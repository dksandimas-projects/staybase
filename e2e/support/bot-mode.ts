/**
 * AI-BROWSER-QA (2026-10-25) — the live bot-protection mode.
 *
 * The hotel-wide switch (`settings/hotelConfig.botProtectionMode`) decides
 * whether the Turnstile gate is applied. It is a MODE, not a fixed
 * behaviour, so the specs that assert the gate have to assert what the
 * deployed mode actually does — in both modes, strictly.
 *
 * The mode is read from the PUBLIC projection (`GET
 * /api/public/hotel-config`), which is the same source the client reads,
 * so the spec and the site can never disagree about which mode is live.
 *
 * A read that fails resolves to "turnstile" — the FAIL-CLOSED default,
 * because that is the mode that applies to every other install.
 */

export type BotMode = "turnstile" | "disabled";

export async function liveBotMode(baseUrl: string): Promise<BotMode> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/public/hotel-config`, {
      headers: { Accept: "application/json" }
    });
    if (!res.ok) return "turnstile";
    const body: any = await res.json().catch(() => ({}));
    return body?.data?.botProtectionMode === "disabled" ? "disabled" : "turnstile";
  } catch {
    return "turnstile";
  }
}

/**
 * Skip a spec that WRITES through a gated guest endpoint when the
 * bot-protection gate is ON.
 *
 * The guest-write scenarios create real production records, and the
 * endpoints that create them are behind Cloudflare Turnstile. The gate
 * is deliberately OFF only for a testing window; the hotel ships with it
 * ON, and it MUST be ON whenever real guests can book.
 *
 * So a spec that needs the gate open cannot simply fail when it is
 * closed — a failure there would read as "the product is broken" when
 * the product is in fact correctly protected. It SKIPS, with an explicit
 * reason, which is the same rule the rest of the suite follows: a missing
 * precondition produces a skip with a reason, never a silent pass and
 * never a false failure.
 *
 * The alternative — running the suite from a network that can complete the
 * Cloudflare challenge — also works, and is the better answer for a
 * PERMANENT QA lane. This helper is what lets the same suite run in both
 * worlds without either one reporting a lie.
 */
export async function requireBotGateOff(baseUrl: string, what: string): Promise<BotMode> {
  const mode = await liveBotMode(baseUrl);
  if (mode === "turnstile") {
    const { test } = await import("@playwright/test");
    test.skip(
      true,
      `the hotel-wide bot-protection gate is ON, so ${what} cannot reach the ` +
        `server from this host — the Cloudflare challenge platform does not ` +
        `resolve here. This is the CORRECT production posture (the gate must ` +
        `be ON whenever real guests can book). Re-run with the switch off, or ` +
        `from a network that can complete the challenge.`
    );
  }
  return mode;
}
