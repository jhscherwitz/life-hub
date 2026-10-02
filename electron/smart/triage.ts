import type { EmailMessage } from '../../src/shared/types';
import type { AiWriter } from './claude';
import type { JsonFile } from './store';

/** Mail older than this isn't triaged: if it still matters, it's in your tasks. */
const TRIAGE_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** How many decisions to remember. */
const CACHE_LIMIT = 500;

export interface TriageDecision {
  needsReply: boolean;
  reason: string;
  at: string;
}

export type TriageCache = Record<string, TriageDecision>;

const SYSTEM = `You sort Jacob's inbox for Hub, his personal dashboard. For each email, decide whether Jacob personally needs to reply.

Needs a reply: a direct question or request to him, someone waiting on his answer or decision, scheduling that needs his confirmation.
Doesn't: FYIs, announcements, receipts, automated mail, threads where he's only copied, and thank-yous that close a conversation.

For each email give a reason of at most six words, like "Asks to move Thursday's call".`;

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, needsReply: { type: 'boolean' }, reason: { type: 'string' } },
        required: ['id', 'needsReply', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

/**
 * Decides which emails need a reply. Only recent reply candidates (from a
 * person, in Primary, not yet answered) are considered. With Claude, each one
 * is judged once and the decision remembered; without it, the simple guess
 * from the email source stands (unread candidates).
 */
export async function triageEmails(
  emails: EmailMessage[],
  options: { writer: AiWriter | null; cache: JsonFile<TriageCache>; now?: number },
): Promise<{ emails: EmailMessage[]; error?: string }> {
  const now = options.now ?? Date.now();
  const isCandidate = (m: EmailMessage) => m.replyCandidate === true && now - new Date(m.receivedAt).getTime() < TRIAGE_WINDOW_MS;
  if (!options.writer) {
    return { emails: emails.map((m) => ({ ...m, needsReply: isCandidate(m) && m.needsReply === true })) };
  }

  const cache = options.cache.read();
  const unjudged = emails.filter((m) => isCandidate(m) && !cache[m.id]);
  let error: string | undefined;
  if (unjudged.length) {
    try {
      const list = unjudged
        .map((m) => `id: ${m.id}\nfrom: ${m.from.name} <${m.from.email}>\nsubject: ${m.subject}\nreceived: ${m.receivedAt}\npreview: ${m.snippet}`)
        .join('\n\n');
      const { results } = await options.writer.json<{ results: { id: string; needsReply: boolean; reason: string }[] }>({
        system: SYSTEM,
        prompt: `Sort these emails.\n\n${list}`,
        schema: SCHEMA,
        effort: 'low',
      });
      const at = new Date(now).toISOString();
      for (const r of results ?? []) {
        if (unjudged.some((m) => m.id === r.id)) cache[r.id] = { needsReply: r.needsReply, reason: r.reason.trim(), at };
      }
      const kept = Object.entries(cache)
        .sort((a, b) => b[1].at.localeCompare(a[1].at))
        .slice(0, CACHE_LIMIT);
      options.cache.write(Object.fromEntries(kept));
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    error,
    emails: emails.map((m) => {
      if (!isCandidate(m)) return { ...m, needsReply: false };
      const decision = cache[m.id];
      // Not judged yet (Claude was unreachable): fall back to the simple guess.
      if (!decision) return m;
      return { ...m, needsReply: decision.needsReply, triageReason: decision.needsReply ? decision.reason : undefined };
    }),
  };
}
