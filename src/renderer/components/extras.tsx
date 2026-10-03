import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_COUNTDOWNS, daysLabel, dueSoon, monthGrid, quoteOfDay, sortCountdowns, type Countdown, type Extras } from '../../shared/extras';
import { localIsoDate } from '../../shared/time';
import { errorText } from '../hooks';
import { Card } from './Card';
import { Icon } from './Icon';
import { Tile, type TileContext } from './tiles';

/** Countdowns and the note, loaded once and saved on change. */
function useExtras() {
  const supported = typeof window.hub.getExtras === 'function';
  const [extras, setExtras] = useState<Extras | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    window.hub.getExtras().then(
      (e) => alive && setExtras(e),
      (err) => alive && setError(errorText(err)),
    );
    return () => {
      alive = false;
    };
  }, [supported]);
  const run = (job: Promise<Extras>) => job.then(setExtras, (err) => setError(errorText(err)));
  return {
    supported,
    extras,
    error,
    setCountdowns: (list: Countdown[]) => run(window.hub.setCountdowns(list)),
    setNote: (text: string) => run(window.hub.setNote(text)),
  };
}

function RestartNote({ title }: { title: string }) {
  return (
    <Card title={title}>
      <p className="muted">Restart Life Hub to use this widget.</p>
    </Card>
  );
}

/* ---- Countdown ---- */

