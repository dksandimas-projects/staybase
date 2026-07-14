import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Admin audit 2026-07-07 critical fixes", () => {
  const contextSrc = readFileSync(
    resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
    "utf8"
  );
  const membersPageSrc = readFileSync(
    resolve(__dirname, "../../../admin-app/src/pages/MembersPage.tsx"),
    "utf8"
  );
  const bookingsPageSrc = readFileSync(
    resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
    "utf8"
  );
  const apiRouterSrc = readFileSync(
    resolve(__dirname, "../../../guest-app/server/apiRouter.ts"),
    "utf8"
  );
  const memberHandlerSrc = readFileSync(
    resolve(__dirname, "../../../guest-app/server/handlers/members.ts"),
    "utf8"
  );

  it("AA-01 persists manual member point adjustments and reads the real pointsHistory subcollection", () => {
    expect(contextSrc).toMatch(/runTransaction\(db,\s*async\s*\(transaction\)/);
    expect(contextSrc).toMatch(/collection\(db,\s*["']members["']\s*,\s*memberId\s*,\s*["']pointsHistory["']\)/);
    expect(contextSrc).toMatch(/transaction\.update\(memberRef,[\s\S]*rewardsPoints:\s*nextBalance/);
    expect(contextSrc).toMatch(/transaction\.set\(historyRef,/);
    expect(membersPageSrc).toMatch(/collection\(db,\s*["']members["']\s*,\s*selectedMember\.id\s*,\s*["']pointsHistory["']\)/);
    expect(membersPageSrc).toMatch(/orderBy\(["']at["']\s*,\s*["']desc["']\)/);
  });

  it("AA-01 suspends and activates members through an authenticated API that updates Firebase Auth", () => {
    expect(contextSrc).toMatch(/api\/members\/set-active/);
    expect(apiRouterSrc).toMatch(/domain === ["']members["'] && action === ["']set-active["']/);
    expect(memberHandlerSrc).toMatch(/export async function handleSetMemberActive/);
    expect(memberHandlerSrc).toMatch(/adminAuth\.updateUser\(uid,\s*\{\s*disabled:\s*!isActive\s*\}\)/);
    expect(membersPageSrc).not.toMatch(/setSelectedMember\(prev\s*=>\s*prev\s*\?\s*\{\s*\.\.\.prev,\s*isActive:\s*!prev\.isActive/);
  });

  it("AA-02 confirms bookings through the server endpoint so confirmation email dedup runs", () => {
    expect(contextSrc).toMatch(/status === ["']confirmed["'][\s\S]*api\/bookings\/confirm/);
    const confirmedBranchIndex = contextSrc.indexOf(`} else if (status === "confirmed") {`);
    const checkoutBranchIndex = contextSrc.indexOf(`} else if (status === "checked-out") {`);
    const unsupportedTransitionIndex = contextSrc.indexOf("Unsupported client-side booking status transition");
    expect(confirmedBranchIndex).toBeGreaterThan(-1);
    expect(checkoutBranchIndex).toBeGreaterThan(confirmedBranchIndex);
    expect(unsupportedTransitionIndex).toBeGreaterThan(checkoutBranchIndex);
    expect(contextSrc).not.toContain("const updatePayload: Record<string, any>");
  });

  it("AA-03 renders real payment proof URLs and removes the fake store receipt panel", () => {
    expect(bookingsPageSrc).toMatch(/selectedBooking\.paymentProofUrl/);
    expect(bookingsPageSrc).toMatch(/src=\{selectedBooking\.paymentProofUrl\}/);
    expect(bookingsPageSrc).toMatch(/selectedOrder\.paymentProofUrl/);
    expect(bookingsPageSrc).toMatch(/src=\{selectedOrder\.paymentProofUrl\}/);
    expect(bookingsPageSrc).not.toMatch(/Mock receipt confirmation verified/);
    expect(bookingsPageSrc).not.toMatch(/RECEIPT SCREENSHOT/);
  });
});
