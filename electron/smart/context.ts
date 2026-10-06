import { persons } from './person';
import { formatTime, isSameDay } from '../../src/shared/time';
import { findClashes } from '../../src/shared/clashes';
import type { EmailPlan } from '../../src/shared/plans';
import type { CalendarEvent, EmailMessage, Task, Weather, WrapUp } from '../../src/shared/types';

/** Everything the briefing is written from. */
export interface DayContext {
  now: Date;
  /** Today's and tomorrow's events. */
  events: CalendarEvent[];
  emails: EmailMessage[];
  tasks: Task[];
  weather: Weather | null;
  /** The last evening wrap-up, whose unfinished items carry into today. */
  carriedOver: WrapUp | null;
  /** Plans with a date found in email that aren't on the calendar. */
  plans?: EmailPlan[];
  /** Their usual drive, when the Commute widget is on their dashboard. */
  commute?: CommuteNow | null;
  /** Canvas work due in the next week, in words, when Canvas is connected. */
  canvasDue?: string | null;
}

/** The commute as it stands now: which way, and about how long. */
export interface CommuteNow {
  fromLabel: string;
  toLabel: string;
  minutes: number;
  miles: number;
  rushHour: boolean;
}

/** "Drive Home → Work: about 26 min with rush-hour traffic (14.2 mi)." */
export function commuteLine(c: CommuteNow): string {
  return `Drive ${c.fromLabel} → ${c.toLabel}: about ${c.minutes} min${c.rushHour ? ' with rush-hour traffic' : ''} (${c.miles} mi).`;
}

export function tomorrowOf(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return d;
}

function eventLine(e: CalendarEvent): string {
  const when = e.allDay ? 'all day' : `${formatTime(e.start)}–${formatTime(e.end)}`;
  const where = [e.location, e.meetingUrl ? 'video call' : ''].filter(Boolean).join(', ');
  return `- ${when}: ${e.title}${where ? ` (${where})` : ''}${e.ref ? ` [event ${e.ref}]` : ''}`;
}

/**
 * When a task is due, in words the AI can't misread: "due today at 11:59 PM",
 * "due TOMORROW (Monday) at 1:00 PM", "OVERDUE (was due Friday)".
 * A bare "2026-10-05" got read as today.
 */
export function dueText(due: string, now: Date): string {
  const hasTime = due.includes('T');
  const at = hasTime ? new Date(due) : new Date(`${due.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(at.getTime())) return `due ${due}`;
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayStart(at) - dayStart(now)) / 86_400_000);
  const time = hasTime ? ` at ${formatTime(at.toISOString())}` : '';
  const weekday = at.toLocaleDateString('en-US', { weekday: 'long' });
  if (days < 0 || (days === 0 && hasTime && at.getTime() < now.getTime())) return `OVERDUE (was due ${days === 0 ? 'earlier today' : days === -1 ? 'yesterday' : weekday}${time})`;
  if (days === 0) return `due TODAY${time}`;
  if (days === 1) return `due TOMORROW (${weekday})${time}, not today`;
  return `due ${at.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}${time}, in ${days} days`;
}

/** The day as plain text, for the AI to read. */
export function describeDay(ctx: DayContext): string {
  const today = ctx.events.filter((e) => isSameDay(e.start, ctx.now));
  const tomorrow = ctx.events.filter((e) => isSameDay(e.start, tomorrowOf(ctx.now)));
  const needsReply = ctx.emails.filter((e) => e.needsReply);
  const open = ctx.tasks.filter((t) => !t.done);
  const sections = [
    `Right now it is ${ctx.now.toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`,
    `Today's calendar:\n${today.map(eventLine).join('\n') || '- nothing'}`,
    `Tomorrow's calendar:\n${tomorrow.map(eventLine).join('\n') || '- nothing'}`,
    `Emails that need a reply:\n${needsReply.map((m) => `- ${m.from.name}: "${m.subject}" (${m.snippet.slice(0, 160)})`).join('\n') || '- none'}`,
    `Inbox, newest first (id in brackets, for email actions):\n${ctx.emails
      .slice(0, 25)
      .map((m) => `- [${m.threadId ?? m.id}] ${m.from.name || m.from.email}: "${m.subject}"${m.unread ? ' (unread)' : ''}${m.starred ? ' (starred)' : ''}`)
      .join('\n') || '- empty'}`,
    `Open tasks:\n${open.map((t) => `- ${t.title}${t.due ? ` (${dueText(t.due, ctx.now)})` : ' (no due date)'}${t.priority ? `, ${t.priority} priority` : ''}`).join('\n') || '- none'}`,
  ];
  if (ctx.plans?.length) {
    sections.push(
      `Plans found in email (not on the calendar):\n${ctx.plans
        .slice(0, 12)
        .map((p) => `- ${p.date}${p.time ? ` ${p.time}` : ''}: ${p.title} (${p.kind}, from ${p.from})`)
        .join('\n')}`,
    );
  }
  const clashes = findClashes(ctx.events, ctx.now, new Date(tomorrowOf(ctx.now).getTime() + 86_400_000));
  if (clashes.length)
    sections.push(`Clashes (overlapping events):\n${clashes.map(([a, b]) => `- ${a.title} and ${b.title} overlap at ${formatTime(b.start)}${isSameDay(b.start, ctx.now) ? ' today' : ' tomorrow'}`).join('\n')}`);
  if (ctx.canvasDue) sections.push(`Due on Canvas this week: ${ctx.canvasDue}`);
  if (ctx.commute) sections.push(`Their commute (from the Commute widget; a typical-traffic estimate, not live): ${commuteLine(ctx.commute)}`);
  if (ctx.weather) {
    const w = ctx.weather;
    sections.push(`Weather in ${w.location}: ${w.condition}, ${w.temperatureF}°F now, high ${w.highF}°, low ${w.lowF}°, ${w.precipitationChance}% chance of rain.`);
  }
  if (ctx.carriedOver) {
    const w = ctx.carriedOver;
    sections.push(
      `Carried over from the wrap-up on ${w.date}:\n${w.carryOver.map((i) => `- ${i.title}`).join('\n') || '- nothing'}${w.note ? `\n${persons()} note to themselves: "${w.note}"` : ''}`,
    );
  }
  return sections.join('\n\n');
}
