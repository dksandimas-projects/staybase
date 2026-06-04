export interface VoucherLike {
  discountType: "percent" | "flat";
  discountValue: number;
  usageCap: number | null;
  usageCount: number;
  expiresAt: Date | null;
  applicableRoomTypes: string[];
  isActive: boolean;
}

export function validateVoucher(voucher: VoucherLike, roomType: string, now = new Date()) {
  if (!voucher.isActive) {
    return { valid: false, error: "Voucher is inactive." };
  }

  if (voucher.expiresAt && voucher.expiresAt < now) {
    return { valid: false, error: "Voucher has expired." };
  }

  if (voucher.usageCap !== null && voucher.usageCount >= voucher.usageCap) {
    return { valid: false, error: "Voucher usage limit reached." };
  }

  if (voucher.applicableRoomTypes.length > 0 && !voucher.applicableRoomTypes.includes(roomType)) {
    return { valid: false, error: "Voucher does not apply to this room type." };
  }

  return { valid: true, error: "" };
}

export function calculateVoucherDiscount(voucher: Pick<VoucherLike, "discountType" | "discountValue">, subtotal: number) {
  const discount =
    voucher.discountType === "percent"
      ? subtotal * (voucher.discountValue / 100)
      : voucher.discountValue;

  return Math.min(Math.max(discount, 0), subtotal);
}

export function applyVoucherDiscount(voucher: Pick<VoucherLike, "discountType" | "discountValue">, subtotal: number) {
  return Math.max(subtotal - calculateVoucherDiscount(voucher, subtotal), 0);
}
