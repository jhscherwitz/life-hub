import { MAX_DOC_BYTES, type DocFile } from '../documents';
import { parseUnsubscribe } from '../../src/shared/unsubscribe';
import type { EmailMessage, MailChange } from '../../src/shared/types';
import type { EmailDetail, EmailSource } from '../sources/types';
import { googleGet, googleRequest } from './api';
import type { GoogleAuth } from './auth';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
/** Long emails are cut to this many characters before the AI reads them. */
const MAX_BODY_CHARS = 12_000;

interface GHeader {
  name: string;
  value: string;
}

interface GPart {
  mimeType?: string;
  filename?: string;
  headers?: GHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GPart[];
}

/** Files attached to a message (any part with a file name). */
export function attachmentsOf(part: GPart | undefined): { name: string; mime: string; size: number; attachmentId?: string; data?: string }[] {
  if (!part) return [];
  const here = part.filename && (part.body?.attachmentId || part.body?.data)
    ? [{ name: part.filename, mime: part.mimeType ?? 'application/octet-stream', size: part.body?.size ?? 0, attachmentId: part.body?.attachmentId, data: part.body?.data }]
    : [];
  return [...here, ...(part.parts ?? []).flatMap(attachmentsOf)];
}

export interface GMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GPart;
}

export interface GThread {
  id: string;
  messages?: GMessage[];
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
const OTHER_TABS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS'];

/**
 * Could this need a reply? Mail in the Primary tab, from a person rather than
 * an automated sender, that you haven't answered yet.
 */
export function isReplyCandidate(labels: string[], fromEmail: string, repliedTo = false): boolean {
  return !repliedTo && !labels.includes('SENT') && !labels.some((l) => OTHER_TABS.includes(l)) && !AUTOMATED_SENDER.test(fromEmail);
}

/** The simple guess used when AI isn't set up: a reply candidate you haven't read yet. */
export function guessNeedsReply(labels: string[], fromEmail: string, repliedTo = false): boolean {
  return labels.includes('UNREAD') && isReplyCandidate(labels, fromEmail, repliedTo);
}

function headerOf(headers: GHeader[] | undefined, name: string): string {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value ?? '';
}

export function toEmailMessage(m: GMessage, repliedTo = false): EmailMessage {
  const header = (name: string) => headerOf(m.payload?.headers, name);
  const labels = m.labelIds ?? [];
  const from = parseFrom(header('from'));
  const unsubscribe = parseUnsubscribe(header('list-unsubscribe'), header('list-unsubscribe-post'));
  return {
    id: m.id,
    from,
    subject: header('subject').trim() || '(No subject)',
    snippet: decodeEntities(m.snippet ?? ''),
    receivedAt: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    unread: labels.includes('UNREAD'),
    replyCandidate: isReplyCandidate(labels, from.email, repliedTo),
    needsReply: guessNeedsReply(labels, from.email, repliedTo),
    url: `https://mail.google.com/mail/u/0/#inbox/${m.threadId}`,
    threadId: m.threadId,
    ...(labels.includes('STARRED') && { starred: true }),
    ...(unsubscribe && { unsubscribe }),
  };
}

/**
 * A conversation as one inbox entry: its newest message in the inbox, and
 * whether you've already replied after it. Null if nothing in it is in the inbox.
 */
export function toEmailFromThread(thread: GThread): EmailMessage | null {
  const messages = [...(thread.messages ?? [])].sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  let latest = -1;
  messages.forEach((m, i) => {
    const labels = m.labelIds ?? [];
    if (labels.includes('INBOX') && !labels.includes('SENT')) latest = i;
  });
  if (latest < 0) return null;
  const repliedTo = messages.slice(latest + 1).some((m) => m.labelIds?.includes('SENT'));
  return toEmailMessage(messages[latest], repliedTo);
}

function fromBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf8');
}

function findPart(part: GPart | undefined, mimeType: string): GPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

