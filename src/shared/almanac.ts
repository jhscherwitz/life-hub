// Small sky and calendar facts worked out on this computer, with no internet:
// the moon's phase, where the sun is between sunrise and sunset, and how far
// through the year we are.

const DAY = 86_400_000;
/** Days from one new moon to the next. */
export const SYNODIC_MONTH = 29.530588853;
/** A known new moon: 6 January 2000, 18:14 UTC. */
const NEW_MOON_2000 = Date.UTC(2000, 0, 6, 18, 14);

const PHASE_NAMES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

export interface MoonPhase {
  /** 0 = new, 0.5 = full, back to 1 = new. */
  cycle: number;
  /** How much of the face is lit, 0-1. */
  illumination: number;
  name: string;
  /** Whole days until the next full moon (0 when it's full tonight). */
  daysToFull: number;
}

export function moonPhase(at: number): MoonPhase {
  const age = ((((at - NEW_MOON_2000) / DAY) % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH;
  const cycle = age / SYNODIC_MONTH;
  const illumination = (1 - Math.cos(2 * Math.PI * cycle)) / 2;
  const name = PHASE_NAMES[Math.floor(cycle * 8 + 0.5) % 8];
  const toFull = (SYNODIC_MONTH / 2 - age + SYNODIC_MONTH) % SYNODIC_MONTH;
  return { cycle, illumination, name, daysToFull: name === 'Full moon' ? 0 : Math.max(1, Math.round(toFull)) };
}

/**
 * The lit part of the moon as an SVG path, for a moon of radius r at (cx, cy).
 * The lit edge is a half circle; the shadow's edge is half an ellipse.
 */
export function moonLitPath(cycle: number, cx: number, cy: number, r: number): string {
  const rx = Math.abs(Math.cos(2 * Math.PI * cycle)) * r;
  const waxing = cycle < 0.5;
  const crescent = cycle < 0.25 || cycle > 0.75;
  const edge = waxing ? 1 : 0;
  const terminator = waxing ? (crescent ? 0 : 1) : crescent ? 1 : 0;
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(cx)} ${f(cy - r)}A${f(r)} ${f(r)} 0 0 ${edge} ${f(cx)} ${f(cy + r)}A${f(rx)} ${f(r)} 0 0 ${terminator} ${f(cx)} ${f(cy - r)}Z`;
}

export interface SunDay {
  state: 'before' | 'day' | 'after';
  /** 0 at sunrise to 1 at sunset. */
  progress: number;
  daylightMs: number;
  /** Daylight left, or 0 when the sun is down. */
  leftMs: number;
}

export function sunDay(sunrise: string, sunset: string, now: number): SunDay {
  const rise = new Date(sunrise).getTime();
  const set = new Date(sunset).getTime();
  const daylightMs = Math.max(0, set - rise);
  const state = now < rise ? 'before' : now > set ? 'after' : 'day';
  const progress = daylightMs ? Math.min(1, Math.max(0, (now - rise) / daylightMs)) : 0;
  return { state, progress, daylightMs, leftMs: state === 'day' ? set - now : 0 };
}

export interface YearProgress {
  year: number;
  /** 1 on 1 January. */
  day: number;
  days: number;
  /** 0-1, counting today as half done. */
  fraction: number;
}

export function yearProgress(at: Date): YearProgress {
  const year = at.getFullYear();
  const start = new Date(year, 0, 1).getTime();
  const days = Math.round((new Date(year + 1, 0, 1).getTime() - start) / DAY);
  const day = Math.floor((new Date(year, at.getMonth(), at.getDate()).getTime() - start) / DAY + 0.5) + 1;
  return { year, day, days, fraction: (day - 0.5) / days };
}

/** "10h 48m", "52m". */
export function hoursMinutes(ms: number): string {
  const total = Math.round(ms / 60_000);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}
