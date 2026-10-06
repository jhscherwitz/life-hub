import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpotifyClient, matchPlaylist } from '../electron/spotify';
import { cleanToolCalls } from '../src/shared/tools';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

const client = (openApp = vi.fn()) => {
  const store = { spotify: () => ({ clientId: 'c'.repeat(32), refreshToken: 'r' }), setSpotifyToken: vi.fn() };
  return new SpotifyClient(store, openApp);
};

describe('Spotify', () => {
  it('picks their own playlist from everyday words', () => {
    const lists = [
      { name: 'Gym 💪', uri: 'spotify:playlist:1' },
      { name: 'Study lo-fi', uri: 'spotify:playlist:2' },
    ];
    expect(matchPlaylist('my gym playlist', lists)?.uri).toBe('spotify:playlist:1');
    expect(matchPlaylist('play study lo fi', lists)?.uri).toBe('spotify:playlist:2');
    expect(matchPlaylist('Blinding Lights', lists)).toBeNull();
  });

  it('plays their playlist, or searches, and wakes a device when nothing is active', async () => {
    const calls: [string, string, unknown][] = [];
    let devicesAsked = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        const u = new URL(url);
        calls.push([init.method ?? 'GET', u.pathname + u.search, init.body && String(init.body).startsWith('{') ? JSON.parse(String(init.body)) : undefined]);
        if (u.hostname === 'accounts.spotify.com') return json({ access_token: 'a', expires_in: 3600 });
        if (u.pathname === '/v1/me/playlists') return json({ items: [{ name: 'Gym', uri: 'spotify:playlist:gym' }] });
        if (u.pathname === '/v1/search') return json({ tracks: { items: [{ name: 'Blinding Lights', uri: 'spotify:track:bl', artists: [{ name: 'The Weeknd' }] }] } });
        if (u.pathname === '/v1/me/player/play' && !u.search) return json({ error: { status: 404, reason: 'NO_ACTIVE_DEVICE' } }, 404);
        if (u.pathname === '/v1/me/player/devices') return json({ devices: devicesAsked++ ? [{ id: 'pc' }] : [] });
        return new Response(null, { status: 204 });
      }),
    );
    vi.useFakeTimers();
    const openApp = vi.fn();
    const sp = client(openApp);
    const playing = sp.play('my gym playlist');
    await vi.runAllTimersAsync();
    expect(await playing).toBe('Playing your playlist Gym.');
    expect(openApp).toHaveBeenCalled();
    expect(calls.at(-1)).toEqual(['PUT', '/v1/me/player/play?device_id=pc', { context_uri: 'spotify:playlist:gym' }]);
    const song = sp.play('Blinding Lights');
    await vi.runAllTimersAsync();
    expect(await song).toBe('Playing Blinding Lights by The Weeknd.');
    expect(calls.at(-1)?.[2]).toEqual({ uris: ['spotify:track:bl'] });
    vi.useRealTimers();
  });

  it('checks the spotify tool call', () => {
    expect(cleanToolCalls([{ name: 'spotify', command: 'play' }, { name: 'spotify', command: 'next' }, { name: 'spotify', command: 'play', query: 'Drake', kind: 'artist' }])).toEqual([
      { name: 'spotify', command: 'next' },
      { name: 'spotify', command: 'play', query: 'Drake', kind: 'artist' },
    ]);
  });
});
