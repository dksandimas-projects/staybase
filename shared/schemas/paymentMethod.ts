import { z } from "zod";

// Per `plan/features/SETTINGS.md §Payment Methods`: the booking
// payment list is a fully dynamic admin-managed array on
// `settings/hotelConfig.paymentMethods[]`. The schema stays
// open (`method: string`) so the admin can add custom keys,
// but `qrUrl`, `accountName`, and `accountNumber` are required
// strings (empty string is fine — it just means "not set").
// `isEnabled` gates visibility in the guest booking flow.
//
// Mirrors `PaymentMethodConfig` in `shared/types/index.ts` — keep
// the two in sync. The TS interface exists separately because
// the admin app imports types via the workspace package while
// the schema is needed only on the server-side validators; if
// you change one, change both.

export const PaymentMethodConfigSchema = z.object({
  method: z.string().min(1, "Method key is required").max(64),
  label: z.string().min(1, "Label is required").max(120),
  accountName: z.string().max(200),
  accountNumber: z.string().max(200),
  qrUrl: z.string().max(2048),
  isEnabled: z.boolean(),
  // Per #111 (per-method surface toggles). Both default to
  // `true` when omitted — the helper functions read them
  // permissively (`!== false`) so legacy data is treated as
  // "visible on all surfaces" without an explicit migration.
  // Optional on the schema for the same reason: pre-#111
  // entries do not have these fields.
  showInStore: z.boolean().optional(),
  showInCorporate: z.boolean().optional(),
  requireReferenceNumber: z.boolean().optional()
});

export const PaymentMethodsArraySchema = z
  .array(PaymentMethodConfigSchema)
  .max(20, "Too many payment methods (max 20)");

// Backward-compat: legacy entries may use `accountInfo` (single
// free-text field) instead of the structured `accountName` +
// `accountNumber` pair. The AdminContext migration reshapes old
// data on read.
export const LegacyPaymentMethodConfigSchema = z.object({
  method: z.string().min(1),
  label: z.string().optional(),
  accountName: z.string().optional(),
  accountNumber: z.string().optional(),
  accountInfo: z.string().optional(),
  qrUrl: z.string().optional(),
  isEnabled: z.boolean().optional()
});
