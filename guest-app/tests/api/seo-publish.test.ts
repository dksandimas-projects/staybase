import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mockSet } = vi.hoisted(() => ({ mockSet: vi.fn() }));

vi.mock("../../server/lib/firebase-admin", () => ({
  adminDb: {
    doc: vi.fn().mockReturnValue({ set: mockSet })
  }
}));

import { handlePublishSeo } from "../../server/handlers/seo";

const validPayload = {
  metaDescription: "Book a comfortable boutique hotel stay in Bohol with thoughtful service and a convenient Tagbilaran location.",
  priceRange: "₱₱",
  ogImage: "https://sparkinnbohol.com/og-image.png",
  twitterHandle: "@sparkinnbohol",
  address: "J. Borja St, Tagbilaran City, Bohol, 6300",
  frontDeskPhone: "+63 38 000 0000",
  facebookUrl: "https://facebook.com/sparkinnbohol",
  instagramUrl: "https://instagram.com/sparkinnbohol",
  checkInTime: "14:00",
  checkOutTime: "12:00"
};

function mockResponse() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("SEO publishing", () => {
  beforeEach(() => {
    mockSet.mockReset().mockResolvedValue(undefined);
    process.env.VERCEL_DEPLOY_HOOK_URL = "https://api.vercel.com/v1/integrations/deploy/test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.VERCEL_DEPLOY_HOOK_URL;
  });

  test("stores a validated published snapshot before triggering the deploy hook", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    vi.stubGlobal("fetch", fetchMock);
    const res = mockResponse();

    await handlePublishSeo({ body: validPayload, staff: { uid: "admin_1" } } as any, res);

    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
      published: validPayload,
      publishedBy: "admin_1"
    }), { merge: true });
    expect(fetchMock).toHaveBeenCalledWith(process.env.VERCEL_DEPLOY_HOOK_URL, { method: "POST" });
    expect(res.status).toHaveBeenCalledWith(202);
  });

  test("rejects invalid metadata without writing or deploying", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = mockResponse();

    await handlePublishSeo({ body: { ...validPayload, metaDescription: "Too short" } } as any, res);

    expect(mockSet).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("requires a server-side deploy hook", async () => {
    delete process.env.VERCEL_DEPLOY_HOOK_URL;
    const res = mockResponse();

    await handlePublishSeo({ body: validPayload } as any, res);

    expect(mockSet).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
