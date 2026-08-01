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

describe("CHD-03 — Settings → Room Types child cap", () => {
  it("renders the adult and child caps in both Room Types list layouts", () => {
    expect(settingsPageSrc).toMatch(/Up to \{type\.maxCapacity\} adult/);
    expect(settingsPageSrc).toMatch(/Occupancy Caps/);
    expect(settingsPageSrc.match(/\{type\.maxChildren \?\? 0\}/g)).toHaveLength(2);
  });

  it("labels maxCapacity as the adult cap in Add and Edit", () => {
    expect(settingsPageSrc.match(/Maximum adults \(12\+\)/g)).toHaveLength(2);
  });

  it("renders accessible child-cap inputs in Add and Edit", () => {
    expect(settingsPageSrc.match(/Maximum children \(0–11\)/g)).toHaveLength(2);
    expect(settingsPageSrc.match(/name="maxChildren"/g)).toHaveLength(2);
    expect(settingsPageSrc).toMatch(/id="add-room-type-child-cap-help"/);
    expect(settingsPageSrc).toMatch(/id="edit-room-type-child-cap-help"/);
    expect(settingsPageSrc.match(/aria-describedby="(?:add|edit)-room-type-child-cap-help"/g)).toHaveLength(2);
  });

  it("keeps both child-cap controls non-negative, integral, and touch-friendly", () => {
    const inputs = settingsPageSrc.match(
      /<input\s+name="maxChildren"[\s\S]*?\/>/g
    );
    expect(inputs).toHaveLength(2);
    for (const input of inputs ?? []) {
      expect(input).toMatch(/type="number"/);
      expect(input).toMatch(/min=\{0\}/);
      expect(input).toMatch(/step=\{1\}/);
      expect(input).toMatch(/required/);
      expect(input).toMatch(/min-h-\[44px\]/);
    }
  });

  it("defaults a new room type to zero children and hydrates Edit from the type", () => {
    expect(settingsPageSrc).toMatch(
      /name="maxChildren"[\s\S]{0,180}defaultValue=\{0\}/
    );
    expect(settingsPageSrc).toMatch(
      /name="maxChildren"[\s\S]{0,220}defaultValue=\{editType\.maxChildren \?\? 0\}/
    );
  });

  it("parses and clamps maxChildren in both save handlers", () => {
    expect(
      settingsPageSrc.match(
        /const maxChildren = Math\.max\([\s\S]{0,180}parseInt\([\s\S]{0,180}"maxChildren"/g
      )
    ).toHaveLength(2);
  });

  it("persists maxChildren through both addRoomType and updateRoomType", () => {
    const addCall = settingsPageSrc.match(
      /addRoomType\(\{[\s\S]*?\n\s*\}\);/
    );
    const updateCall = settingsPageSrc.match(
      /await updateRoomType\(editType\.value,\s*\{[\s\S]*?\n\s*\}\);/
    );
    expect(addCall).toBeTruthy();
    expect(addCall![0]).toMatch(/maxCapacity,[\s\S]*?maxChildren,/);
    expect(updateCall).toBeTruthy();
    expect(updateCall![0]).toMatch(/maxCapacity,[\s\S]*?maxChildren,/);
  });

  it("uses the existing full-array persistence path", () => {
    const publicUpdateSignature = adminContextSrc.match(
      /updateRoomType:\s*\([\s\S]*?\) => Promise<void>;/
    );
    expect(publicUpdateSignature).toBeTruthy();
    expect(publicUpdateSignature![0]).toMatch(/\| "maxChildren"/);
    expect(adminContextSrc).toMatch(
      /const addRoomType = async[\s\S]*?maxChildren\?: number[\s\S]*?await saveRoomTypes\(updated\)/
    );
    expect(adminContextSrc).toMatch(
      /const updateRoomType = async[\s\S]*?\| "maxChildren"[\s\S]*?await saveRoomTypes\(updated\)/
    );
  });
});
