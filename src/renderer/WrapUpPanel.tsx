import { useEffect, useState } from 'react';
import { useAnimatedClose } from './motion';
import type { WrapUp, WrapUpPreview } from '../shared/types';
import { Icon } from './components/Icon';
import { errorText } from './hooks';

/**
 * The evening wrap-up: what got done, and which unfinished items roll into
 * tomorrow. Ticked tasks move to tomorrow, and everything ticked (plus your
 * note) shows up in tomorrow morning's briefing.
 */
export function WrapUpPanel({ existing, onClose }: { existing: WrapUp | null; onClose: () => void }) {
  const [closing, close] = useAnimatedClose(onClose);
  const [preview, setPreview] = useState<WrapUpPreview | null>(null);
  const [carry, setCarry] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [result, setResult] = useState<WrapUp | null>(existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redo, setRedo] = useState(false);

  useEffect(() => {
    if (result && !redo) return;
    window.hub
      .previewWrapUp()
      .then((p) => {
        setPreview(p);
        // Everything rolls over unless you untick it.
        setCarry(new Set(p.unfinished.map((i) => i.id)));
      })
      .catch((err) => setError(errorText(err)));
  }, [result, redo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  function toggle(id: string) {
    setCarry((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function finish() {
    setBusy(true);
    setError(null);
    try {
      setResult(await window.hub.finishWrapUp({ carryOver: [...carry], note }));
      setRedo(false);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const showResult = result && !redo;

  return (
    <div className={`overlay ${closing ? 'is-closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings wrapup" role="dialog" aria-label="Evening wrap-up">
        <header className="card-header">
          <h2>Evening wrap-up</h2>
          <button className="button" onClick={close}>
            {showResult ? 'Done' : 'Cancel'}
          </button>
        </header>

        {showResult ? (
          <section className="settings-section">
            <p className="wrapup-summary">{result.summary}</p>
            {result.carryOver.length > 0 && (
              <>
                <h3>Rolling into tomorrow</h3>
                <ul className="list wrapup-list">
                  {result.carryOver.map((i) => (
                    <li key={i.id}>
                      {i.title}
                      {i.detail && <span className="muted"> · {i.detail}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.note && <p className="muted">Note for tomorrow: “{result.note}”</p>}
            <div className="settings-actions">
              <button className="link-button" onClick={() => setRedo(true)}>
                Change it
              </button>
            </div>
          </section>
        ) : !preview ? (
          <p className="muted">{error ?? 'Loading your day…'}</p>
        ) : (
          <>
            <section className="settings-section">
              <h3>Done today</h3>
              {preview.done.length === 0 ? (
                <p className="muted small">No tasks ticked off today{preview.meetings ? `, but you had ${preview.meetings} meetings` : ''}.</p>
              ) : (
                <ul className="list wrapup-list">
                  {preview.done.map((t) => (
                    <li key={t}>
                      <span className="settings-saved">✓</span> {t}
                    </li>
                  ))}
                </ul>
              )}
              {preview.done.length > 0 && preview.meetings > 0 && <p className="muted small">Plus {preview.meetings} meetings.</p>}
            </section>
            <section className="settings-section">
              <h3>Still open</h3>
              {preview.unfinished.length === 0 ? (
                <p className="muted small">Nothing left over. Tomorrow starts clean.</p>
              ) : (
                <>
                  <p className="muted small">Ticked items roll into tomorrow's briefing, and ticked tasks move to tomorrow.</p>
                  <ul className="list wrapup-list">
                    {preview.unfinished.map((i) => (
                      <li key={i.id} className="task">
                        <label>
                          <input type="checkbox" checked={carry.has(i.id)} onChange={() => toggle(i.id)} />
                          <span className="task-check">
                            <Icon name="check" size={11} />
                          </span>
                          <span className="task-title">
                            {i.title}
                            {i.detail && <span className="muted"> · {i.detail}</span>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <label className="wrapup-note">
                <span className="muted small">Anything else for tomorrow?</span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="e.g. Call the landlord before 10" />
              </label>
              <div className="settings-actions">
                <button className="button button-primary" disabled={busy} onClick={finish}>
                  {busy ? 'Wrapping up…' : 'Finish the day'}
                </button>
              </div>
              {error && <p className="settings-error">{error}</p>}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
