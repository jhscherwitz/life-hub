import { isPublicUrl } from './smart/tools';
import type { Unsubscribe } from '../src/shared/unsubscribe';

export type UnsubscribeResult = 'done' | 'opened' | 'gmail';

/**
 * Unsubscribes the way the newsletter asks: a one-click request when it takes
 * one (done right here), otherwise its unsubscribe page opens. When it only
 * gives an email address, the email opens in Gmail, whose own Unsubscribe
 * button handles that (Life Hub never sends email).
 */
export async function unsubscribe(u: Unsubscribe, open: (url: string) => void, fetcher: typeof fetch = fetch): Promise<UnsubscribeResult> {
  const url = u.url && isPublicUrl(u.url) ? u.url : undefined;
  if (url && u.oneClick) {
    try {
      const res = await fetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
        redirect: 'follow',
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return 'done';
    } catch {
      // Fall back to the page.
    }
  }
  if (url) {
    open(url);
    return 'opened';
  }
  return 'gmail';
}
