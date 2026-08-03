import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const bookingPageSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingPage.tsx"),
  "utf8"
);

const roomTypesHookSrc = readFileSync(
  resolve(__dirname, "../../src/hooks/useRoomTypes.ts"),
  "utf8"
);

describe("CHD-05 — guest child-cap guidance and room-charge clarity", () => {
  it("preserves and normalizes child-cap and extra-bed fields from live settings", () => {
    expect(roomTypesHookSrc).toMatch(/applyRoomTypeDefaults/);
    expect(roomTypesHookSrc).toMatch(/maxChildren:\s*entry\.maxChildren/);
    expect(roomTypesHookSrc).toMatch(
      /maxExtraBeds:\s*entry\.maxExtraBeds \?\? fallback\?\.maxExtraBeds/
    );
    expect(roomTypesHookSrc).toMatch(
      /extraBedRate:\s*entry\.extraBedRate \?\? fallback\?\.extraBedRate/
    );
  });

  it("uses the shared overflow helper that the server enforces", () => {
    expect(bookingPageSrc).toMatch(
      /calculateExtraBedAddOn,[\s\S]{0,100}requiredExtraBedsFor[\s\S]{0,100}from "@spark-inn\/shared"/
    );
    expect(bookingPageSrc).toMatch(
      /const selectedOccupancyOverflow = requiredExtraBedsFor\(\{[\s\S]{0,220}numAdults,[\s\S]{0,100}numChildren,[\s\S]{0,100}maxCapacity:\s*selectedMaxCapacity,[\s\S]{0,100}maxChildren:\s*selectedMaxChildren/
    );
  });

  it("keeps available types visible and distributes occupancy per selected room", () => {
    const availabilityBlock = bookingPageSrc.match(
      /const availableRoomTypes = useMemo\([\s\S]*?\n\s*\);/
    );
    expect(availabilityBlock).toBeTruthy();
    expect(availabilityBlock![0]).toMatch(/entry\.availableCount > 0/);
    expect(bookingPageSrc).toMatch(
      /rebalanceGuestDistribution\(roomCart, roomTypes, numAdults, numChildren\)/
    );
    expect(bookingPageSrc).toMatch(
      /distributedRoomCart\.every\(\(room\) => room\.numAdults >= 1\)/
    );
  });

  it("includes adult, child, and extra-bed allowances in the page-level guest ceiling", () => {
    expect(bookingPageSrc).toMatch(
      /const maxGuestCapacity = useMemo\([\s\S]{0,500}type\.maxCapacity[\s\S]{0,160}type\.maxChildren[\s\S]{0,160}type\.maxExtraBeds/
    );
  });

  it("derives the highest child split supported by the selected room", () => {
    const maxChildrenBlock = bookingPageSrc.match(
      /const selectedMaxSelectableChildren = useMemo\([\s\S]*?\n\s*\}, \[guests, selectedMaxExtraBeds, selectedTypeEntry\]\);/
    );
    expect(maxChildrenBlock).toBeTruthy();
    expect(maxChildrenBlock![0]).toMatch(/children <= Math\.max\(0, guests - 1\)/);
    expect(maxChildrenBlock![0]).toMatch(/numAdults:\s*guests - children/);
    expect(maxChildrenBlock![0]).toMatch(
      /overflow\.requiredExtraBeds <= selectedMaxExtraBeds/
    );
  });

  it("caps the child stepper visibly and explains the selected room's limit", () => {
    expect(bookingPageSrc).toMatch(/Children \(0–11\)/);
    expect(bookingPageSrc).toMatch(
      /updateChildren\(numChildren \+ 1\)/
    );
    expect(bookingPageSrc).toMatch(
      /numChildren >= selectedMaxSelectableChildren/
    );
    expect(bookingPageSrc).toMatch(/id="children-cap-help"/);
    expect(bookingPageSrc).toMatch(/aria-describedby="children-cap-help"/);
    expect(bookingPageSrc).toMatch(/You have reached this room type’s limit for the current group/);
  });

  it("states that children are free of the room charge in the picker and price summary", () => {
    expect(bookingPageSrc).toMatch(/Children stay free of the room charge/);
    expect(bookingPageSrc).toMatch(/Children’s room charge/);
    expect(bookingPageSrc).toMatch(/Included at no extra room cost/);
    expect(bookingPageSrc).toMatch(
      /Children’s room charge[\s\S]{0,300}\{formatPrice\(0\)\}/
    );
  });

  it("shows per-room extra-bed allocation and a clear incomplete-distribution next step", () => {
    expect(bookingPageSrc).toMatch(/room\.extraBedCount > 0/);
    expect(bookingPageSrc).toMatch(/room\.extraBedCount\} extra bed/);
    expect(bookingPageSrc).toMatch(/!cartDistributionComplete/);
    expect(bookingPageSrc).toMatch(/Add enough rooms to place every guest/);
    expect(bookingPageSrc).toMatch(/role="status"/);
    expect(bookingPageSrc).toMatch(/aria-live="polite"/);
  });

  it("does not let the guest continue until every room assignment is valid", () => {
    expect(bookingPageSrc).toMatch(/cartIsReady \? \([\s\S]{0,300}Continue to Step 2/);
    expect(bookingPageSrc).toMatch(
      /disabled[\s\S]{0,200}aria-describedby="step-one-occupancy-error"/
    );
    expect(bookingPageSrc).toMatch(/Add enough available rooms to fit every guest/);
  });

  it("persists the distributed room cart across booking-step URLs", () => {
    expect(bookingPageSrc).toMatch(
      /extraBedCount[\s\S]{0,100}searchParams\.get\("extraBeds"\)/
    );
    const continueParams = bookingPageSrc.match(
      /const continueParams = new URLSearchParams\(\{[\s\S]*?\}\);/
    );
    expect(continueParams).toBeTruthy();
    expect(continueParams![0]).toMatch(/children:\s*String\(numChildren\)/);
    expect(continueParams![0]).toMatch(/extraBeds:\s*String\(extraBedCount\)/);
    expect(bookingPageSrc).toMatch(
      /continueParams\.set\("rooms", serializeBookingRoomCart\(distributedRoomCart\)\)/
    );
  });

  it("keeps every touched occupancy control at least 44px", () => {
    const childrenBlock = bookingPageSrc.slice(
      bookingPageSrc.indexOf("Children (0–11)"),
      bookingPageSrc.indexOf("children-cap-help") + 100
    );
    expect(childrenBlock.match(/h-11 w-11/g)).toHaveLength(2);

    expect(bookingPageSrc).toMatch(
      /aria-label=\{`Remove one \$\{type\.label\} room`\}[\s\S]{0,180}h-11 w-11/
    );
    expect(bookingPageSrc).toMatch(
      /aria-label=\{`Add one \$\{type\.label\} room`\}[\s\S]{0,180}h-11 w-11/
    );
  });
});
