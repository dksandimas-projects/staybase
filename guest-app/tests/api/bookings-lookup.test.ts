import { beforeEach, describe, expect, test, vi } from "vitest";

const { mockBookings, mockRooms, handleLookupBooking } = vi.hoisted(() => {
  return {
    mockBookings: {} as Record<string, any>,
    mockRooms: {} as Record<string, any>,
    handleLookupBooking: vi.fn()
  };
});

// We import the real handler, but mock the firebase-admin module + verify behavior
vi.mock("../../server/lib/firebase-admin", () => {
  const docRef = (path: string) => {
    const segments = path.split("/");
    const coll = segments[0];
    const docId = segments[1] || "";
    return {
      path,
      id: docId,
      get: async () => {
        let store: Record<string, any> = {};
        if (coll === "bookings") store = mockBookings;
        else if (coll === "rooms") store = mockRooms;
        const data = store[docId];
        return data
          ? { exists: true, id: docId, data: () => data }
          : { exists: false };
      }
    };
  };

  const collection = (collName: string): any => {
    let queryFilters: Array<{ field: string; op: string; value: any }> = [];
    const chain: any = {
      _coll: collName,
      _filters: queryFilters,
      where: function (field: string, op: string, value: any) {
        queryFilters.push({ field, op, value });
        return this;
      },
      limit: function () { return this; },
      doc: function (docId: string) {
        return docRef(`${collName}/${docId}`);
      },
      get: async function () {
        if (collName !== "bookings") return { empty: true, docs: [] };
        const docs = Object.entries(mockBookings)
          .filter(([, data]) =>
            queryFilters.every((f) => {
              const v = (data as any)[f.field];
              if (f.op === "==") return v === f.value;
              if (f.op === "!=") return v !== f.value;
              return true;
            })
          )
          .map(([id, data]) => ({ id, data: () => data, ref: docRef(`bookings/${id}`) }));
        return { empty: docs.length === 0, docs };
      }
    };
    return chain;
  };

  return {
    adminDb: {
      collection: vi.fn().mockImplementation(collection)
    },
    adminAuth: {}
  };
});

// Mock the email handler so the route file imports don't blow up if anything references it
vi.mock("../../server/handlers/email", () => ({
  sendBookingTrigger: vi.fn().mockResolvedValue(undefined),
  sendCorporateInquiryTrigger: vi.fn().mockResolvedValue(undefined)
}));

import { handleLookupBooking as realHandleLookupBooking } from "../../server/handlers/bookings";

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const baseBooking = {
  id: "booking_1",
  bookingRef: "SI-20260615-001",
  guestName: "Maria Santos",
  guestEmail: "maria@example.test",
  guestPhone: "+63 917 000 0000",
  // Per H2 (hardening batch 2026-06-26): the lookup
  // deep-link token. 32-char lowercase hex.
  lookupToken: "000102030405060708090a0b0c0d0e0f",
  roomId: "room_101",
  roomNumber: "101",
  roomType: "standard-double",
  checkIn: { toDate: () => new Date("2026-06-16T00:00:00.000Z") },
  checkOut: { toDate: () => new Date("2026-06-18T00:00:00.000Z") },
  numNights: 2,
  numGuests: 2,
  ratePerNight: 2500,
  totalPrice: 5000,
  paymentMethod: "gcash",
  status: "pending",
  hasBreakfast: false,
  specialRequests: "Late check-in please"
};

