import { formatTime, isSameDay } from '../../src/shared/time';
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
}

export function tomorrowOf(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return d;
}

function eventLine(e: CalendarEvent): string {
  const when = e.allDay ? 'all day' : `${formatTime(e.start)}–${formatTime(e.end)}`;
  const where = [e.location, e.meetingUrl ? 'video call' : ''].filter(Boolean).join(', ');
  return `- ${when}: ${e.title}${where ? ` (${where})` : ''}`;
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
    `Open tasks:\n${open.map((t) => `- ${t.title}${t.due ? ` (due ${t.due.slice(0, 10)})` : ''}${t.priority ? `, ${t.priority} priority` : ''}`).join('\n') || '- none'}`,
  ];
  if (ctx.plans?.length) {
    sections.push(
      `Plans found in email (not on the calendar):\n${ctx.plans
        .slice(0, 12)
        .map((p) => `- ${p.date}${p.time ? ` ${p.time}` : ''}: ${p.title} (${p.kind}, from ${p.from})`)
        .join('\n')}`,
    );
  }
  if (ctx.weather) {
    const w = ctx.weather;
    sections.push(`Weather in ${w.location}: ${w.condition}, ${w.temperatureF}°F now, high ${w.highF}°, low ${w.lowF}°, ${w.precipitationChance}% chance of rain.`);
  }
  if (ctx.carriedOver) {
    const w = ctx.carriedOver;
    sections.push(
      `Carried over from the wrap-up on ${w.date}:\n${w.carryOver.map((i) => `- ${i.title}`).join('\n') || '- nothing'}${w.note ? `\nJacob's note to himself: "${w.note}"` : ''}`,
    );
  }
  return sections.join('\n\n');
}
