import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const settingsPageSrc = readFileSync(
  resolve(__dirname, "../pages/SettingsPage.tsx"),
  "utf8"
);

const adminContextSrc = readFileSync(
  resolve(__dirname, "../context/AdminContext.tsx"),
  "utf8"
);

describe("NBS-04 — Settings → Booking Sources tab", () => {
  it("registers the deep-linkable Booking Sources tab", () => {
    expect(settingsPageSrc).toMatch(/type TabId = [^;]*"sources"/);
    expect(settingsPageSrc).toMatch(/VALID_TAB_IDS[\s\S]*?"sources"/);
    expect(settingsPageSrc).toMatch(
      /\{\s*id:\s*"sources"\s*as const,\s*label:\s*"Booking Sources",\s*icon:\s*Tag\s*\}/
    );
  });

  it("wires all four AdminContext booking-source operations into the tab", () => {
    expect(settingsPageSrc).toMatch(
      /bookingSources,[\s\S]*?addBookingSource,[\s\S]*?updateBookingSource,[\s\S]*?reorderBookingSources,[\s\S]*?deleteBookingSource/
    );
    expect(settingsPageSrc).toMatch(
      /<BookingSourcesTabBody[\s\S]*?bookingSources=\{bookingSources\}[\s\S]*?onAdd=\{addBookingSource\}[\s\S]*?onUpdate=\{updateBookingSource\}[\s\S]*?onReorder=\{reorderBookingSources\}[\s\S]*?onDelete=\{deleteBookingSource\}/
    );
  });

  it("keeps booking-source configuration admin-only", () => {
    const start = settingsPageSrc.indexOf('{activeTab === "sources"');
    expect(start).toBeGreaterThan(-1);
    const block = settingsPageSrc.slice(start, start + 1400);
    expect(block).toMatch(/isAdmin\s*\?/);
    expect(block).toMatch(/Admin-only section/);
  });

  it("renders one responsive card per configured source with enabled and front-desk controls", () => {
    expect(settingsPageSrc).toMatch(/bookingSources\.map\(\(entry, index\) =>/);
    expect(settingsPageSrc).toMatch(/handleToggleEnabled\(entry\)/);
    expect(settingsPageSrc).toMatch(/handleToggleFrontDesk\(entry\)/);
    expect(settingsPageSrc).toMatch(/min-h-\[44px\]/);
  });

  it("shows protected sources as Required and omits their delete action", () => {
    expect(settingsPageSrc).toMatch(/PROTECTED_BOOKING_SOURCES/);
    expect(settingsPageSrc).toMatch(/protectedSource && \([\s\S]*?Required/);
    expect(settingsPageSrc).toMatch(/!protectedSource && \([\s\S]*?handleDelete\(entry\)/);
  });

  it("supports full-array reordering through the existing bulk API", () => {
    expect(settingsPageSrc).toMatch(/const next = \[\.\.\.bookingSources\]/);
    expect(settingsPageSrc).toMatch(/onReorder\(next\)/);
    expect(settingsPageSrc).toMatch(/disabled=\{index === 0\}/);
    expect(settingsPageSrc).toMatch(/disabled=\{index === bookingSources\.length - 1\}/);
  });

  it("uses a two-click delete confirmation without native confirm()", () => {
    expect(settingsPageSrc).toMatch(/pendingDelete !== entry\.source/);
    expect(settingsPageSrc).toMatch(/Click the delete button again within 3 seconds to confirm/);
    expect(settingsPageSrc).not.toMatch(/\bwindow\.confirm\(/);
  });

  it("provides Add/Edit modal fields and keeps the persisted key immutable", () => {
    expect(settingsPageSrc).toMatch(/title=\{editModal\.isNew \? "Add booking source"/);
    expect(settingsPageSrc).toMatch(/Source key/);
    expect(settingsPageSrc).toMatch(/Display label/);
    expect(settingsPageSrc).toMatch(/disabled=\{!editModal\.isNew\}/);
    expect(settingsPageSrc).toMatch(/selectableAtFrontDesk/);
  });

  it("validates lowercase key syntax and required labels before persistence", () => {
    expect(settingsPageSrc).toMatch(/\^\[a-z0-9-\]\+\$/);
    expect(settingsPageSrc).toMatch(/Source key is required/);
    expect(settingsPageSrc).toMatch(/Label is required/);
  });

  it("forces protected sources to remain system-assigned", () => {
    expect(settingsPageSrc).toMatch(
      /selectableAtFrontDesk:\s*protectedSource\s*\?\s*false\s*:\s*editModal\.source\.selectableAtFrontDesk/
    );
  });

  it("rolls back optimistic state and propagates persistence failures", () => {
    const persistBlock = adminContextSrc.match(
      /const persistBookingSources = async[\s\S]*?\n  \};/
    );
    expect(persistBlock).toBeTruthy();
    expect(persistBlock![0]).toMatch(/const previous = bookingSources/);
    expect(persistBlock![0]).toMatch(/if \(!success\) throw new Error/);
    expect(persistBlock![0]).toMatch(/setBookingSources\(previous\)/);
    expect(persistBlock![0]).toMatch(/throw error/);
  });
});
