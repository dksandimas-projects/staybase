// Per #11 (operator-reported 2026-08-20, tracked in
// `plan/project/ROADMAP.md §Open Operator-Reported Bugs → #11`):
// the `updateBookingStatus` AdminContext function
// returns a `{ emailQueued?: boolean } | null` shape so
// the `handleConfirmBooking` (BookingsPage) +
// `handleConfirmBookingFromSuccess` (BookingsPage +
// DashboardPage) handlers can branch the toast on the
// server's `emailQueued` flag. The toast contract is
// the desk-facing surface for the post-#11
// silent-swallow fix — the `failed_emails` Firestore
// collection has the durable audit trail; the admin
// banner (deferred) renders the same data visually.
//
// Source-text guards (per `plan/docs/CONTRIBUTING.md
// §Testing`): cheap, deterministic, <5s. The runtime
// contract (server returns `emailQueued: false` on
// Resend failure) is pinned at
// `guest-app/tests/api/email-failed-delivery-retry.test.ts`
// + `guest-app/tests/api/bookings-confirm.test.ts`.
// This file pins the CLIENT-SIDE wire-up so a future
// refactor that drops the `emailQueued` branching
// (or the AdminContext return shape) breaks here.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const adminContextSrc = read("admin-app/src/context/AdminContext.tsx");
const bookingsPageSrc = read("admin-app/src/pages/BookingsPage.tsx");
const dashboardPageSrc = read("admin-app/src/pages/DashboardPage.tsx");

