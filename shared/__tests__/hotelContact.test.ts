// Per HC-01 (decision #328, 2026-11-20): the hotel's CONTACT details
// have ONE source of truth — `settings/hotelConfig` — with
// `hotel.config.ts` as the deploy-time fallback.
//
// This suite pins the PURE resolver (`shared/utils/hotelContact.ts`)
// that every surface now goes through: the guest site, the guest
// EMAILS, the receipt PDF and the admin app.
//
// THE DEFECTS IT PINS
// -------------------
//
//   1. THE TWO ADDRESS SHAPES DID NOT AGREE. `hotel.config.ts` stores
//      a structured `{ street, city, region, postalCode }` object;
//      `settings/hotelConfig` stores the address the admin typed —
//      one STRING. The email footer rendered the OBJECT as
//      `street, city, region, postalCode` (with a comma before the
//      postal code) while the site rendered `street, city, region
//      postalCode` (without one). Same hotel, two different
//      addresses on two different surfaces.
//
//   2. THE EMAILS READ THE DEPLOY-TIME VALUES. The guest site read
//      the runtime document; `email.ts` imported `hotel.config.ts`
//      directly. A hotel that corrected its phone number in the admin
//      app still emailed guests the old number.
//
//   3. THE LEGACY FIELDS WERE STILL ON THE DOCUMENT. `contactEmail`
//      / `contactPhone` are the pre-Phase-11.8 field names. The admin
//      stopped writing them, production still carries their
//      placeholder values (`sparkinn.dev@gmail.com` /
//      `+63-38-000-0000`), and reading them would resurrect exactly
//      the stale values this change removes.

import { describe, expect, it } from "vitest";
import { formatHotelAddress, resolveHotelContact } from "../utils/hotelContact";

/** The deploy-time shape (`hotel.config.ts`). */
const DEPLOY_TIME = {
  address: {
    street: "J. Borja St",
    city: "Tagbilaran City",
    region: "Bohol",
    postalCode: "6300"
  },
  frontDeskPhone: "+63-38-000-0000",
  supportEmail: "sparkinn.dev@gmail.com",
  dpoEmail: "sparkinn.reservations@gmail.com"
};

/** The runtime shape (`settings/hotelConfig`) — what production holds. */
const RUNTIME = {
  address: "J. Borja St, Poblacion II, Tagbilaran City, Bohol, 6300",
  frontDeskPhone: "09619863021",
  supportEmail: "sparkinn.reservations@gmail.com",
  dpoEmail: ""
};

describe("HC-01 — formatHotelAddress", () => {
  it("returns a string address verbatim (trimmed)", () => {
    expect(formatHotelAddress("  Panglao, Bohol  ")).toBe("Panglao, Bohol");
  });

  it("renders the structured object in the same order + separator as the string form", () => {
    // The comma before the postal code is the point: the guest site's
    // fallback used `region + " " + postalCode` while the email used
    // `region + ", " + postalCode`. One shape now.
    expect(formatHotelAddress(DEPLOY_TIME.address)).toBe(
      "J. Borja St, Tagbilaran City, Bohol, 6300"
    );
  });

  it("skips the empty parts of a partial object", () => {
    expect(formatHotelAddress({ street: "J. Borja St", city: "", region: "Bohol" })).toBe(
      "J. Borja St, Bohol"
    );
  });

  it("returns an empty string for a missing / non-object / non-string value", () => {
    expect(formatHotelAddress(undefined)).toBe("");
    expect(formatHotelAddress(null)).toBe("");
    expect(formatHotelAddress(42)).toBe("");
    expect(formatHotelAddress({})).toBe("");
  });
});

describe("HC-01 — resolveHotelContact", () => {
  it("prefers the runtime values over the deploy-time ones", () => {
    const contact = resolveHotelContact(RUNTIME, DEPLOY_TIME);
    expect(contact.address).toBe("J. Borja St, Poblacion II, Tagbilaran City, Bohol, 6300");
    expect(contact.frontDeskPhone).toBe("09619863021");
    expect(contact.supportEmail).toBe("sparkinn.reservations@gmail.com");
    // The production document carries a BLANK `dpoEmail` (the admin
    // never set one), so the deploy-time value is used — exactly the
    // rule the guest site's `pickString` already applied to
    // `contact.dpoEmail`.
    expect(contact.dpoEmail).toBe("sparkinn.reservations@gmail.com");
  });

  it("falls back to the deploy-time value for a field the runtime document does not carry", () => {
    const contact = resolveHotelContact(
      { address: RUNTIME.address, frontDeskPhone: RUNTIME.frontDeskPhone },
      DEPLOY_TIME
    );
    expect(contact.supportEmail).toBe("sparkinn.dev@gmail.com");
    expect(contact.dpoEmail).toBe("sparkinn.reservations@gmail.com");
  });

  it("falls back to the deploy-time value when the runtime field is blank", () => {
    // An admin who clears the phone in Settings → Hotel Info gets the
    // deploy-time value back rather than a blank line — the same rule
    // the guest site's `pickString` already used.
    const contact = resolveHotelContact(
      { ...RUNTIME, frontDeskPhone: "   ", supportEmail: "" },
      DEPLOY_TIME
    );
    expect(contact.frontDeskPhone).toBe("+63-38-000-0000");
    expect(contact.supportEmail).toBe("sparkinn.dev@gmail.com");
  });

  it("returns an empty string (not undefined) for every field when there is no source at all", () => {
    const contact = resolveHotelContact(null);
    expect(contact).toEqual({
      address: "",
      frontDeskPhone: "",
      supportEmail: "",
      dpoEmail: ""
    });
  });

  it("survives a malformed runtime document", () => {
    const contact = resolveHotelContact("not an object", DEPLOY_TIME);
    expect(contact.address).toBe("J. Borja St, Tagbilaran City, Bohol, 6300");
    expect(contact.frontDeskPhone).toBe("+63-38-000-0000");
  });

  it("NEVER reads the legacy contactEmail / contactPhone fields", () => {
    // The document in production still carries them with their
    // placeholder values. Reading them would resurrect exactly the
    // stale details this change removes.
    const contact = resolveHotelContact(
      {
        address: RUNTIME.address,
        frontDeskPhone: RUNTIME.frontDeskPhone,
        supportEmail: RUNTIME.supportEmail,
        contactEmail: "legacy@example.com",
        contactPhone: "+63-38-000-0000"
      },
      DEPLOY_TIME
    );
    expect(contact.supportEmail).toBe("sparkinn.reservations@gmail.com");
    expect(contact.frontDeskPhone).toBe("09619863021");
    expect(JSON.stringify(contact)).not.toContain("legacy@example.com");
  });

  it("produces the SAME address for the string shape and the object shape", () => {
    const fromString = resolveHotelContact(
      { address: "J. Borja St, Tagbilaran City, Bohol, 6300" },
      DEPLOY_TIME
    );
    const fromObject = resolveHotelContact({ address: DEPLOY_TIME.address }, DEPLOY_TIME);
    expect(fromString.address).toBe(fromObject.address);
  });
});
