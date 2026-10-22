// F09 / SEC-6 (2026-10-22, P2 revenue leak): emulator-based rules
// test for the `settings` collection.
//
// THE DEFECT: `firebase/firestore.rules` had
//
//     match /settings/{documentId} {
//       allow read: if true;
//       allow write: if isAdmin();
//     }
//
// so EVERY document under `settings/` was world-readable from an
// unauthenticated browser. That includes `settings/hotelConfig` —
// which carries the hotel's NEGOTIATED corporate rate ladder
// (`roomTypes[].corporateRate`) and the bank details of the payment
// methods (the `accountNumber` of a method the admin hid from the
// corporate surface with `showInCorporate: false`) — plus
// `settings/rooms`.
//
// THE FIX: the collection is staff-read / admin-write, and the guest
// site reads the hotel's PUBLIC content through the public projection
// served by `GET /api/public/hotel-config`. The marketing /
// published-content documents the guest site reads directly
// (`websiteContent`, `breakfastConfig`, `rewardsConfig`, `seo`) stay
// publicly readable — but they are listed EXPLICITLY now, so a new
// `settings/*` document is staff-only by default.
//
// HOW TO RUN — needs the Firestore emulator (Java), so it is NOT part
// of the default `npm test`. From the repo root:
//     npm run test:rules

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";

const PROJECT_ID = "spark-inn-rules-test";
const STAFF_UID = "staff-alice";

let testEnv: RulesTestEnvironment;

const staffCtx = (uid = STAFF_UID) => testEnv.authenticatedContext(uid, { role: "front-desk" });
const adminCtx = (uid = STAFF_UID) => testEnv.authenticatedContext(uid, { role: "admin" });
const guestCtx = (uid = "guest-1") => testEnv.authenticatedContext(uid, { role: "guest" });
const anonCtx = () => testEnv.unauthenticatedContext();

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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    // A hotel config that carries the two secrets the defect exposed:
    // the negotiated corporate rate ladder and the bank details of a
    // payment method the admin hid from the corporate surface.
    await setDoc(doc(ctx.firestore(), "settings/hotelConfig"), {
      brandName: "Spark Inn",
      address: "Panglao, Bohol",
      frontDeskPhone: "+63 900 000 0000",
      roomTypes: [
        { value: "single", label: "Single", pricePerNight: 1800, corporateRate: 1600 },
        { value: "standard-double", label: "Standard Double", pricePerNight: 2400, corporateRate: 2200 }
      ],
      paymentMethods: [
        { method: "gcash", label: "GCash", accountNumber: "0917-000-0000", showInCorporate: true },
        { method: "paypal", label: "PayPal", accountNumber: "SECRET-8811", showInCorporate: false }
      ]
    });
    await setDoc(doc(ctx.firestore(), "settings/rooms"), {
      types: ["single", "standard-double"]
    });
    await setDoc(doc(ctx.firestore(), "settings/websiteContent"), {
      homepage: { heroHeading: "Spark Inn" }
    });
    await setDoc(doc(ctx.firestore(), "settings/breakfastConfig"), { isEnabled: true });
    await setDoc(doc(ctx.firestore(), "settings/rewardsConfig"), { welcomePoints: 100 });
    await setDoc(doc(ctx.firestore(), "settings/seo"), { published: { title: "Spark Inn" } });
    await setDoc(doc(ctx.firestore(), "settings/storeConfig"), {
      isEnabled: true,
      lowStockThreshold: 3
    });
  });
});

describe("F09 / SEC-6 — the settings collection is no longer world-readable", () => {
  it("an UNAUTHENTICATED read of settings/hotelConfig is PERMISSION_DENIED", async () => {
    // The core regression: this read used to succeed and handed the
    // corporate rate ladder + the payment methods' account numbers to
    // any anonymous caller.
    await assertFails(getDoc(doc(anonCtx().firestore(), "settings/hotelConfig")));
  });

  it("an UNAUTHENTICATED read of settings/rooms is PERMISSION_DENIED", async () => {
    await assertFails(getDoc(doc(anonCtx().firestore(), "settings/rooms")));
  });

  it("an UNAUTHENTICATED read of settings/storeConfig is PERMISSION_DENIED", async () => {
    // The store config carries the admin-only `lowStockThreshold` and
    // the legacy store payment methods.
    await assertFails(getDoc(doc(anonCtx().firestore(), "settings/storeConfig")));
  });

  it("an authenticated NON-staff read of settings/hotelConfig is PERMISSION_DENIED", async () => {
    await assertFails(getDoc(doc(guestCtx().firestore(), "settings/hotelConfig")));
  });

  it("a COLLECTION query over settings by an unauthenticated client is denied", async () => {
    // A collection read must not be able to smuggle the documents out
    // either.
    const { collection, getDocs } = await import("firebase/firestore");
    await assertFails(getDocs(collection(anonCtx().firestore(), "settings")));
  });

  it("STAFF can read settings/hotelConfig (the admin app's rate calendar)", async () => {
    await assertSucceeds(getDoc(doc(staffCtx().firestore(), "settings/hotelConfig")));
  });

  it("STAFF can read settings/rooms", async () => {
    await assertSucceeds(getDoc(doc(staffCtx().firestore(), "settings/rooms")));
  });

  it("STAFF can read settings/storeConfig", async () => {
    await assertSucceeds(getDoc(doc(staffCtx().firestore(), "settings/storeConfig")));
  });

  it("an ADMIN can write settings/hotelConfig", async () => {
    await assertSucceeds(
      setDoc(doc(adminCtx().firestore(), "settings/hotelConfig"), {
        brandName: "Spark Inn",
        roomTypes: [{ value: "single", corporateRate: 1650 }]
      })
    );
  });

  it("a STAFF member cannot write settings/hotelConfig", async () => {
    await assertFails(
      setDoc(doc(staffCtx().firestore(), "settings/hotelConfig"), { brandName: "Nope" })
    );
  });
});

describe("F09 / SEC-6 — the guest-legitimate settings documents stay readable", () => {
  // The guest site still reads these marketing / published-content
  // documents directly from Firestore. They hold page copy, the
  // published SEO card, the rewards tiers and the breakfast menu —
  // no negotiated pricing, no bank detail, no PII.
  it("websiteContent is anonymously readable", async () => {
    await assertSucceeds(getDoc(doc(anonCtx().firestore(), "settings/websiteContent")));
  });

  it("breakfastConfig is anonymously readable", async () => {
    await assertSucceeds(getDoc(doc(anonCtx().firestore(), "settings/breakfastConfig")));
  });

  it("rewardsConfig is anonymously readable", async () => {
    await assertSucceeds(getDoc(doc(anonCtx().firestore(), "settings/rewardsConfig")));
  });

  it("seo is anonymously readable", async () => {
    await assertSucceeds(getDoc(doc(anonCtx().firestore(), "settings/seo")));
  });
});
