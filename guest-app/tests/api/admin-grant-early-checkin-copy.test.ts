import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const emailSource = fs.readFileSync(path.resolve(__dirname, "../../server/handlers/email.ts"), "utf8");
const rewardsSource = fs.readFileSync(path.resolve(__dirname, "../../src/pages/RewardsPage.tsx"), "utf8");

describe("admin-granted early check-in guest copy", () => {
  test("email distinguishes a staff grant from a guest request approval", () => {
    expect(emailSource).toContain('booking.earlyCheckIn?.source === "staff-granted"');
    expect(emailSource).toContain("Early check-in added to your stay");
    expect(emailSource).toContain("Our team has added early check-in");
    expect(emailSource).toContain('isStaffGranted ? "Granted" : "Approved"');
  });

  test("Rewards describes the benefit as added rather than requested", () => {
    expect(rewardsSource).toContain('earlyCheckIn.source === "staff-granted"');
    expect(rewardsSource).toContain("Early check-in has been added to your stay!");
  });
});
