import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MAX_HABITS, REWARDS, type HabitsView } from '../../shared/habits';
import { localIsoDate } from '../../shared/time';
import { errorText } from '../hooks';
import { Card } from './Card';
import { Icon } from './Icon';

/** Faint background stars. Fixed, so the sky doesn't shimmer on every render. */
const DUST = Array.from({ length: 34 }, (_, i) => {
  const r = (n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1;
  return {
    x: r(1) * 100,
    y: r(2) * 100,
    size: 0.25 + r(3) * 0.45,
    delay: r(4) * 6,
  };
});

/** The day's tasks, kept current and re-read when the date changes at midnight. */
export function useHabits(now: number) {
  const [view, setView] = useState<HabitsView | null>(null);
  const [error, setError] = useState('');
  const today = localIsoDate(new Date(now));
  const supported = typeof window.hub.getHabits === 'function';
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    window.hub.getHabits().then(
      (v) => alive && setView(v),
      (err) => alive && setError(errorText(err)),
    );
    return () => {
      alive = false;
    };
  }, [today, supported]);
  const run = (job: Promise<HabitsView>) => {
    setError('');
    job.then(setView, (err) => setError(errorText(err)));
  };
  return { view, error, supported, run };
}

/** Says so when a streak unlocks something new, for a few seconds. */
function useNewReward(view: HabitsView | null): string | null {
  const seen = useRef<string[] | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => {
    if (!view?.unlocked) return;
    const before = seen.current;
    seen.current = [...view.unlocked];
    const added = before ? view.unlocked.find((id) => !before.includes(id)) : undefined;
    if (!added) return;
    setFresh(REWARDS.find((r) => r.id === added)?.name ?? null);
    const timer = setTimeout(() => setFresh(null), 6000);
    return () => clearTimeout(timer);
  }, [view]);
  return fresh;
}

function Sky({ view }: { view: HabitsView }) {
  const at = new Map(view.stars.map((s) => [s.id, s]));
  const done = new Set(view.habits.filter((h) => h.done).map((h) => h.id));
  const complete = view.total > 0 && view.done === view.total;
  const has = new Set<string>(view.unlocked ?? []);
  const fresh = useNewReward(view);
  const earned = REWARDS.filter((r) => has.has(r.id)).map((r) => r.name);
  return (
    <div
      className={`sky ${complete ? 'is-complete' : ''} ${has.has('gold') ? 'has-gold' : ''}`}
      title={earned.length ? `Unlocked: ${earned.join(', ')}. Best streak: ${view.best} days.` : 'Finish every task 3 days in a row to unlock shooting stars.'}
    >
      {/* Rewards for all-done streaks, drawn behind the stars. */}
      {has.has('milky-way') && <span className="sky-milky" aria-hidden="true" />}
      {has.has('aurora') && <span className="sky-aurora" aria-hidden="true" />}
      {has.has('moon') && <span className="sky-moon" aria-hidden="true" />}
      {has.has('shooting-stars') && (
        <>
          <span className="sky-shoot" aria-hidden="true" />
          <span className="sky-shoot is-second" aria-hidden="true" />
        </>
      )}
      {fresh && <span className="sky-unlock">✦ {fresh} unlocked</span>}
      <div className="sky-field">
        {DUST.map((d, i) => (
          <span
            key={i}
            className="sky-dust"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              width: `${d.size * 4}px`,
              height: `${d.size * 4}px`,
              animationDelay: `${d.delay}s`,
            }}
          />
        ))}
        <svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-hidden="true">
          {view.links.map((l) => {
            const a = at.get(l.from)!;
            const b = at.get(l.to)!;
            return <line key={`${l.from}-${l.to}`} className={`sky-link ${l.lit ? 'is-lit' : ''}`} x1={a.x} y1={a.y * 0.6} x2={b.x} y2={b.y * 0.6} />;
          })}
        </svg>
        {/* Stars are HTML, so they stay round however wide the card is. */}
        {view.stars.map((s, i) => (
          <span
            key={s.id}
            className={`sky-star ${done.has(s.id) ? 'is-lit' : ''}`}
            style={{ left: `${s.x}%`, top: `${s.y}%`, ['--i' as string]: i }}
            title={view.habits.find((h) => h.id === s.id)?.title}
          />
        ))}
      </div>
      <p className="sky-caption">
        {view.total === 0
          ? 'Add a task to draw your first star'
          : complete
            ? view.perfectStreak > 1
              ? `Constellation complete · ${view.perfectStreak} nights in a row`
              : 'Constellation complete'
            : `${view.total - view.done} star${view.total - view.done === 1 ? '' : 's'} left to light`}
        {view.next && view.total > 0 && (
          <span className="sky-next">
            {view.next.name} in {view.next.in} {view.next.in === 1 ? 'night' : 'nights'}
          </span>
        )}
      </p>
    </div>
  );
}

