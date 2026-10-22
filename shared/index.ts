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
export * from "./utils/stayRange";
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

// Per BR-01 (Phase 13 — Breakfast Redesign, decision
// #231, 2026-10-12): the CANONICAL breakfast slot-key
// contract (`${serviceDate}-guest-${guestIndex}`, 0-based)
// + the normaliser that folds the legacy bare
// (`<date>-N`) and legacy 1-based (`<date>-guest-N`)
// forms into it. The guest app, the admin app, and the
// server all resolve slots through it so the two apps
// cannot drift onto different index bases again.
export * from "./utils/breakfastSlotKey";

// Per OCT-H8 (2026-10-20, decision #288): the pure re-dating /
// auto-cancel logic for a booking whose stay window moved (or was
// cancelled). The reschedule + cancel handlers use it to drop the
// add-on selections that fell outside the stay and to open the
// refund liabilities the spec requires.
export * from "./utils/bookingAddOnReschedule";

// Per PAY-01 (P1 MONEY, 2026-10-22): the booking-scoped
// `paidAmount` arithmetic. The two production payment-record
// paths (`handleAddPayment` + `handleVerifyAndRecordPayment`)
// use it to maintain the booking's `paidAmount` — the money
// collected against it — which the refund-liability gate
// (`redateBreakfastSelections`) reads to decide whether a removed
// meal was paid for.
export * from "./utils/bookingPaidAmount";

// Per OCT-H5 (2026-10-20, decision #283): the deep strip of
// `undefined`-valued keys applied to every admin settings write.
// The Firestore SDK rejects `undefined` outright
// (`Unsupported field value: undefined`) and the admin app does not
// set `ignoreUndefinedProperties`, so one stray undefined-valued key
// inside a settings payload made every save of that section fail.
export * from "./utils/firestorePayload";

// Per BR-03 (Phase 13 — Breakfast Redesign, decision
// #232, 2026-10-12): the public breakfast-config
// normalizer (`normalizeBreakfastConfig`) used by
// `GET /api/bookings/breakfast/config` to strip
// admin-only fields before serving the config to the
// guest app's Step 2 UI.
export * from "./utils/breakfastConfig";

// Per BR-12 (Phase 14 — Other Add-Ons, decision #245
// reserved, 2026-10-14): the per-add-on cut-off helper
// (`computeOtherAddOnCutoffState`) + the total
// recompute + breakdown helpers (`recomputeOtherAddOnTotal`,
// `otherAddOnBreakdownByDate`, `hasAnyOtherAddOns`,
// `buildOtherAddOnSelectionKey`, `parseOtherAddOnSelectionKey`)
// + the catalog normalizer + enabler filter
// (`normalizeAddOn`, `getEnabledAddOnsByHotel`,
// `sortAddOnsByDisplayOrder`, `AIRPORT_TRANSFER_PRESEED`).
// Mirrors the BR-01 + BR-03 export pattern; both the
// guest-app Step 2 + Manage Other Add-Ons page AND the
// admin-app booking drawer + Settings tab consume from
// here.
export * from "./utils/otherAddOnCutoff";
export * from "./utils/otherAddOnTotal";
export * from "./utils/otherAddOnDrafts";
export * from "./utils/addOns";

// Per OCT-L3 (2026-10-20, decision #299): the single shared
// money-rounding rule (`roundToTwoDecimals`). Lives in its own module
// so the other-add-on path, the refund liability and the breakfast
// path can never drift onto different rounding rules again.
export * from "./utils/money";

// Per Phase 2 of the Spark Rewards tier system (2026-10-12,
// decision pending): Zod schema + inferred types for the
// `settings/rewardsConfig` document + `LevelDef` row. Used by
// the Settings save route to validate admin edits before
// writing to Firestore.
export * from "./schemas/rewardsConfig";

