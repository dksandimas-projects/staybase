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
    // Follow-up guard for the CSP violation: the CSP at `vercel.json`
    // declares `media-src 'self' blob: data:` (see
    // `plan/docs/SECURITY.md §Content Security Policy`), which is what
    // allows the `URL.createObjectURL(blob)` URL below to load on
    // `<audio>` elements. Without that directive the CSP falls back to
    // `default-src 'self'`, which rejects `blob:` URLs even though they
    // were created on the same origin — see the dedicated CSP guard
    // test in this file for the regression lock. The test tone still
    // uses a Blob URL (not a `data:audio/wav;base64,...` URL) because
    // Blob URLs are revocable via `URL.revokeObjectURL` and don't grow
    // the URL bar; same pattern as the call ringtone in
    // `utils/renderRingtoneWav.ts`.
    //
    // A future refactor that swaps the Blob URL for an empty WAV,
    // a data: URL, or drops the `media-src` CSP directive must break
    // the relevant test(s).
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

  it("Sidebar no longer has a top-level Audio entry (moved to Intercom header shortcut)", () => {
    // Per refactor/audio-discovery: per-staff audio routing used
    // to be a sidebar item that was easy to miss from the inbox
    // (where the user actually needs it). It's now discoverable
    // from the Intercom Inbox header — see the next it() block.
    // The /audio route still works for direct navigation.
    expect(sidebar).not.toMatch(/to:\s*"\/audio"/);
    expect(sidebar).not.toMatch(/icon:\s*Headphones/);
  });

  it("App.tsx routes /audio to AudioSettingsPage", () => {
    expect(appTsx).toMatch(/import \{ AudioSettingsPage \}/);
    expect(appTsx).toMatch(/path="\/audio"/);
    expect(appTsx).toMatch(/element=\{<AudioSettingsPage \/>\}/);
  });

  // Intercom shortcut (refactor/audio-discovery). The /audio route
  // is no longer in the sidebar; instead the Intercom Inbox header
  // — the page where the staff actually notices the audio behaviour
  // they want to control — exposes a direct link. This keeps /audio
  // reachable in 1 click from its natural trigger point without
  // bloating the sidebar nav.
  it("IntercomInboxPage header has an Audio settings link that goes to /audio", () => {
    // The link must be inside the header (not buried in the chat
    // thread list) — staff notice the sound off the page header first.
    const headerStart = inboxPage.indexOf("<header");
    const headerEnd = inboxPage.indexOf("</header>");
    expect(headerStart).toBeGreaterThan(0);
    expect(headerEnd).toBeGreaterThan(headerStart);
    const header = inboxPage.slice(headerStart, headerEnd);
    // The link must live inside this header slice and use the
    // react-router Link so the navigation stays client-side.
    expect(header).toMatch(/<Link[^>]+to="\/audio"/);
    // The link must import + use the Headphones glyph (distinct
    // from the Bell sound-toggle so the staff can tell which
    // button is which at a glance).
    expect(inboxPage, "Headphones must be imported from lucide-react").toMatch(
      /\bHeadphones\b[^,)]*\}\s*from\s*["']lucide-react["']/m
    );
    expect(header, "Headphones must be rendered inside the Inbox header").toMatch(
      /\bHeadphones\b/
    );
    // The link label must mention Audio Settings so screen-readers
    // and visible text both convey the destination.
    expect(header).toMatch(/Audio Settings/);
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
    // All public helpers return safe defaults on unsupported runtimes —
    // they must not throw. The contract has shifted over time:
    //   audioOutputApiSupported       → boolean (false on unsupported)
    //   listAudioOutputDevices        → [] on unsupported
    //   setSinkIdSafe                 → false on unsupported
    //   selectAudioOutputSafe         → { kind: "unsupported" } on
    //                                   missing selectAudioOutput,
    //                                   { kind: "error" } on missing
    //                                   navigator / unexpected throws.
    // All four branches must be present in source so a future
    // refactor that drops one breaks this guard.
    expect(devices).toMatch(/return false/);
    expect(devices).toMatch(/return \[\]/);
    expect(devices).toMatch(/return\s*\{\s*kind:\s*"unsupported"\s*\}/);
    expect(devices).toMatch(/return\s*\{\s*kind:\s*"error"\s*\}/);
  });

  // CSP regression guard (2026-08-19) — the audio routing code paths
  // (Test tone + call ringtone) build a Blob and assign the resulting
  // URL to an `<audio>` element via `URL.createObjectURL`. The CSP at
  // `vercel.json` uses `default-src 'self'` with no explicit `media-src`,
  // which falls back and rejects every `blob:` URL with
  // `Refused to load media from 'blob:...' because it violates the
  // directive: "default-src 'self'"`. The fix is an explicit
  // `media-src 'self' blob: data:` on every deployed `vercel.json`. This
  // test pins all three in lock-step so a future CSP edit that drops
  // the directive will break this assertion instead of silently
  // breaking the Test button (and the call ringtone) in production.
  // See `plan/docs/SECURITY.md §Content Security Policy`.
  it("all deployed vercel.json headers declare media-src so blob: URLs survive the CSP", () => {
    const rootVercel = read("vercel.json");
    const adminVercel = read("admin-app/vercel.json");
    const guestVercel = read("guest-app/vercel.json");

    const extractCsp = (source: string) => {
      const match = source.match(
        /"key":\s*"Content-Security-Policy",\s*"value":\s*"((?:[^"\\]|\\.)*)"/
      );
      expect(match, "Content-Security-Policy header not found").not.toBeNull();
      return match?.[1] ?? "";
    };

    const assertMediaSrc = (label: string, csp: string) => {
      const directive = csp.match(/media-src\s+([^;]+)/);
      expect(directive, `${label}: missing media-src directive`).not.toBeNull();
      const tokens = (directive?.[1] ?? "").trim().split(/\s+/);
      expect(tokens, `${label}: media-src must not be empty`).not.toEqual([""]);
      expect(
        tokens,
        `${label}: media-src must allow blob: (audio routing Test tone + call ringtone use URL.createObjectURL on a Blob)`
      ).toContain("blob:");
      // 'self' is the sane floor — without it, no same-origin media
      // would load at all. data: is a safety net for older code paths
      // that emit data:audio/wav;base64,... URLs instead of a blob.
      expect(tokens, `${label}: media-src must include 'self'`).toContain("'self'");
    };

    assertMediaSrc("vercel.json", extractCsp(rootVercel));
    assertMediaSrc("admin-app/vercel.json", extractCsp(adminVercel));
    assertMediaSrc("guest-app/vercel.json", extractCsp(guestVercel));
  });

  // AudioContext autoplay regression guard (2026-08-19) — the
  // Firestore `onSnapshot` callbacks for bookings + intercoms call
  // `playSynthNotification` from network-driven paths that have no
  // user gesture on their stack. Chrome rejects `new AudioContext()`
  // (and a synchronous `.resume()`) outside a gesture handler with:
  //   "The AudioContext was not allowed to start. It must be resumed
  //    (or created) after a user gesture on the page."
  // and the warning is logged via console.warn — NOT caught by
  // `try { ... } catch {}`. The fix pins the contract that the
  // constructor lives ONLY inside the gesture-listener function and
  // that `playSynthNotification` refuses to construct (or `.resume()`)
  // when the gesture has not been recorded.
  it("playSynthNotification never constructs AudioContext from a snapshot callback", () => {
    // (1) Gesture listener is the only place that calls `new AudioContext`.
    // Count occurrences in the file. Must be exactly one — inside the
    // `unlockAudio` handler that runs inside a `pointerdown` / `keydown`
    // callback, the only path with a user gesture on the stack.
    const ctorMatches = adminContext.match(/new\s*\(\s*window\.AudioContext\s*\|\|/g);
    expect(
      ctorMatches,
      "expected exactly one `new (window.AudioContext || ...)` call"
    ).toHaveLength(1);

    // (2) That single occurrence must live inside an event listener that
    // fires on a user gesture. We don't try to be clever about parsing
    // the function body — we assert the surrounding text instead. The
    // `unlockAudio` function definition must precede the constructor.
    const unlockIdx = adminContext.indexOf("const unlockAudio = () => {");
    expect(unlockIdx, "unlockAudio handler not found").toBeGreaterThanOrEqual(0);
    const ctorIdx = adminContext.indexOf(
      "new (window.AudioContext || (window as any).webkitAudioContext)()"
    );
    expect(ctorIdx, "AudioContext constructor not found").toBeGreaterThan(unlockIdx);
    // The constructor is inside the listener function body, which closes
    // at the next `};` after the `pointerdown`/`keydown` registrations.
    expect(
      adminContext.indexOf("addEventListener(\"pointerdown\"", ctorIdx),
      "constructor must be inside the unlockAudio handler"
    ).toBeLessThan(adminContext.indexOf("addEventListener(\"keydown\"", ctorIdx) + 200);

    // (3) playSynthNotification must early-return on a gesture flag.
    // The flag's name is `audioGestureUnlockedRef` and it must default
    // to `false` AND be set to `true` only inside the `unlockAudio`
    // handler, never inside the snapshot callback body.
    expect(adminContext).toMatch(
      /audioGestureUnlockedRef\s*=\s*useRef\(false\)/
    );
    const unlockRefWrite = adminContext.indexOf(
      "audioGestureUnlockedRef.current = true"
    );
    expect(
      unlockRefWrite,
      "audioGestureUnlockedRef.current = true must exist (gesture handler sets it)"
    ).toBeGreaterThan(0);
    expect(
      unlockRefWrite,
      "flip must live inside unlockAudio, not inside the snapshot callback"
    ).toBeLessThan(adminContext.indexOf("addEventListener(\"keydown\""));

    // (4) playSynthNotification must gate on the flag and bail (not
    // construct, not .resume() outside a gesture). The literal guard
    // pattern matters: a future refactor that drops it must break this.
    const playIdx = adminContext.indexOf("const playSynthNotification =");
    expect(playIdx, "playSynthNotification not found").toBeGreaterThan(0);
    const guardIdx = adminContext.indexOf(
      "if (!audioGestureUnlockedRef.current) return;",
      playIdx
    );
    expect(
      guardIdx,
      "playSynthNotification must early-return when not gesture-unlocked"
    ).toBeGreaterThan(0);

    // (5) No `new AudioContext` inside playSynthNotification.
    // This is the literal anti-pattern that produced the warning.
    const playBlockEnd =
      adminContext.indexOf("}, []);\n", playIdx) > 0
        ? adminContext.indexOf("}, []);\n", playIdx)
        : adminContext.indexOf("}, [", playIdx);
    const playBlock = adminContext.slice(playIdx, playBlockEnd);
    expect(
      playBlock,
      "playSynthNotification must not contain a `new AudioContext` call"
    ).not.toMatch(/new\s*\(\s*window\.AudioContext|\bnew\s+AudioContext\s*\(/);

    // (6) No `ctx.resume()` call — the synchronous resume from inside
    // a snapshot callback is the autoplay-policy violation surface.
    expect(playBlock, "playSynthNotification must not call .resume()").not.toMatch(
      /\.resume\(\)/
    );
  });

  // AudioSettingsPage permission-grant discoverability guard (2026-08-19)
  // — `enumerateDevices()` returns a single unnamed row (system default)
  // until the user triggers `selectAudioOutput()` once. The original page
  // shipped with a working `Pick…` button but no discoverability hint, so
  // the staff saw an apparently empty dropdown and a Test that failed,
  // with no clue why. The fix adds an inline help paragraph that points
  // at the existing Pick… button as the permission-grant CTA.
  it("AudioSettingsPage surfaces a permission-grant hint when Chrome hides the device list", () => {
    // The hint must exist (data-testid pin so e2e tests can target it)
    // and must mention Pick… by name so the staff knows where to click.
    expect(audioPage).toMatch(
      /data-testid=\{`audio-permission-hint-\$\{surface\}`\}/
    );
    // The hint now points at the microphone grant, because
    // `selectAudioOutput()` is not shipped in stable Chrome/Edge —
    // the mic permission is the only portable way to unhide labels.
    expect(audioPage).toMatch(/Pick….*allow microphone access/);

    // The hint must be conditional on `permissionGranted === false &&
    // devices.length <= 1`. Without those guards the hint would either
    // never show or would show after every successful grant.
    expect(audioPage).toMatch(/\{!permissionGranted\s*&&/);
    expect(audioPage).toMatch(/devices\.length\s*<=\s*1/);

    // The Pick… button must be wired to `handleGrantPermission`, which
    // calls `selectAudioOutputSafe()` and then refreshes the device list.
    // A future refactor that swaps Pick… for a different control without
    // routing through selectAudioOutput will break permission discovery.
    expect(audioPage).toMatch(/onClick=\{\(\) => void handleGrantPermission\(\)\}/);
    expect(audioPage).toMatch(
      /const handleGrantPermission\s*=\s*useCallback/
    );
    expect(audioPage).toMatch(/setPermissionGranted\(true\)/);
  });

  // AudioSettingsPage Test-button autoplay guard (2026-08-19) — the
  // /audio page may be the first interactive surface a staff member hits
  // (deep-link from email, OAuth callback bounce, etc.), so the click
  // handler must construct and resume its own AudioContext inside the
  // gesture handler. The earlier `AdminContext` fix doesn't help here
  // — that context is gated on a different listener on the dashboard's
  // own chrome, not on this audio element. This assertion pins the
  // contract: there is exactly one site in this file that calls
  // `new Ctor()` (where Ctor is AudioContext|webkitAudioContext), it
  // lives inside `handleTest`, and it `.resume()`s the context.
  it("AudioSettingsPage handleTest builds + resumes an AudioContext inside the click handler", () => {
    // The audio page uses the union-with-fallback pattern:
    //   const Ctor = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext
    //             ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    // with `testCtxRef.current ??= new Ctor();` inside the click handler.
    // Assert both halves of the union exist on the typed window cast.
    expect(audioPage).toMatch(/AudioContext\?: typeof AudioContext/);
    expect(audioPage).toMatch(/webkitAudioContext\?: typeof AudioContext/);

    // The constructor must live inside handleTest (between the
    // `handleTest = useCallback` and its closing `}, [apiSupported, value, onAfterTest]);`).
    const handleTestIdx = audioPage.indexOf("const handleTest = useCallback");
    expect(handleTestIdx).toBeGreaterThan(0);
    const handleTestEndIdx = audioPage.indexOf(
      "}, [apiSupported, value, onAfterTest]);",
      handleTestIdx
    );
    expect(handleTestEndIdx).toBeGreaterThan(handleTestIdx);
    const handleTestBlock = audioPage.slice(handleTestIdx, handleTestEndIdx);

    // The block must contain the AudioContext constructor + resume pattern.
    expect(
      handleTestBlock,
      "handleTest must construct an AudioContext inside the click gesture"
    ).toMatch(/new\s+Ctor\s*\(\s*\)/);
    expect(
      handleTestBlock,
      "handleTest must .resume() the AudioContext before .play()"
    ).toMatch(/ctx\.resume\(\)/);

    // The block must construct via the per-row testCtxRef (so we
    // build it inside this gesture and reuse on subsequent clicks),
    // not from a singleton / module-level ref.
    expect(
      handleTestBlock,
      "handleTest must build the AudioContext via testCtxRef, not a module-level singleton"
    ).toMatch(/testCtxRef\.current\s*\?\?=\s*new\s+Ctor/);
  });

  // Refresh-dedup guard (2026-08-19, fix #4 in the chain) — the
  // first version of refreshDevices did:
  //   const merged = [...list];
  //   if (!seen.has("default")) merged.unshift({ deviceId: "default", ... });
  // but Chrome's `enumerateDevices()` returns the system default
  // with `deviceId: ""` (not "default"). Our label helper then
  // synthesised `label: "System default"` for it, leaving the
  // merged list with two identical "System default" rows AND a
  // `devices.length === 2` that never satisfied the `permissionGranted
  // === false && devices.length <= 1` hint guard. Visible result:
  // the dropdown showed "System default, System default" and the
  // hint never appeared.
  // Fix: trust Chrome's enumeration when it returns anything, and
  // only synthesise a default row when the enumeration is empty.
  it("AudioSettingsPage refreshDevices doesn't synthesise a duplicate System default on top of Chrome's enumeration", () => {
    // The old `seen.has(SYSTEM_DEFAULT_DEVICE_ID)` + `unshift` pattern
    // must be gone. Replacement is the conditional ternary above.
    expect(audioPage).not.toMatch(/if\s*\(\s*!seen\.has/);
    expect(audioPage).not.toMatch(/merged\.unshift/);

    // The new pattern must be the conditional-spread shape, which
    // preserves Chrome's enumeration when non-empty.
    expect(audioPage).toMatch(/list\.length\s*>\s*0\s*\?\s*list\s*:/);

    // The hint's devices-count guard is unchanged (still `<= 1`)
    // because the new merge now correctly yields length === 1 in the
    // pre-permission state (Chrome's enumeration returns one entry
    // even before permission is granted), so the hint will fire.
    expect(audioPage).toMatch(/devices\.length\s*<=\s*1/);
  });

  // setSinkIdSafe round-trip guard (2026-08-19, fix #4 in the chain) —
  // the original `el.sinkId === (deviceId ?? "")` check returned false
  // when the input was the literal string "default" (the common case
  // from AudioSettingsPage when nothing has been picked yet). Chrome
  // normalises the round-trip either way — setSinkId("default")
  // succeeds internally but reports `el.sinkId === ""` (the spec
  // empty-string default), so the strict equality check failed and
  // every Test button click on the default device showed "Couldn't
  // play through that device" regardless of the device state.
  it("setSinkIdSafe accepts the literal string 'default' without false-failing the round-trip check", () => {
    // Read the helper module so we can pin the contract directly.
    // The lock pins two things:
    //  (a) the default-or-empty branch (special-cased) and
    //  (b) the OR-accepts-both-normal-forms shape.
    expect(devices).toMatch(/function setSinkIdSafe|setSinkIdSafe\s*=/);
    // The "default" deviceId must be handled in its own branch —
    // it must not fall into the strict equality check.
    expect(
      devices,
      "setSinkIdSafe must special-case the 'default' deviceId"
    ).toMatch(/deviceId\s*===\s*"default"|!deviceId\s*\|\|\s*deviceId\s*===\s*"default"/);
    // The success path must accept both `el.sinkId === ""` and
    // `el.sinkId === "default"` as valid round-trips after
    // setSinkId("default") or setSinkId("").
    expect(
      devices,
      "setSinkIdSafe must accept either '' or 'default' as the post-setSinkId round-trip value"
    ).toMatch(/sinkId\s*===\s*""\s*\|\|\s*.*sinkId\s*===\s*"default"/);
  });

  // Pick result discrimination guard (2026-08-19, fix #5 in the
  // chain) — the original selectAudioOutputSafe returned a single
  // `string | null` and the page couldn't tell apart "the user
  // cancelled the picker" (legit) from "the runtime doesn't
  // support selectAudioOutput at all" (constraint). Net result:
  // on a not-yet-permissioned origin, clicking Pick… in some
  // Chrome builds resolved with `null` (no UI shown) and the
  // staff had no way to learn WHY the click was a no-op.
  it("selectAudioOutputSafe discriminates 'ok' / 'cancelled' / 'unsupported' / 'error' so the UI can react to each", () => {
    // The function must export a discriminated union so callers
    // can switch on `.kind` exhaustively.
    expect(devices).toMatch(
      /export\s+type\s+SelectAudioOutputResult|SelectAudioOutputResult\s*=\s*[^;]+/
    );
    // The four kinds must all be present in the union.
    expect(devices).toMatch(/kind:\s*"ok"/);
    expect(devices).toMatch(/kind:\s*"cancelled"/);
    expect(devices).toMatch(/kind:\s*"unsupported"/);
    expect(devices).toMatch(/kind:\s*"error"/);
    // The runtime must distinguish 'unsupported' (no
    // selectAudioOutput on navigator.mediaDevices) from
    // 'ok' / 'cancelled' (the picker ran). A simple
    // substring pattern is enough — minification renames vars
    // but the literal "unsupported" sentinel is preserved.
    expect(
      devices,
      "selectAudioOutputSafe must return 'unsupported' when selectAudioOutput is missing"
    ).toMatch(/return\s*\{\s*kind:\s*"unsupported"\s*\};/);
    // AbortError from the picker must be classified as 'cancelled'
    // (not 'error'), so the page UI doesn't show a red error
    // banner for normal dismissals.
    expect(
      devices,
      "selectAudioOutputSafe must classify AbortError as 'cancelled'"
    ).toMatch(/AbortError/);
  });

  // AudioSettingsPage pick-result banner guard (2026-08-19) — the
  // page must surface a banner when the most-recent Pick…
  // attempt found the runtime unsupported (no selectAudioOutput)
  // so the staff can self-diagnose instead of opening a ticket.
  it("AudioSettingsPage falls back to the microphone-permission unlock when selectAudioOutput is unavailable", () => {
    // The pickResult state must exist.
    expect(audioPage).toMatch(
      /setPickResult|const\s*\[\s*\w+\s*,\s*setPickResult\s*\]\s*=\s*R?\.useState/
    );
    // The page must branch on the discriminator returned by the
    // helper — not on a null check that conflates cancelled with
    // unsupported.
    expect(audioPage).toMatch(/result\.kind\s*===\s*"ok"/);
    expect(audioPage).toMatch(/result\.kind\s*===\s*"cancelled"/);

    // STEP 2 IS THE WHOLE POINT (2026-08-19, fix #6 in the chain).
    // `navigator.mediaDevices.selectAudioOutput()` is NOT shipped in
    // stable Chrome or Edge — it lives behind
    // `chrome://flags/#enable-experimental-web-platform-features`, so
    // `selectAudioOutputSafe()` returned { kind: "unsupported" } on
    // every click and the page's only response was a banner saying so.
    // Clicking Pick… could never reveal a device. The page MUST fall
    // through to `unlockAudioDeviceLabels()` (a getUserMedia mic grant,
    // which is what actually unhides `enumerateDevices()` labels) after
    // the native picker comes back unsupported.
    expect(
      audioPage,
      "handleGrantPermission must fall back to unlockAudioDeviceLabels() when the native picker is unavailable"
    ).toMatch(/await\s+unlockAudioDeviceLabels\(\)/);
    // The fallback's own outcome drives the banner state.
    expect(audioPage).toMatch(/unlock\.kind\s*===\s*"ok"/);
    expect(audioPage).toMatch(/unlock\.kind\s*===\s*"unsupported"/);
    // A denied mic prompt gets its own banner telling the staff how to
    // re-enable it — otherwise Pick… still looks like a dead button.
    expect(audioPage).toMatch(/data-testid=\{`audio-pick-denied-\$\{surface\}`\}/);
    expect(audioPage).toMatch(/Microphone access was blocked/);
    // data-testid pin for e2e + future test stability.
    expect(audioPage).toMatch(/data-testid=\{`audio-pick-unsupported-\$\{surface\}`\}/);
  });

  // Device-label unlock helper contract (2026-08-19, fix #6) — the
  // mic track must be released the instant the grant lands. Leaving it
  // open would pin the browser's "recording" indicator on for the
  // whole shift for a permission we only wanted as an enumeration key.
  it("unlockAudioDeviceLabels grants mic permission and immediately stops the track", () => {
    expect(devices).toMatch(/export\s+async\s+function\s+unlockAudioDeviceLabels/);
    expect(devices).toMatch(/getUserMedia\(\{\s*audio:\s*true\s*\}\)/);
    expect(
      devices,
      "the microphone track must be stopped immediately after the grant"
    ).toMatch(/getTracks\(\)\.forEach\(\(track\)\s*=>\s*track\.stop\(\)\)/);
    // A refused prompt must be classified as "denied", not "error" —
    // the page shows a how-to-re-enable banner for it.
    expect(devices).toMatch(/NotAllowedError/);
    expect(devices).toMatch(/kind:\s*"denied"/);
  });

  // ── Call-mic mute (feat/call-mic-mute) ─────────────────────────
  // The active-call banner exposes a Mute / Unmute button toggling
  // the local outbound MediaStreamTrack's `enabled` property. Scope
  // is per-call only — the flag auto-resets on every new call and
  // on Disconnect, mirroring how every phone / conferencing UI
  // behaves. The contract lives in two files: AdminContext (the
  // state + the track toggle) and IntercomInboxPage (the button).

  it("AdminContext exposes a per-call isMicMuted state and a toggleMicMute handler", () => {
    // Type contract — the field pair is part of the public
    // AdminContext surface so the Inbox banner can subscribe.
    expect(adminContext).toMatch(/isMicMuted:\s*boolean/);
    expect(adminContext).toMatch(/toggleMicMute:\s*\(\s*\)\s*=>\s*void/);
    // Implementation: local boolean useState — no persistence, no
    // external write (the mute flag is intentionally scoped to a
    // single call's lifetime, see the field's TSDoc in source).
    expect(adminContext).toMatch(/useState<boolean>\(false\)/);
    // The toggle must operate on the LIVE MediaStream, not a
    // ref-captured snapshot of a previous call's tracks. The
    // implementation captures `adminMediaStreamRef.current` into
    // a local `stream` then calls `getAudioTracks()` against it.
    expect(adminContext).toMatch(
      /adminMediaStreamRef\.current[\s\S]+?getAudioTracks\(\)/
    );
  });

  it("toggleMicMute sets MediaStreamTrack.enabled = false / true on every audio track", () => {
    // The remote end hears silence only when each outbound audio
    // track is `enabled = false`. The implementation must walk every
    // track in the stream (not assume a single track) — the stream
    // may contain echo-cancellation + noise-suppression tracks.
    expect(adminContext).toMatch(
      /track\.enabled\s*=\s*nextEnabled/
    );
    // Per decision #219 (2026-08-19): the toggle computes
    // `nextEnabled` from the LIVE `track.enabled` (the single
    // source of truth) rather than from the React `isMicMuted`
    // state. Pre-#219 the code read `!isMicMuted` which could
    // drift from `track.enabled` if the track was mutated outside
    // `toggleMicMute` (WebRTC renegotiation, browser tab mute,
    // OS-level audio subsystem, stale closure in an early render).
    // Pin the live-track read.
    const block = adminContext.match(
      /const toggleMicMute\s*=\s*useCallback\([\s\S]+?}\s*,\s*\[\]\);/
    );
    expect(block, "toggleMicMute useCallback block must exist").toBeTruthy();
    expect(block![0]).toMatch(/const currentTrackEnabled[\s\S]+?tracks\[0\]\.enabled/);
    expect(block![0]).toMatch(/const nextEnabled\s*=\s*!currentTrackEnabled/);
    expect(block![0]).toMatch(/tracks\.forEach\(\(track\)\s*=>\s*\{?\s*track\.enabled/);
  });

  it("AdminContext cleanupAdminCall resets isMicMuted so the next call starts unmuted", () => {
    // The phone-meets-conferencing-app invariant: every new call is
    // unmuted, regardless of where the previous one ended. We have
    // to enforce this through cleanupAdminCall because that's the
    // single funnel for every disconnect path (operator hits
    // Disconnect, guest hangs up, second call supersedes the first,
    // tab closes). A direct setIsMicMuted(false) inside cleanup
    // keeps the contract obvious from the code.
    //
    // The match needs to keep going past the inner `}` of the
    // `if (adminRemoteAudioRef.current)` block — that is, all the
    // way to the closing brace of `cleanupAdminCall` itself.
    // A non-greedy `[\s\S]+?` followed by the literal
    // `setIsMicMuted(false);` reliably walks past the inner
    // brace and lands on the lifecycle reset.
    expect(adminContext).toMatch(
      /const cleanupAdminCall\s*=\s*\(\)\s*=>\s*\{[\s\S]+?setIsMicMuted\(false\);/
    );
    // Belt-and-braces: also assert the reset comment, with a
    // generous cap on intervening characters, so a future
    // refactor that moves the reset somewhere else has to
    // explicitly disambiguate. The actual intervening span is
    // ~180 chars; 600 leaves room for prose refactors.
    expect(adminContext).toMatch(
      /Reset the per-call mute flag[\s\S]{0,600}?setIsMicMuted\(false\)/
    );
  });

  it("IntercomInboxPage active-call banner shows a Mute / Unmute toggle bound to getActualMicMuted + toggleMicMute", () => {
      // The button must live inside the active-call banner — staff
      // can only mute during a call, not on the inbox idle state.
      // Find the banner's button block by slicing the source between
      // the actualMicMuted capture (per decision #219, 2026-08-19;
      // was the isMicMuted read pre-#219) and the next disconnect-call
      // button. The actualMicMuted capture is OUTSIDE the pill
      // block (it lives at the top of the IIFE), so anchoring on
      // "Live mic status pill" would slice inside it and miss the
      // capture declaration.
      const actualIdx = inboxPage.indexOf("const actualMicMuted = getActualMicMuted()");
      expect(actualIdx).toBeGreaterThan(0);
      const disconnect = inboxPage.indexOf("Disconnect Call", actualIdx);
      expect(disconnect).toBeGreaterThan(actualIdx);
      const banner = inboxPage.slice(actualIdx, disconnect + "Disconnect Call".length);

      // The button is wired to toggleMicMute and reads the LIVE
      // track state via getActualMicMuted() (per decision #219,
      // 2026-08-19). The pill text, button label, aria-pressed,
      // title, and styling are all derived from `actualMicMuted`
      // — the IIFE captures `getActualMicMuted()` once at the top
      // of the render. Pin that capture + the wiring.
      expect(banner).toMatch(/const actualMicMuted\s*=\s*getActualMicMuted\(\)/);
      expect(banner).toMatch(/onClick=\{\(\)\s*=>\s*void\s+toggleMicMute\(\)\}/);
      expect(banner).toMatch(/aria-pressed=\{actualMicMuted\}/);

      // It renders a clear label that swaps with the muted state —
      // the JSX text is rendered as
      //   `{actualMicMuted ? "Unmute" : "Mute"}`
      // inside the Mute-Unmute toggle button. Just match the literal
      // labels (the `?:` flips them at runtime; the source must
      // mention both).
      expect(banner).toMatch(/\?\s*"Unmute"\s*:\s*"Mute"/);

    // The live mic status pill alternates "Mic open" / "Mic muted"
    // so a sighted operator at a glance sees whether the mic is hot.
    // Per decision #218 (2026-08-19): the pill is now always
    // visible (was `hidden lg:flex` in pre-#218, desktop only) and
    // the text was shortened from "Audio Stream: Active" to
    // "Mic open" so the mobile/tablet/smaller-laptop view also
    // sees the current state.
    expect(banner).toMatch(/Mic open/);
    expect(banner).toMatch(/Mic muted/);

    // data-testid pin for e2e + stability.
    expect(banner).toMatch(
      /data-testid=\{`call-mute-toggle-\$\{incomingCall\.roomId\}`\}/
    );

    // The button must satisfy the CLAUDE.md 44px tap-target hard rule
    // — peek at the className and the min-h token.
    expect(banner).toMatch(/min-h-\[44px\]/);

    // The icon must swap between Mic (idle) and MicOff (muted).
    expect(banner).toMatch(/\{actualMicMuted\s*\?\s*<MicOff/);
  });
});
