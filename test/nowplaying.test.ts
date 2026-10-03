import { describe, expect, it } from 'vitest';
import { NowPlayingWatcher, encodeScript, HELPER_SCRIPT } from '../electron/nowPlaying';
import { NOTHING_PLAYING, appName, clockTime, livePosition, parseNowPlaying } from '../src/shared/nowplaying';

const line = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    ok: true,
    active: true,
    app: 'Spotify.exe',
    title: 'Midnight City',
    artist: 'M83',
    album: 'Hurry Up, We’re Dreaming',
    playing: true,
    shuffle: false,
    canNext: true,
    canPrev: true,
    canShuffle: true,
    position: 42.3,
    duration: 244,
    updated: 1_000_000,
    ...extra,
  });

describe('now playing', () => {
  it('names the apps people know', () => {
    expect(appName('Spotify.exe')).toBe('Spotify');
    expect(appName('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify')).toBe('Spotify');
    expect(appName('Chrome')).toBe('Chrome');
    expect(appName('MSEdge')).toBe('Edge');
    expect(appName('Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic')).toBe('Media Player');
    expect(appName('AppleInc.AppleMusicWin_nzyj5cx40ttqa!App')).toBe('Apple Music');
    expect(appName('C:\\Program Files\\foobar2000\\foobar2000.exe')).toBe('Foobar2000');
    expect(appName('com.jhscherwitz.hub')).toBe('Life Hub');
  });

  it('reads the helper’s lines, keeping the album art for the same song', () => {
    const first = parseNowPlaying(line({ thumb: 'data:image/jpeg;base64,AAAA' }), NOTHING_PLAYING)!;
    expect(first).toMatchObject({ active: true, app: 'Spotify', title: 'Midnight City', playing: true, art: 'data:image/jpeg;base64,AAAA', duration: 244 });
    // Later lines leave the art out; it carries over.
    const second = parseNowPlaying(line({ playing: false }), first)!;
    expect(second.art).toBe('data:image/jpeg;base64,AAAA');
    expect(second.playing).toBe(false);
    // A new song drops the old art until its own arrives.
    expect(parseNowPlaying(line({ title: 'Wait' }), second)!.art).toBeUndefined();
    // Only real images are used as art.
    expect(parseNowPlaying(line({ thumb: 'javascript:alert(1)' }), NOTHING_PLAYING)!.art).toBeUndefined();
  });

  it('knows Life Hub’s own radio, and when nothing plays', () => {
    expect(parseNowPlaying(line({ app: 'electron.app.Life Hub' }), NOTHING_PLAYING)!.self).toBe(true);
    expect(parseNowPlaying('{"ok":true,"active":false}', NOTHING_PLAYING)).toEqual(NOTHING_PLAYING);
    expect(parseNowPlaying('{"ok":false,"error":"boom"}', NOTHING_PLAYING)).toBeNull();
    expect(parseNowPlaying('not json', NOTHING_PLAYING)).toBeNull();
  });

  it('moves the progress bar on while a song plays', () => {
    const np = parseNowPlaying(line(), NOTHING_PLAYING)!;
    expect(livePosition(np, 1_000_000 + 10_000)).toBeCloseTo(52.3);
    expect(livePosition({ ...np, playing: false }, 1_000_000 + 10_000)).toBeCloseTo(42.3);
    expect(livePosition(np, 1_000_000 + 999_000)).toBe(244);
    expect(clockTime(187.9)).toBe('3:07');
  });

  it('handles lines split across chunks, and stays quiet off Windows', () => {
    const watcher = new NowPlayingWatcher('linux');
    const seen: string[] = [];
    watcher.on('change', (np) => seen.push(np.title));
    const text = `${line()}\n${line({ title: 'Wait' })}\n`;
    watcher.read(text.slice(0, 40));
    watcher.read(text.slice(40, 200));
    watcher.read(text.slice(200));
    expect(seen).toEqual(['Midnight City', 'Wait']);
    expect(watcher.supported).toBe(false);
    watcher.start();
    watcher.command('next');
    expect(watcher.current().title).toBe('Wait');
  });

  it('fits the helper on a Windows command line', () => {
    expect(encodeScript(HELPER_SCRIPT).length).toBeLessThan(30_000);
    expect(Buffer.from(encodeScript('hi'), 'base64').toString('utf16le')).toBe('hi');
    expect(HELPER_SCRIPT).toContain("'IAsyncOperation`1'");
  });
});
