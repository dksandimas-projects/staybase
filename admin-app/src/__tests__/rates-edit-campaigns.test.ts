import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("Rates campaign editing", () => {
  const ratesPage = read("admin-app/src/pages/RatesPage.tsx");
  const adminContext = read("admin-app/src/context/AdminContext.tsx");

  it("exposes Firestore update mutations for vouchers and corporate codes", () => {
    expect(adminContext).toMatch(/updateVoucher:\s*\(/);
    expect(adminContext).toMatch(/updateCorporateCode:\s*\(/);
    expect(adminContext).toMatch(/updateDoc\(doc\(db,\s*"vouchers"/);
    expect(adminContext).toMatch(/updateDoc\(doc\(db,\s*"corporateCodes"/);
    expect(adminContext).toMatch(/updatedAt:\s*serverTimestamp\(\)/);
  });

  it("opens edit modals from both campaign tables", () => {
    expect(ratesPage).toMatch(/const\s+openVoucherEditor\s*=\s*\(voucher:\s*Voucher\)/);
    expect(ratesPage).toMatch(/const\s+openCorporateCodeEditor\s*=\s*\(code:\s*CorporateCode\)/);
    expect(ratesPage).toMatch(/onClick=\{\(\)\s*=>\s*openVoucherEditor\(row\)\}/);
    expect(ratesPage).toMatch(/onClick=\{\(\)\s*=>\s*openCorporateCodeEditor\(row\)\}/);
  });

  it("keeps campaign codes immutable while editing mutable fields", () => {
    expect(ratesPage).toMatch(/title=\{editingVoucher\s*\?\s*"Edit Promo Voucher"/);
    expect(ratesPage).toMatch(/title=\{editingCorporateCode\s*\?\s*"Edit Corporate Partner Code"/);
    expect(ratesPage).toMatch(/disabled=\{Boolean\(editingVoucher\)\}/);
    expect(ratesPage).toMatch(/disabled=\{Boolean\(editingCorporateCode\)\}/);
    expect(ratesPage).toMatch(/Voucher is active/);
    expect(ratesPage).toMatch(/Corporate code is active/);
    expect(ratesPage).toMatch(/editingVoucher[\s\S]*await updateVoucher/);
    expect(ratesPage).toMatch(/editingCorporateCode[\s\S]*await updateCorporateCode/);
  });
});
