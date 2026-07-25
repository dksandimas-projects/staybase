import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

// Regression tests for GSD-01 (Spark Essentials Store Catalog
// Discovery, decision #138, 2026-07-25). Pins the search + category
// filter feature on the in-room intercom store page:
//   - search field below the store intro, name + description
//     matching, trimmed + case-insensitive
//   - category chip rail that starts with "All" and only renders
//     categories that exist in the live catalog (Drinks, Snacks,
//     Toiletries, Rentals, Other)
//   - AND composition between search and category, result count,
//     and a one-action clear/reset control
//   - chip rail scrolls horizontally on narrow screens, keeps a
//     44px touch target, and exposes selected state via
//     `aria-pressed` / `aria-selected`
//   - filter state lives at IntercomPage scope so it survives
//     Shop / Chat / cart / checkout view switches and never
//     touches the cart
//   - alphabetical-then-out-of-stock sort
//   - distinct no-match state with a "Clear filters" CTA,
//     separate from the unavailable/empty-store state
//
// Spec: plan/features/STORE-GUEST.md §Catalog Discovery (GSD-01)

describe("GSD-01 — StoreItem type carries category on the guest client", () => {
  const intercom = read("guest-app/src/pages/IntercomPage.tsx");

  it("StoreItem interface declares a category field", () => {
    expect(intercom).toMatch(
      /interface StoreItem\s*\{[\s\S]*?category:\s*StoreCategory;[\s\S]*?\}/
    );
  });

  it("declares the StoreCategory union with the same 5 admin-owned values", () => {
    // Mirrors admin-app/src/pages/SettingsPage.tsx storeCategories
    // so chip labels and the admin selector stay in sync. Order:
    // drinks, snacks, toiletries, rentals, other.
    expect(intercom).toMatch(
      /type StoreCategory = "drinks" \| "snacks" \| "toiletries" \| "rentals" \| "other"/
    );
  });

  it("exposes a stable label map for the chip rail", () => {
    expect(intercom).toMatch(
      /const STORE_CATEGORY_LABELS: Record<StoreCategory, string>\s*=\s*\{[\s\S]*?drinks:\s*"Drinks"[\s\S]*?snacks:\s*"Snacks"[\s\S]*?toiletries:\s*"Toiletries"[\s\S]*?rentals:\s*"Rentals"[\s\S]*?other:\s*"Other"[\s\S]*?\}/
    );
  });

  it("normalizes legacy / missing category values to 'other' on the snapshot map", () => {
    // Mirrors the admin-side `normalizeStoreCategory` in
    // admin-app/src/context/AdminContext.tsx so the guest sees the
    // same fallback for legacy items that predate the field.
    expect(intercom).toMatch(/function normalizeStoreCategory\(value: unknown\): StoreCategory/);
    expect(intercom).toMatch(/STORE_CATEGORY_VALUES\.includes\(value as StoreCategory\)/);
    expect(intercom).toMatch(/return STORE_CATEGORY_VALUES\.includes[\s\S]*?\(value as StoreCategory\)[\s\S]*?\? \(value as StoreCategory\)[\s\S]*?: "other"/);
  });

  it("snapshot mapper hydrates category via normalizeStoreCategory (data.category → 'other' fallback)", () => {
    expect(intercom).toMatch(/category:\s*normalizeStoreCategory\(data\.category\),/);
  });
});

describe("GSD-01 — filter state lives at IntercomPage scope and is independent from the cart", () => {
  const intercom = read("guest-app/src/pages/IntercomPage.tsx");

  it("filter state is declared inside the IntercomPage component (not in a sub-component)", () => {
    // useState hooks for storeSearch / storeCategoryFilter must
    // live inside the IntercomPage function body so they survive
    // Shop ↔ Chat ↔ cart ↔ checkout view switches.
    expect(intercom).toMatch(/const \[storeSearch,\s*setStoreSearch\]\s*=\s*useState<string>\(""\)/);
    expect(intercom).toMatch(/const \[storeCategoryFilter,\s*setStoreCategoryFilter\]\s*=\s*useState<StoreCategory \| "all">\("all"\)/);
  });

  it("does not clear the cart when the filter state updates", () => {
    // Pinned negative test: the clearStoreFilters handler must
    // only touch filter state, never cart state. The cart lives at
    // the same scope but is mutated only by addToCart /
    // updateCartQuantity / setCart([]) on its own paths.
    expect(intercom).toMatch(/const clearStoreFilters = \(\) =>\s*\{[\s\S]*?setStoreSearch\(""\)[\s\S]*?setStoreCategoryFilter\("all"\)[\s\S]*?\};?/);
    // The handler body must contain only the two filter setters
    // and the closing brace — no cart mutation. Capture the
    // handler body and assert it does NOT mention `setCart`.
    const bodyMatch = intercom.match(/const clearStoreFilters = \(\) =>\s*\{([\s\S]*?)\};?/);
    expect(bodyMatch).not.toBeNull();
    expect(bodyMatch?.[1] ?? "").not.toMatch(/setCart/);
  });
});

