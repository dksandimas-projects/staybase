// Per Phase 5 of the Spark Rewards tier system (2026-10-12,
// decision pending): the voucher schema gains a discriminator
// (`kind: "promo" | "reward"`) and a `valueType` so free-night
// reward vouchers — written by `handleCheckoutBooking` when
// `completedStays % freeNightEvery === 0` — can be applied at
// 100% off without colliding with the existing percent/flat
// promo code. Pre-Phase-5 vouchers are missing these (treated as
// `kind: "promo"`, `valueType: discountType`) — non-breaking
// for existing deployments.
export interface VoucherLike {
  discountType: "percent" | "flat";
  discountValue: number;
  usageCap: number | null;
  usageCount: number;
  expiresAt: Date | null;
  applicableRoomTypes: string[];
  isActive: boolean;
  // Per W4.4 / decision #104: optional guest email captured at
  // issuance time so the server can fire the voucher-issued
  // email (server-rendered, code in monospace block).
  guestEmail?: string | null;
  // Phase 5 additions — all optional for backward compat with
  // pre-Phase-5 promo vouchers. `kind: "promo"` is the implicit
  // default when absent; `valueType: discountType` is the
  // implicit default when absent.
  kind?: "promo" | "reward";
  valueType?: "percent" | "flat" | "free-night";
  // Reward vouchers link back to the member who earned them —
  // used by the member portal to surface available free-night
  // vouchers (Phase 7) and by the admin voucher list to filter
  // "Reward vouchers" by member.
  memberId?: string | null;
  memberNumber?: string | null;
  // Which Phase 2 feature created the voucher. Currently only
  // `"free-night-tier"` is in scope; `"welcome"` is reserved for
  // Phase 6 (not yet wired).
  rewardSource?: "free-night-tier" | "welcome" | null;
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

// Per Phase 5 (2026-10-12): the canonical discriminator helpers.
// A voucher is a "reward voucher" when `kind === "reward"` —
// Phase 5 writes these at checkout time for the free-night
// tier trigger. A reward voucher with `valueType === "free-night"`
// is the canonical Phase 5 voucher shape (100% off, single-use,
// 90-day expiry). The helpers default missing fields to their
// legacy semantics ("promo", `valueType = discountType`) so
// pre-Phase-5 documents are still recognized as promos.
export function isRewardVoucher(voucher: Pick<VoucherLike, "kind" | "valueType">): boolean {
  return voucher.kind === "reward";
}

export function isFreeNightVoucher(voucher: Pick<VoucherLike, "kind" | "valueType">): boolean {
  return voucher.kind === "reward" && voucher.valueType === "free-night";
}

// Deterministic code for a free-night reward voucher so the
// member can predict / search it on the rewards portal. Format:
// `FREENIGHT-{memberNumber}-{completedStays}`. Uppercased +
// sanitized (memberNumber is alphanumeric by construction — see
// `generateMemberNumber` in `shared/utils/...`). When two
// completions could collide (e.g. memberNumber changes mid-
// program) the second write still succeeds (the doc ID is
// deterministic; the older voucher stays if still active, the
// newer one re-creates the doc — admin can disambiguate by
// `createdAt`). For the Phase 5 happy path (memberNumber
// stable, `freeNightEvery` ≥ 1), collisions are vanishingly
// rare.
export function generateFreeNightVoucherCode(memberNumber: string, completedStays: number): string {
  const safeMember = String(memberNumber || "MEMBER").replace(/[^A-Z0-9_-]/gi, "");
  const safeStays = Math.max(0, Math.floor(Number(completedStays) || 0));
  return `FREENIGHT-${safeMember}-${safeStays}`;
}
