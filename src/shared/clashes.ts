import type { CalendarEvent } from './types';

/**
 * Timed events that overlap each other between `from` and `to` (being in two
 * places at once). The same event showing on two calendars isn't a clash.
 */
export function findClashes(events: CalendarEvent[], from: Date, to: Date): [CalendarEvent, CalendarEvent][] {
  const timed = events
    .filter((e) => !e.allDay && Date.parse(e.end) > from.getTime() && Date.parse(e.start) < to.getTime())
    .sort((a, b) => a.start.localeCompare(b.start));
  const out: [CalendarEvent, CalendarEvent][] = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i];
      const b = timed[j];
      if (Date.parse(b.start) >= Date.parse(a.end)) break;
      if (a.title.trim().toLowerCase() === b.title.trim().toLowerCase() && a.start === b.start) continue;
      out.push([a, b]);
    }
  }
  return out;
}
