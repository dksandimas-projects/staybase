// `plan/features/INTERCOM-AUDIO-ROUTING.md`
//
// Renders the WebRTC call ringtone (a 1.0 s double electronic trill,
// 853/960 Hz with a 14 Hz LFO warble) to a 16-bit mono WAV Blob so
// it can be played through a hidden `<audio>` element with
// `setSinkId` applied. The previous implementation played the same
// audio through the Web Audio API's destination directly, which
// doesn't honour per-element output device selection on Safari and
// Firefox. Pre-rendering the same envelope into a Blob keeps the
// sound byte-equivalent and unlocks the routing contract.

const RINGTONE_SAMPLE_RATE = 44100;
const RINGTONE_LENGTH_SECONDS = 1.0;

export async function renderRingtoneWav(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const ctxCtor = (window as unknown as { OfflineAudioContext?: typeof OfflineAudioContext; webkitOfflineAudioContext?: typeof OfflineAudioContext })
    .OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  if (!ctxCtor) return null;
  try {
    const offline = new ctxCtor(1, Math.floor(RINGTONE_SAMPLE_RATE * RINGTONE_LENGTH_SECONDS), RINGTONE_SAMPLE_RATE);
    const scheduleBurst = (startTime: number, duration: number) => {
      const gainNode = offline.createGain();
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.25, startTime + 0.02);
      gainNode.gain.setValueAtTime(0.25, startTime + duration - 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      for (const freq of [853, 960]) {
        const osc = offline.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, startTime);

        const lfo = offline.createOscillator();
        const lfoGain = offline.createGain();
        lfo.type = "sine";
        lfo.frequency.value = 14;
        lfoGain.gain.value = 40;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);

        osc.connect(gainNode);
        lfo.start(startTime);
        lfo.stop(startTime + duration);
        osc.start(startTime);
        osc.stop(startTime + duration);
      }

      gainNode.connect(offline.destination);
    };

    scheduleBurst(0, 0.4);
    scheduleBurst(0.6, 0.4);

    const buffer = await offline.startRendering();
    const wav = audioBufferToWav(buffer);
    const blob = new Blob([wav], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  } catch (e) {
    console.warn("Failed to render ringtone WAV:", e);
    return null;
  }
}

/**
 * Encode an AudioBuffer to a 16-bit PCM mono WAV ArrayBuffer. Used
 * by `renderRingtoneWav`; exported separately so tests can assert
 * the bytes-shape of the rendered ringtone without spinning up an
 * OfflineAudioContext.
 */
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const headerSize = 44;
  const arrayBuffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(arrayBuffer);

  let offset = 0;
  const writeString = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      view.setUint8(offset++, s.charCodeAt(i));
    }
  };
  const writeUint32 = (v: number) => {
    view.setUint32(offset, v, true);
    offset += 4;
  };
  const writeUint16 = (v: number) => {
    view.setUint16(offset, v, true);
    offset += 2;
  };

  writeString("RIFF");
  writeUint32(36 + dataSize);
  writeString("WAVE");
  writeString("fmt ");
  writeUint32(16);
  writeUint16(1); // PCM
  writeUint16(numChannels);
  writeUint32(sampleRate);
  writeUint32(byteRate);
  writeUint16(blockAlign);
  writeUint16(16);
  writeString("data");
  writeUint32(dataSize);

  // Mix the first channel of the source buffer into the WAV (the
  // ringtone is mono by construction, so this is a straight copy).
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < numFrames; i++) {
    const sample = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return arrayBuffer;
}
