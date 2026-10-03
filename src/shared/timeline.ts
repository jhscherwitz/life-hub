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
