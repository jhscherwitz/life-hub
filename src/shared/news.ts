// The News widget: today's top stories from Google News, with anything big
// pulled to the top and marked.

export interface NewsStory {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  /** How many outlets Google grouped on this story. More means bigger. */
  coverage: number;
  /** Set on big stories: a few words on why it matters. */
  big?: string;
}

export interface NewsView {
  stories: NewsStory[];
  /** Who picked the big stories: the AI, or Life Hub's own rules. */
  pickedBy: 'ai' | 'basic';
  fetchedAt: string;
}

export const TOP_STORIES_URL = 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (t: string) =>
  t.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCharCode(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

/** Reads Google News' top-stories feed. Titles come as "Headline - Outlet"; the outlet moves to `source`. */
export function parseTopStories(xml: string, limit = 20): NewsStory[] {
  const out: NewsStory[] = [];
  for (const item of xml.split('<item>').slice(1)) {
    const field = (tag: string) => decode((item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1] ?? '').replace(/^<!\[CDATA\[|\]\]>$/g, '')).trim();
    const source = field('source');
    let title = field('title');
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const url = field('link');
    if (!title || !/^https:\/\//.test(url)) continue;
    const date = new Date(field('pubDate'));
    const coverage = Math.max(1, (field('description').match(/<li>/g) ?? []).length);
    out.push({
      id: field('guid') || url,
      title: title.replace(/\s+/g, ' '),
      source,
      url,
      publishedAt: Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString(),
      coverage,
    });
    if (out.length >= limit) break;
  }
  return out;
}

// Words that usually mean a story everyone will be talking about.
const BIG_WORDS =
  /\b(breaking|dies|dead|killed|death toll|war|invasion|invades|attack|shooting|earthquake|hurricane|tsunami|wildfire|explosion|crash|assassinat\w*|impeach\w*|resigns|indicted|verdict|election results|wins (the )?(election|presidency|super bowl|world series|championship|world cup)|emergency|pandemic|outbreak|evacuat\w*|ceasefire|supreme court (rules|strikes|upholds)|shutdown|recession|stock market (plunges|crashes)|historic|record-breaking)\b/i;

/** Without AI: a story is big if its headline says so and lots of outlets cover it. At most three. */
export function basicBig(stories: NewsStory[]): NewsStory[] {
  let n = 0;
  return stories.map((s) => {
    if (n < 3 && BIG_WORDS.test(s.title) && s.coverage >= 3) {
      n++;
      return { ...s, big: 'Major story' };
    }
    return s;
  });
}

/** Only stories from the last day (Google's feed sometimes keeps older ones), big ones first. */
export function todaysStories(stories: NewsStory[], now = new Date()): NewsStory[] {
  const cutoff = now.getTime() - 26 * 3_600_000;
  const fresh = stories.filter((s) => new Date(s.publishedAt).getTime() >= cutoff);
  const list = fresh.length >= 4 ? fresh : stories;
  return [...list.filter((s) => s.big), ...list.filter((s) => !s.big)];
}

/** Puts the AI's picks on the stories: ids it named, with a short reason. At most three. */
export function applyBigPicks(stories: NewsStory[], picks: { id?: unknown; why?: unknown }[] | undefined): NewsStory[] {
  const why = new Map<string, string>();
  for (const p of Array.isArray(picks) ? picks : []) {
    const id = String(p?.id ?? '');
    if (stories.some((s) => s.id === id) && !why.has(id) && why.size < 3) why.set(id, String(p?.why ?? '').trim().slice(0, 80) || 'Major story');
  }
  return stories.map((s) => ({ ...s, big: why.get(s.id) }));
}

/** "5m", "3h", "Yesterday". */
export function storyAge(iso: string, now = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h`;
  return 'Yesterday';
}
