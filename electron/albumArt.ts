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
  } catch {
    // Offline or busy: try again next time this song plays.
    return null;
  }
  cache.set(key, found);
  return found;
}
