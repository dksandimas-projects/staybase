// Per OCT-H3 (2026-10-20, decision #282): the "Booking & Holds"
// form never re-synced from the Firestore snapshot, so a save
// silently rewrote the stored policy.
//
// THE BUG
//
// The three inputs (payment hold window, in-flow hold minutes,
// maximum stay nights) were initialized with `useState`'s lazy
// initializer, which only runs on the FIRST render — BEFORE the
// Firestore snapshot lands. On a direct load of `/settings` (F5 /
// bookmark / shared URL) the fields were therefore stuck at the
// pre-snapshot defaults, and the next save of an UNRELATED field
// silently rewrote the stored policy.
//
// The worst case: a hotel that had set the stay cap to "no limit"
// (stored as `0`, resolved to `Infinity` by `resolveMaxStayNights`)
// had it replaced with `30` — with the field still DISPLAYING
// "30", so there was no signal that anything changed. The guest
// site then started refusing 31+ night stays it previously
// accepted.
//
// The same defect applied to the two hold-window fields (their
// defaults are 24h / 15min), so the fix covers all three.
//
// THE FIX
//
// A re-sync effect that refreshes each input from the snapshot —
// but ONLY when that field's SOURCE value actually changed since
// the last sync, so a snapshot that arrives mid-typing cannot
// clobber the admin's in-progress edit.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsSrc = readFileSync(
  resolve(__dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const code = codeOnly(settingsSrc);

describe("OCT-H3 — the Booking & Holds form re-syncs from the snapshot", () => {
  it("has a sync ref that tracks the last-seen source values", () => {
    expect(code).toMatch(/const holdsFormSyncRef = useRef</);
  });

  it("re-syncs the payment hold window", () => {
    expect(code).toMatch(
      /if \(prev\.paymentHoldWindowHours !== next\.paymentHoldWindowHours\) \{\s*setPaymentHoldWindowHoursInput\(next\.paymentHoldWindowHours\);/
    );
  });

  it("re-syncs the in-flow hold minutes", () => {
    expect(code).toMatch(
      /if \(prev\.inFlowHoldMinutes !== next\.inFlowHoldMinutes\) \{\s*setInFlowHoldMinutesInput\(next\.inFlowHoldMinutes\);/
    );
  });

  it("re-syncs the maximum stay nights, rendering `Infinity` back as the literal `0`", () => {
    expect(code).toMatch(
      /maxStayNights:\s*Number\.isFinite\(hotelConfig\.maxStayNights\)\s*\?\s*String\(hotelConfig\.maxStayNights\)\s*:\s*"0"/
    );
    expect(code).toMatch(
      /if \(prev\.maxStayNights !== next\.maxStayNights\) \{\s*setMaxStayNightsInput\(next\.maxStayNights\);/
    );
  });

  it("the effect's dependencies are the SOURCE values (not the whole config object)", () => {
    // Depending on the whole `hotelConfig` object would re-run the
    // effect on every snapshot, which is what the "only when the
    // source changed" guard exists to survive.
    expect(code).toMatch(
      /\[\s*hotelConfig\.paymentHoldWindowHours,\s*hotelConfig\.inFlowHoldMinutes,\s*hotelConfig\.maxStayNights\s*\]/
    );
  });

  it("the first run adopts the pre-snapshot defaults without touching the inputs", () => {
    // The `useState` initializers already wrote the defaults; the
    // first effect run must only RECORD them so the real snapshot
    // is treated as a change.
    expect(code).toMatch(/if \(!prev\) return;/);
  });

  it("the save still writes the literal the admin typed (including `0` for no limit)", () => {
    expect(code).toMatch(/maxStayNights: maxStayNightsValid!/);
  });

  it("the stored value is resolved to `Infinity` on the read side (the admin context)", () => {
    expect(adminContextSrc).toMatch(
      /maxStayNights: resolveMaxStayNights\(\(data as Partial<typeof hotelConfig>\)\?\.maxStayNights\)/
    );
  });
});
