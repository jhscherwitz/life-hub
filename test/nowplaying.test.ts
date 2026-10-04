import { describe, expect, it, vi } from 'vitest';
import { NowPlayingWatcher, encodeScript, HELPER_SCRIPT } from '../electron/nowPlaying';
import { NOTHING_PLAYING, appName, artUrl, clockTime, livePosition, parseNowPlaying } from '../src/shared/nowplaying';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
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
    const first = parseNowPlaying(line({ thumb: JPEG }), NOTHING_PLAYING)!;
    expect(first).toMatchObject({ active: true, app: 'Spotify', title: 'Midnight City', playing: true, art: JPEG, duration: 244 });
    // Later lines leave the art out; it carries over.
    const second = parseNowPlaying(line({ playing: false }), first)!;
    expect(second.art).toBe(JPEG);
    expect(second.playing).toBe(false);
    // A new song drops the old art until its own arrives.
    expect(parseNowPlaying(line({ title: 'Wait' }), second)!.art).toBeUndefined();
    // Only real images are used as art.
    expect(parseNowPlaying(line({ thumb: 'javascript:alert(1)' }), NOTHING_PLAYING)!.art).toBeUndefined();
  });

  it('trusts the image’s own bytes over the label apps give it', () => {
    // Labelled as a plain file, but it's a JPEG.
    expect(artUrl('data:application/octet-stream;base64,/9j/4AAQSkZJRgABAQ==')).toBe(JPEG);
    expect(artUrl('data:;base64,iVBORw0KGgoAAAANSUhEUg==')).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==');
    expect(artUrl('data:image/png;base64,SGVsbG8gd29ybGQh')).toBeUndefined();
    expect(artUrl('https://example.com/a.jpg')).toBeUndefined();
    expect(artUrl(undefined)).toBeUndefined();
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

describe('album cover backup', () => {
  it('picks the right artist’s cover, in a bigger size', async () => {
    const { pickArt, biggerArt } = await import('../electron/albumArt');
    const results = [
      { artistName: 'Someone Else', artworkUrl100: 'https://x/a/100x100bb.jpg' },
      { artistName: 'Travis Scott', collectionName: 'Rodeo', artworkUrl100: 'https://x/b/100x100bb.jpg' },
    ];
    expect(pickArt(results, 'Travis Scott')).toBe('https://x/b/600x600bb.jpg');
    expect(pickArt([], 'Travis Scott')).toBeNull();
    expect(biggerArt('https://x/c/60x60bb.png')).toBe('https://x/c/600x600bb.png');
  });

  it('downloads the cover as a data: URL, so the installed app can show it', async () => {
    const { downloadArt } = await import('../electron/albumArt');
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const get = vi.fn(async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }));
    const url = 'https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg';
    expect(await downloadArt(url, get as unknown as typeof fetch)).toBe(`data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`);
    // Only Apple's image server, and only pictures.
    expect(await downloadArt('https://evil.example.com/a.jpg', get as unknown as typeof fetch)).toBeNull();
    const html = vi.fn(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } }));
    expect(await downloadArt(url, html as unknown as typeof fetch)).toBeNull();
  });

  it('fills in a cover from the backup when the app sends none, for the same song only', async () => {
    const lookups: string[] = [];
    const watcher = new NowPlayingWatcher('linux', undefined, async (artist, album) => {
      lookups.push(`${artist}/${album}`);
      return 'https://is1-ssl.mzstatic.com/rodeo/600x600bb.jpg';
    });
    const seen: (string | undefined)[] = [];
    watcher.on('change', (np) => seen.push(np.art));
    watcher.read(`${line({ title: 'Impossible', artist: 'Travis Scott', album: 'Rodeo' })}\n`);
    await new Promise((r) => setTimeout(r, 0));
    expect(watcher.current().art).toBe('https://is1-ssl.mzstatic.com/rodeo/600x600bb.jpg');
    // The next line for the same song keeps the cover and doesn't look it up again.
    watcher.read(`${line({ title: 'Impossible', artist: 'Travis Scott', album: 'Rodeo', position: 80 })}\n`);
    await new Promise((r) => setTimeout(r, 0));
    expect(watcher.current().art).toBe('https://is1-ssl.mzstatic.com/rodeo/600x600bb.jpg');
    expect(lookups).toEqual(['Travis Scott/Rodeo']);
    // A cover the app sends itself is used without looking anything up.
    watcher.read(`${line({ title: 'Wait', thumb: JPEG })}\n`);
    expect(watcher.current().art).toBe(JPEG);
    expect(lookups).toHaveLength(1);
  });
});
