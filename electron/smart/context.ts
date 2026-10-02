import { formatTime, isSameDay } from '../../src/shared/time';
import type { CalendarEvent, Commute, EmailMessage, Task, Weather, WrapUp } from '../../src/shared/types';

/** Everything the briefing is written from. */
export interface DayContext {
  now: Date;
  /** Today's and tomorrow's events. */
  events: CalendarEvent[];
  emails: EmailMessage[];
  tasks: Task[];
  weather: Weather | null;
  commute: Commute | null;
  /** The last evening wrap-up, whose unfinished items carry into today. */
  carriedOver: WrapUp | null;
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

/** The day as plain text, for Claude to read. */
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
    `Open tasks:\n${open.map((t) => `- ${t.title}${t.due ? ` (due ${t.due.slice(0, 10)})` : ''}${t.priority ? `, ${t.priority} priority` : ''}`).join('\n') || '- none'}`,
  ];
  if (ctx.weather) {
    const w = ctx.weather;
    sections.push(`Weather in ${w.location}: ${w.condition}, ${w.temperatureF}°F now, high ${w.highF}°, low ${w.lowF}°, ${w.precipitationChance}% chance of rain.`);
  }
  if (ctx.commute?.leaveBy) {
    const c = ctx.commute;
    sections.push(`Travel: ${c.durationMinutes} min (${c.mode}) to ${c.destination} ${c.summary ?? ''}; leave by ${formatTime(c.leaveBy!)}.`);
  }
  if (ctx.carriedOver) {
    const w = ctx.carriedOver;
    sections.push(
      `Carried over from the wrap-up on ${w.date}:\n${w.carryOver.map((i) => `- ${i.title}`).join('\n') || '- nothing'}${w.note ? `\nJacob's note to himself: "${w.note}"` : ''}`,
    );
  }
  return sections.join('\n\n');
}
