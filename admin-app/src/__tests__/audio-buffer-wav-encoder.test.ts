// `plan/features/INTERCOM-AUDIO-ROUTING.md`
//
// Source-level pin test for the ringtone WAV encoder shape. The
// encoder produces a 16-bit PCM mono WAV used as the call ringtone
// source (rendered through an `<audio>` element with `setSinkId`).
// A future refactor that drops the WAV header, changes the bit depth,
// or stops mixing the first channel will fail this test.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("audioBufferToWav — ringtone WAV encoder shape", () => {
  const encoder = read("admin-app/src/utils/renderRingtoneWav.ts");

  it("emits a 16-bit PCM mono WAV header", () => {
    // RIFF chunk
    expect(encoder).toMatch(/writeString\("RIFF"\)/);
    expect(encoder).toMatch(/writeString\("WAVE"\)/);
    expect(encoder).toMatch(/writeString\("fmt "\)/);
    expect(encoder).toMatch(/writeString\("data"\)/);
    // 16-bit linear PCM
    expect(encoder).toMatch(/writeUint16\(1\)/);
    expect(encoder).toMatch(/writeUint16\(16\)/);
    // Mono
    expect(encoder).toMatch(/const numChannels = 1/);
  });

  it("clamps each sample to [-1, 1] before scaling to int16", () => {
    expect(encoder).toMatch(/Math\.max\(-1, Math\.min\(1, channel\[i\]\)\)/);
    expect(encoder).toMatch(/setInt16/);
  });

  it("renderRingtoneWav uses the same oscillator frequencies as the pre-refactor call ringtone", () => {
    // The previous Web Audio API code used 853/960 Hz with a 14 Hz
    // LFO warble — a regression that changes these would alter the
    // audible ringtone. Pin them at the source.
    expect(encoder).toMatch(/for \(const freq of \[853, 960\]\)/);
    expect(encoder).toMatch(/lfo\.frequency\.value = 14/);
  });

  it("renderRingtoneWav renders the same double-trill cadence (0.4s on, 0.2s off, 0.4s on)", () => {
    expect(encoder).toMatch(/scheduleBurst\(0, 0\.4\)/);
    expect(encoder).toMatch(/scheduleBurst\(0\.6, 0\.4\)/);
  });
});
