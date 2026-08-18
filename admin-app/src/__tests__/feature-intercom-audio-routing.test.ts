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

  it("AudioSettingsPage reads the live routing state via useAudioRouting and writes via updateRouting", () => {
    expect(audioPage).toMatch(/useAudioRouting\(uid\)/);
    expect(audioPage).toMatch(/updateRouting\(/);
    expect(audioPage).toMatch(/resetToDefault/);
  });

  it("AudioSettingsPage has Test buttons for both the call and ringtone devices", () => {
    expect(audioPage).toMatch(/surface="call"/);
    expect(audioPage).toMatch(/surface="ringtone"/);
    // Test buttons call setSinkIdSafe on a temporary <audio> with a tone data URL
    expect(audioPage).toMatch(/setSinkIdSafe\(audio,\s*value\)/);
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
