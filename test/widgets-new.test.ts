import { describe, expect, it } from 'vitest';
import { aisleFor, groceryAisles, newGrocery, normalizeExtras, parseGrocery } from '../src/shared/extras';
import { applyBigPicks, basicBig, parseTopStories, todaysStories } from '../src/shared/news';
import { gameTags, leagueById, normalizeLeagues, parseScoreboard, sortGames } from '../src/shared/sports';
import { googleMapsUrl, isRushHour, minutesLabel, normalizeCommute, withTraffic } from '../src/shared/commute';
import { CommuteService } from '../electron/commute';
import { SportsService } from '../electron/sports';
import { NewsService } from '../electron/news';
import type { AiWriter } from '../electron/ai/types';

describe('grocery list', () => {
  it('reads amounts and finds the aisle', () => {
    expect(parseGrocery('2 avocados')).toEqual({ qty: '2', name: 'avocados' });
    expect(parseGrocery('1 lb ground beef')).toEqual({ qty: '1 lb', name: 'ground beef' });
    expect(parseGrocery('a dozen eggs')).toEqual({ qty: 'a dozen', name: 'eggs' });
    expect(parseGrocery('milk x2')).toEqual({ name: 'milk', qty: '2' });
    expect(aisleFor('avocados')).toBe('Produce');
    expect(aisleFor('ground beef')).toBe('Meat & fish');
    expect(aisleFor('eggs')).toBe('Dairy & eggs');
    expect(aisleFor('ice cream')).toBe('Frozen');
    expect(aisleFor('paper towels')).toBe('Household');
    expect(aisleFor('birthday candles')).toBe('Other');
  });

  it('groups by aisle in walking order, ticked items last', () => {
    const a = newGrocery('milk', 'a')!;
    const b = { ...newGrocery('bananas', 'b')!, done: true };
    const c = newGrocery('apples', 'c')!;
    const groups = groceryAisles([a, b, c]);
    expect(groups.map((g) => g.aisle)).toEqual(['Produce', 'Dairy & eggs']);
    expect(groups[0].items.map((i) => i.id)).toEqual(['c', 'b']);
  });

  it('old saved data gets an empty list, NFL and no commute', () => {
    expect(normalizeExtras({ countdowns: [], note: 'hi' })).toMatchObject({ groceries: [], sports: ['nfl'], commute: null });
  });
});

const rss = (items: string[]) => `<rss><channel>${items.join('')}</channel></rss>`;
const item = (title: string, source: string, outlets: number, date = 'Sun, 04 Oct 2026 05:15:00 GMT') =>
  `<item><title>${title} - ${source}</title><link>https://news.google.com/rss/articles/${encodeURIComponent(title)}</link><guid>${encodeURIComponent(title)}</guid><pubDate>${date}</pubDate><description>${'&lt;li&gt;x&lt;/li&gt;'.repeat(outlets)}</description><source url="x">${source}</source></item>`;

describe('news', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  it('reads Google News top stories', () => {
    const stories = parseTopStories(rss([item('Rays &amp; Sox split', 'ESPN', 2), item('Hurricane makes landfall in Florida', 'AP', 5)]));
    expect(stories[0]).toMatchObject({ title: 'Rays & Sox split', source: 'ESPN', coverage: 2 });
    expect(stories[1].coverage).toBe(5);
  });

  it('marks big stories without AI and puts them first', () => {
    const stories = parseTopStories(rss([item('Local bakery opens', 'Patch', 1), item('Hurricane makes landfall in Florida', 'AP', 5), item('Old news', 'X', 5, 'Mon, 28 Sep 2026 05:00:00 GMT')]));
    const list = todaysStories(basicBig(stories), now);
    expect(list[0].title).toMatch(/Hurricane/);
    expect(list[0].big).toBe('Major story');
    expect(list.length).toBe(3); // too few fresh ones to drop the old
  });

  it('takes at most three AI picks for stories that exist', () => {
    const stories = parseTopStories(rss(['a', 'b', 'c', 'd'].map((t) => item(t, 'X', 1))));
    const picked = applyBigPicks(stories, [{ id: stories[1].id, why: 'Huge' }, { id: 'nope' }, { id: stories[0].id }, { id: stories[2].id }, { id: stories[3].id }]);
    expect(picked.filter((s) => s.big).length).toBe(3);
    expect(picked[1].big).toBe('Huge');
  });

  it('asks the AI with short ids and maps its picks back', async () => {
    const xml = rss([item('Calm day', 'X', 1), item('Big ruling from the court', 'Y', 4)]);
    const ai = { name: 'Fake', json: async ({ prompt }: { prompt: string }) => ({ big: [{ id: prompt.includes('[n2]') ? 'n2' : 'x', why: 'Supreme Court decision' }] }), chat: async () => '' } as unknown as AiWriter;
    const news = new NewsService(() => ai, (async () => new Response(xml)) as typeof fetch);
    const view = await news.get(false, now);
    expect(view.pickedBy).toBe('ai');
    expect(view.stories[0]).toMatchObject({ title: 'Big ruling from the court', big: 'Supreme Court decision' });
  });
});

