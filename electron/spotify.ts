// Spotify, with your own free developer app (Client ID) and Premium:
// the AI can play songs, playlists, albums and artists, skip, pause, say
// what's playing and like a song. Sign-in uses PKCE, so there's no secret.
import crypto from 'node:crypto';
import http from 'node:http';
import { HttpError, fetchJson } from './http';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
/** Has to match the Redirect URI saved in the Spotify app exactly. */
export const SPOTIFY_PORT = 8888;
export const SPOTIFY_REDIRECT = `http://127.0.0.1:${SPOTIFY_PORT}/callback`;
export const SPOTIFY_SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'user-library-read',
  'user-library-modify',
];

export interface SpotifyStore {
  spotify(): { clientId: string; refreshToken?: string } | null;
  setSpotifyToken(refreshToken: string): void;
}

export type SpotifyKind = 'track' | 'playlist' | 'album' | 'artist';

interface Named {
  name: string;
  uri: string;
  artists?: { name: string }[];
  owner?: { display_name?: string };
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Picks one of their own playlists for "my gym playlist", if the words match one. */
export function matchPlaylist(query: string, playlists: { name: string; uri: string }[]): { name: string; uri: string } | null {
  const want = fold(query.replace(/\b(my|playlist|the|please|play)\b/gi, ' '));
  if (!want) return null;
  const named = playlists.map((p) => ({ p, n: fold(p.name) }));
  return named.find((x) => x.n === want)?.p ?? named.find((x) => x.n.includes(want) || (x.n.length > 2 && want.includes(x.n)))?.p ?? null;
}

/** "Blinding Lights by The Weeknd". */
export function describe(item: Named, kind: SpotifyKind): string {
  if (kind === 'track' || kind === 'album') return `${item.name}${item.artists?.length ? ` by ${item.artists.map((a) => a.name).join(', ')}` : ''}`;
  if (kind === 'playlist') return `the playlist ${item.name}`;
  return item.name;
}

export class SpotifyClient {
  private access: { token: string; expires: number } | null = null;

  constructor(
    private readonly store: SpotifyStore,
    /** Opens the Spotify app when nothing is playing anywhere. */
    private readonly openApp: () => void = () => undefined,
  ) {}

  connected(): boolean {
    return Boolean(this.store.spotify()?.refreshToken);
  }

