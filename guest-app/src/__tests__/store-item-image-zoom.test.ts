// Per decision #342 (2026-11-23): the Spark Essentials item photo.
//
// The shop grid renders every item photo as a 112px-tall `object-cover`
// crop, and until now that crop was the ONLY rendering of the photo — a
// guest who wanted to see what they were ordering had no way to look
// closer, and the only escape (opening the image in a new tab) navigated
// them AWAY from the shop panel with their basket still in it.
//
// These are SOURCE-TEXT pins, because what regressed before in this
// codebase was the WIRING: the affordance existed but the grid never
// called it, and the badge overlay quietly swallowed the tap.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("StoreItemImage — the shop photo opens full size", () => {
  const component = readFileSync(
    resolve(__dirname, "../components/StoreItemImage.tsx"),
    "utf8"
  );
  const page = readFileSync(
    resolve(__dirname, "../pages/IntercomPage.tsx"),
    "utf8"
  );

  it("the shop grid renders the component, not a bare <img>", () => {
    expect(page).toMatch(/import \{ StoreItemImage \} from "\.\.\/components\/StoreItemImage"/);
    expect(page).toMatch(
      /<StoreItemImage name=\{item\.name\} imageUrl=\{item\.imageUrl\} \/>/
    );
    // The old inline crop is gone from the grid.
    expect(page).not.toMatch(/src=\{item\.imageUrl\}/);
  });

  it("the thumbnail is a real button with an accessible name", () => {
    expect(component).toMatch(/<button/);
    expect(component).toMatch(/type="button"/);
    expect(component).toMatch(/aria-label=\{`View the full photo of \$\{name\}`\}/);
    expect(component).toMatch(/onClick=\{\(\) => setIsOpen\(true\)\}/);
  });

  it("the full view uses the guest Modal primitive, not a hand-rolled overlay", () => {
    expect(component).toMatch(/import \{ Modal \} from "\.\/Modal"/);
    expect(component).toMatch(/<Modal/);
    expect(component).toMatch(/open=\{isOpen\}/);
    expect(component).toMatch(/onClose=\{\(\) => setIsOpen\(false\)\}/);
    // The full photo is rendered at its natural aspect — NOT cropped.
    expect(component).toMatch(/max-h-\[65vh\]/);
    expect(component).toMatch(/object-contain/);
  });

  it("the expand affordance is visible without a hover (the panel is a phone)", () => {
    // The chip is NOT inside a `group-hover:` only rule — it is rendered
    // unconditionally, so a touch guest can see that the photo is tappable.
    expect(component).toMatch(/absolute bottom-2 right-2/);
    expect(component).not.toMatch(/group-hover:opacity-100[\s\S]{0,80}Maximize2/);
  });

  it("the stock badge floats over the photo without swallowing the tap", () => {
    expect(page).toMatch(
      /pointer-events-none absolute top-2 left-2/
    );
  });

  it("an item with no photo still renders its placeholder", () => {
    // The placeholder branch stays — only items WITH a photo get the
    // tappable component, so there is no dead button on a photo-less item.
    expect(page).toMatch(/item\.imageUrl \? \(/);
    expect(page).toMatch(/<ShoppingBag size=\{24\} \/>/);
  });
});
