// F01 (2026-10-22, Spark Inn P5 production QA) — the pricing
// collections (`vouchers` + `corporateCodes`) must not be writable by
// a FRONT-DESK account.
//
// BACKGROUND
// ----------
// `firebase/firestore.rules` shipped `allow write: if isStaff()` on
// BOTH collections, where `isStaff()` is "role in
// [front-desk, admin]". The admin app gates the Rates page to admins
// only (`admin-app/src/components/AdminLayout.tsx` —
// `restrictedPaths = ["/rates", "/members", "/settings"]`, per
// `plan/features/AUTH-ROLES.md` §Roles), but that gate is COSMETIC:
// every one of those writes happens CLIENT-side from the admin app's
// Firestore SDK (`admin-app/src/context/AdminContext.tsx`), so a
// front-desk account could call the SDK directly and
//
//   - create / reprice a voucher (arbitrary discount), or
//   - reprice / deactivate a corporate code (arbitrary negotiated
//     nightly rate — `ratePerRoomType` IS what `/corporate/book`
//     charges).
//
// Both are direct revenue loss.
//
// WHAT IS PINNED HERE
// -------------------
//   1. `vouchers` write → ADMIN only (create, reprice, deactivate,
//      delete).
//   2. `corporateCodes` CREATE stays staff-wide, because the desk's
//      documented job is to negotiate a rate and issue the code
//      (`plan/features/CORPORATE-INQUIRIES.md` §Generate Access
//      Code). UPDATE (reprice / deactivate) and DELETE are admin
//      only.
//   3. The desk's Generate Access Code flow STILL WORKS end to end:
//      create `corporateCodes/{code}` (inside a transaction, exactly
//      as `AdminContext.addCorporateCode` does) and then update
//      `corporateInquiries/{id}.accessCodeId`.
//   4. The PR-AUDIT-B2 member-scoped voucher READ is untouched —
//      this file must not silently re-break the Spark Rewards
//      portal's free-night voucher list.
//   5. `corporateInquiries` DELETE is admin-only (F01-CORP): nothing
//      in the codebase deletes an inquiry through a rules-governed
//      write, so the grant was unused destructive surface.
//
// The rule file is loaded into the emulator, so a rule that is
// present-but-wrong fails here even when every source-text test
// passes.
//
// HOW TO RUN — needs the Firestore emulator (Java), so it is NOT part
// of the default `npm run test:fast`. From the repo root:
//
//     npm run test:rules
//
// See `plan/docs/CONTRIBUTING.md §Testing` for the test-layer
// overview and the `*.emulator.test.ts` convention.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const STAFF_UID = "staff-alice";
const ADMIN_UID = "admin-bob";
const MEMBER_UID = "member-maria";

let testEnv: RulesTestEnvironment;

// `isStaff()` / `isAdmin()` read `request.auth.token.role`, so the
// contexts only need the right custom claim — no `guests` doc seeding.
const staffCtx = (uid = STAFF_UID) =>
  testEnv.authenticatedContext(uid, { role: "front-desk" });
const adminCtx = (uid = ADMIN_UID) =>
  testEnv.authenticatedContext(uid, { role: "admin" });
const memberCtx = (uid = MEMBER_UID) =>
  testEnv.authenticatedContext(uid, { role: "guest" });

const VOUCHER_ID = "SUMMER-10";
const CORP_CODE = "ACME100";
const INQUIRY_ID = "inq-acme-1";

// The exact payload `AdminContext.addVoucher` writes (the Rates
// page). `expiresAt` reaches the client as an ISO string, so the
// fixture mirrors that rather than a Timestamp.
const voucherPayload = {
  code: VOUCHER_ID,
  discountType: "flat",
  discountValue: 100,
  usageCap: 100,
  expiresAt: "2027-12-31",
  applicableRoomTypes: [],
  guestEmail: "",
  isActive: true,
};

