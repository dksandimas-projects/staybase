import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  dateKeyInTimeZone,
  getTimeZoneDayRange,
  shiftDateKey,
  summarizeFolioSnapshot
} from "../utils/finance";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

describe("FL-15 hotel-timezone report windows", () => {
  it("builds inclusive Manila-day instants independent of browser timezone", () => {
    const range = getTimeZoneDayRange("2026-07-12", "2026-07-12", "Asia/Manila");

    expect(range.start.toISOString()).toBe("2026-07-11T16:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-07-12T15:59:59.999Z");
    expect(dateKeyInTimeZone(range.start, "Asia/Manila")).toBe("2026-07-12");
    expect(dateKeyInTimeZone(range.end, "Asia/Manila")).toBe("2026-07-12");
  });

  it("shifts calendar keys without browser-local date arithmetic", () => {
    expect(shiftDateKey("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDateKey("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("wires membership and export labels to hotel date keys", () => {
    expect(reports).toMatch(/getTimeZoneDayRange\(periodStartKey, periodEndKey, config\.timezone\)/);
    expect(reports).toMatch(/sparkinn_collections_\$\{periodStartKey\}_to_\$\{periodEndKey\}/);
    expect(reports).not.toMatch(/periodStart\.toISOString\(\)\.slice\(0, 10\)/);
  });
});

describe("FL-13 comparable folio snapshot bases", () => {
  it("includes pre-period deposits, refunds, charges, and Add-to-Bill on selected folios", () => {
    const snapshot = summarizeFolioSnapshot({
      bookings: [{ id: "booking-1", totalPrice: 5_000 }, { id: "outside", totalPrice: 9_000 }],
      bookingIds: ["booking-1"],
      charges: [{ bookingId: "booking-1", amount: 500 }, { bookingId: "outside", amount: 800 }],
      storeOrders: [
        { id: "bill-1", bookingId: "booking-1", paymentMethod: "add-to-bill", status: "delivered", isBilled: true, totalAmount: 300 },
        { id: "direct-1", paymentMethod: "cash", status: "delivered", totalAmount: 200 }
      ],
      directStoreOrderIds: ["direct-1"],
      payments: [
        { source: "booking", sourceId: "booking-1", bookingId: "booking-1", amount: 2_000 },
        { source: "booking", sourceId: "booking-1", bookingId: "booking-1", amount: -500 },
        { source: "booking", sourceId: "outside", bookingId: "outside", amount: 9_000 },
        { source: "store-order", sourceId: "direct-1", bookingId: "store:direct-1", amount: 200 }
      ]
    });

    expect(snapshot).toEqual({ billed: 6_000, collected: 1_700 });
  });

  it("labels the snapshot basis separately from period collection flows", () => {
    expect(reports).toMatch(/Billed to date/);
    expect(reports).toMatch(/Collected to date/);
    expect(reports).toMatch(/Gross Collections/);
  });
});

describe("FL-14 retained no-show deposits", () => {
  it("classifies past confirmed bookings alongside cancellations", () => {
    expect(reports).toMatch(/booking\.status === "confirmed" && Boolean\(checkOutKey && checkOutKey <= hotelTodayKey\)/);
    expect(reports).toMatch(/booking\.status === "cancelled" \? "Cancelled" : "No-show"/);
    expect(reports).toMatch(/Cancelled and no-show bookings with money collected/);
  });
});
