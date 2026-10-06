import type { CalendarEvent, EmailMessage, SourceStatus, Task } from './types';

// The AI's welcome screen: what to ask, built from the person's actual day
// instead of a fixed list. Pure, so it can be tested.

export interface ChatSuggestion {
  /** An icon name from the app's icon set. */
  icon: 'calendar' | 'mail' | 'tasks' | 'alert' | 'bolt' | 'grid' | 'sparkle';
  /** What's on the button. */
  text: string;
  /** The object it's about (a time, a count), shown small beside it. */
  hint?: string;
  /** What actually gets asked. */
  prompt: string;
}

export interface ChatDay {
  now: number;
  events: CalendarEvent[];
  emails: EmailMessage[];
  tasks: Task[];
  /** Canvas work not turned in: title, ISO due time and course. */
  canvasDue?: { title: string; due: string; course: string }[];
  failed?: SourceStatus[];
}

const HOUR = 3_600_000;

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function dayWord(iso: string, now: number): string {
  const d = new Date(iso);
  const today = new Date(now);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(now + 24 * HOUR);
  if (sameDay(d, today)) return 'today';
  if (sameDay(d, tomorrow)) return 'tomorrow';
  return d.toLocaleDateString([], { weekday: 'long' });
}

/** The things this day's AI could help with first, most useful first. */
export function daySuggestions(day: ChatDay): ChatSuggestion[] {
  const out: ChatSuggestion[] = [];
  const { now } = day;

  // The next thing on the calendar that hasn't started, within the next 12 hours.
  const next = day.events
    .filter((e) => !e.allDay && new Date(e.start).getTime() > now && new Date(e.start).getTime() - now < 12 * HOUR)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
  if (next) {
    out.push({
      icon: 'calendar',
      text: `Help me get ready for ${next.title}`,
      hint: clock(next.start),
      prompt: `Help me get ready for "${next.title}" at ${clock(next.start)}${next.location ? ` (${next.location})` : ''}. What should I bring or do first?`,
    });
  }

  const waiting = day.emails.filter((e) => e.needsReply);
  if (waiting.length > 0) {
    out.push({
      icon: 'mail',
      text: waiting.length === 1 ? `${waiting[0].from.name || waiting[0].from.email} is waiting on a reply` : `${waiting.length} people are waiting on a reply`,
      hint: waiting.length === 1 ? undefined : `${waiting.length} emails`,
      prompt: "Who's waiting on a reply from me? Draft replies for the most urgent ones.",
    });
  }

  // Work due within two days: Canvas first (it has a real deadline), then tasks.
  const soon = [
    ...(day.canvasDue ?? []).map((c) => ({ title: c.title, due: c.due, detail: c.course })),
    ...day.tasks.filter((t) => !t.done && t.due).map((t) => ({ title: t.title, due: t.due!.length <= 10 ? `${t.due}T23:59:00` : t.due!, detail: t.project ?? '' })),
  ]
    .filter((x) => {
      const ms = new Date(x.due).getTime() - now;
      return Number.isFinite(ms) && ms < 48 * HOUR;
    })
    .sort((a, b) => a.due.localeCompare(b.due))[0];
  if (soon) {
    const late = new Date(soon.due).getTime() < now;
    out.push({
      icon: 'tasks',
      text: late ? `${soon.title} is overdue` : `Plan how to finish ${soon.title}`,
      hint: late ? undefined : `due ${dayWord(soon.due, now)}`,
      prompt: `Make me a short plan to ${late ? 'catch up on' : 'finish'} "${soon.title}"${soon.detail ? ` (${soon.detail})` : ''} ${late ? 'as soon as I can' : 'before it is due'}.`,
    });
  }

  const broken = (day.failed ?? []).find((s) => !s.ok);
  if (broken) {
    out.push({
      icon: 'alert',
      text: `Why didn't ${broken.name} load?`,
      prompt: `${broken.name} didn't load on my dashboard${broken.error ? ` (${broken.error})` : ''}. What's wrong and how do I fix it?`,
    });
  }

  // Always something to try, so the screen is never empty of ideas.
  const spare: ChatSuggestion[] = [
    { icon: 'calendar', text: "What's my day look like?", prompt: "What's my day look like?" },
    { icon: 'grid', text: 'Put the most important widgets first', prompt: 'Rearrange my dashboard so the most important widgets come first.' },
    { icon: 'bolt', text: 'Remind me to stretch at 3pm', prompt: 'Remind me to stretch at 3pm.' },
  ];
  for (const s of spare) if (out.length < 3 && !out.some((o) => o.text === s.text)) out.push(s);
  return out.slice(0, 3);
}

/** One line under the greeting that says what the day holds. */
export function dayLine(day: ChatDay): string {
  const { now } = day;
  const today = new Date(now).toDateString();
  const left = day.events.filter((e) => !e.allDay && new Date(e.start).toDateString() === today && new Date(e.end).getTime() > now).length;
  const waiting = day.emails.filter((e) => e.needsReply).length;
  const parts: string[] = [];
  if (left > 0) parts.push(`${left} ${left === 1 ? 'meeting' : 'meetings'} left today`);
  if (waiting > 0) parts.push(`${waiting} ${waiting === 1 ? 'reply' : 'replies'} waiting`);
  return parts.length > 0 ? `${parts.join(' and ')}.` : 'Nothing pressing right now. Ask me anything.';
}
