import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, widgetTier, SIZE_COLUMNS, WIDGETS, addWidget, rowsFor, widgetBox, availableWidgets, moveWidget, nextWidgetStyle, normalizeLayout, removeWidget, resizeWidget } from '../src/shared/layout';

describe('dashboard layout', () => {
  it('snaps old sizes to what a widget allows now, and keeps a valid look', () => {
    const layout = normalizeLayout([
      { type: 'meetings', size: 's' },
      { type: 'month', size: 'w' },
      { type: 'tasks-open', size: 'xs', style: 'number' },
      { type: 'replies', size: 'xs', style: 'fancy' },
    ]);
    expect(layout).toEqual([
      { type: 'meetings', size: 'xs' },
      { type: 'month', size: 's' },
      { type: 'tasks-open', size: 'xs', style: 'number' },
      { type: 'replies', size: 'xs' },
    ]);
  });

  it('cycles through a widget’s looks', () => {
    const layout = [{ type: 'tasks-open' as const, size: 'xs' as const }];
    const once = nextWidgetStyle(layout, 'tasks-open');
    expect(once[0].style).toBe('number');
    expect(nextWidgetStyle(once, 'tasks-open')[0].style).toBe('ring');
    // Widgets with one look don't change.
    expect(nextWidgetStyle([{ type: 'date', size: 'xs' }], 'date')).toEqual([{ type: 'date', size: 'xs' }]);
    expect(nextWidgetStyle([{ type: 'clock', size: 'xs' }], 'clock')[0].style).toBe('analog');
  });

  it('falls back to the default for anything unreadable', () => {
    expect(normalizeLayout(undefined)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout('nonsense')).toEqual(DEFAULT_LAYOUT);
    // A copy, so changing it can't change the default.
    expect(normalizeLayout(null)).not.toBe(DEFAULT_LAYOUT);
  });

  it('drops unknown widgets and repeats, and fixes sizes a widget cannot be', () => {
    const cleaned = normalizeLayout([
      { type: 'weather', size: 's' },
      { type: 'stocks', size: 'm' },
      { type: 'weather', size: 'm' },
      { type: 'timeline', size: 's' },
      'junk',
    ]);
    expect(cleaned).toEqual([
      { type: 'weather', size: 's' },
      { type: 'timeline', size: 'w' },
    ]);
  });

  it('adds, removes, resizes and moves widgets', () => {
    let layout = normalizeLayout([{ type: 'weather', size: 's' }, { type: 'now', size: 'm' }]);
    expect(availableWidgets(layout)).not.toContain('weather');
    layout = addWidget(layout, 'clock');
    expect(layout.at(-1)).toEqual({ type: 'clock', size: 's' });
    expect(addWidget(layout, 'clock')).toBe(layout);
    expect(addWidget([], 'clock', 'm')).toEqual([{ type: 'clock', size: 'm' }]);
    // A size the widget can't be falls back to its usual one.
    expect(addWidget([], 'clock', 'f')).toEqual([{ type: 'clock', size: 's' }]);

    layout = resizeWidget(layout, 'now', 'f');
    expect(layout[1].size).toBe('f');
    expect(resizeWidget(layout, 'weather', 'f')).toBe(layout);

    layout = moveWidget(layout, 'clock', 'weather');
    expect(layout.map((w) => w.type)).toEqual(['clock', 'weather', 'now']);
    layout = moveWidget(layout, 'clock', 'now');
    expect(layout.map((w) => w.type)).toEqual(['weather', 'now', 'clock']);

    layout = removeWidget(layout, 'now');
    expect(layout.map((w) => w.type)).toEqual(['weather', 'clock']);
  });
});