const team = (abbr: string, score: number, opts: Record<string, unknown> = {}) => ({
  homeAway: opts.home ? 'home' : 'away',
  score: String(score),
  winner: opts.winner ?? false,
  ...(opts.rank ? { curatedRank: { current: opts.rank } } : {}),
  records: opts.record ? [{ summary: opts.record }] : [],
  team: { abbreviation: abbr, shortDisplayName: abbr, color: '00338d', alternateColor: 'd50a0a' },
});
const event = (id: string, state: string, detail: string, home: object, away: object, date = '2026-10-04T17:00Z') => ({
  id,
  date,
  status: { type: { state, shortDetail: detail } },
  competitions: [{ competitors: [home, away] }],
  links: [{ href: `https://www.espn.com/nfl/game/_/gameId/${id}` }],
});

describe('sports', () => {
  const nfl = leagueById('nfl')!;
  it('keeps finished and live games, not ones still to come', () => {
    const games = parseScoreboard(
      {
        events: [
          event('1', 'post', 'Final', team('BUF', 27, { home: true, winner: true, record: '4-0' }), team('NE', 24, { record: '1-3' })),
          event('2', 'pre', '1:00 PM', team('CHI', 0, { home: true }), team('NYJ', 0)),
          event('3', 'in', 'Q3 4:12', team('KC', 14, { home: true }), team('LV', 10)),
        ],
      },
      nfl,
    );
    expect(games.map((g) => g.id)).toEqual(['nfl:1', 'nfl:3']);
    expect(games[0].home).toMatchObject({ abbr: 'BUF', score: 27, winner: true, color: '#00338d' });
    expect(games[0].tags).toEqual(['nail-biter']);
    expect(sortGames(games)[0].state).toBe('live');
  });

  it('calls out upsets, blowouts, overtime and shutouts', () => {
    const g = (home: object, away: object, detail = 'Final') => parseScoreboard({ events: [event('9', 'post', detail, home, away)] }, nfl)[0];
    expect(g(team('A', 10, { home: true, winner: true, record: '0-4' }), team('B', 7, { record: '4-0' }), 'Final/OT').tags).toEqual(['overtime', 'nail-biter', 'upset']);
    expect(g(team('A', 42, { home: true, winner: true }), team('B', 0)).tags).toEqual(['blowout', 'shutout']);
  });

  it('only shows college games with a ranked team', () => {
    const cfb = leagueById('cfb')!;
    const games = parseScoreboard(
      { events: [event('1', 'post', 'Final', team('UGA', 38, { home: true, winner: true, rank: 2 }), team('VAN', 14, { rank: 99 })), event('2', 'post', 'Final', team('X', 1, { home: true }), team('Y', 0))] },
      cfb,
    );
    expect(games.length).toBe(1);
    expect(games[0].home.rank).toBe(2);
    expect(games[0].away.rank).toBeUndefined();
    expect(gameTags(games[0], cfb)).toEqual([]);
  });

  it('follows the NFL by default and drops unknown leagues', () => {
    expect(normalizeLeagues(undefined)).toEqual(['nfl']);
    expect(normalizeLeagues(['nba', 'cricket', 'nba'])).toEqual(['nba']);
    expect(normalizeLeagues([])).toEqual(['nfl']);
  });

  it('asks ESPN one day at a time and caches', async () => {
    const urls: string[] = [];
    const svc = new SportsService(async <T,>(url: string) => {
      urls.push(url);
      return { events: [] } as T;
    });
    const now = new Date(2026, 9, 4, 12);
    await svc.scores(['nba'], now);
    await svc.scores(['nba'], now);
    expect(urls).toEqual([
      'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261004',
      'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261003',
      'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20261002',
    ]);
  });
});

