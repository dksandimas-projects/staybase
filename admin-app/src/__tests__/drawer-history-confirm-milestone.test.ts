// Per ATR-11 (2026-11-21, `plan/features/AUDIT-TRAIL.md`):
// the booking CONFIRMATION must appear in the booking drawer's
// history.
//
// THE REPORTED BUG
// ----------------
// "why is also the booking confirmation is not in the history?"
//
// THE WRITE WAS NEVER MISSING. The server has always stamped the
// confirmation on the booking doc:
//
//   - `handleConfirmBooking` → `{ status: "confirmed", confirmedAt,
//     confirmedBy, updatedAt }` (guest-app/server/handlers/bookings.ts)
//   - `handleConfirmBookingWithBalance` → `confirmedAt` +
//     `paymentConfirmedAt` + `paymentConfirmedBy` (and the
//     `confirmedWithBalance*` cluster)
//
// THREE read gaps hid it — and they are the SAME bug class as
// FOL-01 / FOL-02 / ATR-10:
//
//   1. `shared/types/index.ts` did not DECLARE `confirmedAt` /
//      `confirmedBy` on the canonical `Booking` type (only the
//      `confirmedWithBalance*` cluster was declared).
//   2. The admin app's bookings mapper never READ them off the
//      snapshot, so `booking.confirmedAt` was always `undefined`.
//   3. `bookingMilestoneEvents()` had NO "confirmed" milestone, so
//      even a hydrated field would have rendered nothing.
//
// A fourth, smaller gap: `confirmedBy` is a STAFF UID, so the
// timeline must resolve it through the ONE shared resolver — a raw
// 28-character uid tells the desk nothing (GOTCHAS §Security & PII).
//
// WHY THIS FILE IS A SOURCE-TEXT GUARD
// ------------------------------------
// The admin app has no component-test harness, so this file pins
// the wiring at the source level. The BEHAVIOURAL rules (what the
// milestone says, who it names, when it is dropped) are unit-tested
// for real in `shared/__tests__/booking-history.test.ts` and
// rendered for real in `booking-history-render.test.tsx`.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), "utf8");

const sharedTypesSrc = read("shared/types/index.ts");
const adminContextSrc = read("admin-app/src/context/AdminContext.tsx");
const sharedSrc = read("shared/utils/bookingHistory.ts");
const historySrc = read("admin-app/src/components/BookingHistoryTab.tsx");

// The `useEffect` that hydrates `bookings` from the collection
// snapshot — the same slice the FOL-02 guard uses.
const hydrationEffectStart = adminContextSrc.indexOf(
  "  useEffect(() => {\n    if (!currentUser) {\n      setBookings([]);"
);
const hydrationEffectEnd = adminContextSrc.indexOf(
  "    return () => {\n      active = false;\n      unsubscribe();\n    };\n  }, [currentUser]);"
);
const hydrationEffect =
  hydrationEffectStart >= 0 && hydrationEffectEnd > hydrationEffectStart
    ? adminContextSrc.slice(hydrationEffectStart, hydrationEffectEnd)
    : "";

describe("ATR-11 — the confirmation stamp is DECLARED", () => {
  it("the canonical `Booking` type declares `confirmedAt` + `confirmedBy`", () => {
    // The type is the contract. A field the server writes but the
    // type omits is a field no surface is allowed to read.
    expect(sharedTypesSrc).toMatch(/confirmedAt\?:\s*Date\s*\|\s*null;/);
    expect(sharedTypesSrc).toMatch(/confirmedBy\?:\s*string\s*\|\s*null;/);
  });
});

describe("ATR-11 — the admin mapper hydrates the confirmation stamp", () => {
  it("the bookings hydration effect is present and locatable", () => {
    expect(hydrationEffect.length).toBeGreaterThan(0);
    expect(hydrationEffect).toMatch(/bookingsData\.push\(\{/);
  });

  it("reads `confirmedAt` off the snapshot (ISO string, `null` when absent)", () => {
    expect(hydrationEffect).toMatch(
      /confirmedAt:\s*data\.confirmedAt\s*\?\s*parseDateTimeString\(data\.confirmedAt\)\s*:\s*null/
    );
  });

  it("reads `confirmedBy` off the snapshot (the staff uid)", () => {
    expect(hydrationEffect).toMatch(/confirmedBy:\s*data\.confirmedBy\s*\|\|\s*null/);
  });
});

describe("ATR-11 — the shared timeline has a confirmed milestone", () => {
  it("has a dedicated event kind for the confirmation", () => {
    expect(sharedSrc).toMatch(/\|\s*"confirmed"/);
  });

  it("pushes the milestone off `confirmedAt` + `confirmedBy`", () => {
    expect(sharedSrc).toMatch(
      /push\(\s*"confirmed",\s*"Booking confirmed",\s*toIsoTimestamp\(data\.confirmedAt\),/
    );
    expect(sharedSrc).toMatch(/staffUidFrom\(confirmedBy\)/);
  });

  it("DROPS the milestone when the booking was never confirmed", () => {
    // `push()` ignores a milestone with no timestamp — a row dated at
    // the creation time would be a lie about WHEN it happened.
    expect(sharedSrc).toMatch(/if \(!at\) return;/);
  });

  it("keeps the behavioural rules unit-tested in the shared package", () => {
    const sharedTest = read("shared/__tests__/booking-history.test.ts");
    expect(sharedTest).toMatch(/Booking confirmed/);
  });
});

describe("ATR-11 — the drawer's History tab renders it", () => {
  it("gives the confirmation its own icon", () => {
    expect(historySrc).toMatch(/case "confirmed":/);
  });

  it("resolves the confirmer through the ONE shared resolver", () => {
    // `confirmedBy` is a staff uid — it must never be printed raw.
    expect(historySrc).toMatch(/bookingHistoryActorLabel/);
    expect(historySrc).toMatch(/buildStaffNameMap/);
  });

  it("keeps a render test that shows the confirmation on the screen", () => {
    const renderTest = read("admin-app/src/__tests__/booking-history-render.test.tsx");
    expect(renderTest).toMatch(/renderToStaticMarkup/);
    expect(renderTest).toMatch(/Booking confirmed/);
    expect(renderTest).toMatch(/not\.toContain\("uid-maria"\)/);
  });
});