describe('LayoutStore', () => {
  it('starts with the default, saves a cleaned layout and reads it back', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { LayoutStore } = await import('../electron/layout');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-layout-'));
    try {
      const store = new LayoutStore(path.join(dir, 'dashboard.json'));
      expect(store.get()).toEqual(DEFAULT_LAYOUT);
      expect(store.set([{ type: 'clock', size: 'm' }, { type: 'nope' }])).toEqual([{ type: 'clock', size: 'm' }]);
      expect(new LayoutStore(path.join(dir, 'dashboard.json')).get()).toEqual([{ type: 'clock', size: 'm' }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('measures widgets for previews', () => {
    // 24 columns of 38px with 23 gaps of 12px.
    expect(widgetBox('xs', 1, 1188)).toEqual({ width: 3 * 38 + 2 * 12, height: 118 });
    expect(widgetBox('s', 1, 1188)).toEqual({ width: 6 * 38 + 5 * 12, height: 118 });
    expect(widgetBox('f', 2, 1188)).toEqual({ width: 1188, height: 248 });
  });

  it('fills every row of the default layout with no gaps', () => {
    // Each block of rows adds up to whole rows of 24 columns.
    const cols = DEFAULT_LAYOUT.reduce((sum, w) => sum + SIZE_COLUMNS[w.size] * rowsFor(w.type, w.size, w.rows), 0);
    expect(cols % 24).toBe(0);
    for (const w of DEFAULT_LAYOUT) expect(WIDGETS[w.type].sizes).toContain(w.size);
    expect(rowsFor('now', 'xs')).toBe(1);
    expect(rowsFor('now', 's')).toBe(2);
  });
});

describe('widget heights', () => {
  it('lets lists and pictures get taller, keeps tiny squares one row', async () => {
    const { heightsFor, rowsFor, setWidgetRows, resizeWidget, normalizeLayout } = await import('../src/shared/layout');
    expect(heightsFor('news', 's')).toEqual([2, 3, 4]);
    expect(heightsFor('news', 'xs')).toEqual([1]);
    expect(heightsFor('clock', 'm')).toEqual([1, 2]);
    expect(heightsFor('date', 's')).toEqual([1]);
    expect(rowsFor('news', 's', 4)).toBe(4);
    expect(rowsFor('news', 's', 9)).toBe(2);
    expect(rowsFor('news', 'xs', 4)).toBe(1);
  });

  it('saves a height, forgets it at the usual height, and keeps it when the width allows', async () => {
    const { setWidgetRows, resizeWidget, normalizeLayout } = await import('../src/shared/layout');
    let layout = setWidgetRows([{ type: 'news', size: 'm' }], 'news', 4);
    expect(layout).toEqual([{ type: 'news', size: 'm', rows: 4 }]);
    layout = resizeWidget(layout, 'news', 's');
    expect(layout).toEqual([{ type: 'news', size: 's', rows: 4 }]);
    expect(resizeWidget(layout, 'news', 'xs')).toEqual([{ type: 'news', size: 'xs' }]);
    expect(setWidgetRows(layout, 'news', 2)).toEqual([{ type: 'news', size: 's' }]);
    expect(normalizeLayout([{ type: 'tasks', size: 's', rows: 3 }, { type: 'date', size: 'xs', rows: 4 }])).toEqual([{ type: 'tasks', size: 's', rows: 3 }, { type: 'date', size: 'xs' }]);
  });
});

describe('widget tiers', () => {
  it('puts what needs you first and the decoration last in the default layout', () => {
    const order = DEFAULT_LAYOUT.map((w) => widgetTier(w.type));
    expect(order.slice(0, 4)).toEqual(['needs', 'needs', 'needs', 'needs']);
    expect(DEFAULT_LAYOUT[0].type).toBe('meetings');
    expect(DEFAULT_LAYOUT.findIndex((w) => w.type === 'briefing')).toBeLessThan(DEFAULT_LAYOUT.findIndex((w) => w.type === 'moon'));
    expect(widgetTier('moon')).toBe('ambient');
    expect(widgetTier('replies')).toBe('needs');
    expect(widgetTier('news')).toBe('normal');
  });
});
