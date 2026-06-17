import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression test for Phase 11.6 Batch 9 — audit S4.2: a staff
// member can convert a `new` / `contacted` / `negotiating`
// corporate inquiry into a real bookings document. The server
// creates the booking pre-filled from the inquiry, links it
// back via `linkedInquiryId`, and flips the inquiry status to
// `converted` + appends a note + persists the back-link IDs.
//
// Source-pattern tests cover both the server handler and the
// client wiring.

const routeSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/api/[...route].ts"),
  "utf8"
);
const handlerSrc = readFileSync(
  resolve(__dirname, "../../../guest-app/server/handlers/corporate-inquiries.ts"),
  "utf8"
);
const adminContextSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/context/AdminContext.tsx"),
  "utf8"
);
const inquiryPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/CorporateInquiriesPage.tsx"),
  "utf8"
);

describe("Phase 11.6 Batch 9 — convert corporate inquiry to booking (audit S4.2)", () => {
  describe("server route + handler", () => {
    it("imports the new handleConvertInquiryToBooking handler", () => {
      expect(routeSrc).toMatch(
        /import\s*\{\s*handleCreateCorporateInquiry\s*,\s*handleConvertInquiryToBooking\s*\}\s*from\s*["']\.\.\/server\/handlers\/corporate-inquiries["']/
      );
    });

    it("exposes the route at domain=corporate action=convert-inquiry", () => {
      expect(routeSrc).toMatch(
        /domain\s*===\s*["']corporate["']\s*&&\s*action\s*===\s*["']convert-inquiry["']\s*&&\s*req\.method\s*===\s*["']POST["']/
      );
    });

    it("requires staff authentication before dispatching", () => {
      // The dispatch block must call authenticateStaff and return
      // a 401/403 (the existing pattern is a ternary on the
      // `Forbidden` substring of the auth error) before invoking
      // the handler.
      const dispatch = routeSrc.match(
        /domain\s*===\s*["']corporate["']\s*&&\s*action\s*===\s*["']convert-inquiry["'][\s\S]*?return\s+await\s+handleConvertInquiryToBooking/
      );
      expect(dispatch, "expected to find the convert-inquiry dispatch block").toBeTruthy();
      expect(dispatch![0]).toMatch(/authenticateStaff/);
      expect(dispatch![0]).toMatch(/status\(403|401\)/);
      expect(dispatch![0]).toMatch(/\(req as any\)\.staff\s*=\s*authResult/);
    });

    it("handler validates the staff role from req.staff", () => {
      // The handler must refuse unauthenticated calls and reject
      // already-converted / declined inquiries.
      expect(handlerSrc).toMatch(
        /const\s+staff\s*=\s*req\.staff\s*\|\|\s*\{\}/
      );
      expect(handlerSrc).toMatch(/Staff authentication is required\./);
      expect(handlerSrc).toMatch(/Inquiry is already converted\./);
      expect(handlerSrc).toMatch(/Cannot convert a declined inquiry\./);
    });

    it("handler creates a booking with isCorporate, linkedInquiryId, and source 'corporate'", () => {
      // The new booking document must be marked as corporate and
      // linked back to the inquiry.
      const newBookingBlock = handlerSrc.match(
        /newBooking\s*=\s*\{[\s\S]*?linkedInquiryId:\s*inquiryId/
      );
      expect(newBookingBlock, "expected to find the newBooking block").toBeTruthy();
      expect(newBookingBlock![0]).toMatch(/isCorporate:\s*true/);
      expect(newBookingBlock![0]).toMatch(/source:\s*["']corporate["']/);
      expect(newBookingBlock![0]).toMatch(/status:\s*["']confirmed["']/);
    });

    it("handler transactionally flips the inquiry status to converted + appends a note", () => {
      // The same transaction that creates the booking must update
      // the inquiry status + append a note + persist the back-link
      // IDs (convertedBookingId + convertedBookingRef).
      const inquiryUpdateBlock = handlerSrc.match(
        /transaction\.update\(\s*inquiryRef\s*,\s*\{[\s\S]*?\}/
      );
      expect(inquiryUpdateBlock, "expected to find the inquiry update block").toBeTruthy();
      expect(inquiryUpdateBlock![0]).toMatch(/status:\s*["']converted["']/);
      expect(inquiryUpdateBlock![0]).toMatch(/convertedBookingId/);
      expect(inquiryUpdateBlock![0]).toMatch(/convertedBookingRef/);
      expect(inquiryUpdateBlock![0]).toMatch(/notes:\s*\[\.\.\.existingNotes\s*,\s*conversionNote\]/);
    });

    it("handler resolves the negotiated rate from ratePerRoomType when a code is attached", () => {
      // The rate resolution must follow this order: explicit
      // override > ratePerRoomType[roomType] from attached code
      // > room.corporateRate > room.pricePerNight.
      const rateBlock = handlerSrc.match(
        /if\s*\(\s*ratePerNightOverride\s*!==\s*undefined\s*&&\s*ratePerNightOverride\s*!==\s*null\s*\)[\s\S]*?else\s+if\s*\(\s*inquiryData\.accessCodeId\s*\)[\s\S]*?if\s*\(\s*codeSnap\.exists\s*\)[\s\S]*?if\s*\(\s*rateMap\[roomData\.type\]\s*!==\s*undefined\s*\)/);
      expect(rateBlock, "expected to find the rate resolution block").toBeTruthy();
      expect(rateBlock![0]).toMatch(/rateMap\[roomData\.type\]/);
    });

    it("handler pre-fills guest info from the inquiry contactPerson / email / phone", () => {
      // The contactPerson field is split into firstName / lastName.
      expect(handlerSrc).toMatch(
        /const\s+\[firstName\s*,\s*\.\.\.rest\]\s*=\s*contactName\.split\(/
      );
      expect(handlerSrc).toMatch(/guestEmail\s*=\s*String\(inquiryData\.email/);
      expect(handlerSrc).toMatch(/guestPhone\s*=\s*String\(inquiryData\.phone/);
    });
  });

  describe("client wiring", () => {
    it("AdminContext exposes convertInquiryToBooking", () => {
      // The context interface must list the new method.
      expect(adminContextSrc).toMatch(
        /convertInquiryToBooking:\s*\([\s\S]*?\) =>\s*Promise<\{[\s\S]*?\}>/
      );
      // And it must call the convert-inquiry API with a Bearer token.
      const ctxMethodBlock = adminContextSrc.match(
        /const\s+convertInquiryToBooking\s*=\s*async\s*\(/
      );
      expect(ctxMethodBlock, "expected to find the convertInquiryToBooking definition").toBeTruthy();
      // The full body has to follow; we just sample a bit.
      const ctxStart = adminContextSrc.indexOf("const convertInquiryToBooking = async");
      const ctxEnd = adminContextSrc.indexOf("};", ctxStart);
      const ctxBody = adminContextSrc.slice(ctxStart, ctxEnd + 2);
      expect(ctxBody).toMatch(/api\/corporate\/convert-inquiry/);
      // The Authorization header pattern in this codebase wraps the
      // value in quotes: "Authorization": token ? `Bearer ${token}` : ""
      expect(ctxBody).toMatch(/["']Authorization["']:\s*token\s*\?\s*`Bearer\s+\$\{token\}`\s*:\s*["']["']/);
    });

    it("CorporateInquiriesPage renders a Convert-to-Booking action", () => {
      // The drawer must include a Convert to Booking section for
      // non-terminal inquiries.
      expect(inquiryPageSrc).toMatch(/Convert to Booking/);
      expect(inquiryPageSrc).toMatch(/openConvertModal/);
      // The modal is wired with a title + the convertInquiryToBooking call
      expect(inquiryPageSrc).toMatch(/Convert inquiry from/);
      expect(inquiryPageSrc).toMatch(/isConvertModalOpen/);
    });

    it("CorporateInquiriesPage pre-fills the modal from the inquiry", () => {
      // The pre-fill values must pull from the inquiry
      // (preferredDates, numRooms). The role guard on the button
      // shows it for non-terminal statuses only.
      expect(inquiryPageSrc).toMatch(
        /setConvertCheckIn\(\s*selectedInquiry\.preferredDates\?\.from\s*\|\|/
      );
      expect(inquiryPageSrc).toMatch(
        /setConvertCheckOut\(\s*selectedInquiry\.preferredDates\?\.to\s*\|\|/
      );
      expect(inquiryPageSrc).toMatch(
        /setConvertGuests\(\s*Math\.max\(\s*1\s*,\s*Number\(selectedInquiry\.numRooms\)/
      );
      expect(inquiryPageSrc).toMatch(
        /selectedInquiry\.status\s*!==\s*["']converted["']\s*&&\s*selectedInquiry\.status\s*!==\s*["']declined["']/
      );
    });

    it("convert modal calls the context method and navigates to the new booking on success", () => {
      expect(inquiryPageSrc).toMatch(/await\s+convertInquiryToBooking\(/);
      expect(inquiryPageSrc).toMatch(
        /navigate\(\s*`\/bookings\?bookingId=\$\{encodeURIComponent\(result\.bookingId\)\}`/
      );
    });

    it("convert modal has a loading / error UI", () => {
      expect(inquiryPageSrc).toMatch(/setConvertSubmitting/);
      expect(inquiryPageSrc).toMatch(/setConvertError/);
      expect(inquiryPageSrc).toMatch(/role="alert"/);
      expect(inquiryPageSrc).toMatch(/Converting\.\.\./);
    });
  });
});
