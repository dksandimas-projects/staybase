// F09 / SEC-6 / SEC-5 (2026-10-22, P2 revenue leak): the PUBLIC
// projection of `settings/hotelConfig`.
//
// THE DEFECT: `firebase/firestore.rules` allowed `allow read: if true`
// on `settings/{documentId}`, so `settings/hotelConfig` was
// world-readable from any anonymous browser. The document carries the
// hotel's NEGOTIATED corporate rate ladder
// (`roomTypes[].corporateRate`) and the bank details of the payment
// methods — including the `accountNumber` of a method the admin hid
// from the corporate surface with `showInCorporate: false`.
//
// THE FIX: the collection is staff-read / admin-write and the guest
// site reads the hotel's PUBLIC content through
// `GET /api/public/hotel-config` — an explicit allow-list projection
// built server-side.
//
// This file pins the projection contract:
//   1. The public fields the guest site renders ARE present.
//   2. NO room type carries a `corporateRate`.
//   3. The `accountNumber` of a `showInCorporate: false` payment
//      method is NOT in the payload.
//   4. The admin-only `settings/hotelConfig` fields are NOT in the
//      payload (the projection is an allow-list, not a strip-list).
//   5. The guest app no longer reads the raw document from Firestore.
//
// The behavioural tests import the projection module lazily so a
// pre-fix run reports a clean assertion failure for the source-text
// tripwires instead of dying at module resolution.

import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const GUEST_SRC = join(ROOT, "guest-app", "src");
const API_ROUTER = join(ROOT, "guest-app", "server", "apiRouter.ts");
const PUBLIC_CONFIG_HANDLER = join(ROOT, "guest-app", "server", "handlers", "public-config.ts");

