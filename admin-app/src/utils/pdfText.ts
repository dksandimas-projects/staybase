import type { jsPDF } from "jspdf";

// Every admin PDF is drawn with jsPDF's built-in Helvetica, a standard
// PDF font with a WinAnsi encoding (AA-30 deliberately keeps it that way
// rather than embedding a brand TTF). WinAnsi tops out at U+00FF plus the
// 27 typographic characters below, and a single character outside that set
// makes jsPDF give up on the whole string and emit it as UTF-16 — which
// the font has no CMap for.
//
// That is the "±" bug on the booking receipt: the peso sign, U+20B1, is
// not in WinAnsi, so "₱2,390" went out as 20 B1 00 32 00 2C 00 33 … and the
// viewer drew "± 2 , 3 9 0" — the stray byte pairs also letter-spaced every
// line carrying an amount.
//
// `guest-app/server/handlers/email.ts` solves the same problem the same way
// for the emailed receipt, so the copy the desk prints and the copy the
// guest receives both read "PHP 2,390".

// The characters above U+00FF that WinAnsiEncoding *does* carry (its
// 0x80–0x9F block). Em dashes, bullets, curly quotes and ellipses render
// correctly, so they must not be stripped.
const WIN_ANSI_HIGH_CHARS = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";
const UNSUPPORTED_CHAR = new RegExp(`[^\\x00-\\xFF${WIN_ANSI_HIGH_CHARS}]`, "g");

/**
 * Rewrite a string into characters the PDF's standard font can encode.
 * The peso sign becomes the "PHP " currency code; anything else outside
 * WinAnsi is decomposed to its closest Latin-1 form and dropped only when
 * it has none, so one stray character can never corrupt a whole line.
 */
export function toPdfSafeText(value: unknown): string {
  return String(value ?? "")
    .replace(/₱/g, "PHP ")
    .replace(UNSUPPORTED_CHAR, (character) =>
      character.normalize("NFKD").replace(UNSUPPORTED_CHAR, "")
    );
}

function sanitizeTextArgument(value: unknown): unknown {
  return Array.isArray(value) ? value.map((entry) => toPdfSafeText(entry)) : toPdfSafeText(value);
}

/**
 * Route every string this document draws or measures through
 * `toPdfSafeText`, once, at the top of a PDF builder. Measurement is
 * patched alongside drawing because "PHP 2,390" is wider than "₱2,390" —
 * right-aligned amounts and truncation would otherwise be laid out
 * against text that is never drawn.
 */
export function installPdfTextSanitizer(pdf: jsPDF) {
  const target = pdf as jsPDF & { __brandTextSanitized?: boolean };
  if (target.__brandTextSanitized) return;
  target.__brandTextSanitized = true;

  const drawText = pdf.text.bind(pdf) as (...args: unknown[]) => unknown;
  const measureText = pdf.getTextWidth.bind(pdf) as (text: string) => number;
  const splitText = pdf.splitTextToSize.bind(pdf) as (...args: unknown[]) => unknown;

  pdf.text = function sanitizedText(...args: unknown[]) {
    args[0] = sanitizeTextArgument(args[0]);
    return drawText(...args);
  } as unknown as jsPDF["text"];

  pdf.getTextWidth = function sanitizedGetTextWidth(text: string) {
    return measureText(toPdfSafeText(text));
  } as jsPDF["getTextWidth"];

  pdf.splitTextToSize = function sanitizedSplitTextToSize(...args: unknown[]) {
    args[0] = sanitizeTextArgument(args[0]);
    return splitText(...args);
  } as unknown as jsPDF["splitTextToSize"];
}
