import config from "@config";

interface ApiBaseUrlOptions {
  hostname: string;
  configuredGuestUrl?: string;
  domain?: string;
}

export function isStagingAdminEnvironment(
  hostname: string,
  domain = config.domain,
  configuredGuestUrl?: string
): boolean {
  const isCanonicalStagingHost = hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === `stg-admin.${domain}`
    || hostname === `staging-admin.${domain}`;

  if (isCanonicalStagingHost) return true;

  try {
    const configuredHostname = configuredGuestUrl ? new URL(configuredGuestUrl).hostname : "";
    return configuredHostname === `stg.${domain}` || configuredHostname === `staging.${domain}`;
  } catch {
    return false;
  }
}

export function resolveApiBaseUrl({
  hostname,
  configuredGuestUrl,
  domain = config.domain
}: ApiBaseUrlOptions): string {
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:3000";
  }

  if (hostname === `stg-admin.${domain}`) {
    return `https://stg.${domain}`;
  }

  if (hostname === `staging-admin.${domain}`) {
    return `https://staging.${domain}`;
  }

  return configuredGuestUrl || `https://www.${domain}`;
}

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") return "";

  return resolveApiBaseUrl({
    hostname: window.location.hostname,
    configuredGuestUrl: import.meta.env.VITE_GUEST_APP_URL
  });
}
