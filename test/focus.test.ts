import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FocusTimer } from '../electron/focus';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-03T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('FocusTimer', () => {
  it('runs a session and reports when it is done', () => {
    const timer = new FocusTimer();
    const changes: unknown[] = [];
    const done = vi.fn();
    timer.on('change', (s) => changes.push(s));
    timer.on('done', done);

    const session = timer.start(25, '  Roadmap draft ');
    expect(session).toEqual({ label: 'Roadmap draft', startedAt: '2026-10-03T10:00:00.000Z', endsAt: '2026-10-03T10:25:00.000Z' });
    expect(timer.current()).toBe(session);

    vi.advanceTimersByTime(25 * 60_000 - 1);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledWith(session);
    expect(timer.current()).toBeNull();
    expect(changes).toEqual([session, null]);
  });

  it('stops early without saying it finished, and a new start replaces the old one', () => {
    const timer = new FocusTimer();
    const done = vi.fn();
    timer.on('done', done);

    timer.start(25, 'First');
    const second = timer.start(10, '');
    expect(second.label).toBe('Focus');
    timer.stop();
    vi.advanceTimersByTime(60 * 60_000);
    expect(done).not.toHaveBeenCalled();
    expect(timer.current()).toBeNull();
  });

  it('refuses silly lengths', () => {
    const timer = new FocusTimer();
    expect(() => timer.start(0, 'x')).toThrow();
    expect(() => timer.start(500, 'x')).toThrow();
    expect(() => timer.start(Number.NaN, 'x')).toThrow();
  });
});
