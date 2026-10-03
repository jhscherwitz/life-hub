// The Christmas countdown: days (and sleeps) to go, and how many lights on
// the tree are on. Half the tree fills up over the year, from Boxing Day on;
// in the last twelve days a new bulb comes on every day until it's full.

const DAY = 86_400_000;

/** How many bulbs the tree has. */
export const LIGHTS = 24;

export interface ChristmasView {
  /** Whole days until Christmas Day (0 on the day). */
  days: number;
  /** Nights left to sleep. Same as days, but feels better. */
  sleeps: number;
  /** Milliseconds until midnight starting Christmas Day (0 on the day). */
  msLeft: number;
  isChristmas: boolean;
  /** Christmas Eve: one sleep left. */
  isEve: boolean;
  /** How many of the LIGHTS are on. */
  lit: number;
  /** Christmas Day this time round, local midnight. */
  date: Date;
}

function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function christmas(nowMs: number): ChristmasView {
  const now = new Date(nowMs);
  const today = midnight(now);
  let date = new Date(now.getFullYear(), 11, 25);
  // After Christmas Day, count to next year's.
  if (today > date) date = new Date(now.getFullYear() + 1, 11, 25);
  const days = Math.round((date.getTime() - today.getTime()) / DAY);
  const lastBoxingDay = new Date(date.getFullYear() - 1, 11, 26);
  const span = Math.round((date.getTime() - lastBoxingDay.getTime()) / DAY);
  const progress = Math.min(1, Math.max(0, 1 - days / span));
  // Half the tree lights up slowly over the year; then, in the last days, a new bulb every day until it's full.
  const lit = days === 0 ? LIGHTS : Math.max(Math.floor(progress * (LIGHTS / 2)), LIGHTS - days);
  return {
    days,
    sleeps: days,
    msLeft: Math.max(0, date.getTime() - nowMs),
    isChristmas: days === 0,
    isEve: days === 1,
    lit,
    date,
  };
}

/** "12:04:09" until Christmas, or days and hours when it's far off. */
export function christmasClock(msLeft: number): string {
  const total = Math.floor(msLeft / 1000);
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return d > 0 ? `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s` : `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** A short, cheerful line for where we are in the season. */
export function christmasLine(v: ChristmasView): string {
  if (v.isChristmas) return 'Merry Christmas!';
  if (v.isEve) return 'Christmas Eve. One more sleep!';
  if (v.days <= 7) return 'Almost here. Wrap those presents.';
  if (v.days <= LIGHTS / 2) return 'A new light on the tree every day now.';
  if (v.days <= 24) return 'Advent! The countdown is on.';
  if (v.days <= 60) return 'Time to start the list.';
  if (v.days >= 355) return 'That was fun. Here we go again.';
  return 'Every day the tree gets a little brighter.';
}
