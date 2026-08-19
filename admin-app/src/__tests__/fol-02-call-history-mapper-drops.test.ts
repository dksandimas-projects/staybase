import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for the FOL-02 (2026-08-07) mapper-hydration
// contract on the `IntercomMessage` snapshot mapper, scoped to the
// four call-history fields. The pre-#214 surface silently dropped
// `messageType`, `callStartedAt`, and `callDuration` (the
// call-history-messages write path emitted them but the read path
// stripped them, so the chat panel couldn't render the centered
// "Call answered" footer row). Decision #214 (2026-08-19) closed
// the three drops alongside adding the new `callAnsweredByName`
// field. This file pins the contract at the source level per the
// FOL-02 pattern in `plan/docs/GOTCHAS.md` line 30 — a future
// refactor that drops any of the four fields breaks the test
// instead of silently regressing.
//
// Per the FOL-02 audit pattern, each contract field gets its own
// per-field test that pins the exact normalization shape. The
// `callAnsweredByName` pin is in `call-staff-claim-transaction.test.ts`
// (the field was added in #214, not by the FOL-02 audit) — both
// test files cover the same mapper, but the per-field test pattern
// means a regression in any one field breaks exactly one test.
//
// The `IntercomChatPanel` renderer is verified to USE the
// `messageType` field (line 182: `if (msg.sender === "system" &&
// msg.messageType)`) — so the mapper hydration is the gate that
// makes the centered footer-row render work. `callStartedAt` and
// `callDuration` are also emitted by the write path
// (`recordCallHistory` at `AdminContext.tsx:3547-3559`) and pinned
// here for the round-trip byte-equivalence.

const adminSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);

describe("AdminContext.tsx — FOL-02 mapper-hydration closure on the IntercomMessage snapshot (decision #214, 2026-08-19)", () => {
  // Anchor the slice to the intercom messages snapshot mapper so
  // a future refactor that moves the mapper body doesn't break
  // the test for the wrong reason. The mapper is the .map() inside
  // the intercoms/{room}/messages listener.
  const mapperStart = adminSrc.indexOf("const messages: IntercomMessage[] = snapshot.docs.map");
  const mapperEnd = adminSrc.indexOf("});", mapperStart);
  const mapperBody = adminSrc.slice(mapperStart, mapperEnd);

  describe("FOL-02 per-field hydration pins (one test per contract field)", () => {
    it("hydrates `messageType` from the snapshot (drives the chat panel's centered footer-row render)", () => {
      // The renderer at `IntercomChatPanel.tsx:182` reads
      // `msg.messageType` to decide between the Phone /
      // PhoneMissed / PhoneOff icon + the muted-italic centered
      // row. Without this hydration the structured render is
      // dormant and every system message falls through to the
      // unstyled text body.
      expect(mapperBody).toMatch(/messageType:\s*data\.messageType\s*\|\|\s*undefined/);
    });

    it("hydrates `callStartedAt` as an ISO string when the Firestore Timestamp is present", () => {
      // `recordCallHistory` writes `callStartedAt` as a
      // `Timestamp.fromMillis(startedAtMs)` on `call-answered`
      // messages. The mapper must convert it to an ISO string
      // (the same shape the `IntercomMessage` type declares) so
      // the round-trip is byte-equivalent.
      expect(mapperBody).toMatch(
        /callStartedAt:\s*data\.callStartedAt\?\.toMillis\s*\n?\s*\?\s*new\s+Date\(data\.callStartedAt\.toMillis\(\)\)\.toISOString\(\)\s*\n?\s*:\s*undefined/
      );
    });

    it("hydrates `callDuration` as a number, defensively guarded against non-numeric values", () => {
      // The field is declared as `number | undefined` on the
      // `IntercomMessage` type. The `typeof === "number"` guard
      // is the FOL-02 defensive-coercion pattern (same shape as
      // the `paymentRejectionReason` + `onsitePayments` pins in
      // the bookings-mapper FOL-02 fix): a non-numeric value (a
      // string from a legacy doc, a null from a write that
      // skipped the field) maps to `undefined` instead of
      // polluting the type with the raw value.
      expect(mapperBody).toMatch(/callDuration:\s*typeof data\.callDuration === ["']number["']\s*\?\s*data\.callDuration\s*:\s*undefined/);
    });

    it("hydrates `callAnsweredByName` (decision #214's new field, pinned here for the FOL-02 round-trip contract)", () => {
      // The FOL-02 audit pattern requires a per-field test for
      // EVERY contract field the mapper hydrates — including the
      // #214 new field, so a future FOL-02 audit pass that
      // re-enumerates the contract has a single source of truth
      // for which fields are pinned.
      expect(mapperBody).toMatch(
        /callAnsweredByName:\s*typeof data\.callAnsweredByName === ["']string["']\s*\n?\s*\?\s*data\.callAnsweredByName\s*\n?\s*:\s*null/
      );
    });
  });

  describe("FOL-02 mapper has no other IntercomMessage contract fields dropped on read", () => {
    // The FOL-02 audit pattern (GOTCHAS line 30): "enumerate
    // every field the `IntercomMessage` contract guarantees in
    // the mapping body". The per-field tests above pin the four
    // call-history fields. This test pins the remaining
    // non-call-history fields the type declares, so a future
    // contract addition that forgets a mapper hydration breaks
    // a test (the FOL-02 contract enforcement loop is closed).
    it("hydrates the canonical IntercomMessage fields (id, text, sender, guestName, timestamp, isRead)", () => {
      // These are the always-on fields every message carries.
      // The mapper is well-known to read them — this test is
      // here to prevent a future refactor that drops them
      // (a "the mapper is broken on the obvious fields" guard).
      expect(mapperBody).toMatch(/id:\s*docSnap\.id/);
      expect(mapperBody).toMatch(/text:\s*data\.text\s*\|\|\s*["']["']/);
      expect(mapperBody).toMatch(/sender:\s*data\.sender\s*\|\|\s*["']guest["']/);
      expect(mapperBody).toMatch(/guestName:\s*data\.guestName\s*\|\|\s*["']["']/);
      expect(mapperBody).toMatch(/timestamp:\s*formatIntercomTimestamp/);
      expect(mapperBody).toMatch(/isRead:\s*!!data\.isRead/);
    });

    it("hydrates the optional IntercomMessage fields (isQuickRequest, isStoreOrder, orderRef, isEarlyCheckInRequest, currentStayId)", () => {
      // The boolean fields use the `!!` defensive coercion
      // pattern; the string fields use `|| undefined` for the
      // "absent maps to undefined" contract. Both shapes are
      // pinned here so a future refactor that drops one of the
      // `|| undefined` guards (which would change a `string` to
      // `string | null` on the contract side) breaks the test
      // instead of silently regressing the consumers.
      expect(mapperBody).toMatch(/isQuickRequest:\s*!!data\.isQuickRequest/);
      expect(mapperBody).toMatch(/isStoreOrder:\s*!!data\.isStoreOrder/);
      expect(mapperBody).toMatch(/orderRef:\s*data\.orderRef\s*\|\|\s*undefined/);
      expect(mapperBody).toMatch(/isEarlyCheckInRequest:\s*!!data\.isEarlyCheckInRequest/);
      expect(mapperBody).toMatch(/currentStayId:\s*data\.currentStayId\s*\|\|\s*undefined/);
    });
  });
});