/** Drop the quoted earlier messages ("On Tue, Sam wrote: > …") under a reply. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex(
    (line, i) =>
      /^On .+wrote:\s*$/.test(line.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim()) ||
      // "On Tue, Oct 1, 2026 at 9:00 AM Sam Lee <sam@example.com>" + "wrote:" on the next line.
      (/^On .+/.test(line.trim()) && lines[i + 1]?.trim() === 'wrote:'),
  );
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).filter((line) => !line.startsWith('>'));
  return kept
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The readable text of a message: its plain-text part, or its HTML part as text. */
export function messageText(payload: GPart | undefined): string {
  const plain = findPart(payload, 'text/plain');
  const html = plain ? undefined : findPart(payload, 'text/html');
  const raw = plain ? fromBase64Url(plain.body!.data!) : html ? htmlToText(fromBase64Url(html.body!.data!)) : '';
  const text = stripQuoted(raw);
  return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}\n[…the rest of this long email was left out]` : text;
}

export function toEmailDetail(m: GMessage): EmailDetail {
  const headers = m.payload?.headers;
  return {
    id: m.id,
    threadId: m.threadId,
    from: parseFrom(headerOf(headers, 'from')),
    replyTo: headerOf(headers, 'reply-to') || undefined,
    subject: headerOf(headers, 'subject').trim() || '(No subject)',
    body: messageText(m.payload) || decodeEntities(m.snippet ?? ''),
    receivedAt: new Date(Number(m.internalDate ?? Date.now())).toISOString(),
    messageId: headerOf(headers, 'message-id') || undefined,
    references: headerOf(headers, 'references') || undefined,
    attachments: attachmentsOf(m.payload).map(({ name, mime, size }) => ({ name, mime, size })),
  };
}

/** RFC 2047 encoding for headers that aren't plain ASCII. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** A plain-text reply as a raw email, threaded under the original. */
export function buildReplyMime(original: EmailDetail, body: string): string {
  const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
  const references = [original.references, original.messageId].filter(Boolean).join(' ');
  const headers = [
    `To: ${original.replyTo || (original.from.name !== original.from.email ? `${encodeHeader(original.from.name)} <${original.from.email}>` : original.from.email)}`,
    `Subject: ${encodeHeader(subject)}`,
    ...(original.messageId ? [`In-Reply-To: ${original.messageId}`] : []),
    ...(references ? [`References: ${references}`] : []),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ];
  const encoded = Buffer.from(body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${encoded}`;
}

