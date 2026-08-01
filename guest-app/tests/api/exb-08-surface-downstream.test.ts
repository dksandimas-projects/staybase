import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per EXB-08 (2026-08-01, per decision #156): source-text
// regression tests for the "surface downstream" rollout
// of the adult/child split + extra bed line. The
// emulator tests that would exercise the full receipt
// PDF / email / drawer / lookup flow end-to-end are out
// of scope for this sandbox (Java not installed; PMH-03).
// The source-text guards below pin the contract that
// the emulator tests will later exercise.
//
// Background (per `plan/project/ROADMAP.md §EXB-08`):
//   - The booking doc persists `numAdults` + `numChildren`
//     + `extraBedCount` + `extraBedRate` (per CHD-01 +
//     EXB-01). The receipt PDF + the PriceBreakdown +
//     the email helper all read `rateBreakdown.addOns[]`
//     to render the cost lines.
//   - Pre-EXB-08, the addOns[] array only included the
//     breakfast term — the extra bed total was invisible
//     on every downstream surface. EXB-08 closes that
//     gap by:
//       (a) server `buildRateBreakdown` now writes the
//           extra bed add-on line into addOns[] when
//           `extraBedTotal > 0` (the count + rate inform
//           the multi-bed label variant), and
//       (b) the booking's occupancy breakdown (the
//           adult/child split + the extra bed count) is
//           threaded through 7 display surfaces: the
//           admin booking drawer header, the admin
//           Bookings table row, the admin receipt PDF,
//           the admin Bookings drawer "Stay" line, the
//           admin Bookings drawer "Guests:" line, the
//           admin Reports line, the guest /my-booking
//           card, and the booking email body.
//   - All 7 surfaces use the same shape: a single
//     `numAdults` + `numChildren` + `extraBedCount`
//     triple is read from the booking doc, validated
//     as numbers, and rendered as "X adults + Y children
//     (Z total) [+ N extra bed(s)]" when the split is
//     present, with the legacy "{numGuests} guests"
//     fallback when the split is absent (legacy pre-CHD
//     bookings, byte-equivalent to pre-EXB-08).
//   - The split is independent of the receipt's rate
//     breakdown — the receipt PDF still shows the room
//     lines + addOns + deductions + total; the
//     occupancy breakdown is a separate line item
//     above the rate breakdown.

const bookingsHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/bookings.ts"),
  "utf8"
);

const rateBreakdownSrc = readFileSync(
  resolve(__dirname, "../../server/lib/rate-breakdown.ts"),
  "utf8"
);

const emailHandlerSrc = readFileSync(
  resolve(__dirname, "../../server/handlers/email.ts"),
  "utf8"
);

const bookingsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/BookingsPage.tsx"),
  "utf8"
);

const reportsPageSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/pages/ReportsPage.tsx"),
  "utf8"
);

const drawerSrc = readFileSync(
  resolve(__dirname, "../../../admin-app/src/components/BookingDrawerWorkspace.tsx"),
  "utf8"
);

const bookingLookupSrc = readFileSync(
  resolve(__dirname, "../../src/pages/BookingLookupPage.tsx"),
  "utf8"
);

const bookingSummaryCardSrc = readFileSync(
  resolve(__dirname, "../../src/components/BookingSummaryCard.tsx"),
  "utf8"
);

