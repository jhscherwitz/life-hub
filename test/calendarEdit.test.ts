import { describe, expect, it, vi } from 'vitest';
import { runActions, undoAction, type ActionDeps } from '../electron/actions';
import { findClashes } from '../src/shared/clashes';
import type { CalendarEvent } from '../src/shared/types';

const ev = (title: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: title,
  title,
  start: new Date(start).toISOString(),
  end: new Date(end).toISOString(),
  ...extra,
});

describe('double-bookings', () => {
  it('finds overlapping timed events, not all-day ones or the same event twice', () => {
    const from = new Date('2026-10-05T00:00');
    const to = new Date('2026-10-06T00:00');
    const clashes = findClashes(
      [
        ev('Bio lab', '2026-10-05T14:00', '2026-10-05T16:00'),
        ev('Study group', '2026-10-05T15:30', '2026-10-05T17:00'),
        ev('Gym', '2026-10-05T17:00', '2026-10-05T18:00'),
        ev('Holiday', '2026-10-05T00:00', '2026-10-06T00:00', { allDay: true }),
        ev('Bio lab', '2026-10-05T14:00', '2026-10-05T16:00', { id: 'copy' }),
      ],
      from,
      to,
    );
    expect(clashes.map(([a, b]) => `${a.title} / ${b.title}`)).toEqual(['Bio lab / Study group', 'Bio lab / Study group']);
    expect(findClashes([ev('A', '2026-10-05T09:00', '2026-10-05T10:00'), ev('B', '2026-10-05T10:00', '2026-10-05T11:00')], from, to)).toEqual([]);
  });
});

describe('the AI changing the calendar', () => {
  const NOW = new Date('2026-10-05T12:00');
  const exam = ev('Chem exam', '2026-10-07T10:00', '2026-10-07T11:30', { ref: 'cal1|evt1' });
  const make = () => {
    const calendar = {
      canAdd: () => true,
      add: vi.fn(),
      remove: vi.fn(),
      find: vi.fn(async (name: string) => (name === 'cal1|evt1' || /chem/i.test(name) ? exam : null)),
      move: vi.fn(async () => ({ before: { start: { dateTime: exam.start }, end: { dateTime: exam.end } }, event: ev('Chem exam', '2026-10-08T10:00', '2026-10-08T11:30', { ref: 'cal1|evt1' }) })),
      setTimes: vi.fn(async () => undefined),
      cancel: vi.fn(async () => ({ calendarId: 'cal1', copy: { summary: 'Chem exam' }, title: 'Chem exam' })),
      restore: vi.fn(async () => undefined),
    };
    return { calendar, deps: { calendar } as unknown as ActionDeps };
  };

  it('moves an event by name, keeping its length, and Undo puts it back', async () => {
    const { calendar, deps } = make();
    const [r] = await runActions([{ type: 'move_event', title: 'chem exam', when: 'thursday 10am' }], deps, NOW);
    expect(r.ok).toBe(true);
    expect(calendar.move).toHaveBeenCalledWith('cal1|evt1', { date: '2026-10-08', time: '10:00', minutes: undefined });
    await undoAction(r.undo!, deps);
    expect(calendar.setTimes).toHaveBeenCalledWith('cal1|evt1', { start: { dateTime: exam.start }, end: { dateTime: exam.end } });
  });

  it('cancels an event and Undo puts it back; says so when it can’t find one', async () => {
    const { calendar, deps } = make();
    const [r, missing] = await runActions(
      [
        { type: 'cancel_event', title: 'cal1|evt1' },
        { type: 'cancel_event', title: 'dentist' },
      ],
      deps,
      NOW,
    );
    expect(r.ok).toBe(true);
    expect(calendar.cancel).toHaveBeenCalledWith('cal1|evt1');
    expect(missing.ok).toBe(false);
    await undoAction(r.undo!, deps);
    expect(calendar.restore).toHaveBeenCalledWith('cal1', { summary: 'Chem exam' });
  });
});
