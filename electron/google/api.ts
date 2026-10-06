import { HttpError, fetchJson } from '../http';
import type { GoogleAuth } from './auth';

interface GoogleErrorBody {
  error?: { message?: string; status?: string };
}

/**
 * Google turns away a burst of requests ("Quota exceeded … per minute", "Too
 * many concurrent requests"), so each API gets only a few at a time and a
 * turned-away request waits and tries again.
 */
const AT_ONCE = 4;
let retryDelays = [2_000, 8_000, 20_000];
const busy = new Map<string, { running: number; queue: (() => void)[] }>();

/** For tests: how long to wait before each retry. */
export function setRetryDelays(ms: number[]): void {
  retryDelays = ms;
}

async function withSlot<T>(api: string, run: () => Promise<T>): Promise<T> {
  const lane = busy.get(api) ?? { running: 0, queue: [] };
  busy.set(api, lane);
  if (lane.running >= AT_ONCE) await new Promise<void>((go) => lane.queue.push(go));
  else lane.running++;
  try {
    return await run();
  } finally {
    const next = lane.queue.shift();
    if (next) next();
    else lane.running--;
  }
}

/** Too many requests for now, as opposed to a real "no". */
export function isRateLimited(err: unknown): boolean {
  if (!(err instanceof HttpError)) return false;
  if (err.status === 429) return true;
  const message = (err.body as GoogleErrorBody | null)?.error?.message ?? '';
  return err.status === 403 && /rate ?limit|quota exceeded|too many (concurrent )?requests/i.test(message);
}

/**
 * Call a Google API with the signed-in account's token. Retries once with a
 * fresh token on 401, and turns the usual setup mistakes into plain messages.
 */
export async function googleRequest<T>(
  auth: GoogleAuth,
  apiName: string,
  url: string,
  options: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const once = async (force: boolean) =>
    fetchJson<T>(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${await auth.getAccessToken(force)}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  const call = async (force: boolean): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await withSlot(apiName, () => once(force));
      } catch (err) {
        if (!isRateLimited(err) || attempt >= retryDelays.length) throw err;
        await new Promise((r) => setTimeout(r, retryDelays[attempt]));
      }
    }
  };
  try {
    try {
      return await call(false);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) return await call(true);
      throw err;
    }
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    const message = (err.body as GoogleErrorBody | null)?.error?.message ?? err.message;
    if (isRateLimited(err)) throw new Error(`Google is getting too many requests from Life Hub right now (${apiName}). Wait a minute and try again.`);
    if (err.status === 403 && /has not been used|is disabled|not been enabled/i.test(message)) {
      throw new Error(`The ${apiName} isn't turned on in your Google Cloud project. Turn it on, wait a minute, then click Refresh.`);
    }
    if (err.status === 403 && /insufficient/i.test(message)) {
      const what = apiName === 'Gmail API' && /\/(modify|trash|untrash)$/.test(url) ? 'change your email' : apiName === 'Google Calendar API' && options.method !== 'GET' && options.method !== undefined ? 'add to your calendar' : options.method === 'POST' ? 'save drafts in Gmail' : apiName === 'Gmail API' ? 'read your email' : 'read your calendar';
      throw new Error(`Life Hub doesn't have permission to ${what}. Open Settings, sign out, sign in again, and tick every box Google asks about.`);
    }
    throw new Error(`${apiName}: ${message}`);
  }
}

export function googleGet<T>(auth: GoogleAuth, apiName: string, url: string): Promise<T> {
  return googleRequest<T>(auth, apiName, url);
}
