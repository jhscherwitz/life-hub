import type { EmailMessage } from '../../src/shared/types';
import type { EmailSource } from '../sources/types';
import { googleGet } from './api';
import type { GoogleAuth } from './auth';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Gmail snippets arrive HTML-escaped ("It&#39;s"). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (match, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : match;
    }
    return ENTITIES[code.toLowerCase()] ?? match;
  });
}

/** `"Priya Shah" <priya@example.com>` → { name, email }. */
export function parseFrom(header: string): { name: string; email: string } {
  const match = header.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const email = match[2].trim();
    return { name: match[1].trim() || email, email };
  }
  const email = header.trim();
  return { name: email, email };
}

const AUTOMATED_SENDER = /(no-?reply|do-?not-?reply|notifications?|mailer-daemon|newsletter|updates?|alerts?)@/i;

/**
 * A first guess at "needs a reply": unread mail in Gmail's Primary tab from a
 * person rather than an automated sender. Smarter triage comes in a later step.
 */
export function guessNeedsReply(labels: string[], fromEmail: string): boolean {
  const promoOrSocial = labels.some((l) => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'].includes(l));
  return labels.includes('UNREAD') && !promoOrSocial && !AUTOMATED_SENDER.test(fromEmail);
}

export function toEmailMessage(m: GMessage): EmailMessage {
  const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
  const labels = m.labelIds ?? [];
  const from = parseFrom(header('from'));
  return {
    id: m.id,
    from,
    subject: header('subject').trim() || '(No subject)',
    snippet: decodeEntities(m.snippet ?? ''),
    receivedAt: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    unread: labels.includes('UNREAD'),
    needsReply: guessNeedsReply(labels, from.email),
    url: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`,
  };
}

/** The newest messages in the Gmail inbox. Read-only. */
export class GmailSource implements EmailSource {
  readonly name = 'Gmail';
  readonly kind = 'live' as const;

  constructor(private readonly auth: GoogleAuth) {}

  async listInbox(options: { limit: number }): Promise<EmailMessage[]> {
    const list = await googleGet<{ messages?: { id: string }[] }>(
      this.auth,
      'Gmail API',
      `${API}/messages?${new URLSearchParams({ labelIds: 'INBOX', maxResults: String(options.limit) })}`,
    );
    const metadata = new URLSearchParams({ format: 'metadata' });
    for (const h of ['From', 'Subject']) metadata.append('metadataHeaders', h);

    const messages = await Promise.all(
      (list.messages ?? []).map((m) => googleGet<GMessage>(this.auth, 'Gmail API', `${API}/messages/${m.id}?${metadata}`)),
    );
    return messages.map(toEmailMessage).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }
}
