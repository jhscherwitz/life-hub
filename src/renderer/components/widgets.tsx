import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatTime, isSameDay, localIsoDate, nextEvent } from '../../shared/time';
import { chipRows, dayTimeline, shortHour } from '../../shared/timeline';
import type { WidgetType } from '../../shared/layout';
import type { DashboardSnapshot } from '../../shared/types';
import { BriefingCard } from './BriefingCard';
import { Card } from './Card';
import { EmailCard } from './EmailCard';
import { LockedInCard } from './LockedInCard';
import { NowCard } from './NowCard';
import { TasksCard } from './TasksCard';

export interface WidgetContext {
  snapshot: DashboardSnapshot;
  now: number;
  onWrapUp: () => void;
  onOpenSettings: () => void;
  onOpenCalendar: () => void;
}

function todays(snapshot: DashboardSnapshot, now: number) {
  return snapshot.events.filter((e) => isSameDay(e.start, new Date(now)) && !e.allDay);
}

/** A small card with one big number. */
function Stat(props: { title: string; value: ReactNode; lines: ReactNode[]; accent?: boolean }) {
  return (
    <Card title={props.title} className={`stat-card ${props.accent ? 'is-accent' : ''}`}>
      <div className="stat">
        <span className="stat-value">{props.value}</span>
        <span className="stat-lines">
          {props.lines.map((line, i) => (
            <span key={i}>{line}</span>
          ))}
        </span>
      </div>
    </Card>
  );
}

function MeetingsStat({ snapshot, now }: WidgetContext) {
  const today = todays(snapshot, now);
  const left = today.filter((e) => new Date(e.end).getTime() > now);
  const next = nextEvent(today, now);
  return (
    <Stat
      title="Meetings left"
      value={left.length}
      accent
      lines={next ? [`Next at ${formatTime(next.start)}`, next.title] : ['Done for today']}
    />
  );
}

function RepliesStat({ snapshot }: WidgetContext) {
  const replies = snapshot.emails.filter((e) => e.needsReply);
  const names = replies.map((e) => e.from.name.split(' ')[0]);
  return <Stat title="Need a reply" value={replies.length} lines={[names.length ? names.slice(0, 3).join(', ') : 'Inbox is calm']} />;
}

function TasksStat({ snapshot, now }: WidgetContext) {
  const open = snapshot.tasks.filter((t) => !t.done);
  const due = open.filter((t) => t.due && t.due.slice(0, 10) <= localIsoDate(new Date(now)));
  return (
    <Stat
      title="Tasks open"
      value={open.length}
      lines={[open.length ? '' : <span className="pill">all clear</span>, due.length ? `${due.length} due today` : 'Nothing due today']}
    />
  );
}

function WeatherStat({ snapshot }: WidgetContext) {
  const w = snapshot.weather;
  if (!w) return <Stat title="Weather" value="—" lines={['Pick your town in Settings']} />;
  return <Stat title="Weather" value={`${w.temperatureF}°`} lines={[w.condition, `High ${w.highF}° · Low ${w.lowF}° · Rain ${w.precipitationChance}%`]} />;
}

function ClockWidget({ now }: WidgetContext) {
  const date = new Date(now);
  return (
    <Card title="Clock" className="clock-card">
      <p className="clock-time">{date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</p>
      <p className="muted">{date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
    </Card>
  );
}

/** Roughly how wide a chip is in pixels: the time, the title, and padding. Chips stop at 220px. */
function chipPixels(title: string): number {
  return Math.min(220, 58 + title.length * 6.4);
}

function TimelineWidget({ snapshot, now, onOpenCalendar }: WidgetContext) {
  const t = dayTimeline(snapshot.events, now);
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || 600));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // Plus a small gap, so neighbouring chips don't touch.
  const rows = chipRows(
    t.items,
    t.items.map((item) => ((chipPixels(item.event.title) + 8) / width) * 100),
  );
  const rowCount = Math.max(1, ...rows.map((r) => r + 1));
  const ticks = t.ticks;

  return (
    <Card
      title="Today's timeline"
      className="timeline-card"
      action={
        <button className="link-button" onClick={onOpenCalendar}>
          Open calendar
        </button>
      }
    >
      <div className="tl" style={{ ['--rows' as string]: rowCount }}>
        <div className="tl-hours">
          {ticks.map((tick) => (
            <span key={tick.at} style={{ left: `${tick.at}%` }}>
              {shortHour(tick.hour)}
            </span>
          ))}
        </div>
        <div className="tl-body" ref={body}>
          {ticks.map((tick) => (
            <span key={tick.at} className="tl-line" style={{ left: `${tick.at}%` }} />
          ))}
          {t.items.map((item, i) => (
            <span
              key={item.event.id}
              className={`tl-chip is-${item.state}`}
              style={{ left: `min(${item.left}%, calc(100% - 140px))`, ['--row' as string]: rows[i] }}
              title={`${item.event.title} · ${formatTime(item.event.start)}–${formatTime(item.event.end)}`}
            >
              <i>{formatTime(item.event.start).replace(/\s?[AP]M$/i, '')}</i>
              {item.event.title}
            </span>
          ))}
          {t.nowAt !== null && <span className="tl-now" style={{ left: `${t.nowAt}%` }} />}
        </div>
      </div>
    </Card>
  );
}

const COMING_UP = 4;

function ComingUpWidget({ snapshot, now }: WidgetContext) {
  const upcoming = todays(snapshot, now).filter((e) => new Date(e.start).getTime() > now);
  const shown = upcoming.slice(0, COMING_UP);
  return (
    <Card title="Coming up" meta={upcoming.length}>
      <ul className="rows">
        {shown.length === 0 && <li className="row muted">Nothing else on the calendar today.</li>}
        {shown.map((e) => (
          <li key={e.id} className="row">
            <span className="row-time">{formatTime(e.start)}</span>
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
      {upcoming.length > shown.length && <p className="card-foot muted">+{upcoming.length - shown.length} more today</p>}
    </Card>
  );
}

/** What each widget draws. */
export const WIDGET_VIEWS: Record<WidgetType, (ctx: WidgetContext) => ReactNode> = {
  meetings: MeetingsStat,
  replies: RepliesStat,
  'tasks-open': TasksStat,
  weather: WeatherStat,
  clock: ClockWidget,
  now: (ctx) => <NowCard snapshot={ctx.snapshot} now={ctx.now} />,
  focus: () => <LockedInCard />,
  timeline: TimelineWidget,
  'coming-up': ComingUpWidget,
  'reply-queue': (ctx) => <EmailCard emails={ctx.snapshot.emails} />,
  tasks: (ctx) => <TasksCard tasks={ctx.snapshot.tasks} notes={ctx.snapshot.notes} />,
  briefing: (ctx) => <BriefingCard snapshot={ctx.snapshot} now={ctx.now} onWrapUp={ctx.onWrapUp} onOpenSettings={ctx.onOpenSettings} />,
};
