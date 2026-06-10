export interface CorporateCodeLike {
  isActive: boolean;
  expiresAt: Date | null;
  usageCap: number | null;
  usageCount: number;
}

export function validateCorporateCode(code: CorporateCodeLike, now = new Date()) {
  if (!code.isActive) {
    return { valid: false, error: "Corporate code is inactive." };
  }

  if (code.expiresAt && code.expiresAt < now) {
    return { valid: false, error: "Corporate code has expired." };
  }

  if (code.usageCap !== null && code.usageCount >= code.usageCap) {
    return { valid: false, error: "Corporate code usage limit reached." };
  }

  return { valid: true, error: "" };
}
