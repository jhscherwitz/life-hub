// The radio deck: free internet radio from SomaFM (listener-supported, no
// account or key) and the person's own music folder.

export interface Station {
  id: string;
  name: string;
  /** The name on the tuning dial, kept short so stations don't crowd. */
  short: string;
  /** A couple of words on the sound. */
  vibe: string;
  /** Where it sits on the tuning dial, 88-108 like an FM radio. */
  freq: number;
  /** The record's colour while it plays. */
  color: string;
}

export const STATIONS: Station[] = [
  { id: 'groovesalad', name: 'Groove Salad', short: 'Groove', vibe: 'Chill beats', freq: 88.7, color: '#7b5cff' },
  { id: 'fluid', name: 'Fluid', short: 'Fluid', vibe: 'Instrumental hip hop', freq: 91.3, color: '#3fb8ff' },
  { id: 'lush', name: 'Lush', short: 'Lush', vibe: 'Mellow vocals', freq: 93.9, color: '#ff7ab6' },
  { id: 'beatblender', name: 'Beat Blender', short: 'Blender', vibe: 'Late night house', freq: 96.1, color: '#4be3a8' },
  { id: 'deepspaceone', name: 'Deep Space One', short: 'Deep Space', vibe: 'Ambient space', freq: 98.5, color: '#5a7dff' },
  { id: 'dronezone', name: 'Drone Zone', short: 'Drone', vibe: 'Deep focus', freq: 100.9, color: '#9b8cff' },
  { id: 'indiepop', name: 'Indie Pop Rocks', short: 'Indie', vibe: 'Indie pop', freq: 103.3, color: '#ffb547' },
  { id: 'secretagent', name: 'Secret Agent', short: 'Agent', vibe: 'Spy lounge', freq: 105.1, color: '#ff6b7d' },
  { id: 'vaporwaves', name: 'Vaporwaves', short: 'Vapor', vibe: 'Vaporwave', freq: 107.3, color: '#d26bff' },
];

export const DIAL_MIN = 87.5;
export const DIAL_MAX = 108;

/** 0-100: where a frequency sits across the dial. */
export function dialPosition(freq: number): number {
  return ((freq - DIAL_MIN) / (DIAL_MAX - DIAL_MIN)) * 100;
}

export function findStation(id: string): Station | undefined {
  return STATIONS.find((s) => s.id === id);
}

/** SomaFM's stream servers. If one won't play, the player tries the next. */
export const STREAM_SERVERS = ['ice6', 'ice2', 'ice5', 'ice1', 'ice4'];

export function streamUrl(station: Station, server = 0): string {
  return `https://${STREAM_SERVERS[server % STREAM_SERVERS.length]}.somafm.com/${station.id}-128-mp3`;
}

/** The station next to this one, wrapping around the dial. */
export function nextStation(id: string, step: 1 | -1 = 1): Station {
  const i = STATIONS.findIndex((s) => s.id === id);
  return STATIONS[(i + step + STATIONS.length) % STATIONS.length];
}

export interface SongInfo {
  title: string;
  artist: string;
}

/** Reads the newest song from SomaFM's song list ("songs/<id>.json"). */
export function parseSomaSongs(body: unknown): SongInfo | null {
  const first = (body as { songs?: { title?: unknown; artist?: unknown }[] } | null)?.songs?.[0];
  if (!first || typeof first.title !== 'string' || !first.title.trim()) return null;
  return {
    title: first.title.trim(),
    artist: typeof first.artist === 'string' ? first.artist.trim() : '',
  };
}

export const AUDIO_EXTENSIONS = ['.mp3', '.m4a', '.aac', '.flac', '.wav', '.ogg', '.opus'];

export function isAudioFile(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface Track {
  /** The file's path inside the music folder, with forward slashes. */
  id: string;
  title: string;
  artist: string;
}

/** "01 - Artist - Song.mp3" becomes { artist: "Artist", title: "Song" }. */
export function trackFromPath(relPath: string): Track {
  const id = relPath.replace(/\\/g, '/');
  const base = id.split('/').pop() ?? id;
  const name = base
    .replace(/\.[^.]+$/, '')
    .replace(/^\d{1,3}[\s._-]+/, '')
    .replace(/_/g, ' ')
    .trim();
  const parts = name.split(/\s+-\s+/);
  if (parts.length >= 2)
    return {
      id,
      artist: parts[0].trim(),
      title: parts.slice(1).join(' - ').trim(),
    };
  return { id, artist: '', title: name || base };
}

/** The URL the player loads a track from. Main only serves files inside the chosen folder. */
export function trackUrl(track: Track): string {
  return `hub-media://music/${track.id.split('/').map(encodeURIComponent).join('/')}`;
}

export interface MusicLibrary {
  /** The folder's name, or null when none is picked. */
  folder: string | null;
  tracks: Track[];
}
