import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hub } from '../electron/hub';
import { MorningRoutine, isDue, parseTime, scheduledAt } from '../electron/morning';
import { NoteStore } from '../electron/notes';
import { SettingsStore, type Cipher } from '../electron/settings';
import { SmartLayer } from '../electron/smart';
import type { AiWriter } from '../electron/smart/claude';
import { SampleCalendarSource, SampleEmailSource, SampleWeatherSource } from '../electron/sources/sample';
import { LocalTaskSource } from '../electron/sources/tasks';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-morning-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes);
const SEVEN = { enabled: true, time: '07:00' };

describe('morning schedule', () => {
  it('reads 24-hour times', () => {
    expect(parseTime('07:00')).toEqual({ hours: 7, minutes: 0 });
    expect(parseTime('18:45')).toEqual({ hours: 18, minutes: 45 });
    expect(parseTime('24:00')).toBeNull();
    expect(parseTime('7am')).toBeNull();
    expect(scheduledAt(at(5, 15), '06:30')).toEqual(at(5, 6, 30));
  });

  it('is due once the time has passed, once a day', () => {
    expect(isDue(at(5, 6, 59), SEVEN, undefined)).toBe(false);
    expect(isDue(at(5, 7, 0), SEVEN, undefined)).toBe(true);
    expect(isDue(at(5, 7, 0), SEVEN, '2026-10-05')).toBe(false);
    // Yesterday's run doesn't count for today.
    expect(isDue(at(5, 7, 0), SEVEN, '2026-10-04')).toBe(true);
    expect(isDue(at(5, 8, 0), { enabled: false, time: '07:00' }, undefined)).toBe(false);
  });

  it('catches up on the first check after the computer wakes', async () => {
    let now = at(5, 6, 0);
    const run = vi.fn(async () => {});
    const morning = new MorningRoutine(path.join(dir, 'morning.json'), () => SEVEN, run, () => now);

    await morning.check();
    expect(run).not.toHaveBeenCalled();

    // Asleep from 6:00 until 9:15: the 7:00 update runs on the first check after waking.
    now = at(5, 9, 15);
    await morning.check();
    expect(run).toHaveBeenCalledTimes(1);
    expect(morning.lastRunAt()).toBe(now.toISOString());

    // Not again the same day, even after a restart.
    now = at(5, 13, 0);
    await new MorningRoutine(path.join(dir, 'morning.json'), () => SEVEN, run, () => now).check();
    expect(run).toHaveBeenCalledTimes(1);

    now = at(6, 7, 1);
    await morning.check();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('tries again at the next check if the update fails', async () => {
    const now = at(5, 7, 30);
    const run = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const morning = new MorningRoutine(path.join(dir, 'morning.json'), () => SEVEN, run, () => now);

    await morning.check();
    expect(morning.lastRunAt()).toBeUndefined();
    await morning.check();
    expect(run).toHaveBeenCalledTimes(2);
    expect(morning.lastRunAt()).toBe(now.toISOString());
  });

  it('runs only once when checks overlap', async () => {
    let finish!: () => void;
    const run = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const morning = new MorningRoutine(path.join(dir, 'morning.json'), () => SEVEN, run, () => at(5, 7, 5));
    const first = morning.check();
    const second = morning.check();
    finish();
    await Promise.all([first, second]);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('morning settings', () => {
  const cipher: Cipher = { available: () => false, encrypt: (s) => s, decrypt: (s) => s };

  it('defaults to 7:00 AM and starting at login', () => {
    const settings = new SettingsStore(path.join(dir, 'settings.json'), cipher);
    expect(settings.morning()).toEqual({ enabled: true, time: '07:00' });
    expect(settings.startAtLogin()).toBe(true);

    settings.setMorning({ enabled: true, time: '06:15' });
    settings.setStartAtLogin(false);
    const reloaded = new SettingsStore(path.join(dir, 'settings.json'), cipher);
    expect(reloaded.morning()).toEqual({ enabled: true, time: '06:15' });
    expect(reloaded.startAtLogin()).toBe(false);
  });
});

describe('morning update', () => {
  function hubWith(smart: SmartLayer) {
    return new Hub(
      {
        calendar: new SampleCalendarSource(),
        email: new SampleEmailSource(),
        tasks: new LocalTaskSource(path.join(dir, 'tasks.json')),
        weather: new SampleWeatherSource(),
      },
      new NoteStore(path.join(dir, 'notes.json')),
      smart,
      () => false,
    );
  }

  it("waits for Claude's briefing, and rewrites one written earlier in the day", async () => {
    let n = 0;
    const json = vi.fn(async ({ system }: { system: string }) =>
      system.includes('morning briefing') ? { headline: `Briefing ${++n}`, points: ['One thing.'] } : { results: [] },
    );
    const writer = { json } as unknown as AiWriter;
    const hub = hubWith(new SmartLayer(dir, () => 'sk-ant-test', () => writer));

    const first = await hub.morningUpdate();
    expect(first.briefing).toMatchObject({ headline: 'Briefing 1', writtenBy: 'claude' });

    const second = await hub.morningUpdate();
    expect(second.briefing).toMatchObject({ headline: 'Briefing 2', writtenBy: 'claude' });
  });

  it("uses Hub's own briefing without an API key", async () => {
    const snapshot = await hubWith(new SmartLayer(dir, () => undefined)).morningUpdate();
    expect(snapshot.briefing.writtenBy).toBe('basic');
    expect(snapshot.briefing.headline).toBeTruthy();
  });
});
