import { describe, test } from "vitest";

describe("/api/store/confirm-order", () => {
  test.todo("decrements stock when an order is confirmed");
  test.todo("restores stock when an order is cancelled before confirmation");
  test.todo("allows unlimited stock items without decrementing");
});
