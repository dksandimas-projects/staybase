// Per BR-04 (Phase 13 — Breakfast Redesign, decision
// #233, 2026-10-13): source-text tripwire tests for the
// guest Manage Breakfast page + the lookup-page "Manage
// Breakfast" link + the api-router route registration.
//
// The tripwires guard the structural invariants the page
// establishes. They cover:
//   1. The new `ManageBreakfastPage.tsx` exists + exports
//      a default page component.
//   2. The page reads `ref` and `token` from the query
//      string (the magic-link auth).
//   3. The page's "Save changes" button is gated on a
//      `dirty` flag derived from the local selections vs.
//      the loaded ones.
//   4. The page imports + uses
//      `computeBreakfastCutoffState` to render the per-
//      date locked state.
//   5. The page renders a "Served" badge for slots where
//      `breakfastServed[key]` is present.
//   6. The page renders a "Refund due" banner when the
//      user removes a paid meal.
//   7. The App.tsx router registers a `/my-booking/breakfast`
//      route.
//   8. The lookup page renders a "Manage Breakfast" link
//      when the booking status allows it.
//   9. The new `handleGetBreakfastManage` and
//      `handleUpdateBreakfast` handlers are registered in
//      `apiRouter.ts`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readSrc(relPath: string): string {
  return readFileSync(
    resolve(__dirname, "../../../guest-app", relPath),
    "utf8"
  );
}

describe("BR-04 — Manage Breakfast page source-text tripwires", () => {
  describe("new guest-app/page", () => {
    const pageSrc = readSrc("src/pages/ManageBreakfastPage.tsx");

    it("ManageBreakfastPage.tsx exists and exports a default page component", () => {
      // The page is a default export (per the
      // file-structure rule: pages default-export,
      // components / hooks named-export).
      expect(pageSrc).toMatch(/^export\s+default\s+function\s+ManageBreakfastPage/m);
    });

    it("the page reads `ref` and `token` from the query string", () => {
      // The page is mounted at
      // `/my-booking/breakfast?ref=...&token=...`. The
      // magic-link auth pattern (already used by
      // /my-booking) is reused.
      expect(pageSrc).toMatch(/searchParams\.get\(["']ref["']\)/);
      expect(pageSrc).toMatch(/searchParams\.get\(["']token["']\)/);
    });

    it("the page has a \"Save changes\" button gated on a `dirty` flag", () => {
      // The dirty flag is a `useMemo` derivation over
      // the form's edits vs. the loaded selections. The
      // Save button is `disabled={!diff.dirty || ...}`.
      expect(pageSrc).toMatch(/Save changes/);
      expect(pageSrc).toMatch(/disabled=\{!diff\.dirty/);
    });

    it("the page uses `computeBreakfastCutoffState` from @spark-inn/shared to render the per-date locked state", () => {
      // The same shared helper that BR-03 uses — single
      // source of truth so the rendered countdown copy
      // matches what the server computed.
      expect(pageSrc).toMatch(/computeBreakfastCutoffState/);
      expect(pageSrc).toMatch(/from\s+["']@spark-inn\/shared["']/);
    });

    it("the page renders a \"Served\" badge for slots where `breakfastServed[key]` is present", () => {
      // The badge is the struck-through name + the
      // "Served at HH:MM" subtext (per the spec). The
      // condition is `payload.breakfastServed &&
      // payload.breakfastServed[slotKey]`.
      expect(pageSrc).toMatch(/breakfastServed\[slotKey\]/);
      expect(pageSrc).toMatch(/Served at/);
    });

    it("the page renders a \"Refund due\" banner when the user removes a paid meal", () => {
      // The banner reads "Refund due: ₱X — recorded by
      // staff after cutoff." (preview) or "Refund due:
      // ₱X — pending staff processing." (persisted).
      expect(pageSrc).toMatch(/Refund due:/);
      expect(pageSrc).toMatch(/recorded by staff after cutoff/);
      expect(pageSrc).toMatch(/pending staff processing/);
    });
  });

  describe("App.tsx — new route registration", () => {
    const appSrc = readSrc("src/App.tsx");

    it("App.tsx registers the `/my-booking/breakfast` route", () => {
      // The route is a sibling of the existing
      // `/my-booking` route. The order is
      // /my-booking first, then /my-booking/breakfast
      // — both routes coexist (the first segment is the
      // prefix, not a wildcard).
      expect(appSrc).toMatch(/<Route[\s\S]*?path=["']\/my-booking\/breakfast["']/);
    });

    it("App.tsx imports the new page component", () => {
      expect(appSrc).toMatch(/import\s+ManageBreakfastPage\s+from\s+["']\.\/pages\/ManageBreakfastPage["']/);
    });
  });

  describe("BookingLookupPage.tsx — \"Manage Breakfast\" link", () => {
    const lookupSrc = readSrc("src/pages/BookingLookupPage.tsx");

    it("the lookup page renders a \"Manage Breakfast\" link when the booking status allows it", () => {
      // Per the spec's Manage gate: link only renders
      // when `status` is `confirmed | payment-confirmed
      // | checked-in`. The link target is
      // `/my-booking/breakfast?ref=...&token=...`.
      expect(lookupSrc).toMatch(/ManageBreakfastLink/);
      expect(lookupSrc).toMatch(/\/my-booking\/breakfast\?ref=/);
      // The status gate uses the three allowed values.
      expect(lookupSrc).toMatch(/canManage\s*=\s*\[[^\]]*confirmed[^\]]*payment-confirmed[^\]]*checked-in[^\]]*\]/);
    });

    it("the link component propagates the bookingRef + lookupToken", () => {
      expect(lookupSrc).toMatch(/bookingRef=\{activeBooking\.bookingRef\}/);
      expect(lookupSrc).toMatch(/token=\{String\(searchParams\.get\(\s*["']token["']\)\s*\|\|\s*["']["']\)\}/);
    });
  });

  describe("apiRouter.ts — the new handlers are registered", () => {
    const routerSrc = readSrc("server/apiRouter.ts");

    it("apiRouter imports handleGetBreakfastManage + handleUpdateBreakfast", () => {
      expect(routerSrc).toMatch(/import\s*\{[^}]*handleGetBreakfastManage[^}]*\}\s*from\s*["']\.\/handlers\/breakfast-manage["']/);
      expect(routerSrc).toMatch(/import\s*\{[^}]*handleUpdateBreakfast[^}]*\}\s*from\s*["']\.\/handlers\/breakfast-manage["']/);
    });

    it("the manage-read route is registered (GET with pathSegments[2] === \"manage\")", () => {
      expect(routerSrc).toMatch(/domain\s*===\s*["']bookings["']\s*&&\s*action\s*===\s*["']breakfast["']\s*&&\s*pathSegments\[2\]\s*===\s*["']manage["']\s*&&\s*req\.method\s*===\s*["']GET["']/);
      expect(routerSrc).toMatch(/return\s+await\s+handleGetBreakfastManage\(/);
    });

    it("the manage-update route is registered (POST with pathSegments[2] === \"update\")", () => {
      expect(routerSrc).toMatch(/domain\s*===\s*["']bookings["']\s*&&\s*action\s*===\s*["']breakfast["']\s*&&\s*pathSegments\[2\]\s*===\s*["']update["']\s*&&\s*req\.method\s*===\s*["']POST["']/);
      expect(routerSrc).toMatch(/return\s+await\s+handleUpdateBreakfast\(/);
    });
  });
});
