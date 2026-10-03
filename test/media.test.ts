import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MusicFolder, browserUserAgent } from '../electron/media';
import { STATIONS, dialPosition, isAudioFile, nextStation, parseSomaSongs, streamUrl, trackFromPath, trackUrl } from '../src/shared/media';

describe('radio', () => {
  it('keeps stations in order along the dial, inside it', () => {
    const at = STATIONS.map((s) => dialPosition(s.freq));
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(Math.min(...at)).toBeGreaterThan(0);
    expect(Math.max(...at)).toBeLessThan(100);
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length);
  });

  it('steps through stations, wrapping around', () => {
    expect(nextStation(STATIONS[0].id).id).toBe(STATIONS[1].id);
    expect(nextStation(STATIONS[0].id, -1).id).toBe(STATIONS.at(-1)!.id);
    expect(nextStation(STATIONS.at(-1)!.id).id).toBe(STATIONS[0].id);
  });

  it('streams from SomaFM over https', () => {
    expect(streamUrl(STATIONS[0])).toBe('https://ice6.somafm.com/groovesalad-128-mp3');
    expect(streamUrl(STATIONS[0], 1)).toBe('https://ice2.somafm.com/groovesalad-128-mp3');
  });

  it("reads the newest song from SomaFM's list", () => {
    expect(parseSomaSongs({ songs: [{ title: ' Wide Open ', artist: 'Charlie North' }, { title: 'Older' }] })).toEqual({
      title: 'Wide Open',
      artist: 'Charlie North',
    });
    expect(parseSomaSongs({ songs: [] })).toBeNull();
    expect(parseSomaSongs('nope')).toBeNull();
  });
});

describe('radio requests', () => {
  it('look like a normal browser, without naming the app or Electron', () => {
    const ua = browserUserAgent('win32', '140.0.7339.41');
    expect(ua).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
    expect(browserUserAgent('darwin', '140.1')).toContain('Macintosh');
    expect(ua).not.toMatch(/Electron|Life/i);
  });
});

describe('my music', () => {
  it('names tracks from their files', () => {
    expect(trackFromPath('01 - Daft Punk - One More Time.mp3')).toEqual({
      id: '01 - Daft Punk - One More Time.mp3',
      artist: 'Daft Punk',
      title: 'One More Time',
    });
    expect(trackFromPath('Album\\02_lofi_rain.m4a')).toEqual({ id: 'Album/02_lofi_rain.m4a', artist: '', title: 'lofi rain' });
    expect(isAudioFile('a.FLAC')).toBe(true);
    expect(isAudioFile('cover.jpg')).toBe(false);
    expect(trackUrl({ id: 'A B/c#1.mp3', title: '', artist: '' })).toBe('hub-media://music/A%20B/c%231.mp3');
  });

  it('lists songs in the folder and serves only those, with byte ranges', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-music-'));
    const music = path.join(dir, 'Music');
    fs.mkdirSync(path.join(music, 'Album'), { recursive: true });
    fs.writeFileSync(path.join(music, 'Album', '1 - A - Song.mp3'), '0123456789');
    fs.writeFileSync(path.join(music, 'notes.txt'), 'x');
    fs.writeFileSync(path.join(dir, 'secret.mp3'), 'secret');
    const store = new MusicFolder(path.join(dir, 'music.json'));
    expect(store.library()).toEqual({ folder: null, tracks: [] });

    store.setFolder(music);
    const lib = store.library();
    expect(lib.folder).toBe('Music');
    expect(lib.tracks).toEqual([{ id: 'Album/1 - A - Song.mp3', artist: 'A', title: 'Song' }]);

    const whole = await store.serve(new Request(trackUrl(lib.tracks[0])));
    expect(whole.status).toBe(200);
    expect(await whole.text()).toBe('0123456789');

    const part = await store.serve(new Request(trackUrl(lib.tracks[0]), { headers: { range: 'bytes=2-4' } }));
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');

    expect((await store.serve(new Request('hub-media://music/..%2Fsecret.mp3'))).status).toBe(404);
    expect((await store.serve(new Request('hub-media://music/notes.txt'))).status).toBe(404);
  });
});