describe("GSD-01 — search + category filters compose with AND semantics", () => {
  const intercom = read("guest-app/src/pages/IntercomPage.tsx");

  it("defines a memoized filteredStoreItems over the existing real-time snapshot", () => {
    // Client-side, memoized — no extra Firestore reads per
    // keystroke or chip tap.
    expect(intercom).toMatch(/const filteredStoreItems = useMemo\(\(\) =>\s*\{/);
  });

  it("normalizes the search query (trim + lowercase) before matching", () => {
    expect(intercom).toMatch(/const normalizedQuery = storeSearch\.trim\(\)\.toLowerCase\(\)/);
  });

  it("matches against name + description (lower-cased haystack)", () => {
    expect(intercom).toMatch(/const haystack = `\$\{item\.name\} \$\{item\.description\}`\.toLowerCase\(\)/);
    expect(intercom).toMatch(/if \(!haystack\.includes\(normalizedQuery\)\)[\s\S]*?return false/);
  });

  it("AND-composes search and category (item.category must match the chip when not 'all')", () => {
    expect(intercom).toMatch(/if \(storeCategoryFilter !== "all" && item\.category !== storeCategoryFilter\)[\s\S]*?return false/);
  });

  it("only matches when the search query has at least one non-whitespace character", () => {
    // After trim, an empty query is a no-op (returns true for
    // every item on the search axis). This is the contract: a
    // whitespace-only query must not be treated as a wildcard.
    expect(intercom).toMatch(/if \(normalizedQuery\.length > 0\)/);
  });

  it("filters case-insensitively (haystack + query both lowercased)", () => {
    expect(intercom).toMatch(/`\$\{item\.name\} \$\{item\.description\}`\.toLowerCase\(\)/);
    expect(intercom).toMatch(/storeSearch\.trim\(\)\.toLowerCase\(\)/);
  });
});

describe("GSD-01 — alphabetical-then-out-of-stock sort", () => {
  const intercom = read("guest-app/src/pages/IntercomPage.tsx");

  it("groups in-stock items before out-of-stock items", () => {
    // stock === null (unlimited) counts as in-stock so unlimited
    // items never end up below the out-of-stock group.
    expect(intercom).toMatch(/const isInStock = \(item: StoreItem\) => item\.stock === null \|\| item\.stock > 0/);
    expect(intercom).toMatch(/if \(aInStock !== bInStock\)[\s\S]*?return aInStock \? -1 : 1/);
  });

  it("sorts each group alphabetically by name (localeCompare)", () => {
    expect(intercom).toMatch(/return a\.name\.localeCompare\(b\.name\)/);
  });
});

describe("GSD-01 — represented categories drive the chip rail", () => {
  const intercom = read("guest-app/src/pages/IntercomPage.tsx");

  it("computes representedStoreCategories via useMemo over storeItems", () => {
    expect(intercom).toMatch(/const representedStoreCategories = useMemo<StoreCategory\[\]>\(\(\) =>\s*\{/);
  });

  it("only includes categories that appear in the live catalog", () => {
    expect(intercom).toMatch(/const present = new Set<StoreCategory>\(\)/);
    expect(intercom).toMatch(/present\.add\(item\.category\)/);
  });

  it("orders chips via the canonical label order (drinks → snacks → toiletries → rentals → other)", () => {
    expect(intercom).toMatch(/return STORE_CATEGORY_LABEL_ORDER\.filter\(\(category\) => present\.has\(category\)\)/);
  });
});

describe("GSD-01 — search input below the shop intro", () => {
  const intercom = read("guest-app/src/pages/IntercomPage.tsx");

  it("renders a search input with an accessible label and magnifier icon", () => {
    // The Search icon import proves we're not using a font-icon or
    // ad-hoc SVG. The input has aria-label, an explicit type, and a
    // 44px touch height. Attribute order in the source is
    // `type` → ... → `placeholder` → ... → `aria-label` → ... →
    // `className`, so the regex mirrors that order.
    expect(intercom).toMatch(/import\s*\{[\s\S]*?Search[\s\S]*?\}\s*from\s*["']lucide-react["']/);
    expect(intercom).toMatch(/<input[\s\S]*?type="search"[\s\S]*?placeholder="Search the shop"[\s\S]*?aria-label="Search the shop"[\s\S]*?className="[^"]*min-h-\[44px\][^"]*"/);
  });

  it("shows a clear (X) button only when the search query is non-empty", () => {
    expect(intercom).toMatch(/\{storeSearch\.length > 0 && \([\s\S]*?<button[\s\S]*?aria-label="Clear search"[\s\S]*?\)\}/);
  });
});

describe("GSD-01 — category chip rail", () => {
  const intercom = read("guest-app/src/pages/IntercomPage.tsx");

  it("starts with an 'All' chip whose selected state uses aria-pressed + aria-selected", () => {
    expect(intercom).toMatch(/<button[\s\S]*?aria-selected=\{storeCategoryFilter === "all"\}[\s\S]*?aria-pressed=\{storeCategoryFilter === "all"\}[\s\S]*?>[\s\S]*?All[\s\S]*?<\/button>/);
  });

  it("renders one chip per represented category with a 44px touch target and aria-pressed", () => {
    // Horizontal scroll on narrow screens, 44px min height, and
    // selected state is exposed both via aria-selected and
    // aria-pressed for assistive tech that honours either.
    expect(intercom).toMatch(/className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none"/);
    expect(intercom).toMatch(/min-h-\[44px\] shrink-0 rounded-full px-4 text-xs font-semibold/);
    expect(intercom).toMatch(/aria-selected=\{isActive\}[\s\S]*?aria-pressed=\{isActive\}/);
  });

  it("hides the chip rail when no categories are represented (empty catalog)", () => {
    expect(intercom).toMatch(/\{representedStoreCategories\.length > 0 && \(/);
  });
});

describe("GSD-01 — result count + one-action clear/reset", () => {
  const intercom = read("guest-app/src/pages/IntercomPage.tsx");

  it("shows a live result count and a single Clear filters control when filters are active", () => {
    // Spec item 3: "show the filtered result count and a
    // one-action clear/reset control".
    expect(intercom).toMatch(/aria-live="polite"[\s\S]*?\{filteredStoreItems\.length === storeItems\.length[\s\S]*?`\$\{storeItems\.length\} item\$\{storeItems\.length === 1 \? "" : "s"\} available`[\s\S]*?: `\$\{filteredStoreItems\.length\} of \$\{storeItems\.length\} item\$\{storeItems\.length === 1 \? "" : "s"\} match your filters`/);
    expect(intercom).toMatch(/\{hasActiveStoreFilters && \([\s\S]*?<button[\s\S]*?onClick=\{clearStoreFilters\}[\s\S]*?>[\s\S]*?Clear filters[\s\S]*?<\/button>[\s\S]*?\)\}/);
  });

  it("exposes hasActiveStoreFilters as a derived signal (search non-empty OR category !== all)", () => {
    expect(intercom).toMatch(/const hasActiveStoreFilters = storeSearch\.trim\(\)\.length > 0 \|\| storeCategoryFilter !== "all"/);
  });
});

describe("GSD-01 — no-match state is distinct from the empty/unavailable state", () => {
  const intercom = read("guest-app/src/pages/IntercomPage.tsx");

  it("renders the no-match state only when storeItems has items but the filter pair produces zero", () => {
    expect(intercom).toMatch(/\{storeItems\.length > 0 && filteredStoreItems\.length === 0 && !storeError && \(/);
  });

  it("no-match copy says 'No items match your filters' and offers a primary Clear filters CTA", () => {
    expect(intercom).toMatch(/No items match your filters\./);
    expect(intercom).toMatch(/Try a different search or category\./);
    expect(intercom).toMatch(/<button[\s\S]*?onClick=\{clearStoreFilters\}[\s\S]*?className="[^"]*min-h-\[44px\][^"]*"[\s\S]*?>[\s\S]*?Clear filters[\s\S]*?<\/button>/);
  });

  it("empty / unavailable state still says 'The shop is currently unavailable' and is unchanged", () => {
    // Pinned regression: the existing empty-state copy must
    // remain for the all-items-inactive case so the no-match
    // state stays distinct.
    expect(intercom).toMatch(/\{storeItems\.length === 0 && !storeError && \([\s\S]*?The shop is currently unavailable\./);
  });
});

describe("GSD-01 — catalog discovery rendered only when the live catalog has items", () => {
  const intercom = read("guest-app/src/pages/IntercomPage.tsx");

  it("wraps the search + chip + result-count block in a storeItems.length > 0 guard", () => {
    // When the catalog is empty, the filter chrome is hidden so
    // the unavailable empty-state copy stands on its own.
    expect(intercom).toMatch(/\{storeItems\.length > 0 && \(\s*<div className="space-y-2\.5">[\s\S]*?<\/div>\s*\)\}/);
  });

  it("item grid renders filteredStoreItems (not the raw snapshot)", () => {
    // The grid must use the memo so filters actually take
    // effect. The legacy `storeItems.map` reference is gone.
    expect(intercom).toMatch(/\{filteredStoreItems\.map\(\(item\) =>\s*\{/);
    expect(intercom).not.toMatch(/\{storeItems\.map\(\(item\) =>\s*\{/);
  });
});
