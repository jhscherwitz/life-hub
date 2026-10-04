import { applyBigPicks, basicBig, parseTopStories, todaysStories, TOP_STORIES_URL, type NewsView } from '../src/shared/news';
import type { AiWriter } from './ai/types';
import { USER_AGENT } from './http';

const FRESH_MS = 20 * 60_000;

const PICK_SCHEMA = {
  type: 'object',
  properties: {
    big: {
      type: 'array',
      maxItems: 3,
      items: { type: 'object', properties: { id: { type: 'string' }, why: { type: 'string' } }, required: ['id', 'why'] },
    },
  },
  required: ['big'],
};

/**
 * Today's top stories from Google News' free feed, fetched at most every 20
 * minutes. With AI on, it picks the few truly big stories and says why in a
 * few words; without, Life Hub's own rules pick them.
 */
export class NewsService {
  private cache: NewsView | null = null;
  private pending: Promise<NewsView> | null = null;

  constructor(
    private readonly ai: () => AiWriter | null,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  get(force = false, now = new Date()): Promise<NewsView> {
    if (!force && this.cache && now.getTime() - new Date(this.cache.fetchedAt).getTime() < FRESH_MS) return Promise.resolve(this.cache);
    this.pending ??= this.load(now).finally(() => (this.pending = null));
    return this.pending;
  }

  private async load(now: Date): Promise<NewsView> {
    let xml: string;
    try {
      const res = await this.fetcher(TOP_STORIES_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml' }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(String(res.status));
      xml = await res.text();
    } catch {
      if (this.cache) return this.cache;
      throw new Error("Couldn't load the news. Check your internet connection.");
    }
    const stories = parseTopStories(xml);
    if (stories.length === 0) {
      if (this.cache) return this.cache;
      throw new Error('No news right now. Try again in a bit.');
    }
    let view: NewsView = { stories: todaysStories(basicBig(stories), now), pickedBy: 'basic', fetchedAt: now.toISOString() };
    const ai = this.ai();
    if (ai) {
      try {
        const answer = await ai.json<{ big?: { id?: unknown; why?: unknown }[] }>({
          system:
            "You pick the big news. From today's top headlines, choose the stories almost everyone will be talking about: major disasters, deaths of very famous people, wars and attacks, big elections and court rulings, huge economic or tech news. Pick 0 to 3, fewer is better; if nothing is truly big, pick none. For each, give its id and why in at most 6 plain words (\"Hurricane hits Florida coast\").",
          prompt: stories.map((s, i) => `[n${i + 1}] ${s.title} (${s.source}, ${s.coverage} outlets)`).join('\n'),
          schema: PICK_SCHEMA,
          effort: 'low',
          maxTokens: 400,
        });
        // The AI sees short ids ("n3"); turn them back into the stories' own.
        const picks = (Array.isArray(answer.big) ? answer.big : []).map((p) => ({ why: p?.why, id: stories[Number(String(p?.id ?? '').replace(/\D/g, '')) - 1]?.id }));
        view = { stories: todaysStories(applyBigPicks(stories, picks), now), pickedBy: 'ai', fetchedAt: now.toISOString() };
      } catch {
        // Keep the basic picks.
      }
    }
    this.cache = view;
    return view;
  }
}
