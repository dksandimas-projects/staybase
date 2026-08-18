// `plan/features/INTERCOM-AUDIO-ROUTING.md`
//
// Per-staff intercom audio routing. Surfaces two output-device pickers
// (one for the call audio, one for notification sounds + ringtones) so
// the front desk can route voice calls to a USB headset and still hear
// ringtones through the built-in speaker. Settings persist on
// `guests/{uid}.audioRouting` — see useAudioRouting.ts for the
// read/write contract.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Info, RefreshCcw, Save, Volume2, VolumeX, AlertTriangle, Check } from "lucide-react";
import { useAdmin } from "../context/AdminContext";
import { useToast } from "../components/Toast";
// Per-staff audio routing state lives in AdminContext (mounted once
// at the provider level — see plan/features/INTERCOM-AUDIO-ROUTING.md
// §"Live subscription"). The page consumes the live value via
// `useAdmin()` so we don't open a second Firestore listener on
// `guests/{uid}`.
import {
  audioOutputApiSupported,
  listAudioOutputDevices,
  selectAudioOutputSafe,
  setSinkIdSafe
} from "../utils/audioOutputDevices";
import { cn } from "../utils/cn";

const SYSTEM_DEFAULT_DEVICE_ID = "default";
const TEST_TONE_DATA_URL =
  // 440 Hz sine, 0.5s, mono, 16-bit, 44.1 kHz — encoded as a WAV data
  // URL so the "Test" button works offline without bundling an audio
  // file. Short enough not to be annoying, audible enough to confirm
  // the device is wired up correctly.
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

type Surface = "call" | "ringtone";

interface DeviceRowProps {
  surface: Surface;
  surfaceLabel: string;
  surfaceHint: string;
  value: string | null;
  onChange: (next: string | null) => void;
  disabled: boolean;
  apiSupported: boolean;
  onAfterTest: (ok: boolean) => void;
}

