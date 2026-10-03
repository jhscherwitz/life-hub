import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
        utc_offset_seconds: -18000,
        current: { temperature_2m: 61.4, weather_code: 2, is_day: 1, apparent_temperature: 59.6, relative_humidity_2m: 71.5, wind_speed_10m: 8.6 },
        hourly: { time: ['2026-10-03T00:00', '2026-10-03T01:00'], temperature_2m: [55.2, 54.4], precipitation_probability: [5, null], uv_index: [0, null] },
        daily: {
          temperature_2m_max: [68.2],
          temperature_2m_min: [53.6],
          precipitation_probability_max: [20],
          uv_index_max: [5.25],
          sunrise: ['2026-10-03T07:04'],
          sunset: ['2026-10-03T18:52'],
        },
      }),
    );
    vi.stubGlobal('fetch', fetch);
    const weather = await new OpenMeteoWeatherSource({ name: 'Chicago', region: 'Illinois, United States', latitude: 41.85, longitude: -87.65 }).getWeather();
    expect(weather).toEqual({
      location: 'Chicago',
      temperatureF: 61,
      highF: 68,
      lowF: 54,
      condition: 'Partly cloudy',
      icon: '⛅',
      precipitationChance: 20,
      kind: 'partly',
      feelsLikeF: 60,
      windMph: 9,
      humidity: 72,
      uvMax: 5.3,
      sunrise: '2026-10-03T12:04:00.000Z',
      sunset: '2026-10-03T23:52:00.000Z',
      hourly: [
        { at: '2026-10-03T05:00:00.000Z', tempF: 55, precipChance: 5, uv: 0 },
        { at: '2026-10-03T06:00:00.000Z', tempF: 54, precipChance: 0, uv: 0 },
      ],
    });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.host).toBe('api.open-meteo.com');
    expect(url.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(url.searchParams.get('latitude')).toBe('41.85');
    expect(url.searchParams.get('hourly')).toContain('uv_index');
    expect(url.searchParams.get('wind_speed_unit')).toBe('mph');
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
