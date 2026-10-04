// The Sports widget: games you might have missed in the leagues you follow,
// from ESPN's free scoreboard. NFL by default.

export interface League {
  id: string;
  name: string;
  /** ESPN's path: "football/nfl". */
  path: string;
  /** How many days back to look. Weekly sports look back further. */
  days: number;
  /** Margins this close are a nail-biter. */
  close: number;
  /** Margins this wide are a blowout. */
  blowout: number;
  /** College: only games with a ranked team, or there are dozens a day. */
  rankedOnly?: boolean;
}

export const LEAGUES: League[] = [
  { id: 'nfl', name: 'NFL', path: 'football/nfl', days: 7, close: 3, blowout: 21 },
  { id: 'cfb', name: 'College football', path: 'football/college-football', days: 7, close: 3, blowout: 28, rankedOnly: true },
  { id: 'nba', name: 'NBA', path: 'basketball/nba', days: 3, close: 4, blowout: 20 },
  { id: 'wnba', name: 'WNBA', path: 'basketball/wnba', days: 3, close: 4, blowout: 20 },
  { id: 'cbb', name: 'College basketball', path: 'basketball/mens-college-basketball', days: 3, close: 4, blowout: 25, rankedOnly: true },
  { id: 'mlb', name: 'MLB', path: 'baseball/mlb', days: 3, close: 1, blowout: 8 },
  { id: 'nhl', name: 'NHL', path: 'hockey/nhl', days: 3, close: 1, blowout: 4 },
  { id: 'mls', name: 'MLS', path: 'soccer/usa.1', days: 4, close: 1, blowout: 3 },
  { id: 'epl', name: 'Premier League', path: 'soccer/eng.1', days: 4, close: 1, blowout: 3 },
];

export const DEFAULT_LEAGUES = ['nfl'];

export function leagueById(id: string): League | undefined {
  return LEAGUES.find((l) => l.id === id);
}

/** Keeps known leagues, each once. An empty list means NFL. */
export function normalizeLeagues(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_LEAGUES];
  const ids = [...new Set(value.filter((v): v is string => typeof v === 'string' && !!leagueById(v)))];
  return ids.length ? ids : [...DEFAULT_LEAGUES];
}

export interface Side {
  abbr: string;
  name: string;
  score: number;
  /** "#5" for ranked college teams. */
  rank?: number;
  record?: string;
  /** Team colours, "#rrggbb". */
  color: string;
  alt: string;
  winner: boolean;
}

export interface Game {
  id: string;
  league: string;
  start: string;
  state: 'live' | 'final';
  /** "Final", "Final/OT", "Q3 4:12". */
  detail: string;
  home: Side;
  away: Side;
  /** Something fun to say about it. */
  tags: GameTag[];
  url?: string;
}

export type GameTag = 'overtime' | 'nail-biter' | 'blowout' | 'upset' | 'shutout';

export const TAG_LABEL: Record<GameTag, string> = {
  overtime: 'Overtime',
  'nail-biter': 'Nail-biter',
  blowout: 'Blowout',
  upset: 'Upset',
  shutout: 'Shutout',
};

const colour = (hex: unknown, fallback: string) => (typeof hex === 'string' && /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : fallback);

interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  winner?: boolean;
  curatedRank?: { current?: number };
  records?: { summary?: string }[];
  team?: { abbreviation?: string; shortDisplayName?: string; color?: string; alternateColor?: string };
}
interface EspnEvent {
  id?: string;
  date?: string;
  status?: { period?: number; type?: { state?: string; shortDetail?: string } };
  competitions?: { competitors?: EspnCompetitor[] }[];
  links?: { href?: string }[];
}

function side(c: EspnCompetitor): Side {
  const rank = c.curatedRank?.current;
  return {
    abbr: String(c.team?.abbreviation ?? '?').slice(0, 5),
    name: String(c.team?.shortDisplayName ?? c.team?.abbreviation ?? 'Team').slice(0, 24),
    score: Number(c.score) || 0,
    ...(rank && rank <= 25 ? { rank } : {}),
    ...(c.records?.[0]?.summary ? { record: c.records[0].summary } : {}),
    color: colour(c.team?.color, '#3a3f5c'),
    alt: colour(c.team?.alternateColor, '#ffffff'),
    winner: c.winner === true,
  };
}

/** Wins and losses from "5-2" or "5-2-1". */
const winPct = (record?: string) => {
  const [w, l] = (record ?? '').split('-').map(Number);
  return w + l > 0 ? w / (w + l) : null;
};

export function gameTags(game: Pick<Game, 'home' | 'away' | 'detail' | 'state'>, league: League): GameTag[] {
  if (game.state !== 'final') return [];
  const tags: GameTag[] = [];
  const margin = Math.abs(game.home.score - game.away.score);
  const winner = game.home.winner ? game.home : game.away.winner ? game.away : null;
  const loser = winner === game.home ? game.away : game.home;
  if (/OT|SO|\/\d+|AET|PEN/i.test(game.detail)) tags.push('overtime');
  if (winner && margin <= league.close) tags.push('nail-biter');
  else if (margin >= league.blowout) tags.push('blowout');
  if (winner && loser.score === 0 && winner.score > 0) tags.push('shutout');
  if (winner) {
    // An upset: a ranked team lost to an unranked or much lower one, or a far better record lost.
    const rankUpset = loser.rank !== undefined && (winner.rank === undefined || winner.rank - loser.rank >= 8);
    const w = winPct(winner.record);
    const l = winPct(loser.record);
    if (rankUpset || (w !== null && l !== null && l - w >= 0.35)) tags.push('upset');
  }
  return tags;
}

/** Reads one day of an ESPN scoreboard: games in progress or finished, never ones that haven't started. */
export function parseScoreboard(json: unknown, league: League): Game[] {
  const events = ((json as { events?: EspnEvent[] })?.events ?? []) as EspnEvent[];
  const out: Game[] = [];
  for (const e of events) {
    const state = e.status?.type?.state;
    if (state !== 'post' && state !== 'in') continue;
    const comps = e.competitions?.[0]?.competitors ?? [];
    const home = comps.find((c) => c.homeAway === 'home');
    const away = comps.find((c) => c.homeAway === 'away');
    if (!home || !away || !e.id) continue;
    const g = {
      id: `${league.id}:${e.id}`,
      league: league.id,
      start: String(e.date ?? ''),
      state: state === 'in' ? ('live' as const) : ('final' as const),
      detail: String(e.status?.type?.shortDetail ?? (state === 'in' ? 'Live' : 'Final')).slice(0, 24),
      home: side(home),
      away: side(away),
      url: e.links?.[0]?.href && /^https:\/\//.test(e.links[0].href) ? e.links[0].href : undefined,
    };
    if (league.rankedOnly && g.home.rank === undefined && g.away.rank === undefined) continue;
    out.push({ ...g, tags: gameTags(g, league) });
  }
  return out;
}

/** "20261004" for ESPN's dates= parameter, in local time. */
export function espnDay(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

/** Live games first, then the most recent. */
export function sortGames(games: Game[]): Game[] {
  const seen = new Set<string>();
  return games
    .filter((g) => !seen.has(g.id) && seen.add(g.id))
    .sort((a, b) => (a.state === 'live' ? 0 : 1) - (b.state === 'live' ? 0 : 1) || b.start.localeCompare(a.start));
}

export interface SportsView {
  leagues: string[];
  games: Game[];
  fetchedAt: string;
}
