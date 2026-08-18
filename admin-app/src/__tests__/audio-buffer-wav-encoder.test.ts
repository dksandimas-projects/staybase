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

// ---------------------------------------------------------------------------
// Runtime behavioural assertions (Finding B, audit pass 2026-08-18).
//
// Source-text tests above pin the contract at the variable-name level,
// which is cheap and good — but a regex test that just checks
// `writeString("RIFF")` is present will pass even if the actual byte
// layout drifts. These runtime tests exercise the real encoder with a
// hand-rolled Float32Array (no OfflineAudioContext required in Node)
// and assert the byte-equivalent WAV shape that the browser plays.
// ---------------------------------------------------------------------------

import { encodeWavFromChannel } from "../utils/renderRingtoneWav";
import { setSinkIdSafe, audioOutputApiSupported } from "../utils/audioOutputDevices";

describe("encodeWavFromChannel — runtime WAV byte shape", () => {
  function decodeAscii(view: DataView, offset: number, length: number): string {
    let s = "";
    for (let i = 0; i < length; i++) {
      s += String.fromCharCode(view.getUint8(offset + i));
    }
    return s;
  }

  it("emits a 44-byte RIFF/WAVE/fmt /data header + 2 bytes per sample", () => {
    const channel = new Float32Array([0, 0.5, -0.5, 1, -1, 0]);
    const wav = encodeWavFromChannel(channel, 44100);
    expect(wav.byteLength).toBe(44 + channel.length * 2);
  });

  it("writes the four RIFF/WAVE/fmt /data chunks in the canonical positions", () => {
    const wav = encodeWavFromChannel(new Float32Array(8), 44100);
    const view = new DataView(wav);
    expect(decodeAscii(view, 0, 4)).toBe("RIFF");
    expect(decodeAscii(view, 8, 4)).toBe("WAVE");
    expect(decodeAscii(view, 12, 4)).toBe("fmt ");
    expect(decodeAscii(view, 36, 4)).toBe("data");
  });

  it("writes PCM format (1), mono (1 channel), 16-bit, little-endian byte rate", () => {
    const wav = encodeWavFromChannel(new Float32Array(4), 22050);
    const view = new DataView(wav);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(22050); // sample rate
    expect(view.getUint32(28, true)).toBe(22050 * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("clamps +0.5 to +0x3FFF (positive int16), -0.5 to -0x4000 (negative int16)", () => {
    // Input sample range is [-1, 1]; +0.5 * 0x7FFF ≈ 16383 = 0x3FFF;
    // -0.5 * 0x8000 = -16384 = 0x4000 as int16.
    const channel = new Float32Array([0.5, -0.5]);
    const wav = encodeWavFromChannel(channel, 44100);
    const view = new DataView(wav);
    expect(view.getInt16(44, true)).toBe(0x3fff);
    expect(view.getInt16(46, true)).toBe(-0x4000);
  });

  it("clamps out-of-range samples before scaling (defensive against malformed input)", () => {
    const channel = new Float32Array([2, -2, 1.5, -1.5]);
    const wav = encodeWavFromChannel(channel, 44100);
    const view = new DataView(wav);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getInt16(48, true)).toBe(0x7fff);
    expect(view.getInt16(50, true)).toBe(-0x8000);
  });

  it("RIFF chunk size = 36 + 2 * numFrames (per the canonical WAV header formula)", () => {
    const wav = encodeWavFromChannel(new Float32Array(100), 44100);
    const view = new DataView(wav);
    expect(view.getUint32(4, true)).toBe(36 + 200);
    expect(view.getUint32(40, true)).toBe(200); // data chunk size
  });
});

describe("audioOutputDevices — runtime feature detection + setSinkIdSafe", () => {
  it("audioOutputApiSupported returns false when HTMLMediaElement.setSinkId is missing", () => {
    // vitest runs in node, which has no HTMLMediaElement global. The
    // helper must return false rather than throw.
    expect(typeof HTMLMediaElement).toBe("undefined");
    expect(audioOutputApiSupported()).toBe(false);
  });

  it("setSinkIdSafe returns false when el is null/undefined", async () => {
    expect(await setSinkIdSafe(null, "anything")).toBe(false);
    expect(await setSinkIdSafe(undefined, "anything")).toBe(false);
  });

  it("setSinkIdSafe returns false when el.setSinkId is not a function", async () => {
    // Build a stub element-like object whose prototype lacks setSinkId.
    const proto = {} as { setSinkId?: (id: string) => Promise<void> };
    const fakeEl = Object.create(proto);
    expect(await setSinkIdSafe(fakeEl as unknown as HTMLMediaElement, "device-1")).toBe(false);
  });
});
