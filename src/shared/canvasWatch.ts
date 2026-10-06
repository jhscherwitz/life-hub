// Keeping Canvas and the rest of Life Hub in step: assignments become tasks
// (ticked off once they're turned in), and new announcements and changed
// grades become alerts. Pure, so it can be tested without Canvas.

import type { CanvasAssignment, CanvasCourse } from './canvas';
import type { Task } from './types';

const DAY = 24 * 60 * 60 * 1000;
/** Assignments due this far ahead become tasks. */
export const CANVAS_TASK_DAYS = 14;

export interface CanvasAnnouncement {
  id: string;
  title: string;
  courseId: string;
  postedAt: string;
  url: string;
}

export interface CanvasWatchState {
  /** Canvas assignment id → the task made for it. Kept after the task is deleted, so it isn't made again. */
  links: Record<string, string>;
  /** Each class's score last time, to notice a change. */
  scores: Record<string, number | null>;
  /** Announcements already seen. */
  seen: string[];
  /** False until the first check, which only takes note of what's there. */
  started: boolean;
}

export const emptyCanvasWatch = (): CanvasWatchState => ({ links: {}, scores: {}, seen: [], started: false });

export function normalizeCanvasWatch(raw: unknown): CanvasWatchState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<CanvasWatchState>;
  return {
    links: r.links && typeof r.links === 'object' ? { ...r.links } : {},
    scores: r.scores && typeof r.scores === 'object' ? { ...r.scores } : {},
    seen: Array.isArray(r.seen) ? r.seen.filter((s): s is string => typeof s === 'string').slice(-500) : [],
    started: r.started === true,
  };
}

/** The task's name for an assignment: "Lab report 3 (BIO 1404)". */
export function canvasTaskTitle(a: CanvasAssignment): string {
  return a.courseName ? `${a.title} (${a.courseName})` : a.title;
}

/**
 * Which assignments to add as tasks, and which tasks to tick off because the
 * work was turned in. Work already past due, more than two weeks out, or
 * already linked (even if you deleted its task) is left alone.
 */
export function planCanvasTasks(
  assignments: CanvasAssignment[],
  links: Record<string, string>,
  tasks: Task[],
  now: Date,
): { add: CanvasAssignment[]; complete: string[] } {
  const add: CanvasAssignment[] = [];
  const complete: string[] = [];
  for (const a of assignments) {
    const linked = links[a.id];
    if (linked) {
      const task = tasks.find((t) => t.id === linked);
      if (a.submitted && task && !task.done) complete.push(task.id);
      continue;
    }
    if (a.submitted || a.kind === 'other') continue;
    const due = Date.parse(a.due);
    if (Number.isNaN(due) || due < now.getTime() || due > now.getTime() + CANVAS_TASK_DAYS * DAY) continue;
    add.push(a);
  }
  return { add, complete };
}

export interface CanvasAlert {
  title: string;
  body: string;
  url?: string;
}

/**
 * New announcements and changed grades since last time. The first check only
 * remembers what's there, so connecting Canvas doesn't set off a pile of alerts.
 */
export function canvasNews(
  state: CanvasWatchState,
  courses: CanvasCourse[],
  announcements: CanvasAnnouncement[],
): { alerts: CanvasAlert[]; state: CanvasWatchState } {
  const alerts: CanvasAlert[] = [];
  const scores: Record<string, number | null> = { ...state.scores };
  for (const c of courses) {
    const before = state.scores[c.id];
    if (state.started && before !== undefined && c.score !== null && before !== c.score) {
      const up = before === null || c.score > before;
      alerts.push({
        title: `Grade ${before === null ? 'posted' : up ? 'went up' : 'went down'} in ${c.name}`,
        body: `${before === null ? '' : `${round(before)}% → `}${round(c.score)}%${c.grade ? ` (${c.grade})` : ''}`,
        url: c.url,
      });
    }
    scores[c.id] = c.score;
  }
  const seen = new Set(state.seen);
  const names = new Map(courses.map((c) => [c.id, c.name]));
  for (const a of announcements) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    if (state.started) alerts.push({ title: `New announcement in ${names.get(a.courseId) ?? 'a class'}`, body: a.title, url: a.url });
  }
  return { alerts, state: { ...state, scores, seen: [...seen].slice(-500), started: true } };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** "Due this week: Lab report (BIO), Quiz 4 (CHEM)" for the briefing, or null. */
export function dueThisWeek(assignments: CanvasAssignment[], now: Date): string | null {
  const soon = assignments
    .filter((a) => !a.submitted && Date.parse(a.due) >= now.getTime() && Date.parse(a.due) <= now.getTime() + 7 * DAY)
    .sort((a, b) => Date.parse(a.due) - Date.parse(b.due));
  if (!soon.length) return null;
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short' });
  return soon.slice(0, 8).map((a) => `${canvasTaskTitle(a)}, ${day(a.due)}`).join('; ');
}
