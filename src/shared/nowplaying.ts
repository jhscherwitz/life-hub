// What's playing on the computer right now (Spotify, a YouTube tab, Apple
// Music...), as Windows reports it to its own media controls.

export interface NowPlaying {
  /** Something is playing or paused in some app. */
  active: boolean;
  /** The app's name for people: "Spotify", "Chrome". */
  app: string;
  /** It's Life Hub's own radio or music. */
  self: boolean;
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  shuffle: boolean;
  canNext: boolean;
  canPrev: boolean;
  canShuffle: boolean;
  /** Album art as a data: URL, when the app shares one. */
  art?: string;
  /** Seconds into the song and its length, when the app shares them. */
  position?: number;
  duration?: number;
  /** When `position` was true, in ms. */
  positionAt?: number;
}

export type NowPlayingCommand = 'toggle' | 'next' | 'prev' | 'shuffle';
export const NOW_PLAYING_COMMANDS: NowPlayingCommand[] = ['toggle', 'next', 'prev', 'shuffle'];

export const NOTHING_PLAYING: NowPlaying = {
  active: false,
  app: '',
  self: false,
  title: '',
  artist: '',
  album: '',
  playing: false,
  shuffle: false,
  canNext: false,
  canPrev: false,
  canShuffle: false,
};

const APPS: [RegExp, string][] = [
  [/spotify/i, 'Spotify'],
  [/chrome/i, 'Chrome'],
  [/msedge|edge/i, 'Edge'],
  [/firefox/i, 'Firefox'],
  [/brave/i, 'Brave'],
  [/opera/i, 'Opera'],
  [/applemusic|apple\s?music|itunes/i, 'Apple Music'],
  [/zunemusic|zunevideo|mediaplayer/i, 'Media Player'],
  [/vlc/i, 'VLC'],
  [/discord/i, 'Discord'],
  [/tidal/i, 'Tidal'],
  [/deezer/i, 'Deezer'],
  [/amazon.*music/i, 'Amazon Music'],
  [/youtube/i, 'YouTube Music'],
  [/soundcloud/i, 'SoundCloud'],
];

/** Life Hub itself (packaged or run from the terminal). */
const SELF = /life\s?hub|lifehub|com\.jhscherwitz\.hub|electron/i;

/** "SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify" → "Spotify"; "C:\…\foo.exe" → "Foo". */
export function appName(id: string): string {
  if (SELF.test(id)) return 'Life Hub';
  for (const [re, name] of APPS) if (re.test(id)) return name;
  const base = id.split(/[\\/!]/).pop()?.replace(/\.exe$/i, '').replace(/_[a-z0-9]{13}$/i, '') ?? '';
  const word = base.split('.').pop() ?? base;
  return word ? word[0].toUpperCase() + word.slice(1) : 'An app';
}

interface RawNowPlaying {
  ok?: boolean;
  active?: boolean;
  app?: string;
  title?: string;
  artist?: string;
  album?: string;
  playing?: boolean;
  shuffle?: boolean;
  canNext?: boolean;
  canPrev?: boolean;
  canShuffle?: boolean;
  thumb?: string;
  position?: number;
  duration?: number;
  updated?: number;
}

const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * Reads one line from the Windows helper. Album art only comes when the song
 * changes, so the art from `previous` carries over for the same song.
 */
export function parseNowPlaying(line: string, previous: NowPlaying, receivedAt = Date.now()): NowPlaying | null {
  let raw: RawNowPlaying;
  try {
    raw = JSON.parse(line) as RawNowPlaying;
  } catch {
    return null;
  }
  if (!raw || raw.ok === false) return null;
  if (!raw.active) return NOTHING_PLAYING;
  const id = str(raw.app);
  const next: NowPlaying = {
    active: true,
    app: appName(id),
    self: SELF.test(id),
    title: str(raw.title) || 'Untitled',
    artist: str(raw.artist),
    album: str(raw.album),
    playing: raw.playing === true,
    shuffle: raw.shuffle === true,
    canNext: raw.canNext === true,
    canPrev: raw.canPrev === true,
    canShuffle: raw.canShuffle === true,
  };
  const sameSong = previous.active && previous.title === next.title && previous.artist === next.artist && previous.app === next.app;
  const art = typeof raw.thumb === 'string' && raw.thumb.startsWith('data:image/') ? raw.thumb : sameSong ? previous.art : undefined;
  if (art) next.art = art;
  const duration = num(raw.duration);
  const position = num(raw.position);
  if (duration && duration > 0 && position !== undefined) {
    next.duration = duration;
    next.position = Math.min(position, duration);
    next.positionAt = num(raw.updated) ?? receivedAt;
  }
  return next;
}

/** Where the song is now, moving the last known position on while it plays. */
export function livePosition(np: NowPlaying, now = Date.now()): number | undefined {
  if (np.position === undefined || np.duration === undefined) return undefined;
  const moved = np.playing && np.positionAt ? (now - np.positionAt) / 1000 : 0;
  return Math.min(np.duration, Math.max(0, np.position + moved));
}

/** "3:07". */
export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
