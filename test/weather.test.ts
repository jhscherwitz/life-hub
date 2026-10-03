import { describe, expect, it } from 'vitest';
import { localToIso, uvLevel, weatherChart, weatherKind, type HourlyWeather } from '../src/shared/weather';

/** A day of hours from local midnight, with the given values. */
function day(make: (hour: number) => Partial<HourlyWeather>): HourlyWeather[] {
  const start = new Date(2026, 9, 3, 0, 0, 0).getTime();
  return Array.from({ length: 36 }, (_, h) => ({
    at: new Date(start + h * 3_600_000).toISOString(),
    tempF: 60,
    precipChance: 0,
    uv: 0,
    ...make(h % 24),
  }));
}

const at = (hour: number, minute = 0) => new Date(2026, 9, 3, hour, minute).getTime();
const sunny = (h: number) => ({ uv: h >= 8 && h <= 17 ? (h === 13 ? 7 : 3) : 0 });

describe('weather', () => {
  it('turns weather codes into pictures', () => {
    expect(weatherKind(0)).toBe('clear');
    expect(weatherKind(1, false)).toBe('clear-night');
    expect(weatherKind(2, false)).toBe('partly-night');
    expect(weatherKind(45)).toBe('fog');
    expect(weatherKind(53)).toBe('drizzle');
    expect(weatherKind(81)).toBe('rain');
    expect(weatherKind(73)).toBe('snow');
    expect(weatherKind(96)).toBe('storm');
  });

  it("reads Open-Meteo's local times with the place's offset", () => {
    expect(localToIso('2026-10-03T14:00', -5 * 3600)).toBe('2026-10-03T19:00:00.000Z');
    expect(localToIso('2026-10-03T00:30', 3600)).toBe('2026-10-02T23:30:00.000Z');
  });

  it('names UV levels', () => {
    expect(uvLevel(2).label).toBe('Low');
    expect(uvLevel(5).label).toBe('Moderate');
    expect(uvLevel(7).label).toBe('High');
    expect(uvLevel(9).label).toBe('Very high');
    expect(uvLevel(12).label).toBe('Extreme');
  });

  it('shows rain when rain is coming in the next 12 hours', () => {
    const chart = weatherChart(day((h) => ({ ...sunny(h), precipChance: h === 16 ? 70 : 10 })), at(10, 20));
    expect(chart?.kind).toBe('rain');
    expect(chart?.bars).toHaveLength(12);
    expect(new Date(chart!.bars[0].at).getHours()).toBe(10);
    expect(chart?.peak.value).toBe(70);
  });

  it("shows today's UV on a dry, sunny day, marking now", () => {
    const chart = weatherChart(day(sunny), at(11, 30));
    expect(chart?.kind).toBe('uv');
    if (chart?.kind !== 'uv') return;
    expect(chart.bars).toHaveLength(10);
    expect(new Date(chart.bars[chart.nowIndex].at).getHours()).toBe(11);
    expect(new Date(chart.peak.at).getHours()).toBe(13);
  });

  it('ignores rain later than 12 hours away', () => {
    expect(weatherChart(day((h) => ({ ...sunny(h), precipChance: h === 23 ? 80 : 0 })), at(9))?.kind).toBe('uv');
  });

  it('shows temperature once the sun is down', () => {
    const chart = weatherChart(day((h) => ({ ...sunny(h), tempF: 70 - Math.abs(15 - h) })), at(21));
    expect(chart?.kind).toBe('temp');
    if (chart?.kind !== 'temp') return;
    expect(chart.bars[0].value).toBe(64);
    expect(chart.low.value).toBeLessThan(chart.peak.value);
  });

  it('draws nothing without enough hours', () => {
    expect(weatherChart([], at(9))).toBeNull();
  });
});
