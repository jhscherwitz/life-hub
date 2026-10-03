import { formatTime, isSameDay } from '../../shared/time';
import { dayTimeline } from '../../shared/timeline';
import type { CalendarEvent } from '../../shared/types';
import { Card } from '../components/Card';

const HOUR_MS = 60 * 60_000;

function EventList({ events }: { events: CalendarEvent[] }) {
  return (
    <ul className="rows">
      {events.length === 0 && <li className="row muted">Nothing on the calendar.</li>}
      {events.map((e) => (
        <li key={e.id} className="row">
          <span className="row-time">{e.allDay ? 'All day' : formatTime(e.start)}</span>
          <span className="row-main">
            {e.title}
            {e.location && <span className="muted"> · {e.location}</span>}
          </span>
          {e.meetingUrl && (
            <button className="tag tag-button" onClick={() => window.hub.openExternal(e.meetingUrl!)}>
              Join
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Today as a column of hours, with tomorrow listed beside it. */
export function CalendarPage({ events, now }: { events: CalendarEvent[]; now: number }) {
  const t = dayTimeline(events, now);
  const span = t.end - t.start;
  const hours: { at: number; hour: number }[] = [];
  for (let h = t.start; h < t.end; h += HOUR_MS) hours.push({ at: ((h - t.start) / span) * 100, hour: new Date(h).getHours() });
  const allDay = events.filter((e) => e.allDay && isSameDay(e.start, new Date(now)));
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrows = events.filter((e) => isSameDay(e.start, tomorrow));

  return (
    <div className="page-grid">
      <Card title="Today" meta={t.items.length} className="span-8">
        {allDay.length > 0 && <EventList events={allDay} />}
        <div className="day-col" style={{ ['--lanes' as string]: t.lanes }}>
          {hours.map((h) => (
            <span key={h.at} className="day-col-hour" style={{ top: `${h.at}%` }}>
              {new Date(2000, 0, 1, h.hour).toLocaleTimeString([], { hour: 'numeric' })}
            </span>
          ))}
          {t.items.map((item) => (
            <span
              key={item.event.id}
              className={`day-col-event is-${item.state}`}
              style={{ top: `${item.left}%`, height: `${item.width}%`, ['--lane' as string]: item.lane }}
              title={`${item.event.title} · ${formatTime(item.event.start)}–${formatTime(item.event.end)}`}
            >
              <span className="day-col-title">
                {item.event.title}
                <span className="day-col-time"> {formatTime(item.event.start)}</span>
              </span>
            </span>
          ))}
          {t.nowAt !== null && <span className="day-col-now" style={{ top: `${t.nowAt}%` }} />}
        </div>
      </Card>
      <Card title="Tomorrow" meta={tomorrows.length} className="span-4">
        <EventList events={tomorrows} />
      </Card>
    </div>
  );
}
