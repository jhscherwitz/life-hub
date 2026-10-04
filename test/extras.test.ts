import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ExtrasStore } from '../electron/extras';
import { QUOTES, daysBetween, daysLabel, dueSoon, monthGrid, normalizeCountdowns, quoteOfDay, sortCountdowns } from '../src/shared/extras';
import type { Task } from '../src/shared/types';

describe('countdowns', () => {
  it('cleans up saved countdowns', () => {
    expect(
      normalizeCountdowns([
        { id: 'a', title: ' Test ', date: '2026-10-20' },
        { id: 'a', title: 'dup', date: '2026-10-21' },
        { id: 'b', title: 'Bad date', date: 'soon' },
        { id: 'c', title: '  ', date: '2026-10-21' },
        null,
      ]),
    ).toEqual([{ id: 'a', title: 'Test', date: '2026-10-20' }]);
    expect(normalizeCountdowns('nope')).toEqual([]);
  });

  it('counts days, across months and clock changes', () => {
    expect(daysBetween('2026-10-03', '2026-10-03')).toBe(0);
    expect(daysBetween('2026-10-03', '2026-11-02')).toBe(30);
    expect(daysBetween('2026-10-03', '2026-10-01')).toBe(-2);
    expect(daysLabel(0)).toBe('Today');
    expect(daysLabel(1)).toBe('Tomorrow');
    expect(daysLabel(9)).toBe('In 9 days');
    expect(daysLabel(-3)).toBe('3 days ago');
  });

  it('puts the soonest first and passed ones last', () => {
    const sorted = sortCountdowns(
      [
        { id: 'trip', title: 'Trip', date: '2026-12-20' },
        { id: 'gone', title: 'Gone', date: '2026-10-01' },
        { id: 'test', title: 'Test', date: '2026-10-05' },
      ],
      '2026-10-03',
    );
    expect(sorted.map((c) => [c.id, c.days])).toEqual([
      ['test', 2],
      ['trip', 78],
      ['gone', -2],
    ]);
  });

  it('saves countdowns and the note', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-extras-'));
    const store = new ExtrasStore(path.join(dir, 'extras.json'));
    expect(store.get()).toEqual({ countdowns: [], note: '', groceries: [], commute: null, sports: ['nfl'] });
    store.setCountdowns([{ id: 'x', title: 'Exam', date: '2026-11-01' }]);
    store.setNote('buy milk');
    expect(new ExtrasStore(path.join(dir, 'extras.json')).get()).toEqual({ countdowns: [{ id: 'x', title: 'Exam', date: '2026-11-01' }], note: 'buy milk', groceries: [], commute: null, sports: ['nfl'] });
    expect(store.setNote(42).note).toBe('');
  });
});

describe('due soon, month and quote', () => {
  const task = (id: string, due?: string, done = false): Task => ({ id, title: id, done, due, source: 'builtin' }) as Task;

  it('lists open tasks with due dates, most urgent first', () => {
    const list = dueSoon(
      [task('later', '2026-10-09'), task('none'), task('late', '2026-10-01'), task('done', '2026-10-04', true), task('soon', '2026-10-04T23:00:00Z')],
      new Date(2026, 9, 3, 12),
    );
    expect(list.map((d) => [d.task.id, d.days])).toEqual([
      ['late', -2],
      ['soon', 1],
      ['later', 6],
    ]);
  });

  it('lays out the month in weeks from Monday, marking today and busy days', () => {
    const weeks = monthGrid(new Date(2026, 9, 3, 12), ['2026-10-05', '2026-10-05', '2026-10-20']);
    // October 2026 starts on a Thursday.
    expect(weeks[0].map((c) => c.date)).toEqual([28, 29, 30, 1, 2, 3, 4]);
    expect(weeks[0][5]).toMatchObject({ day: '2026-10-03', isToday: true, inMonth: true });
    expect(weeks[1][0]).toMatchObject({ day: '2026-10-05', count: 2 });
    expect(weeks).toHaveLength(5);
    expect(weeks.at(-1)!.at(-1)!.day).toBe('2026-11-01');
  });

  it('picks the same quote all day and a new one tomorrow', () => {
    const a = quoteOfDay(new Date(2026, 9, 3, 8));
    expect(quoteOfDay(new Date(2026, 9, 3, 22))).toEqual(a);
    expect(quoteOfDay(new Date(2026, 9, 4, 8))).not.toEqual(a);
    expect(QUOTES.every((q) => q.text && q.by)).toBe(true);
  });
});
