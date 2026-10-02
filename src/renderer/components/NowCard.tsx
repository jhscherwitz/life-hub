import { nowFocus } from '../../shared/focus';
import { formatDuration, formatTime, isSameDay, nextEvent } from '../../shared/time';
import type { DashboardSnapshot } from '../../shared/types';

/**
 * What to be doing right now, from your calendar and task list: the meeting
 * you're in, when to leave, a call about to start, or your top task and how
 * long you're free.
 */
export function NowCard({ snapshot, now }: { snapshot: DashboardSnapshot; now: number }) {
  const focus = nowFocus(snapshot, now);
  const today = snapshot.events.filter((e) => isSameDay(e.start, new Date(now)) && !e.allDay);
  const next = nextEvent(today, now);
  // Don't repeat the next meeting on the right when it's already the headline.
  const showNext = next && !(focus.tone === 'meeting' && focus.headline === next.title);

  return (
    <section className={`card now-card now-${focus.tone}`}>
      <div className="now-main">
        <span className="eyebrow">Now · {focus.label}</span>
        <h2 className="now-title">{focus.headline}</h2>
        {focus.detail && <p className="muted">{focus.detail}</p>}
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
      </div>
      {showNext && (
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
