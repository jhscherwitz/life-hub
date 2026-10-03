import { useState } from 'react';
import { formatTime } from '../../shared/time';
import type { DashboardSnapshot } from '../../shared/types';
import { errorText } from '../hooks';

/** From this hour on, the briefing card invites you to wrap up the day. */
export const EVENING_HOUR = 17;

/**
 * The daily briefing, at the top of the dashboard. Claude writes it when an
 * API key is saved; otherwise Hub's own summary shows.
 */
export function BriefingCard({
  snapshot,
  now,
  onWrapUp,
  onOpenSettings,
}: {
  snapshot: DashboardSnapshot;
  now: number;
  onWrapUp: () => void;
  onOpenSettings: () => void;
}) {
  const { briefing, wrapUp, ai } = snapshot;
  const [rewriting, setRewriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const evening = new Date(now).getHours() >= EVENING_HOUR;

  async function rewrite() {
    setRewriting(true);
    setError(null);
    try {
      await window.hub.rewriteBriefing();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setRewriting(false);
    }
  }

  return (
    <section className="panel briefing-panel">
      <header className="label-row">
        <h2>Briefing</h2>
        <button className={`label-button ${evening && !wrapUp ? 'is-lit' : ''}`} onClick={onWrapUp}>
          {wrapUp ? 'View wrap-up' : 'Wrap up the day'}
        </button>
      </header>

      {wrapUp ? (
        <p className="wrapped">
          ✓ Day wrapped up. {wrapUp.summary}
        </p>
      ) : (
        evening && <p className="wrapped muted">Evening: when you're done for the day, wrap it up so tomorrow's briefing knows what's left.</p>
      )}

      <p className="briefing-headline">{briefing.headline}</p>
      <ul className="briefing">
        {briefing.points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>

      <footer className="briefing-meta muted small">
        {rewriting || briefing.writing ? (
          <span>Claude is writing your briefing…</span>
        ) : briefing.writtenBy === 'claude' ? (
          <>
            <span>Written by Claude at {formatTime(briefing.generatedAt)}</span>
            <button className="link-button" onClick={rewrite}>
              Rewrite
            </button>
          </>
        ) : ai.enabled ? (
          <>
            <span>{briefing.error ? `Claude couldn't write today's briefing: ${briefing.error}` : 'Life Hub’s quick summary'}</span>
            <button className="link-button" onClick={rewrite}>
              Try again
            </button>
          </>
        ) : (
          <>
            <span>Life Hub's quick summary.</span>
            <button className="link-button" onClick={onOpenSettings}>
              Add a Claude key for a written briefing
            </button>
          </>
        )}
        {error && <span className="settings-error">{error}</span>}
      </footer>
    </section>
  );
}
