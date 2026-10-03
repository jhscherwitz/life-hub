import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { daysLabel, dueSoon, quoteOfDay } from '../../shared/extras';
import { formatTime, isSameDay, localIsoDate } from '../../shared/time';
import type { DashboardSnapshot, Task } from '../../shared/types';
import { useCanvas } from './GradesWidget';
import { Icon } from './Icon';
import { useHabits } from './SkyCard';
import { WeatherIcon } from './WeatherIcon';

const SEEN_KEY = 'life-hub-morning-seen';

function seenToday(today: string): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === today;
  } catch {
    return false;
  }
}

function markSeen(today: string): void {
  try {
    localStorage.setItem(SEEN_KEY, today);
  } catch {
    // Only a convenience: worst case it shows again.
  }
}

/**
 * Shows the morning screen the first time Life Hub is opened (or brought
 * back from the tray) each morning, between 4 AM and noon.
 */
export function useMorningScreen(now: number): { open: boolean; show: () => void; close: () => void } {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => {
      const d = new Date();
      const today = localIsoDate(d);
      if (d.getHours() >= 4 && d.getHours() < 12 && !seenToday(today) && document.visibilityState === 'visible') setOpen(true);
    };
    check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [now]);
  return {
    open,
    show: () => setOpen(true),
    close: () => {
      markSeen(localIsoDate());
      setOpen(false);
    },
  };
}

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** A calm, full-screen start to the day: weather, first thing on, what's due, daily tasks. */
export function MorningScreen({ snapshot, now, onClose, onStudy }: { snapshot: DashboardSnapshot; now: number; onClose: () => void; onStudy: () => void }) {
  const date = new Date(now);
  const habits = useHabits(now);
  const canvas = useCanvas().data;
  const [leaving, setLeaving] = useState(false);

  const close = (then?: () => void) => {
    setLeaving(true);
    setTimeout(() => {
      onClose();
      then?.();
    }, 380);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter') && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const today = snapshot.events
    .filter((e) => isSameDay(e.start, date) && !e.allDay && new Date(e.end).getTime() > now)
    .sort((a, b) => a.start.localeCompare(b.start));
  const first = today[0];
  const canvasTasks: Task[] = (canvas?.assignments ?? [])
    .filter((a) => !a.submitted)
    .map((a) => ({ id: `canvas-${a.id}`, title: a.title, done: false, due: localIsoDate(new Date(a.due)), project: a.courseName }));
  const due = dueSoon([...snapshot.tasks, ...canvasTasks], date).filter((d) => d.days <= 1);
  const w = snapshot.weather;
  const quote = quoteOfDay(date);
  const name = canvas?.user && canvas.user !== 'you' ? `, ${canvas.user.split(' ')[0]}` : '';

  return createPortal(
    <div className={`morning ${leaving ? 'is-leaving' : ''}`} role="dialog" aria-label="Good morning">
      <div className="morning-inner">
        <p className="morning-date">{date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="morning-hello">
          {greeting(date.getHours())}
          {name}
        </h1>

        <div className="morning-grid">
          <section className="morning-card morning-weather">
            {w ? (
              <>
                <WeatherIcon kind={w.kind} size={64} />
                <div>
                  <p className="morning-big">{w.temperatureF}°</p>
                  <p>{w.condition}</p>
                  <p className="muted small">
                    High {w.highF}° · Low {w.lowF}°{w.precipitationChance >= 30 ? ` · ${w.precipitationChance}% rain` : ''}
                  </p>
                </div>
              </>
            ) : (
              <p className="muted">Pick your town in Settings to see the weather.</p>
            )}
          </section>

          <section className="morning-card">
            <h2>First up</h2>
            {first ? (
              <>
                <p className="morning-big morning-time">{formatTime(first.start)}</p>
                <p className="morning-clip">{first.title}</p>
                <p className="muted small">{today.length > 1 ? `then ${today.length - 1} more today` : 'and nothing after'}</p>
              </>
            ) : (
              <>
                <p className="morning-big">Free</p>
                <p className="muted small">Nothing on the calendar today.</p>
              </>
            )}
          </section>

          <section className="morning-card">
            <h2>Due soon</h2>
            {due.length === 0 ? (
              <p className="muted">Nothing due today or tomorrow.</p>
            ) : (
              <ul className="morning-list">
                {due.slice(0, 4).map((d) => (
                  <li key={d.task.id}>
                    <span className={`due-chip ${d.days < 0 ? 'is-late' : ''}`}>{d.days < 0 ? 'Late' : daysLabel(d.days)}</span>
                    <span className="morning-clip">{d.task.title}</span>
                  </li>
                ))}
                {due.length > 4 && <li className="muted small">+{due.length - 4} more</li>}
              </ul>
            )}
          </section>

          <section className="morning-card">
            <h2>Daily tasks</h2>
            {(habits.view?.habits ?? []).length === 0 ? (
              <p className="muted">No daily tasks yet.</p>
            ) : (
              <ul className="morning-habits">
                {habits.view!.habits.map((h) => (
                  <li key={h.id}>
                    <button className={h.done ? 'is-done' : ''} onClick={() => habits.run(window.hub.toggleHabit(h.id))}>
                      <span className="sky-dot" aria-hidden="true" />
                      {h.title}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <blockquote className="morning-quote">
          “{quote.text}” <span>— {quote.by}</span>
        </blockquote>

        <div className="morning-actions">
          <button className="button button-primary morning-go" onClick={() => close()} autoFocus>
            Start my day <Icon name="next" size={14} />
          </button>
          <button className="button" onClick={() => close(onStudy)}>
            <Icon name="book" size={14} /> Study mode
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
