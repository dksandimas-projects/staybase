import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const srcRoot = resolve(__dirname, "..");

function read(path: string) {
  return readFileSync(resolve(srcRoot, path), "utf8");
}

describe("account portal mobile layout", () => {
  it("keeps the shared account grid and mobile navigation within the viewport", () => {
    const layout = read("components/AccountLayout.tsx");

    expect(layout).toContain("lg:grid-cols-[240px_minmax(0,1fr)]");
    expect(layout).toContain("grid-cols-4");
    expect(layout).toContain('aria-label="Account navigation"');
    expect(layout).not.toContain("overflow-x-auto");
    expect(layout).not.toContain("whitespace-nowrap shrink-0");
  });

  it("allows account page content to shrink and wrap on narrow screens", () => {
    const profile = read("pages/ProfilePage.tsx");
    const stays = read("pages/StaysPage.tsx");
    const rewards = read("pages/RewardsPage.tsx");
    const verifyBanner = read("components/EmailVerifyBanner.tsx");

    expect(profile).toContain("flex min-w-0 flex-col gap-5");
    expect(stays).toContain("flex min-w-0 flex-wrap items-center");
    expect(rewards).toContain("flex min-w-0 items-center justify-between gap-3");
    expect(verifyBanner).toContain("break-all font-semibold");
  });
});
