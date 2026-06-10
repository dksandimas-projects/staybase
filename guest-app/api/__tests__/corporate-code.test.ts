import { describe, expect, test, vi } from "vitest";

// Mock Firebase Admin SDK
vi.mock("../lib/firebase-admin", () => {
  const mockCorporateCodes: Record<string, any> = {
    "ACME2026": {
      exists: true,
      data: () => ({
        code: "ACME2026",
        companyName: "Acme Corporation",
        ratePerRoomType: { "standard-double": 2500, "standard-twin": 2500, "deluxe-sea-view": 3800 },
        expiresAt: { toDate: () => new Date("2027-12-31") },
        usageCap: 50,
        usageCount: 12,
        isActive: true,
      }),
    },
    "EXPIRED123": {
      exists: true,
      data: () => ({
        code: "EXPIRED123",
        companyName: "Old Corp",
        ratePerRoomType: { "standard-double": 2000 },
        expiresAt: { toDate: () => new Date("2025-01-01") },
        usageCap: null,
        usageCount: 0,
        isActive: true,
      }),
    },
    "INACTIVE99": {
      exists: true,
      data: () => ({
        code: "INACTIVE99",
        companyName: "Inactive Inc",
        ratePerRoomType: { "standard-double": 2000 },
        expiresAt: { toDate: () => new Date("2027-12-31") },
        usageCap: null,
        usageCount: 0,
        isActive: false,
      }),
    },
    "FULL100": {
      exists: true,
      data: () => ({
        code: "FULL100",
        companyName: "Full Corp",
        ratePerRoomType: { "standard-double": 2000 },
        expiresAt: { toDate: () => new Date("2027-12-31") },
        usageCap: 10,
        usageCount: 10,
        isActive: true,
      }),
    },
  };

  const createDocRef = (path: string) => {
    const [coll, docId] = path.split("/");
    return {
      path,
      get: async () => {
        if (coll === "corporateCodes" && mockCorporateCodes[docId]) {
          return mockCorporateCodes[docId];
        }
        return { exists: false };
      },
    };
  };

  const mockCollection = (collName: string) => ({
    doc: (docId: string) => createDocRef(`${collName}/${docId}`),
    where: function () { return this; },
    limit: function () { return this; },
    get: async function () {
      return { empty: true, docs: [] };
    },
  });

  return {
    adminDb: {
      collection: vi.fn().mockImplementation((collName: string) => mockCollection(collName)),
      doc: vi.fn().mockImplementation((path: string) => createDocRef(path)),
    },
    adminAuth: {},
  };
});

import { handleValidateCorporateCode } from "../handlers/corporate-codes";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe("/api/validate/corporate-code handler", () => {
  test("validates a valid corporate code", async () => {
    const req = { method: "POST", body: { code: "ACME2026" } };
    const res = mockResponse();

    await handleValidateCorporateCode(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({
        code: "ACME2026",
        companyName: "Acme Corporation",
        ratePerRoomType: expect.objectContaining({ "standard-double": 2500 }),
      }),
    });
  });

  test("rejects validation for an expired code", async () => {
    const req = { method: "POST", body: { code: "EXPIRED123" } };
    const res = mockResponse();

    await handleValidateCorporateCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining("expired"),
    });
  });

  test("rejects validation for an inactive code", async () => {
    const req = { method: "POST", body: { code: "INACTIVE99" } };
    const res = mockResponse();

    await handleValidateCorporateCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining("inactive"),
    });
  });

  test("rejects validation for a usage-capped code", async () => {
    const req = { method: "POST", body: { code: "FULL100" } };
    const res = mockResponse();

    await handleValidateCorporateCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining("usage cap"),
    });
  });

  test("rejects an unknown code", async () => {
    const req = { method: "POST", body: { code: "NONEXISTENT" } };
    const res = mockResponse();

    await handleValidateCorporateCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining("not recognized"),
    });
  });

  test("rejects request with missing code", async () => {
    const req = { method: "POST", body: {} };
    const res = mockResponse();

    await handleValidateCorporateCode(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: expect.stringContaining("Corporate code is required"),
    });
  });

  test("rejects non-POST method", async () => {
    const req = { method: "GET", body: {} };
    const res = mockResponse();

    await handleValidateCorporateCode(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });
});
