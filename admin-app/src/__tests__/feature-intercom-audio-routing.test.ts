// `plan/features/INTERCOM-AUDIO-ROUTING.md` — regression tests.
//
// Pinned source-level guarantees for the per-staff intercom audio
// routing feature. Mirrors the test style of
// `env-aware-qr-intercom-url.test.ts` and `mrb-15-09-staff-listener.test.ts`:
// cheap source-text assertions that catch contract drift without
// spinning up a real Firestore emulator.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("INTERCOM-AUDIO-ROUTING — per-staff output device selection", () => {
  const adminContext = read("admin-app/src/context/AdminContext.tsx");
  const inboxPage = read("admin-app/src/pages/IntercomInboxPage.tsx");
  const audioPage = read("admin-app/src/pages/AudioSettingsPage.tsx");
  const sidebar = read("admin-app/src/components/Sidebar.tsx");
  const appTsx = read("admin-app/src/App.tsx");
  const hook = read("admin-app/src/hooks/useAudioRouting.ts");
  const devices = read("admin-app/src/utils/audioOutputDevices.ts");
  const sharedTypes = read("shared/types/index.ts");
  const backends = read("plan/docs/BACKEND.md");
  const security = read("plan/docs/SECURITY.md");
  const rules = read("firebase/firestore.rules");
  const typesDoc = read("plan/docs/TYPES.md");

  it("AudioRouting type lives in the shared workspace package", () => {
    expect(sharedTypes).toMatch(/export interface AudioRouting \{/);
    expect(sharedTypes).toMatch(/enabled:\s*boolean/);
    expect(sharedTypes).toMatch(/callOutputDeviceId:\s*string \| null/);
    expect(sharedTypes).toMatch(/ringtoneOutputDeviceId:\s*string \| null/);
  });

  it("BACKEND.md documents guests/{userId}.audioRouting", () => {
    expect(backends).toMatch(/### `guests\/\{userId\}`/);
    expect(backends).toMatch(/audioRouting/);
    expect(backends).toMatch(/audioRoutingUpdatedAt/);
  });

  it("TYPES.md extends the Staff type with the optional audioRouting field", () => {
    expect(typesDoc).toMatch(/audioRouting\?:\s*AudioRouting/);
  });

  it("SECURITY.md mentions the audioRouting self-write allowlist", () => {
    expect(security).toMatch(/Self-write allowlist/);
    expect(security).toMatch(/`audioRouting`/);
    expect(security).toMatch(/`audioRoutingUpdatedAt`/);
  });

  it("firestore.rules allowlists audioRouting + audioRoutingUpdatedAt on guests/{userId}", () => {
    const match = rules.match(/match \/guests\/\{userId\} \{[\s\S]*?\n    \}/);
    expect(match, "expected the guests/{userId} match block").not.toBeNull();
    expect(match?.[0]).toMatch(/"audioRouting"/);
    expect(match?.[0]).toMatch(/"audioRoutingUpdatedAt"/);
  });

  it("AdminContext exposes audioRouting, applyAudioSink, updateAudioRouting, resetAudioRouting", () => {
    expect(adminContext).toMatch(/audioRouting:\s*AudioRoutingShape/);
    expect(adminContext).toMatch(/audioRoutingLoading:\s*boolean/);
    expect(adminContext).toMatch(/applyAudioSink:\s*audioRoutingState\.applyToElement/);
    expect(adminContext).toMatch(/updateAudioRouting:\s*audioRoutingState\.updateRouting/);
    expect(adminContext).toMatch(/resetAudioRouting:\s*audioRoutingState\.resetToDefault/);
  });

  it("AdminContext calls useAudioRouting with the signed-in staff UID", () => {
    expect(adminContext).toMatch(/useAudioRouting\(currentUser\?\.uid \?\? null\)/);
  });

  it("AdminContext pins the WebRTC remote stream to the chosen call device", () => {
    // The acceptCall handler creates an `<audio>` element for the
    // remote stream and routes it through `applyAudioSink` with the
    // "call" surface so the staff's headset (not the laptop speaker)
    // plays the guest's voice.
    expect(adminContext).toMatch(/audioRoutingState\.applyToElement\(remoteAudio,\s*"call"\)/);
  });

  it("AdminContext renders the call ringtone to a WAV blob and routes it via the ringtone device", () => {
    // The ringtone path is a hidden `<audio>` element (not the
    // previous Web Audio API oscillator tree) so setSinkId can pin
    // it to the staff's chosen ringtone device.
    expect(adminContext).toMatch(/import \{ renderRingtoneWav \}/);
    expect(adminContext).toMatch(/const url = await renderRingtoneWav\(\)/);
    expect(adminContext).toMatch(/ringtoneAudioElRef\.current/);
    expect(adminContext).toMatch(/applyToElement\(audio,\s*"ringtone"\)/);
  });

  it("IntercomInboxPage uses a routed HTMLAudioElement for the notification sound (not Web Audio API buffer)", () => {
    expect(inboxPage).toMatch(/notificationAudioRef = useRef<HTMLAudioElement \| null>\(null\)/);
    expect(inboxPage).toMatch(/new Audio\(soundUrl\)/);
    expect(inboxPage).toMatch(/applyAudioSink\(audio,\s*"ringtone"\)/);
    // Regression guard — the previous Web Audio API buffer path
    // (decodeAudioData + createBufferSource) must not come back.
    expect(inboxPage).not.toMatch(/notificationBufferRef/);
    expect(inboxPage).not.toMatch(/audioContext\.createBufferSource/);
  });

  it("IntercomInboxPage re-applies setSinkId when the routing preference changes", () => {
    expect(inboxPage).toMatch(/audioRouting/);
    expect(inboxPage).toMatch(/applyAudioSink\(audio,\s*"ringtone"\)/);
  });

  it("AudioSettingsPage consumes the live routing state via useAdmin (not its own hook)", () => {
    // Per plan/features/INTERCOM-AUDIO-ROUTING.md §"Live subscription":
    // the provider holds the single `onSnapshot(guests/{uid})` listener
    // and every consumer (call audio, notification sound, Audio
    // Settings page) reads from the same live value via context.
    // Mounting `useAudioRouting` here would open a second listener on
    // the same doc.
    expect(audioPage).toMatch(/useAdmin\(\)/);
    expect(audioPage).toMatch(/audioRouting:\s*routing/);
    expect(audioPage).toMatch(/updateAudioRouting:\s*updateRouting/);
    expect(audioPage).toMatch(/resetAudioRouting:\s*resetToDefault/);
    expect(audioPage).not.toMatch(/useAudioRouting\(/);
  });

  it("AdminContext surfaces the audioRoutingError so the Audio Settings page can render the red banner", () => {
    // Regression guard for Finding A: the page now reads error from
    // context, so AdminContext must expose it (added alongside
    // audioRouting + audioRoutingLoading).
    expect(adminContext).toMatch(/audioRoutingError:\s*audioRoutingState\.error/);
    expect(adminContext).toMatch(/audioRoutingError:\s*string \| null/);
  });

  it("AudioSettingsPage has Test buttons for both the call and ringtone devices", () => {
    expect(audioPage).toMatch(/surface="call"/);
    expect(audioPage).toMatch(/surface="ringtone"/);
    // Test buttons call setSinkIdSafe on a temporary <audio> with a tone data URL
    expect(audioPage).toMatch(/setSinkIdSafe\(audio,\s*value\)/);
  });

  it("AudioSettingsPage's test tone is a valid WAV with actual sample data, not an empty header", () => {
    // Regression guard for the 2026-08-18 bug: the original
    // TEST_TONE_DATA_URL was a 44-byte RIFF header with zero sample
    // data (a "silent zero-length WAV"). The browser rejected
    // audio.play() with NotSupportedError because there was nothing
    // to play, so every Test press surfaced "Couldn't play through
    // that device" regardless of which device the operator picked.
    //
    // Follow-up guard for the CSP violation: the original fix
    // emitted a `data:audio/wav;base64,...` URL, but the CSP at
    // `vercel.json` uses `default-src 'self'` with no explicit
    // `media-src` directive, so any data: URL passed to a media
    // element falls back to `default-src` and is blocked. The test
    // tone is now a Blob URL (`URL.createObjectURL(blob)`), which
    // is origin-scoped and matches `'self'` automatically — same
    // pattern as the call ringtone in `utils/renderRingtoneWav.ts`.
    //
    // A future refactor that swaps the Blob URL for an empty WAV
    // or a data: URL again must break this test.
    expect(audioPage).toMatch(/getTestToneUrl/);
    expect(audioPage).not.toMatch(/TEST_TONE_DATA_URL/);
    expect(audioPage).not.toMatch(/getTestToneDataUrl/);
    // The generator builds a 0.3s, 44.1kHz, mono, 16-bit WAV with
    // 13,230 sample frames — 44 header bytes + 26,460 audio bytes
    // = 26,504 bytes total. The "0.3" duration is the marker; if it
    // is dropped back to 0 or 0.0 the test data goes to zero again.
    expect(audioPage).toMatch(/const duration = 0\.3/);
    expect(audioPage).toMatch(/const numSamples = Math\.floor\(sampleRate \* duration\)/);
    expect(audioPage).toMatch(/Math\.sin\(2 \* Math\.PI \* 440 \* t\)/);
    // The data chunk size must be `numSamples * blockAlign`, not a
    // hardcoded 0 — that was the original bug.
    expect(audioPage).toMatch(/const dataSize = numSamples \* blockAlign/);
    expect(audioPage).not.toMatch(/dataSize = 0/);
    // The tone must be served as a Blob URL (CSP-friendly),
    // not a data: URL (CSP-blocked under default-src 'self').
    expect(audioPage).toMatch(/new Blob\(\[buffer\],\s*\{\s*type:\s*"audio\/wav"\s*\}\)/);
    expect(audioPage).toMatch(/URL\.createObjectURL\(blob\)/);
    expect(audioPage).not.toMatch(/data:audio\/wav;base64,/);
  });

  it("AudioSettingsPage degrades gracefully when the Audio Output Devices API is unsupported", () => {
    expect(audioPage).toMatch(/audioOutputApiSupported/);
    expect(audioPage).toMatch(/output device selection isn't supported/i);
  });

  it("Sidebar has an Audio entry that points to /audio", () => {
    expect(sidebar).toMatch(/to:\s*"\/audio"/);
    expect(sidebar).toMatch(/icon:\s*Headphones/);
  });

  it("App.tsx routes /audio to AudioSettingsPage", () => {
    expect(appTsx).toMatch(/import \{ AudioSettingsPage \}/);
    expect(appTsx).toMatch(/path="\/audio"/);
    expect(appTsx).toMatch(/element=\{<AudioSettingsPage \/\>\}/);
  });

  it("useAudioRouting subscribes to guests/{uid} and writes back the audioRouting field", () => {
    expect(hook).toMatch(/doc\(db,\s*"guests",\s*uid\)/);
    expect(hook).toMatch(/audioRouting:\s*merged/);
    expect(hook).toMatch(/audioRoutingUpdatedAt:\s*serverTimestamp\(\)/);
  });

  it("useAudioRouting falls back to default and warns when the saved device is gone", () => {
    // Defensive UX: a USB headset that's been unplugged must not
    // throw or hang the page. The helper falls back to default and
    // logs a single warning.
    expect(hook).toMatch(/lastDeviceIdBySurfaceRef/);
    expect(hook).toMatch(/console\.warn\(/);
    expect(hook).toMatch(/Saved .* output device .* is no longer available/);
  });

  it("audioOutputDevices helper feature-detects setSinkId and never throws on unsupported runtimes", () => {
    expect(devices).toMatch(/function audioOutputApiSupported/);
    expect(devices).toMatch(/"setSinkId"\s+in\s+HTMLMediaElement\.prototype/);
    expect(devices).toMatch(/setSinkIdSafe/);
    // All public helpers return safe defaults (false / null / []) on
    // unsupported runtimes — they must not throw.
    expect(devices).toMatch(/return false/);
    expect(devices).toMatch(/return null/);
    expect(devices).toMatch(/return \[\]/);
  });
});
