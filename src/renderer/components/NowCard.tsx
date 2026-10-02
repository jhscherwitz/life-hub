import { currentEvent, formatDuration, formatTime, isSameDay, nextEvent } from '../../shared/time';
import type { DashboardSnapshot, Task } from '../../shared/types';

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function topTask(tasks: Task[]): Task | undefined {
  return tasks
    .filter((t) => !t.done)
    .sort((a, b) => (PRIORITY_RANK[a.priority ?? 'low'] - PRIORITY_RANK[b.priority ?? 'low']) || (a.due ?? '').localeCompare(b.due ?? ''))[0];
}

/**
 * What to be doing right now: the current meeting if there is one, otherwise
 * the top task with however much free time there is before the next meeting.
 */
export function NowCard({ snapshot, now }: { snapshot: DashboardSnapshot; now: number }) {
  const today = snapshot.events.filter((e) => isSameDay(e.start, new Date(now)));
  const current = currentEvent(today, now);
  const next = nextEvent(today, now);
  const task = topTask(snapshot.tasks);

  let label: string;
  let headline: string;
  let detail: string | null = null;
  let link: string | undefined;

  if (current) {
    label = 'In progress';
    headline = current.title;
    detail = `Ends at ${formatTime(current.end)}, ${formatDuration(new Date(current.end).getTime() - now)} left`;
    link = current.meetingUrl;
  } else if (task) {
    label = next ? `Free for ${formatDuration(new Date(next.start).getTime() - now)}` : 'Free for the rest of the day';
    headline = task.title;
    detail = 'Your top task';
  } else {
    label = 'All clear';
    headline = 'Nothing scheduled and no open tasks';
  }

  return (
    <section className="card now-card">
      <div className="now-main">
        <span className="eyebrow">Now · {label}</span>
        <h2 className="now-title">{headline}</h2>
        {detail && <p className="muted">{detail}</p>}
        {link && (
          <button className="button button-primary" onClick={() => window.hub.openExternal(link!)}>
            Join call
          </button>
        )}
      </div>
      {next && (
        <div className="now-next">
          <span className="eyebrow">Up next</span>
          <strong>{next.title}</strong>
          <span className="countdown">in {formatDuration(new Date(next.start).getTime() - now)}</span>
          <span className="muted small">
            {formatTime(next.start)}
            {next.location ? ` · ${next.location}` : ''}
          </span>
        </div>
      )}
    </section>
  );
}
