import { describe, expect, test } from "vitest";
import { getEffectiveStorePaymentMethods } from "../utils/storePaymentMethods";

describe("store payment methods", () => {
  test("uses Payment Methods store visibility instead of regular-booking visibility", () => {
    const methods = getEffectiveStorePaymentMethods([
      {
        method: "cod",
        label: "Cash on Delivery",
        accountName: "",
        accountNumber: "",
        qrUrl: "",
        isEnabled: false,
        showInStore: true
      },
      {
        method: "add-to-bill",
        label: "Add to Room Bill",
        accountName: "",
        accountNumber: "",
        qrUrl: "",
        isEnabled: false,
        showInStore: true
      },
      {
        method: "pay-at-hotel",
        label: "Pay at Hotel",
        accountName: "",
        accountNumber: "",
        qrUrl: "",
        isEnabled: true,
        showInStore: true
      }
    ]);

    expect(methods.map((m) => m.method)).toEqual(["cod", "add-to-bill"]);
  });

  test("keeps online method details and hides methods explicitly disabled for store", () => {
    const methods = getEffectiveStorePaymentMethods([
      {
        method: "gcash",
        label: "GCash",
        accountName: "Spark Inn",
        accountNumber: "0917-000-0000",
        qrUrl: "https://example.test/gcash.png",
        isEnabled: true,
        showInStore: true
      },
      {
        method: "paypal",
        label: "PayPal",
        accountName: "payments@example.test",
        accountNumber: "",
        qrUrl: "",
        isEnabled: true,
        showInStore: false
      }
    ]);

    expect(methods).toEqual([
      {
        method: "gcash",
        label: "GCash",
        isEnabled: true,
        source: "payment",
        qrUrl: "https://example.test/gcash.png",
        accountInfo: undefined,
        accountName: "Spark Inn",
        accountNumber: "0917-000-0000"
      }
    ]);
  });
});