describe("EXB-08 — server rate breakdown writes the extra bed add-on line", () => {
  it("buildRateBreakdown accepts extraBedTotal + extraBedCount + extraBedRate in the input", () => {
    // The helper now writes the extra bed add-on line
    // into `addOns[]` when `extraBedTotal > 0`. The
    // input interface grew from `{ roomLines, roomSubtotal,
    // breakfastTotal, ... }` to include the 3 new
    // fields. Pin the shape so a refactor that drops
    // any of them surfaces in the test.
    expect(rateBreakdownSrc).toMatch(/extraBedTotal\?:\s*number/);
    expect(rateBreakdownSrc).toMatch(/extraBedCount\?:\s*number/);
    expect(rateBreakdownSrc).toMatch(/extraBedRate\?:\s*number/);
  });

  it("buildRateBreakdown adds the 'Extra bed add-on' line when extraBedTotal > 0", () => {
    // The label is an IIFE that returns either the
    // multi-bed variant ("Extra bed add-on (2 beds ×
    // nights)") or the count-agnostic fallback
    // ("Extra bed add-on"). The IIFE is the natural
    // shape because the label depends on the count +
    // rate + nights, none of which are known at
    // constant-evaluation time.
    expect(rateBreakdownSrc).toMatch(/label:\s*\(\(\) => \{/);
    expect(rateBreakdownSrc).toMatch(
      /return `Extra bed add-on \(\$\{count\} beds ×/
    );
    expect(rateBreakdownSrc).toMatch(
      /return "Extra bed add-on"/
    );
    expect(rateBreakdownSrc).toMatch(
      /amount:\s*input\.extraBedTotal\s*\?\?\s*0/
    );
  });

  it("buildRateBreakdown writes both the breakfast + extra bed addOns (breakfast first, then extra bed)", () => {
    // The historical order is preserved: breakfast
    // first, then extra bed. The filter strips nulls
    // so a 0 breakfast + 1 extra bed renders as just
    // the extra bed line.
    expect(rateBreakdownSrc).toMatch(
      /addOns:\s*\[breakfastAddOn,\s*extraBedAddOn\]\.filter/
    );
  });

  it("handleCreateBooking passes the 3 new fields to buildRateBreakdown", () => {
    // The online create path threads `extraBedTotal` +
    // `extraBedCount` + `extraBedRate` (snapshotted
    // from the room type per EXB-01) into the helper.
    // The breakdown persists to the booking doc so
    // every downstream read site sees the addOns.
    const handleCreateBooking = bookingsHandlerSrc.match(
      /export async function handleCreateBooking[\s\S]*?const rateBreakdown = buildRateBreakdown\(\{[\s\S]*?\}\);/
    );
    expect(handleCreateBooking, "handleCreateBooking must exist").toBeTruthy();
    expect(handleCreateBooking![0]).toMatch(/extraBedTotal,/);
    expect(handleCreateBooking![0]).toMatch(/extraBedCount:/);
    expect(handleCreateBooking![0]).toMatch(/extraBedRate:/);
  });

  it("handleCreateWalkin passes the 3 new fields to buildRateBreakdown (and collapses the term when manual override is set)", () => {
    // The walk-in path threads `walkinExtraBedTotal` +
    // `walkinExtraBedCount` + `walkinExtraBedRate`. When
    // `totalPriceOverride` is set, the manual rate
    // collapses the extra bed into the room subtotal
    // (the historical manual-rate shape), so the add-on
    // line is forced to 0 in that path.
    const handleCreateWalkin = bookingsHandlerSrc.match(
      /export async function handleCreateWalkin[\s\S]*?const rateBreakdown = buildRateBreakdown\(\{[\s\S]*?\}\);/
    );
    expect(handleCreateWalkin, "handleCreateWalkin must exist").toBeTruthy();
    expect(handleCreateWalkin![0]).toMatch(/extraBedTotal:/);
    expect(handleCreateWalkin![0]).toMatch(/extraBedCount:/);
    expect(handleCreateWalkin![0]).toMatch(/extraBedRate:/);
    expect(handleCreateWalkin![0]).toMatch(
      /totalPriceOverride !== undefined && totalPriceOverride !== null\s*\?\s*0\s*:\s*walkinExtraBedTotal/
    );
  });
});

describe("EXB-08 — server email helper shows the adult/child split + extra bed", () => {
  it("the email occupancy line shows the adult/child split when both fields are present", () => {
    // The email's "Guests:" line grows to "Guests: X
    // adult(s) + Y child(ren) (Z total)" when the
    // split is present. Legacy pre-CHD bookings read
    // as a single `numGuests` total. The split
    // keeps the email scannable — staff + guests see
    // the same occupancy breakdown as the receipt +
    // the /my-booking card.
    expect(emailHandlerSrc).toMatch(
      /Guests: \$\{numAdults\} adult\$\{numAdults === 1 \? "" : "s"\} \+ \$\{numChildren\} child\$\{numChildren === 1 \? "" : "ren"\} \(\$\{booking\.numGuests \|\| 1\} total\)/
    );
  });

  it("the email appends the extra bed line when extraBedCount > 0", () => {
    // A separate "Extra beds: N (N × rate / bed / night)"
    // line renders when the booking has any extra beds.
    // The rate is formatted via the `fmtMoney` helper
    // so the email matches the receipt's currency
    // style.
    expect(emailHandlerSrc).toMatch(
      /Extra beds: \$\{extraBedCount\} \(\$\{extraBedCount\} × \$\{fmtMoney\(\(booking as any\)\.extraBedRate\)\} \/ bed \/ night\)/
    );
  });
});

describe("EXB-08 — admin booking drawer header shows the split + extra bed", () => {
  it("drawer header shows 'X adults + Y children' + 'N extra bed(s)' when the split is present", () => {
    expect(drawerSrc).toMatch(/numAdults/);
    expect(drawerSrc).toMatch(/numChildren/);
    expect(drawerSrc).toMatch(/extraBedCount/);
    expect(drawerSrc).toMatch(
      /\$\{numAdults\} adult\$\{numAdults === 1 \? "" : "s"\} \+ \$\{numChildren\} child\$\{numChildren === 1 \? "" : "ren"\}/
    );
    expect(drawerSrc).toMatch(/\+ \$\{extraBedCount\} extra bed/);
  });
});

describe("EXB-08 — admin Bookings table row shows the split + extra bed", () => {
  it("table row occupancy line shows the compact '2A + 1C' form + 'N bed(s)' when the split is present", () => {
    // The table row uses the compact "2A + 1C" form
    // (no "adult(s)"/"child(ren)" text) so the line fits
    // the table's narrow column. The `title` attribute
    // on the `<span>` carries the verbose form for
    // accessibility (hover reads "3 guests total").
    expect(bookingsPageSrc).toMatch(/\$\{numAdults\}A \+ \$\{numChildren\}C/);
    expect(bookingsPageSrc).toMatch(/\$\{extraBedCount\} bed/);
    expect(bookingsPageSrc).toMatch(/title=\{`\$\{row\.numGuests\} guest/);
  });
});

describe("EXB-08 — admin receipt PDF shows the split + extra bed", () => {
  it("receipt PDF 'Guests:' line shows the split + extra bed when the split is present", () => {
    // The PDF uses the same compact form as the table
    // row (single-line layout, limited horizontal
    // space). The legacy `numGuests`-only form is
    // preserved for pre-CHD bookings.
    expect(bookingsPageSrc).toMatch(
      /pdf\.text\(`Guests: \$\{splitLabel\}\$\{extraLabel\}  \|  Nights: \$\{b\.numNights\}`/
    );
    expect(bookingsPageSrc).toMatch(
      /\$\{numAdults\}A \+ \$\{numChildren\}C \(\$\{b\.numGuests\}\)/
    );
  });

  it("receipt PDF 'Stay' line shows the split + extra bed via an IIFE", () => {
    // The Stay line is the receipt's "nights + guests"
    // summary. The new shape uses a multi-line IIFE
    // that returns the verbose split form when the
    // split is present, or the legacy "X guests" form
    // when absent. The label key is unchanged.
    expect(bookingsPageSrc).toMatch(
      /\{ label:\s*["']Stay["'],\s*value:\s*\(\(\) => \{/
    );
    expect(bookingsPageSrc).toMatch(/nightsLabel/);
    expect(bookingsPageSrc).toMatch(/numAdults/);
    expect(bookingsPageSrc).toMatch(/numChildren/);
    expect(bookingsPageSrc).toMatch(/extraBedCount/);
  });
});

describe("EXB-08 — admin Bookings drawer 'Guests:' + 'Stay' lines show the split", () => {
  it("drawer 'Guests:' line shows the verbose 'X adults + Y children (Z total)' form", () => {
    expect(bookingsPageSrc).toMatch(
      /\$\{numAdults\} adult\$\{numAdults === 1 \? "" : "s"\} \+ \$\{numChildren\} child\$\{numChildren === 1 \? "" : "ren"\} \(\$\{selectedBooking\.numGuests\} total\)/
    );
  });

  it("drawer 'Stay' line in the 'Room stay details' section shows the split", () => {
    // The "Guests: ..." paragraph under the stay
    // section mirrors the drawer header. The
    // `extraLabel` is appended when `extraBedCount > 0`.
    expect(bookingsPageSrc).toMatch(
      /\$\{numAdults\} adult\$\{numAdults === 1 \? "" : "s"\} \+ \$\{numChildren\} child\$\{numChildren === 1 \? "" : "ren"\} \(\$\{selectedBooking\.numGuests\} total\)/
    );
  });
});

describe("EXB-08 — admin Reports line shows the split + extra bed", () => {
  it("Reports line uses the compact '2A + 1C' form + 'N bed(s)' when the split is present", () => {
    expect(reportsPageSrc).toMatch(/\$\{numAdults\}A \+ \$\{numChildren\}C/);
    expect(reportsPageSrc).toMatch(/\$\{extraBedCount\} bed/);
    expect(reportsPageSrc).toMatch(/title=\{`\$\{b\.numGuests\} guest/);
  });
});

describe("EXB-08 — guest /my-booking card shows the split + extra bed", () => {
  it("booking lookup page inline card shows the verbose 'X adults + Y children (Z total)' form", () => {
    // The /my-booking page renders the card inline
    // (not via the orphan `BookingSummaryCard`).
    // The verbose form matches the admin drawer
    // header so the guest + staff see the same
    // occupancy breakdown.
    expect(bookingLookupSrc).toMatch(
      /\$\{numAdults\} adult\$\{numAdults === 1 \? "" : "s"\} \+ \$\{numChildren\} child\$\{numChildren === 1 \? "" : "ren"\} \(\$\{activeBooking\.numGuests\} total\)/
    );
    expect(bookingLookupSrc).toMatch(/\+ \$\{extraBedCount\} extra bed/);
  });

  it("orphan BookingSummaryCard also renders the split (for future importers)", () => {
    // The orphan card was unused before EXB-08 but
    // was kept for future reuse. The new shape accepts
    // the 3 optional fields + renders the same split
    // + extra bed UX. Pin the shape so a future page
    // that imports the orphan gets the EXB-08 UX for
    // free.
    expect(bookingSummaryCardSrc).toMatch(
      /numAdults\?:\s*number;\s*numChildren\?:\s*number;/
    );
    expect(bookingSummaryCardSrc).toMatch(/extraBedCount\?:\s*number/);
    expect(bookingSummaryCardSrc).toMatch(
      /\{Number\(numAdults\)\}\s+adult/
    );
    expect(bookingSummaryCardSrc).toMatch(
      /\+ \{extraBedCountValue\} extra bed/
    );
  });
});