/** A hotel config that carries every secret the defect exposed. */
const RAW_HOTEL_CONFIG = {
  brandName: "Spark Inn",
  address: "Panglao, Bohol",
  frontDeskPhone: "+63 900 000 0000",
  supportEmail: "stay@sparkinn.com",
  dpoEmail: "dpo@sparkinn.com",
  facebookUrl: "https://facebook.com/sparkinn",
  instagramUrl: "https://instagram.com/sparkinn",
  twitterHandle: "@sparkinn",
  checkInTime: "2:00 PM",
  checkOutTime: "12:00 NN",
  seniorPwdOnlineEnabled: true,
  vatConfig: { enabled: true },
  maxStayNights: 30,
  otherAddOnsEnabled: true,
  intercomQuickRequests: ["Extra Towels", "Bottled Water"],
  roomTypes: [
    {
      value: "single",
      label: "Single",
      shortLabel: "Single",
      imageUrls: ["https://example.test/single.jpg"],
      bedDefinition: "1 single bed",
      description: "A compact private room.",
      amenities: ["WiFi", "AC"],
      maxCapacity: 1,
      maxChildren: 0,
      pricePerNight: 1800,
      weekendRate: 2100,
      corporateRate: 1600,
      maxExtraBeds: 0,
      extraBedRate: 0,
      bedSetupValues: []
    },
    {
      value: "standard-double",
      label: "Standard Double",
      shortLabel: "Std Double",
      imageUrls: [],
      bedDefinition: "1 double bed",
      description: "Simple comfort for couples.",
      amenities: ["WiFi"],
      maxCapacity: 2,
      maxChildren: 1,
      pricePerNight: 2400,
      weekendRate: 2700,
      corporateRate: 2200,
      maxExtraBeds: 1,
      extraBedRate: 500,
      bedSetupValues: ["large-bed"]
    }
  ],
  seasonalRateOverrides: [
    {
      id: "o1",
      name: "Easter",
      startDate: "2026-04-01",
      endDate: "2026-04-05",
      rate: 3000,
      roomTypeValues: [],
      isActive: true
    }
  ],
  bedSetups: [{ value: "large-bed", label: "Large bed", icon: "bed" }],
  bookingPreferences: [{ value: "late-checkout", label: "Late checkout" }],
  paymentMethods: [
    {
      method: "gcash",
      label: "GCash",
      accountName: "Spark Inn",
      accountNumber: "0917-000-0000",
      isEnabled: true,
      showInCorporate: true,
      showInStore: true,
      requireReferenceNumber: true
    },
    {
      method: "paypal",
      label: "PayPal",
      accountName: "paypal@sparkinn.com",
      accountNumber: "SECRET-8811",
      isEnabled: true,
      showInCorporate: false,
      showInStore: true,
      requireReferenceNumber: false
    }
  ],
  // Admin-only `settings/hotelConfig` fields — none of these may be
  // projected (the projection is an allow-list).
  bookingSources: [{ id: "online", label: "Online", isProtected: true }],
  discountScope: "booking",
  paymentHoldWindowHours: 48,
  unpaidCheckoutApprovalThreshold: 3,
  inFlowHoldMinutes: 15
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("F09 / SEC-6 — the public hotel-config projection", () => {
  // The projection module is imported lazily on purpose (see the file
  // header) so a pre-fix run reports a clean assertion failure rather
  // than dying at module resolution. But the module pulls in the whole
  // `firebase-admin` SDK, and that ONE-TIME load was being charged to
  // whichever test happened to run first — so the file's first
  // assertion spent ~2.6s of its 5s budget importing the SDK and the
  // rest of the suite ran with none. On a loaded machine that tipped
  // the first test over Vitest's 5s default and the file reported a
  // spurious timeout.
  //
  // Warming the module ONCE in a hook moves that cost out of the
  // assertions entirely. The hook gets its own generous budget, the
  // lazy-import contract is preserved, and every assertion below now
  // starts with the module already in memory.
  let buildPublicHotelConfig: typeof import("../../server/lib/publicHotelConfig").buildPublicHotelConfig;

  beforeAll(async () => {
    const mod = await import("../../server/lib/publicHotelConfig");
    buildPublicHotelConfig = mod.buildPublicHotelConfig;
  }, 60_000);

  it("keeps every public field the guest site renders", async () => {
    const projected = buildPublicHotelConfig(RAW_HOTEL_CONFIG);

    expect(projected.brandName).toBe("Spark Inn");
    expect(projected.address).toBe("Panglao, Bohol");
    expect(projected.frontDeskPhone).toBe("+63 900 000 0000");
    expect(projected.supportEmail).toBe("stay@sparkinn.com");
    expect(projected.dpoEmail).toBe("dpo@sparkinn.com");
    expect(projected.facebookUrl).toBe("https://facebook.com/sparkinn");
    expect(projected.instagramUrl).toBe("https://instagram.com/sparkinn");
    expect(projected.twitterHandle).toBe("@sparkinn");
    expect(projected.checkInTime).toBe("2:00 PM");
    expect(projected.checkOutTime).toBe("12:00 NN");
    expect(projected.seniorPwdOnlineEnabled).toBe(true);
    expect(projected.vatConfig).toEqual({ enabled: true });
    expect(projected.maxStayNights).toBe(30);
    expect(projected.otherAddOnsEnabled).toBe(true);
    expect(projected.intercomQuickRequests).toEqual(["Extra Towels", "Bottled Water"]);
    expect(projected.storeEnabled).toBe(true);

    // The room catalog the public rooms page + booking Step 1 render.
    expect(projected.roomTypes).toHaveLength(2);
    expect(projected.roomTypes[0].value).toBe("single");
    expect(projected.roomTypes[0].pricePerNight).toBe(1800);
    expect(projected.roomTypes[0].weekendRate).toBe(2100);
    expect(projected.roomTypes[0].amenities).toEqual(["WiFi", "AC"]);
    expect(projected.roomTypes[0].imageUrls).toEqual([
      "https://example.test/single.jpg"
    ]);
    expect(projected.roomTypes[1].bedSetupValues).toEqual(["large-bed"]);
    expect(projected.roomTypes[1].extraBedRate).toBe(500);

    expect(projected.seasonalRateOverrides).toHaveLength(1);
    expect(projected.bedSetups).toEqual([
      { value: "large-bed", label: "Large bed", icon: "bed" }
    ]);
    expect(projected.bookingPreferences).toEqual([
      { value: "late-checkout", label: "Late checkout" }
    ]);
    expect(projected.paymentMethods).toHaveLength(2);
  });

  it("never carries a corporateRate on any room type", async () => {
    const projected = buildPublicHotelConfig(RAW_HOTEL_CONFIG);

    for (const roomType of projected.roomTypes) {
      expect(Object.prototype.hasOwnProperty.call(roomType, "corporateRate")).toBe(
        false
      );
    }
    expect(JSON.stringify(projected)).not.toContain("corporateRate");
    // The negotiated ladder itself (1600 / 2200) must not appear
    // anywhere in the payload.
    expect(JSON.stringify(projected)).not.toContain("1600");
    expect(JSON.stringify(projected)).not.toContain("2200");
  });

  it("drops the accountNumber of a `showInCorporate: false` payment method", async () => {
    const projected = buildPublicHotelConfig(RAW_HOTEL_CONFIG);

    const paypal = projected.paymentMethods.find((m) => m.method === "paypal");
    expect(paypal).toBeDefined();
    expect(paypal!.showInCorporate).toBe(false);
    expect(paypal!.accountNumber).toBe("");
    expect(JSON.stringify(projected)).not.toContain("SECRET-8811");

    // The method the hotel publishes on `/corporate/book` keeps its
    // account number — it is already public.
    const gcash = projected.paymentMethods.find((m) => m.method === "gcash");
    expect(gcash).toBeDefined();
    expect(gcash!.accountNumber).toBe("0917-000-0000");
  });

  it("drops the admin-only settings fields (the projection is an allow-list)", async () => {
    const projected = buildPublicHotelConfig(RAW_HOTEL_CONFIG) as Record<
      string,
      unknown
    >;

    expect(projected.bookingSources).toBeUndefined();
    expect(projected.discountScope).toBeUndefined();
    expect(projected.paymentHoldWindowHours).toBeUndefined();
    expect(projected.unpaidCheckoutApprovalThreshold).toBeUndefined();
    expect(projected.inFlowHoldMinutes).toBeUndefined();

    const serialised = JSON.stringify(projected);
    expect(serialised).not.toContain("bookingSources");
    expect(serialised).not.toContain("discountScope");
    expect(serialised).not.toContain("paymentHoldWindowHours");
  });

  it("is resilient to a missing / malformed settings doc", async () => {
    const projected = buildPublicHotelConfig(null);
    expect(projected.roomTypes).toEqual([]);
    expect(projected.paymentMethods).toEqual([]);
    expect(projected.maxStayNights).toBeNull();
    expect(projected.vatConfig).toEqual({ enabled: true });
    expect(projected.storeEnabled).toBe(true);
  });
});

describe("F09 / SEC-6 — the public endpoint is wired and rate-limited", () => {
  const routerSrc = readFileSync(API_ROUTER, "utf8");
  // Read lazily: a pre-fix tree has no handler file, and the test
  // should report THAT as an assertion failure rather than dying at
  // module load.
  const handlerSrc = existsSync(PUBLIC_CONFIG_HANDLER)
    ? readFileSync(PUBLIC_CONFIG_HANDLER, "utf8")
    : "";

  it("the apiRouter registers GET /api/public/hotel-config", () => {
    expect(routerSrc).toMatch(/domain === "public"/);
    expect(routerSrc).toMatch(/action === "hotel-config"/);
    expect(routerSrc).toContain("handleGetPublicHotelConfig");
  });

  it("the apiRouter registers GET /api/corporate/rates", () => {
    expect(routerSrc).toMatch(/action === "rates"/);
    expect(routerSrc).toContain("handleGetCorporateRates");
  });

  it("the public hotel-config route is rate-limited per IP", () => {
    expect(routerSrc).toMatch(/isRateLimited\(`public-hotel-config:\$\{ip\}`, \d+, 60000\)/);
    expect(routerSrc).toMatch(/isRateLimited\(`corporate-rates:\$\{ip\}`, \d+, 60000\)/);
  });

  it("the handler reads the hotel config through the Admin SDK", () => {
    expect(handlerSrc, "expected the public-config handler file").not.toBe("");
    expect(handlerSrc).toContain("adminDb");
    expect(handlerSrc).toContain('collection("settings").doc("hotelConfig")');
    // The handler must never reach for the CLIENT SDK.
    expect(handlerSrc).not.toContain("firebase/firestore");
  });
});

describe("F09 / SEC-6 — the guest app does not read the raw hotel config from Firestore", () => {
  it("no guest source file reads settings/hotelConfig from Firestore", () => {
    const offenders = walk(GUEST_SRC)
      .filter((file) => /["']settings["']\s*,\s*["']hotelConfig["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(GUEST_SRC, file).split(/[\\/]/).join("/"));

    // The in-room intercom panel was migrated to the public projection
    // (`GET /api/public/hotel-config`) in the same release, so there is
    // no whitelist left: ANY guest source file that reads the raw
    // document is an offender.
    expect(offenders).toEqual([]);
  });

  it("no guest source file reads settings/storeConfig from Firestore", () => {
    const offenders = walk(GUEST_SRC)
      .filter((file) => /["']settings["']\s*,\s*["']storeConfig["']/.test(readFileSync(file, "utf8")))
      .map((file) => relative(GUEST_SRC, file).split(/[\\/]/).join("/"));

    expect(offenders).toEqual([]);
  });

  it("the intercom panel reads the public projection instead of the raw documents", () => {
    const intercom = readFileSync(join(GUEST_SRC, "pages", "IntercomPage.tsx"), "utf8");
    expect(intercom).toContain('from "../hooks/usePublicHotelConfig"');
    expect(intercom).toContain("fetchPublicHotelConfig");
    expect(intercom).not.toMatch(/["']settings["']\s*,\s*["'](hotelConfig|storeConfig)["']/);
  });
});
