import { useState, type FormEvent } from 'react';
import { localIsoDate } from '../../shared/time';
import type { Note, Task } from '../../shared/types';
import { Card } from './Card';
import { Icon } from './Icon';

function dueLabel(due: string | undefined): { text: string; tone: string } | null {
  if (!due) return null;
  const day = due.slice(0, 10);
  const today = localIsoDate();
  if (day < today) return { text: 'Overdue', tone: 'danger' };
  if (day === today) return { text: 'Today', tone: 'accent' };
  return { text: new Date(`${day}T12:00:00`).toLocaleDateString([], { weekday: 'short' }), tone: 'muted' };
}

function AddTask() {
  const [title, setTitle] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    await window.hub.addTask(title);
    setTitle('');
  }
  return (
    <form className="add-task" onSubmit={submit}>
      <span className="add-task-plus">+</span>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task" />
    </form>
  );
}

export function TasksCard({ tasks, notes }: { tasks: Task[]; notes: Note[] }) {
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const rank = { high: 0, medium: 1, low: 2 };
  open.sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9') || rank[a.priority ?? 'low'] - rank[b.priority ?? 'low']);

  return (
    <Card title="Tasks" meta={open.length} className="tasks-card">
      <AddTask />
      <ul className="list tasks">
        {tasks.length === 0 && <li className="muted small task-empty">Nothing on your plate. Add a task above, or use quick capture from anywhere.</li>}
        {[...open, ...done].map((t) => {
          const due = dueLabel(t.due);
          return (
            <li key={t.id} className={`task ${t.done ? 'done' : ''}`}>
              <label>
                <input type="checkbox" checked={t.done} onChange={(e) => void window.hub.setTaskDone(t.id, e.target.checked)} />
                <span className="task-check">
                  <Icon name="check" size={11} />
                </span>
                <span className="task-title">{t.title}</span>
                <span className={`priority priority-${t.priority ?? 'low'}`} title={`${t.priority ?? 'low'} priority`} />
              </label>
              {!t.done && due && <span className={`tag tag-${due.tone}`}>{due.text}</span>}
              <button className="task-remove" title="Delete task" aria-label={`Delete ${t.title}`} onClick={() => void window.hub.removeTask(t.id)}>
                <Icon name="x" size={14} />
              </button>
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