function CountdownEditor({ list, onSave, onClose }: { list: Countdown[]; onSave: (list: Countdown[]) => void; onClose: () => void }) {
  const [rows, setRows] = useState<Countdown[]>(list);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const save = (next: Countdown[]) => {
    setRows(next);
    onSave(next);
  };
  const add = () => {
    if (!title.trim() || !date) return;
    save([...rows, { id: crypto.randomUUID(), title: title.trim(), date }]);
    setTitle('');
    setDate('');
  };
  return createPortal(
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings countdown-editor" role="dialog" aria-label="Countdowns">
        <header className="card-header">
          <h2>Countdowns</h2>
          <button className="button" onClick={onClose}>
            Done
          </button>
        </header>
        <p className="muted small">Days until the things you're looking forward to, or getting ready for.</p>
        <ul className="countdown-rows">
          {rows.map((c) => (
            <li key={c.id}>
              <input
                value={c.title}
                onChange={(e) => setRows(rows.map((r) => (r.id === c.id ? { ...r, title: e.target.value } : r)))}
                onBlur={() => save(rows)}
                aria-label="Name"
              />
              <input
                type="date"
                value={c.date}
                onChange={(e) => save(rows.map((r) => (r.id === c.id ? { ...r, date: e.target.value } : r)))}
                aria-label="Date"
              />
              <button className="task-remove" onClick={() => save(rows.filter((r) => r.id !== c.id))} aria-label={`Delete ${c.title}`} title="Delete">
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
        {rows.length < MAX_COUNTDOWNS && (
          <form
            className="countdown-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's coming? (Exam, trip, birthday…)"
              aria-label="New countdown name"
              autoFocus
            />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="New countdown date" />
            <button className="button button-primary" disabled={!title.trim() || !date}>
              Add
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function CountdownWidget({ now, size }: TileContext) {
  const { supported, extras, setCountdowns } = useExtras();
  const [editing, setEditing] = useState(false);
  if (!supported) return <RestartNote title="Countdown" />;
  const list = sortCountdowns(extras?.countdowns ?? [], localIsoDate(new Date(now)));
  const next = list[0];
  const editor = editing && <CountdownEditor list={extras?.countdowns ?? []} onSave={setCountdowns} onClose={() => setEditing(false)} />;

  if (size === 'xs') {
    return (
      <>
        <Tile
          label={next ? undefined : 'Countdown'}
          className="tile-countdown"
          onClick={() => setEditing(true)}
          title={next ? `${next.title}: ${daysLabel(next.days)}` : 'Add a countdown'}
        >
          {next ? (
            <>
              <span className="tile-big">{Math.abs(next.days)}</span>
              <span className="tile-foot">{next.days === 0 ? 'today!' : next.days > 0 ? `day${next.days === 1 ? '' : 's'} to` : 'days since'}</span>
              <span className="tile-foot tile-clip countdown-name">{next.title}</span>
            </>
          ) : (
            <>
              <Icon name="plus" size={22} />
              <span className="tile-foot">Add one</span>
            </>
          )}
        </Tile>
        {editor}
      </>
    );
  }

  const shown = list.slice(0, size === 's' ? 3 : 5);
  return (
    <>
      <Card
        title="Countdown"
        className="countdown-card"
        action={
          <button className="link-button" onClick={() => setEditing(true)}>
            {list.length ? 'Edit' : 'Add'}
          </button>
        }
      >
        {shown.length === 0 ? (
          <p className="muted small">Count down to exams, trips and birthdays.</p>
        ) : (
          <ul className="countdown-list">
            {shown.map((c, i) => (
              <li key={c.id} className={`${i === 0 ? 'is-next' : ''} ${c.days < 0 ? 'is-past' : ''}`}>
                <span className="countdown-days">{Math.abs(c.days)}</span>
                <span className="countdown-text">
                  <strong className="tile-clip">{c.title}</strong>
                  <span className="muted small">
                    {daysLabel(c.days)} · {new Date(`${c.date}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editor}
    </>
  );
}

/* ---- Sticky note ---- */

export function NoteWidget(_: TileContext) {
  const { supported, extras, setNote } = useExtras();
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!supported) return <RestartNote title="Note" />;
  const value = text ?? extras?.note ?? '';
  return (
    <Card title="Note" className="note-card" meta={saved ? undefined : 'saving'}>
      <textarea
        className="note-text"
        value={value}
        placeholder="Jot anything. It saves by itself."
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          setSaved(false);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void setNote(next).then(() => setSaved(true)), 600);
        }}
        spellCheck
      />
    </Card>
  );
}

/* ---- Due soon ---- */

function dueTone(days: number): string {
  if (days < 0) return 'is-late';
  if (days <= 1) return 'is-soon';
  return '';
}

export function DueWidget({ snapshot, now, size }: TileContext) {
  const due = dueSoon(snapshot.tasks, new Date(now));
  if (size === 'xs') {
    const week = due.filter((d) => d.days <= 7);
    const first = due[0];
    return (
      <Tile
        label="Due soon"
        className={`tile-due ${first ? dueTone(first.days) : ''}`}
        title={first ? `${first.task.title}: ${daysLabel(first.days)}` : undefined}
      >
        <span className="tile-big">{week.length}</span>
        <span className="tile-foot tile-clip">{first ? `${first.task.title} · ${daysLabel(first.days).toLowerCase()}` : 'Nothing due'}</span>
      </Tile>
    );
  }
  return (
    <Card title="Due soon" meta={due.length}>
      {due.length === 0 ? (
        <p className="muted small">Nothing with a due date. Add dates to tasks and they'll line up here.</p>
      ) : (
        <ul className="due-list">
          {due.slice(0, size === 's' ? 4 : 6).map((d) => (
            <li key={d.task.id} className={dueTone(d.days)}>
              <span className="due-chip">{d.days < 0 ? 'Late' : d.days === 0 ? 'Today' : d.days === 1 ? 'Tmrw' : `${d.days}d`}</span>
              <span className="tile-clip">{d.task.title}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---- Month ---- */

export function MonthWidget({ snapshot, now }: TileContext) {
  const date = new Date(now);
  const busy = [
    ...snapshot.tasks.filter((t) => !t.done && t.due).map((t) => t.due!.slice(0, 10)),
    ...snapshot.events.filter((e) => !e.allDay).map((e) => localIsoDate(new Date(e.start))),
  ];
  const weeks = monthGrid(date, busy);
  const heads = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <Card title={date.toLocaleDateString([], { month: 'long', year: 'numeric' })} className="month-card">
      <div className="month-grid">
        {heads.map((h, i) => (
          <span key={i} className="month-head">
            {h}
          </span>
        ))}
        {weeks.flat().map((c) => (
          <span
            key={c.day}
            className={`month-day ${c.inMonth ? '' : 'is-out'} ${c.isToday ? 'is-today' : ''}`}
            title={c.count ? `${c.count} thing${c.count === 1 ? '' : 's'}` : undefined}
          >
            {c.date}
            {c.count > 0 && <i />}
          </span>
        ))}
      </div>
    </Card>
  );
}

/* ---- Quote ---- */

export function QuoteWidget({ now, size }: TileContext) {
  const q = quoteOfDay(new Date(now));
  return (
    <Card title="Quote of the day" className={`quote-card quote-${size}`}>
      <blockquote className="quote">
        <p>“{q.text}”</p>
        <footer>{q.by}</footer>
      </blockquote>
    </Card>
  );
}
