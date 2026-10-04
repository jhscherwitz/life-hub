import { isSameDay } from './time';
import type { CalendarEvent } from './types';

const HOUR_MS = 60 * 60_000;
/** The strip always covers at least this much of the day, so a quiet day still reads as a day. */
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;

export interface TimelineItem {
  event: CalendarEvent;
  /** Left edge and width, as percentages of the strip. */
  left: number;
  width: number;
  /** Row to draw it in, so overlapping events don't cover each other. */
  lane: number;
  state: 'past' | 'current' | 'upcoming';
}

export interface DayTimeline {
  start: number;
  end: number;
  items: TimelineItem[];
  lanes: number;
  /** Where "now" sits on the strip (percent), or null when it's outside the strip. */
  nowAt: number | null;
  /** Hour marks to label, with their position (percent). */
  ticks: { at: number; hour: number }[];
}

/**
 * Lays today's timed events out on a horizontal strip: from 8 AM to 8 PM,
 * stretched to fit anything earlier or later, with overlapping events put in
 * separate lanes.
 */
export function dayTimeline(events: CalendarEvent[], now: number): DayTimeline {
  const day = new Date(now);
  const today = events
    .filter((e) => !e.allDay && isSameDay(e.start, day))
    .sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));

  const atHour = (h: number) => {
    const d = new Date(now);
    d.setHours(h, 0, 0, 0);
    return d.getTime();
  };
  const midnight = atHour(24);
  let start = atHour(DEFAULT_START_HOUR);
  let end = atHour(DEFAULT_END_HOUR);
  for (const e of today) {
    start = Math.min(start, floorHour(new Date(e.start).getTime()));
    end = Math.max(end, Math.min(midnight, ceilHour(new Date(e.end).getTime())));
  }
  const span = end - start;
  const pct = (t: number) => ((Math.min(Math.max(t, start), end) - start) / span) * 100;

  // Greedy lanes: each event goes in the first lane that's free by its start.
  const laneEnds: number[] = [];
  const items = today.map((event): TimelineItem => {
    const s = new Date(event.start).getTime();
    const e = new Date(event.end).getTime();
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= s);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = e;
    return {
      event,
      left: pct(s),
      width: Math.max(pct(e) - pct(s), 0.5),
      lane,
      state: e <= now ? 'past' : s <= now ? 'current' : 'upcoming',
    };
  });

  // Label every 2 hours, or every 3 when the strip is long.
  const hours = span / HOUR_MS;
  const step = hours > 14 ? 3 : 2;
  const ticks: DayTimeline['ticks'] = [];
  for (let t = start; t <= end; t += HOUR_MS) {
    const hour = new Date(t).getHours();
    if (hour % step === 0) ticks.push({ at: pct(t), hour });
  }

  return {
    start,
    end,
    items,
    lanes: Math.max(1, laneEnds.length),
    nowAt: now >= start && now <= end ? pct(now) : null,
    ticks,
  };
}

