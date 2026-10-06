import { describe, expect, it } from 'vitest';
import { arrangeLayout, describeLayout, type PlacedWidget } from '../src/shared/layout';
import { claimsDone } from '../src/shared/actions';

describe('arranging with sizes', () => {
  const start: PlacedWidget[] = [
    { type: 'weather', size: 's' },
    { type: 'timeline', size: 'w' },
    { type: 'tasks', size: 'm' },
  ];

  it('resizes widgets named with a size, in any of the usual ways', () => {
    const { layout, missing } = arrangeLayout(start, ['timeline: full', 'Weather (medium)', 'tasks - wide', 'news']);
    expect(missing).toEqual([]);
    expect(layout.map((w) => [w.type, w.size])).toEqual([
      ['timeline', 'f'],
      ['weather', 'm'],
      ['tasks', 'w'],
      ['news', expect.any(String)],
    ]);
  });

  it('picks the nearest size a widget comes in', () => {
    const { layout } = arrangeLayout(start, ['weather: full']);
    expect(layout[0]).toMatchObject({ type: 'weather', size: 'm' });
  });

  it('still reads names echoed back from the dashboard list', () => {
    const { layout, missing } = arrangeLayout(start, ['Coming up (coming-up, small)', 'Tasks (tasks)']);
    expect(missing).toEqual([]);
    expect(layout.slice(0, 2).map((w) => [w.type, w.size])).toEqual([
      ['coming-up', 's'],
      ['tasks', 'm'],
    ]);
  });

  it('tells the AI each widget size and what it comes in', () => {
    expect(describeLayout([{ type: 'weather', size: 's' }])).toBe('Weather (weather, small; comes tiny/small/medium)');
  });
});

describe('catching a claimed change', () => {
  it('spots an answer saying it did something', () => {
    expect(claimsDone("I've set up a clean, balanced layout on your dashboard for you")).toBe(true);
    expect(claimsDone("I've applied the clean layout to your dashboard")).toBe(true);
    expect(claimsDone('I added milk to your list.')).toBe(true);
  });

  it('leaves ordinary answers and earlier work alone', () => {
    expect(claimsDone('You have 3 meetings today.')).toBe(false);
    expect(claimsDone("I've looked at your calendar and you're free at 3.")).toBe(false);
    expect(claimsDone("I already added that earlier.")).toBe(false);
  });
});
