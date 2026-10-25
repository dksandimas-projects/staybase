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
