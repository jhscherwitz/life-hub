import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { eventColor, eventsOn, isoDay, monthGrid, sameDay, startOfDay, step, viewRange, viewTitle, weekOf, type CalendarView } from '../../shared/calendar';
import { PLAN_LABEL, type EmailPlan } from '../../shared/plans';
import { formatTime } from '../../shared/time';
import { dayTimeline } from '../../shared/timeline';
import type { CalendarEvent, Task } from '../../shared/types';
import { Icon } from '../components/Icon';

const HOUR_MS = 60 * 60_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** Events shown in a month cell before "+2 more". */
const PER_CELL = 3;

/** Events for whatever the view shows, loaded from the calendar and kept while you flip back and forth. */
function useRangeEvents(view: CalendarView, focus: Date, fallback: CalendarEvent[], version: string) {
  const [cache, setCache] = useState<Record<string, CalendarEvent[]>>({});
  const [error, setError] = useState<string | null>(null);
  const range = viewRange(view, focus);
  const key = `${range.start.toISOString()}|${range.end.toISOString()}`;
  const have = cache[key] !== undefined;

  // A refresh of the dashboard (or signing in) loads everything again.
  useEffect(() => setCache({}), [version]);

  useEffect(() => {
    if (have || typeof window.hub.getEvents !== 'function') return;
    let alive = true;
    window.hub
      .getEvents(range.start.toISOString(), range.end.toISOString())
      .then((list) => {
        if (!alive) return;
        setError(null);
        setCache((c) => ({ ...c, [key]: list }));
      })
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)));
    return () => {
      alive = false;
    };
  }, [key, have]);

  return { events: cache[key] ?? fallback, loading: !have && !error, error };
}

/** "9a", "2:30p": short times for small spaces. */
const shortTime = (iso: string) =>
  formatTime(iso)
    .replace(/:00/, '')
    .replace(/\s?([AP])M/i, (_, x: string) => x.toLowerCase());

function Chip({ e, compact = false }: { e: CalendarEvent; compact?: boolean }) {
  return (
    <span
      className={`cal-chip ${e.allDay ? 'is-allday' : ''} ${compact ? 'is-compact' : ''}`}
      style={{ '--c': eventColor(e) } as CSSProperties}
      title={`${e.title}${e.allDay ? '' : ` · ${formatTime(e.start)}`}`}
    >
      {!e.allDay && <span className="cal-chip-time">{shortTime(e.start)}</span>}
      <span className="cal-chip-title">{e.title}</span>
    </span>
  );
}

interface ViewProps {
  focus: Date;
  today: Date;
  selected: Date;
  events: CalendarEvent[];
  tasks: Task[];
  plans: EmailPlan[];
  onPick: (d: Date) => void;
  onOpenDay: (d: Date) => void;
}

