import { HttpError, fetchJson } from './http';
import { parseCourses, parsePlanner, type CanvasData } from '../src/shared/canvas';
import { localIsoDate } from '../src/shared/time';

/** How long fetched grades are reused before asking Canvas again. */
const FRESH_MS = 15 * 60_000;
const DAY = 86_400_000;

/** Fetches a URL with your Canvas sign-in from inside Life Hub (its cookies), for schools that turned access tokens off. */
export type SignedInFetch = (url: string) => Promise<Response>;

const SIGNED_OUT = 'Your Canvas sign-in ran out. Open Settings and click Sign in to Canvas again.';

function explain(err: unknown, signedIn: boolean): string {
  if (err instanceof HttpError) {
    if (err.status === 401)
      return signedIn ? SIGNED_OUT : "Canvas didn't accept your access token. Make a new one in Canvas (Account, Settings) and connect again.";
    if (err.status === 403) return "Your school's Canvas doesn't allow this. Some schools turn access tokens off.";
    if (err.status === 404) return "That doesn't look like your school's Canvas address. Check it in Settings.";
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reads your classes, grades and upcoming work from Canvas, with your own
 * access token or with your sign-in from inside Life Hub.
 */
export class CanvasClient {
  private cache: CanvasData | null = null;

  constructor(
    readonly origin: string,
    private readonly auth: string | SignedInFetch,
  ) {}

  private get signedIn(): boolean {
    return typeof this.auth === 'function';
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.origin}/api/v1${path}`;
    if (typeof this.auth === 'string') return fetchJson<T>(url, { headers: { Authorization: `Bearer ${this.auth}` } }, 20_000);
    let res: Response;
    try {
      res = await this.auth(url);
    } catch {
      throw new Error(`Couldn't reach ${new URL(url).host}. Check your internet connection.`);
    }
    const text = await res.text();
    if (!res.ok) throw new HttpError(`Canvas answered with error ${res.status}.`, res.status, text);
    try {
      // With a browser sign-in, Canvas puts "while(1);" before its answers so other sites can't read them.
      return JSON.parse(text.replace(/^while\(1\);/, '')) as T;
    } catch {
      // A sign-in page instead of data means the sign-in ran out.
      throw new HttpError('Canvas sent a page instead of data.', 401, text);
    }
  }

  /** Checks the token works and returns your name in Canvas. */
  async whoAmI(): Promise<string> {
    try {
      const me = await this.get<{ name?: string; short_name?: string }>('/users/self');
      return me.short_name || me.name || 'you';
    } catch (err) {
      throw new Error(explain(err, this.signedIn));
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
      const error = explain(err, this.signedIn);
      this.cache = this.cache ? { ...this.cache, error } : { user: '', courses: [], assignments: [], fetchedAt: new Date().toISOString(), error };
    }
    return this.cache;
  }
}
