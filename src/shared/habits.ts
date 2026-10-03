// Daily tasks: the same short list every day, ticked off and reset at midnight.
// Each task is a star; ticking it lights the star. Together they make a small
// constellation whose shape comes from the tasks themselves.

export interface Habit {
  id: string;
  title: string;
}

export interface HabitState {
  habits: Habit[];
  /** "YYYY-MM-DD" -> the ids done that day. */
  days: Record<string, string[]>;
}

export const MAX_HABITS = 8;
/** Days of history kept, enough for streaks and the week strip. */
export const KEEP_DAYS = 60;
const MAX_TITLE = 60;

export function defaultHabits(): HabitState {
  return {
    habits: [
      { id: 'water', title: 'Drink water' },
      { id: 'move', title: 'Move for 20 min' },
      { id: 'read', title: 'Read 10 pages' },
      { id: 'outside', title: 'Get outside' },
      { id: 'phone', title: 'No phone in bed' },
    ],
    days: {},
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Cleans up saved data; anything unreadable falls back to the starter list. */
export function normalizeHabits(value: unknown): HabitState {
  const v = value as Partial<HabitState> | null;
  if (!v || !Array.isArray(v.habits)) return defaultHabits();
  const habits: Habit[] = [];
  for (const h of v.habits) {
    const id = (h as Habit)?.id;
    const title = (h as Habit)?.title;
    if (typeof id !== 'string' || typeof title !== 'string' || !title.trim()) continue;
    if (habits.some((x) => x.id === id)) continue;
    habits.push({ id, title: title.trim().slice(0, MAX_TITLE) });
  }
  const days: Record<string, string[]> = {};
  if (v.days && typeof v.days === 'object') {
    for (const [day, ids] of Object.entries(v.days)) {
      if (ISO_DAY.test(day) && Array.isArray(ids)) days[day] = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
    }
  }
  return { habits: habits.slice(0, MAX_HABITS), days };
}

/** The day `n` days after (or before, if negative) a "YYYY-MM-DD" day. */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + n));
  return date.toISOString().slice(0, 10);
}

function prune(days: Record<string, string[]>, today: string): Record<string, string[]> {
  const oldest = shiftDay(today, -KEEP_DAYS);
  return Object.fromEntries(Object.entries(days).filter(([day, ids]) => day > oldest && ids.length > 0));
}

export function toggleHabit(state: HabitState, id: string, today: string): HabitState {
  if (!state.habits.some((h) => h.id === id)) return state;
  const done = state.days[today] ?? [];
  const next = done.includes(id) ? done.filter((x) => x !== id) : [...done, id];
  return { ...state, days: prune({ ...state.days, [today]: next }, today) };
}

export function addHabit(state: HabitState, title: string, id: string): HabitState {
  const clean = title.trim().slice(0, MAX_TITLE);
  if (!clean || state.habits.length >= MAX_HABITS || state.habits.some((h) => h.id === id)) return state;
  return { ...state, habits: [...state.habits, { id, title: clean }] };
}

export function renameHabit(state: HabitState, id: string, title: string): HabitState {
  const clean = title.trim().slice(0, MAX_TITLE);
  if (!clean) return state;
  return { ...state, habits: state.habits.map((h) => (h.id === id ? { ...h, title: clean } : h)) };
}

/** Removes a task and its history. */
export function removeHabit(state: HabitState, id: string): HabitState {
  const days = Object.fromEntries(Object.entries(state.days).map(([day, ids]) => [day, ids.filter((x) => x !== id)]));
  return { habits: state.habits.filter((h) => h.id !== id), days };
}

/**
 * Days in a row a task was done. Today counts once it's ticked; until then the
 * streak from yesterday is still alive.
 */
export function streak(state: HabitState, id: string, today: string): number {
  const doneOn = (day: string) => state.days[day]?.includes(id) ?? false;
  let day = doneOn(today) ? today : shiftDay(today, -1);
  let count = 0;
  while (doneOn(day)) {
    count++;
    day = shiftDay(day, -1);
  }
  return count;
}

/** A small hash, so each task gets the same spot in the sky every day. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seeded(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export interface Star {
  id: string;
  /** 0-100 across. */
  x: number;
  /** 0-100 down. */
  y: number;
}

/**
 * Where each task's star sits. Stars are spread left to right in list order
 * and nudged up or down by the task's id, then kept apart from each other.
 */
export function starMap(ids: string[]): Star[] {
  const stars: Star[] = [];
  const n = ids.length;
  ids.forEach((id, i) => {
    const rand = seeded(hash(id));
    const slot = n === 1 ? 50 : 10 + (80 * i) / (n - 1);
    let best: Star = { id, x: slot, y: 50 };
    let bestGap = -1;
    // Try a few spots and keep the one furthest from the stars so far.
    for (let tries = 0; tries < 8; tries++) {
      const spot = { id, x: slot + (rand() - 0.5) * (60 / Math.max(n, 2)), y: 14 + rand() * 72 };
      const gap = Math.min(Infinity, ...stars.map((s) => Math.hypot(s.x - spot.x, (s.y - spot.y) * 0.6)));
      if (gap > bestGap) {
        best = spot;
        bestGap = gap;
      }
      if (gap > 22) break;
    }
    stars.push({ id, x: Math.round(best.x * 10) / 10, y: Math.round(best.y * 10) / 10 });
  });
  return stars;
}

export interface HabitView {
  id: string;
  title: string;
  done: boolean;
  streak: number;
  /** The last 7 days, oldest first, ending today. */
  week: boolean[];
}

export interface HabitsView {
  today: string;
  habits: HabitView[];
  stars: Star[];
  /** Lines between neighbouring stars; `lit` when both ends are done. */
  links: { from: string; to: string; lit: boolean }[];
  done: number;
  total: number;
  /** Days in a row every task was done (today counts once it's complete). */
  perfectStreak: number;
}

export function habitsView(state: HabitState, today: string): HabitsView {
  const doneToday = new Set(state.days[today] ?? []);
  const habits = state.habits.map((h) => ({
    id: h.id,
    title: h.title,
    done: doneToday.has(h.id),
    streak: streak(state, h.id, today),
    week: Array.from({ length: 7 }, (_, i) => state.days[shiftDay(today, i - 6)]?.includes(h.id) ?? false),
  }));
  const stars = starMap(state.habits.map((h) => h.id));
  const links = stars.slice(1).map((s, i) => ({ from: stars[i].id, to: s.id, lit: doneToday.has(stars[i].id) && doneToday.has(s.id) }));

  const allDone = (day: string) => state.habits.length > 0 && state.habits.every((h) => state.days[day]?.includes(h.id));
  let day = allDone(today) ? today : shiftDay(today, -1);
  let perfectStreak = 0;
  while (allDone(day) && perfectStreak < KEEP_DAYS) {
    perfectStreak++;
    day = shiftDay(day, -1);
  }

  return { today, habits, stars, links, done: habits.filter((h) => h.done).length, total: habits.length, perfectStreak };
}
