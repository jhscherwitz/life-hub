// Newsletters say how to unsubscribe in a List-Unsubscribe header: a web
// address, an email address, or both. With List-Unsubscribe-Post they also
// take a one-click unsubscribe (RFC 8058), which Life Hub can do itself.

export interface Unsubscribe {
  /** A web page (https only). */
  url?: string;
  /** An address to email instead. */
  mailto?: string;
  /** The web address takes a one-click request: no page to fill in. */
  oneClick?: boolean;
}

export function parseUnsubscribe(header: string, post = ''): Unsubscribe | null {
  const entries = [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  const url = entries.find((e) => /^https:\/\//i.test(e));
  const mailto = entries.find((e) => /^mailto:/i.test(e));
  if (!url && !mailto) return null;
  return {
    ...(url && { url }),
    ...(mailto && { mailto: mailto.slice(7) }),
    ...(url && /one-click/i.test(post) && { oneClick: true }),
  };
}
