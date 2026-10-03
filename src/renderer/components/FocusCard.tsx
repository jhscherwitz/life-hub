import { nowFocus } from '../../shared/focus';
import { formatTime } from '../../shared/time';
import type { DashboardSnapshot, FocusSession } from '../../shared/types';
import { useNow } from '../hooks';
import { Card } from './Card';

/** Default length of a focus session (and of the F shortcut), in minutes. */
export const FOCUS_MINUTES = 25;
const LENGTHS = [15, FOCUS_MINUTES, 50];

/** "18:22": minutes and seconds left. */
function mmss(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** A running session: a big countdown, ticking every second. */
function Countdown({ session }: { session: FocusSession }) {
  const now = useNow(1000);
  const start = new Date(session.startedAt).getTime();
  const end = new Date(session.endsAt).getTime();
  const progress = Math.min(1, Math.max(0, (now - start) / (end - start)));
  return (
    <>
      <p className="focus-time">{mmss(end - now)}</p>
      <p className="muted focus-label">
        {session.label} · until {formatTime(session.endsAt)}
      </p>
      <div className="now-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${progress * 100}%` }} />
      </div>
      <div className="now-actions">
        <button className="button" onClick={() => void window.hub.stopFocus()}>
          Stop
        </button>
      </div>
    </>
  );
}

/** The focus timer: pick a length to start, then watch it count down. F starts or stops 25 minutes. */
export function FocusCard({ snapshot, now, session }: { snapshot: DashboardSnapshot; now: number; session: FocusSession | null }) {
  // Missing when the screen updated but the rest of Life Hub is still the old version.
  const available = Boolean(window.hub.startFocus);
  const label = nowFocus(snapshot, now).headline;
  return (
    <Card title="Focus timer" className={`focus-card ${session ? 'is-running' : ''}`}>
      {session ? (
        <Countdown session={session} />
      ) : (
        <>
          <p className="muted focus-label">Block out distractions for a while. Life Hub counts down here and in the tray.</p>
          <div className="focus-lengths">
            {LENGTHS.map((minutes) => (
              <button
                key={minutes}
                className={`button ${minutes === FOCUS_MINUTES ? 'button-primary' : ''}`}
                disabled={!available}
                onClick={() => void window.hub.startFocus(minutes, label)}
              >
                {minutes} min
              </button>
            ))}
          </div>
          <p className="muted small">
            Or press <kbd>F</kbd> anywhere for {FOCUS_MINUTES} minutes.
          </p>
        </>
      )}
    </Card>
  );
}
