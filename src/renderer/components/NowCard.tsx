import { nowFocus } from '../../shared/focus';
import { currentEvent, formatDuration, formatTime, isSameDay, nextEvent } from '../../shared/time';
import type { DashboardSnapshot } from '../../shared/types';
import { Icon } from './Icon';

/**
 * What to be doing right now, from your calendar and task list: the meeting
 * you're in, when to leave, a call about to start, or your top task and how
 * long you're free.
 */
export function NowCard({ snapshot, now }: { snapshot: DashboardSnapshot; now: number }) {
  const focus = nowFocus(snapshot, now);
  const today = snapshot.events.filter((e) => isSameDay(e.start, new Date(now)) && !e.allDay);
  const next = nextEvent(today, now);
  const current = focus.tone === 'meeting' ? currentEvent(today, now) : undefined;
  const progress = current
    ? Math.min(1, (now - new Date(current.start).getTime()) / (new Date(current.end).getTime() - new Date(current.start).getTime()))
    : null;
  // Don't repeat the next meeting on the right when it's already the headline.
  const showNext = next && !(focus.tone === 'meeting' && focus.headline === next.title);

  return (
    <section className={`card now-card now-${focus.tone}`}>
      <div className="now-main">
        <span className="eyebrow now-eyebrow">
          <span className="live-dot" />
          Now · {focus.label}
        </span>
        <h2 className="now-title">{focus.headline}</h2>
        {focus.detail && <p className="now-detail">{focus.detail}</p>}
        {progress !== null && (
          <div className="now-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        <div className="now-actions">
          {focus.joinUrl && (
            <button className="button button-primary" onClick={() => window.hub.openExternal(focus.joinUrl!)}>
              <Icon name="video" size={14} />
              Join call
            </button>
          )}
          {focus.taskId && (
            <button className="button" onClick={() => void window.hub.setTaskDone(focus.taskId!, true)}>
              <Icon name="check" size={14} />
              Mark done
            </button>
          )}
        </div>
      </div>
      {showNext && (
        <div className="now-next">
          <span className="eyebrow">Up next</span>
          <strong>{next.title}</strong>
          <span className="countdown">
            <span className="countdown-in">in</span> {formatDuration(new Date(next.start).getTime() - now)}
          </span>
          <span className="muted small">
            {formatTime(next.start)}
            {next.location ? ` · ${next.location}` : ''}
          </span>
        </div>
      )}
    </section>
  );
}
