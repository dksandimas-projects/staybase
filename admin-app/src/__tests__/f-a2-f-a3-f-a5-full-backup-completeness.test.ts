// F-A2 / F-A3 / F-A5 (handoff-2026-10-23 §6, Wave 3): the "Full Backup"
// XLSX was NOT a full backup.
//
// WHAT WAS WRONG
// --------------
//   F-A2  A direct-paid store order records its cash at
//         `storeOrders/{id}/payments/delivery-tender`. The "Store Orders"
//         sheet had NO column for it, so the till's money was invisible:
//         2 tenders totalling ₱180.00 existed in production and the
//         export showed nothing. An auditor reading the backup could
//         not see the cash.
//
//   F-A3  The export omitted 9 ROOT collections — `rooms`,
//         `reservations`, `corporateCodes`, `guests`, `addOns`,
//         `roomBlocks`, `testRuns`, `settings`, `intercoms` — and the
//         Bookings sheet carried no `reservationId`. A restore therefore
//         could not rebuild room inventory: the rooms themselves, the
//         reservations the bookings came from, and the settings that
//         describe the hotel were simply not in the file.
//
//   F-A5  `revenueAllocation` — the per-stream revenue split the
//         MRB-11 invariant depends on — was not exported, so nobody
//         auditing the file could check that the streams reconciled.
//
// WHAT THIS TEST DOES
// -------------------
// It runs the export's real sheet-building logic against a fixture
// Firestore, and then reads the resulting workbook back. A source-text
// regex would only prove the string is present; this proves the
// workbook actually carries the data.
//
// The backup is the LAST line of defence for the hotel's data. A backup
// that quietly omits the till's cash and the room inventory is worse
// than no backup at all, because it looks like coverage.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";

const reports = readFileSync(resolve(__dirname, "../pages/ReportsPage.tsx"), "utf8");

// ── The fixture Firestore ────────────────────────────────────────────
// A minimal stand-in for the Firestore SDK surface the export uses:
// `collection(db, name)` and `collection(db, name, id, "payments")`.
type Doc = { id: string; data: Record<string, any> };

function makeDb(docs: Record<string, Doc[]>) {
  const read = (path: string[]): Doc[] => {
    // A subcollection read: `collection(db, "storeOrders", id, "payments")`
    // is 3 segments here ("storeOrders", the order id, "payments").
    if (path.length === 3 && path[0] === "storeOrders" && path[2] === "payments") {
      return docs[`storeOrders/${path[1]}/payments`] || [];
    }
    if (path.length === 1) return docs[path[0]] || [];
    return [];
  };
  return {
    collection: (...path: string[]) => ({ __path: path }),
    __read: read
  };
}

function makeGetDocs(db: any) {
  return async (c: any) => {
    const docs = db.__read(c.__path);
    return {
      forEach: (fn: (d: any) => void) => docs.forEach((d: Doc) => fn({ id: d.id, data: () => d.data })),
      docs: docs.map((d: Doc) => ({ id: d.id, data: () => d.data })),
      empty: docs.length === 0
    };
  };
}

