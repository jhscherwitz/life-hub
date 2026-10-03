import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OsmCommuteSource } from '../electron/sources/commute';
import { LocalTaskSource } from '../electron/sources/tasks';
import { OpenMeteoWeatherSource, describeWeatherCode, searchPlaces } from '../electron/sources/weather';
import type { CalendarEvent } from '../src/shared/types';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-test-'));
});
afterEach(() => {
  vi.unstubAllGlobals();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('weather', () => {
  it('describes WMO weather codes', () => {
    expect(describeWeatherCode(0)).toEqual({ condition: 'Clear', icon: '☀️' });
    expect(describeWeatherCode(0, false).icon).toBe('🌙');
    expect(describeWeatherCode(63).condition).toBe('Rain');
    expect(describeWeatherCode(75).condition).toBe('Snow');
    expect(describeWeatherCode(95).condition).toBe('Thunderstorms');
  });

  it('reads the Open-Meteo forecast in Fahrenheit', async () => {
    const fetch = vi.fn(async (_url: string) =>
      json({
        current: { temperature_2m: 61.4, weather_code: 2, is_day: 1 },
        daily: { temperature_2m_max: [68.2], temperature_2m_min: [53.6], precipitation_probability_max: [20] },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const weather = await new OpenMeteoWeatherSource({ name: 'Chicago', region: 'Illinois, United States', latitude: 41.85, longitude: -87.65 }).getWeather();
    expect(weather).toEqual({ location: 'Chicago', temperatureF: 61, highF: 68, lowF: 54, condition: 'Partly cloudy', icon: '⛅', precipitationChance: 20 });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.host).toBe('api.open-meteo.com');
    expect(url.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(url.searchParams.get('latitude')).toBe('41.85');
  });

  it('searches for places', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ results: [{ name: 'Springfield', latitude: 39.8, longitude: -89.6, admin1: 'Illinois', country: 'United States' }] })),
    );
    expect(await searchPlaces('Springfield')).toEqual([{ name: 'Springfield', region: 'Illinois, United States', latitude: 39.8, longitude: -89.6 }]);
    vi.stubGlobal('fetch', vi.fn(async () => json({ generationtime_ms: 0.1 })));
    expect(await searchPlaces('Nowhereville')).toEqual([]);
  });
});

describe('commute', () => {
  const inAnHour = new Date(Date.now() + 60 * 60_000);
  const events: CalendarEvent[] = [
    { id: 'call', title: 'Call', start: new Date(Date.now() + 10 * 60_000).toISOString(), end: inAnHour.toISOString() },
    { id: 'lunch', title: 'Lunch with Sam', start: inAnHour.toISOString(), end: inAnHour.toISOString(), location: '1 Lunch Rd' },
  ];

  it('routes from home to the next in-person event', async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('nominatim')) return json(url.includes('Home') ? [{ lat: '41.0', lon: '-87.0' }] : [{ lat: '41.1', lon: '-87.1' }]);
      return json({ code: 'Ok', routes: [{ duration: 1500, distance: 12000 }] });
    });
    vi.stubGlobal('fetch', fetch);
    const commute = await new OsmCommuteSource('1 Home St', 'drive').getCommute(events);
    expect(commute).toMatchObject({ destination: '1 Lunch Rd', durationMinutes: 25, mode: 'drive', summary: 'for Lunch with Sam' });
    // 25 minutes of driving plus a 10 minute buffer.
    expect(new Date(commute!.leaveBy!).getTime()).toBe(inAnHour.getTime() - 35 * 60_000);
    const routeCall = fetch.mock.calls.map((c) => c[0]).find((u) => u.includes('routed-car'));
    expect(routeCall).toContain('/-87,41;-87.1,41.1?');
    // Nominatim requires apps to identify themselves.
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['User-Agent']).toMatch(/^LifeHub\//);
  });

  it('shows nothing when the place cannot be found on the map', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => json(url.includes('Conference') ? [] : [{ lat: '1', lon: '2' }])));
    const roomOnly: CalendarEvent[] = [{ ...events[1], location: 'Conference Room B' }];
    expect(await new OsmCommuteSource('2 Home St', 'walk').getCommute(roomOnly)).toBeNull();
  });

  it('returns null when there is no in-person event', async () => {
    expect(await new OsmCommuteSource('3 Home St', 'bike').getCommute([events[0]])).toBeNull();
  });
});

describe('built-in task list', () => {
  it('adds, completes and deletes tasks, and keeps them on disk', async () => {
    const file = path.join(dir, 'tasks.json');
    const tasks = new LocalTaskSource(file);
    expect(await tasks.listTasks()).toEqual([]);

    const a = await tasks.addTask({ title: 'Buy milk' });
    await tasks.addTask({ title: 'Call Mom' });
    await tasks.setDone(a.id, true);

    const reopened = new LocalTaskSource(file);
    expect((await reopened.listTasks()).map((t) => [t.title, t.done])).toEqual([
      ['Buy milk', true],
      ['Call Mom', false],
    ]);

    await reopened.removeTask(a.id);
    expect((await reopened.listTasks()).map((t) => t.title)).toEqual(['Call Mom']);
  });

  it('carries over tasks captured while Hub was on sample data', async () => {
    const legacy = path.join(dir, 'sample-tasks.json');
    fs.writeFileSync(
      legacy,
      JSON.stringify({
        added: [{ id: 'capture-1', title: 'Captured earlier', done: false, source: 'Quick capture' }],
        done: { 'capture-1': true, t1: true },
      }),
    );
    const tasks = new LocalTaskSource(path.join(dir, 'tasks.json'), legacy);
    expect(await tasks.listTasks()).toEqual([{ id: 'capture-1', title: 'Captured earlier', done: true, source: 'Tasks' }]);
  });
});
