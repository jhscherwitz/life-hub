import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReminderScheduler, ReminderStore } from '../electron/reminders';
import { dueReminders, newPhoneTopic, normalizeReminders, toQueue, type Reminder } from '../src/shared/reminders';

const NOW = Date.parse('2026-10-03T15:00:00Z');
const r = (id: string, at: string, extra: Partial<Reminder> = {}): Reminder => ({ id, text: id, at, done: false, ...extra });

describe('reminders', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('cleans and sorts saved reminders', () => {
    expect(normalizeReminders([r('b', '2026-10-05T00:00:00Z'), { id: 'x' }, r('a', '2026-10-04T00:00:00Z'), r('bad', 'soon')]).map((x) => x.id)).toEqual([
      'a',
      'b',
    ]);
    expect(normalizeReminders('nope')).toEqual([]);
  });

  it('knows which are due and which can go to the phone', () => {
    const list = [
      r('past', '2026-10-03T14:59:00Z'),
      r('soon', '2026-10-04T15:00:00Z'),
      r('far', '2026-10-10T15:00:00Z'),
      r('done', '2026-10-01T00:00:00Z', { done: true }),
    ];
    expect(dueReminders(list, NOW).map((x) => x.id)).toEqual(['past']);
    expect(toQueue(list, NOW).map((x) => x.id)).toEqual(['past', 'soon']);
    expect(toQueue([r('q', '2026-10-04T00:00:00Z', { queued: true })], NOW)).toEqual([]);
  });

  it('makes long random phone topics', () => {
    const topic = newPhoneTopic();
    expect(topic).toMatch(/^lifehub-[a-z2-9]{18}$/);
    expect(newPhoneTopic()).not.toBe(topic);
  });

  it('shows due reminders, queues near ones on the phone with a delivery time, and tidies up', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-rem-'));
    const store = new ReminderStore(path.join(dir, 'reminders.json'));
    store.add('Call mom', new Date(NOW - 60_000).toISOString());
    store.add('Quiz', new Date(NOW + 2 * 3_600_000).toISOString());
    store.add('Trip', new Date(NOW + 9 * 86_400_000).toISOString());
    expect(() => store.add('  ', new Date(NOW).toISOString())).toThrow();

    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const shown: string[] = [];
    const changed = vi.fn();
    const scheduler = new ReminderScheduler(
      store,
      () => 'lifehub-test',
      (x) => shown.push(x.text),
      changed,
    );
    await scheduler.tick(NOW);

    expect(shown).toEqual(['Call mom']);
    expect(fetch).toHaveBeenCalledTimes(2);
    const quizCall = fetch.mock.calls.find((c) => c[1].body === 'Quiz')!;
    expect(quizCall[0]).toBe('https://ntfy.sh/lifehub-test');
    expect((quizCall[1].headers as Record<string, string>).At).toBe(String(Math.floor((NOW + 2 * 3_600_000) / 1000)));
    expect(changed).toHaveBeenCalled();
    expect(store.list().find((x) => x.text === 'Trip')!.queued).toBeUndefined();

    // Nothing new to do on the next tick.
    fetch.mockClear();
    await scheduler.tick(NOW + 1000);
    expect(fetch).not.toHaveBeenCalled();
    // A day later the shown one is tidied away.
    await scheduler.tick(NOW + 2 * 86_400_000);
    expect(store.list().map((x) => x.text)).not.toContain('Call mom');
  });
});
