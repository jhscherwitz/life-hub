// Logic for the smaller personal widgets: countdowns, the sticky note, tasks
// due soon, the month calendar and the quote of the day.

import { localIsoDate } from './time';
import type { Task } from './types';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_COUNTDOWNS = 8;
export const MAX_NOTE = 5000;

export interface Countdown {
  id: string;
  title: string;
  /** "YYYY-MM-DD". */
  date: string;
}

export interface Extras {
  countdowns: Countdown[];
  note: string;
}

export function emptyExtras(): Extras {
  return { countdowns: [], note: '' };
}

/** Cleans up saved countdowns: valid ids, titles and days only, at most eight. */
export function normalizeCountdowns(value: unknown): Countdown[] {
  if (!Array.isArray(value)) return [];
  const out: Countdown[] = [];
  for (const item of value) {
    const c = item as Partial<Countdown> | null;
    if (!c || typeof c.id !== 'string' || typeof c.title !== 'string' || typeof c.date !== 'string') continue;
    if (!ISO_DAY.test(c.date) || !c.title.trim() || out.some((o) => o.id === c.id)) continue;
    out.push({ id: c.id.slice(0, 64), title: c.title.trim().slice(0, 60), date: c.date });
  }
  return out.slice(0, MAX_COUNTDOWNS);
}

export function normalizeExtras(value: unknown): Extras {
  const v = (value ?? {}) as Partial<Extras>;
  return { countdowns: normalizeCountdowns(v.countdowns), note: typeof v.note === 'string' ? v.note.slice(0, MAX_NOTE) : '' };
}

/** Whole days from one "YYYY-MM-DD" to another. */
export function daysBetween(from: string, to: string): number {
  const utc = (d: string) => {
    const [y, m, day] = d.split('-').map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** "Today", "Tomorrow", "In 5 days", "Yesterday", "3 days ago". */
export function daysLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `In ${days} days` : `${-days} days ago`;
}

export interface CountdownView extends Countdown {
  days: number;
}

/** Soonest first; ones that have passed go to the end. */
export function sortCountdowns(list: Countdown[], today: string): CountdownView[] {
  return list
    .map((c) => ({ ...c, days: daysBetween(today, c.date) }))
    .sort((a, b) => (a.days < 0 ? 1 : 0) - (b.days < 0 ? 1 : 0) || Math.abs(a.days) - Math.abs(b.days));
}

export interface DueTask {
  task: Task;
  days: number;
}

/** Open tasks with a due date, soonest (or most overdue) first. */
export function dueSoon(tasks: Task[], now: Date): DueTask[] {
  const today = localIsoDate(now);
  return tasks
    .filter((t) => !t.done && t.due)
    .map((task) => ({ task, days: daysBetween(today, task.due!.slice(0, 10)) }))
    .sort((a, b) => a.days - b.days);
}

export interface MonthCell {
  /** "YYYY-MM-DD". */
  day: string;
  date: number;
  inMonth: boolean;
  isToday: boolean;
  /** Things on that day: tasks due and loaded calendar events. */
  count: number;
}

/** The month as weeks starting on Monday, six rows or fewer. */
export function monthGrid(now: Date, busyDays: string[]): MonthCell[][] {
  const today = localIsoDate(now);
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() + 6) % 7));
  const busy = new Map<string, number>();
  for (const d of busyDays) busy.set(d, (busy.get(d) ?? 0) + 1);
  const weeks: MonthCell[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: MonthCell[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i);
      const day = localIsoDate(d);
      week.push({ day, date: d.getDate(), inMonth: d.getMonth() === now.getMonth(), isToday: day === today, count: busy.get(day) ?? 0 });
    }
    // Stop once a week starts in the next month.
    if (w > 3 && !week[0].inMonth) break;
    weeks.push(week);
  }
  return weeks;
}

export interface Quote {
  text: string;
  by: string;
}

/** Short quotes, each with its real source. One a day, the same all day. */
export const QUOTES: Quote[] = [
  { text: 'The best way out is always through.', by: 'Robert Frost' },
  { text: 'Not all those who wander are lost.', by: 'J.R.R. Tolkien' },
  { text: 'The journey of a thousand miles begins with a single step.', by: 'Laozi' },
  { text: 'Fall seven times, stand up eight.', by: 'Japanese proverb' },
  { text: 'Do what you can, with what you have, where you are.', by: 'Theodore Roosevelt' },
  { text: 'Knowing is not enough; we must apply.', by: 'Johann Wolfgang von Goethe' },
  { text: 'We suffer more often in imagination than in reality.', by: 'Seneca' },
  { text: 'Waste no more time arguing what a good man should be. Be one.', by: 'Marcus Aurelius' },
  { text: 'What stands in the way becomes the way.', by: 'Marcus Aurelius' },
  { text: 'Ever tried. Ever failed. No matter. Try again. Fail again. Fail better.', by: 'Samuel Beckett' },
  { text: 'I am not afraid of storms, for I am learning how to sail my ship.', by: 'Louisa May Alcott' },
  { text: 'Nothing in life is to be feared, it is only to be understood.', by: 'Marie Curie' },
  { text: 'The first principle is that you must not fool yourself, and you are the easiest person to fool.', by: 'Richard Feynman' },
  { text: 'Inspiration is for amateurs. The rest of us just show up and get to work.', by: 'Chuck Close' },
  { text: 'You miss 100% of the shots you don’t take.', by: 'Wayne Gretzky' },
  { text: 'Make it work, make it right, make it fast.', by: 'Kent Beck' },
  { text: 'Real artists ship.', by: 'Steve Jobs' },
  { text: 'The only way to do great work is to love what you do.', by: 'Steve Jobs' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', by: 'Will Durant' },
  { text: 'Hope is the thing with feathers that perches in the soul.', by: 'Emily Dickinson' },
  { text: 'Rest is not idleness.', by: 'John Lubbock' },
  { text: 'Well begun is half done.', by: 'Aristotle' },
];

export function quoteOfDay(now: Date): Quote {
  const dayNumber = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
  return QUOTES[dayNumber % QUOTES.length];
}