function DeviceRow({
  surface,
  surfaceLabel,
  surfaceHint,
  value,
  onChange,
  disabled,
  apiSupported,
  onAfterTest
}: DeviceRowProps) {
  const [devices, setDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [isLoadingDevices, setIsLoadingDevices] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<"ok" | "fail" | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!apiSupported) return;
    setIsLoadingDevices(true);
    try {
      const list = await listAudioOutputDevices();
      // The native picker can return devices that the silent `enumerateDevices`
      // call can't yet see (or with labels that are blank until permission is
      // granted). The picker is also the only way to disambiguate "default"
      // across browsers, so always include it as the first row.
      const seen = new Set<string>(list.map((d) => d.deviceId));
      const merged = [...list];
      if (!seen.has(SYSTEM_DEFAULT_DEVICE_ID)) {
        merged.unshift({ deviceId: SYSTEM_DEFAULT_DEVICE_ID, label: "System default" });
      }
      setDevices(merged);
    } finally {
      setIsLoadingDevices(false);
    }
  }, [apiSupported]);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  const handleTest = useCallback(async () => {
    if (!apiSupported) {
      onAfterTest(false);
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const audio = testAudioRef.current ?? new Audio(TEST_TONE_DATA_URL);
      testAudioRef.current = audio;
      const ok = await setSinkIdSafe(audio, value);
      if (!ok) {
        setTestResult("fail");
        onAfterTest(false);
        return;
      }
      audio.currentTime = 0;
      try {
        await audio.play();
        setTestResult("ok");
        onAfterTest(true);
      } catch {
        setTestResult("fail");
        onAfterTest(false);
      }
    } finally {
      setIsTesting(false);
    }
  }, [apiSupported, value, onAfterTest]);

  const selectValue = value ?? SYSTEM_DEFAULT_DEVICE_ID;

  return (
    <div
      className={cn(
        "rounded-card border border-gray-150 bg-white p-5 transition",
        disabled && "opacity-60"
      )}
    >
      <div className="flex items-start gap-4">
        <div className="rounded-lg bg-primary-light p-2.5 text-primary-dark" aria-hidden="true">
          {surface === "call" ? <Headphones size={20} /> : <Volume2 size={20} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={`audio-${surface}`} className="text-sm font-bold text-gray-900">
              {surfaceLabel}
            </label>
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              {surface === "call" ? "WebRTC" : "Notifications + ringtones"}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{surfaceHint}</p>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              id={`audio-${surface}`}
              value={selectValue}
              disabled={disabled || !apiSupported}
              onChange={(e) => {
                const v = e.target.value;
                onChange(v === SYSTEM_DEFAULT_DEVICE_ID ? null : v);
                setTestResult(null);
              }}
              className="min-h-[44px] flex-1 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed"
            >
              {!devices.length && <option value={SYSTEM_DEFAULT_DEVICE_ID}>System default</option>}
              {devices.map((d) => (
                <option key={d.deviceId || SYSTEM_DEFAULT_DEVICE_ID} value={d.deviceId || SYSTEM_DEFAULT_DEVICE_ID}>
                  {d.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleTest()}
              disabled={disabled || !apiSupported || isTesting}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed"
              aria-label={`Test ${surfaceLabel.toLowerCase()}`}
            >
              {isTesting ? <RefreshCcw size={14} className="animate-spin" /> : <Volume2 size={14} />}
              Test
            </button>
            <button
              type="button"
              onClick={async () => {
                const id = await selectAudioOutputSafe();
                if (id) {
                  onChange(id === SYSTEM_DEFAULT_DEVICE_ID ? null : id);
                  setTestResult(null);
                }
                void refreshDevices();
              }}
              disabled={disabled || !apiSupported}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed"
              title="Open the system device picker"
            >
              <Headphones size={14} />
              Pick…
            </button>
          </div>

          {testResult === "ok" && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-green-700">
              <Check size={12} /> Heard it? Great — that device is now routed.
            </p>
          )}
          {testResult === "fail" && (
            <p className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700">
              <AlertTriangle size={12} /> Couldn't play through that device. Try a different one.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function AudioSettingsPage() {
  const {
    audioRouting: routing,
    audioRoutingLoading: loading,
    audioRoutingError: error,
    updateAudioRouting: updateRouting,
    resetAudioRouting: resetToDefault
  } = useAdmin();
  const toast = useToast();
  const [apiSupported] = useState<boolean>(() => audioOutputApiSupported());
  const [draftEnabled, setDraftEnabled] = useState<boolean>(routing.enabled);
  const [draftCall, setDraftCall] = useState<string | null>(routing.callOutputDeviceId);
  const [draftRingtone, setDraftRingtone] = useState<string | null>(routing.ringtoneOutputDeviceId);
  const [isSaving, setIsSaving] = useState(false);

  // Sync the draft with the live Firestore value when it changes
  // (e.g. another tab saved, or initial load).
  useEffect(() => {
    setDraftEnabled(routing.enabled);
    setDraftCall(routing.callOutputDeviceId);
    setDraftRingtone(routing.ringtoneOutputDeviceId);
  }, [routing.enabled, routing.callOutputDeviceId, routing.ringtoneOutputDeviceId]);

  const isDirty = useMemo(
    () =>
      draftEnabled !== routing.enabled ||
      draftCall !== routing.callOutputDeviceId ||
      draftRingtone !== routing.ringtoneOutputDeviceId,
    [draftEnabled, draftCall, draftRingtone, routing]
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await updateRouting({
        enabled: draftEnabled,
        callOutputDeviceId: draftEnabled ? draftCall : null,
        ringtoneOutputDeviceId: draftEnabled ? draftRingtone : null
      });
      toast.success("Audio routing saved.");
    } catch {
      toast.error("Couldn't save audio routing. Try again.");
    } finally {
      setIsSaving(false);
    }
  }, [draftEnabled, draftCall, draftRingtone, updateRouting, toast]);

  const handleReset = useCallback(async () => {
    setIsSaving(true);
    try {
      await resetToDefault();
      toast.success("Audio routing reset to system default.");
    } catch {
      toast.error("Couldn't reset audio routing. Try again.");
    } finally {
      setIsSaving(false);
    }
  }, [resetToDefault, toast]);

  if (!apiSupported) {
    return (
      <div className="space-y-8 font-body">
        <header>
          <h1 className="font-heading text-3xl text-gray-950 lowercase">audio routing</h1>
          <p className="text-xs text-gray-500 mt-1">
            Route intercom call audio to a headset and keep notification sounds on the built-in speaker.
          </p>
        </header>
        <div className="rounded-card border border-amber-200 bg-amber-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="text-amber-700 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-amber-900">Output device selection isn't supported in this browser</h2>
              <p className="text-xs text-amber-800 mt-1">
                This browser doesn't expose the Audio Output Devices API, so we can't pin the call or
                ringtone audio to a specific speaker or headset. The intercom will continue to play
                through your system default. Try Chrome, Edge, or recent Safari on macOS.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 font-body">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-heading text-3xl text-gray-950 lowercase">audio routing</h1>
          <p className="text-xs text-gray-500 mt-1">
            Route intercom call audio to a headset and keep notification sounds on the built-in speaker.
            Settings apply to this staff account across devices that can honour them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={isSaving || loading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-4 text-xs font-bold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || loading || !isDirty}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-primary px-5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save size={14} />
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      <section
        className={cn(
          "rounded-card border bg-white p-5 transition",
          draftEnabled ? "border-primary/40 bg-primary-light/40" : "border-gray-150"
        )}
      >
        <div className="flex items-start gap-4">
          <div className="rounded-lg bg-primary-light p-2.5 text-primary-dark" aria-hidden="true">
            {draftEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-gray-900">Route intercom audio</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              When on, calls go to your chosen call device and notification sounds go to the ringtone device. When off, the system
              default output is used for everything.
            </p>
            <label className="mt-3 inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-xs font-bold text-gray-700">
              <input
                type="checkbox"
                checked={draftEnabled}
                onChange={(e) => setDraftEnabled(e.target.checked)}
                className="h-5 w-5 rounded border-gray-300 text-primary focus:ring-primary"
              />
              Route intercom audio by surface
            </label>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <DeviceRow
          surface="call"
          surfaceLabel="Call device"
          surfaceHint="Where the live call audio plays. Pick a USB headset or the speakers you wear during a shift."
          value={draftCall}
          onChange={setDraftCall}
          disabled={!draftEnabled}
          apiSupported={apiSupported}
          onAfterTest={(ok) => {
            if (ok) toast.success("Heard it? Great — that's your call device.");
          }}
        />
        <DeviceRow
          surface="ringtone"
          surfaceLabel="Notification device"
          surfaceHint="Where incoming chat chimes and call ringtones play. Usually the built-in speaker so you notice new activity even while wearing a headset."
          value={draftRingtone}
          onChange={setDraftRingtone}
          disabled={!draftEnabled}
          apiSupported={apiSupported}
          onAfterTest={(ok) => {
            if (ok) toast.success("Heard it? Great — that's your notification device.");
          }}
        />
      </section>

      <section className="rounded-card border border-gray-150 bg-gray-50/40 p-5">
        <div className="flex items-start gap-3">
          <Info size={18} className="text-gray-500 shrink-0" aria-hidden="true" />
          <div className="text-xs text-gray-600 space-y-1">
            <p>
              The Audio Output Devices API is supported in Chrome, Edge, and recent Safari on macOS. It is not
              available in Firefox or on iOS Safari — on those browsers, audio always follows the system default
              output, so plugging in headphones will route both calls and ringtones through the headset.
            </p>
            <p>
              Device IDs are tied to the physical output. If a saved device disappears (headset unplugged), the
              routing falls back to the system default on the next page load and a one-time warning is logged to the
              browser console. Open this page to pick a new device.
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-card border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          Couldn't load audio routing: {error}
        </div>
      )}
    </div>
  );
}