function MonthView({ focus, today, selected, events, tasks, plans, onPick, onOpenDay }: ViewProps) {
  const days = monthGrid(focus.getFullYear(), focus.getMonth());
  return (
    <div className="cal-month">
      {WEEKDAYS.map((d) => (
        <span key={d} className="cal-weekday">
          {d}
        </span>
      ))}
      {days.map((d, i) => {
        const list = eventsOn(events, d);
        const due = tasks.filter((t) => !t.done && t.due?.slice(0, 10) === isoDay(d)).length + plans.filter((p) => p.date === isoDay(d)).length;
        const outside = d.getMonth() !== focus.getMonth();
        return (
          <button
            key={d.toISOString()}
            className={`cal-cell ${outside ? 'is-outside' : ''} ${sameDay(d, today) ? 'is-today' : ''} ${sameDay(d, selected) ? 'is-selected' : ''}`}
            style={{ '--i': i } as CSSProperties}
            onClick={() => onPick(d)}
            onDoubleClick={() => onOpenDay(d)}
            title="Double-click to open the day"
          >
            <span className="cal-date">
              <span className="cal-date-num">{d.getDate() === 1 ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : d.getDate()}</span>
              {due > 0 && <span className="cal-due-dot" title={`${due} due`} />}
            </span>
            <span className="cal-chips">
              {list.slice(0, PER_CELL).map((e) => (
                <Chip key={e.id} e={e} compact />
              ))}
              {list.length > PER_CELL && <span className="cal-more">+{list.length - PER_CELL} more</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function WeekView({ focus, today, selected, events, tasks, plans, onPick, onOpenDay }: ViewProps) {
  return (
    <div className="cal-week">
      {weekOf(focus).map((d) => {
        const list = eventsOn(events, d);
        const due = tasks.filter((t) => !t.done && t.due?.slice(0, 10) === isoDay(d));
        const found = plans.filter((p) => p.date === isoDay(d));
        return (
          <button
            key={d.toISOString()}
            className={`cal-week-day ${sameDay(d, today) ? 'is-today' : ''} ${sameDay(d, selected) ? 'is-selected' : ''}`}
            onClick={() => onPick(d)}
            onDoubleClick={() => onOpenDay(d)}
          >
            <span className="cal-week-head">
              <span>{WEEKDAYS[d.getDay()]}</span>
              <b>{d.getDate()}</b>
            </span>
            <span className="cal-week-list">
              {list.map((e) => (
                <Chip key={e.id} e={e} />
              ))}
              {due.map((t) => (
                <span key={t.id} className="cal-task">
                  <Icon name="tasks" size={11} /> {t.title}
                </span>
              ))}
              {found.map((p) => (
                <span key={p.id} className="cal-task is-plan">
                  <Icon name="mail" size={11} /> {p.title}
                </span>
              ))}
              {list.length + due.length + found.length === 0 && <span className="cal-empty">Free</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function DayView({ focus, today, events }: ViewProps) {
  const isToday = sameDay(focus, today);
  // On another day, lay out that day (from its noon); "now" only shows today.
  const t = dayTimeline(events, isToday ? Date.now() : new Date(focus.getFullYear(), focus.getMonth(), focus.getDate(), 12).getTime());
  const span = t.end - t.start;
  const hours: { at: number; hour: number }[] = [];
  for (let h = t.start; h < t.end; h += HOUR_MS) hours.push({ at: ((h - t.start) / span) * 100, hour: new Date(h).getHours() });
  const allDay = eventsOn(events, focus).filter((e) => e.allDay);
  return (
    <div className="cal-day">
      {allDay.length > 0 && (
        <div className="cal-day-allday">
          {allDay.map((e) => (
            <Chip key={e.id} e={e} />
          ))}
        </div>
      )}
      <div className="day-col" style={{ ['--lanes' as string]: t.lanes }}>
        {hours.map((h) => (
          <span key={h.at} className="day-col-hour" style={{ top: `${h.at}%` }}>
            {new Date(2000, 0, 1, h.hour).toLocaleTimeString([], { hour: 'numeric' })}
          </span>
        ))}
        {t.items.map((item) => (
          <span
            key={item.event.id}
            className={`day-col-event is-${isToday ? item.state : 'upcoming'}`}
            style={{ top: `${item.left}%`, height: `${item.width}%`, ['--lane' as string]: item.lane, '--c': eventColor(item.event) } as CSSProperties}
            title={`${item.event.title} · ${formatTime(item.event.start)}–${formatTime(item.event.end)}`}
          >
            <span className="day-col-title">
              {item.event.title}
              <span className="day-col-time"> {formatTime(item.event.start)}</span>
            </span>
          </span>
        ))}
        {isToday && t.nowAt !== null && <span className="day-col-now" style={{ top: `${t.nowAt}%` }} />}
      </div>
    </div>
  );
}

/** Everything on the picked day, beside the month or week. */
function DayPanel({ day, today, events, tasks, plans }: { day: Date; today: Date; events: CalendarEvent[]; tasks: Task[]; plans: EmailPlan[] }) {
  const list = eventsOn(events, day);
  const due = tasks.filter((t) => t.due?.slice(0, 10) === isoDay(day));
  const found = plans.filter((p) => p.date === isoDay(day));
  const diff = Math.round((startOfDay(day).getTime() - startOfDay(today).getTime()) / 86_400_000);
  const when = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
  return (
    <aside className="cal-panel card" key={isoDay(day)}>
      <p className="cal-panel-when">{when}</p>
      <h2 className="cal-panel-title">{day.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
      {list.length + due.length + found.length === 0 && <p className="muted cal-panel-free">Nothing planned. A free day.</p>}
      {list.length > 0 && (
        <ul className="cal-panel-list">
          {list.map((e) => (
            <li key={e.id} style={{ '--c': eventColor(e) } as CSSProperties}>
              <span className="cal-panel-bar" aria-hidden="true" />
              <span className="cal-panel-main">
                <b>{e.title}</b>
                <span className="muted">
                  {e.allDay ? 'All day' : `${formatTime(e.start)} – ${formatTime(e.end)}`}
                  {e.location && ` · ${e.location}`}
                  {e.calendar && ` · ${e.calendar}`}
                </span>
              </span>
              {e.meetingUrl && (
                <button className="tag tag-button" onClick={() => window.hub.openExternal(e.meetingUrl!)}>
                  Join
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {due.length > 0 && (
        <>
          <p className="cal-panel-head">Tasks due</p>
          <ul className="cal-panel-list">
            {due.map((t) => (
              <li key={t.id} className={t.done ? 'is-done' : ''}>
                <Icon name={t.done ? 'check' : 'tasks'} size={13} />
                <span className="cal-panel-main">
                  <b>{t.title}</b>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {found.length > 0 && (
        <>
          <p className="cal-panel-head">Found in your email</p>
          <ul className="cal-panel-list">
            {found.map((p) => (
              <li key={p.id}>
                <Icon name="mail" size={13} />
                <span className="cal-panel-main">
                  <b>{p.title}</b>
                  <span className="muted">
                    {PLAN_LABEL[p.kind]}
                    {p.time && ` · ${formatTime(`${p.date}T${p.time}:00`)}`}
                    {p.place && ` · ${p.place}`} · from {p.from}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  );
}

/** Your calendar by month, week or day. ← and → move; T goes back to today; M, W and D switch views. */
export function CalendarPage({
  events,
  tasks = [],
  plans = [],
  now,
  version = '',
}: {
  events: CalendarEvent[];
  tasks?: Task[];
  plans?: EmailPlan[];
  now: number;
  /** Changes when the dashboard reloads, so the calendar loads again too. */
  version?: string;
}) {
  const todayKey = new Date(now).toDateString();
  const today = useMemo(() => startOfDay(new Date(now)), [todayKey]);
  const [view, setView] = useState<CalendarView>('month');
  const [focus, setFocus] = useState(today);
  const [selected, setSelected] = useState(today);
  const { events: shown, loading, error } = useRangeEvents(view, focus, events, version);

  const move = (by: -1 | 1) => {
    const next = step(view, focus, by);
    setFocus(next);
    if (view !== 'month') setSelected(next);
  };
  const goToday = () => {
    setFocus(today);
    setSelected(today);
  };
  const openDay = (d: Date) => {
    setSelected(d);
    setFocus(d);
    setView('day');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)))) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowleft') move(-1);
      else if (k === 'arrowright') move(1);
      else if (k === 't') goToday();
      else if (k === 'm' || k === 'w' || k === 'd') setView(({ m: 'month', w: 'week', d: 'day' } as const)[k]);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const props: ViewProps = { focus, today, selected, events: shown, tasks, plans, onPick: setSelected, onOpenDay: openDay };
  return (
    <div className={`cal cal-is-${view}`}>
      <div className="cal-bar">
        <div className="cal-nav">
          <button className="icon-button" onClick={() => move(-1)} aria-label="Back" title="Back (←)">
            <Icon name="back" size={15} />
          </button>
          <button className="icon-button" onClick={() => move(1)} aria-label="Forward" title="Forward (→)">
            <Icon name="chevron" size={15} />
          </button>
          <button className="button" onClick={goToday} title="Today (T)">
            Today
          </button>
        </div>
        <h2 className="cal-title" key={viewTitle(view, focus)}>
          {viewTitle(view, focus)}
          {loading && <span className="cal-loading" aria-label="Loading" />}
        </h2>
        <div className="cal-views" role="tablist">
          {(['month', 'week', 'day'] as const).map((v) => (
            <button
              key={v}
              className={view === v ? 'is-on' : ''}
              role="tab"
              aria-selected={view === v}
              onClick={() => {
                setView(v);
                if (v !== 'month') setFocus(selected);
              }}
              title={`${v[0].toUpperCase()}${v.slice(1)} (${v[0].toUpperCase()})`}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="settings-error">Couldn't load that part of your calendar: {error}</p>}
      <div className="cal-body">
        <div className="cal-main card" key={`${view}|${viewRange(view, focus).start.toISOString()}`}>
          {view === 'month' ? <MonthView {...props} /> : view === 'week' ? <WeekView {...props} /> : <DayView {...props} />}
        </div>
        <DayPanel day={view === 'day' ? focus : selected} today={today} events={shown} tasks={tasks} plans={plans} />
      </div>
    </div>
  );
}
