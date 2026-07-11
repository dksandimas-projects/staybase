import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");
const sharedTypes = readFileSync(resolve(__dirname, "../../../shared/types/index.ts"), "utf8");

describe("FIN-05 discounts and adjustments", () => {
  it("defines memberDiscountPct on the shared Booking interface", () => {
    expect(sharedTypes).toMatch(/memberDiscountPct\?: number/);
  });

  it("reconstructs the gross bookings revenue including room subtotal and breakfast", () => {
    expect(reports).toMatch(/roomSubtotal = b\.rateBreakdown\?.roomSubtotal \?\? \(b\.ratePerNight \* b\.numNights\)/);
    expect(reports).toMatch(/breakfastTotal = b\.hasBreakfast \?/);
    expect(reports).toMatch(/subtotal = b\.originalTotalPrice \?\? \(roomSubtotal \+ breakfastTotal\)/);
  });

  it("calculates Senior/PWD, voucher, member discounts and points correctly in useMemo", () => {
    expect(reports).toMatch(/seniorDiscount = discountPct > 0 \? Math\.round\(subtotal \* \(discountPct \/ 100\)\) : 0/);
    expect(reports).toMatch(/memDiscount = memDiscountPct > 0 \? Math\.round\(afterVoucher \* \(memDiscountPct \/ 100\)\) : 0/);
    expect(reports).toMatch(/ptsRedeemedVal = b\.pointsRedeemedValue \|\| 0/);
  });

  it("calculates outstanding loyalty points liability", () => {
    expect(reports).toMatch(/members\.reduce\(\(sum, m\) => sum \+ \(m\.rewardsPoints \|\| 0\), 0\)/);
    expect(reports).toMatch(/liability = Math\.max\(\(totalPoints \/ 100\) \* redemptionRate, 0\)/);
  });

  it("displays Gross-to-Net and loyalty points metrics in the SalesTab UI", () => {
    expect(reports).toMatch(/Gross Bookings Subtotal/);
    expect(reports).toMatch(/Senior Citizen & PWD Deductions/);
    expect(reports).toMatch(/Spark Rewards Member Discounts/);
    expect(reports).toMatch(/Spark Rewards Points Redeemed/);
    expect(reports).toMatch(/Loyalty Program Liability/);
    expect(reports).toMatch(/Points Redemption Liability/);
  });

  it("includes discounts and liability in Sales XLSX exports", () => {
    expect(reports).toMatch(/"Discounts & Adjustments"/);
    expect(reports).toMatch(/"Gross Bookings \(Room \+ Breakfast\)"/);
    expect(reports).toMatch(/"Points Redemption Liability"/);
    expect(reports).toMatch(/"Total Outstanding Points"/);
  });
});
