import { nowFocus } from '../../shared/focus';
import type { DashboardSnapshot, FocusSession } from '../../shared/types';
import { Card } from '../components/Card';
import { NowCard } from '../components/NowCard';

const LENGTHS = [15, 25, 50];

/** Start a focus session of any length, or watch the one that's running. */
export function FocusPage({ snapshot, now, focusSession }: { snapshot: DashboardSnapshot; now: number; focusSession: FocusSession | null }) {
  const label = nowFocus(snapshot, now).headline;
  return (
    <div className="page-grid">
      <div className="span-8">
        <NowCard snapshot={snapshot} now={now} focusSession={focusSession} />
      </div>
      <Card title="Start a focus session" className="span-4">
        <p className="muted">Pick a length. Life Hub counts down here and in the tray, and tells you when time's up.</p>
        <div className="focus-lengths">
          {LENGTHS.map((minutes) => (
            <button key={minutes} className="button" disabled={!window.hub.startFocus} onClick={() => void window.hub.startFocus(minutes, label)}>
              {minutes} min
            </button>
          ))}
        </div>
        <p className="muted small">Shortcut: press F on any page to start or stop 25 minutes.</p>
      </Card>
    </div>
  );
}
