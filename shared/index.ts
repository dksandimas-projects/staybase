export * from "./VERSION";
export * from "./animations";
export * from "./constants";
export * from "./schemas/booking";
export * from "./schemas/paymentMethod";
export * from "./schemas/room";
export * from "./schemas/websiteContent";
export * from "./schemas/seo";
export * from "./types";
export * from "./utils/bookingDates";
export * from "./utils/bookingFolio";
export * from "./utils/bookingAddOns";
export * from "./utils/bookingDiscounts";
export * from "./utils/bookingOccupancy";
export * from "./utils/bookingInFlowHold";
export * from "./utils/extraBedInventory";
export * from "./utils/bookingVat";
export * from "./utils/cache";
export * from "./utils/calendar";
export * from "./utils/checkin";
export * from "./utils/dates";
export * from "./utils/images";
export * from "./utils/points";
export * from "./utils/paymentMethodLabel";
export * from "./utils/paymentReference";
export * from "./utils/paymentVerification";
export * from "./utils/pricing";
export * from "./utils/publicSiteCache";
export * from "./utils/references";
export * from "./utils/reservationFingerprint";
export * from "./utils/roomTypes";
export * from "./utils/seasonalRates";
export * from "./utils/storageJanitor";
export * from "./utils/storePaymentMethods";
export * from "./utils/vouchers";
export * from "./utils/corporate-codes";
export * from "./utils/failureBackoff";
export * from "./utils/financeInvariants";
export * from "./utils/cancellation";
export * from "./utils/uploads";
// Per SR-01..05 (2026-10-12): the booking-flow
// preference helpers (`buildArrivalTimeOptions` for
// the public Step 2 arrival-time dropdown +
// server-side validation).
export * from "./utils/bookingPreferences";

// Per BR-01 (Phase 13 — Breakfast Redesign, decision
// #231, 2026-10-12): the breakfast cut-off state
// helper (`computeBreakfastCutoffState`) + the
// breakfast-total recompute helper
// (`recomputeBreakfastTotal`). Both are used by the
// guest app's Manage Booking page, the admin app's
// booking drawer, and the server's write-side gate.
export * from "./utils/breakfastCutoff";
export * from "./utils/breakfastTotal";

// Per BR-03 (Phase 13 — Breakfast Redesign, decision
// #232, 2026-10-12): the public breakfast-config
// normalizer (`normalizeBreakfastConfig`) used by
// `GET /api/bookings/breakfast/config` to strip
// admin-only fields before serving the config to the
// guest app's Step 2 UI.
export * from "./utils/breakfastConfig";

// Per Phase 2 of the Spark Rewards tier system (2026-10-12,
// decision pending): Zod schema + inferred types for the
// `settings/rewardsConfig` document + `LevelDef` row. Used by
// the Settings save route to validate admin edits before
// writing to Firestore.
export * from "./schemas/rewardsConfig";

