// Per F09 / SEC-6 (2026-10-22, P2 revenue leak): the public
// projection of `settings/hotelConfig`.
//
// The rules used to allow an ANONYMOUS read of every `settings/*`
// document, so `settings/hotelConfig` — the hotel's negotiated
// corporate rate ladder (`roomTypes[].corporateRate`) plus the bank
// details of the payment methods — was world-readable straight from
// the browser. The rules now close that read (staff read / admin
// write) and the guest site reads the hotel's public content through
// `GET /api/public/hotel-config` instead.
//
// This module is the SINGLE read-side boundary for that payload:
//
//   - it is an explicit ALLOW-list, so a field added to
//     `settings/hotelConfig` later cannot leak by accident;
//   - `corporateRate` is dropped from every room type;
//   - `accountNumber` is dropped from every payment method the admin
//     hid from the corporate surface (`showInCorporate === false`).
//
// Server-only (it reads Firestore through the Admin SDK). The pure
// projection function is exported separately so it can be unit-tested
// without a Firestore connection.

import type {
  PublicBookingPreferenceOption,
  PublicBedSetupOption,
  PublicHotelConfig,
  PublicPaymentMethod,
  PublicRoomType,
  PublicVatConfig,
  SeasonalRateOverride
} from "@spark-inn/shared";
import { normalizeBotProtectionMode, type BotProtectionMode } from "@spark-inn/shared";
import { adminDb } from "./firebase-admin";

const DEFAULT_VAT_ENABLED = true;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function buildRoomTypes(raw: unknown): PublicRoomType[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicRoomType[] = [];
  for (const entry of raw) {
    const type = asRecord(entry);
    const value = asString(type.value);
    if (!value) continue;
    out.push({
      value,
      label: asString(type.label, value),
      shortLabel: asString(type.shortLabel, asString(type.label, value)),
      imageUrls: asStringArray(type.imageUrls),
      bedDefinition: asString(type.bedDefinition),
      description: asString(type.description),
      amenities: asStringArray(type.amenities),
      maxCapacity: asNumber(type.maxCapacity, 1),
      maxChildren: asNumber(type.maxChildren, 0),
      pricePerNight: asNumber(type.pricePerNight, 0),
      weekendRate: asNumber(type.weekendRate, 0),
      maxExtraBeds: asNumber(type.maxExtraBeds, 0),
      extraBedRate: asNumber(type.extraBedRate, 0),
      bedSetupValues: asStringArray(type.bedSetupValues),
      // Per F09 / SEC-6: `corporateRate` is DELIBERATELY not copied.
      // The negotiated corporate ladder never reaches a browser
      // through this payload.
    });
  }
  return out;
}

function buildPaymentMethods(raw: unknown): PublicPaymentMethod[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicPaymentMethod[] = [];
  for (const entry of raw) {
    const method = asRecord(entry);
    const key = asString(method.method);
    if (!key) continue;
    // Per #111: the flag defaults to `true` when missing (pre-#111
    // entries are treated as visible on every surface).
    const showInCorporate = asBoolean(method.showInCorporate, true);
    out.push({
      method: key,
      label: asString(method.label, key),
      accountName: asString(method.accountName),
      // Per F09 / SEC-6: the account number of a method the admin hid
      // from the corporate surface is staff-only and is dropped here.
      // The methods that stay visible on `/corporate/book` keep their
      // account number — the hotel already publishes those.
      accountNumber: showInCorporate ? asString(method.accountNumber) : "",
      qrUrl: asString(method.qrUrl),
      isEnabled: asBoolean(method.isEnabled, true),
      showInCorporate,
      showInStore: asBoolean(method.showInStore, true),
      requireReferenceNumber: asBoolean(method.requireReferenceNumber, false)
    });
  }
  return out;
}

function buildSeasonalRateOverrides(raw: unknown): SeasonalRateOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: SeasonalRateOverride[] = [];
  for (const entry of raw) {
    const override = asRecord(entry);
    const id = asString(override.id);
    if (!id) continue;
    out.push({
      id,
      name: asString(override.name),
      startDate: asString(override.startDate),
      endDate: asString(override.endDate),
      rate: asNumber(override.rate, 0),
      roomTypeValues: asStringArray(override.roomTypeValues),
      isActive: asBoolean(override.isActive, true)
    });
  }
  return out;
}

function buildBedSetups(raw: unknown): PublicBedSetupOption[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicBedSetupOption[] = [];
  for (const entry of raw) {
    const option = asRecord(entry);
    const value = asString(option.value);
    const label = asString(option.label);
    if (!value || !label) continue;
    const icon = asString(option.icon);
    out.push({ value, label, ...(icon ? { icon } : {}) });
  }
  return out;
}

