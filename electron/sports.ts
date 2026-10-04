import { espnDay, leagueById, parseScoreboard, sortGames, type Game, type SportsView } from '../src/shared/sports';
import { fetchJson } from './http';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const FRESH_MS = 5 * 60_000;

/**
 * Recent scores from ESPN's free scoreboard, one request per league per day,
 * cached for five minutes (games past today are kept longer since they're final).
 */
export class SportsService {
  private readonly days = new Map<string, { at: number; games: Game[] }>();

  constructor(private readonly get: <T>(url: string) => Promise<T> = (url) => fetchJson(url)) {}

  async scores(leagueIds: string[], now = new Date()): Promise<SportsView> {
    const today = espnDay(now);
    const jobs: Promise<Game[]>[] = [];
    for (const id of leagueIds) {
      const league = leagueById(id);
      if (!league) continue;
      for (let back = 0; back < league.days; back++) {
        const day = espnDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
        const key = `${id}:${day}`;
        const hit = this.days.get(key);
        // Today's games change; earlier days are final, so keep those an hour.
        if (hit && now.getTime() - hit.at < (day === today ? FRESH_MS : 60 * 60_000)) {
          jobs.push(Promise.resolve(hit.games));
          continue;
        }
        jobs.push(
          this.get<unknown>(`${BASE}/${league.path}/scoreboard?dates=${day}`).then(
            (json) => {
              const games = parseScoreboard(json, league);
              this.days.set(key, { at: now.getTime(), games });
              return games;
            },
            () => hit?.games ?? [],
          ),
        );
      }
    }
    const games = sortGames((await Promise.all(jobs)).flat());
    return { leagues: leagueIds, games, fetchedAt: now.toISOString() };
  }
}
