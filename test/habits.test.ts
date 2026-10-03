import { describe, expect, it } from 'vitest';
import {
  MAX_HABITS,
  addHabit,
  defaultHabits,
  habitsView,
  normalizeHabits,
  removeHabit,
  renameHabit,
  shiftDay,
  starMap,
  streak,
  toggleHabit,
  type HabitState,
} from '../src/shared/habits';

const TODAY = '2026-10-03';
const base = (): HabitState => ({ habits: [{ id: 'a', title: 'Water' }, { id: 'b', title: 'Read' }], days: {} });

describe('daily tasks', () => {
  it('moves across months and years', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('falls back to the starter list for bad data and cleans up the rest', () => {
    expect(normalizeHabits(null)).toEqual(defaultHabits());
    const clean = normalizeHabits({ habits: [{ id: 'a', title: ' Hi ' }, { id: 'a', title: 'dup' }, { id: 'b' }], days: { nope: ['a'], [TODAY]: ['a', 'a', 3] } });
    expect(clean).toEqual({ habits: [{ id: 'a', title: 'Hi' }], days: { [TODAY]: ['a'] } });
  });

  it('ticks and unticks for today only', () => {
    const on = toggleHabit(base(), 'a', TODAY);
    expect(on.days[TODAY]).toEqual(['a']);
    expect(toggleHabit(on, 'a', TODAY).days[TODAY]).toBeUndefined();
    expect(toggleHabit(base(), 'zzz', TODAY)).toEqual(base());
  });

  it('forgets days older than two months', () => {
    const old = { ...base(), days: { '2026-01-01': ['a'] } };
    expect(toggleHabit(old, 'a', TODAY).days['2026-01-01']).toBeUndefined();
  });

  it('adds, renames and removes, with limits', () => {
    let s = addHabit(base(), '  Stretch ', 'c');
    expect(s.habits.at(-1)).toEqual({ id: 'c', title: 'Stretch' });
    expect(addHabit(s, '   ', 'd')).toBe(s);
    s = renameHabit(s, 'c', 'Stretch 5 min');
    expect(s.habits.at(-1)?.title).toBe('Stretch 5 min');
    s = toggleHabit(s, 'c', TODAY);
    s = removeHabit(s, 'c');
    expect(s.habits.map((h) => h.id)).toEqual(['a', 'b']);
    expect(s.days[TODAY]).toEqual([]);
    let full = base();
    for (let i = 0; i < 20; i++) full = addHabit(full, `t${i}`, `t${i}`);
    expect(full.habits).toHaveLength(MAX_HABITS);
  });

  it("counts streaks, keeping yesterday's alive until today is ticked", () => {
    const s = { ...base(), days: { [shiftDay(TODAY, -2)]: ['a'], [shiftDay(TODAY, -1)]: ['a'], [shiftDay(TODAY, -4)]: ['a'] } };
    expect(streak(s, 'a', TODAY)).toBe(2);
    expect(streak(toggleHabit(s, 'a', TODAY), 'a', TODAY)).toBe(3);
    expect(streak(s, 'b', TODAY)).toBe(0);
  });

  it('places the same stars every time, inside the sky and apart', () => {
    const ids = ['water', 'move', 'read', 'outside', 'phone'];
    const stars = starMap(ids);
    expect(starMap(ids)).toEqual(stars);
    for (const s of stars) {
      expect(s.x).toBeGreaterThan(0);
      expect(s.x).toBeLessThan(100);
      expect(s.y).toBeGreaterThan(0);
      expect(s.y).toBeLessThan(100);
    }
    expect(stars.map((s) => s.x)).toEqual([...stars.map((s) => s.x)].sort((a, b) => a - b));
  });

  it('builds the view: week strip, lit lines and perfect days', () => {
    let s = base();
    s = toggleHabit(s, 'a', shiftDay(TODAY, -1));
    s = toggleHabit(s, 'b', shiftDay(TODAY, -1));
    s = toggleHabit(s, 'a', TODAY);
    const v = habitsView(s, TODAY);
    expect(v.done).toBe(1);
    expect(v.total).toBe(2);
    expect(v.habits[0].week).toEqual([false, false, false, false, false, true, true]);
    expect(v.links).toEqual([{ from: 'a', to: 'b', lit: false }]);
    expect(v.perfectStreak).toBe(1);
    const all = habitsView(toggleHabit(s, 'b', TODAY), TODAY);
    expect(all.links[0].lit).toBe(true);
    expect(all.perfectStreak).toBe(2);
  });
});