function floorHour(t: number): number {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

function ceilHour(t: number): number {
  const floored = floorHour(t);
  return floored === t ? t : floored + HOUR_MS;
}

/** "8a", "12p", "3p": short enough to sit under the strip. */
export function shortHour(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${hour < 12 ? 'a' : 'p'}`;
}

/**
 * Rows for timeline chips. A chip sits at its event's start and is usually
 * wider than the meeting, so chips are spaced by how much room each label
 * takes (`widths`, as percents of the strip), not by the meeting's length.
 */
export function chipRows(items: TimelineItem[], widths: number[]): number[] {
  const rowEnds: number[] = [];
  return items.map((item, i) => {
    let row = rowEnds.findIndex((end) => end <= item.left);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = item.left + widths[i];
    return row;
  });
}

// ---- The day strip: the timeline widget's layout ----

/** One thing on the strip: a timed event (a bar), or deadlines at one time (a flag). */
export interface StripItem {
  key: string;
  kind: 'event' | 'due' | 'plan';
  title: string;
  /** For a group of deadlines at the same time, the others' titles. */
  more: string[];
  start: number;
  end: number;
  color?: string;
  /** Left edge and width as percents of the strip. A deadline has no width. */
  left: number;
  width: number;
  state: 'past' | 'current' | 'upcoming';
}

export interface DayStrip {
  start: number;
  end: number;
  items: StripItem[];
  /** Where now is (percent), or null when it's off the strip. */
  nowAt: number | null;
  ticks: { at: number; hour: number }[];
}

/** A deadline: a calendar entry with no length (Canvas "due" items), or one that says it's due. */
export function isDeadline(e: { title: string; start: string; end: string }): boolean {
  return new Date(e.end).getTime() - new Date(e.start).getTime() < 60_000 || /^due\b|\bdue:/i.test(e.title);
}

/**
 * Today on a strip that fits what's on it: from an hour before the first
 * thing to an hour after the last (at least six hours, never past midnight),
 * reaching back to include now when it's close. Deadlines at the same minute
 * share one flag.
 */
export function dayStrip(events: CalendarEvent[], now: number, plans: { id: string; title: string; at: number }[] = []): DayStrip {
  const day = new Date(now);
  const atHour = (h: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h).getTime();
  const dayStart = atHour(0);
  const midnight = atHour(24);
  const timed = events.filter((e) => !e.allDay && isSameDay(e.start, day)).sort((a, b) => a.start.localeCompare(b.start));
  const todaysPlans = plans.filter((p) => p.at >= dayStart && p.at < midnight);

  const times = [...timed.flatMap((e) => [new Date(e.start).getTime(), new Date(e.end).getTime()]), ...todaysPlans.map((p) => p.at)];
  let start: number;
  let end: number;
  if (times.length) {
    start = floorHour(Math.min(...times)) - HOUR_MS;
    end = Math.min(midnight, ceilHour(Math.max(...times)) + HOUR_MS);
    // Show now too when it's within three hours of the strip.
    if (now < start && start - now <= 3 * HOUR_MS) start = floorHour(now);
    if (now > end && now - end <= 3 * HOUR_MS) end = Math.min(midnight, ceilHour(now));
  } else {
    start = floorHour(now) - HOUR_MS;
    end = start + 9 * HOUR_MS;
  }
  // At least six hours, kept inside today.
  if (end - start < 6 * HOUR_MS) end = start + 6 * HOUR_MS;
  if (end > midnight) {
    start -= end - midnight;
    end = midnight;
  }
  start = Math.max(start, dayStart);
  const span = end - start;
  const pct = (t: number) => ((Math.min(Math.max(t, start), end) - start) / span) * 100;
  const state = (s: number, e: number): StripItem['state'] => (e <= now ? 'past' : s <= now ? 'current' : 'upcoming');

  const items: StripItem[] = [];
  const dues = new Map<number, StripItem>();
  for (const e of timed) {
    const s = new Date(e.start).getTime();
    const f = new Date(e.end).getTime();
    if (isDeadline(e)) {
      const minute = Math.floor(s / 60_000);
      const title = e.title.replace(/^(due|done)\s*:\s*/i, '');
      const group = dues.get(minute);
      if (group) group.more.push(title);
      else {
        const item: StripItem = { key: e.id, kind: 'due', title, more: [], start: s, end: s, color: e.color, left: pct(s), width: 0, state: s <= now ? 'past' : 'upcoming' };
        dues.set(minute, item);
        items.push(item);
      }
      continue;
    }
    items.push({ key: e.id, kind: 'event', title: e.title, more: [], start: s, end: f, color: e.color, left: pct(s), width: Math.max(pct(f) - pct(s), 0), state: state(s, f) });
  }
  for (const p of todaysPlans) {
    items.push({ key: p.id, kind: 'plan', title: p.title, more: [], start: p.at, end: p.at + HOUR_MS, left: pct(p.at), width: pct(p.at + HOUR_MS) - pct(p.at), state: state(p.at, p.at + HOUR_MS) });
  }
  items.sort((a, b) => a.start - b.start);

  // Few enough hour labels to read: every 1, 2, 3, 4 or 6 hours.
  const hours = span / HOUR_MS;
  const step = [1, 2, 3, 4, 6].find((s) => hours / s <= 7) ?? 6;
  const ticks: DayStrip['ticks'] = [];
  for (let t = ceilHour(start); t <= end; t += HOUR_MS) {
    const hour = new Date(t).getHours();
    if (hour % step === 0) ticks.push({ at: pct(t), hour });
  }
  return { start, end, items, nowAt: now >= start && now <= end ? pct(now) : null, ticks };
}

/**
 * Rows for the strip, so labels never cover each other. Each item takes the
 * room of its bar or its label, whichever is wider (`widths`, percents), and
 * labels near the right edge are drawn ending at their item instead.
 */
export function stripRows(items: StripItem[], widths: number[]): { row: number; left: number }[] {
  const rowEnds: number[] = [];
  return items.map((item, i) => {
    const room = Math.max(item.width, widths[i]);
    const left = Math.max(0, Math.min(item.left, 100 - room));
    let row = rowEnds.findIndex((end) => end <= left);
    if (row === -1) row = rowEnds.length;
    rowEnds[row] = left + room + 0.8;
    return { row, left };
  });
}
