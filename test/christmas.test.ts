import { describe, expect, it } from 'vitest';
import { LIGHTS, christmas, christmasClock, christmasLine } from '../src/shared/christmas';

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('Christmas countdown', () => {
  it('counts days to this Christmas, then next year’s after Boxing Day', () => {
    expect(christmas(at(2026, 10, 3)).days).toBe(83);
    expect(christmas(at(2026, 12, 24)).days).toBe(1);
    expect(christmas(at(2026, 12, 25)).isChristmas).toBe(true);
    expect(christmas(at(2026, 12, 26)).days).toBe(364);
    expect(christmas(at(2026, 12, 26)).date.getFullYear()).toBe(2027);
  });

  it('lights half the tree over the year, then a bulb a day at the end', () => {
    expect(christmas(at(2026, 12, 26)).lit).toBe(0);
    const october = christmas(at(2026, 10, 3)).lit;
    expect(october).toBeGreaterThan(0);
    expect(october).toBeLessThan(LIGHTS / 2);
    expect(christmas(at(2026, 12, 1)).lit).toBe(LIGHTS / 2 - 1);
    expect(christmas(at(2026, 12, 20)).lit).toBe(LIGHTS - 5);
    expect(christmas(at(2026, 12, 24)).lit).toBe(LIGHTS - 1);
    expect(christmas(at(2026, 12, 25)).lit).toBe(LIGHTS);
    // Never goes backwards as the days pass.
    let last = -1;
    for (let d = new Date(2026, 0, 1); d < new Date(2026, 11, 26); d.setDate(d.getDate() + 1)) {
      const lit = christmas(d.getTime() + 12 * 3_600_000).lit;
      expect(lit).toBeGreaterThanOrEqual(last);
      last = lit;
    }
  });

  it('shows a live clock and a cheerful line', () => {
    expect(christmasClock(3 * 3_600_000 + 4 * 60_000 + 9_000)).toBe('03:04:09');
    expect(christmasClock(2 * 86_400_000 + 3_600_000)).toBe('2d 01h 00m 00s');
    expect(christmasLine(christmas(at(2026, 12, 24)))).toMatch(/one more sleep/i);
    expect(christmasLine(christmas(at(2026, 12, 25)))).toBe('Merry Christmas!');
  });
});
