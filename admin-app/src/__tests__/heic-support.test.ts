import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Per HSD-04 (refactor/unify-payment-reference-fields) —
// the canonical test pattern for admin-app surface checks is
// to read the source and assert the contract. `handleGuestIdUpload`
// is a closure inside BookingsPage, so vitest can't reach it
// without extracting the helper into a named export (not worth
// the refactor for a one-off wiring check).

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");
const pageSrc = read("admin-app/src/pages/BookingsPage.tsx");
const packageJson = JSON.parse(read("admin-app/package.json")) as {
  dependencies?: Record<string, string>;
};

describe("HSD-02 — HEIC client-side conversion", () => {
  test("dynamic-imports heic-to (lazy-loaded, not statically imported)", () => {
    // The dynamic import is the whole point of the HSD budget
    // control: heic-to must NOT be a top-level import, otherwise
    // Vite inlines it into the main bundle and every admin user
    // pays the 734 KB gzipped cost on first paint. The check
    // looks for the `await import("heic-to")` form in the
    // handleGuestIdUpload flow.
    expect(pageSrc).toMatch(/await\s+import\(["']heic-to["']\)/);
    // Negative: no top-level import (would break the lazy split).
    expect(pageSrc).not.toMatch(/^import\s+.*\bheic-to\b.*from\s+["']heic-to["'];?$/m);
  });

  test("HEIC/HEIF input types are detected BEFORE the allowlist rejection", () => {
    // The HEIC branch must run before the strict-reject allowlist
    // check — otherwise the iPhone workflow would still hit the
    // "Unsupported image format" toast. The order matters because
    // the converted JPEG is what feeds the allowlist, not the
    // original HEIC blob.
    const heicBranchIndex = pageSrc.indexOf("HEIC_INPUT_MIME_TYPES.has(file.type)");
    const allowlistIndex = pageSrc.indexOf("ALLOWED_GUEST_ID_MIME_TYPES.has(file.type)");
    expect(heicBranchIndex).toBeGreaterThan(0);
    expect(allowlistIndex).toBeGreaterThan(0);
    expect(heicBranchIndex).toBeLessThan(allowlistIndex);
  });

  test("converts the HEIC blob to a JPEG File with the right MIME type", () => {
    // The conversion contract: the output of heicTo() is wrapped
    // in a `new File([...], "name.jpg", { type: "image/jpeg" })`
    // so the downstream `compressImageFile` + Storage upload
    // never sees a HEIC blob.
    expect(pageSrc).toMatch(/heicTo\(\s*\{\s*blob:\s*file\s*,\s*type:\s*["']image\/jpeg["']/);
    expect(pageSrc).toMatch(/new File\(\[converted\]/);
    expect(pageSrc).toMatch(/\{\s*type:\s*["']image\/jpeg["']\s*\}\)/);
  });

  test("JPEG/PNG/WebP inputs skip the conversion path entirely", () => {
    // Non-HEIC uploads must not pay the 734 KB lazy chunk cost.
    // The check looks for the `else if` branch that handles the
    // non-HEIC + non-allowlist case (which is where the rejection
    // lives) and asserts the HEIC conversion is gated on the
    // HEIC_INPUT_MIME_TYPES set membership.
    expect(pageSrc).toMatch(/if\s*\(HEIC_INPUT_MIME_TYPES\.has\(file\.type\)\)/);
    // The allowlist check must be in the `else if` branch so a
    // HEIC file never reaches it.
    expect(pageSrc).toMatch(/else\s+if\s*\(!file\.type\s*\|\|\s*!ALLOWED_GUEST_ID_MIME_TYPES\.has\(file\.type\)\)/);
  });

  test("HEIC conversion errors fall through to a friendly user-facing message", () => {
    // Per the spec: "the conversion error path still falls through
    // to the existing 5s decode-timeout toast in the PDF
    // generator." On the upload side, the catch block sets a
    // status message and `return`s — the upload step never runs
    // with a bad blob. This is the iPhone safety net: if heic-to
    // throws (corrupt HEIC, oversized, wasm init failure) the
    // staff sees a clear next step, not a silent failure.
    expect(pageSrc).toMatch(/setGuestIdUploadStatus\(\s*[`'"][\s\S]*?Could not convert HEIC/);
  });
});

describe("HSD-03 — allowlist + copy + accept attribute", () => {
  test("HEIC/HEIF are NOT in the guest ID allowlist (now handled by the converter)", () => {
    // The allowlist remains the source of truth for the
    // post-conversion stream: anything not JPEG/PNG/WebP after
    // the HEIC branch is rejected. Asserting the negative
    // (no HEIC in the list) pins the contract that staff can't
    // upload a raw HEIC blob via the old "convert off" path
    // even if heic-to ever becomes unavailable.
    const allowlistMatch = pageSrc.match(/ALLOWED_GUEST_ID_MIME_TYPES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(allowlistMatch).not.toBeNull();
    const allowlistBody = allowlistMatch?.[1] ?? "";
    expect(allowlistBody).toMatch(/image\/jpeg/);
    expect(allowlistBody).toMatch(/image\/png/);
    expect(allowlistBody).toMatch(/image\/webp/);
    expect(allowlistBody).not.toMatch(/image\/heic/);
    expect(allowlistBody).not.toMatch(/image\/heif/);
  });

  test("file picker accept attribute includes HEIC + HEIF", () => {
    // The accept attribute is a hint to the OS file picker, not
    // an enforcement point. iOS Safari's picker only surfaces
    // HEIC photos when the accept list includes image/heic —
    // dropping it here would re-break the iPhone workflow even
    // though the convert path works.
    const acceptMatch = pageSrc.match(/accept="([^"]+)"/);
    expect(acceptMatch).not.toBeNull();
    const accept = acceptMatch?.[1] ?? "";
    expect(accept).toMatch(/image\/heic/);
    expect(accept).toMatch(/image\/heif/);
  });

  test("upload card copy mentions HEIC auto-conversion", () => {
    // Staff need to know HEIC works so they don't fall back to
    // "ask the guest to convert" — the iPhone workflow Just Works.
    expect(pageSrc).toMatch(/HEIC from iPhone cameras is auto-converted/);
  });
});

describe("HSD-04 — package wiring", () => {
  test("admin-app declares heic-to as a real dependency (not a dev dep, not a peer)", () => {
    // The lib is lazy-loaded at runtime, so it has to be in
    // `dependencies` (not `devDependencies`) for Vite to bundle
    // it for the dynamic import. The dynamic-import check above
    // pins the runtime contract; this check pins the install
    // contract.
    expect(packageJson.dependencies?.["heic-to"]).toBeDefined();
  });
});
