import { describe, expect, it } from 'vitest';
import { dueValue, parseWhen, whenLabel } from '../src/shared/when';

// Saturday 3 October 2026, 10:00 in the morning.
const NOW = new Date(2026, 9, 3, 10, 0);
const p = (text: string) => parseWhen(text, NOW);

describe('type it like you say it', () => {
  it('reads weekdays and times', () => {
    expect(p('chem quiz friday 3pm')).toEqual({ title: 'Chem quiz', date: '2026-10-09', time: '15:00', remind: false });
    expect(p('Essay due next tues at 11:59pm')).toEqual({ title: 'Essay', date: '2026-10-06', time: '23:59', remind: false });
    expect(p('gym on sat')).toMatchObject({ title: 'Gym', date: '2026-10-03' });
    expect(p('next sat party')).toMatchObject({ title: 'Party', date: '2026-10-10' });
  });

  it('reads today, tonight, tomorrow and slang', () => {
    expect(p('lunch with sam tmrw')).toEqual({ title: 'Lunch with sam', date: '2026-10-04', remind: false });
    expect(p('call mom tonight')).toEqual({ title: 'Call mom', date: '2026-10-03', time: '20:00', remind: false });
    expect(p('pay rent day after tomorrow')).toMatchObject({ title: 'Pay rent', date: '2026-10-05' });
    expect(p('laundry this weekend')).toMatchObject({ title: 'Laundry', date: '2026-10-03' });
  });

  it('reads "in" amounts', () => {
    expect(p('stretch in 20 minutes')).toEqual({ title: 'Stretch', date: '2026-10-03', time: '10:20', remind: false });
    expect(p('check oven in an hour')).toMatchObject({ date: '2026-10-03', time: '11:00' });
    expect(p('essay in 2 weeks')).toMatchObject({ title: 'Essay', date: '2026-10-17' });
    expect(p('dentist in 3 days')).toMatchObject({ date: '2026-10-06' });
  });

  it('reads dates written different ways, rolling into next year when needed', () => {
    expect(p('mom birthday nov 12')).toMatchObject({ title: 'Mom birthday', date: '2026-11-12' });
    expect(p('trip on the 20th')).toMatchObject({ date: '2026-10-20' });
    expect(p('project 12th of december')).toMatchObject({ date: '2026-12-12' });
    expect(p('flight 1/15')).toMatchObject({ title: 'Flight', date: '2027-01-15' });
    expect(p('renew license 3/2/2027')).toMatchObject({ date: '2027-03-02' });
    expect(p('2026-11-12 3pm')).toEqual({ title: '', date: '2026-11-12', time: '15:00', remind: false });
  });

  it('puts a time with no day on its next turn', () => {
    expect(p('meeting at 3')).toMatchObject({ title: 'Meeting', date: '2026-10-03', time: '15:00' });
    expect(p('alarm 7am')).toMatchObject({ date: '2026-10-04', time: '07:00' });
    expect(p('standup 9:30am')).toMatchObject({ date: '2026-10-04', time: '09:30' });
    expect(p('pickup at noon')).toMatchObject({ date: '2026-10-03', time: '12:00' });
  });

  it('spots reminders', () => {
    expect(p('remind me to call mom at 6pm')).toEqual({ title: 'Call mom', date: '2026-10-03', time: '18:00', remind: true });
    expect(p('Remind me about the test tomorrow morning')).toEqual({ title: 'The test', date: '2026-10-04', time: '09:00', remind: true });
  });

  it('leaves ordinary words alone', () => {
    expect(p('SAT prep book')).toEqual({ title: 'SAT prep book', remind: false });
    expect(p('buy sun cream')).toEqual({ title: 'Buy sun cream', remind: false });
    expect(p('read 3 chapters')).toEqual({ title: 'Read 3 chapters', remind: false });
    expect(p('may the force')).toEqual({ title: 'May the force', remind: false });
  });

  it('writes due values and friendly labels', () => {
    expect(dueValue({ date: '2026-10-09', time: '15:00' })).toBe('2026-10-09T15:00');
    expect(dueValue({ date: '2026-10-09' })).toBe('2026-10-09');
    expect(dueValue({})).toBeUndefined();
    expect(whenLabel('2026-10-03', NOW)).toBe('Today');
    expect(whenLabel('2026-10-04', NOW)).toBe('Tomorrow');
    expect(whenLabel('2026-10-03T15:00', NOW)).toMatch(/^Today 3:00\s?PM$/);
  });
});
