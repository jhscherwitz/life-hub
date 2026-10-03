import { describe, expect, it } from 'vitest';
import { hoursMinutes, moonLitPath, moonPhase, sunDay, yearProgress } from '../src/shared/almanac';

describe('almanac', () => {
  it('knows the moon phase', () => {
    // Known full moons and new moons.
    const full = moonPhase(Date.UTC(2024, 0, 25, 17, 54));
    expect(full.name).toBe('Full moon');
    expect(full.illumination).toBeGreaterThan(0.99);
    expect(full.daysToFull).toBe(0);
    const fresh = moonPhase(Date.UTC(2024, 1, 9, 22, 59));
    expect(fresh.name).toBe('New moon');
    expect(fresh.illumination).toBeLessThan(0.01);
    expect(fresh.daysToFull).toBe(15);
    expect(moonPhase(Date.UTC(2024, 1, 16, 15, 1)).name).toBe('First quarter');
    expect(moonPhase(Date.UTC(2024, 1, 2, 23, 18)).name).toBe('Last quarter');
  });

  it('draws the lit side on the right while waxing and the left while waning', () => {
    expect(moonLitPath(0.1, 50, 50, 40)).toMatch(/^M50 10A40 40 0 0 1 50 90/);
    expect(moonLitPath(0.9, 50, 50, 40)).toMatch(/^M50 10A40 40 0 0 0 50 90/);
    // Half lit at the quarters: the shadow's edge is a straight line.
    expect(moonLitPath(0.25, 50, 50, 40)).toContain('A0 40');
  });

  it('follows the sun across the day', () => {
    const rise = '2026-10-03T12:00:00.000Z';
    const set = '2026-10-03T23:00:00.000Z';
    expect(sunDay(rise, set, Date.parse('2026-10-03T10:00:00Z'))).toMatchObject({ state: 'before', progress: 0, leftMs: 0 });
    const mid = sunDay(rise, set, Date.parse('2026-10-03T17:30:00Z'));
    expect(mid.state).toBe('day');
    expect(mid.progress).toBeCloseTo(0.5);
    expect(hoursMinutes(mid.leftMs)).toBe('5h 30m');
    expect(sunDay(rise, set, Date.parse('2026-10-04T01:00:00Z'))).toMatchObject({ state: 'after', progress: 1 });
  });

  it('counts the days of the year', () => {
    expect(yearProgress(new Date(2026, 0, 1, 9))).toMatchObject({ year: 2026, day: 1, days: 365 });
    expect(yearProgress(new Date(2026, 9, 3, 23))).toMatchObject({ day: 276 });
    expect(yearProgress(new Date(2028, 11, 31))).toMatchObject({ day: 366, days: 366 });
    expect(hoursMinutes(52 * 60_000)).toBe('52m');
  });
});
