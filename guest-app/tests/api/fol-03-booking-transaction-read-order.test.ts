// Per FOL-03 (the repo's "all reads before all writes" rule):
// three booking paths read a Firestore document AFTER a write had
// already been queued in the same transaction. Firestore's
// `runTransaction` REJECTS a read after a write:
//
//   "Firestore transactions require all reads to be executed
//    before all writes."
//
// so the whole transaction aborted and the caller saw a 500.
//
// WHAT EACH ONE DID IN PRODUCTION
// --------------------------------
// 1. `handleCreateBooking` — the member self-service points
//    redemption (PR #9, 2026-10-13) read `settings/rewardsConfig`
//    and the member's own document AFTER the daily-counter write.
//    Every booking creation carrying `pointsToRedeem > 0` died with
//    a 500. The feature was live and configured (`allowMemberPointsRedemption`
//    is enabled in production, and real members clear
//    `minPointsToRedeem`) yet the request could never complete.
//
// 2. `handleCancelBooking` (reservation scope) — the voucher doc, the
//    corporate-code doc and the loyalty-clawback member doc were read
//    AFTER the per-child status write. Cancelling a reservation whose
//    child used a voucher died with a 500, so the voucher's use was
//    never released and the guest's points were never clawed back.
//
// 3. `handleCancelBooking` (single-room scope) — the loyalty-clawback
//    member doc was read AFTER the booking + reservation writes.
//    Cancelling a single booking that had earned loyalty died with a
//    500 and the points were never clawed back.
//
// WHY A SOURCE-TEXT GUARD
// -----------------------
// The pre-existing FOL-03 guard (`fol-03-checkin-checkout-transaction-read-order.test.ts`)
// pins the ordering for check-in + check-out ONLY. These three paths
// were never covered, which is exactly why the bug shipped.
//
// The guard below is GENERAL: it scans every `runTransaction` block in
// the guest server handlers and asserts that no `transaction.get(` /
// `transaction.getAll(` appears after the first write in the same
// block. That is the SDK's rule, applied mechanically, so a future
// "I'll just add one more read" refactor breaks the test instead of
// silently reintroducing a 500.
//
// The one known exception is the `store.ts` status-transition
// handler, whose `out-for-delivery` branch returns before the
// `cancelled` branch's reads. It is asserted explicitly below, with
// the reason, so the exception cannot be widened by accident.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ── The scanner ────────────────────────────────────────────────────
//
// Blank out comments and string literals so a commented-out
// `transaction.get(` is not counted as a real call, and a mention in
// prose is not mistaken for code.
function stripNonCode(text: string): string[] {
  const out: string[] = [];
  let inBlockComment = false;
  for (const line of text.split("\n")) {
    let s = line;
    if (inBlockComment) {
      const close = s.indexOf("*/");
      if (close === -1) {
        out.push("");
        continue;
      }
      s = s.slice(close + 2);
      inBlockComment = false;
    }
    while (s.includes("/*")) {
      const open = s.indexOf("/*");
      const close = s.indexOf("*/", open + 2);
      if (close === -1) {
        s = s.slice(0, open);
        inBlockComment = true;
        break;
      }
      s = s.slice(0, open) + s.slice(close + 2);
    }
    // Blank out string literals and line comments.
    let quote: string | null = null;
    let result = "";
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) {
        result += c;
        if (c === "\\") {
          result += s[i + 1] ?? "";
          i++;
          continue;
        }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        quote = c;
        result += c;
        continue;
      }
      if (c === "/" && s[i + 1] === "/") break;
      result += c;
    }
    out.push(result);
  }
  return out;
}

