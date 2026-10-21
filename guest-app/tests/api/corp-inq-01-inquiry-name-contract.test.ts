// Per CORP-INQ-01 (QA pass 2026-10-21) — the guest corporate inquiry
// form and the corporate inquiry API must agree on the payload shape.
//
// WHAT WAS BROKEN: `guest-app/src/pages/CorporateStaysPage.tsx` collects
// the contact's FIRST and LAST name as two separate fields and posts
// `{ companyName, firstName, lastName, email, phone, numRooms,
// preferredDates, specialRequirements, _hp, turnstileToken }` — it never
// sends a flat `contactPerson`. The API schema required `contactPerson`
// anyway, so EVERY inquiry submitted through the public form failed Zod
// validation and the endpoint answered HTTP 400 "Please check the
// inquiry form and try again.".
//
// CONFIRMED IN PRODUCTION (2026-10-21): the `corporateInquiries`
// collection was EMPTY — no corporate lead had ever reached the
// pipeline through the public form. The admin-side inquiry fixtures that
// existed were written directly, which is why the bug looked like "no
// interest yet" rather than "the form is broken".
//
// WHY THIS TEST IS SHAPED DIFFERENTLY FROM THE EXISTING ONES: the old
// `corporate-inquiries.test.ts` only ever posted a `contactPerson`
// payload — the shape the form does NOT send — so it was green against
// a dead endpoint. This file instead EXTRACTS THE REAL KEY SET FROM THE
// REAL FORM SOURCE and posts exactly that, so the form and the API can
// never drift apart again silently.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const { mockAdd } = vi.hoisted(() => ({
  mockAdd: vi.fn()
}));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    collection: vi.fn().mockImplementation(() => ({
      add: mockAdd
    }))
  }
}));

const { mockSendTrigger, mockSendConfirmationTrigger } = vi.hoisted(() => ({
  mockSendTrigger: vi.fn().mockResolvedValue(undefined),
  mockSendConfirmationTrigger: vi.fn().mockResolvedValue(undefined)
}));

vi.mock("../../server/handlers/email", () => ({
  sendCorporateInquiryTrigger: mockSendTrigger,
  sendCorporateInquiryConfirmationTrigger: mockSendConfirmationTrigger
}));

import { handleCreateCorporateInquiry } from "../../server/handlers/corporate-inquiries";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const FORM_SRC = readFileSync(
  resolve(__dirname, "../../src/pages/CorporateStaysPage.tsx"),
  "utf8"
);

/**
 * Extract the top-level key set the REAL form posts, straight from the
 * form's `fetch("/api/corporate/inquiry", … body: JSON.stringify({ … }))`
 * block.
 *
 * Handles both property forms the form uses — explicit (`email: x`) and
 * ES2015 shorthand (`email,`) — strips comments, and tracks brace depth
 * so the nested `preferredDates: { from, to }` keys are not mistaken for
 * top-level fields.
 */
