// Per #11 (operator-reported 2026-08-20, tracked in
// `plan/project/ROADMAP.md §Open Operator-Reported Bugs → #11`):
// the `failed_emails` collection is the durable
// audit trail for every Resend send failure. The
// firestore.rules write that gates it is the
// security contract — admin-only read, server-only
// writes. The source-text guards here pin the
// rule + the booking-confirmed response shape so a
// future refactor that drops either surfaces here.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

const rulesSrc = read("firebase/firestore.rules");
const bookingsSrc = read("guest-app/server/handlers/bookings.ts");
const emailSrc = read("guest-app/server/handlers/email.ts");

describe("#11 — failed_emails DLQ (source-text + firestore.rules contract)", () => {
  describe("firestore.rules — failed_emails collection", () => {
    it("declares a match /failed_emails/{failureId} block", () => {
      // Match from `match /failed_emails/{failureId} {` to
      // the next 4-space-indented `}` (the matching
      // block close). The `[\s\S]*?` is non-greedy
      // + a `}` at start-of-line stops the slice
      // at the first block close.
      const blockStart = rulesSrc.indexOf("match /failed_emails/{failureId} {");
      expect(blockStart, "expected the failed_emails match block start").toBeGreaterThan(-1);
      const sliceFrom = blockStart;
      const sliceTo = rulesSrc.indexOf("    }\n", sliceFrom);
      expect(sliceTo, "expected the failed_emails match block close").toBeGreaterThan(-1);
      const block = rulesSrc.slice(sliceFrom, sliceTo);
      expect(block).toMatch(/match \/failed_emails\/\{failureId\} \{/);
      expect(block).toMatch(/allow read: if isAdmin\(\)/);
      expect(block).toMatch(/allow create, update, delete: if false/);
    });
  });

  describe("guest-app/server/handlers/email.ts — sendEmail DLQ wrap", () => {
    // Slice the sendEmail function body. The
    // function signature is
    //   `async function sendEmail(to: string, subject: string, html: string, attachments?: Array<{ filename: string; content: Buffer }>) { ... }`
    // — the `Array<{...}>`'s nested {} and the
    // return type's `void` don't have braces, so the
    // body opening `{` follows the closing `)`
    // of the params list. We use the brace-counting
    // helper (FOL-02 / G1 / G2 pattern) starting
    // at the function signature's `)` — that gives
    // us the body opening directly.
    function sliceSendEmail(src: string): string {
      const start = src.indexOf("async function sendEmail(");
      if (start < 0) return "";
      // Skip past the preceding JSDoc (if any).
      const jsdocEnd = src.lastIndexOf("*/", start);
      const searchFrom = jsdocEnd > 0 ? jsdocEnd + 2 : start;
      // Find the closing `)` of the params list
      // (so we can start the brace counter
      // immediately after it). The params
      // signature is `(... attachments?:
      // Array<{ ... }>)` — the `)` is the function
      // param close, not the inner `>`.
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
      // From paramEnd forward, find the opening
      // `{` of the body (skipping whitespace +
      // the return type if present).
      const bodyOpenMatch = src.slice(paramEnd).match(/\{\s*$/m) || src.slice(paramEnd).match(/\{/);
      // The simpler approach: scan from paramEnd
      // forward for the first `{`.
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

    it("wraps the resend.emails.send call in a try/catch", () => {
      const body = sliceSendEmail(emailSrc);
      expect(body).toMatch(/try \{/);
      expect(body).toMatch(/await resend\.emails\.send\(/);
      expect(body).toMatch(/\} catch \(error: any\) \{/);
    });

    it("writes a failed_emails doc on Resend failure with the canonical field shape", () => {
      // The canonical field shape: `recipient`,
      // `subject`, `error`, `lastAttemptAt` (Date),
      // `retryCount` (number).
      const body = sliceSendEmail(emailSrc);
      expect(body).toMatch(/adminDb\.collection\("failed_emails"\)\.add\(\{/);
      expect(body).toMatch(/recipient:/);
      expect(body).toMatch(/subject:/);
      expect(body).toMatch(/error:/);
      expect(body).toMatch(/lastAttemptAt:\s*new Date\(\)/);
      expect(body).toMatch(/retryCount:\s*0/);
    });

    it("re-throws the original Resend error after the DLQ write (so the caller's outer try/catch sees it)", () => {
      // The pre-#11 behaviour was to throw; the
      // post-#11 behaviour is to throw AFTER the
      // DLQ write. The DLQ must not mask the
      // original error.
      const body = sliceSendEmail(emailSrc);
      expect(body).toMatch(/throw error;/);
    });
  });

  describe("guest-app/server/handlers/bookings.ts — handleConfirmBooking emailQueued response", () => {
    // Slice the handleConfirmBooking function
    // body. The function is large (the
    // `runTransaction` block has nested braces);
    // we use the same brace-counting pattern as
    // the FOL-02 / G1 / G2 test suites, anchored
    // to the closing `)` of the params list so
    // the body opening is unambiguous (the
    // function's return type is `Promise<any>`
    // — no nested type-union braces).
    function sliceHandleConfirmBooking(src: string): string {
      const start = src.indexOf("export async function handleConfirmBooking(");
      if (start < 0) return "";
      // Find the closing `)` of the params list.
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
      // From paramEnd forward, find the body
      // opening `{`.
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

    it("declares the `emailQueued` local + the catch that sets it to false", () => {
      // The pre-#11 surface was a silent swallow
      // (try/catch + console.error only). The
      // post-#11 surface declares `emailQueued`
      // locally and sets it to `false` on the
      // catch path so the HTTP response can
      // surface the email state to the desk.
      const confirmBlock = sliceHandleConfirmBooking(bookingsSrc);
      expect(confirmBlock).toMatch(/let emailQueued = true/);
      expect(confirmBlock).toMatch(/emailQueued = false/);
    });

    it("the success response carries the emailQueued field", () => {
      // Per #11: the HTTP response shape is the
      // synchronous desk-facing surface for the
      // "did the email land?" question. The toast
      // branches on `emailQueued` (true →
      // "Booking confirmed, email queued" /
      // false → "Booking confirmed, email failed
      // — see banner").
      const confirmBlock = sliceHandleConfirmBooking(bookingsSrc);
      expect(confirmBlock).toMatch(
        /return res\.status\(200\)\.json\(\{ success: true, data: \{ status: "confirmed", emailQueued \} \}\)/m
      );
    });
  });
});