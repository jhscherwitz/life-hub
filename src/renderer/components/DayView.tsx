import { useEffect } from 'react';
import { formatTime, isSameDay } from '../../shared/time';
import { dayTimeline } from '../../shared/timeline';
import type { CalendarEvent } from '../../shared/types';

const HOUR_MS = 60 * 60_000;

/** The full day as a column of hours, sliding out from the left. Esc or a click outside closes it. */
export function DayView({ events, now, onClose }: { events: CalendarEvent[]; now: number; onClose: () => void }) {
  const t = dayTimeline(events, now);
  const span = t.end - t.start;
  const hours: { at: number; hour: number }[] = [];
  for (let h = t.start; h < t.end; h += HOUR_MS) hours.push({ at: ((h - t.start) / span) * 100, hour: new Date(h).getHours() });
  const allDay = events.filter((e) => e.allDay && isSameDay(e.start, new Date(now)));
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrows = events.filter((e) => isSameDay(e.start, tomorrow));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="day-view-shade" onClick={onClose}>
      <aside className="day-view" onClick={(e) => e.stopPropagation()} aria-label="Day view">
        <header className="label-row">
          <h2>Day view · {new Date(now).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</h2>
          <button className="label-button" onClick={onClose}>
            Esc ✕
          </button>
        </header>
        {allDay.length > 0 && (
          <ul className="rows">
            {allDay.map((e) => (
              <li key={e.id} className="row">
                <span className="row-time">All day</span>
                <span className="row-main">{e.title}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="day-col" style={{ ['--lanes' as string]: t.lanes }}>
          {hours.map((h) => (
            <span key={h.at} className="day-col-hour" style={{ top: `${h.at}%` }}>
              {String(h.hour).padStart(2, '0')}
            </span>
          ))}
          {t.items.map((item) => (
            <span
              key={item.event.id}
              className={`day-col-event is-${item.state}`}
              style={{ top: `${item.left}%`, height: `${item.width}%`, ['--lane' as string]: item.lane }}
              title={`${item.event.title} · ${formatTime(item.event.start)}–${formatTime(item.event.end)}`}
            >
              <span className="day-col-title">{item.event.title}</span>
            </span>
          ))}
          {t.nowAt !== null && <span className="day-col-now" style={{ top: `${t.nowAt}%` }} />}
        </div>
        {tomorrows.length > 0 && (
          <>
            <div className="label-row">
              <h2>Tomorrow</h2>
            </div>
            <ul className="rows">
              {tomorrows.map((e) => (
                <li key={e.id} className="row">
                  <span className="row-time">{e.allDay ? 'All day' : formatTime(e.start)}</span>
                  <span className="row-main">{e.title}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