describe("/api/bookings/lookup", () => {
  beforeEach(() => {
    Object.keys(mockBookings).forEach((k) => delete mockBookings[k]);
    Object.keys(mockRooms).forEach((k) => delete mockRooms[k]);
    mockRooms["room_101"] = { name: "Standard Double", type: "standard-double" };
    vi.clearAllMocks();
  });

  test("returns enriched booking + room data on a matching ref + email", async () => {
    mockBookings["booking_1"] = { ...baseBooking };

    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "SI-20260615-001", guestEmail: "maria@example.test" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(jsonCall.success).toBe(true);
    expect(jsonCall.data).toMatchObject({
      id: "booking_1",
      bookingRef: "SI-20260615-001",
      guestName: "Maria Santos",
      guestEmail: "maria@example.test",
      roomId: "room_101",
      roomNumber: "101",
      roomName: "Standard Double",
      roomType: "standard-double",
      numNights: 2,
      numGuests: 2,
      ratePerNight: 2500,
      totalPrice: 5000,
      paymentMethod: "gcash",
      status: "pending",
      hasBreakfast: false,
      specialRequests: "Late check-in please"
    });
  });

  test("returns 404 when no booking matches the ref + email pair", async () => {
    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "SI-20260101-999", guestEmail: "noone@example.test" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Booking not found."
    });
  });

  test("does not leak a booking when only the email matches a different ref", async () => {
    mockBookings["booking_1"] = { ...baseBooking };

    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "SI-20260101-999", guestEmail: "maria@example.test" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("does not leak a booking when only the ref matches a different email", async () => {
    mockBookings["booking_1"] = { ...baseBooking };

    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "SI-20260615-001", guestEmail: "intruder@example.test" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("email match is case-insensitive (trim + lowercase)", async () => {
    mockBookings["booking_1"] = { ...baseBooking };

    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "  SI-20260615-001  ", guestEmail: "  MARIA@EXAMPLE.TEST  " }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("returns 400 when bookingRef, guestEmail, and token are all missing", async () => {
    // Per feat/relax-booking-lookup: ref OR email OR token
    // is enough; only a truly empty body is a 400.
    const res1 = mockResponse();
    await realHandleLookupBooking({ method: "POST", body: {} }, res1);
    expect(res1.status).toHaveBeenCalledWith(400);

    // A present-but-invalid value is still a 400.
    const res2 = mockResponse();
    await realHandleLookupBooking({ method: "POST", body: { bookingRef: "SI-1" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);

    const res3 = mockResponse();
    await realHandleLookupBooking({ method: "POST", body: { guestEmail: "notanemail" } }, res3);
    expect(res3.status).toHaveBeenCalledWith(400);
  });

  test("falls back to roomType when the room doc cannot be enriched", async () => {
    mockBookings["booking_1"] = {
      ...baseBooking,
      roomId: "missing_room",
      roomName: undefined
    };

    const res = mockResponse();
    await realHandleLookupBooking(
      {
        method: "POST",
        body: { bookingRef: "SI-20260615-001", guestEmail: "maria@example.test" }
      },
      res
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const jsonCall = (res.json as any).mock.calls[0][0];
    expect(jsonCall.data.roomName).toBe("standard-double");
  });

  // Per BF-21 (booking-flow audit 2026-06-26): malformed
  // input must short-circuit with 400 before hitting
  // Firestore.
  describe("input validation (BF-21)", () => {
    test("returns 400 on a malformed booking reference (wrong date format)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-26-15-001", guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 on a malformed booking reference (non-numeric sequence)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-XXX", guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 on a malformed email (no @ sign)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", guestEmail: "notanemail" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 on an oversized body (100KB string)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "A".repeat(100_000), guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 (not 404) so callers can distinguish bad input from no match", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "garbage", guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // Per H2 (hardening batch 2026-06-26): the public
  // lookup now accepts either `guestEmail` (legacy) OR
  // `token` (the per-booking `lookupToken`). Exactly one
  // is required.
  describe("token-based lookup (H2)", () => {
    test("looks up by bookingRef + token", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", token: "000102030405060708090a0b0c0d0e0f" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.data.bookingRef).toBe("SI-20260615-001");
    });

    test("accepts uppercase hex token (case-insensitive)", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", token: "000102030405060708090A0B0C0D0E0F" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("returns 404 when the token does not match the doc", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", token: "ffffffffffffffffffffffffffffffff" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(404);
    });

    test("returns 200 on ref alone when the token is absent (new in feat/relax-booking-lookup)", async () => {
      // Per feat/relax-booking-lookup: ref alone is a valid
      // lookup. The booking-ref regex still applies, so the
      // ref must be well-formed, but no second factor is
      // required.
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.data.bookingRef).toBe("SI-20260615-001");
    });

    test("returns 400 when both email and token are provided", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: {
            bookingRef: "SI-20260615-001",
            guestEmail: "maria@example.test",
            token: "000102030405060708090a0b0c0d0e0f"
          }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 on a malformed token (too short)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", token: "abc" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("returns 400 on a malformed token (non-hex chars)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", token: "g".repeat(32) }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test("does NOT return lookupToken in the response payload", async () => {
      // Per H2: the lookup endpoint must not leak the
      // token back to the client, otherwise an attacker
      // who can see the response (e.g. via shared
      // device) could exfiltrate the token.
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", token: "000102030405060708090a0b0c0d0e0f" }
        },
        res
      );
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty("lookupToken");
    });
  });

  // Per feat/relax-booking-lookup: the endpoint now accepts
  // any ONE of ref / email / token. The matrix below locks
  // in the new behaviour so a future refactor doesn't
  // silently tighten or relax it.
  describe("ref-only + email-only + token-only (feat/relax-booking-lookup)", () => {
    test("ref alone returns the matching booking", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.data.id).toBe("booking_1");
      expect(jsonCall.data.bookingRef).toBe("SI-20260615-001");
    });

    test("ref alone returns 404 when no booking matches", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20990101-001" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Booking not found."
      });
    });

    test("email alone returns the matching booking", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.data.id).toBe("booking_1");
    });

    test("email alone returns the most recent booking when 1 match exists for the email", async () => {
      // Per MBP / decisions #123 (2026-07-24) + #128
      // (2026-07-25): the email-alone 1-match path returns
      // `kind: "single"` with the enriched shape EXCEPT
      // `guestName` is omitted (no second factor on the
      // email-alone path). The strict paths still include
      // the name. The 2+ match case routes to the privacy-
      // preserving list — that contract is covered in
      // `bookings-lookup-list.test.ts`.
      const ts = (iso: string) => {
        const d = new Date(iso);
        return { toDate: () => d, toMillis: () => d.getTime() };
      };
      mockBookings["new_booking"] = {
        ...baseBooking,
        id: "new_booking",
        bookingRef: "SI-20260920-001",
        createdAt: ts("2026-09-20T00:00:00.000Z")
      };

      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.data.id).toBe("new_booking");
      expect(jsonCall.data.kind).toBe("single");
      // Decision #128: email-alone 1-match omits guestName
      // because there's no second factor.
      expect(jsonCall.data).not.toHaveProperty("guestName");
    });

    test("email alone returns 404 with the same generic message when the email has no bookings", async () => {
      // The error must be indistinguishable from the
      // ref-not-found case so the endpoint is not an
      // email-existence oracle.
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { guestEmail: "stranger@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Booking not found."
      });
    });

    test("email alone is case-insensitive (trim + lowercase)", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { guestEmail: "  MARIA@EXAMPLE.TEST  " }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("token alone returns the matching booking", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { token: "000102030405060708090a0b0c0d0e0f" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.data.id).toBe("booking_1");
    });

    test("ref + email still works (backward-compat with the BF-21 path)", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("ref + token still works (backward-compat with the H2 magic-link path)", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", token: "000102030405060708090a0b0c0d0e0f" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("email + token is still rejected (400) — they remain alternative auth modes", async () => {
      // Per H2: the email and token paths are
      // alternatives, not complements. A request that
      // supplies both is ambiguous and rejected up front.
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: {
            guestEmail: "maria@example.test",
            token: "000102030405060708090a0b0c0d0e0f"
          }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });

  // Per fix/lookup-empty-string-handling: the client
  // always sends every key in the payload, so an "email
  // alone" submit still carries `bookingRef: ""` (or
  // whitespace) and `token: ""`. The schema needs to
  // treat these as "not provided" so the dispatch falls
  // through to the right branch.
  describe("empty-string fields (fix/lookup-empty-string-handling)", () => {
    test("email alone with bookingRef='' routes to the email path (200)", async () => {
      // The production client always sends `bookingRef`
      // even when the user only typed an email, so the
      // field comes through as "" (not undefined). The
      // schema must accept that and route to the email
      // branch.
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "", guestEmail: "maria@example.test" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonCall = (res.json as any).mock.calls[0][0];
      expect(jsonCall.data.id).toBe("booking_1");
    });

    test("ref alone with guestEmail='' routes to the ref path (200)", async () => {
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "SI-20260615-001", guestEmail: "" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("whitespace-only fields are treated as absent", async () => {
      // After `.trim()` the value is empty, which the
      // `.or(z.literal(""))` branch accepts.
      mockBookings["booking_1"] = { ...baseBooking };
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "  ", guestEmail: "  MARIA@EXAMPLE.TEST  " }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    test("all three keys empty still returns 400 (no key provided)", async () => {
      const res = mockResponse();
      await realHandleLookupBooking(
        {
          method: "POST",
          body: { bookingRef: "", guestEmail: "", token: "" }
        },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