function buildBookingPreferences(raw: unknown): PublicBookingPreferenceOption[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicBookingPreferenceOption[] = [];
  for (const entry of raw) {
    const option = asRecord(entry);
    const value = asString(option.value);
    const label = asString(option.label);
    if (!value || !label) continue;
    const icon = asString(option.icon);
    const surchargeNote = asString(option.surchargeNote);
    out.push({
      value,
      label,
      ...(icon ? { icon } : {}),
      ...(surchargeNote ? { surchargeNote } : {})
    });
  }
  return out;
}

function buildVatConfig(raw: unknown): PublicVatConfig {
  const vat = asRecord(raw);
  return { enabled: asBoolean(vat.enabled, DEFAULT_VAT_ENABLED) };
}

/**
 * The public projection of `settings/hotelConfig` + the hotel-wide
 * bot-protection mode.
 *
 * Per QA-2026-10-23 §3.2 (2026-10-25): the guest client has to honour
 * the SAME switch the server honours, and the raw
 * `settings/hotelConfig` document is not readable by an anonymous
 * client — so the mode travels in the public projection.
 *
 * The mode is NORMALISED here with the shared normaliser, so the
 * server and the client can never disagree about what "off" means: a
 * malformed value projects as "turnstile" (the gate stays ON), never as
 * "disabled".
 *
 * The field itself is declared on the SHARED `PublicHotelConfig` type
 * (`shared/types/publicHotelConfig.ts`), so the server's projection and
 * the guest client's reader are the same shape.
 */
export type PublicHotelConfigProjection = PublicHotelConfig;

/**
 * Build the public projection of a raw `settings/hotelConfig`
 * payload. Pure — no Firestore, no clock, no env.
 *
 * `options.storeEnabled` carries the `settings/storeConfig.isEnabled`
 * master switch (a separate document); it defaults to `true` so a
 * missing store config keeps the store visible.
 */
export function buildPublicHotelConfig(
  source: unknown,
  options?: { storeEnabled?: boolean }
): PublicHotelConfigProjection {
  const config = asRecord(source);
  const rawMaxStayNights = config.maxStayNights;
  return {
    brandName: asString(config.brandName),
    address: asString(config.address),
    frontDeskPhone: asString(config.frontDeskPhone),
    supportEmail: asString(config.supportEmail),
    dpoEmail: asString(config.dpoEmail),
    facebookUrl: asString(config.facebookUrl),
    instagramUrl: asString(config.instagramUrl),
    twitterHandle: asString(config.twitterHandle),
    checkInTime: asString(config.checkInTime),
    checkOutTime: asString(config.checkOutTime),
    seniorPwdOnlineEnabled: asBoolean(config.seniorPwdOnlineEnabled, true),
    vatConfig: buildVatConfig(config.vatConfig),
    // `null` = "the admin never set a cap" — the consumer applies the
    // documented default. A stored `0` is the admin's explicit
    // "no limit" choice and is preserved verbatim.
    maxStayNights:
      rawMaxStayNights === undefined || rawMaxStayNights === null || rawMaxStayNights === ""
        ? null
        : Number.isFinite(Number(rawMaxStayNights)) && Number(rawMaxStayNights) >= 0
          ? Number(rawMaxStayNights)
          : null,
    // Per OCT-M1 (decision #295): only an explicit `false` disables
    // the add-ons category.
    otherAddOnsEnabled: asBoolean(config.otherAddOnsEnabled, true),
    // Per QA-2026-10-23 §3.2 (2026-10-25): the hotel-wide
    // bot-protection mode. Normalised with the SHARED normaliser so a
    // malformed / missing value projects as "turnstile" — the gate
    // stays ON (fail closed) on both sides.
    botProtectionMode: normalizeBotProtectionMode(config.botProtectionMode),
    roomTypes: buildRoomTypes(config.roomTypes),
    seasonalRateOverrides: buildSeasonalRateOverrides(config.seasonalRateOverrides),
    bedSetups: buildBedSetups(config.bedSetups),
    bookingPreferences: buildBookingPreferences(config.bookingPreferences),
    paymentMethods: buildPaymentMethods(config.paymentMethods),
    intercomQuickRequests: asStringArray(config.intercomQuickRequests),
    storeEnabled: options?.storeEnabled !== false
  };
}

/**
 * Read `settings/hotelConfig` (and the `settings/storeConfig` master
 * switch) through the Admin SDK and project them.
 * The Admin SDK bypasses the Firestore rules on purpose — the rules
 * now keep the raw documents away from unauthenticated clients, and
 * this server-side read is what serves the public slice of them.
 */
export async function loadPublicHotelConfig(): Promise<PublicHotelConfigProjection> {
  const [hotelSnapshot, storeSnapshot] = await Promise.all([
    adminDb.collection("settings").doc("hotelConfig").get(),
    adminDb.collection("settings").doc("storeConfig").get()
  ]);
  const storeConfig = storeSnapshot.exists ? asRecord(storeSnapshot.data()) : {};
  return buildPublicHotelConfig(hotelSnapshot.exists ? hotelSnapshot.data() : null, {
    storeEnabled: storeConfig.isEnabled !== false
  });
}
