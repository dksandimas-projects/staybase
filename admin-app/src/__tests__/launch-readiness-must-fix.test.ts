import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("launch-readiness must-fix regressions", () => {
  it("LR-C1 keeps walk-in idempotency reads before transaction writes", () => {
    const src = read("guest-app/server/handlers/bookings.ts");
    const fn = src.slice(
      src.indexOf("export async function handleCreateWalkin"),
      src.indexOf("export async function handleRejectDiscount")
    );

    const existingRead = fn.indexOf("const existingWalkin = await transaction.get(bookingDocRef)");
    const firstRoomWrite = fn.indexOf("transaction.update(roomRef");
    const firstCounterWrite = Math.min(
      fn.indexOf("transaction.update(counterRef"),
      fn.indexOf("transaction.set(counterRef")
    );

    expect(existingRead).toBeGreaterThan(-1);
    expect(firstRoomWrite).toBeGreaterThan(existingRead);
    expect(firstCounterWrite).toBeGreaterThan(existingRead);
  });

  it("LR-C2 reads checkout booking/member state inside the transaction before writes", () => {
    const src = read("guest-app/server/handlers/bookings.ts");
    const fn = src.slice(
      src.indexOf("export async function handleCheckoutBooking"),
      src.indexOf("export async function handleLookupBooking")
    );

    const freshBookingRead = fn.indexOf("const freshBookingDoc = await transaction.get(bookingRef)");
    const memberRead = fn.indexOf("await transaction.get(memberRef)");
    const bookingWrite = fn.indexOf("transaction.update(bookingRef, bookingUpdate)");

    expect(freshBookingRead).toBeGreaterThan(-1);
    expect(memberRead).toBeGreaterThan(freshBookingRead);
    expect(bookingWrite).toBeGreaterThan(memberRead);
    expect(fn).toMatch(/freshBookingData\.status !== "checked-in"/);
  });

  it("LR-H1 uses trusted production env for Turnstile secret selection", () => {
    const src = read("guest-app/server/apiRouter.ts");
    const fn = src.slice(
      src.indexOf("async function verifyTurnstile"),
      src.indexOf("export default async function handler")
    );

    expect(fn).toMatch(/process\.env\.VERCEL_ENV === "production"/);
    expect(fn).toMatch(/isProduction\s*\?\s*process\.env\.TURNSTILE_SECRET_KEY\s*:\s*"1x0000000000000000000000000000000AA"/);
    expect(fn).not.toMatch(/const secret = isProduction\s*\?\s*process\.env\.TURNSTILE_SECRET_KEY\s*:\s*requestOrigin/);
  });

  it("LR-H2 and LR-H3 restrict member points and store orders in Firestore rules", () => {
    const rules = read("firebase/firestore.rules");

    expect(rules).toMatch(/affectedKeys\(\)\s*\.hasOnly\(\["fullName", "phone", "photoUrl", "updatedAt"\]\)/);
    expect(rules).toMatch(/match \/storeOrders\/\{orderId\} \{\s*allow read, update: if isStaff\(\);\s*allow create: if false;/);
  });

  it("LR-H4 rejects non-staff Firebase users instead of defaulting to front desk", () => {
    const src = read("admin-app/src/context/AdminContext.tsx");
    const authBlock = src.slice(src.indexOf("const unsubscribe = onAuthStateChanged"), src.indexOf("const signOut = async"));

    expect(authBlock).toMatch(/if \(!isStaffRole\(tokenResult\.claims\.role\)\)/);
    expect(authBlock).toMatch(/firebaseSignOut\(auth\)/);
    expect(authBlock).not.toMatch(/isStaffRole\(tokenResult\.claims\.role\) \? tokenResult\.claims\.role : "front-desk"/);
  });

  it("LR-M1 includes payment-confirmed bookings in public availability", () => {
    const src = read("guest-app/server/handlers/rooms.ts");

    // Per PEX-02 (2026-08-01): the active-statuses list is now
    // the shared `BOOKING_OCCUPYING_STATUSES` constant from
    // `@spark-inn/shared`. The handler imports it and aliases
    // it to `ACTIVE_STATUSES` for the historical read-site name.
    // Either the inline literal (legacy) or the shared-constant
    // alias passes the test.
    expect(src).toMatch(
      /ACTIVE_STATUSES\s*=\s*BOOKING_OCCUPYING_STATUSES|ACTIVE_STATUSES\s*=\s*\["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"\]/
    );
  });

  it("LR-M2 keeps creation conflicts symmetric with room-occupying statuses and truncates early checkout", () => {
    const src = read("guest-app/server/handlers/bookings.ts");
    const checkoutFn = src.slice(
      src.indexOf("export async function handleCheckoutBooking"),
      src.indexOf("export async function handleLookupBooking")
    );

    expect(src).toMatch(
      /ROOM_OCCUPYING_STATUSES\s*=\s*BOOKING_OCCUPYING_STATUSES|ROOM_OCCUPYING_STATUSES\s*=\s*\["pending", "payment-uploaded", "payment-confirmed", "confirmed", "checked-in"\]/
    );
    expect(src).toMatch(/where\("status", "in", ROOM_OCCUPYING_STATUSES\)/);
    expect(checkoutFn).toMatch(/bookingUpdate\.checkOut = Timestamp\.fromDate\(checkoutDate\)/);
    expect(checkoutFn).toMatch(/earlyCheckoutOriginalCheckOut/);
  });

  it("LR-M3 rejects stale vouchers at booking creation with a conflict", () => {
    const src = read("guest-app/server/handlers/bookings.ts");

    expect(src).toMatch(/throw new Error\("Voucher no longer valid"\)/);
    expect(src).toMatch(/error\.message === "Voucher no longer valid"[\s\S]*status = 409/);
  });

  it("LR-M4 verifies explicit booking ownership before member registration links it", () => {
    const src = read("guest-app/server/handlers/members.ts");
    const fn = src.slice(src.indexOf("async function linkBookingsByEmail"), src.indexOf("function toMillis"));

    expect(fn).toMatch(/const bookingDoc = await bookingRef\.get\(\)/);
    expect(fn).toMatch(/bookingEmail === email/);
    expect(fn).toMatch(/alreadyLinkedToCaller/);
  });

  it("LR-M5 signs out idle admin sessions after eight hours", () => {
    const src = read("admin-app/src/context/AdminContext.tsx");

    expect(src).toMatch(/ADMIN_IDLE_TIMEOUT_MS = 8 \* 60 \* 60 \* 1000/);
    expect(src).toMatch(/setTimeout\(\(\) => \{[\s\S]*firebaseSignOut\(auth\)/);
    expect(src).toMatch(/window\.addEventListener\(eventName, resetIdleTimer/);
  });
});
