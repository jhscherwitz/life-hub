/** Thrown for any non-2xx response, carrying the status so callers can react to 401s. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

// Nominatim's usage policy asks every app to identify itself.
export const USER_AGENT = 'LifeHub/0.1 (personal dashboard; https://github.com/jhscherwitz/life-hub)';

/** fetch() that parses JSON, times out, and turns error responses into HttpError. */
export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const host = new URL(url).host;
    if (err instanceof Error && err.name === 'TimeoutError') throw new Error(`${host} took too long to answer`);
    throw new Error(`Couldn't reach ${host}. Check your internet connection.`);
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Leave non-JSON bodies as text.
  }
  if (!res.ok) throw new HttpError(`${new URL(url).host} answered with error ${res.status}. Try again in a minute.`, res.status, body);
  return body as T;
}
