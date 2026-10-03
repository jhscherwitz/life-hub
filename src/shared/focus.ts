import { currentEvent, formatDuration, formatTime, isSameDay, localIsoDate, nextEvent } from './time';
import type { DashboardSnapshot, Task } from './types';

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * The task to work on next: overdue first, then due today, then by priority,
 * then the oldest due date. Tasks due on a later day only count if nothing is
 * due sooner.
 */
export function topTask(tasks: Task[], now = new Date()): Task | undefined {
  const today = localIsoDate(now);
  const bucket = (t: Task) => {
    const due = t.due?.slice(0, 10);
    if (!due) return 2;
    if (due < today) return 0;
    if (due === today) return 1;
    return 3;
  };
  return tasks
    .filter((t) => !t.done)
    .sort(
      (a, b) =>
        bucket(a) - bucket(b) ||
        PRIORITY_RANK[a.priority ?? 'low'] - PRIORITY_RANK[b.priority ?? 'low'] ||
        (a.due ?? '').localeCompare(b.due ?? ''),
    )[0];
}

/** Open tasks due today or earlier (tasks with no date count as today's). */
export function tasksDueBy(tasks: Task[], now = new Date()): Task[] {
  const today = localIsoDate(now);
  return tasks.filter((t) => !t.done && (!t.due || t.due.slice(0, 10) <= today));
}

/** Within this long of a meeting, the Now card switches to getting ready for it. */
const STARTING_SOON_MS = 10 * 60_000;

export interface Focus {
  label: string;
  headline: string;
  detail?: string;
  /** Video call to join. */
  joinUrl?: string;
  /** The task shown, so it can be ticked off from the card. */
  taskId?: string;
  tone: 'meeting' | 'task' | 'clear';
}

/**
 * What to be doing right now, from the real calendar and the task list: the
 * meeting you're in, a call about to start, or otherwise your top task and
 * how long you're free.
 */
export function nowFocus(snapshot: Pick<DashboardSnapshot, 'events' | 'tasks'>, now: number): Focus {
  const day = new Date(now);
  const today = snapshot.events.filter((e) => isSameDay(e.start, day) && !e.allDay);
  const current = currentEvent(today, now);
  const next = nextEvent(today, now);
  const task = topTask(snapshot.tasks, day);
  const untilNext = next ? new Date(next.start).getTime() - now : Infinity;

  if (current) {
    const left = new Date(current.end).getTime() - now;
    return {
      label: 'In progress',
      headline: current.title,
      detail: `Ends at ${formatTime(current.end)}, ${formatDuration(left)} left`,
      joinUrl: current.meetingUrl,
      tone: 'meeting',
    };
  }
  if (next && untilNext <= STARTING_SOON_MS) {
    return {
      label: `Starts in ${formatDuration(untilNext)}`,
      headline: next.title,
      detail: `At ${formatTime(next.start)}${next.location ? ` · ${next.location}` : ''}`,
      joinUrl: next.meetingUrl,
      tone: 'meeting',
    };
  }
  if (task) {
    const due = task.due?.slice(0, 10);
    const overdue = due !== undefined && due < localIsoDate(day);
    return {
      label: next ? `Free for ${formatDuration(untilNext)}` : 'Free for the rest of the day',
      headline: task.title,
      detail: overdue ? 'Your top task · overdue' : 'Your top task',
      taskId: task.id,
      tone: 'task',
    };
  }
  return {
    label: next ? `Free for ${formatDuration(untilNext)}` : 'All clear',
    headline: next ? 'No open tasks' : 'Nothing scheduled and no open tasks',
    tone: 'clear',
  };
}