describe("#11 — desk-facing emailQueued toast (client-side wire-up)", () => {
  describe("AdminContext.updateBookingStatus — return shape", () => {
    it("declares the function signature as Promise<{ emailQueued?: boolean } | null>", () => {
      // The post-#11 contract: every status
      // transition returns a server-response
      // shape (or null for the early-return
      // isStatusChanging branch). The desk
      // picks up the `emailQueued` flag from
      // the `booking-confirmed` server
      // response; other transitions return
      // `null` or a shape without the flag.
      // Back-compat safe — existing callers
      // that don't read the return value
      // still work.
      const fnDecl = adminContextSrc.match(
        /const updateBookingStatus = async \([\s\S]*?\): Promise<\{ emailQueued\?: boolean \} \| null> => \{/
      );
      expect(fnDecl, "expected the post-#11 updateBookingStatus return type").not.toBeNull();
    });

    it("the AdminContextType interface exposes the same return type", () => {
      // The interface at line 602 declares the
      // shape that consumers (BookingsPage +
      // DashboardPage) consume. If the
      // function signature changes, this
      // must change too — and vice versa.
      expect(adminContextSrc).toMatch(
        /updateBookingStatus: \([\s\S]*?\) => Promise<\{ emailQueued\?: boolean \} \| null>;/
      );
    });

    it("the `confirmed` branch returns the server's `data.data` (the emailQueued carrier)", () => {
      // Per #11: the `booking-confirmed` path
      // is the only one that needs to surface
      // `emailQueued` (the `booking-confirmed`
      // email is the most critical — the guest
      // just paid and now waits for an email).
      // Other branches return `data?.data ?? null`
      // for consistency, but their server
      // response doesn't carry `emailQueued`
      // today.
      // The function body has many nested
      // braces (template literals, fetch
      // bodies, JSON.stringify) so a naive
      // brace counter finds a closing `}`
      // too early. Use a regex anchored on the
      // specific line range (the `confirmed`
      // branch is the only `else if` that
      // returns a result, so the regex is
      // stable).
      expect(adminContextSrc).toMatch(
        /status === "confirmed"\) \{[\s\S]{0,2000}?return data\?\.data \?\? null;/
      );
    });

    it("the isStatusChanging early-return surfaces `null` (no server round-trip → no emailQueued flag)", () => {
      expect(adminContextSrc).toMatch(
        /if \(!isStatusChanging\) \{[\s\S]{0,500}?return null;/
      );
    });

    it("the catch block returns `null` (error path doesn't surface emailQueued)", () => {
      // The `} catch (error) {` block is the
      // terminal catch — find it, then check
      // for `return null;` anywhere in the
      // next ~500 chars (the block body).
      // The "terminal" qualifier: there's only
      // one try/catch in this function (the
      // `try` wraps every server roundtrip).
      const catchBlock = adminContextSrc.match(
        /\} catch \(error\) \{[\s\S]{0,800}?return null;[\s\S]{0,200}?\};/
      );
      expect(catchBlock, "expected the catch block to return null").not.toBeNull();
    });
  });

  describe("BookingsPage.handleConfirmBooking — toast branches on emailQueued", () => {
    it("the drawer-confirm path captures the updateBookingStatus return + branches the toast", () => {
      // Per #11: the desk-facing surface. The
      // toast reads "Booking confirmed, email
      // queued" on success / "Email delivery
      // failed" on `emailQueued === false`.
      // The function is large — use line-range
      // anchored regexes (the previous
      // `[\s\S]*?^\s*};` regex matched the next
      // nested function close, not the
      // handleConfirmBooking close, because the
      // function body has `^};` lines from nested
      // arrow functions).
      // Anchor on the function's opening line +
      // a generous body length (the handler is
      // ~30 lines, allow 4000 chars for the
      // body + comments + nested braces).
      const startIdx = bookingsPageSrc.indexOf("const handleConfirmBooking = async () => {");
      expect(startIdx, "expected handleConfirmBooking declaration").toBeGreaterThan(-1);
      const endIdx = bookingsPageSrc.indexOf("};", startIdx + 100);
      // The first `};` after the opening line
      // is the FIRST nested arrow function's
      // close (e.g. setSelectedBooking((prev) =>
      // {...})). Skip past it. Use a depth
      // counter.
      let depth = 0;
      let scanStart = startIdx;
      for (let i = startIdx; i < bookingsPageSrc.length; i++) {
        const ch = bookingsPageSrc[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            // We're at the function's
            // closing `}` (depth is 0
            // for the function body's
            // opening `{` at startIdx).
            const block = bookingsPageSrc.slice(startIdx, i + 1);
            expect(block).toMatch(/const result = await updateBookingStatus/);
            expect(block).toMatch(/result\.emailQueued === false/);
            expect(block).toMatch(/toast\.warning\(/);
            expect(block).toMatch(/toast\.success\("Booking confirmed"/);
            return;
          }
        }
      }
      // If we got here, the function body
      // wasn't found — fail explicitly.
      throw new Error("could not find handleConfirmBooking closing brace");
    });

    it("the post-verify success modal handles the same `emailQueued` flag", () => {
      // The post-verify modal is the second
      // entry point that fires the
      // `booking-confirmed` email.
      const startIdx = bookingsPageSrc.indexOf("const handleConfirmBookingFromSuccess = async () => {");
      expect(startIdx, "expected handleConfirmBookingFromSuccess declaration").toBeGreaterThan(-1);
      let depth = 0;
      for (let i = startIdx; i < bookingsPageSrc.length; i++) {
        const ch = bookingsPageSrc[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const block = bookingsPageSrc.slice(startIdx, i + 1);
            expect(block).toMatch(/const result = await updateBookingStatus/);
            expect(block).toMatch(/result\.emailQueued === false/);
            return;
          }
        }
      }
      throw new Error("could not find handleConfirmBookingFromSuccess closing brace");
    });
  });

  describe("DashboardPage.handleConfirmBookingFromSuccess — toast branches on emailQueued", () => {
    it("the dashboard verify-success modal handles the same `emailQueued` flag", () => {
      // The third entry point — same wire
      // shape as the BookingsPage post-verify
      // modal.
      const startIdx = dashboardPageSrc.indexOf("const handleConfirmBookingFromSuccess = async () => {");
      expect(startIdx, "expected handleConfirmBookingFromSuccess declaration").toBeGreaterThan(-1);
      let depth = 0;
      for (let i = startIdx; i < dashboardPageSrc.length; i++) {
        const ch = dashboardPageSrc[i];
        if (ch === "{") depth++;
        else if (ch === "}") {
          depth--;
          if (depth === 0) {
            const block = dashboardPageSrc.slice(startIdx, i + 1);
            expect(block).toMatch(/const result = await updateBookingStatus/);
            expect(block).toMatch(/result\.emailQueued === false/);
            return;
          }
        }
      }
      throw new Error("could not find handleConfirmBookingFromSuccess closing brace");
    });
  });
});

// Slice the updateBookingStatus function body
// using a paren-counting helper anchored on the
// function signature's closing `)` of the params
// list (FOL-02 / G1 / G2 / #11 source-text pattern).
// Avoids the JSDoc + signature-arg-brace
// ambiguities that the early slice regex hit.
function sliceUpdateBookingStatus(src: string): string {
  const start = src.indexOf("const updateBookingStatus = async (");
  if (start < 0) return "";
  let parensDepth = 0;
  let paramEnd = -1;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") parensDepth++;
    else if (ch === ")") {
      parensDepth--;
      if (parensDepth === 0) {
        paramEnd = i;
        break;
      }
    }
  }
  if (paramEnd < 0) return "";
  const openIdx = src.indexOf("{", paramEnd);
  if (openIdx < 0) return "";
  let depth = 1;
  let i = openIdx + 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return src.slice(start, i);
}