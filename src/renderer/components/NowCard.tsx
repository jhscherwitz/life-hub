import { nowFocus } from '../../shared/focus';
import { currentEvent, formatTime, isSameDay } from '../../shared/time';
import type { DashboardSnapshot, FocusSession } from '../../shared/types';
import { useNow } from '../hooks';

/** Default length of a focus session, in minutes. */
export const FOCUS_MINUTES = 25;

/** "18:22": minutes and seconds left. */
function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** The Now block during a focus session: a big countdown, ticking every second. */
function FocusBlock({ session }: { session: FocusSession }) {
  const now = useNow(1000);
  const start = new Date(session.startedAt).getTime();
  const end = new Date(session.endsAt).getTime();
  const progress = Math.min(1, Math.max(0, (now - start) / (end - start)));

  return (
    <section className="now now-focus">
      <header className="label-row">
        <h2>■ Focus · {session.label}</h2>
        <span className="label-meta">Until {formatTime(session.endsAt)}</span>
      </header>
      <p className="now-title now-countdown">{mmss(end - now)}</p>
      <div className="now-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="now-actions">
        <button className="button button-dark" onClick={() => void window.hub.stopFocus()}>
          Stop focus
        </button>
      </div>
    </section>
  );
}

/**
 * What to be doing right now, from your calendar and task list: the meeting
 * you're in, when to leave, a call about to start, or your top task and how
 * long you're free. The one bright block on the page. During a focus session
 * it turns into the countdown.
 */
export function NowCard({ snapshot, now, focusSession }: { snapshot: DashboardSnapshot; now: number; focusSession: FocusSession | null }) {
  const focus = nowFocus(snapshot, now);
  const today = snapshot.events.filter((e) => isSameDay(e.start, new Date(now)) && !e.allDay);
  const current = focus.tone === 'meeting' ? currentEvent(today, now) : undefined;
  const progress = current
    ? Math.min(1, (now - new Date(current.start).getTime()) / (new Date(current.end).getTime() - new Date(current.start).getTime()))
    : null;

  if (focusSession) return <FocusBlock session={focusSession} />;

  return (
    <section className={`now now-${focus.tone}`}>
      <header className="label-row">
        <h2>■ Now · {focus.label}</h2>
        {current && (
          <span className="label-meta">
            {formatTime(current.start)}–{formatTime(current.end)}
          </span>
        )}
      </header>
      <p className="now-title">{focus.headline}</p>
      {focus.detail && <p className="now-detail">{focus.detail}</p>}
      {progress !== null && (
        <div className="now-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      <div className="now-actions">
        {focus.joinUrl && (
          <button className="button button-dark" onClick={() => window.hub.openExternal(focus.joinUrl!)}>
            Join call
          </button>
        )}
        {focus.taskId && (
          <button className="button button-dark" onClick={() => void window.hub.setTaskDone(focus.taskId!, true)}>
            Mark done
          </button>
        )}
        {window.hub.startFocus && (
          <button className="button button-dark" onClick={() => void window.hub.startFocus(FOCUS_MINUTES, focus.headline)} title="Start a focus timer (F)">
            Focus {FOCUS_MINUTES} min <kbd>F</kbd>
          </button>
        )}
      </div>
    </section>
  );
}
