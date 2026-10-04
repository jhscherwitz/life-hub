// The Inbox page's sorted summary: for a stretch of days, which emails to
// look into, which can probably go, and a line about each.
import type { EmailMessage } from './types';

export const INBOX_RANGES = ['today', '3d', 'week', 'month'] as const;
export type InboxRange = (typeof INBOX_RANGES)[number];

export const RANGE_LABEL: Record<InboxRange, string> = {
  today: 'Today',
  '3d': 'Last 3 days',
  week: 'This week',
  month: 'This month',
};

const DAYS: Record<InboxRange, number> = { today: 1, '3d': 3, week: 7, month: 30 };

/** Midnight at the start of the range (today counts as one of its days). */
export function rangeStart(range: InboxRange, now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS[range] - 1));
}

/** How many emails to read for a range. */
export function rangeLimit(range: InboxRange): number {
  return range === 'today' ? 40 : range === '3d' ? 60 : 80;
}

export interface DigestItem {
  id: string;
  /** Why, in a few words: "Teacher asking for your form by Friday". */
  why: string;
}

export interface InboxDigest {
  range: InboxRange;
  /** Two or three sentences about these emails. */
  overview: string;
  /** Worth opening: someone waiting, a deadline, money, school, something personal. */
  lookInto: DigestItem[];
  /** Probably safe to delete: promotions, old notifications, spam-ish. */
  canDelete: DigestItem[];
  /** Worth keeping but not reading: receipts, sign-in codes, confirmations, shipping updates. */
  canArchive: DigestItem[];
  /** A line about each email, by id. */
  lines: Record<string, string>;
  /** The emails it's about, newest first. */
  emails: EmailMessage[];
  writtenBy: 'ai' | 'basic';
  generatedAt: string;
}

/** The id to act on for an email: its conversation, so archive and delete take the whole thing. */
export const mailId = (m: EmailMessage) => m.threadId ?? m.id;

const ROBOT = /no-?reply|notifications?@|newsletter|news@|marketing|promo|deals|offers|updates@|info@|hello@|mailer|digest/i;
const KEEP = /\b(receipt|order (confirmed|confirmation)|your order|invoice|payment (received|confirmation)|verification code|sign[- ]?in code|security code|one[- ]time (code|password)|login code|confirm your|confirmation|has shipped|shipped|delivered|out for delivery|tracking)\b/i;
const PROMO = /\b(sale|% off|deal|offer|discount|limited time|ends (today|tonight|soon)|newsletter|unsubscribe|webinar|new arrivals|last chance|free shipping)\b/i;

/** Without AI: replies wanted go in "look into", obvious promotions in "probably delete". */
export function basicDigest(emails: EmailMessage[], range: InboxRange, now = new Date()): InboxDigest {
  const lookInto: DigestItem[] = [];
  const canDelete: DigestItem[] = [];
  const canArchive: DigestItem[] = [];
  for (const m of emails) {
    if (m.needsReply) lookInto.push({ id: mailId(m), why: 'Someone may be waiting on a reply' });
    else if (KEEP.test(m.subject)) canArchive.push({ id: mailId(m), why: /code|password|sign[- ]?in|login|verif/i.test(m.subject) ? 'A sign-in code' : 'A receipt or confirmation' });
    else if (ROBOT.test(m.from.email) && PROMO.test(`${m.subject} ${m.snippet}`)) canDelete.push({ id: mailId(m), why: 'Looks like a promotion' });
  }
  const n = emails.length;
  return {
    range,
    overview: n
      ? `${n} email${n === 1 ? '' : 's'}. ${lookInto.length} may need you, ${canArchive.length} are receipts or codes to archive, ${canDelete.length} look like promotions.`
      : 'No emails in this range.',
    lookInto,
    canDelete,
    canArchive,
    lines: {},
    emails,
    writtenBy: 'basic',
    generatedAt: now.toISOString(),
  };
}