function formPayloadKeys(): string[] {
  const anchor = FORM_SRC.indexOf('fetch("/api/corporate/inquiry"');
  expect(anchor).toBeGreaterThan(-1);

  const start = FORM_SRC.indexOf("JSON.stringify({", anchor);
  expect(start).toBeGreaterThan(-1);

  // Slice the object literal out of JSON.stringify(...) by depth.
  let depth = 0;
  let end = -1;
  for (let i = start + "JSON.stringify".length; i < FORM_SRC.length; i += 1) {
    const ch = FORM_SRC[i];
    if (ch === "{" || ch === "[" || ch === "(") depth += 1;
    else if (ch === "}" || ch === "]" || ch === ")") {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  expect(end).toBeGreaterThan(-1);

  // Strip comments so a prose mention of a field name is not mistaken
  // for a real key.
  const block = FORM_SRC
    .slice(start, end + 1)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");

  // Split the object body on TOP-LEVEL commas.
  const body = block.slice(block.indexOf("{") + 1, block.lastIndexOf("}"));
  const segments: string[] = [];
  let current = "";
  depth = 0;
  for (const ch of body) {
    if (ch === "{" || ch === "[" || ch === "(") { depth += 1; current += ch; continue; }
    if (ch === "}" || ch === "]" || ch === ")") { depth -= 1; current += ch; continue; }
    if (ch === "," && depth === 0) { segments.push(current); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) segments.push(current);

  const keys: string[] = [];
  for (const segment of segments) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::|,|$)/.exec(segment);
    if (match) keys.push(match[1]);
  }
  return keys;
}

/** A body carrying exactly the keys the real form posts. */
function bodyFromFormKeys() {
  const keys = formPayloadKeys();
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    switch (key) {
      case "companyName": body[key] = "QA Test Corp"; break;
      case "firstName": body[key] = "Maria"; break;
      case "lastName": body[key] = "Santos"; break;
      case "email": body[key] = "maria@acme.test"; break;
      case "phone": body[key] = "+63 917 000 0000"; break;
      case "numRooms": body[key] = 4; break;
      case "preferredDates": body[key] = { from: "2026-12-01", to: "2026-12-05" }; break;
      case "specialRequirements": body[key] = "Needs meeting room access."; break;
      case "_hp": body[key] = ""; break;
      case "turnstileToken": body[key] = "mock_token"; break;
      case "contactPerson": body[key] = "Maria Santos"; break;
      default: body[key] = "x";
    }
  }
  return { body, keys };
}

describe("CORP-INQ-01 — the corporate inquiry form ↔ API payload contract", () => {
  beforeEach(() => {
    mockAdd.mockReset();
    mockSendTrigger.mockClear();
    mockSendConfirmationTrigger.mockClear();
  });

  test("the real form does NOT post a flat contactPerson", () => {
    const { keys } = bodyFromFormKeys();
    expect(keys).toContain("firstName");
    expect(keys).toContain("lastName");
    expect(keys).not.toContain("contactPerson");
  });

  test("the real form's payload is ACCEPTED by the API and derives contactPerson", async () => {
    const { body } = bodyFromFormKeys();
    mockAdd.mockResolvedValueOnce({ id: "inq_form" });

    const res = mockResponse();
    await handleCreateCorporateInquiry({ method: "POST", body }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { inquiryId: "inq_form" }
    });

    // The flat field is derived so every legacy reader still works.
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      contactPerson: "Maria Santos",
      firstName: "Maria",
      lastName: "Santos",
      status: "new"
    }));
  });

  test("a legacy client that DOES post contactPerson still works unchanged", async () => {
    mockAdd.mockResolvedValueOnce({ id: "inq_legacy" });
    const res = mockResponse();
    await handleCreateCorporateInquiry(
      {
        method: "POST",
        body: {
          companyName: "Acme Corporation",
          contactPerson: "Maria Santos",
          email: "maria@acme.test",
          phone: "+63 917 000 0000",
          numRooms: "5",
          preferredDates: "October 2026",
          specialRequirements: "Needs meeting room access.",
          _hp: "",
          turnstileToken: "mock_token"
        }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      contactPerson: "Maria Santos"
    }));
  });

  test("a nameless inquiry is still refused", async () => {
    const res = mockResponse();
    await handleCreateCorporateInquiry(
      {
        method: "POST",
        body: {
          companyName: "Acme Corporation",
          email: "maria@acme.test",
          phone: "+63 917 000 0000",
          numRooms: "5",
          preferredDates: "October 2026",
          _hp: "",
          turnstileToken: "mock_token"
        }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Please check the inquiry form and try again."
    });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test("the honeypot and turnstile token never reach Firestore", async () => {
    const { body } = bodyFromFormKeys();
    mockAdd.mockResolvedValueOnce({ id: "inq_hp" });
    const res = mockResponse();
    await handleCreateCorporateInquiry({ method: "POST", body }, res);

    expect(mockAdd.mock.calls[0][0]).not.toHaveProperty("_hp");
    expect(mockAdd.mock.calls[0][0]).not.toHaveProperty("turnstileToken");
  });
});
