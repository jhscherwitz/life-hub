import { HttpError, fetchJson } from '../http';
import type { GoogleAuth } from './auth';

interface GoogleErrorBody {
  error?: { message?: string; status?: string };
}

/**
 * Call a Google API with the signed-in account's token. Retries once with a
 * fresh token on 401, and turns the usual setup mistakes into plain messages.
 */
export async function googleRequest<T>(
  auth: GoogleAuth,
  apiName: string,
  url: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const call = async (force: boolean) =>
    fetchJson<T>(url, {
      method: options.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${await auth.getAccessToken(force)}`,
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
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
    if (err.status === 403 && /has not been used|is disabled|not been enabled/i.test(message)) {
      throw new Error(`The ${apiName} isn't turned on in your Google Cloud project. Turn it on, wait a minute, then click Refresh.`);
    }
    if (err.status === 403 && /insufficient/i.test(message)) {
      const what = options.method === 'POST' ? 'save drafts in Gmail' : apiName === 'Gmail API' ? 'read your email' : 'read your calendar';
      throw new Error(`Life Hub doesn't have permission to ${what}. Open Settings, sign out, sign in again, and tick every box Google asks about.`);
    }
    throw new Error(`${apiName}: ${message}`);
  }
}

export function googleGet<T>(auth: GoogleAuth, apiName: string, url: string): Promise<T> {
  return googleRequest<T>(auth, apiName, url);
}
