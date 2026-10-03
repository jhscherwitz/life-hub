import { nowFocus } from '../../shared/focus';
import { currentEvent, isSameDay } from '../../shared/time';
import type { DashboardSnapshot } from '../../shared/types';

/**
 * What to be doing right now, from your calendar and task list: the meeting
 * you're in, a call about to start, or your top task and how long you're free.
 */
export function NowCard({ snapshot, now }: { snapshot: DashboardSnapshot; now: number }) {
  const focus = nowFocus(snapshot, now);
  const today = snapshot.events.filter((e) => isSameDay(e.start, new Date(now)) && !e.allDay);
  const current = focus.tone === 'meeting' ? currentEvent(today, now) : undefined;
  const progress = current
    ? Math.min(1, (now - new Date(current.start).getTime()) / (new Date(current.end).getTime() - new Date(current.start).getTime()))
    : null;

  return (
    <section className={`card now-card now-${focus.tone}`}>
      <p className="now-kicker">● Now · {focus.label}</p>
      <p className="now-title">{focus.headline}</p>
      {focus.detail && <p className="now-detail">{focus.detail}</p>}
      {progress !== null && (
        <div className="now-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {(focus.joinUrl || focus.taskId) && (
        <div className="now-actions">
          {focus.joinUrl && (
            <button className="button button-primary" onClick={() => window.hub.openExternal(focus.joinUrl!)}>
              Join call
            </button>
          )}
          {focus.taskId && (
            <button className="button" onClick={() => void window.hub.setTaskDone(focus.taskId!, true)}>
              Mark done
            </button>
          )}
        </div>
      )}
    </section>
  );
}
