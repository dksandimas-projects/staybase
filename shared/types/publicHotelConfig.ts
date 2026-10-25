// Per F09 / SEC-6 (2026-10-22, P2 revenue leak): the PUBLIC
// projection of the `settings/hotelConfig` document.
//
// Why this type exists
// -------------------
// `settings/hotelConfig` was anonymously readable through the
// Firestore rules (`allow read: if true` on `settings/{documentId}`).
// The document holds two things the hotel never intended to publish:
//
//   1. `roomTypes[].corporateRate` — the hotel's corporate rate
//      ladder (the negotiated per-type corporate price).
//   2. `paymentMethods[].accountNumber` — the bank / wallet account
//      numbers, including the ones the admin hid from the corporate
//      surface with `showInCorporate: false`.
//
// The rules now close the anonymous read (staff read / admin write)
// and the guest site reads the hotel's public content through
// `GET /api/public/hotel-config` instead. This type is the contract
// for that payload — it is the ONLY shape the guest app may see.
//
// The shape is an explicit ALLOW-list, not a strip-list: a field
// that is not declared here does not reach the browser. That is the
// property that makes the projection safe to extend — adding a new
// field to `settings/hotelConfig` cannot leak it by accident.

import type { SeasonalRateOverride } from "./index";
// Per QA-2026-10-23 §3.2 (2026-10-25): the shared bot-protection mode
// type + its normaliser live in `shared/utils/botProtection.ts` — the
// server and the guest client both use them, so the two sides can never
// disagree about what "off" means.
import type { BotProtectionMode } from "../utils/botProtection";

/**
 * A room type as the public site sees it.
 *
 * Deliberately ABSENT: `corporateRate` (the negotiated corporate
 * ladder). The guest booking flow prices from `pricePerNight` /
 * `weekendRate` / the seasonal overrides; the corporate rate is
 * resolved server-side on the corporate booking path only.
 */
export interface PublicRoomType {
  value: string;
  label: string;
  shortLabel: string;
  imageUrls: string[];
  bedDefinition: string;
  description: string;
  amenities: string[];
  maxCapacity: number;
  maxChildren: number;
  pricePerNight: number;
  weekendRate: number;
  maxExtraBeds: number;
  extraBedRate: number;
  bedSetupValues: string[];
}

/**
 * A payment method as the public site sees it.
 *
 * `accountNumber` is EMPTY for every method the admin hid from the
 * corporate surface (`showInCorporate === false`) — those bank
 * details are staff-only and must never travel to a browser. The
 * methods that stay visible on the corporate page keep their
 * account number because the hotel already publishes them there.
 */
export interface PublicPaymentMethod {
  method: string;
  label: string;
  accountName: string;
  accountNumber: string;
  qrUrl: string;
  isEnabled: boolean;
  showInCorporate: boolean;
  showInStore: boolean;
  requireReferenceNumber: boolean;
}

export interface PublicBedSetupOption {
  value: string;
  label: string;
  icon?: string;
}

export interface PublicBookingPreferenceOption {
  value: string;
  label: string;
  icon?: string;
  surchargeNote?: string;
}

export interface PublicVatConfig {
  enabled: boolean;
}

/**
 * The public projection of `settings/hotelConfig`.
 *
 * Every field here is rendered somewhere on the public site or in the
 * guest booking flow. Nothing here is negotiated pricing, a bank
 * detail, PII, or a staff-only setting.
 */
export interface PublicHotelConfig {
  brandName: string;
  address: string;
  frontDeskPhone: string;
  supportEmail: string;
  dpoEmail: string;
  facebookUrl: string;
  instagramUrl: string;
  twitterHandle: string;
  checkInTime: string;
  checkOutTime: string;
  /** Per DSC-01..05: whether a Senior / PWD guest may book online. */
  seniorPwdOnlineEnabled: boolean;
  vatConfig: PublicVatConfig;
  /** `null` = "the admin never set a cap" (the consumer applies the default). */
  maxStayNights: number | null;
  /** Per OCT-M1 (decision #295): the hotel-wide add-ons master switch. */
  otherAddOnsEnabled: boolean;
  /**
   * Per QA-2026-10-23 §3.2 (2026-10-25): the hotel-wide bot-protection
   * mode, projected so the GUEST CLIENT can honour the same switch the
   * server honours.
   *
   * "turnstile" = the Cloudflare Turnstile gate applies (the default);
   * "disabled" = the gate is off for a testing window. The value is
   * normalised with `normalizeBotProtectionMode` — it is never a
   * client-controlled value, and anything unrecognised (including
   * `undefined` — an older server that does not project it) resolves to
   * "turnstile", so the gate stays ON.
   */
  botProtectionMode?: BotProtectionMode;
  roomTypes: PublicRoomType[];
  seasonalRateOverrides: SeasonalRateOverride[];
  bedSetups: PublicBedSetupOption[];
  bookingPreferences: PublicBookingPreferenceOption[];
  paymentMethods: PublicPaymentMethod[];
  /**
   * The in-room intercom quick-request list
   * (`settings/hotelConfig.intercomQuickRequests[]`).
   */
  intercomQuickRequests: string[];
  /**
   * The hotel's Spark Essentials store master switch
   * (`settings/storeConfig.isEnabled`). Read from the store config
   * doc server-side — the raw doc also holds an admin-only
   * `lowStockThreshold` and legacy store payment methods, so the
   * guest never reads it directly.
   */
  storeEnabled: boolean;
}

/**
 * The published flat corporate rate card served to the corporate
 * booking path (`GET /api/corporate/rates`).
 *
 * Per `plan/features/RATE-MANAGEMENT.md` the flat corporate rate is
 * the hotel's PUBLISHED rate ("This is the public rate at
 * `/corporate/book`"), and the booking server applies it to any
 * corporate booking that carries the `corporateFlatRate` intent flag
 * (or a validated access code). It is served from the server so the
 * ladder never ships inside the guest's JavaScript bundle.
 *
 * The NEGOTIATED per-company rates (`corporateCodes.ratePerRoomType`)
 * are NOT part of this payload — they stay behind
 * `POST /api/validate/corporate-code` and the staff-only
 * `corporateCodes` rules.
 */
export interface PublicCorporateRates {
  ratePerRoomType: Record<string, number>;
}