// The exact payload `AdminContext.addCorporateCode` writes from the
// Corporate Inquiries page ("Generate Access Code").
const corporateCodePayload = {
  companyName: "Acme Corp",
  ratePerRoomType: { deluxe: 4500 },
  expiresAt: "2027-12-31",
  usageCap: null,
  usageCount: 0,
  linkedInquiryId: INQUIRY_ID,
  createdBy: STAFF_UID,
  isActive: true,
};

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(resolve(__dirname, "../firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// ── vouchers ──────────────────────────────────────────────────────────

describe("F01-VOU — a front-desk account cannot write vouchers", () => {
  it("front-desk CANNOT create a voucher (it was `isStaff()` before the fix)", async () => {
    await assertFails(
      setDoc(doc(staffCtx().firestore(), "vouchers", "DESK-MINTED"), {
        ...voucherPayload,
        code: "DESK-MINTED",
        usageCount: 0,
        createdBy: STAFF_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("front-desk CANNOT mint a voucher through the transaction path `addVoucher` uses", async () => {
    // `AdminContext.addVoucher` writes inside a `runTransaction`
    // (get → set). The transaction must fail the same way a plain
    // `setDoc` does — the rule is evaluated per write, not per
    // call shape.
    const db = staffCtx().firestore();
    const ref = doc(db, "vouchers", "DESK-MINTED-TXN");
    await assertFails(
      runTransaction(db, async (transaction) => {
        const existing = await transaction.get(ref);
        if (existing.exists()) throw new Error("duplicate");
        transaction.set(ref, {
          ...voucherPayload,
          code: "DESK-MINTED-TXN",
          usageCount: 0,
          createdBy: STAFF_UID,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      })
    );
  });

  it("front-desk CANNOT reprice an existing voucher", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "vouchers", VOUCHER_ID), voucherPayload);
    });
    // The discount value IS the money — this is the revenue hole.
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "vouchers", VOUCHER_ID), {
        discountValue: 99999,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("front-desk CANNOT deactivate an existing voucher", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "vouchers", VOUCHER_ID), voucherPayload);
    });
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "vouchers", VOUCHER_ID), {
        isActive: false,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("front-desk CANNOT delete a voucher", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "vouchers", VOUCHER_ID), voucherPayload);
    });
    await assertFails(deleteDoc(doc(staffCtx().firestore(), "vouchers", VOUCHER_ID)));
  });

  it("an admin CAN still create, reprice, deactivate and delete a voucher", async () => {
    const db = adminCtx().firestore();
    await assertSucceeds(
      setDoc(doc(db, "vouchers", VOUCHER_ID), {
        ...voucherPayload,
        usageCount: 0,
        createdBy: ADMIN_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(doc(db, "vouchers", VOUCHER_ID), {
        discountValue: 250,
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(doc(db, "vouchers", VOUCHER_ID), {
        isActive: false,
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(deleteDoc(doc(db, "vouchers", VOUCHER_ID)));
  });

  it("REGRESSION — the Spark Rewards member can still READ their own reward voucher (PR-AUDIT-B2)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "vouchers", "reward-maria"), {
        kind: "reward",
        memberId: MEMBER_UID,
        code: "FREE-NIGHT-MARIA",
        valueType: "free-night",
        discountValue: 0,
        usageCount: 0,
        usageCap: 1,
        isActive: true,
      });
    });
    await assertSucceeds(getDoc(doc(memberCtx().firestore(), "vouchers", "reward-maria")));
  });

  it("REGRESSION — a member CANNOT write a voucher", async () => {
    await assertFails(
      setDoc(doc(memberCtx().firestore(), "vouchers", "MEMBER-MINTED"), {
        ...voucherPayload,
        code: "MEMBER-MINTED",
        usageCount: 0,
        createdBy: MEMBER_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("REGRESSION — front-desk can still READ vouchers (the desk prices bookings with them)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "vouchers", VOUCHER_ID), voucherPayload);
    });
    await assertSucceeds(getDoc(doc(staffCtx().firestore(), "vouchers", VOUCHER_ID)));
  });
});

// ── corporateCodes ─────────────────────────────────────────────────────

describe("F01-CORP — a front-desk account can ISSUE a corporate code but cannot REPRICE one", () => {
  it("front-desk CAN still create a corporate code (the documented Generate Access Code flow)", async () => {
    // `AdminContext.addCorporateCode` writes inside a
    // `runTransaction` (get → set). This is the exact client shape.
    const db = staffCtx().firestore();
    const ref = doc(db, "corporateCodes", CORP_CODE);
    await assertSucceeds(
      runTransaction(db, async (transaction) => {
        const existing = await transaction.get(ref);
        if (existing.exists()) throw new Error("duplicate");
        transaction.set(ref, {
          ...corporateCodePayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      })
    );
    const snapshot = await getDoc(ref);
    expect(snapshot.exists()).toBe(true);
  });

  it("REGRESSION — front-desk can still link the code back to the inquiry (accessCodeId)", async () => {
    // The second half of the Generate Access Code flow:
    // `CorporateInquiriesPage.tsx` updates
    // `corporateInquiries/{id}.accessCodeId` after issuing the code.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "corporateInquiries", INQUIRY_ID), {
        companyName: "Acme Corp",
        status: "negotiating",
      });
    });
    await assertSucceeds(
      updateDoc(doc(staffCtx().firestore(), "corporateInquiries", INQUIRY_ID), {
        accessCodeId: CORP_CODE,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("front-desk CANNOT reprice an existing corporate code", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "corporateCodes", CORP_CODE), corporateCodePayload);
    });
    // `ratePerRoomType` IS the negotiated nightly rate.
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "corporateCodes", CORP_CODE), {
        ratePerRoomType: { deluxe: 1 },
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("front-desk CANNOT raise the usage cap of an existing corporate code", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "corporateCodes", CORP_CODE), corporateCodePayload);
    });
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "corporateCodes", CORP_CODE), {
        usageCap: 99999,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("front-desk CANNOT deactivate an existing corporate code", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "corporateCodes", CORP_CODE), corporateCodePayload);
    });
    // The `toggleCorporateCodeActive` path: `updateDoc(..., { isActive })`.
    await assertFails(
      updateDoc(doc(staffCtx().firestore(), "corporateCodes", CORP_CODE), {
        isActive: false,
        updatedAt: serverTimestamp(),
      })
    );
  });

  it("front-desk CANNOT delete a corporate code", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "corporateCodes", CORP_CODE), corporateCodePayload);
    });
    await assertFails(deleteDoc(doc(staffCtx().firestore(), "corporateCodes", CORP_CODE)));
  });

  it("an admin CAN still create, reprice, deactivate and delete a corporate code", async () => {
    const db = adminCtx().firestore();
    await assertSucceeds(
      setDoc(doc(db, "corporateCodes", CORP_CODE), {
        ...corporateCodePayload,
        createdBy: ADMIN_UID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(doc(db, "corporateCodes", CORP_CODE), {
        ratePerRoomType: { deluxe: 5000 },
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(
      updateDoc(doc(db, "corporateCodes", CORP_CODE), {
        isActive: false,
        updatedAt: serverTimestamp(),
      })
    );
    await assertSucceeds(deleteDoc(doc(db, "corporateCodes", CORP_CODE)));
  });

  it("REGRESSION — front-desk can still READ corporate codes", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "corporateCodes", CORP_CODE), corporateCodePayload);
    });
    await assertSucceeds(getDoc(doc(staffCtx().firestore(), "corporateCodes", CORP_CODE)));
  });
});

// ── corporateInquiries ─────────────────────────────────────────────────

describe("F01-CORP — deleting a corporate inquiry is admin-only", () => {
  it("front-desk CANNOT delete a corporate inquiry", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "corporateInquiries", INQUIRY_ID), {
        companyName: "Acme Corp",
        status: "negotiating",
      });
    });
    await assertFails(deleteDoc(doc(staffCtx().firestore(), "corporateInquiries", INQUIRY_ID)));
  });

  it("an admin CAN delete a corporate inquiry", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "corporateInquiries", INQUIRY_ID), {
        companyName: "Acme Corp",
        status: "negotiating",
      });
    });
    await assertSucceeds(deleteDoc(doc(adminCtx().firestore(), "corporateInquiries", INQUIRY_ID)));
  });

  it("REGRESSION — front-desk can still update an inquiry (stage + notes)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "corporateInquiries", INQUIRY_ID), {
        companyName: "Acme Corp",
        status: "new",
      });
    });
    await assertSucceeds(
      updateDoc(doc(staffCtx().firestore(), "corporateInquiries", INQUIRY_ID), {
        status: "negotiating",
        updatedAt: serverTimestamp(),
      })
    );
  });
});
