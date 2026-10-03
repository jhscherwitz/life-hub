import { useEffect, useState, type FormEvent } from 'react';
import type { Reminder } from '../../shared/reminders';
import { parseWhen, whenLabel, dueValue } from '../../shared/when';
import { errorText } from '../hooks';
import { Card } from './Card';
import { Icon } from './Icon';
import { Tile, type TileContext } from './tiles';

/** Upcoming reminders, kept current when one is added, removed or goes off. */
export function useReminders() {
  const supported = typeof window.hub.getReminders === 'function';
  const [list, setList] = useState<Reminder[] | null>(null);
  useEffect(() => {
    if (!supported) return;
    let alive = true;
    const load = () => void window.hub.getReminders().then((l) => alive && setList(l));
    load();
    const off = window.hub.onReminders(load);
    return () => {
      alive = false;
      off();
    };
  }, [supported]);
  return { supported, list, setList };
}

function atLabel(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return whenLabel(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
}

/** Reminders: type "call mom at 6pm", get a notification then (and on your phone, if set up). */
export function RemindersWidget({ size, onOpenSettings }: TileContext) {
  const { supported, list, setList } = useReminders();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  if (!supported) {
    return (
      <Card title="Reminders">
        <p className="muted">Restart Life Hub to use reminders.</p>
      </Card>
    );
  }
  const upcoming = (list ?? []).filter((r) => !r.done);

  if (size === 'xs') {
    const next = upcoming[0];
    return (
      <Tile label="Reminder" className="tile-reminder" title={next ? next.text : 'No reminders'}>
        <Icon name="bell" size={22} />
        <span className="tile-foot tile-clip">{next ? next.text : 'None set'}</span>
        {next && <span className="tile-foot muted">{atLabel(next.at)}</span>}
      </Tile>
    );
  }

  const parsed = text.trim() ? parseWhen(text) : null;
  const due = parsed ? dueValue(parsed) : undefined;
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError('');
    window.hub.addReminder(text).then(
      (l) => {
        setList(l);
        setText('');
      },
      (err) => setError(errorText(err)),
    );
  };

  return (
    <Card title="Reminders" meta={upcoming.length || undefined} className="reminders-card">
      <form className="add-task" onSubmit={add}>
        <span className="add-task-plus">
          <Icon name="bell" size={12} />
        </span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Call mom at 6pm" />
        {parsed && (
          <span className="add-task-hint">
            {due ? (
              <>
                {parsed.title || text} · <b>{whenLabel(due)}</b>
              </>
            ) : (
              'Add a time, like “at 6pm” or “tomorrow 9am”'
            )}
          </span>
        )}
      </form>
      {error && <p className="settings-error small">{error}</p>}
      <ul className="reminder-list">
        {upcoming.length === 0 && <li className="muted small">Nothing yet. Type above, or tell Chat “remind me to…”.</li>}
        {upcoming.slice(0, size === 's' ? 4 : 8).map((r) => (
          <li key={r.id}>
            <span className="reminder-when">{atLabel(r.at)}</span>
            <span className="reminder-text">{r.text}</span>
            {r.queued && (
              <span className="reminder-phone" title="Already sent to your phone, to arrive on time">
                <Icon name="send" size={11} />
              </span>
            )}
            <button className="task-remove" aria-label={`Delete ${r.text}`} title="Delete" onClick={() => void window.hub.removeReminder(r.id).then(setList)}>
              <Icon name="x" size={13} />
            </button>
          </li>
        ))}
      </ul>
      {size === 'm' && (
        <button className="link-button reminders-phone-link" onClick={onOpenSettings}>
          Get these on your phone
        </button>
      )}
    </Card>
  );
}
