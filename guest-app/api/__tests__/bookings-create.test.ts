import { describe, test } from "vitest";

describe("/api/bookings/create", () => {
  test.todo("allows only one of two simultaneous bookings for the same room and dates");
  test.todo("rejects booking creation when a room is blocked mid-flow");
  test.todo("does not leave partial writes after timeout or abort");
});
