// Per decision #320 (2026-11-19): the payment-method QR DOWNLOAD.
//
// WHAT THE GUEST ASKED FOR: in the Review & Pay step of the guest
// booking flow, the payment-method QR was a 160px thumbnail with no
// way to see it larger and no way to save it.
//
// WHY THE DOWNLOAD CANNOT BE A PLAIN LINK: the admin-uploaded QR lives
// on a cross-origin `firebasestorage.googleapis.com` URL. The
// `download` attribute is IGNORED for cross-origin URLs (the browser
// navigates instead of saving), and the bucket's CORS allow-list only
// echoes `access-control-allow-origin` for the origins the hotel
// configured — so on a white-label domain the `fetch()` a blob
// download needs is blocked outright.
//
// So the download goes through a SAME-ORIGIN route
// (`GET /api/public/payment-qr?method=<key>`) that streams the
// configured file back with `Content-Disposition: attachment`.
//
// WHAT IS PINNED HERE:
//   1. The route exists, is registered and is rate-limited per IP.
//   2. The handler's BEHAVIOUR (runtime assertions against the real
//      handler): 400 for a bad key, 404 for an unknown method, 200 +
//      `attachment` + the right file name + the image bytes for a
//      good key, 502 when upstream answers with something that is
//      not an image.
//   3. The route can never be pointed at an arbitrary host — the
//      upstream URL comes from the admin-configured hotel config,
//      never from the request.
//   4. The guest surfaces render the shared tile (full-size view +
//      download) instead of a bare `<img>`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const GUEST_SRC = join(ROOT, "guest-app", "src");
const API_ROUTER = join(ROOT, "guest-app", "server", "apiRouter.ts");
const QR_HANDLER = join(ROOT, "guest-app", "server", "handlers", "payment-qr.ts");
const QR_COMPONENT = join(GUEST_SRC, "components", "PaymentQrCode.tsx");
const MODAL_COMPONENT = join(GUEST_SRC, "components", "Modal.tsx");

const { loadPublicHotelConfigMock } = vi.hoisted(() => ({
  loadPublicHotelConfigMock: vi.fn()
}));

vi.mock("../../server/lib/publicHotelConfig", () => ({
  loadPublicHotelConfig: loadPublicHotelConfigMock
}));

import { handleGetPaymentQr } from "../../server/handlers/payment-qr";

/** A 1x1 PNG — enough to assert that the BYTES come back untouched. */
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function createRes() {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 0,
    payload: undefined as any,
    headers,
    setHeader(name: string, value: string) {
      headers[String(name).toLowerCase()] = String(value);
      return res;
    },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.payload = payload;
      return res;
    },
    send(payload: any) {
      res.payload = payload;
      return res;
    }
  };
  return res;
}

function createReq(query: Record<string, string>, method = "GET") {
  const search = new URLSearchParams(query).toString();
  return {
    method,
    url: `/api/public/payment-qr${search ? `?${search}` : ""}`,
    headers: { host: "localhost" },
    query
  } as any;
}

const HOTEL_CONFIG = {
  paymentMethods: [
    {
      method: "gcash",
      label: "GCash",
      accountName: "Spark Inn",
      accountNumber: "0917-000-0000",
      qrUrl: "https://firebasestorage.googleapis.com/v0/b/bucket/o/assets%2Fpayment-methods%2Fgcash%2FGCASH.png?alt=media&token=abc",
      isEnabled: true,
      showInCorporate: true,
      showInStore: true,
      requireReferenceNumber: false
    },
    {
      method: "bpi",
      label: "Bank Transfer",
      accountName: "Spark Inn",
      accountNumber: "1234-5678",
      qrUrl: "https://firebasestorage.googleapis.com/v0/b/bucket/o/assets%2Fpayment-methods%2Fbpi%2FBPI.png?alt=media&token=def",
      isEnabled: true,
      showInCorporate: true,
      showInStore: true,
      requireReferenceNumber: false
    },
    {
      method: "paypal",
      label: "PayPal",
      accountName: "paypal@sparkinn.com",
      accountNumber: "",
      qrUrl: "",
      isEnabled: true,
      showInCorporate: true,
      showInStore: true,
      requireReferenceNumber: false
    }
  ]
};

beforeEach(() => {
  loadPublicHotelConfigMock.mockReset();
  loadPublicHotelConfigMock.mockResolvedValue(HOTEL_CONFIG);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("decision #320 — GET /api/public/payment-qr (behaviour)", () => {
  it("rejects a request without a valid method key", async () => {
    const res = createRes();
    await handleGetPaymentQr(createReq({}), res);

    expect(res.statusCode).toBe(400);
    expect(res.payload.success).toBe(false);
    // The upstream must NOT be contacted for an invalid key.
    expect(loadPublicHotelConfigMock).not.toHaveBeenCalled();
  });

  it("rejects a method key that is not in the accepted shape", async () => {
    const res = createRes();
    await handleGetPaymentQr(createReq({ method: "../../etc/passwd" }), res);

    expect(res.statusCode).toBe(400);
    expect(loadPublicHotelConfigMock).not.toHaveBeenCalled();
  });

  it("404s for a method the hotel has not configured", async () => {
    const res = createRes();
    await handleGetPaymentQr(createReq({ method: "maya" }), res);

    expect(res.statusCode).toBe(404);
    expect(res.payload.success).toBe(false);
  });

  it("404s for a configured method that has no QR", async () => {
    const res = createRes();
    await handleGetPaymentQr(createReq({ method: "paypal" }), res);

    expect(res.statusCode).toBe(404);
  });

  it("streams the configured file back with a download disposition", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = createRes();
    await handleGetPaymentQr(createReq({ method: "gcash" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="gcash-qr-code.png"');
    expect(res.headers["content-length"]).toBe(String(PNG_BYTES.length));
    expect(Buffer.from(res.payload)).toEqual(PNG_BYTES);

    // The upstream URL comes from the ADMIN-CONFIGURED hotel config,
    // never from the request.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(HOTEL_CONFIG.paymentMethods[0].qrUrl);
  });

  it("names a JPEG download with the .jpg extension", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(PNG_BYTES, {
          status: 200,
          headers: { "content-type": "image/jpeg" }
        })
      )
    );

    const res = createRes();
    await handleGetPaymentQr(createReq({ method: "bpi" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="bpi-qr-code.jpg"');
  });

  it("refuses to proxy something that is not an image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<html>error</html>", {
          status: 200,
          headers: { "content-type": "text/html" }
        })
      )
    );

    const res = createRes();
    await handleGetPaymentQr(createReq({ method: "gcash" }), res);

    // A Storage error page answers with `text/html`; handing that back
    // as a "QR code" would save a broken file on the guest's phone.
    expect(res.statusCode).toBe(502);
    expect(res.payload.success).toBe(false);
  });

  it("502s when the upstream read fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 }))
    );

    const res = createRes();
    await handleGetPaymentQr(createReq({ method: "gcash" }), res);

    expect(res.statusCode).toBe(502);
  });

  it("rejects a non-GET method", async () => {
    const res = createRes();
    await handleGetPaymentQr(createReq({ method: "gcash" }, "POST"), res);

    expect(res.statusCode).toBe(405);
  });
});

