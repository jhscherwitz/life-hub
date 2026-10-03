import { formatTime, isSameDay } from '../../shared/time';
import { dayTimeline, shortHour } from '../../shared/timeline';
import type { CalendarEvent, Commute } from '../../shared/types';

const COMING_UP = 4;

/**
 * The whole day as one thin bar (click it for the day view), then the next
 * few meetings as a list.
 */
export function TodayStrip({ events, commute, now, onOpenDay }: { events: CalendarEvent[]; commute: Commute | null; now: number; onOpenDay: () => void }) {
  const t = dayTimeline(events, now);
  const upcoming = events.filter((e) => !e.allDay && isSameDay(e.start, new Date(now)) && new Date(e.start).getTime() > now);
  const shown = upcoming.slice(0, COMING_UP);
  const more = upcoming.length - shown.length;

  return (
    <section className="today">
      <button className="day-bar" onClick={onOpenDay} title="Open the day view (D)">
        <span className="label-row">
          <span>{shortHour(new Date(t.start).getHours())}</span>
          <span>Today · click for day view</span>
          <span>{shortHour(new Date(t.end).getHours())}</span>
        </span>
        <span className="day-bar-track">
          {t.items.map((item) => (
            <span key={item.event.id} className={`day-bar-event is-${item.state}`} style={{ left: `${item.left}%`, width: `${item.width}%` }} />
          ))}
          {t.nowAt !== null && <span className="day-bar-now" style={{ left: `${t.nowAt}%` }} />}
        </span>
      </button>

      <div className="label-row">
        <h2>Coming up</h2>
        {more > 0 && <span className="label-meta">+{more} more today</span>}
      </div>
      <ul className="rows">
        {shown.length === 0 && <li className="row muted">Nothing else on the calendar today.</li>}
        {shown.map((e) => (
          <li key={e.id} className="row">
            <span className="row-time">{formatTime(e.start)}</span>
            <span className="row-main">
              {e.title}
              {e.location && <span className="muted"> · {e.location}</span>}
            </span>
            {e.meetingUrl ? (
              <button className="tag tag-button" onClick={() => window.hub.openExternal(e.meetingUrl!)}>
                Join
              </button>
            ) : commute?.leaveBy && e.location && commute.destination === e.location ? (
              <span className="row-time">Leave {formatTime(commute.leaveBy)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
