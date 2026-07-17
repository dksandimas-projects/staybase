import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for SEV-1 (Phase 2 W2.14 #102): the Booking type and
// the handleCreateBooking + handleCreateWalkin handlers must accept and
// persist a `linkedInquiryId` field, set when the booking is created
// from a converted corporate inquiry. Per W2.14 / decision #102.

describe("bookings.ts — linkedInquiryId on booking doc (decision #102)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../server/handlers/bookings.ts"),
    "utf8"
  );

  it("createBookingSchema includes linkedInquiryId", () => {
    const schemaStart = src.indexOf("const createBookingSchema");
    const schemaEnd = src.indexOf("}).strict();", schemaStart);
    const schemaBody = src.slice(schemaStart, schemaEnd);
    expect(schemaBody).toMatch(/linkedInquiryId:\s*z\.string\(\).*\.nullable\(\)\.optional\(\)/);
  });

  it("handleCreateBooking destructures linkedInquiryId from the body", () => {
    const fnStart = src.indexOf("export async function handleCreateBooking");
    const fnEnd = src.indexOf("\n  if (!bookingId || !roomId || !checkIn || !checkOut || !guests || !guestDetails) {", fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/linkedInquiryId/);
  });

  it("handleCreateWalkin destructures linkedInquiryId from the body", () => {
    const fnStart = src.indexOf("export async function handleCreateWalkin");
    const fnEnd = src.indexOf("\n  if (!bookingId || !roomId || !checkIn || !checkOut || !guests || !guestDetails) {", fnStart);
    const fnBody = src.slice(fnStart, fnEnd);
    expect(fnBody).toMatch(/linkedInquiryId/);
  });

  it("the newBooking write for create includes linkedInquiryId", () => {
    expect(src).toMatch(/linkedInquiryId:\s*linkedInquiryId\s*\|\|\s*null/);
  });
});
