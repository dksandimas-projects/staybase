// `plan/features/INTERCOM-AUDIO-ROUTING.md`
//
// Browser-side helpers for output-device selection.
//
// Web audio output-device selection uses the Audio Output Devices API
// (HTMLMediaElement.setSinkId, AudioContext.setSinkId, and the
// navigator.mediaDevices.selectAudioOutput picker). Browser support is
// patchy — Chrome/Edge support it; Safari is partial; Firefox does not
// implement it at all. On unsupported browsers every function in this
// file is a safe no-op: `isSupported` reports `false`, `listDevices()`
// returns an empty array, `setSinkIdSafe()` swallows the missing API.
//
// The full deployment story is in INTERCOM-AUDIO-ROUTING.md §Browser
// support matrix.

import { useCallback, useEffect, useState } from "react";

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

/** True if the runtime supports any of the output-device APIs we use. */
export function audioOutputApiSupported(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== "function") return false;
  // The HTMLMediaElement.setSinkId API is the most portable signal —
  // Chrome/Edge/Opera and recent Safari. Firefox does not implement it.
  return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
}

/**
 * Enumerate output devices. The first call (before any user-activation
 * on the origin) returns devices with empty `label` strings per the
 * spec — the Audio Settings page surfaces a "Grant permission to see
 * device names" CTA that calls `selectAudioOutputSafe()` to unlock
 * labelled device lists.
 */
export async function listAudioOutputDevices(): Promise<AudioOutputDevice[]> {
  if (!audioOutputApiSupported()) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "audiooutput")
      .map((device) => ({
        deviceId: device.deviceId,
        // `deviceId` for the system default is the literal string
        // "default" in Chrome/Edge and "" (empty) in some Safari
        // builds. Normalise to "default" so the picker shows a
        // consistent "System default" entry.
        label: device.label || (device.deviceId === "default" || device.deviceId === "" ? "System default" : "Audio output")
      }));
  } catch {
    return [];
  }
}

/**
 * Pop a native OS picker to pick an output device, then persist its
 * `deviceId`. Returns the chosen deviceId, or `null` if the user
 * cancelled or the API is unavailable. Only supported in Chrome/Edge.
 */
export async function selectAudioOutputSafe(): Promise<string | null> {
  if (typeof navigator === "undefined") return null;
  const md = navigator.mediaDevices as MediaDevices & {
    selectAudioOutput?: (opts?: { deviceId?: string }) => Promise<MediaDeviceInfo | null>;
  };
  if (typeof md.selectAudioOutput !== "function") return null;
  try {
    const chosen = await md.selectAudioOutput();
    return chosen?.deviceId ?? null;
  } catch {
    return null;
  }
}

/**
 * `setSinkId` with three layers of defense:
 *   1. feature-detect — return `false` on unsupported runtimes
 *   2. swallow DOMException (NotFoundError when the saved device
 *      has been unplugged) and return `false`
 *   3. return `true` only when the API confirms the device took.
 *
 * `null` / `undefined` deviceId = clear any prior sink → default.
 */
export async function setSinkIdSafe(
  el: HTMLMediaElement | null | undefined,
  deviceId: string | null | undefined
): Promise<boolean> {
  if (!el) return false;
  const proto = Object.getPrototypeOf(el) as { setSinkId?: (id: string) => Promise<void> };
  if (typeof proto.setSinkId !== "function") return false;
  try {
    await proto.setSinkId(deviceId ?? "");
    return el.sinkId === (deviceId ?? "");
  } catch {
    return false;
  }
}

/**
 * React hook: live list of available output devices + a `refresh()`
 * callback. Re-reads the device list when the audio output device
 * changes (a USB headset gets plugged in, a Bluetooth device
 * disconnects, etc.).
 */
export function useAudioOutputDevices() {
  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
  const [supported] = useState<boolean>(() => audioOutputApiSupported());
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const refresh = useCallback(async () => {
    if (!supported) {
      setDevices([]);
      return;
    }
    setIsLoading(true);
    try {
      const next = await listAudioOutputDevices();
      setDevices(next);
    } finally {
      setIsLoading(false);
    }
  }, [supported]);

  useEffect(() => {
    void refresh();
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const handler = () => {
      void refresh();
    };
    navigator.mediaDevices.addEventListener("devicechange", handler);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", handler);
    };
  }, [refresh]);

  return { devices, supported, isLoading, refresh };
}
