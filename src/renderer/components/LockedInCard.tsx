import { Card } from './Card';
import { Icon } from './Icon';

/** Jacob's focus timer site: countdown, stopwatch and Pomodoro, brain breaks, and study-together. */
export const LOCKEDIN_URL = 'https://jhscherwitz.github.io/lockedin/';

export function openLockedIn(): void {
  window.hub.openExternal(LOCKEDIN_URL);
}

/** The focus widget: one click to LockedIn in the browser. F does the same from anywhere. */
export function LockedInCard() {
  return (
    <Card title="Focus" className="lockedin-card">
      <p className="lockedin-name">LockedIn</p>
      <p className="muted">Timer, Pomodoro, brain breaks and study together, in your browser.</p>
      <div className="now-actions">
        <button className="button button-primary" onClick={openLockedIn}>
          Open LockedIn <Icon name="external" size={14} />
        </button>
      </div>
      <p className="muted small lockedin-hint">
        Or press <kbd>F</kbd> anywhere in Life Hub.
      </p>
    </Card>
  );
}
