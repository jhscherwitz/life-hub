import { useEffect, useState } from 'react';
import { averageScore, scoreTone, type CanvasData } from '../../shared/canvas';
import { Card } from './Card';
import { Ring, Tile, type TileContext } from './tiles';

/** Canvas classes, grades and work. Life Hub keeps a 15-minute copy, so this is cheap to ask for. */
export function useCanvas(): { data: CanvasData | null; supported: boolean; loaded: boolean } {
  const supported = typeof window.hub.getCanvas === 'function';
  const [data, setData] = useState<CanvasData | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    const load = () =>
      window.hub.getCanvas().then(
        (d) => {
          if (!alive) return;
          setData(d);
          setLoaded(true);
        },
        () => alive && setLoaded(true),
      );
    void load();
    const timer = setInterval(load, 15 * 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [supported]);
  return { data, supported, loaded };
}

const TONE_COLOR = { great: 'var(--green)', good: 'var(--accent-2)', ok: 'var(--warning)', low: 'var(--danger)', none: 'var(--faint)' };

/** Your current grade in each Canvas class. */
export function GradesWidget({ size, onOpenSettings }: TileContext) {
  const { data, supported, loaded } = useCanvas();
  const connectedButEmpty = data && data.courses.length === 0;

  if (!supported || (loaded && !data)) {
    if (size === 'xs') {
      return (
        <Tile label="Grades" onClick={onOpenSettings} title="Connect Canvas in Settings">
          <span className="tile-foot">Connect Canvas</span>
        </Tile>
      );
    }
    return (
      <Card title="Grades">
        <div className="grades-empty">
          <p className="muted small">See your current grade in every class, straight from Canvas.</p>
          <button className="button" onClick={onOpenSettings}>
            Connect Canvas
          </button>
        </div>
      </Card>
    );
  }

  const avg = data ? averageScore(data.courses) : null;
  if (size === 'xs') {
    return (
      <Tile label="Average" className="tile-grades" title={data?.courses.map((c) => `${c.code}: ${c.score ?? '—'}%`).join('\n')}>
        <Ring value={(avg ?? 0) / 100} size={60} color={TONE_COLOR[scoreTone(avg)]}>
          <b>{avg === null ? '—' : Math.round(avg)}</b>
        </Ring>
        <span className="tile-foot">{data ? `${data.courses.length} classes` : 'Loading…'}</span>
      </Tile>
    );
  }

  return (
    <Card title="Grades" meta={avg === null ? undefined : `avg ${Math.round(avg)}%`} className="grades-card">
      {!data ? (
        <p className="muted small">Loading from Canvas…</p>
      ) : connectedButEmpty ? (
        <p className="muted small">No active classes in Canvas right now.</p>
      ) : (
        <ul className="grades-list">
          {data.courses.map((c) => {
            const tone = scoreTone(c.score);
            return (
              <li key={c.id}>
                <button className="grades-row" onClick={() => window.hub.openExternal(c.url)} title={`${c.name}: open grades in Canvas`}>
                  <span className="grades-name">
                    <strong>{c.code}</strong>
                    {size !== 's' && <span className="muted small">{c.name}</span>}
                  </span>
                  <span className="grades-bar">
                    <i style={{ width: `${Math.min(100, c.score ?? 0)}%`, background: TONE_COLOR[tone] }} />
                  </span>
                  <span className={`grades-score tone-${tone}`}>
                    {c.score === null ? '—' : `${c.score}%`}
                    {c.grade && <small>{c.grade}</small>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {data?.error && <p className="settings-error small">{data.error}</p>}
    </Card>
  );
}
