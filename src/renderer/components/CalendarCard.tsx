import { formatTime, isSameDay } from '../../shared/time';
import type { CalendarEvent } from '../../shared/types';
import { Card } from './Card';

export function CalendarCard({ events, now }: { events: CalendarEvent[]; now: number }) {
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todays = events.filter((e) => isSameDay(e.start, today));
  const tomorrows = events.filter((e) => isSameDay(e.start, tomorrow));

  return (
    <Card title="Calendar" className="calendar-card" action={<span className="muted small">{todays.length} today</span>}>
      <ol className="agenda">
        {todays.length === 0 && <li className="muted">Nothing on the calendar today.</li>}
        {todays.map((e) => {
          const start = new Date(e.start).getTime();
          const end = new Date(e.end).getTime();
          const state = end <= now ? 'past' : start <= now ? 'current' : 'upcoming';
          return (
            <li key={e.id} className={`agenda-item ${state}`}>
              <span className="agenda-time">{e.allDay ? 'All day' : formatTime(e.start)}</span>
              <span className="agenda-dot" />
              <div className="agenda-text">
                <span className="agenda-title">{e.title}</span>
                <span className="muted small">
                  {e.allDay ? '' : `until ${formatTime(e.end)}`}
                  {e.location ? ` · ${e.location}` : ''}
                </span>
              </div>
              {e.meetingUrl && state !== 'past' && (
                <button className="link-button" onClick={() => window.hub.openExternal(e.meetingUrl!)}>
                  Join
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {tomorrows.length > 0 && (
        <>
          <h3 className="subhead">Tomorrow</h3>
          <ol className="agenda">
            {tomorrows.map((e) => (
              <li key={e.id} className="agenda-item upcoming">
                <span className="agenda-time">{e.allDay ? 'All day' : formatTime(e.start)}</span>
                <span className="agenda-dot" />
                <div className="agenda-text">
                  <span className="agenda-title">{e.title}</span>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
