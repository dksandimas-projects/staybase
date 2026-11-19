import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per RAR-01 (2026-11-19, decision #323): the pre-assigned room
// OVERRIDE.
//
// The problem this closes: the server AUTO-ASSIGNS a room when a
// booking is created, but the post-verify success modal showed only
// the room TYPE (the desk's screenshot read "Room: superior"). The
// desk could not CHECK which physical room the guest was booked
// into, and had no way to CORRECT the assignment when it was wrong.
//
// The contract this suite pins:
//
//   1. The success modal SHOWS the pre-assigned room NUMBER.
//   2. The desk can OVERRIDE it, re-pointing the booking at
//      another room of the SAME CATEGORY.
//   3. THE PRICE DOES NOT MOVE. The request body carries no dates
//      and no price, the server reads both from the booking, and
//      the write contains no money field at all. "The price stays
//      the same" has to be structural, not a promise.
//   4. A different CATEGORY is refused — that is the drawer's
//      "Move / upgrade room" action, which re-prices deliberately.
//   5. The change is AUDITABLE (`rescheduleHistory[]`,
//      `kind: "room"`).
//   6. No GUEST EMAIL — the room number is never sent to a guest
//      and the type + dates do not change.
//
// These are source-text guards (the repo's convention for admin
// surfaces). The endpoint's behaviour is pinned by
// `guest-app/tests/api/bookings-assign-room.test.ts`.

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/BookingsPage.tsx"),
  "utf8"
);
const dashboardPageSrc = readFileSync(
  resolve(__dirname, "../pages/DashboardPage.tsx"),
  "utf8"
);
const paymentSuccessModalSrc = readFileSync(
  resolve(__dirname, "../components/PaymentSuccessModal.tsx"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);
const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/bookings.ts"),
  "utf8"
);
const apiRouterSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/apiRouter.ts"),
  "utf8"
);
const assignRoomSchemaSrc = readFileSync(
  resolve(__dirname, "../../../shared/schemas/booking.ts"),
  "utf8"
);