describe('commute', () => {
  it('adds typical rush-hour traffic on weekdays only', () => {
    expect(isRushHour(new Date(2026, 9, 5, 8, 0))).toBe(true); // Monday 8am
    expect(isRushHour(new Date(2026, 9, 5, 12, 0))).toBe(false);
    expect(isRushHour(new Date(2026, 9, 4, 8, 0))).toBe(false); // Sunday
    expect(withTraffic(20, new Date(2026, 9, 5, 17, 0))).toEqual({ minutes: 25, rushHour: true });
    expect(withTraffic(20, new Date(2026, 9, 5, 12, 0))).toEqual({ minutes: 20, rushHour: false });
    expect(minutesLabel(65)).toBe('1 hr 5 min');
  });

  it('needs both places, and names them Home and Work by default', () => {
    expect(normalizeCommute({ from: '1 Main St', to: '' })).toBeNull();
    expect(normalizeCommute({ from: ' 1 Main St ', to: 'UTSA' })).toEqual({ from: '1 Main St', to: 'UTSA', fromLabel: 'Home', toLabel: 'Work' });
    expect(googleMapsUrl('a b', 'c')).toBe('https://www.google.com/maps/dir/?api=1&origin=a+b&destination=c&travelmode=driving');
  });

  it('finds both places and the drive, and remembers places', async () => {
    const urls: string[] = [];
    const svc = new CommuteService(() => null, async <T,>(url: string) => {
      urls.push(url);
      return (url.includes('nominatim') ? [{ lat: '29.4', lon: '-98.5' }] : { code: 'Ok', routes: [{ duration: 1500, distance: 16093 }] }) as T;
    });
    const t = await svc.time('1 Main St, Austin', '500 Oak Ave, Austin', new Date(2026, 9, 4, 12));
    expect(t).toMatchObject({ baseMinutes: 25, minutes: 25, miles: 10, rushHour: false, fromAddress: '1 Main St, Austin' });
    await svc.time('1 Main St, Austin', '500 Oak Ave, Austin', new Date(2026, 9, 4, 12, 10));
    expect(urls.filter((u) => u.includes('nominatim')).length).toBe(2);
    expect(urls.length).toBe(3);
  });

  it('looks up a place typed by name with the AI, then maps its address', async () => {
    const { looksLikeAddress } = await import('../src/shared/commute');
    expect(looksLikeAddress('UTSA Rec')).toBe(false);
    expect(looksLikeAddress('1 UTSA Circle, San Antonio')).toBe(true);
    expect(looksLikeAddress('The Rim, San Antonio, TX 78257')).toBe(true);
    const searched: string[] = [];
    const ai = {
      name: 'Fake',
      chat: async () => '',
      search: async (q: string) => {
        searched.push(q);
        return { answer: 'The UTSA Recreation and Wellness Center is at 1 UTSA Circle, San Antonio, TX 78249.', sources: [] };
      },
      json: async () => ({ address: '1 UTSA Circle, San Antonio, TX 78249' }),
    };
    const geocoded: string[] = [];
    const svc = new CommuteService(() => ai as never, async <T,>(url: string) => {
      if (url.includes('nominatim')) {
        const q = new URL(url).searchParams.get('q')!;
        geocoded.push(q);
        return (q === 'UTSA Rec' ? [] : [{ lat: '29.58', lon: '-98.62' }]) as T;
      }
      return { code: 'Ok', routes: [{ duration: 600, distance: 8000 }] } as T;
    });
    const t = await svc.time('12 Elm St, San Antonio', 'UTSA Rec', new Date(2026, 9, 4, 12));
    expect(t.toAddress).toBe('1 UTSA Circle, San Antonio, TX 78249');
    expect(searched[0]).toContain('"UTSA Rec"');
    expect(searched[0]).toContain('near 12 Elm St, San Antonio');
    expect(geocoded).toContain('1 UTSA Circle, San Antonio, TX 78249');
    // Asked once; the next check reuses it.
    await svc.time('12 Elm St, San Antonio', 'UTSA Rec', new Date(2026, 9, 4, 12, 5));
    expect(searched.length).toBe(1);
  });

  it('asks for a street address when there is no AI and the name is not on the map', async () => {
    const svc = new CommuteService(() => null, async <T,>() => [] as T);
    await expect(svc.time('Mystery Place', '1 Main St, Austin')).rejects.toThrow(/turn on free AI/);
  });

  it('learns how long the drive really takes', async () => {
    const { tuneFrom, withTraffic, normalizeCommute } = await import('../src/shared/commute');
    const sunday = new Date(2026, 9, 4, 3, 0);
    // The map says 30, it really takes 24: keep 0.8 and use it from then on.
    const tune = tuneFrom(24, 30, sunday);
    expect(tune).toBe(0.8);
    expect(withTraffic(30, sunday, tune).minutes).toBe(24);
    // Rush hour still adds on top of what they told it.
    expect(withTraffic(30, new Date(2026, 9, 5, 8, 0), tune).minutes).toBe(30);
    expect(tuneFrom(500, 10, sunday)).toBe(2.5);
    expect(normalizeCommute({ from: 'a', to: 'b', tune: 0.8 })).toMatchObject({ tune: 0.8 });
    expect(normalizeCommute({ from: 'a', to: 'b', tune: 99 })).not.toHaveProperty('tune');
  });

  it('puts the drive in the morning briefing when the Commute widget is on', async () => {
    const { basicBriefing } = await import('../electron/smart/briefing');
    const { describeDay } = await import('../electron/smart/context');
    const ctx = {
      now: new Date(2026, 9, 5, 7, 30),
      events: [],
      emails: [],
      tasks: [],
      weather: null,
      carriedOver: null,
      commute: { fromLabel: 'Home', toLabel: 'UTSA', minutes: 24, miles: 12.1, rushHour: true },
    };
    expect(basicBriefing(ctx).points).toContain('Drive Home → UTSA: about 24 min with rush-hour traffic (12.1 mi).');
    expect(describeDay(ctx)).toContain('Their commute');
    expect(basicBriefing({ ...ctx, commute: null }).points.join(' ')).not.toContain('Drive');
  });
});
