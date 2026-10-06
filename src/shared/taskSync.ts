// Two-way sync between Life Hub's tasks and Google Tasks ("My Tasks"). Each
// pair is remembered with how it looked at the last sync, so whichever side
// changed since then wins (Google, if both did). Pure, so it can be tested.

import type { Task } from './types';

/** A task as Google Tasks has it. */
export interface GoogleTask {
  id: string;
  title: string;
  done: boolean;
  /** "YYYY-MM-DD" (Google keeps only the day). */
  due?: string;
  deleted?: boolean;
}

/** What both sides agreed on at the last sync. */
export interface SyncedState {
  title: string;
  done: boolean;
  /** "YYYY-MM-DD". */
  due?: string;
}

export interface TaskLink {
  local: string;
  google: string;
  last: SyncedState;
}

export type SyncOp =
  | { kind: 'push-new'; local: Task }
  | { kind: 'pull-new'; google: GoogleTask }
  | { kind: 'push'; link: TaskLink; state: SyncedState }
  | { kind: 'pull'; link: TaskLink; state: SyncedState }
  | { kind: 'delete-google'; link: TaskLink }
  | { kind: 'delete-local'; link: TaskLink }
  | { kind: 'keep'; link: TaskLink; state: SyncedState }
  /** The same task already on both sides (same name): link them instead of making copies. */
  | { kind: 'pair'; local: Task; google: GoogleTask };

/** Just the day of a due date ("2026-10-08T15:00:00…" → "2026-10-08"). */
export function dueDay(due: string | undefined): string | undefined {
  if (!due) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return undefined;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const stateOfLocal = (t: Task): SyncedState => ({ title: t.title.trim(), done: t.done, ...(dueDay(t.due) && { due: dueDay(t.due) }) });
export const stateOfGoogle = (g: GoogleTask): SyncedState => ({ title: g.title.trim(), done: g.done, ...(g.due && { due: g.due }) });
const same = (a: SyncedState, b: SyncedState) => a.title === b.title && a.done === b.done && (a.due ?? '') === (b.due ?? '');

/** How long finished tasks are still copied over. Older ones stay where they are. */
const RECENT_DONE_DAYS = 7;

/**
 * Works out what to do to bring both sides in step. New tasks go both ways
 * (finished ones only if recent); deleting on one side deletes on the other.
 */
export function planTaskSync(locals: Task[], googles: GoogleTask[], links: TaskLink[], now = new Date()): SyncOp[] {
  const ops: SyncOp[] = [];
  const localById = new Map(locals.map((t) => [t.id, t]));
  const googleById = new Map(googles.filter((g) => !g.deleted).map((g) => [g.id, g]));
  const linkedLocal = new Set(links.map((l) => l.local));
  const linkedGoogle = new Set(links.map((l) => l.google));

  for (const link of links) {
    const local = localById.get(link.local);
    const google = googleById.get(link.google);
    if (!local && !google) continue;
    if (!local) {
      ops.push({ kind: 'delete-google', link });
      continue;
    }
    if (!google) {
      ops.push({ kind: 'delete-local', link });
      continue;
    }
    const l = stateOfLocal(local);
    const g = stateOfGoogle(google);
    if (same(l, g)) ops.push({ kind: 'keep', link, state: g });
    else if (!same(g, link.last)) ops.push({ kind: 'pull', link, state: g });
    else ops.push({ kind: 'push', link, state: l });
  }

  const recent = (done: boolean, at?: string) => !done || (at !== undefined && now.getTime() - Date.parse(at) < RECENT_DONE_DAYS * 86_400_000);
  const name = (s: string) => s.trim().toLowerCase();
  const freeGoogle = [...googleById.values()].filter((g) => !linkedGoogle.has(g.id) && g.title.trim());
  for (const t of locals) {
    if (linkedLocal.has(t.id) || !t.title.trim()) continue;
    const twin = freeGoogle.findIndex((g) => name(g.title) === name(t.title));
    if (twin >= 0) ops.push({ kind: 'pair', local: t, google: freeGoogle.splice(twin, 1)[0] });
    else if (recent(t.done, t.completedAt)) ops.push({ kind: 'push-new', local: t });
  }
  for (const g of freeGoogle) if (!g.done) ops.push({ kind: 'pull-new', google: g });
  return ops;
}
