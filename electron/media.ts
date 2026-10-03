import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fetchJson } from './http';
import { JsonFile } from './smart/store';
import { findStation, isAudioFile, parseSomaSongs, trackFromPath, type MusicLibrary, type SongInfo, type Track } from '../src/shared/media';

/** Enough for a big folder without freezing on someone's whole drive. */
const MAX_TRACKS = 2000;
const MAX_DEPTH = 4;

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
};

/** The song playing on a station right now, from SomaFM's public song list. */
export async function stationNowPlaying(id: string): Promise<SongInfo | null> {
  const station = findStation(String(id));
  if (!station) return null;
  try {
    return parseSomaSongs(await fetchJson(`https://somafm.com/songs/${station.id}.json`, {}, 8_000));
  } catch {
    return null;
  }
}

/** The person's music folder, remembered in the app data folder. */
export class MusicFolder {
  private readonly file: JsonFile<{ folder?: string }>;

  constructor(filePath: string) {
    this.file = new JsonFile(filePath, () => ({}));
  }

  folder(): string | null {
    const folder = this.file.read().folder;
    return folder && fs.existsSync(folder) ? folder : null;
  }

  setFolder(folder: string | null): void {
    this.file.write(folder ? { folder } : {});
  }

  library(): MusicLibrary {
    const folder = this.folder();
    if (!folder) return { folder: null, tracks: [] };
    const tracks: Track[] = [];
    const walk = (dir: string, depth: number) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const entry of entries) {
        if (tracks.length >= MAX_TRACKS) return;
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && depth < MAX_DEPTH) walk(full, depth + 1);
        else if (entry.isFile() && isAudioFile(entry.name)) tracks.push(trackFromPath(path.relative(folder, full)));
      }
    };
    walk(folder, 0);
    return { folder: path.basename(folder), tracks };
  }

  /**
   * Serves hub-media://music/<path> from inside the music folder only, with
   * byte ranges so the player can skip around in a song.
   */
  async serve(request: Request): Promise<Response> {
    const folder = this.folder();
    const url = new URL(request.url);
    if (!folder || url.host !== 'music') return new Response('Not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    const file = path.resolve(folder, rel);
    if (!file.startsWith(path.resolve(folder) + path.sep) || !isAudioFile(file)) return new Response('Not found', { status: 404 });

    let size: number;
    try {
      size = fs.statSync(file).size;
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end)
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        });
      const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
        },
      });
    }
    const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
    return new Response(body, {
      headers: {
        'Content-Type': type,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
      },
    });
  }
}
