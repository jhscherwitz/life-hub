import { persons } from './person';
import { PLAN_KINDS, cleanPlan, type EmailPlan } from '../../src/shared/plans';
import type { EmailMessage } from '../../src/shared/types';
import type { AiWriter } from '../ai/types';
import type { JsonFile } from './store';

/** Only fairly recent mail is read for plans. */
const WINDOW_MS = 21 * 86_400_000;
const CACHE_LIMIT = 500;
/** Emails per AI call, so one slow answer doesn't hold up the rest. */
const BATCH = 12;

export interface PlanCacheEntry {
  plans: ReturnType<typeof cleanPlan>[];
  at: string;
}

export type PlanCache = Record<string, PlanCacheEntry>;

const system = () => `You read ${persons()} email for Life Hub, their personal dashboard, and pull out plans with a date that they'd want on their calendar or to-do list.

Pull out:
- event: something to go to or do at a time (dinner, a game, an appointment, a meeting, a party, a class change)
- deadline: something due (an assignment, an application, a form, an RSVP by a date)
- delivery: a package or order arriving
- bill: a payment due or an automatic charge coming up
- travel: a flight, train, hotel check-in or trip

Skip: newsletters and marketing, sales and "ends Sunday" offers, dates that already passed, and vague ideas with no date ("we should hang out sometime").

Give the date as YYYY-MM-DD, working out words like "Friday" or "tomorrow" from the date the email was sent. Give a time as 24-hour HH:MM only if the email says one. Keep titles short, like "Dinner with Sam" or "Bio lab report due". Most emails have no plans; give those an empty list.`;

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          plans: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: [...PLAN_KINDS] },
                title: { type: 'string' },
                date: { type: 'string' },
                time: { type: 'string' },
                place: { type: 'string' },
              },
              required: ['kind', 'title', 'date'],
            },
          },
        },
        required: ['id', 'plans'],
      },
    },
  },
  required: ['results'],
};

/**
 * Plans in your recent email. Each email is read by the AI once and the
 * answer remembered, so this costs nothing after the first time. Without AI,
 * there are none.
 */
export async function findPlans(
  emails: EmailMessage[],
  options: { writer: AiWriter | null; cache: JsonFile<PlanCache>; now?: number },
): Promise<{ plans: EmailPlan[]; error?: string }> {
  if (!options.writer) return { plans: [] };
  const now = options.now ?? Date.now();
  const recent = emails.filter((m) => now - new Date(m.receivedAt).getTime() < WINDOW_MS);
  const cache = options.cache.read();
  const unread = recent.filter((m) => !cache[m.id]);
  let error: string | undefined;

  for (let i = 0; i < unread.length; i += BATCH) {
    const batch = unread.slice(i, i + BATCH);
    try {
      const list = batch
        .map((m) => `id: ${m.id}\nfrom: ${m.from.name} <${m.from.email}>\nsent: ${m.receivedAt}\nsubject: ${m.subject}\npreview: ${m.snippet}`)
        .join('\n\n');
      const { results } = await options.writer.json<{ results: { id: string; plans: unknown[] }[] }>({
        system: system(),
        prompt: `Today is ${new Date(now).toDateString()}. Find the plans in these emails.\n\n${list}`,
        schema: SCHEMA,
        effort: 'low',
      });
      const at = new Date(now).toISOString();
      for (const m of batch) {
        const found = (results ?? []).find((r) => r.id === m.id);
        cache[m.id] = { plans: (found?.plans ?? []).map(cleanPlan).filter(Boolean), at };
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      break;
    }
  }

  if (unread.length) {
    const kept = Object.entries(cache)
      .sort((a, b) => b[1].at.localeCompare(a[1].at))
      .slice(0, CACHE_LIMIT);
    options.cache.write(Object.fromEntries(kept));
  }

  const plans: EmailPlan[] = [];
  for (const m of recent) {
    (cache[m.id]?.plans ?? []).forEach((p, n) => {
      if (p) plans.push({ ...p, id: `${m.id}#${n}`, emailId: m.id, from: m.from.name || m.from.email, ...(m.url && { url: m.url }) });
    });
  }
  return { plans, ...(error && { error }) };
}
