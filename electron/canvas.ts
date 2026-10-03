import { HttpError, fetchJson } from './http';
import { parseCourses, parsePlanner, type CanvasData } from '../src/shared/canvas';
import { localIsoDate } from '../src/shared/time';

/** How long fetched grades are reused before asking Canvas again. */
const FRESH_MS = 15 * 60_000;
const DAY = 86_400_000;

function explain(err: unknown): string {
  if (err instanceof HttpError) {
    if (err.status === 401) return "Canvas didn't accept your access token. Make a new one in Canvas (Account, Settings) and connect again.";
    if (err.status === 403) return "Your school's Canvas doesn't allow this. Some schools turn access tokens off.";
    if (err.status === 404) return "That doesn't look like your school's Canvas address. Check it in Settings.";
  }
  return err instanceof Error ? err.message : String(err);
}

/** Reads your classes, grades and upcoming work from Canvas with your own access token. */
export class CanvasClient {
  private cache: CanvasData | null = null;

  constructor(
    readonly origin: string,
    private readonly token: string,
  ) {}

  private get<T>(path: string): Promise<T> {
    return fetchJson<T>(`${this.origin}/api/v1${path}`, { headers: { Authorization: `Bearer ${this.token}` } }, 20_000);
  }

  /** Checks the token works and returns your name in Canvas. */
  async whoAmI(): Promise<string> {
    try {
      const me = await this.get<{ name?: string; short_name?: string }>('/users/self');
      return me.short_name || me.name || 'you';
    } catch (err) {
      throw new Error(explain(err));
    }
  }

  async data(force = false): Promise<CanvasData> {
    if (!force && this.cache && !this.cache.error && Date.now() - Date.parse(this.cache.fetchedAt) < FRESH_MS) return this.cache;
    try {
      const [user, rawCourses] = await Promise.all([
        this.whoAmI(),
        this.get<unknown>('/courses?enrollment_state=active&include[]=total_scores&include[]=current_grading_period_scores&per_page=50'),
      ]);
      const courses = parseCourses(rawCourses, this.origin);
      const now = Date.now();
      const planner = await this.get<unknown>(
        `/planner/items?${new URLSearchParams({ start_date: localIsoDate(new Date(now - 7 * DAY)), end_date: localIsoDate(new Date(now + 30 * DAY)), per_page: '100' })}`,
      ).catch(() => []);
      this.cache = { user, courses, assignments: parsePlanner(planner, this.origin, courses), fetchedAt: new Date().toISOString() };
    } catch (err) {
      const error = explain(err);
      this.cache = this.cache ? { ...this.cache, error } : { user: '', courses: [], assignments: [], fetchedAt: new Date().toISOString(), error };
    }
    return this.cache;
  }
}
