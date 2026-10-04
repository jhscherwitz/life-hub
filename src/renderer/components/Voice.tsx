import { useEffect, useRef, useState } from 'react';
import { errorText } from '../hooks';
import { Icon } from './Icon';

type Phase = 'idle' | 'starting' | 'recording' | 'writing';

const BARS = 24;
/** Gemini takes about ten minutes of audio in one go; stop well before. */
const MAX_SECONDS = 5 * 60;

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Gemini doesn't take the WebM that the microphone records, so the recording
 * becomes a WAV file: one channel at 16 kHz, plenty for speech (about 2 MB a minute).
 */
export async function toWav(recording: Blob): Promise<Blob> {
  const decoder = new AudioContext();
  let audio: AudioBuffer;
  try {
    audio = await decoder.decodeAudioData(await recording.arrayBuffer());
  } finally {
    void decoder.close().catch(() => {});
  }
  const rate = 16_000;
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * rate)), rate);
  const source = offline.createBufferSource();
  source.buffer = audio;
  source.connect(offline.destination);
  source.start();
  const samples = (await offline.startRendering()).getChannelData(0);
  return new Blob([wavBytes(samples, rate)], { type: 'audio/wav' });
}

/** 16-bit PCM WAV from samples between -1 and 1. */
export function wavBytes(samples: Float32Array, rate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/**
 * Speak instead of typing: records from the microphone, then your free Gemini
 * key writes down what you said. Nothing is recorded until you click the mic,
 * and the recording is thrown away once it's turned into text.
 */
export function useVoice(onText: (text: string) => void) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [error, setError] = useState<string | null>(null);
  /** The words so far, while Gemini writes them down. */
  const [heard, setHeard] = useState('');
  useEffect(() => window.hub.onTranscribeDelta?.((d) => setHeard((h) => h + d)), []);
  const live = useRef<{ recorder: MediaRecorder; stream: MediaStream; audio: AudioContext; frame: number; timer: number; cancelled: boolean } | null>(null);

  const cleanUp = () => {
    const l = live.current;
    if (!l) return;
    cancelAnimationFrame(l.frame);
    clearInterval(l.timer);
    l.stream.getTracks().forEach((t) => t.stop());
    void l.audio.close().catch(() => {});
    live.current = null;
  };
  useEffect(() => cleanUp, []);

  const start = async () => {
    if (phase !== 'idle') return;
    setError(null);
    setPhase('starting');
    try {
      if (!(await window.hub.askMic?.())) throw new Error('Life Hub needs the microphone. Allow it in System Settings → Privacy & Security → Microphone.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        const cancelled = live.current?.cancelled;
        cleanUp();
        if (cancelled || !chunks.length) {
          setPhase('idle');
          return;
        }
        setPhase('writing');
        setHeard('');
        try {
          const blob = await toWav(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
          const text = await window.hub.transcribe(blob.type, await toBase64(blob));
          if (text.trim()) onText(text.trim());
          else setError("Didn't catch anything. Try again a little closer to the mic.");
        } catch (err) {
          setError(errorText(err));
        } finally {
          setPhase('idle');
        }
      };
      // A level meter, so you can see it hearing you.
      const audio = new AudioContext();
      const analyser = audio.createAnalyser();
      analyser.fftSize = 256;
      audio.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevels((old) => [...old.slice(1), Math.min(1, peak * 2.2)]);
        if (live.current) live.current.frame = requestAnimationFrame(tick);
      };
      const began = Date.now();
      const timer = window.setInterval(() => {
        const s = Math.floor((Date.now() - began) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS && recorder.state === 'recording') recorder.stop();
      }, 250);
      live.current = { recorder, stream, audio, frame: requestAnimationFrame(tick), timer, cancelled: false };
      setSeconds(0);
      setLevels(Array(BARS).fill(0));
      recorder.start();
      setPhase('recording');
    } catch (err) {
      cleanUp();
      setPhase('idle');
      const name = err instanceof DOMException ? err.name : '';
      setError(
        name === 'NotAllowedError'
          ? 'Life Hub isn’t allowed to use the microphone. Allow it in your system’s privacy settings, then try again.'
          : name === 'NotFoundError'
            ? 'No microphone found. Plug one in and try again.'
            : errorText(err),
      );
    }
  };
  const finish = () => live.current?.recorder.state === 'recording' && live.current.recorder.stop();
  const cancel = () => {
    if (!live.current) return;
    live.current.cancelled = true;
    live.current.recorder.stop();
  };
  return { phase, seconds, levels, error, heard, clearError: () => setError(null), start, finish, cancel };
}

export type Voice = ReturnType<typeof useVoice>;

/** The mic button beside + in the chat box. */
export function MicButton({ voice, disabled }: { voice: Voice; disabled?: boolean }) {
  return (
    <button
      type="button"
      className={`composer-btn composer-mic ${voice.phase === 'starting' ? 'is-starting' : ''}`}
      onClick={() => void voice.start()}
      disabled={disabled || voice.phase !== 'idle'}
      aria-label="Speak instead of typing"
      title="Speak instead of typing"
    >
      <Icon name="mic" size={16} />
    </button>
  );
}

/** While recording: a live level meter, the time, and buttons to finish or cancel. */
export function VoiceBar({ voice }: { voice: Voice }) {
  useEffect(() => {
    if (voice.phase !== 'recording') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') voice.cancel();
      else if (e.key === 'Enter') {
        e.preventDefault();
        voice.finish();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voice]);
  if (voice.phase === 'writing') {
    return (
      <div className="voice-bar is-writing" role="status">
        <span className="voice-spinner" />
        {voice.heard.trim() && !/^\[?silence/i.test(voice.heard.trim()) ? <span className="voice-heard">{voice.heard}</span> : 'Writing down what you said…'}
      </div>
    );
  }
  if (voice.phase !== 'recording') return null;
  const m = Math.floor(voice.seconds / 60);
  const s = String(voice.seconds % 60).padStart(2, '0');
  return (
    <div className="voice-bar" role="status" aria-label="Recording">
      <button type="button" className="voice-cancel" onClick={voice.cancel} aria-label="Cancel" title="Cancel (Esc)">
        <Icon name="x" size={14} />
      </button>
      <span className="voice-dot" />
      <span className="voice-levels" aria-hidden="true">
        {voice.levels.map((l, i) => (
          <span key={i} style={{ height: `${Math.max(8, l * 100)}%` }} />
        ))}
      </span>
      <span className="voice-time">
        {m}:{s}
      </span>
      <button type="button" className="voice-done" onClick={voice.finish} aria-label="Done" title="Done (Enter)">
        <Icon name="check" size={15} />
      </button>
    </div>
  );
}