  /** Signs in through the browser and keeps a refresh token. */
  async signIn(openBrowser: (url: string) => void): Promise<void> {
    const app = this.store.spotify();
    if (!app?.clientId) throw new Error('Paste your Spotify Client ID first.');
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(16));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const code = await new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? '/', SPOTIFY_REDIRECT);
        if (url.pathname !== '/callback') return void res.writeHead(404).end();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
        res.end(`<body style="background:#0f1117;color:#e8eaf2;font-family:sans-serif;display:grid;place-items:center;height:100vh"><h2>${ok ? "Spotify is connected. You can close this tab." : 'Not connected. Go back to Life Hub and try again.'}</h2></body>`);
        clearTimeout(timer);
        server.close();
        if (ok) resolve(ok);
        else reject(new Error(url.searchParams.get('error') === 'access_denied' ? 'Spotify sign-in was cancelled.' : 'Spotify sign-in failed. Try again.'));
      });
      const timer = setTimeout(() => {
        server.close();
        reject(new Error('Spotify sign-in timed out. Try again.'));
      }, 5 * 60_000);
      server.on('error', () => reject(new Error(`Couldn't start the Spotify sign-in (port ${SPOTIFY_PORT} is busy). Close other apps using it and try again.`)));
      server.listen(SPOTIFY_PORT, '127.0.0.1', () => {
        const q = new URLSearchParams({
          client_id: app.clientId,
          response_type: 'code',
          redirect_uri: SPOTIFY_REDIRECT,
          code_challenge_method: 'S256',
          code_challenge: challenge,
          state,
          scope: SPOTIFY_SCOPES.join(' '),
        });
        openBrowser(`${AUTH_URL}?${q}`);
      });
    });
    const tokens = await this.token({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT, client_id: app.clientId, code_verifier: verifier });
    if (!tokens.refresh_token) throw new Error("Spotify didn't keep you signed in. Try again.");
    this.store.setSpotifyToken(tokens.refresh_token);
  }

  private async token(form: Record<string, string>): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
    try {
      const t = await fetchJson<{ access_token: string; expires_in: number; refresh_token?: string }>(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      });
      this.access = { token: t.access_token, expires: Date.now() + t.expires_in * 1000 };
      return t;
    } catch (err) {
      if (err instanceof HttpError && err.status === 400) throw new Error('Spotify signed you out. Connect again in Settings.');
      throw err;
    }
  }

  private async accessToken(): Promise<string> {
    if (this.access && this.access.expires - 60_000 > Date.now()) return this.access.token;
    const app = this.store.spotify();
    if (!app?.refreshToken) throw new Error('Connect Spotify in Settings first.');
    const t = await this.token({ grant_type: 'refresh_token', refresh_token: app.refreshToken, client_id: app.clientId });
    // Spotify sometimes hands out a new refresh token; keep the newest.
    if (t.refresh_token) this.store.setSpotifyToken(t.refresh_token);
    return t.access_token;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) {
      let reason = '';
      try {
        reason = (JSON.parse(text) as { error?: { reason?: string; message?: string } }).error?.reason ?? '';
      } catch {
        // Not JSON.
      }
      if (reason === 'NO_ACTIVE_DEVICE' || res.status === 404) throw new HttpError('NO_ACTIVE_DEVICE', 404, text);
      if (reason === 'PREMIUM_REQUIRED') throw new Error('Spotify only lets apps control playback with Premium.');
      if (res.status === 401) throw new Error('Spotify signed you out. Connect again in Settings.');
      throw new Error(`Spotify couldn't do that (error ${res.status}).`);
    }
    return text ? (JSON.parse(text) as T) : null;
  }

  /** Runs a playback command, waking a device first if nothing is active. */
  private async onDevice(run: (deviceId?: string) => Promise<unknown>): Promise<void> {
    try {
      await run();
      return;
    } catch (err) {
      if (!(err instanceof HttpError && err.message === 'NO_ACTIVE_DEVICE')) throw err;
    }
    let devices = (await this.call<{ devices?: { id: string; is_active?: boolean }[] }>('GET', '/me/player/devices'))?.devices ?? [];
    if (!devices.length) {
      this.openApp();
      for (let i = 0; i < 5 && !devices.length; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        devices = (await this.call<{ devices?: { id: string }[] }>('GET', '/me/player/devices'))?.devices ?? [];
      }
    }
    if (!devices.length) throw new Error('Open Spotify on your computer or phone, then ask again.');
    await run(devices[0].id);
  }

  /** Finds and plays something: one of your playlists first, otherwise a search. */
  async play(query: string, kind?: SpotifyKind): Promise<string> {
    let uri: string | null = null;
    let what = '';
    if (!kind || kind === 'playlist') {
      const mine = await this.call<{ items?: Named[] }>('GET', '/me/playlists?limit=50');
      const hit = matchPlaylist(query, mine?.items ?? []);
      if (hit) {
        uri = hit.uri;
        what = `your playlist ${hit.name}`;
      }
    }
    if (!uri) {
      const type = kind ?? 'track';
      const found = await this.call<Record<string, { items?: (Named | null)[] }>>('GET', `/search?${new URLSearchParams({ q: query, type, limit: '5' })}`);
      const item = found?.[`${type}s`]?.items?.find((x): x is Named => !!x);
      if (!item) throw new Error(`Couldn't find “${query}” on Spotify.`);
      uri = item.uri;
      what = describe(item, type);
    }
    const body = uri.startsWith('spotify:track:') ? { uris: [uri] } : { context_uri: uri };
    await this.onDevice((device) => this.call('PUT', `/me/player/play${device ? `?device_id=${device}` : ''}`, body));
    return `Playing ${what}.`;
  }

  async control(command: 'pause' | 'resume' | 'next' | 'previous'): Promise<string> {
    const path = { pause: ['PUT', '/me/player/pause'], resume: ['PUT', '/me/player/play'], next: ['POST', '/me/player/next'], previous: ['POST', '/me/player/previous'] }[command];
    await this.onDevice((device) => this.call(path[0], `${path[1]}${device ? `?device_id=${device}` : ''}`));
    return { pause: 'Paused.', resume: 'Playing.', next: 'Skipped.', previous: 'Went back a song.' }[command];
  }

  async nowPlaying(): Promise<string> {
    const now = await this.call<{ is_playing?: boolean; item?: Named & { id?: string }; device?: { name?: string } }>('GET', '/me/player');
    if (!now?.item) return 'Nothing is playing on Spotify.';
    return `${now.is_playing ? 'Playing' : 'Paused'}: ${describe(now.item, 'track')}${now.device?.name ? ` on ${now.device.name}` : ''}.`;
  }

  async likeCurrent(): Promise<string> {
    const now = await this.call<{ item?: Named & { id?: string } }>('GET', '/me/player/currently-playing');
    if (!now?.item?.id) throw new Error('Nothing is playing on Spotify.');
    await this.call('PUT', `/me/tracks?ids=${now.item.id}`);
    return `Liked ${describe(now.item, 'track')}.`;
  }

  async playlists(): Promise<string> {
    const mine = await this.call<{ items?: Named[] }>('GET', '/me/playlists?limit=50');
    const names = (mine?.items ?? []).map((p) => p.name);
    return names.length ? `Their playlists: ${names.join(', ')}` : 'They have no playlists.';
  }
}
