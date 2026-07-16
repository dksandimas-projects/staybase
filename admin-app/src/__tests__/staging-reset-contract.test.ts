import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const settingsSource = fs.readFileSync(path.resolve(__dirname, "../pages/SettingsPage.tsx"), "utf8");

describe("staging reset Admin contract", () => {
  it("sends the server-issued preview ID with execute", () => {
    expect(settingsSource).toMatch(/previewId:\s*stagingResetPreview\?\.previewId/);
  });

  it("shows the complete destructive scope in the preview modal", () => {
    for (const field of ["calls", "dailyCloses", "corporateInquiries", "roomBlocks", "cleanupHistory"]) {
      expect(settingsSource).toContain(`stagingResetPreview.manifest.${field}`);
    }
  });
});
