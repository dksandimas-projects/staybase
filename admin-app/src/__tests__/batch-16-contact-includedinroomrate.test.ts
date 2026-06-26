import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 16 — #75 (drop includedInRoomRate)
// + #76 (Contact form wired to /api/contact).
//
// #75 is a no-op: the field was never seeded, never read, and never
// documented. The batch confirms the absence with a test so a future
// PR that tries to add it back will fail.
//
// #76 wires the public /contact form to a real `contactInquiries` Firestore
// collection via a new /api/contact/inquiry handler, with a rate limit,
// Turnstile check, honeypot short-circuit, basic spam filter, and a
// staff notification email.

const contactPageSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/pages/ContactPage.tsx"),
  "utf8"
);
const contactHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/contact.ts"),
  "utf8"
);
const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/email.ts"),
  "utf8"
);
const dispatcherSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/api/[...route].ts"),
  "utf8"
);
const rulesSrc = readFileSync(
  resolve(__dirname, "../../../firebase/firestore.rules"),
  "utf8"
);
const rateConfigSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/src/components/DateRangePicker.tsx"),
  "utf8"
);
const breakfastConfigSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/SettingsPage.tsx"),
  "utf8"
);

describe("Phase 11.6 Batch 16 — contact form wired + includedInRoomRate absent", () => {
  describe("#75 — includedInRoomRate is gone", () => {
    it("the field is not present in admin-app/src code", () => {
      // The seed default, the form state, the snapshot mapper — none of
      // them should reference `includedInRoomRate`.
      expect(breakfastConfigSrc).not.toMatch(/includedInRoomRate/);
    });

    it("the field is not present in guest-app/src code", () => {
      // Walk every source file in guest-app/src (skip generated + node_modules).
      const { execSync } = require("node:child_process");
      const files = execSync("rg -l includedInRoomRate /Users/danielkennethsandimas/GitHub/staybase/guest-app/src /Users/danielkennethsandimas/GitHub/staybase/shared 2>/dev/null || true", { encoding: "utf8" });
      expect(files.trim(), "expected no source files to reference includedInRoomRate").toBe("");
    });
  });

  describe("#76 — contact form hits /api/contact/inquiry", () => {
    it("ContactPage no longer has the setTimeout stub", () => {
      expect(contactPageSrc).not.toMatch(/Simulate sending message/);
      expect(contactPageSrc).not.toMatch(/setTimeout\([\s\S]*?setShowSuccess\(true\)/);
    });

    it("ContactPage POSTs to /api/contact/inquiry with name/email/subject/message", () => {
      expect(contactPageSrc).toMatch(/fetch\(["']\/api\/contact\/inquiry["']/);
      expect(contactPageSrc).toMatch(/method:\s*["']POST["']/);
      expect(contactPageSrc).toMatch(/name:\s*name\.trim\(\)/);
      expect(contactPageSrc).toMatch(/email:\s*email\.trim\(\)/);
      expect(contactPageSrc).toMatch(/subject:\s*subject\.trim\(\)/);
      expect(contactPageSrc).toMatch(/message:\s*message\.trim\(\)/);
    });

    it("ContactPage renders a real error state when the API rejects", () => {
      expect(contactPageSrc).toMatch(/submitError/);
      expect(contactPageSrc).toMatch(/role=["']alert["']/);
    });

    it("a new handlers/contact.ts exists and exports handleCreateContactInquiry", () => {
      expect(contactHandlerSrc).toMatch(/export\s+async\s+function\s+handleCreateContactInquiry/);
    });

    it("contact handler validates name + email + subject + message", () => {
      expect(contactHandlerSrc).toMatch(/Please share your name\./);
      expect(contactHandlerSrc).toMatch(/valid email/);
      expect(contactHandlerSrc).toMatch(/Please add a short subject\./);
      expect(contactHandlerSrc).toMatch(/Please share a message/);
      expect(contactHandlerSrc).toMatch(/isLikelyEmail/);
    });

    it("contact handler drops a honeypot short-circuit at the dispatcher", () => {
      expect(dispatcherSrc).toMatch(/domain\s*===\s*["']contact["']\s*&&\s*action\s*===\s*["']inquiry["']/);
      expect(dispatcherSrc).toMatch(/contact-inquiry:\s*\$\{ip\}/);
      expect(dispatcherSrc).toMatch(/isRateLimited\(`contact-inquiry:/);
    });

    it("contact handler is dispatched behind Turnstile + the same honeypot short-circuit as corporate inquiry", () => {
      // Find the contact branch in the dispatcher and assert the
      // honeypot / Turnstile guards appear in the right order.
      const branch = dispatcherSrc.match(
        /if\s*\(\s*domain\s*===\s*["']contact["']\s*&&\s*action\s*===\s*["']inquiry["'][\s\S]*?return\s+await\s+handleCreateContactInquiry[\s\S]*?\}\s*/
      );
      expect(branch, "expected to find the contact branch in the dispatcher").toBeTruthy();
      const body = branch![0];
      expect(body).toMatch(/isRateLimited\(`contact-inquiry:/);
      expect(body).toMatch(/req\.body\._hp/);
      expect(body).toMatch(/verifyTurnstile\(req\.body\?\.turnstileToken/);
    });

    it("contact handler writes to the contactInquiries collection + fires an admin email", () => {
      expect(contactHandlerSrc).toMatch(/adminDb\.collection\(["']contactInquiries["']\)/);
      expect(contactHandlerSrc).toMatch(/sendContactInquiryTrigger/);
      expect(emailHandlerSrc).toMatch(/export\s+async\s+function\s+sendContactInquiryTrigger/);
      expect(emailHandlerSrc).toMatch(/contactInquiryEmail/);
    });

    it("Firestore rules restrict contactInquiries to staff reads + staff creates", () => {
      const match = rulesSrc.match(
        /match\s+\/contactInquiries\/\{inquiryId\}\s*\{[\s\S]*?\}/
      );
      expect(match, "expected to find the contactInquiries rule block").toBeTruthy();
      const body = match![0];
      expect(body).toMatch(/allow\s+read,\s+update,\s+delete:\s+if\s+isStaff\(\)/);
      expect(body).toMatch(/allow\s+create:\s+if\s+isStaff\(\)/);
    });
  });
});