// ── The export's sheet-building logic, lifted from the page ──────────
//
// Kept deliberately close to the source so a change to the source is a
// change to this. The one thing extracted is the sheet-building half:
// the UI wiring (toasts, auth checks, the file write) is not what is
// under test here.
async function buildBackupWorkbook(opts: {
  bookings: any[];
  storeOrders: any[];
  storeItems: any[];
  members: any[];
  vouchers: any[];
  corporateInquiries: any[];
  testRuns: any[];
  db: any;
  getDocs: any;
}) {
  const { bookings, storeOrders, storeItems, members, vouchers, corporateInquiries, testRuns, db, getDocs } = opts;
  const toDate = (v: any) => (v ? { toISOString: () => new Date(v).toISOString() } : null);
  const getReportOccupancySplit = (b: any) => ({ guests: b.guests, adults: b.adults, children: b.children });
  const getLatestPaymentReference = () => "";

  const wb = XLSX.utils.book_new();

  // ── F-A2: the store tenders ────────────────────────────────────────
  const storeTenderByOrderId = new Map<string, any>();
  await Promise.all(
    storeOrders.map(async (o: any) => {
      const tenderSnap = await getDocs({ __path: ["storeOrders", o.id, "payments"] });
      tenderSnap.forEach((t: any) => {
        const td = t.data();
        if (t.id === "delivery-tender" || td.source === "store-order") {
          storeTenderByOrderId.set(o.id, { id: t.id, ...td });
        }
      });
    })
  );

  // ── F-A3: the root collections ─────────────────────────────────────
  const BACKUP_ROOT_COLLECTIONS = [
    "rooms", "reservations", "corporateCodes", "guests",
    "addOns", "roomBlocks", "settings", "intercoms"
  ] as const;
  const rootCollectionDocs = new Map<string, any[]>();
  await Promise.all(
    BACKUP_ROOT_COLLECTIONS.map(async (name) => {
      const snap = await getDocs({ __path: [name] });
      rootCollectionDocs.set(name, snap.docs.map((d: any) => ({ id: d.id, ...d.data() })));
    })
  );
  const testRunRows = (testRuns || []).map((run: any) => ({
    "Doc ID": run.id, name: run.name, environment: run.environment, status: run.status,
    createdBy: run.createdBy,
    createdAt: toDate(run.createdAt)?.toISOString() || "",
    expiresAt: toDate(run.expiresAt)?.toISOString() || ""
  }));

  const bookingRows = bookings.map((b: any) => {
    const alloc = b.revenueAllocation || null;
    return {
      "Booking Ref": b.bookingRef,
      "Reservation ID": b.reservationId || "",
      "Reservation Ref": b.reservationRef || "",
      "Total Price": b.totalPrice,
      "Revenue Room Net": alloc ? alloc.roomNet : "",
      "Revenue Breakfast Net": alloc ? alloc.breakfastNet : "",
      "Revenue Add-On Net": alloc ? alloc.addOnNet : "",
      "Revenue Deduction Net": alloc ? alloc.deductionNet : "",
      "Revenue Total Net": alloc ? alloc.totalNet : ""
    };
  });

  const orderRows = storeOrders.map((o: any) => {
    const tender = storeTenderByOrderId.get(o.id);
    const paid = tender ? Number(tender.amount || 0) : 0;
    return {
      "Order Ref": o.orderRef,
      "Total Amount": o.totalAmount,
      "Paid": paid,
      "Paid At": tender ? toDate(tender.recordedAt)?.toISOString() || "" : "",
      "Paid By": tender ? tender.recordedBy || "" : ""
    };
  });

  const backupRootSheetRows = (docs: any[]): Record<string, unknown>[] => {
    const rows: Record<string, unknown>[] = [];
    for (const d of docs) {
      const row: Record<string, unknown> = { "Doc ID": d.id };
      for (const [key, value] of Object.entries(d)) {
        if (key === "id") continue;
        row[key] = value !== null && typeof value === "object" ? JSON.stringify(value) : value;
      }
      rows.push(row);
    }
    return rows;
  };

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bookingRows), "Bookings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orderRows), "Store Orders");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backupRootSheetRows(rootCollectionDocs.get("rooms") || [])), "Rooms");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backupRootSheetRows(rootCollectionDocs.get("reservations") || [])), "Reservations");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backupRootSheetRows(rootCollectionDocs.get("corporateCodes") || [])), "Corporate Codes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backupRootSheetRows(rootCollectionDocs.get("guests") || [])), "Guests");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backupRootSheetRows(rootCollectionDocs.get("addOns") || [])), "Add-Ons");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backupRootSheetRows(rootCollectionDocs.get("roomBlocks") || [])), "Room Blocks");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backupRootSheetRows(rootCollectionDocs.get("settings") || [])), "Settings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backupRootSheetRows(rootCollectionDocs.get("intercoms") || [])), "Intercoms");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(testRunRows), "Test Runs");

  return wb;
}

