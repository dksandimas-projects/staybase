// Per the QR deep link (2026-11-21): the Spark Essentials (store) QR
// encodes `/intercom/{roomId}?tab=shop` (see
// `plan/features/QR-MANAGEMENT.md`), so a guest who scans a "scan to
// order" card must land on the STORE tab. The intercom panel used to
// always open on the Chat tab — the QR was right, the guest app
// ignored it, and every store scan landed on the wrong surface.
//
// The resolver is pinned here, together with the wiring in
// `IntercomPage.tsx` — a source-text pin, because the wiring is what
// regressed.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveIntercomTab, withIntercomTab } from "../utils/intercomTab";

describe("intercom tab deep link", () => {
  it("opens the shop tab for the store QR", () => {
    expect(resolveIntercomTab("?tab=shop")).toBe("shop");
    expect(resolveIntercomTab("tab=shop")).toBe("shop");
    expect(resolveIntercomTab(new URLSearchParams("tab=shop"))).toBe("shop");
  });

  it("opens the chat tab for the plain chat QR and for anything unknown", () => {
    expect(resolveIntercomTab("")).toBe("chat");
    expect(resolveIntercomTab("?tab=chat")).toBe("chat");
    expect(resolveIntercomTab("?tab=store")).toBe("chat");
    expect(resolveIntercomTab("?tab=SHOP")).toBe("chat");
  });

  it("keeps the other query params when the tab changes", () => {
    expect(withIntercomTab("", "shop")).toBe("?tab=shop");
    expect(withIntercomTab("?tab=shop", "chat")).toBe("");
    expect(withIntercomTab("?ref=abc", "shop")).toBe("?ref=abc&tab=shop");
    expect(withIntercomTab("?ref=abc", "chat")).toBe("?ref=abc");
  });
});

describe("IntercomPage — the QR deep link reaches the visible tab", () => {
  const page = readFileSync(
    resolve(__dirname, "../pages/IntercomPage.tsx"),
    "utf8"
  );

  it("seeds the active tab from the URL param instead of hardcoding chat", () => {
    expect(page).toMatch(
      /useState<IntercomTab>\(\(\)\s*=>\s*resolveIntercomTab\(location\.search\)\s*\)/
    );
    expect(page).not.toMatch(/useState<"chat" \| "shop">\("chat"\)/);
  });

  it("keeps the URL in sync when the guest switches tabs", () => {
    expect(page).toMatch(/handleTabChange/);
    expect(page).toMatch(/search: withIntercomTab\(/);
    expect(page).toMatch(/\{ replace: true \}/);
  });
});
