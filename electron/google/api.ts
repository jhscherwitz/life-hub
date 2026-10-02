import { HttpError, fetchJson } from '../http';
import type { GoogleAuth } from './auth';

interface GoogleErrorBody {
  error?: { message?: string; status?: string };
}

/**
 * GET a Google API with the signed-in account's token. Retries once with a
 * fresh token on 401, and turns the usual setup mistakes into plain messages.
 */
export async function googleGet<T>(auth: GoogleAuth, apiName: string, url: string): Promise<T> {
  const call = async (force: boolean) =>
    fetchJson<T>(url, { headers: { Authorization: `Bearer ${await auth.getAccessToken(force)}` } });
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
      throw new Error(`Hub doesn't have permission to read ${apiName === 'Gmail API' ? 'your email' : 'your calendar'}. Sign out and sign in again, and tick every box Google asks about.`);
    }
    throw new Error(`${apiName}: ${message}`);
  }
}