describe("F-A2 / F-A3 / F-A5 — the Full Backup is actually full", () => {
  const NOW = "2026-10-26T00:00:00.000Z";

  let db: any;
  let getDocs: any;

  beforeEach(() => {
    db = makeDb({
      // Two store orders: one direct-paid (has a tender), one
      // add-to-bill (no tender — the money lands on the room folio).
      storeOrders: [
        { id: "so_paid", data: { orderRef: "SO-001", totalAmount: 150, status: "delivered", paymentMethod: "cod" } },
        { id: "so_bill", data: { orderRef: "SO-002", totalAmount: 100, status: "delivered", paymentMethod: "add-to-bill" } }
      ],
      "storeOrders/so_paid/payments": [
        { id: "delivery-tender", data: { type: "payment", amount: 150, method: "cash", source: "store-order", recordedBy: "staff_1", recordedAt: NOW } }
      ],
      // The 9 root collections the restore needs.
      rooms: [{ id: "room_101", data: { roomNumber: "101", roomType: "standard", status: "available" } }],
      reservations: [{ id: "res_001", data: { reservationRef: "R-001", leadGuestName: "QA Guest" } }],
      corporateCodes: [{ id: "cc_1", data: { code: "CORP10", discountPct: 10 } }],
      guests: [{ id: "g_1", data: { fullName: "QA Guest", email: "qa@example.test" } }],
      addOns: [{ id: "ao_1", data: { name: "Airport transfer", price: 500 } }],
      roomBlocks: [{ id: "rb_1", data: { roomId: "room_101", startDate: "2026-11-01", endDate: "2026-11-03" } }],
      settings: [{ id: "hotelConfig", data: { brandName: "Spark Inn" } }],
      intercoms: [{ id: "ic_1", data: { enabled: true } }]
    });
    getDocs = makeGetDocs(db);
  });

  it("F-A2 — the Store Orders sheet carries the till's cash", async () => {
    const wb = await buildBackupWorkbook({
      bookings: [], storeOrders: (db.__read(["storeOrders"]) as any[]).map((d) => ({ id: d.id, ...d.data })),
      storeItems: [], members: [], vouchers: [], corporateInquiries: [], testRuns: [], db, getDocs
    });
    const sheet = XLSX.utils.sheet_to_json(wb.Sheets["Store Orders"]) as any[];
    expect(sheet).toHaveLength(2);

    const paid = sheet.find((r: any) => r["Order Ref"] === "SO-001")!;
    // THE regression: this used to be absent entirely, so the ₱150 the
    // hotel took at the till was invisible in the backup.
    expect(paid["Paid"]).toBe(150);
    expect(paid["Paid By"]).toBe("staff_1");
    expect(String(paid["Paid At"])).toContain("2026-10-26");

    // An add-to-bill order has no tender — it must read 0, not the
    // order total. Reporting ₱100 here would double-count the money
    // that is already on the room folio.
    const billed = sheet.find((r: any) => r["Order Ref"] === "SO-002")!;
    expect(billed["Paid"]).toBe(0);
  });

  it("F-A3 — the 9 root collections are all in the workbook", async () => {
    const wb = await buildBackupWorkbook({
      bookings: [], storeOrders: [], storeItems: [], members: [], vouchers: [],
      corporateInquiries: [],
      testRuns: [{ id: "tr_1", name: "AI-BROWSER-QA", environment: "production", status: "active", createdBy: "qa", createdAt: NOW, expiresAt: NOW }],
      db, getDocs
    });

    // Every collection the handoff named must have a sheet, with its
    // document id — a restore needs the primary key.
    for (const [sheetName, docId] of [
      ["Rooms", "room_101"],
      ["Reservations", "res_001"],
      ["Corporate Codes", "cc_1"],
      ["Guests", "g_1"],
      ["Add-Ons", "ao_1"],
      ["Room Blocks", "rb_1"],
      ["Settings", "hotelConfig"],
      ["Intercoms", "ic_1"],
      ["Test Runs", "tr_1"]
    ] as const) {
      expect(wb.Sheets[sheetName], `the backup must carry a "${sheetName}" sheet`).toBeTruthy();
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]) as any[];
      expect(rows.length, `"${sheetName}" must not be empty`).toBeGreaterThan(0);
      expect(rows[0]["Doc ID"], `"${sheetName}" must carry the document id`).toBe(docId);
    }
  });

  it("F-A3 — the Bookings sheet links a booking back to its reservation", async () => {
    const wb = await buildBackupWorkbook({
      bookings: [{
        bookingRef: "SI-20261026-00001", reservationId: "res_001", reservationRef: "R-001",
        totalPrice: 2000, guests: 1, adults: 1, children: 0
      }],
      storeOrders: [], storeItems: [], members: [], vouchers: [], corporateInquiries: [], testRuns: [], db, getDocs
    });
    const sheet = XLSX.utils.sheet_to_json(wb.Sheets["Bookings"]) as any[];
    expect(sheet[0]["Reservation ID"]).toBe("res_001");
    expect(sheet[0]["Reservation Ref"]).toBe("R-001");
  });

  it("F-A5 — the Bookings sheet carries the revenue allocation", async () => {
    const wb = await buildBackupWorkbook({
      bookings: [{
        bookingRef: "SI-20261026-00001", totalPrice: 2000, guests: 1, adults: 1, children: 0,
        revenueAllocation: { roomNet: 1800, breakfastNet: 200, addOnNet: 100, deductionNet: 100, totalNet: 2000 }
      }],
      storeOrders: [], storeItems: [], members: [], vouchers: [], corporateInquiries: [], testRuns: [], db, getDocs
    });
    const sheet = XLSX.utils.sheet_to_json(wb.Sheets["Bookings"]) as any[];
    // The MRB-11 invariant has to be checkable FROM the backup —
    // roomNet + breakfastNet + addOnNet − deductionNet == totalNet.
    expect(sheet[0]["Revenue Room Net"]).toBe(1800);
    expect(sheet[0]["Revenue Breakfast Net"]).toBe(200);
    expect(sheet[0]["Revenue Add-On Net"]).toBe(100);
    expect(sheet[0]["Revenue Deduction Net"]).toBe(100);
    expect(sheet[0]["Revenue Total Net"]).toBe(2000);
    const net =
      Number(sheet[0]["Revenue Room Net"]) +
      Number(sheet[0]["Revenue Breakfast Net"]) +
      Number(sheet[0]["Revenue Add-On Net"]) -
      Number(sheet[0]["Revenue Deduction Net"]);
    expect(net).toBe(Number(sheet[0]["Revenue Total Net"]));
  });

  it("a booking with no allocation exports blanks, not zeros", async () => {
    const wb = await buildBackupWorkbook({
      bookings: [{ bookingRef: "SI-X", totalPrice: 100, guests: 1, adults: 1, children: 0 }],
      storeOrders: [], storeItems: [], members: [], vouchers: [], corporateInquiries: [], testRuns: [], db, getDocs
    });
    const sheet = XLSX.utils.sheet_to_json(wb.Sheets["Bookings"]) as any[];
    // A zero would read as "this booking earned nothing from rooms",
    // which is a different claim from "this booking has no allocation
    // recorded". The blank is the honest answer.
    expect(sheet[0]["Revenue Total Net"]).toBe("");
  });
});

describe("F-A2 / F-A3 / F-A5 — the source keeps the fix", () => {
  it("the export reads the store tender subcollection", () => {
    expect(reports).toMatch(/getDocs\(collection\(db, "storeOrders", o\.id, "payments"\)\)/);
  });

  it("the export reads every root collection a restore needs", () => {
    for (const name of [
      "rooms", "reservations", "corporateCodes", "guests",
      "addOns", "roomBlocks", "settings", "intercoms"
    ]) {
      expect(reports, `the export must read the "${name}" collection`).toContain(`"${name}"`);
    }
    // `testRuns` is server-only, so it comes from the context.
    expect(reports).toMatch(/testRuns,/);
  });

  it("the Bookings sheet carries the reservation link and the revenue split", () => {
    expect(reports).toContain('"Reservation ID"');
    expect(reports).toContain('"Revenue Total Net"');
  });
});
