import { describe, expect, it, vi } from 'vitest';
import { runActions, undoAction, type ActionDeps } from '../electron/actions';
import { cleanActions } from '../src/shared/actions';
import type { Countdown } from '../src/shared/extras';

const NOW = new Date(2026, 9, 3, 10, 0);

function fakes() {
  let countdowns: Countdown[] = [];
  const habits = [
    { id: 'h1', title: 'Drink water', done: false },
    { id: 'h2', title: 'Read 10 pages', done: true },
  ];
  let holdings = [{ id: 'AAPL', symbol: 'AAPL', shares: 3 }];
  const deps = {
    hub: {
      addTask: vi.fn(async (title: string, due?: string) => ({ id: 't1', title: title.replace(/ friday.*/i, ''), done: false, due })),
      removeTask: vi.fn(async () => undefined),
      addNote: vi.fn(async (text: string) => ({ id: 'n1', text, createdAt: '' })),
      removeNote: vi.fn(async () => undefined),
    },
    extras: {
      get: () => ({ countdowns, note: '' }),
      setCountdowns: vi.fn((list: Countdown[]) => {
        countdowns = list;
        return { countdowns, note: '' };
      }),
    },
    habits: {
      get: () => ({ habits }) as never,
      toggle: vi.fn((id: string) => {
        const h = habits.find((x) => x.id === id)!;
        h.done = !h.done;
        return {} as never;
      }),
    },
    reminders: { add: vi.fn((text: string, at: string) => ({ id: 'r1', text, at, done: false })), remove: vi.fn(() => []) },
    portfolio: {
      holdings: () => holdings,
      add: vi.fn(async (symbol: string, shares: number) => {
        holdings = [...holdings.filter((h) => h.symbol !== symbol), { id: symbol, symbol, shares }];
        return { holdings, hidden: false, quotes: { [symbol]: { price: 100 } }, fetchedAt: '' } as never;
      }),
      setShares: vi.fn((symbol: string, shares: number) => {
        holdings = shares > 0 ? [...holdings.filter((h) => h.symbol !== symbol), { id: symbol, symbol, shares }] : holdings.filter((h) => h.symbol !== symbol);
      }),
    },
  };
  return { deps: deps as unknown as ActionDeps & typeof deps, getCountdowns: () => countdowns, habits };
}

describe('chat actions', () => {
  it("keeps only well-formed actions from the AI's answer", () => {
    expect(cleanActions([{ type: 'add_task', title: ' Quiz ', when: 'friday' }, { type: 'hack', title: 'x' }, { type: 'add_note', title: '' }, null])).toEqual([
      { type: 'add_task', title: 'Quiz', when: 'friday' },
    ]);
    expect(cleanActions('nope')).toEqual([]);
  });

  it('adds a task with the date worked out by Life Hub, not the AI', async () => {
    const { deps } = fakes();
    const [r] = await runActions([{ type: 'add_task', title: 'Chem quiz', when: 'friday 3pm' }], deps, NOW);
    expect(deps.hub.addTask).toHaveBeenCalledWith('Chem quiz', '2026-10-09T15:00');
    expect(r).toMatchObject({ ok: true, label: 'Added task', undo: 'task:t1' });
  });

  it('adds countdowns and reminders, and says when one needs a date', async () => {
    const { deps, getCountdowns } = fakes();
    const results = await runActions(
      [
        { type: 'add_countdown', title: "Mom's birthday", when: 'nov 12' },
        { type: 'add_countdown', title: 'Someday' },
        { type: 'remind', title: 'call mom', when: '6pm' },
        { type: 'remind', title: 'stretch', when: 'yesterday' },
      ],
      deps,
      NOW,
    );
    expect(getCountdowns()).toMatchObject([{ title: "Mom's birthday", date: '2026-11-12' }]);
    expect(results.map((r) => r.ok)).toEqual([true, false, true, false]);
    expect(deps.reminders.add).toHaveBeenCalledWith('Call mom', new Date(2026, 9, 3, 18, 0).toISOString());
    expect(results[1].detail).toMatch(/need a day/);
  });

  it('ticks off a daily task by name, and undoes it', async () => {
    const { deps, habits } = fakes();
    const results = await runActions(
      [
        { type: 'tick_habit', title: 'drink water' },
        { type: 'tick_habit', title: 'read' },
        { type: 'tick_habit', title: 'fly' },
      ],
      deps,
      NOW,
    );
    expect(results.map((r) => [r.label, r.ok])).toEqual([
      ['Ticked off', true],
      ['Already done', true],
      ["Couldn't do that", false],
    ]);
    expect(habits[0].done).toBe(true);
    await undoAction(results[0].undo!, deps);
    expect(habits[0].done).toBe(false);
  });

  it('undoes tasks, notes, reminders and countdowns', async () => {
    const { deps, getCountdowns } = fakes();
    const results = await runActions(
      [
        { type: 'add_note', title: 'ideas' },
        { type: 'add_countdown', title: 'Trip', when: 'dec 20' },
      ],
      deps,
      NOW,
    );
    for (const r of results) await undoAction(r.undo!, deps);
    await undoAction('task:t1', deps);
    await undoAction('reminder:r1', deps);
    expect(deps.hub.removeNote).toHaveBeenCalledWith('n1');
    expect(deps.hub.removeTask).toHaveBeenCalledWith('t1');
    expect(deps.reminders.remove).toHaveBeenCalledWith('r1');
    expect(getCountdowns()).toEqual([]);
  });

  it('updates the stocks they own, and undo puts the old amount back', async () => {
    const { deps } = fakes();
    const [bought, added] = await runActions(
      [
        { type: 'set_holding', title: 'aapl', shares: 5 },
        { type: 'set_holding', title: 'VOO', shares: 1.5 },
      ],
      deps,
      NOW,
    );
    expect(bought).toMatchObject({ ok: true, label: 'Updated stock', detail: 'AAPL · 5 shares · $500.00', undo: 'holding:AAPL:3' });
    expect(added).toMatchObject({ ok: true, label: 'Added stock', undo: 'holding:VOO:0' });
    await undoAction(bought.undo!, deps);
    await undoAction(added.undo!, deps);
    expect(deps.portfolio.holdings()).toEqual([{ id: 'AAPL', symbol: 'AAPL', shares: 3 }]);
  });

  it('removes a stock when they sold it all, and says when it was never there', async () => {
    const { deps } = fakes();
    const [sold, missing, bad] = await runActions(
      [
        { type: 'set_holding', title: 'AAPL', shares: 0 },
        { type: 'remove_holding', title: 'TSLA' },
        { type: 'set_holding', title: 'apple inc' },
      ],
      deps,
      NOW,
    );
    expect(sold).toMatchObject({ ok: true, label: 'Removed stock', undo: 'holding:AAPL:3' });
    expect(deps.portfolio.holdings()).toEqual([]);
    expect(missing.ok).toBe(false);
    expect(bad.ok).toBe(false);
  });
});
