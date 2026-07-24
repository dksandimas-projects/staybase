// Per MBP / decisions #123 (2026-07-24) + #126 (2026-07-25) +
// #128 (2026-07-25) — the privacy-preserving multi-booking
// picker + single-booking card name-suppression for
// `/my-booking`. The existing `bookings-lookup.test.ts`
// mocks the entire handler (`handleLookupBooking = vi.fn()`)
// so it doesn't actually test the real behavior. This file
// imports the real apiRouter and mocks only the
// firebase-admin module, matching the pattern in
// `bookings-create.test.ts`.
//
// Coverage:
// - `kind: "single"` is the response for ref+token,
//   ref+email, ref alone, token alone, AND email-alone
//   with 1 match (backward-compat default).
// - `kind: "list"` with `bookings[]` + `moreExist` is the
//   response for email-alone with 2+ matches.
// - The list row shape is uniform regardless of whether
//   the bookings behind the email share a name or not
//   (decision #126 — earlier "single-name mode" leaked the
//   full name to anyone with email access; the new shape
//   omits `guestName` entirely).
// - Every row carries a `maskedEmail` echo of the search
//   key (e.g. `j***@gmail.com`) so the legit user can
//   confirm "yes, the search keyed on the email I typed".
// - The email-alone 1-match single-booking response
//   omits `guestName` (decision #128 — no second factor
//   on the email-alone path; the name is reflected back
//   only after the caller demonstrates possession of a
//   non-email secret via the strict paths).
// - 11+ matches → `moreExist: true`, 10th row is the last
//   displayed (11th is the sentinel, never returned).
// - Sort: `checkIn` desc, `createdAt` desc tiebreaker.

import { beforeEach, describe, expect, test, vi } from "vitest";
import handler from "../../server/apiRouter";

// Global mock state
let mockBookings: any[] = [];
let mockRooms: Record<string, any> = {};
let setCalls: any[] = [];
let updateCalls: any[] = [];

vi.mock("../../server/lib/resend", () => ({
  resend: {
    emails: { send: vi.fn().mockResolvedValue({ id: "mock_email_id" }) }
  }
}));

vi.mock("../../server/lib/firebase-admin", () => {
  const docRef = (path: string) => {
    const [coll, docId] = path.split("/");
    return {
      path,
      id: docId,
      get: async () => {
        if (coll === "bookings") {
          const found = mockBookings.find(
            (b) => b.id === docId || b.bookingRef === docId
          );
          if (found) {
            return { exists: true, id: found.id || docId, data: () => found };
          }
        }
        if (coll === "rooms" && mockRooms[docId]) {
          return { exists: true, id: docId, data: () => mockRooms[docId] };
        }
        return { exists: false };
      },
      update: async (upd: any) => {
        if (coll === "bookings") {
          const found = mockBookings.find(
            (b) => b.id === docId || b.bookingRef === docId
          );
          if (found) Object.assign(found, upd);
        }
        updateCalls.push({ path, data: upd });
      }
    };
  };

  const collection = (collName: string): any => {
    let queryFilters: Array<{ field: string; op: string; value: any }> = [];
    const chain: any = {
      where: function (field: string, op: string, value: any) {
        queryFilters.push({ field, op, value });
        return this;
      },
      limit: function (n: number) {
        (chain as any)._limit = n;
        return this;
      },
      orderBy: function (field: string, direction: string) {
        (chain as any)._orderBy = { field, direction };
        return this;
      },
      doc: function (docId: string) {
        return docRef(`${collName}/${docId}`);
      },
      get: async function () {
        if (collName !== "bookings") return { empty: true, docs: [] };
        const filtered = mockBookings
          .filter((b) =>
            queryFilters.every((f) => {
              const v = b[f.field];
              if (f.op === "==") return v === f.value;
              if (f.op === "!=") return v !== f.value;
              return true;
            })
          )
          .slice(0, (chain as any)._limit ?? mockBookings.length);
        return {
          empty: filtered.length === 0,
          docs: filtered.map((b) => ({
            id: b.id,
            data: () => b,
            ref: docRef(`bookings/${b.id}`)
          }))
        };
      }
    };
    return chain;
  };

  return {
    adminDb: {
      collection: (collName: string) => collection(collName),
      doc: (path: string) => docRef(path)
    },
    adminAuth: {}
  };
});

const mockResponse = () => {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  return res;
};

const mockRequest = (body: any, ip = "127.0.0.1") => ({
  method: "POST",
  body,
  url: "/api/bookings/lookup",
  headers: { host: "localhost" },
  socket: { remoteAddress: ip }
}) as any;

