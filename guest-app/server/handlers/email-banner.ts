// ETR-22: environment-aware email banner. Renders a stacked
// callout — the more specific (test-run) on top, the
// deployment-level (staging) below. Both gated by the same
// `isStagingProject()` allowlist the staging reset uses; the
// test-run block needs the run's `name` + `environment` stamped
// onto the booking doc (the create transaction does this
// alongside `isTestData`).
//
// This module is intentionally dependency-free of firebase-admin,
// resend, and jsPDF so unit tests can import the helpers without
// dragging in the Vercel-only side-effect modules. It only
// depends on the static hotel config + the projected staging
// check.

import config from "../../../hotel.config";
import { isStagingProject } from "./test-runs";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

type CalloutTone = "warm" | "green" | "red";

function callout(tone: CalloutTone, title: string, body: string): string {
  const tones: Record<CalloutTone, { bg: string; border: string; title: string }> = {
    warm: { bg: config.colors.primaryLight, border: config.colors.primary, title: config.colors.primaryDark },
    green: { bg: "#ecfdf5", border: "#16a34a", title: "#166534" },
    red: { bg: "#fef2f2", border: "#dc2626", title: "#991b1b" }
  };
  const toneValues = tones[tone];
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse: collapse; margin: 22px 0; background: ${toneValues.bg}; border-left: 4px solid ${toneValues.border}; border-radius: 12px;">
      <tr>
        <td style="padding: 16px 18px;">
          <p style="margin: 0 0 6px; color: ${toneValues.title}; font-weight: 800; font-size: 14px;">${title}</p>
          <p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">${body}</p>
        </td>
      </tr>
    </table>
  `;
}

export type EnvironmentBannerState = {
  isTestData?: boolean;
  testRunName?: string;
  testRunEnvironment?: "staging" | "production";
};

export function environmentBanner(state: EnvironmentBannerState): string {
  const blocks: string[] = [];

  if (state.isTestData === true) {
    const runName = typeof state.testRunName === "string" ? state.testRunName.trim() : "";
    const envRaw = state.testRunEnvironment;
    const env = envRaw === "staging" || envRaw === "production" ? envRaw : "";
    let descriptor: string;
    if (runName && env) {
      descriptor = `test run &ldquo;${escapeHtml(runName)}&rdquo; on ${env}`;
    } else if (runName) {
      descriptor = `test run &ldquo;${escapeHtml(runName)}&rdquo;`;
    } else if (env) {
      descriptor = `active test run on ${env}`;
    } else {
      descriptor = "active test run";
    }
    blocks.push(
      callout(
        "warm",
        "\uD83E\uDDEA Test run email",
        `This email was sent as part of ${descriptor}. No real action is required \u2014 please ignore any booking, payment, or check-in instructions in this email.`
      )
    );
  }

  if (isStagingProject()) {
    blocks.push(
      callout(
        "warm",
        "\u26A0\uFE0F Staging environment email",
        "This email was sent from the staging environment. No real action is required \u2014 please ignore any booking, payment, or check-in instructions in this email."
      )
    );
  }

  return blocks.join("\n");
}

export function environmentBannerFromBooking(booking: any): string {
  return environmentBanner({
    isTestData: booking?.isTestData === true,
    testRunName: typeof booking?.testRunName === "string" ? booking.testRunName : "",
    testRunEnvironment:
      booking?.testRunEnvironment === "staging" || booking?.testRunEnvironment === "production"
        ? booking.testRunEnvironment
        : undefined
  });
}
