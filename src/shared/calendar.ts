// Date maths for the Calendar page's month, week and day views.
import type { CalendarEvent } from './types';

export type CalendarView = 'month' | 'week' | 'day';

const DAY_MS = 86_400_000;

/** Midnight at the start of a day, local time. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "2026-10-04", local time. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The six weeks shown for a month, starting on Sunday. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Sunday to Saturday around a day. */
export function weekOf(d: Date): Date[] {
  const start = addDays(startOfDay(d), -d.getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The stretch of time a view covers, for loading its events. */
export function viewRange(view: CalendarView, focus: Date): { start: Date; end: Date } {
  if (view === 'month') {
    const grid = monthGrid(focus.getFullYear(), focus.getMonth());
    return { start: grid[0], end: addDays(grid[41], 1) };
  }
  if (view === 'week') {
    const week = weekOf(focus);
    return { start: week[0], end: addDays(week[6], 1) };
  }
  return { start: startOfDay(focus), end: addDays(startOfDay(focus), 1) };
}

/** The day a view moves to with ‹ and ›. */
export function step(view: CalendarView, focus: Date, by: -1 | 1): Date {
  if (view === 'month') return new Date(focus.getFullYear(), focus.getMonth() + by, 1);
  return addDays(focus, by * (view === 'week' ? 7 : 1));
}

/** "October 2026", "Oct 4 – 10, 2026", "Sunday, October 4". */
export function viewTitle(view: CalendarView, focus: Date): string {
  if (view === 'month') return focus.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (view === 'day') return focus.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const [a, , , , , , b] = weekOf(focus);
  const sameMonth = a.getMonth() === b.getMonth();
  const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const right = b.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
  return `${left} – ${right}, ${b.getFullYear()}`;
}

/**
 * Events on a day: timed ones that start that day, and all-day or multi-day
 * ones that cover it (an all-day event's end is the next midnight, so it
 * doesn't count that day). All-day first, then by start time.
 */
export function eventsOn(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const start = startOfDay(day).getTime();
  const end = start + DAY_MS;
  return events
    .filter((e) => {
      const s = new Date(e.start).getTime();
      const f = new Date(e.end).getTime();
      if (e.allDay || f - s >= DAY_MS) return s < end && f > start;
      return s >= start && s < end;
    })
    .sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start.localeCompare(b.start));
}

/** A colour for an event: its Google Calendar colour, or one picked from the calendar's name. */
export function eventColor(e: CalendarEvent): string {
  if (e.color) return e.color;
  const name = e.calendar ?? '';
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${(hash + 250) % 360} 70% 66%)`;
}