/** Seven small dots for the last week, today last. */
function Week({ week }: { week: boolean[] }) {
  return (
    <span className="sky-week" aria-hidden="true">
      {week.map((on, i) => (
        <i key={i} className={`${on ? 'is-on' : ''} ${i === 6 ? 'is-today' : ''}`} />
      ))}
    </span>
  );
}

function EditRow({ id, title, run }: { id: string; title: string; run: (job: Promise<HabitsView>) => void }) {
  const [text, setText] = useState(title);
  const save = () => text.trim() && text.trim() !== title && run(window.hub.renameHabit(id, text));
  return (
    <li className="sky-row is-editing">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        aria-label="Task name"
      />
      <button className="task-remove" title="Delete" aria-label={`Delete ${title}`} onClick={() => run(window.hub.removeHabit(id))}>
        <Icon name="x" size={14} />
      </button>
    </li>
  );
}

export function SkyCard({ now }: { now: number }) {
  const { view, error, supported, run } = useHabits(now);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (!supported) {
    return (
      <Card title="Daily tasks">
        <p className="muted">Restart Life Hub to use daily tasks.</p>
      </Card>
    );
  }

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    run(window.hub.addHabit(draft));
    setDraft('');
  };

  const complete = view && view.total > 0 && view.done === view.total;
  return (
    <Card
      title="Daily tasks"
      className="sky-card"
      meta={view ? (complete ? 'all lit' : `${view.done}/${view.total}`) : undefined}
      action={
        <button className="link-button" onClick={() => setEditing(!editing)}>
          {editing ? 'Done' : 'Edit'}
        </button>
      }
    >
      {!view ? (
        <p className="muted">{error || 'Loading…'}</p>
      ) : (
        <div className="sky-body">
          <Sky view={view} />
          <ul className="sky-list">
            {view.habits.map((h) =>
              editing ? (
                <EditRow key={h.id} id={h.id} title={h.title} run={run} />
              ) : (
                <li key={h.id} className={`sky-row ${h.done ? 'is-done' : ''}`}>
                  <button className="sky-tick" aria-pressed={h.done} onClick={() => run(window.hub.toggleHabit(h.id))}>
                    <span className="sky-dot" aria-hidden="true" />
                    <span className="sky-title">{h.title}</span>
                  </button>
                  <Week week={h.week} />
                  <span className={`sky-streak ${h.streak >= 3 ? 'is-hot' : ''}`} title="Days in a row">
                    {h.streak > 0 ? `${h.streak}d` : '–'}
                  </span>
                </li>
              ),
            )}
            {editing && view.total < MAX_HABITS && (
              <li className="sky-row">
                <form className="add-task" onSubmit={add}>
                  <span className="add-task-plus">+</span>
                  <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a daily task" autoFocus />
                </form>
              </li>
            )}
          </ul>
          {error && <p className="settings-error small">{error}</p>}
        </div>
      )}
    </Card>
  );
}
