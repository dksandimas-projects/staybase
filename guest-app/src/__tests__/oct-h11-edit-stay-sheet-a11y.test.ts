// Per OCT-H11 (2026-10-20, decision #287): the MBUX-18 edit-stay
// sheet declared `role="dialog" aria-modal="true"` with no focus
// trap, no Escape dismiss, no focus restore and no scroll lock.
//
// THE BUG
//
// The sheet's own backdrop comment claimed "the guest can hit
// Escape via the document keydown listener below" — there was no
// such listener in the file. The admin app already ships the
// correct pattern (`admin-app/src/utils/useFocusTrap.ts`,
// decision #107); the guest app had no equivalent.
//
// Consequences:
//   - A keyboard or screen-reader guest tabs straight out of the
//     sheet into a page that `aria-modal` has hidden from the AT
//     tree, so focus lands on an invisible target.
//   - Escape does nothing — the only dismiss paths are the small X
//     and the backdrop.
//   - On a phone, dragging the dimmed backdrop scrolls the page
//     behind the sheet (the sheet's own `overscroll-contain` only
//     contains the scroll WITHIN the sheet).
//
// THE FIX
//
// `guest-app/src/utils/useFocusTrap.ts` — the guest-app port of the
// admin primitive — plus the sheet wiring.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const sheetSrc = readFileSync(
  resolve(__dirname, "../../src/components/EditStayDetailsSheet.tsx"),
  "utf8"
);
const hookSrc = readFileSync(
  resolve(__dirname, "../../src/utils/useFocusTrap.ts"),
  "utf8"
);
const adminHookSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/utils/useFocusTrap.ts"),
  "utf8"
);

function codeOnly(src: string): string {
  return src
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const sheet = codeOnly(sheetSrc);
const hook = codeOnly(hookSrc);

describe("OCT-H11 — the guest focus primitive", () => {
  it("exists and exports the two hooks", () => {
    expect(hookSrc).toMatch(/export function useFocusTrap<T extends HTMLElement>/);
    expect(hookSrc).toMatch(/export function useBodyScrollLock\(active: boolean\): void/);
  });

  it("traps Tab focus inside the container", () => {
    expect(hook).toMatch(/event\.key !== "Tab"/);
    expect(hook).toMatch(/event\.preventDefault\(\);[\s\S]{0,200}?lastEl\.focus\(\)/);
    expect(hook).toMatch(/event\.preventDefault\(\);[\s\S]{0,200}?firstEl\.focus\(\)/);
  });

  it("closes on Escape", () => {
    expect(hook).toMatch(/event\.key === "Escape"/);
    expect(hook).toMatch(/onEscapeRef\.current\(\)/);
  });

  it("moves focus into the dialog on activation", () => {
    expect(hook).toMatch(/const first = focusables\[0\];[\s\S]{0,200}?first\.focus\(\)/);
  });

  it("restores focus to the previously focused element on close", () => {
    expect(hook).toMatch(/previouslyFocused\.current = document\.activeElement/);
    expect(hook).toMatch(/previous\.focus\(\)/);
  });

  it("locks the body scroll while the overlay is open", () => {
    expect(hook).toMatch(/body\.style\.overflow = "hidden";/);
    expect(hook).toMatch(/body\.style\.overflow = previousOverflow;/);
  });

  it("is NOT shared through `@spark-inn/shared` (the server bundle has no React)", () => {
    const sharedIndexSrc = readFileSync(
      resolve(__dirname, "../../../shared/index.ts"),
      "utf8"
    );
    expect(sharedIndexSrc).not.toMatch(/useFocusTrap/);
    expect(sharedIndexSrc).not.toMatch(/useBodyScrollLock/);
  });

  it("mirrors the admin app's primitive (the same contract)", () => {
    // The admin app's `useFocusTrap` is the reference implementation
    // (decision #107). The guest port must expose the SAME shape so
    // the two apps stay in step.
    expect(adminHookSrc).toMatch(/export function useFocusTrap<T extends HTMLElement>/);
    expect(hookSrc).toMatch(/export function useFocusTrap<T extends HTMLElement>/);
  });
});

describe("OCT-H11 — the edit-stay sheet wires the primitive", () => {
  it("attaches the trap ref to the dialog element", () => {
    expect(sheet).toMatch(/const trapRef = useFocusTrap<HTMLDivElement>\(open, \(\) => closeRef\.current\(\)\);/);
    expect(sheet).toMatch(/ref=\{trapRef\}/);
  });

  it("engages the body scroll lock", () => {
    expect(sheet).toMatch(/useBodyScrollLock\(open\);/);
  });

  it("keeps the dialog / aria-modal contract", () => {
    expect(sheet).toMatch(/role="dialog"/);
    expect(sheet).toMatch(/aria-modal="true"/);
    expect(sheet).toMatch(/aria-labelledby="edit-stay-details-title"/);
  });

  it("no longer claims a document keydown listener that does not exist", () => {
    expect(sheetSrc).not.toMatch(/hit Escape via the document keydown listener/);
  });
});
