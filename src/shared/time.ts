import type { CalendarEvent } from './types';

/** The event happening right now (the one that started most recently), if any. */
export function currentEvent(events: CalendarEvent[], now = Date.now()): CalendarEvent | undefined {
  return events
    .filter((e) => !e.allDay && new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now)
    .sort((a, b) => b.start.localeCompare(a.start))[0];
}

/** The next event that hasn't started yet. */
export function nextEvent(events: CalendarEvent[], now = Date.now()): CalendarEvent | undefined {
  return events
    .filter((e) => !e.allDay && new Date(e.start).getTime() > now)
    .sort((a, b) => a.start.localeCompare(b.start))[0];
}

/** "now", "5m", "1h 20m", "3h". */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  if (totalMin < 1) return 'now';
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function isSameDay(iso: string, day = new Date()): boolean {
  const d = new Date(iso);
  return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
}

/** Short text for the tray, e.g. "Product sync in 25m". */
export function trayLabel(events: CalendarEvent[], now = Date.now()): string {
  const next = nextEvent(events.filter((e) => isSameDay(e.start, new Date(now))), now);
  if (!next) return 'No more meetings today';
  const title = next.title.length > 24 ? `${next.title.slice(0, 23)}…` : next.title;
  return `${title} in ${formatDuration(new Date(next.start).getTime() - now)}`;
}

/** Local calendar date as YYYY-MM-DD. */
export function localIsoDate(d = new Date()): string {
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}
