import { localIsoDate } from '../../shared/time';
import type { Note, Task } from '../../shared/types';
import { Card } from './Card';

function dueLabel(due: string | undefined): { text: string; tone: string } | null {
  if (!due) return null;
  const day = due.slice(0, 10);
  const today = localIsoDate();
  if (day < today) return { text: 'Overdue', tone: 'danger' };
  if (day === today) return { text: 'Today', tone: 'accent' };
  return { text: new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short' }), tone: 'muted' };
}

export function TasksCard({ tasks, notes }: { tasks: Task[]; notes: Note[] }) {
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const rank = { high: 0, medium: 1, low: 2 };
  open.sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9') || rank[a.priority ?? 'low'] - rank[b.priority ?? 'low']);

  return (
    <Card title="Tasks" className="tasks-card" action={<span className="muted small">{open.length} open</span>}>
      <ul className="list tasks">
        {[...open, ...done].map((t) => {
          const due = dueLabel(t.due);
          return (
            <li key={t.id} className={`task ${t.done ? 'done' : ''}`}>
              <label>
                <input type="checkbox" checked={t.done} onChange={(e) => void window.hub.setTaskDone(t.id, e.target.checked)} />
                <span className={`priority priority-${t.priority ?? 'low'}`} />
                <span className="task-title">{t.title}</span>
              </label>
              {!t.done && due && <span className={`tag tag-${due.tone}`}>{due.text}</span>}
              {t.source === 'Quick capture' && <span className="tag tag-muted">Captured</span>}
            </li>
          );
        })}
      </ul>
      {notes.length > 0 && (
        <>
          <h3 className="subhead">Notes</h3>
          <ul className="list notes">
            {notes.slice(0, 5).map((n) => (
              <li key={n.id}>
                <span>{n.text}</span>
                <span className="muted small">
                  {new Date(n.createdAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
