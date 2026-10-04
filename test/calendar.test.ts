import { describe, expect, it } from 'vitest';
import { eventColor, eventsOn, isoDay, monthGrid, step, viewRange, viewTitle, weekOf } from '../src/shared/calendar';
import type { CalendarEvent } from '../src/shared/types';

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m, d, h, min);
const ev = (id: string, start: Date, end: Date, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, title: id, start: start.toISOString(), end: end.toISOString(), ...extra });

describe('calendar views', () => {
  it('shows six weeks for a month, starting on a Sunday', () => {
    const grid = monthGrid(2026, 9); // October 2026 starts on a Thursday.
    expect(grid).toHaveLength(42);
    expect(isoDay(grid[0])).toBe('2026-09-27');
    expect(grid[0].getDay()).toBe(0);
    expect(isoDay(grid[4])).toBe('2026-10-01');
    expect(isoDay(grid[41])).toBe('2026-11-07');
  });

  it('knows the week around a day and the range each view loads', () => {
    expect(weekOf(at(2026, 9, 14)).map(isoDay)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
    const month = viewRange('month', at(2026, 9, 14));
    expect([isoDay(month.start), isoDay(month.end)]).toEqual(['2026-09-27', '2026-11-08']);
    const day = viewRange('day', at(2026, 9, 14, 15));
    expect([isoDay(day.start), isoDay(day.end)]).toEqual(['2026-10-14', '2026-10-15']);
  });

  it('moves by a month, a week or a day, across year ends', () => {
    expect(isoDay(step('month', at(2026, 11, 20), 1))).toBe('2027-01-01');
    expect(isoDay(step('month', at(2026, 0, 31), -1))).toBe('2025-12-01');
    expect(isoDay(step('week', at(2026, 9, 30), 1))).toBe('2026-11-06');
    expect(isoDay(step('day', at(2026, 2, 1), -1))).toBe('2026-02-28');
  });

  it('titles each view', () => {
    expect(viewTitle('month', at(2026, 9, 4))).toBe('October 2026');
    expect(viewTitle('week', at(2026, 9, 14))).toBe('Oct 11 – 17, 2026');
    expect(viewTitle('week', at(2026, 9, 28))).toBe('Oct 25 – 31, 2026');
    expect(viewTitle('week', at(2026, 10, 2))).toBe('Nov 1 – 7, 2026');
    expect(viewTitle('week', at(2026, 9, 1))).toBe('Sep 27 – Oct 3, 2026');
    expect(viewTitle('week', at(2026, 11, 30))).toBe('Dec 27 – Jan 2, 2027');
    expect(viewTitle('day', at(2026, 9, 14))).toBe('Wednesday, October 14');
  });
});

describe('events on a day', () => {
  const events = [
    ev('late', at(2026, 9, 14, 23, 30), at(2026, 9, 15, 0, 30)),
    ev('lunch', at(2026, 9, 14, 12), at(2026, 9, 14, 13)),
    ev('break', at(2026, 9, 15), at(2026, 9, 18), { allDay: true }),
    ev('trip', at(2026, 9, 13, 18), at(2026, 9, 16, 9)),
  ];

  it('puts all-day and multi-day things first, then by time', () => {
    expect(eventsOn(events, at(2026, 9, 14)).map((e) => e.id)).toEqual(['trip', 'lunch', 'late']);
    expect(eventsOn(events, at(2026, 9, 15)).map((e) => e.id)).toEqual(['break', 'trip']);
  });

  it("doesn't count an all-day event on the day after it ends", () => {
    expect(eventsOn(events, at(2026, 9, 17)).map((e) => e.id)).toEqual(['break']);
    expect(eventsOn(events, at(2026, 9, 18)).map((e) => e.id)).toEqual([]);
  });

  it("uses the calendar's own colour, or a steady one from its name", () => {
    expect(eventColor(ev('a', at(2026, 0, 1), at(2026, 0, 1, 1), { color: '#7986cb' }))).toBe('#7986cb');
    const school = eventColor(ev('b', at(2026, 0, 1), at(2026, 0, 1, 1), { calendar: 'School' }));
    expect(school).toMatch(/^hsl\(/);
    expect(eventColor(ev('c', at(2026, 0, 2), at(2026, 0, 2, 1), { calendar: 'School' }))).toBe(school);
  });
});
