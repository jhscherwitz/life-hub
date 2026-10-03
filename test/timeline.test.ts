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