describe("RAR-01 §1 — the success modal shows the pre-assigned room number", () => {
  it("the modal renders a room-assignment section", () => {
    expect(paymentSuccessModalSrc).toMatch(/Room assignment/);
    expect(paymentSuccessModalSrc).toMatch(/Pre-assigned at booking/);
  });

  it("the modal renders the room NUMBER of each room in the scope", () => {
    expect(paymentSuccessModalSrc).toMatch(/Room \{\s*assignment\.roomNumber\s*\}/);
  });

  it("the modal's room-assignment props are part of its public contract", () => {
    expect(paymentSuccessModalSrc).toMatch(/roomAssignments\?:\s*RoomAssignment\[\]/);
    expect(paymentSuccessModalSrc).toMatch(/assignableRooms\?:\s*AssignableRoom\[\]/);
    expect(paymentSuccessModalSrc).toMatch(/onAssignRoom\?:/);
  });

  it("both surfaces pass the scope's room assignments into the modal", () => {
    expect(bookingsPageSrc).toMatch(/roomAssignments=\{verifySuccess\?\.roomAssignments\}/);
    expect(dashboardPageSrc).toMatch(/roomAssignments=\{verifySuccess\?\.roomAssignments\}/);
  });

  it("both surfaces build the assignments from the scope's rooms", () => {
    expect(bookingsPageSrc).toMatch(/roomAssignments:\s*selectedVerifyScopeRooms\.map/);
    expect(dashboardPageSrc).toMatch(/roomAssignments:\s*\(verifyScope\?\.rooms \?\? \[\]\)\.map/);
  });

  it("the room-type LABEL is used, never the raw type key", () => {
    // The desk's screenshot read "Room: superior" — the raw type
    // key. The label comes from the hotel's configured room types.
    expect(bookingsPageSrc).toMatch(/roomTypeLabels\[String\(verifySuccess\.booking\.roomType/);
    expect(dashboardPageSrc).toMatch(/dashboardRoomTypeLabels\[String\(verifySuccess\.booking\.roomType/);
  });
});

describe("RAR-01 §2 — the desk can override the assignment", () => {
  it("the modal offers a Change control and an Apply action", () => {
    expect(paymentSuccessModalSrc).toMatch(/startEditing\(assignment\)/);
    expect(paymentSuccessModalSrc).toMatch(/applyAssignment/);
    expect(paymentSuccessModalSrc).toMatch(/>\s*Change\s*</);
    expect(paymentSuccessModalSrc).toMatch(/"Apply"/);
  });

  it("the picker only offers rooms of the SAME category, and never the room already held", () => {
    expect(paymentSuccessModalSrc).toMatch(
      /r\.type === assignment\.roomType && r\.id !== assignment\.roomId/
    );
  });

  it("the candidate list skips inactive rooms", () => {
    expect(paymentSuccessModalSrc).toMatch(/r\.isActive &&/);
  });

  it("the admin context exposes the assign-room call", () => {
    expect(adminContextSrc).toMatch(/assignBookingRoom/);
    expect(adminContextSrc).toMatch(/\/api\/bookings\/assign-room/);
  });

  it("the admin context sends ONLY the booking, the room and a reason", () => {
    // No dates, no price — the request physically cannot express a
    // change to either.
    expect(adminContextSrc).toMatch(/body:\s*JSON\.stringify\(\{\s*bookingId: input\.bookingId,\s*roomId: input\.roomId,\s*reason: input\.reason \|\| ""\s*\}\)/);
  });

  it("both surfaces wire the override handler into the modal", () => {
    expect(bookingsPageSrc).toMatch(/onAssignRoom=\{handleAssignRoom\}/);
    expect(dashboardPageSrc).toMatch(/onAssignRoom=\{handleAssignRoom\}/);
  });

  it("the drawer reflects the new room immediately after the override", () => {
    expect(bookingsPageSrc).toMatch(
      /setSelectedBooking\(\(previous\) =>\s*\n?\s*previous && previous\.id === bookingId/
    );
  });
});

describe("RAR-01 §3 — the price cannot move", () => {
  it("the request schema carries no date and no price field", () => {
    const schema = assignRoomSchemaSrc.slice(
      assignRoomSchemaSrc.indexOf("export const AssignRoomSchema"),
      assignRoomSchemaSrc.indexOf("export type AssignRoomInput")
    );
    expect(schema).toMatch(/bookingId/);
    expect(schema).toMatch(/roomId/);
    expect(schema).not.toMatch(/checkIn/);
    expect(schema).not.toMatch(/checkOut/);
    expect(schema).not.toMatch(/totalPrice|price|amount/i);
  });

  it("the server writes the room identity and NOTHING else", () => {
    const handler = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom"),
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom") + 9000
    );
    const write = handler.slice(
      handler.indexOf("transaction.update(bookingRef"),
      handler.indexOf("transaction.update(bookingRef") + 900
    );
    // The room identity + the audit trail + the timestamp.
    expect(write).toMatch(/roomId:/);
    expect(write).toMatch(/roomNumber:/);
    expect(write).toMatch(/rescheduleHistory:/);
    expect(write).toMatch(/updatedAt:/);
    // …and NOT one money field.
    expect(write).not.toMatch(/totalPrice/);
    expect(write).not.toMatch(/ratePerNight/);
    expect(write).not.toMatch(/rateBreakdown/);
    expect(write).not.toMatch(/originalTotalPrice/);
    expect(write).not.toMatch(/voucherDiscount/);
    expect(write).not.toMatch(/revenueAllocation/);
    expect(write).not.toMatch(/checkIn:|checkOut:/);
  });

  it("the server reads the stay window from the BOOKING, not from the body", () => {
    const handler = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom"),
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom") + 9000
    );
    expect(handler).toMatch(/toDateOrNull\(booking\.checkIn\)/);
    expect(handler).toMatch(/toDateOrNull\(booking\.checkOut\)/);
  });

  it("the server refuses a different room CATEGORY", () => {
    const handler = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom"),
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom") + 9000
    );
    expect(handler).toMatch(/targetRoomType !== currentRoomType/);
    expect(handler).toMatch(/Room category cannot be changed here/);
  });

  it("the server checks the target room's availability for the stay window", () => {
    const handler = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom"),
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom") + 9000
    );
    expect(handler).toMatch(/getOccupancyConflictReason/);
    expect(handler).toMatch(/hasActiveRoomBlockConflict/);
    // The booking itself is excluded from the occupancy scan.
    expect(handler).toMatch(/if \(doc\.id === String\(bookingId\)\) continue;/);
  });

  it("the endpoint is routed and staff-authenticated", () => {
    expect(apiRouterSrc).toMatch(/domain === "bookings" && action === "assign-room"/);
    expect(apiRouterSrc).toMatch(/handleAssignBookingRoom/);
  });
});

describe("RAR-01 §4 — the change is auditable and guest-safe", () => {
  it("the server appends a rescheduleHistory entry with kind \"room\"", () => {
    const handler = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom"),
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom") + 9000
    );
    expect(handler).toMatch(/kind:\s*"room"/);
    expect(handler).toMatch(/pricingBasis:\s*"preserved"/);
    expect(handler).toMatch(/deltaTotalPrice:\s*0/);
  });

  it("the server fires NO guest email", () => {
    const handler = bookingsHandlerSrc.slice(
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom"),
      bookingsHandlerSrc.indexOf("export async function handleAssignBookingRoom") + 9000
    );
    expect(handler).not.toMatch(/sendBookingTrigger|sendEmail/);
  });

  it("the picker explains the same-category rule to the desk", () => {
    expect(paymentSuccessModalSrc).toMatch(/Same category only/);
    expect(paymentSuccessModalSrc).toMatch(/price does not change/);
  });

  it("the picker collects a reason for the audit trail", () => {
    expect(paymentSuccessModalSrc).toMatch(/Reason \(audit trail\)/);
  });
});

describe("RAR-01 §5 — the touch targets meet the 44px rule", () => {
  it("every control in the room-assignment section is at least 44px tall", () => {
    const section = paymentSuccessModalSrc.slice(
      paymentSuccessModalSrc.indexOf("Room assignment"),
      paymentSuccessModalSrc.indexOf("Email-sent confirmation")
    );
    const controls = section.match(/min-h-\[?\d+px\]?|min-h-11/g) || [];
    // The select, the reason input, the Change button, the Cancel
    // button and the Apply button.
    expect(controls.length).toBeGreaterThanOrEqual(5);
    expect(section).not.toMatch(/min-h-\[(?!44px|4[5-9]px|5\dpx)\d+px\]/);
  });
});
