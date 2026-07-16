import { describe, expect, it } from "vitest";
import { isStagingAdminEnvironment, resolveApiBaseUrl } from "../utils/apiBaseUrl";

describe("admin API base URL resolution", () => {
  it("uses the local guest API during local development", () => {
    expect(resolveApiBaseUrl({
      hostname: "localhost",
      configuredGuestUrl: "https://www.sparkinnbohol.com"
    })).toBe("http://localhost:3000");
  });

  it("routes the staging admin domain to the staging guest API", () => {
    expect(resolveApiBaseUrl({
      hostname: "stg-admin.sparkinnbohol.com",
      configuredGuestUrl: "https://www.sparkinnbohol.com"
    })).toBe("https://stg.sparkinnbohol.com");
  });

  it("supports the long-form staging domain convention", () => {
    expect(resolveApiBaseUrl({
      hostname: "staging-admin.example.com",
      configuredGuestUrl: "https://www.example.com",
      domain: "example.com"
    })).toBe("https://staging.example.com");
  });

  it("keeps production on the explicitly configured guest URL", () => {
    expect(resolveApiBaseUrl({
      hostname: "admin.sparkinnbohol.com",
      configuredGuestUrl: "https://www.sparkinnbohol.com"
    })).toBe("https://www.sparkinnbohol.com");
  });

  it("falls back to the configured brand domain", () => {
    expect(resolveApiBaseUrl({
      hostname: "admin.example.com",
      domain: "example.com"
    })).toBe("https://www.example.com");
  });

  it("exposes destructive staging controls only on local and staging configurations", () => {
    expect(isStagingAdminEnvironment("localhost")).toBe(true);
    expect(isStagingAdminEnvironment("stg-admin.sparkinnbohol.com")).toBe(true);
    expect(isStagingAdminEnvironment(
      "staybase-admin-git-dev.vercel.app",
      "sparkinnbohol.com",
      "https://stg.sparkinnbohol.com"
    )).toBe(true);
    expect(isStagingAdminEnvironment(
      "staybase-admin.vercel.app",
      "sparkinnbohol.com",
      "https://www.sparkinnbohol.com"
    )).toBe(false);
    expect(isStagingAdminEnvironment("admin.sparkinnbohol.com")).toBe(false);
  });
});