/** Keeps the AI's answer to emails that exist, each in one pile at most. */
export function cleanDigest(
  raw: { overview?: unknown; lookInto?: unknown; canDelete?: unknown; canArchive?: unknown; lines?: unknown } | null,
  emails: EmailMessage[],
  range: InboxRange,
  now = new Date(),
): InboxDigest {
  const ids = new Set(emails.map(mailId));
  // The AI may use the message id; map it back to the conversation.
  const byAny = new Map<string, string>();
  for (const m of emails) {
    byAny.set(m.id, mailId(m));
    byAny.set(mailId(m), mailId(m));
  }
  const used = new Set<string>();
  const pile = (list: unknown): DigestItem[] => {
    if (!Array.isArray(list)) return [];
    const out: DigestItem[] = [];
    for (const item of list) {
      const it = item as { id?: unknown; why?: unknown } | null;
      const id = byAny.get(String(it?.id ?? ''));
      if (!id || !ids.has(id) || used.has(id)) continue;
      used.add(id);
      out.push({ id, why: String(it?.why ?? '').trim().slice(0, 160) });
    }
    return out;
  };
  const lookInto = pile(raw?.lookInto);
  const canDelete = pile(raw?.canDelete);
  const canArchive = pile(raw?.canArchive);
  const lines: Record<string, string> = {};
  if (Array.isArray(raw?.lines)) {
    for (const item of raw.lines as { id?: unknown; line?: unknown }[]) {
      const id = byAny.get(String(item?.id ?? ''));
      const line = String(item?.line ?? '').trim();
      if (id && line) lines[id] = line.slice(0, 240);
    }
  }
  const overview = typeof raw?.overview === 'string' && raw.overview.trim() ? raw.overview.trim().slice(0, 600) : 'Here is what came in.';
  return { range, overview, lookInto, canDelete, canArchive, lines, emails, writtenBy: 'ai', generatedAt: now.toISOString() };
}

/** One email per conversation, newest first. */
export function oneEach(emails: EmailMessage[]): EmailMessage[] {
  const seen = new Set<string>();
  return [...emails]
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .filter((m) => {
      const id = mailId(m);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

/** Where a sorting rule sends matching email. "keep" means never archive or delete it. */
export const RULE_PILES = ['look', 'archive', 'delete', 'keep'] as const;
export type RulePile = (typeof RULE_PILES)[number];

export const PILE_WORDS: Record<RulePile, string> = {
  look: 'Always look into',
  archive: 'Always archive',
  delete: 'Always delete',
  keep: 'Always keep',
};

/** A sorting rule you told the AI: email from this sender, or with these words, goes in this pile. */
export interface MailRule {
  id: string;
  /** A sender name, an email address or domain, or words in the subject ("Bed Bath & Beyond", "robinhood.com", "login"). */
  match: string;
  pile: RulePile;
}

const fold = (t: string) => t.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9@.]+/g, ' ').trim();

/** Does a rule match an email? By sender name, address or domain, or words in the subject. */
export function ruleMatches(rule: MailRule, m: EmailMessage): boolean {
  const want = fold(rule.match);
  if (!want) return false;
  const sender = fold(`${m.from.name} ${m.from.email}`);
  if (sender.includes(want)) return true;
  // "bedbathandbeyond" in the address matches "Bed Bath and Beyond".
  if (fold(m.from.email).replace(/\s/g, '').includes(want.replace(/\s/g, ''))) return true;
  return fold(m.subject).includes(want);
}

/** Puts emails where your rules say, after the AI or the basic sort. The newest rule wins. */
export function applyRules(digest: InboxDigest, rules: MailRule[]): InboxDigest {
  if (!rules.length) return digest;
  const piles = { lookInto: [...digest.lookInto], canArchive: [...(digest.canArchive ?? [])], canDelete: [...digest.canDelete] };
  for (const m of digest.emails) {
    const rule = [...rules].reverse().find((r) => ruleMatches(r, m));
    if (!rule) continue;
    const id = mailId(m);
    const old = [...piles.lookInto, ...piles.canArchive, ...piles.canDelete].find((i) => i.id === id);
    piles.lookInto = piles.lookInto.filter((i) => i.id !== id);
    piles.canArchive = piles.canArchive.filter((i) => i.id !== id);
    piles.canDelete = piles.canDelete.filter((i) => i.id !== id);
    const why = `Your rule: ${PILE_WORDS[rule.pile].toLowerCase()} “${rule.match}”`;
    if (rule.pile === 'look') piles.lookInto.push({ id, why: old?.why && digest.lookInto.some((i) => i.id === id) ? old.why : why });
    else if (rule.pile === 'archive') piles.canArchive.push({ id, why });
    else if (rule.pile === 'delete') piles.canDelete.push({ id, why });
  }
  return { ...digest, ...piles };
}