describe("decision #320 — the route is registered and rate-limited", () => {
  const routerSrc = readFileSync(API_ROUTER, "utf8");
  const handlerSrc = existsSync(QR_HANDLER) ? readFileSync(QR_HANDLER, "utf8") : "";

  it("the apiRouter registers GET /api/public/payment-qr", () => {
    expect(routerSrc).toMatch(/domain === "public"/);
    expect(routerSrc).toMatch(/action === "payment-qr"/);
    expect(routerSrc).toContain("handleGetPaymentQr");
  });

  it("the route is rate-limited per IP", () => {
    expect(routerSrc).toMatch(
      /isRateLimited\(`public-payment-qr:\$\{ip\}`, \d+, 60000\)/
    );
  });

  it("the handler never takes an upstream URL from the request", () => {
    expect(handlerSrc, "expected the payment-qr handler file").not.toBe("");
    // The upstream URL is the ADMIN-CONFIGURED `qrUrl`; a request-
    // supplied URL would turn the route into an open proxy.
    expect(handlerSrc).not.toMatch(/req\.query\.?(qrUrl|url)/i);
    expect(handlerSrc).not.toMatch(/req\.body\.(qrUrl|url)/i);
    // It reads the config through the Admin SDK, never the client SDK.
    expect(handlerSrc).not.toContain("firebase/firestore");
    expect(handlerSrc).toContain("loadPublicHotelConfig");
  });

  it("the handler only proxies images and caps their size", () => {
    expect(handlerSrc).toContain("MAX_QR_BYTES");
    expect(handlerSrc).toContain('startsWith("image/")');
    expect(handlerSrc).toContain("Content-Disposition");
  });
});

describe("decision #320 — the guest surfaces render the QR tile", () => {
  const componentSrc = existsSync(QR_COMPONENT) ? readFileSync(QR_COMPONENT, "utf8") : "";

  it("the shared component exists and opens a full-size view", () => {
    expect(componentSrc, "expected the PaymentQrCode component").not.toBe("");
    expect(componentSrc).toContain("export function PaymentQrCode");
    expect(componentSrc).toContain("<Modal");
    expect(componentSrc).toContain("View ${label} QR code full size");
  });

  it("the component downloads through the SAME-ORIGIN route", () => {
    // A direct cross-origin `download` is ignored by the browser, so
    // the component must go through the route.
    expect(componentSrc).toContain("paymentQrDownloadUrl(method)");
    expect(componentSrc).toContain("anchor.download");
    // It must never hand the raw Storage URL to an anchor.
    expect(componentSrc).not.toMatch(/anchor\.href\s*=\s*qrUrl/);
  });

  it("the Review & Pay step renders the tile instead of a bare <img>", () => {
    const bookingPage = readFileSync(join(GUEST_SRC, "pages", "BookingPage.tsx"), "utf8");
    expect(bookingPage).toContain("<PaymentQrCode");
    expect(bookingPage).toContain('import { PaymentQrCode } from "../components/PaymentQrCode"');
    // The old bare thumbnail is gone.
    expect(bookingPage).not.toMatch(/src=\{currentPaymentMethod\.qrUrl\}/);
  });

  it("the corporate + store surfaces render the same tile", () => {
    const corporate = readFileSync(join(GUEST_SRC, "pages", "CorporateBookingPage.tsx"), "utf8");
    const intercom = readFileSync(join(GUEST_SRC, "pages", "IntercomPage.tsx"), "utf8");
    expect(corporate).toContain("<PaymentQrCode");
    expect(intercom).toContain("<PaymentQrCode");
    expect(corporate).not.toMatch(/src=\{pm\.qrUrl\}/);
    expect(intercom).not.toMatch(/src=\{currentPaymentMethodConfig\.qrUrl\}/);
  });

  it("the guest Modal is a real dialog (role, focus trap, Escape)", () => {
    const modalSrc = readFileSync(MODAL_COMPONENT, "utf8");
    // Per OCT-H11 (decision #287): the guest app's overlay primitive.
    expect(modalSrc).toContain('role="dialog"');
    expect(modalSrc).toContain('aria-modal="true"');
    expect(modalSrc).toContain("useFocusTrap");
    expect(modalSrc).toContain("useBodyScrollLock");
  });
});
