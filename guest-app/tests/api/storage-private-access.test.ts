import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(__dirname, path), "utf8");

describe("X-01 — private payment proof and discount ID access", () => {
  const rules = read("../../../firebase/storage.rules");
  const bookingPage = read("../../src/pages/BookingPage.tsx");
  const corporatePage = read("../../src/pages/CorporateBookingPage.tsx");
  const intercomPage = read("../../src/pages/IntercomPage.tsx");
  const router = read("../../server/apiRouter.ts");
  const storageHandler = read("../../server/handlers/storage.ts");

  it.each([
    "bookings/{bookingId}/payment-proof/{fileName}",
    "bookings/{bookingId}/discount-id/{fileName}",
    "store-orders/{roomNumber}/payment-proof/{fileName}"
  ])("keeps %s staff-readable without a public get grant", (path) => {
    const escaped = path.replace(/[{}*]/g, (char) => `\\${char}`);
    const block = rules.match(new RegExp(`match\\s+/${escaped}\\s*\\{[^}]+\\}`));
    expect(block, `missing Storage rule for ${path}`).toBeTruthy();
    expect(block![0]).toMatch(/allow read:\s*if isStaff\(\)/);
    expect(block![0]).not.toMatch(/allow get:\s*if true/);
  });

  it("submits randomized object paths and uses local blob previews", () => {
    expect(bookingPage).not.toMatch(/getDownloadURL/);
    expect(corporatePage).not.toMatch(/getDownloadURL/);
    expect(intercomPage).not.toMatch(/getDownloadURL/);
    expect(bookingPage).toMatch(/crypto\.randomUUID\(\)/);
    expect(corporatePage).toMatch(/crypto\.randomUUID\(\)/);
    expect(intercomPage).toMatch(/crypto\.randomUUID\(\)/);
    expect(bookingPage).toMatch(/URL\.createObjectURL\(compressed\.file\)/);
    expect(bookingPage).toMatch(/paymentProofPath:\s*paymentProofUpload\?\.path/);
    expect(intercomPage).toMatch(/paymentProofPath\s*\}/);
  });

  it("exposes only a staff-authenticated, short-lived signed URL route", () => {
    expect(router).toMatch(/domain === "storage" && action === "signed-url"/);
    expect(router).toMatch(/authenticateStaff\(req\)/);
    expect(storageHandler).toMatch(/req\.staff\?\.uid/);
    expect(storageHandler).toMatch(/getSignedUrl\(\{ action: "read", expires: expiresAt \}\)/);
    expect(storageHandler).toMatch(/BOOKING_PRIVATE_PATH/);
    expect(storageHandler).toMatch(/STORE_PRIVATE_PATH/);
  });
});
