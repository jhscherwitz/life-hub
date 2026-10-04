import { fetchJson } from './http';

// A backup for album covers: when the music app doesn't hand Windows its
// cover, look the album up in Apple's free iTunes catalog by artist and album
// name. No account or key, and only the names are sent.

interface ItunesResult {
  artworkUrl100?: string;
  artistName?: string;
  collectionName?: string;
}

const cache = new Map<string, string | null>();
/** Covers kept in memory (about 60 KB each). */
const CACHE_LIMIT = 40;
const MAX_BYTES = 2_000_000;

function words(text: string): string {
  return text
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A bigger version of iTunes' 100px cover. */
export function biggerArt(url: string): string {
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/600x600bb.$1');
}

/** Picks the result whose artist matches, so a song by someone else with the same name doesn't win. */
export function pickArt(results: ItunesResult[], artist: string): string | null {
  const want = words(artist).split(' ')[0] ?? '';
  const match = results.find((r) => r.artworkUrl100 && (!want || words(r.artistName ?? '').includes(want))) ?? null;
  return match?.artworkUrl100 ? biggerArt(match.artworkUrl100) : null;
}

/**
 * Downloads a cover as a data: URL. The installed app only shows pictures
 * that are part of the page (its security rules block images from the web),
 * so a web address on its own would stay blank there.
 */
export async function downloadArt(url: string, get: typeof fetch = fetch): Promise<string | null> {
  if (!/^https:\/\/[\w.-]+\.mzstatic\.com\//.test(url)) return null;
  const res = await get(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? '';
  if (!/^image\/(jpeg|png|webp)/.test(type)) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
  return `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`;
}

/** The cover for a song, or null. Remembered, so each album is looked up once. */
export async function lookupArt(artist: string, album: string, title: string): Promise<string | null> {
  if (!artist.trim() || !(album.trim() || title.trim())) return null;
  const key = `${artist}|${album}|${album ? '' : title}`.toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  let found: string | null = null;
  try {
    const search = async (term: string, entity: 'album' | 'song') => {
      const url = `https://itunes.apple.com/search?${new URLSearchParams({ term, entity, limit: '5', media: 'music' })}`;
      const res = await fetchJson<{ results?: ItunesResult[] }>(url, {}, 10_000);
      return pickArt(res.results ?? [], artist);
    };
    if (album.trim()) found = await search(`${artist} ${album}`, 'album');
    if (!found && title.trim()) found = await search(`${artist} ${title}`, 'song');
    if (found) found = await downloadArt(found);
  } catch {
    // Offline or busy: try again next time this song plays.
    return null;
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, found);
  return found;
}
