import { describe, expect, it } from 'vitest';
import { chipRows, dayTimeline, shortHour } from '../src/shared/timeline';
import type { CalendarEvent } from '../src/shared/types';

function at(h: number, m = 0, dayOffset = 0): Date {
  return new Date(2026, 9, 3 + dayOffset, h, m, 0, 0);
}

function ev(id: string, start: Date, end: Date, extra: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id, title: id, start: start.toISOString(), end: end.toISOString(), ...extra };
}

describe('dayTimeline', () => {
  it('covers 8 AM to 8 PM on a quiet day and places now on the strip', () => {
    const t = dayTimeline([], at(14).getTime());
    expect(t.start).toBe(at(8).getTime());
    expect(t.end).toBe(at(20).getTime());
    expect(t.items).toEqual([]);
    expect(t.lanes).toBe(1);
    expect(t.nowAt).toBe(50);
    expect(t.ticks.map((x) => x.hour)).toEqual([8, 10, 12, 14, 16, 18, 20]);
  });

  it('stretches to fit early and late events, rounded out to the hour', () => {
    const t = dayTimeline([ev('early', at(6, 30), at(7)), ev('late', at(21, 15), at(22, 10))], at(12).getTime());
    expect(t.start).toBe(at(6).getTime());
    expect(t.end).toBe(at(23).getTime());
  });

  it('marks past, current and upcoming events and puts overlaps in separate lanes', () => {
    const t = dayTimeline(
      [
        ev('standup', at(9, 30), at(9, 45)),
        ev('sync', at(12, 15), at(12, 45)),
        ev('lunch', at(12, 30), at(13, 30)),
        ev('review', at(14), at(14, 45)),
      ],
      at(12, 20).getTime(),
    );
    const byId = Object.fromEntries(t.items.map((i) => [i.event.id, i]));
    expect(byId.standup.state).toBe('past');
    expect(byId.sync.state).toBe('current');
    expect(byId.lunch.state).toBe('upcoming');
    expect(byId.sync.lane).toBe(0);
    expect(byId.lunch.lane).toBe(1);
    // A free lane gets reused once the overlap is over.
    expect(byId.review.lane).toBe(0);
    expect(t.lanes).toBe(2);
    expect(byId.standup.left).toBeCloseTo((1.5 / 12) * 100);
    expect(byId.standup.width).toBeCloseTo((0.25 / 12) * 100);
  });

  it('leaves out all-day events and other days, and hides now when it is off the strip', () => {
    const t = dayTimeline(
      [ev('holiday', at(0), at(0, 0, 1), { allDay: true }), ev('tomorrow', at(9, 0, 1), at(10, 0, 1))],
      at(23, 30).getTime(),
    );
    expect(t.items).toEqual([]);
    expect(t.nowAt).toBeNull();
  });
});

describe('shortHour', () => {
  it('writes compact hour labels', () => {
    expect([0, 8, 12, 15, 23].map(shortHour)).toEqual(['12a', '8a', '12p', '3p', '11p']);
  });
});

describe('chipRows', () => {
  it('stacks chips whose labels would overlap and reuses free rows', () => {
    const t = dayTimeline(
      [ev('a', at(9), at(9, 15)), ev('b', at(9, 30), at(10)), ev('c', at(12), at(13)), ev('d', at(12, 15), at(12, 45))],
      at(11).getTime(),
    );
    // Chips are 20% wide: 9:00 and 9:30 collide, 12:00 is clear of both, 12:15 collides with 12:00.
    expect(chipRows(t.items, [20, 20, 20, 20])).toEqual([0, 1, 0, 1]);
    // A short label leaves room for the next chip in the same row.
    expect(chipRows(t.items, [3, 20, 20, 20])).toEqual([0, 0, 0, 1]);
  });
});

describe('day strip', () => {
  const day = (h: number, m = 0) => new Date(2026, 9, 4, h, m).toISOString();
  const ev = (id: string, title: string, s: string, e: string) => ({ id, title, start: s, end: e });

  it('fits the strip to what is on it, not a fixed 9 to midnight', async () => {
    const { dayStrip } = await import('../src/shared/timeline');
    const now = new Date(2026, 9, 4, 3, 15).getTime();
    const strip = dayStrip([ev('v', 'Visit', day(13), day(14)), ev('x', 'DUE: Test', day(23, 29), day(23, 29))], now);
    expect(new Date(strip.start).getHours()).toBe(12);
    expect(new Date(strip.end).getHours()).toBe(0); // midnight
    expect(strip.nowAt).toBeNull();
    expect(strip.ticks.length).toBeLessThanOrEqual(8);
  });

  it('groups deadlines at the same minute into one flag', async () => {
    const { dayStrip } = await import('../src/shared/timeline');
    const now = new Date(2026, 9, 4, 12).getTime();
    const strip = dayStrip(
      [ev('x', 'DUE: Archaeology Test 2', day(23, 29), day(23, 29)), ev('y', 'DONE: Quiz', day(23, 29), day(23, 29)), ev('z', 'Reading', day(23, 29), day(23, 29))],
      now,
    );
    expect(strip.items).toHaveLength(1);
    expect(strip.items[0]).toMatchObject({ kind: 'due', title: 'Archaeology Test 2', more: ['Quiz', 'Reading'] });
  });

  it('shows events as bars as long as they last, with now on the strip when close', async () => {
    const { dayStrip } = await import('../src/shared/timeline');
    const now = new Date(2026, 9, 4, 9, 30).getTime();
    const strip = dayStrip([ev('a', 'Class', day(10), day(12))], now);
    const [bar] = strip.items;
    expect(bar.kind).toBe('event');
    expect(bar.width).toBeGreaterThan(20);
    expect(strip.nowAt).not.toBeNull();
    expect(new Date(strip.end).getTime() - strip.start).toBeGreaterThanOrEqual(6 * 3600_000);
  });

  it('keeps labels inside the strip and off each other', async () => {
    const { stripRows } = await import('../src/shared/timeline');
    const item = (left: number, width = 2) => ({ key: String(left), kind: 'event' as const, title: '', more: [], start: 0, end: 0, left, width, state: 'upcoming' as const });
    const rows = stripRows([item(10), item(12), item(98)], [20, 20, 20]);
    expect(rows[0]).toEqual({ row: 0, left: 10 });
    expect(rows[1].row).toBe(1);
    expect(rows[2].left).toBe(80); // pulled back so its label fits
  });
});
