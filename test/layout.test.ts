import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, addWidget, availableWidgets, moveWidget, normalizeLayout, removeWidget, resizeWidget } from '../src/shared/layout';

describe('dashboard layout', () => {
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
});
