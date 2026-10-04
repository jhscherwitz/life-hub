import { persons } from './person';
import { tasksDueBy } from '../../src/shared/focus';
import { isSameDay, localIsoDate } from '../../src/shared/time';
import type { DashboardSnapshot, WrapUp, WrapUpItem, WrapUpPreview } from '../../src/shared/types';
import type { AiWriter } from '../ai/types';
import { tomorrowOf } from './context';

/** A wrap-up older than this doesn't carry into today's briefing. */
const CARRY_OVER_DAYS = 4;
/** How many wrap-ups to keep. */
const HISTORY_LIMIT = 60;

/** What got done today, and what's still open, for the wrap-up panel. */
export function previewWrapUp(snapshot: Pick<DashboardSnapshot, 'events' | 'tasks' | 'emails'>, now = new Date()): WrapUpPreview {
  const done = snapshot.tasks.filter((t) => t.done && t.completedAt && isSameDay(t.completedAt, now)).map((t) => t.title);
  const meetings = snapshot.events.filter((e) => !e.allDay && isSameDay(e.start, now) && new Date(e.start) <= now).length;
  const unfinished: WrapUpItem[] = [
    ...tasksDueBy(snapshot.tasks, now).map((t) => ({ id: `task:${t.id}`, kind: 'task' as const, title: t.title })),
    ...snapshot.emails
      .filter((m) => m.needsReply && !m.draft?.savedToGmail)
      .map((m) => ({ id: `email:${m.id}`, kind: 'email' as const, title: `Reply to ${m.from.name}`, detail: m.subject })),
  ];
  return { date: localIsoDate(now), done, meetings, unfinished };
}

export function basicWrapUpSummary(w: Pick<WrapUp, 'done' | 'meetings' | 'carryOver'>): string {
  const parts = [
    w.done.length ? `You finished ${w.done.length === 1 ? '1 task' : `${w.done.length} tasks`}` : 'No tasks ticked off today',
    w.meetings ? ` and had ${w.meetings === 1 ? '1 meeting' : `${w.meetings} meetings`}.` : '.',
  ];
  const carry = w.carryOver.length
    ? ` ${w.carryOver.length === 1 ? '1 item rolls' : `${w.carryOver.length} items roll`} into tomorrow's briefing.`
    : ' Nothing rolls over: tomorrow starts clean.';
  return parts.join('') + carry;
}

const system = () => `You write the end-of-day wrap-up for ${persons()} personal dashboard: two or three short sentences about how the day went and what's waiting tomorrow. Be warm and matter-of-fact; credit what got done without gushing. Use only the facts given. No emoji.`;

const SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
  additionalProperties: false,
};

export async function writeWrapUpSummary(writer: AiWriter, w: Pick<WrapUp, 'done' | 'meetings' | 'carryOver' | 'note'>, tomorrowEvents: string[]): Promise<string> {
  const { summary } = await writer.json<{ summary: string }>({
    system: system(),
    prompt: [
      `Done today:\n${w.done.map((t) => `- ${t}`).join('\n') || '- no tasks ticked off'}`,
      `Meetings today: ${w.meetings}`,
      `Rolling into tomorrow:\n${w.carryOver.map((i) => `- ${i.title}${i.detail ? ` (${i.detail})` : ''}`).join('\n') || '- nothing'}`,
      w.note ? `${persons()} note for tomorrow: "${w.note}"` : '',
      `Tomorrow's calendar:\n${tomorrowEvents.map((e) => `- ${e}`).join('\n') || '- nothing yet'}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    schema: SCHEMA,
    effort: 'low',
    maxTokens: 4000,
  });
  if (!summary?.trim()) throw new Error('The AI\'s wrap-up came back empty.');
  return summary.trim();
}

export function tomorrowIso(now = new Date()): string {
  return localIsoDate(tomorrowOf(now));
}

/** Today's finished wrap-up, if any. */
export function wrapUpFor(history: WrapUp[], now = new Date()): WrapUp | null {
  return history.find((w) => w.date === localIsoDate(now)) ?? null;
}

/** The most recent wrap-up before today, if it's recent enough to still matter. */
export function lastWrapUpBefore(history: WrapUp[], now = new Date()): WrapUp | null {
  const today = localIsoDate(now);
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - CARRY_OVER_DAYS);
  const earliest = localIsoDate(oldest);
  return (
    history
      .filter((w) => w.date < today && w.date >= earliest)
      .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
  );
}

/** Add or replace a day's wrap-up, keeping the newest first. */
export function saveToHistory(history: WrapUp[], wrapUp: WrapUp): WrapUp[] {
  return [wrapUp, ...history.filter((w) => w.date !== wrapUp.date)].slice(0, HISTORY_LIMIT);
}