/** A new email (not a reply) to one address. */
export function buildNewMime(to: string, subject: string, body: string): string {
  const headers = [`To: ${to}`, `Subject: ${encodeHeader(subject)}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64'];
  const encoded = Buffer.from(body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
  return `${headers.join('\r\n')}\r\n\r\n${encoded}`;
}

/** Gmail: the inbox, full messages for replying, and saving drafts. Hub never sends email. */
export class GmailSource implements EmailSource {
  readonly name = 'Gmail';
  readonly kind = 'live' as const;

  constructor(private readonly auth: GoogleAuth) {}

  async listInbox(options: { limit: number }): Promise<EmailMessage[]> {
    const list = await googleGet<{ messages?: { id: string; threadId: string }[] }>(
      this.auth,
      'Gmail API',
      `${API}/messages?${new URLSearchParams({ labelIds: 'INBOX', maxResults: String(options.limit) })}`,
    );
    const threadIds = [...new Set((list.messages ?? []).map((m) => m.threadId))];
    const metadata = new URLSearchParams({ format: 'metadata' });
    for (const h of ['From', 'Subject', 'List-Unsubscribe', 'List-Unsubscribe-Post']) metadata.append('metadataHeaders', h);

    const threads = await Promise.all(threadIds.map((id) => googleGet<GThread>(this.auth, 'Gmail API', `${API}/threads/${id}?${metadata}`)));
    return threads
      .map(toEmailFromThread)
      .filter((m): m is EmailMessage => m !== null)
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  }

  /** Gmail's own search, across the whole mailbox (same words as Gmail's search box). */
  async search(query: string, limit: number): Promise<EmailMessage[]> {
    const list = await googleGet<{ messages?: { id: string }[] }>(
      this.auth,
      'Gmail API',
      `${API}/messages?${new URLSearchParams({ q: query, maxResults: String(limit) })}`,
    );
    const metadata = new URLSearchParams({ format: 'metadata' });
    for (const h of ['From', 'Subject', 'List-Unsubscribe', 'List-Unsubscribe-Post']) metadata.append('metadataHeaders', h);
    const messages = await Promise.all((list.messages ?? []).map((m) => googleGet<GMessage>(this.auth, 'Gmail API', `${API}/messages/${m.id}?${metadata}`)));
    return messages.map((m) => toEmailMessage(m));
  }

  /** One attachment's file, found by its name. */
  async getAttachment(id: string, name: string): Promise<DocFile> {
    const m = await googleGet<GMessage>(this.auth, 'Gmail API', `${API}/messages/${encodeURIComponent(id)}?format=full`);
    const all = attachmentsOf(m.payload);
    const want = name.trim().toLowerCase();
    const a = all.find((x) => x.name.toLowerCase() === want) ?? all.find((x) => x.name.toLowerCase().includes(want) || want.includes(x.name.toLowerCase()));
    if (!a) throw new Error(`That email has no attachment called “${name}”.${all.length ? ` It has: ${all.map((x) => x.name).join(', ')}.` : ''}`);
    if (a.size > MAX_DOC_BYTES) throw new Error(`${a.name} is too big to read (over 15 MB).`);
    const data = a.data ?? (await googleGet<{ data?: string }>(this.auth, 'Gmail API', `${API}/messages/${encodeURIComponent(m.id)}/attachments/${encodeURIComponent(a.attachmentId!)}`)).data ?? '';
    return { name: a.name, mime: a.mime, data: Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64') };
  }

  async getMessage(id: string): Promise<EmailDetail> {
    return toEmailDetail(await googleGet<GMessage>(this.auth, 'Gmail API', `${API}/messages/${encodeURIComponent(id)}?format=full`));
  }

  /**
   * Archive, delete (to Trash, never forever), star or mark a whole
   * conversation. Takes a conversation id, or a message id (it then uses that
   * message's conversation).
   */
  async changeMail(id: string, change: MailChange): Promise<void> {
    const threadId = await this.threadOf(id);
    const url = `${API}/threads/${encodeURIComponent(threadId)}`;
    if (change === 'trash' || change === 'untrash') {
      await googleRequest(this.auth, 'Gmail API', `${url}/${change}`, { method: 'POST', body: {} });
      return;
    }
    const labels: Record<string, { addLabelIds?: string[]; removeLabelIds?: string[] }> = {
      archive: { removeLabelIds: ['INBOX'] },
      unarchive: { addLabelIds: ['INBOX'] },
      star: { addLabelIds: ['STARRED'] },
      unstar: { removeLabelIds: ['STARRED'] },
      read: { removeLabelIds: ['UNREAD'] },
      unread: { addLabelIds: ['UNREAD'] },
    };
    await googleRequest(this.auth, 'Gmail API', `${url}/modify`, { method: 'POST', body: labels[change] });
  }

  /** The conversation a message is in; a conversation id comes back as it is. */
  private async threadOf(id: string): Promise<string> {
    try {
      const m = await googleGet<{ threadId?: string }>(this.auth, 'Gmail API', `${API}/messages/${encodeURIComponent(id)}?format=minimal`);
      return m.threadId ?? id;
    } catch {
      return id;
    }
  }

  async deleteDraft(id: string): Promise<void> {
    await googleRequest(this.auth, 'Gmail API', `${API}/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async saveDraft(original: EmailDetail, body: string): Promise<{ url: string; id?: string }> {
    const raw = Buffer.from(buildReplyMime(original, body), 'utf8').toString('base64url');
    // drafts.create only: the draft waits in Gmail until you send it yourself.
    const draft = await googleRequest<{ id: string; message?: { threadId?: string } }>(this.auth, 'Gmail API', `${API}/drafts`, {
      method: 'POST',
      body: { message: { raw, threadId: original.threadId } },
    });
    const threadId = draft.message?.threadId ?? original.threadId;
    return { id: draft.id, url: threadId ? `https://mail.google.com/mail/u/0/#inbox/${threadId}` : 'https://mail.google.com/mail/u/0/#drafts' };
  }

  /** A new email saved as a draft, never sent: it waits in Drafts for you. */
  async saveNewDraft(to: string, subject: string, body: string): Promise<{ url: string; id?: string }> {
    const raw = Buffer.from(buildNewMime(to, subject, body), 'utf8').toString('base64url');
    const draft = await googleRequest<{ id: string; message?: { id?: string } }>(this.auth, 'Gmail API', `${API}/drafts`, { method: 'POST', body: { message: { raw } } });
    return { id: draft.id, url: draft.message?.id ? `https://mail.google.com/mail/u/0/#drafts?compose=${draft.message.id}` : 'https://mail.google.com/mail/u/0/#drafts' };
  }
}
