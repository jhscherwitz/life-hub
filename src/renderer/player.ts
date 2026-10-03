import { useCallback, useEffect, useRef, useState } from 'react';
import { STATIONS, findStation, nextStation, streamUrl, trackUrl, type MusicLibrary, type SongInfo, type Station, type Track } from '../shared/media';

export type Source = { kind: 'radio'; station: Station } | { kind: 'track'; track: Track };

export interface Player {
  source: Source;
  playing: boolean;
  loading: boolean;
  error: string;
  /** What's on the radio right now (from SomaFM), or the track's own name. */
  song: SongInfo | null;
  volume: number;
  library: MusicLibrary | null;
  shuffle: boolean;
  /** 0-1 through the current track; null for the radio. */
  progress: number | null;
  supported: boolean;
  toggle(): void;
  playStation(id: string): void;
  playTrack(track: Track): void;
  next(): void;
  previous(): void;
  setVolume(v: number): void;
  setShuffle(on: boolean): void;
  seek(fraction: number): void;
  chooseFolder(): void;
  forgetFolder(): void;
}

const SAVED = 'life-hub-player';
const SONG_POLL_MS = 30_000;

function loadSaved(): { station?: string; volume?: number; shuffle?: boolean } {
  try {
    return JSON.parse(localStorage.getItem(SAVED) ?? '{}');
  } catch {
    return {};
  }
}

function save(value: { station: string; volume: number; shuffle: boolean }): void {
  try {
    localStorage.setItem(SAVED, JSON.stringify(value));
  } catch {
    // Only a convenience; fine to lose.
  }
}

/** One audio player for the whole app, so music keeps going between pages. */
export function usePlayer(): Player {
  const saved = useRef(loadSaved()).current;
  const audio = useRef<HTMLAudioElement | null>(null);
  if (!audio.current && typeof Audio !== 'undefined') audio.current = new Audio();

  const [source, setSource] = useState<Source>({
    kind: 'radio',
    station: findStation(saved.station ?? '') ?? STATIONS[0],
  });
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [song, setSong] = useState<SongInfo | null>(null);
  const [volume, setVolumeState] = useState(typeof saved.volume === 'number' ? saved.volume : 0.7);
  const [shuffle, setShuffle] = useState(saved.shuffle === true);
  const [library, setLibrary] = useState<MusicLibrary | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const supported = typeof window.hub.getMusicLibrary === 'function';

  const sourceRef = useRef(source);
  sourceRef.current = source;
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const shuffleRef = useRef(shuffle);
  shuffleRef.current = shuffle;

  useEffect(() => {
    if (supported) void window.hub.getMusicLibrary().then(setLibrary, () => undefined);
  }, [supported]);

  useEffect(() => {
    const station = source.kind === 'radio' ? source.station.id : (saved.station ?? STATIONS[0].id);
    save({ station, volume, shuffle });
    if (audio.current) audio.current.volume = volume;
  }, [source, volume, shuffle, saved]);

  const start = useCallback((next: Source) => {
    const el = audio.current;
    if (!el) return;
    setSource(next);
    setError('');
    setLoading(true);
    setProgress(next.kind === 'track' ? 0 : null);
    setSong(next.kind === 'track' ? { title: next.track.title, artist: next.track.artist } : null);
    el.src = next.kind === 'radio' ? streamUrl(next.station) : trackUrl(next.track);
    el.play().catch(() => undefined);
  }, []);

  const step = useCallback(
    (dir: 1 | -1) => {
      const current = sourceRef.current;
      if (current.kind === 'radio')
        return start({
          kind: 'radio',
          station: nextStation(current.station.id, dir),
        });
      const tracks = libraryRef.current?.tracks ?? [];
      if (tracks.length === 0) return;
      const at = tracks.findIndex((t) => t.id === current.track.id);
      const index = shuffleRef.current && dir === 1 ? Math.floor(Math.random() * tracks.length) : (at + dir + tracks.length) % tracks.length;
      start({ kind: 'track', track: tracks[index] });
    },
    [start],
  );

  // Follow the audio element.
  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const on = (type: string, fn: () => void) => {
      el.addEventListener(type, fn);
      return () => el.removeEventListener(type, fn);
    };
    const offs = [
      on('playing', () => {
        setPlaying(true);
        setLoading(false);
      }),
      on('pause', () => setPlaying(false)),
      on('waiting', () => setLoading(true)),
      on('ended', () => step(1)),
      on('timeupdate', () => {
        if (sourceRef.current.kind === 'track' && el.duration) setProgress(el.currentTime / el.duration);
      }),
      on('error', () => {
        if (!el.getAttribute('src')) return;
        setPlaying(false);
        setLoading(false);
        setError(sourceRef.current.kind === 'radio' ? "Couldn't tune in. Check your internet." : "Couldn't play this song.");
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [step]);

  // What's on the radio: ask now, then every half minute while it plays.
  useEffect(() => {
    if (source.kind !== 'radio' || !playing || typeof window.hub.stationNowPlaying !== 'function') return;
    const id = source.station.id;
    let alive = true;
    const ask = () =>
      void window.hub.stationNowPlaying(id).then(
        (s) => alive && setSong(s),
        () => undefined,
      );
    ask();
    const timer = setInterval(ask, SONG_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [source, playing]);

  // Media keys and the system's now-playing box.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const title = song?.title ?? (source.kind === 'radio' ? source.station.name : source.track.title);
    const artist = song?.artist || (source.kind === 'radio' ? `${source.station.name} · SomaFM` : '');
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album: 'Life Hub',
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
    navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
  }, [song, source, step]);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (!el.getAttribute('src')) return start(sourceRef.current);
    if (el.paused) {
      // Radio picks up live, not where it paused.
      if (sourceRef.current.kind === 'radio') return start(sourceRef.current);
      void el.play().catch(() => undefined);
    } else {
      el.pause();
    }
  }, [start]);

  return {
    source,
    playing,
    loading,
    error,
    song,
    volume,
    library,
    shuffle,
    progress,
    supported,
    toggle,
    playStation: (id) => {
      const station = findStation(id);
      if (station) start({ kind: 'radio', station });
    },
    playTrack: (track) => start({ kind: 'track', track }),
    next: () => step(1),
    previous: () => step(-1),
    setVolume: (v) => setVolumeState(Math.min(1, Math.max(0, v))),
    setShuffle,
    seek: (fraction) => {
      const el = audio.current;
      if (el && sourceRef.current.kind === 'track' && el.duration) el.currentTime = fraction * el.duration;
    },
    chooseFolder: () => void window.hub.chooseMusicFolder().then(setLibrary, (err) => setError(String(err))),
    forgetFolder: () => void window.hub.forgetMusicFolder().then(setLibrary, () => undefined),
  };
}
