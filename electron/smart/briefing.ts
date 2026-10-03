import { tasksDueBy, topTask } from '../../src/shared/focus';
import { formatTime, isSameDay, localIsoDate, nextEvent } from '../../src/shared/time';
import type { Briefing } from '../../src/shared/types';
import type { AiWriter } from '../ai/types';
import { describeDay, type DayContext } from './context';

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "A, B and C". */
export function listOf(items: string[], max = 3): string {
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;
  if (extra > 0) shown.push(`${extra} more`);
  return shown.length <= 1 ? (shown[0] ?? '') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** The briefing Hub writes itself, without AI. Always up to date. */
export function basicBriefing(ctx: DayContext): Pick<Briefing, 'headline' | 'points'> {
  const now = ctx.now.getTime();
  const today = ctx.events.filter((e) => isSameDay(e.start, ctx.now));
  const timed = today.filter((e) => !e.allDay);
  const remaining = timed.filter((e) => new Date(e.end).getTime() > now);
  const next = nextEvent(timed, now);
  const allDay = today.filter((e) => e.allDay);
  const needsReply = ctx.emails.filter((e) => e.needsReply);
  const due = tasksDueBy(ctx.tasks, ctx.now);
  const top = topTask(ctx.tasks, ctx.now);
  const weekday = ctx.now.toLocaleDateString([], { weekday: 'long' });

  const headline = remaining.length
    ? `${weekday}: ${plural(remaining.length, 'meeting')} left${next ? `, next is ${next.title} at ${formatTime(next.start)}` : ''}.`
    : timed.length
      ? `${weekday}: you're done with meetings for today.`
      : `${weekday}: a clear calendar today.`;

  const points: string[] = [];
  if (allDay.length) points.push(`All day: ${listOf(allDay.map((e) => e.title))}.`);
  points.push(
    needsReply.length
      ? `${needsReply.length === 1 ? '1 email needs' : `${needsReply.length} emails need`} a reply, from ${listOf(needsReply.map((m) => m.from.name))}.`
      : 'Nothing in your inbox needs a reply.',
  );
  points.push(
    due.length
      ? `${plural(due.length, 'task')} due today or overdue${top ? `. Start with "${top.title}"` : ''}.`
      : top
        ? `Nothing due today. Next up: "${top.title}".`
        : 'No open tasks.',
  );
  const carried = ctx.carriedOver;
  if (carried?.carryOver.length) points.push(`Carried over from your last wrap-up: ${listOf(carried.carryOver.map((i) => i.title))}.`);
  if (carried?.note) points.push(`Your note to yourself: "${carried.note}"`);
  if (ctx.weather) {
    const rain = ctx.weather.precipitationChance >= 40 ? `, ${ctx.weather.precipitationChance}% chance of rain` : '';
    points.push(`${ctx.weather.condition}, high of ${ctx.weather.highF}°${rain}.`);
  }
  return { headline, points };
}

const SYSTEM = `You write Jacob's morning briefing for Life Hub, his personal dashboard. He reads it at a glance at the start of the day.

Write a headline (one sentence, at most 14 words) that sums up the shape of the day, then 3 to 5 short points, most important first. Prioritize what's time-sensitive (the first meeting, back-to-back stretches, clashes), who is waiting on a reply, which task to start with, and anything carried over from last night's wrap-up. Mention the weather only if it changes his plans. Use times like "9:30 AM". Be plain, warm and direct: no greeting, no filler, no emoji.

Use only the facts you're given. If the data is thin, say less rather than inventing anything.`;

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    points: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'points'],
  additionalProperties: false,
};

/** The AI's briefing for the day. */
export async function writeBriefing(writer: AiWriter, ctx: DayContext): Promise<Pick<Briefing, 'headline' | 'points'>> {
  const result = await writer.json<{ headline: string; points: string[] }>({
    system: SYSTEM,
    prompt: `Here is Jacob's day. Write his briefing.\n\n${describeDay(ctx)}`,
    schema: SCHEMA,
    effort: 'medium',
  });
  const points = (result.points ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 6);
  if (!result.headline?.trim() || points.length === 0) throw new Error('The AI\'s briefing came back empty. Try again.');
  return { headline: result.headline.trim(), points };
}

export function briefingDate(now: Date): string {
  return localIsoDate(now);
}