// Firestore Timestamps: real handler uses `.toMillis()`. The
// mock just needs a plain number when sorted; expose `toMillis`
// so the handler sees consistent values either way.
const ts = (ms: number) => ({
  toMillis: () => ms,
  toDate: () => new Date(ms)
});

describe("/api/bookings/lookup — MBP list response (decision #123)", () => {
  beforeEach(() => {
    mockBookings = [];
    mockRooms = {};
    setCalls = [];
    updateCalls = [];
    vi.clearAllMocks();
  });

  test("email-alone with 1 match returns kind: single with NO guestName (decision #128)", async () => {
    // Per decision #128 (2026-07-25): the email-alone 1-match
    // path has no second factor, so the single-booking
    // response omits `guestName`. The strict paths still
    // include the name — they're separately pinned by the
    // "ref+email path returns kind: single" test below.
    mockBookings = [{
      id: "b1",
      bookingRef: "SI-20260601-001",
      guestEmail: "maria@example.com",
      guestName: "Maria Santos", // stored on the doc, but NOT reflected back here
      guestPhone: "09170000000",
      roomId: "r1",
      roomType: "standard-double",
      roomNumber: "101",
      checkIn: ts(new Date("2026-09-10").getTime()),
      checkOut: ts(new Date("2026-09-13").getTime()),
      numNights: 3,
      numGuests: 2,
      ratePerNight: 2000,
      totalPrice: 6000,
      status: "confirmed",
      hasBreakfast: false,
      specialRequests: "",
      createdAt: ts(new Date("2026-06-01").getTime())
    }];

    const req = mockRequest({ guestEmail: "maria@example.com", turnstileToken: "mock_token" });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.kind).toBe("single");
    expect(body.data.bookingRef).toBe("SI-20260601-001");
    // The single-booking enriched shape is preserved (backward-compat)
    // EXCEPT for the email-alone no-second-factor case, which
    // omits guestName. The page branches on its presence to
    // hide the "Lead Guest" section.
    expect(body.data).not.toHaveProperty("guestName");
    expect(body.data.guestEmail).toBe("maria@example.com");
    expect(body.data).not.toHaveProperty("bookings");
  });

  test("email-alone with 2+ matches returns kind: list with maskedEmail and NO guestName (decision #126)", async () => {
    // Two stays under the same email, same name — clearly the
    // same person. Per #126 the picker still does NOT expose
    // guestName on the wire (earlier "single-name mode"
    // leaked the full name to anyone with email access).
    // Every row carries a maskedEmail echo instead.
    mockBookings = [
      {
        id: "b1",
        bookingRef: "SI-20260601-001",
        guestEmail: "maria@example.com",
        guestName: "Maria Santos",
        roomId: "r1",
        roomType: "standard-double",
        roomNumber: "101",
        checkIn: ts(new Date("2026-09-10").getTime()),
        checkOut: ts(new Date("2026-09-13").getTime()),
        numNights: 3,
        status: "confirmed",
        createdAt: ts(new Date("2026-06-01").getTime())
      },
      {
        id: "b2",
        bookingRef: "SI-20260415-002",
        guestEmail: "maria@example.com",
        guestName: "Maria Santos", // exact same name
        roomId: "r2",
        roomType: "standard-double",
        roomNumber: "102",
        checkIn: ts(new Date("2026-05-10").getTime()),
        checkOut: ts(new Date("2026-05-12").getTime()),
        numNights: 2,
        status: "checked-out",
        createdAt: ts(new Date("2026-04-15").getTime())
      }
    ];

    const req = mockRequest({ guestEmail: "maria@example.com", turnstileToken: "mock_token" });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.kind).toBe("list");
    expect(body.data.moreExist).toBe(false);
    expect(body.data.bookings).toHaveLength(2);
    // Sorted by checkIn desc — the September stay first.
    expect(body.data.bookings[0].bookingRef).toBe("SI-20260601-001");
    expect(body.data.bookings[1].bookingRef).toBe("SI-20260415-002");
    // Decision #126: guestName is NEVER on the wire, even when
    // every match is the same person.
    expect(body.data.bookings[0]).not.toHaveProperty("guestName");
    expect(body.data.bookings[1]).not.toHaveProperty("guestName");
    // maskedEmail echo on every row.
    expect(body.data.bookings[0].maskedEmail).toBe("m***@example.com");
    expect(body.data.bookings[1].maskedEmail).toBe("m***@example.com");
  });

  test("email-alone with mixed names (multi-name case) STILL omits guestName (uniform row shape)", async () => {
    // Shared email between two guests (e.g. spouses). The
    // picker must NOT reveal either name to the other. Per
    // #126 the row shape is now uniform: every list
    // response omits guestName, regardless of whether the
    // names match. The "single vs multi-name mode" branch
    // was retired in #126 because even single-name mode was
    // a name-leak vector.
    mockBookings = [
      {
        id: "b1",
        bookingRef: "SI-20260601-001",
        guestEmail: "family@example.com",
        guestName: "Maria Santos",
        roomId: "r1",
        roomType: "standard-double",
        roomNumber: "101",
        checkIn: ts(new Date("2026-09-10").getTime()),
        checkOut: ts(new Date("2026-09-13").getTime()),
        numNights: 3,
        status: "confirmed",
        createdAt: ts(new Date("2026-06-01").getTime())
      },
      {
        id: "b2",
        bookingRef: "SI-20260415-002",
        guestEmail: "family@example.com",
        guestName: "Juan Dela Cruz", // different person, same email
        roomId: "r2",
        roomType: "standard-double",
        roomNumber: "102",
        checkIn: ts(new Date("2026-05-10").getTime()),
        checkOut: ts(new Date("2026-05-12").getTime()),
        numNights: 2,
        status: "checked-out",
        createdAt: ts(new Date("2026-04-15").getTime())
      }
    ];

    const req = mockRequest({ guestEmail: "family@example.com", turnstileToken: "mock_token" });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.kind).toBe("list");
    expect(body.data.bookings).toHaveLength(2);
    // Multi-name case: guestName absent (same as single-name
    // case — uniform shape after #126).
    expect(body.data.bookings[0]).not.toHaveProperty("guestName");
    expect(body.data.bookings[1]).not.toHaveProperty("guestName");
    // maskedEmail echo on every row.
    expect(body.data.bookings[0].maskedEmail).toBe("f***@example.com");
    expect(body.data.bookings[1].maskedEmail).toBe("f***@example.com");
  });

  test("maskedEmail uses first char + *** + full domain (RA 10173 surface)", async () => {
    // The list response query is filtered to
    // guestEmail === searchInput, so every row shares the
    // same email. What changes between rows is the name
    // (sometimes), the dates, the room — but the masked
    // echo on the wire is uniform. This test pins the
    // exact format so a future refactor can't accidentally
    // leak the full local part (the PII we care about).
    mockBookings = [
      { id: "b1", bookingRef: "REF-001", guestEmail: "jane.doe@gmail.com", guestName: "Jane Doe",
        checkIn: ts(new Date("2026-09-10").getTime()), checkOut: ts(new Date("2026-09-13").getTime()),
        numNights: 3, roomType: "std", status: "confirmed",
        createdAt: ts(new Date("2026-06-01").getTime()) },
      { id: "b2", bookingRef: "REF-002", guestEmail: "jane.doe@gmail.com", guestName: "Jane Doe",
        checkIn: ts(new Date("2026-05-10").getTime()), checkOut: ts(new Date("2026-05-12").getTime()),
        numNights: 2, roomType: "std", status: "checked-out",
        createdAt: ts(new Date("2026-04-15").getTime()) }
    ];

    const req = mockRequest({ guestEmail: "jane.doe@gmail.com", turnstileToken: "mock_token" });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data.kind).toBe("list");
    expect(body.data.bookings).toHaveLength(2);
    // The exact format is load-bearing — `j***@gmail.com` is
    // what the guest sees; if this drifts to e.g. `jane@…`
    // the local part leaks. Pin both rows.
    expect(body.data.bookings[0].maskedEmail).toBe("j***@gmail.com");
    expect(body.data.bookings[1].maskedEmail).toBe("j***@gmail.com");
    // Defensive: no row leaks `guestName` (the original
    // leak vector that #126 closed).
    expect(body.data.bookings[0]).not.toHaveProperty("guestName");
    expect(body.data.bookings[1]).not.toHaveProperty("guestName");
    // And the full guestEmail is never echoed back (only
    // the masked form).
    expect(body.data.bookings[0]).not.toHaveProperty("guestEmail");
    expect(body.data.bookings[1]).not.toHaveProperty("guestEmail");
  });

  test("11+ matches returns moreExist: true with 10 entries (11th is sentinel)", async () => {
    // 12 bookings under one email. The picker must show 10,
    // flip moreExist, and not include the 11th or 12th row.
    mockBookings = Array.from({ length: 12 }, (_, i) => {
      const date = new Date("2026-09-01");
      date.setDate(date.getDate() + i);
      return {
        id: `b${i + 1}`,
        bookingRef: `SI-202609${String(i + 1).padStart(2, "0")}-${String(i + 1).padStart(3, "0")}`,
        guestEmail: "many@example.com",
        guestName: "Many Stays",
        roomId: `r${i + 1}`,
        roomType: "standard-double",
        roomNumber: String(101 + i),
        checkIn: ts(date.getTime()),
        checkOut: ts(date.getTime() + 2 * 24 * 60 * 60 * 1000),
        numNights: 2,
        status: "checked-out",
        createdAt: ts(new Date("2026-01-01").getTime() + i * 24 * 60 * 60 * 1000)
      };
    });

    const req = mockRequest({ guestEmail: "many@example.com", turnstileToken: "mock_token" });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data.kind).toBe("list");
    expect(body.data.bookings).toHaveLength(10);
    expect(body.data.moreExist).toBe(true);
    // Every row in the capped list carries the masked email.
    body.data.bookings.forEach((row: any) => {
      expect(row.maskedEmail).toBe("m***@example.com");
      expect(row).not.toHaveProperty("guestName");
    });
  });

  test("sort: checkIn desc, createdAt desc tiebreaker", async () => {
    // Two bookings with the SAME checkIn but different
    // createdAt. The most recently created wins.
    const sameCheckIn = new Date("2026-09-10").getTime();
    mockBookings = [
      { id: "old", bookingRef: "OLD-001", guestEmail: "u@example.com", guestName: "Same",
        checkIn: ts(sameCheckIn), checkOut: ts(sameCheckIn + 86400000),
        numNights: 1, roomType: "std", status: "checked-out",
        createdAt: ts(new Date("2026-04-01").getTime()) },
      { id: "new", bookingRef: "NEW-001", guestEmail: "u@example.com", guestName: "Same",
        checkIn: ts(sameCheckIn), checkOut: ts(sameCheckIn + 86400000),
        numNights: 1, roomType: "std", status: "confirmed",
        createdAt: ts(new Date("2026-08-15").getTime()) }
    ];

    const req = mockRequest({ guestEmail: "u@example.com", turnstileToken: "mock_token" });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data.bookings[0].bookingRef).toBe("NEW-001"); // newer createdAt wins
    expect(body.data.bookings[1].bookingRef).toBe("OLD-001");
  });

  test("ref+email path returns kind: single WITH guestName (strict path has a second factor)", async () => {
    // Ref must match BOOKING_REF_REGEX = /^[A-Z]{1,4}-\d{8}-\d{3,5}$/.
    // The strict path demonstrates possession of a non-email
    // secret (the booking ref is in the confirmation email and
    // is required as a second factor), so per decision #128
    // the name IS reflected back in the single-booking
    // response. This is the inverse of the email-alone 1-match
    // case above.
    mockBookings = [
      { id: "b1", bookingRef: "SI-20260601-001", guestEmail: "u@example.com", guestName: "Maria Santos",
        checkIn: ts(new Date("2026-09-10").getTime()), checkOut: ts(new Date("2026-09-13").getTime()),
        numNights: 3, roomType: "std", status: "confirmed",
        createdAt: ts(new Date("2026-06-01").getTime()) },
      { id: "b2", bookingRef: "SI-20260415-002", guestEmail: "u@example.com", guestName: "Maria Santos",
        checkIn: ts(new Date("2026-05-10").getTime()), checkOut: ts(new Date("2026-05-12").getTime()),
        numNights: 2, roomType: "std", status: "checked-out",
        createdAt: ts(new Date("2026-04-15").getTime()) }
    ];

    // ref + email: strict path, must return kind: "single" — the
    // picker is only reachable from the email-alone entry point.
    const req = mockRequest({
      bookingRef: "SI-20260601-001",
      guestEmail: "u@example.com",
      turnstileToken: "mock_token"
    });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data.kind).toBe("single");
    expect(body.data.bookingRef).toBe("SI-20260601-001");
    // Decision #128: the strict path's second factor (the ref)
    // means the name IS reflected back. The page renders the
    // "Lead Guest" section as before.
    expect(body.data.guestName).toBe("Maria Santos");
    expect(body.data).not.toHaveProperty("bookings");
  });

  test("email-alone with 0 matches returns 404 (email-existence oracle guard)", async () => {
    // Per spec: "The error message ('Booking not found.') is
    // the same whether the email has 0, 1, or many matches
    // (1 → single path with enriched shape, >1 → list path
    // with capped payload), so this is not an email-existence
    // oracle." The 0-match case is the strict 404.
    mockBookings = [];

    const req = mockRequest({ guestEmail: "ghost@example.com", turnstileToken: "mock_token" });
    const res = mockResponse();
    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error).toBe("Booking not found.");
  });
});