const WRITE_RE = /transaction\.(?:set|update|create|delete)\s*\(/;
const READ_RE = /transaction\.(?:get|getAll)\s*\(/;

interface Violation {
  file: string;
  transactionLine: number;
  firstWriteLine: number;
  readLine: number;
  readText: string;
  // "direct" — a `transaction.get(` in the transaction body.
  // "helper:<name>" — a helper that reads the transaction, called
  //   from the transaction body AFTER its first write.
  kind: string;
}

// ── The HELPER-aware layer ─────────────────────────────────────────
//
// A read-after-write does not have to be written inline. A helper
// that takes the transaction and reads from it IS a read in its
// caller's sequence — and a helper that calls such a helper (with
// the transaction) is a read too.
//
// The FIRST version of this guard only matched a literal
// `transaction.get(` in the transaction body, so it MISSED the
// reservation-scope cancel's `redateAddOnsForCancel` call: that
// helper resolved the collected amount from the LEDGER (a read)
// inside itself, and the reservation branch called it AFTER the
// per-child status writes. The cancel died with a 500 in production.
//
// This layer resolves the helper graph transitively, so the guard
// sees the read where it actually happens.

// The functions that read from a transaction, resolved transitively.
function findReaders(allSources: Array<{ text: string }>): Set<string> {
  const FN_RE = /(?:^|\s)(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/;

  // name -> its body text
  const bodies = new Map<string, string>();
  for (const src of allSources) {
    const lines = stripNonCode(src.text);
    for (let i = 0; i < lines.length; i++) {
      const m = FN_RE.exec(lines[i]);
      if (!m) continue;
      const name = m[1];
      if (bodies.has(name)) continue;
      let depth = 0;
      let started = false;
      const body: string[] = [];
      for (let k = i; k < lines.length && k < i + 1500; k++) {
        body.push(lines[k]);
        depth += (lines[k].match(/\{/g) || []).length - (lines[k].match(/}/g) || []).length;
        if (lines[k].includes("{")) started = true;
        if (started && depth === 0) break;
      }
      bodies.set(name, body.join("\n"));
    }
  }

  // The argument list of every call to `name` in `txt`.
  const callArgs = (txt: string, name: string): string[] => {
    const out: string[] = [];
    const re = new RegExp(`\\b${name}\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      let buf = "";
      while (i < txt.length) {
        const c = txt[i];
        if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) {
            buf += c;
            break;
          }
        }
        buf += c;
        i++;
      }
      out.push(buf);
    }
    return out;
  };

  const readers = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, body] of bodies) {
      if (readers.has(name)) continue;
      if (READ_RE.test(body)) {
        readers.add(name);
        changed = true;
        continue;
      }
      for (const other of readers) {
        if (other === name) continue;
        for (const args of callArgs(body, other)) {
          if (/\btransaction\b/.test(args)) {
            readers.add(name);
            changed = true;
            break;
          }
        }
        if (readers.has(name)) break;
      }
    }
  }
  return readers;
}

function scanFile(
  absPath: string,
  relName: string,
  readers: Set<string>
): Violation[] {
  const text = readFileSync(absPath, "utf8");
  const lines = stripNonCode(text);
  const violations: Violation[] = [];

  // The argument list of every call to `name` in the block.
  const callArgs = (txt: string, name: string): Array<{ offset: number; args: string }> => {
    const out: Array<{ offset: number; args: string }> = [];
    const re = new RegExp(`\\b${name}\\s*\\(`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(txt)) !== null) {
      let depth = 0;
      let i = m.index + m[0].length - 1;
      let buf = "";
      while (i < txt.length) {
        const c = txt[i];
        if (c === "(") depth++;
        else if (c === ")") {
          depth--;
          if (depth === 0) {
            buf += c;
            break;
          }
        }
        buf += c;
        i++;
      }
      out.push({ offset: m.index, args: buf });
    }
    return out;
  };

  for (let start = 0; start < lines.length; start++) {
    if (!lines[start].includes("runTransaction(async (transaction)")) continue;

    // Find the transaction block's end by brace depth.
    let depth = 0;
    let started = false;
    let end = lines.length - 1;
    for (let i = start; i < lines.length; i++) {
      depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
      if (lines[i].includes("{")) started = true;
      if (started && depth === 0) {
        end = i;
        break;
      }
    }

    let firstWrite = -1;
    for (let i = start; i <= end; i++) {
      if (WRITE_RE.test(lines[i])) {
        firstWrite = i;
        break;
      }
    }
    if (firstWrite === -1) continue;

    for (let i = firstWrite; i <= end; i++) {
      if (!READ_RE.test(lines[i])) continue;
      violations.push({
        file: relName,
        transactionLine: start + 1,
        firstWriteLine: firstWrite + 1,
        readLine: i + 1,
        readText: lines[i].trim().slice(0, 90),
        kind: "direct"
      });
    }

    // A helper that reads the transaction, called after the first
    // write, is a read after a write just the same.
    const bodyText = lines.slice(start, end + 1).join("\n");
    const offsets: number[] = [];
    let acc = 0;
    for (const bl of lines.slice(start, end + 1)) {
      offsets.push(acc);
      acc += bl.length + 1;
    }
    const lineOf = (off: number): number => {
      let lo = 0;
      let hi = offsets.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (offsets[mid] <= off) lo = mid;
        else hi = mid - 1;
      }
      return start + lo + 1;
    };
    const firstWriteOffset = offsets[firstWrite - start];
    for (const name of readers) {
      for (const call of callArgs(bodyText, name)) {
        if (!/\btransaction\b/.test(call.args)) continue;
        if (call.offset <= firstWriteOffset) continue;
        violations.push({
          file: relName,
          transactionLine: start + 1,
          firstWriteLine: firstWrite + 1,
          readLine: lineOf(call.offset),
          readText: `helper ${name}(...)`,
          kind: `helper:${name}`
        });
      }
    }
  }
  return violations;
}

// Walk the guest server handlers.
const HANDLERS_DIR = resolve(__dirname, "../../server/handlers");
function walk(dir: string, base: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) walk(abs, base, acc);
    else if (entry.endsWith(".ts")) acc.push(abs);
  }
  return acc;
}

const files = walk(HANDLERS_DIR, HANDLERS_DIR, []).sort();

// The set of functions that read from a transaction — resolved
// transitively, so a helper that calls a reader (with the
// transaction) counts as a reader too.
const readers = findReaders(
  files.map((abs) => ({ text: readFileSync(abs, "utf8") }))
);

const allViolations: Violation[] = [];
for (const abs of files) {
  const rel = abs.slice(HANDLERS_DIR.length + 1).replace(/\\/g, "/");
  allViolations.push(...scanFile(abs, rel, readers));
}

describe("FOL-03 — no Firestore read after a write in any transaction", () => {
  it("the scanner actually finds the handlers it is meant to scan", () => {
    // A scanner that silently scans nothing would pass every
    // assertion below. Pin that it sees the handlers.
    expect(files.length).toBeGreaterThan(5);
    const names = allViolations.map((v) => v.file);
    expect(files.map((f) => f.slice(HANDLERS_DIR.length + 1).replace(/\\/g, "/"))).toContain(
      "bookings.ts"
    );
    // Sanity: the scanner must be capable of finding a violation.
    // The known-exception file proves it.
    expect(names).toContain("store.ts");
  });

  it("the helper-aware layer resolves the readers it is meant to resolve", () => {
    // A helper layer that silently resolves nothing would let a
    // helper-mediated read-after-write through — which is EXACTLY how
    // the reservation-scope cancel's `redateAddOnsForCancel` bug
    // shipped. Pin that the layer sees the known readers.
    expect(readers.has("readTransactionalFolioSnapshot")).toBe(true);
    expect(readers.has("resolvePaidAmountForLiability")).toBe(true);
    // `redateAddOnsForCancel` used to read the ledger itself. It no
    // longer does — the collected amount is resolved by the caller in
    // the read phase and passed in — so it must NOT be a reader.
    expect(readers.has("redateAddOnsForCancel")).toBe(false);
  });

  it("every read-after-write violation is the ONE documented exception", () => {
    // `store.ts`'s status-transition handler writes the order for the
    // `out-for-delivery` branch and RETURNS; the `cancelled` branch
    // then reads the store items BEFORE its own first write. The two
    // branches are mutually exclusive, so the SDK never sees a read
    // after a write.
    const unexpected = allViolations.filter((v) => v.file !== "store.ts");
    const details = unexpected
      .map((v) => `  ${v.file}:${v.readLine} (txn@${v.transactionLine}, first write@${v.firstWriteLine}) [${v.kind}] ${v.readText}`)
      .join("\n");
    expect(
      unexpected,
      `Read-after-write violations found (the Firestore SDK will throw on these, so the request 500s):\n${details}`
    ).toEqual([]);
  });

  it("the store.ts exception is still exactly one branch (it cannot widen)", () => {
    const storeViolations = allViolations.filter((v) => v.file === "store.ts");
    expect(storeViolations.length).toBe(1);
    expect(storeViolations[0].readLine).toBeGreaterThan(storeViolations[0].firstWriteLine);
  });
});

describe("FOL-03 — the create path's points redemption reads before any write", () => {
  const bookingsSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/bookings.ts"),
    "utf8"
  );
  const lines = stripNonCode(bookingsSrc);

  it("the rewardsConfig read is hoisted ABOVE the first write in the create transaction", () => {
    // The redemption's two reads must be in the READ phase. The
    // counter write is the first write in the create transaction, so
    // the read must come before it.
    const readIdx = lines.findIndex((l) =>
      l.includes('adminDb.collection("settings").doc("rewardsConfig")')
    );
    expect(readIdx, "the rewardsConfig read must exist").toBeGreaterThan(-1);

    // The first write of the create transaction is the daily counter.
    const counterWriteIdx = lines.findIndex(
      (l, i) => i > 3000 && i < 4000 && l.includes("transaction.update(counterRef")
    );
    expect(counterWriteIdx, "the counter write must exist").toBeGreaterThan(-1);
    expect(
      readIdx,
      "the rewardsConfig read must come before the counter write (FOL-03)"
    ).toBeLessThan(counterWriteIdx);
  });

  it("the redemption block consumes the pre-read documents instead of reading again", () => {
    // The in-place `transaction.get(selfRcRef)` / `transaction.get(selfMemberRef)`
    // are gone from the REDEMPTION block — those are the reads that
    // caused the 500. The hoisted read phase still issues exactly
    // ONE read of each, so the total count must be 1, not 2.
    const selfRcGets = bookingsSrc.match(
      /const selfRcSnap\s*=\s*await transaction\.get\(selfRcRef\)/g
    ) || [];
    const selfMemberGets = bookingsSrc.match(
      /selfMemberDoc\s*=\s*await transaction\.get\(selfMemberRef\)/g
    ) || [];
    expect(
      selfRcGets.length,
      "the rewardsConfig doc must be read exactly once (in the read phase)"
    ).toBe(1);
    expect(
      selfMemberGets.length,
      "the member doc must be read exactly once (in the read phase)"
    ).toBe(1);

    // The redemption block itself must contain NO read at all — it is
    // in the write phase, and a read there is the 500.
    const redemptionStart = bookingsSrc.indexOf("if (pointsToRedeem > 0) {");
    expect(redemptionStart, "the redemption block must exist").toBeGreaterThan(-1);
    const redemptionEnd = bookingsSrc.indexOf("\n      }\n", redemptionStart);
    const redemptionBlock = bookingsSrc.slice(redemptionStart, redemptionEnd);
    expect(
      redemptionBlock,
      "the redemption block is in the write phase and must not read"
    ).not.toMatch(/await transaction\.get\(/);

    // The validation still runs, so the guest-facing messages are unchanged.
    expect(bookingsSrc).toMatch(/Self-service points redemption is not enabled/);
    expect(bookingsSrc).toMatch(/Member account is not active/);
  });
});

describe("FOL-03 — the cancel paths release the voucher and claw back loyalty", () => {
  const bookingsSrc = readFileSync(
    resolve(__dirname, "../../server/handlers/bookings.ts"),
    "utf8"
  );

  it("the reservation-scope cancel reads the voucher + corporate docs before the child write", () => {
    // The voucher / corporate-code documents are read into maps in the
    // read phase, and the write phase consumes the maps.
    expect(bookingsSrc).toMatch(
      /const voucherDocs = new Map<string, any>\(\);[\s\S]*?for \(const code of voucherCounts\.keys\(\)\) \{[\s\S]*?voucherDocs\.set\(code, await transaction\.get\(/
    );
    expect(bookingsSrc).toMatch(
      /const corporateDocs = new Map<string, any>\(\);[\s\S]*?corporateDocs\.set\(code, await transaction\.get\(/
    );
    // The write phase no longer reads.
    expect(bookingsSrc).toMatch(
      /for \(const \[code, count\] of voucherCounts\.entries\(\)\) \{[\s\S]*?const vDoc = voucherDocs\.get\(code\);/
    );
  });

  it("the single-room cancel reads the clawback member before any write", () => {
    expect(bookingsSrc).toMatch(
      /const clawbackMemberSnapshot =\s*\n?\s*memberIdForClawbackRead[\s\S]*?await transaction\.get\(/
    );
    expect(bookingsSrc).toMatch(/const clawbackMemberDoc = clawbackMemberSnapshot;/);
  });

  it("the cancel paths still RELEASE the voucher and corporate-code uses", () => {
    // The point of the fix is not to stop releasing — the release is
    // the behaviour that was silently missing whenever the cancel
    // 500'd. Pin that the release is still there, with the same
    // floor-at-zero arithmetic.
    expect(bookingsSrc).toMatch(
      /usageCount: Math\.max\(\(Number\(vData\.usageCount\) \|\| 0\) - count, 0\)/
    );
    expect(bookingsSrc).toMatch(
      /usageCount: Math\.max\(\(Number\(cpData\.usageCount\) \|\| 0\) - count, 0\)/
    );
  });
});
