import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { formatTime, isSameDay, localIsoDate } from '../../shared/time';
import { PLAN_LABEL, planTime, type EmailPlan } from '../../shared/plans';
import { dayStrip, shortHour, stripRows, type StripItem } from '../../shared/timeline';
import type { WidgetSize, WidgetType } from '../../shared/layout';
import type { Player } from '../player';
import type { DashboardSnapshot } from '../../shared/types';
import { BriefingCard } from './BriefingCard';
import { Card } from './Card';
import { EmailCard } from './EmailCard';
import { NowCard } from './NowCard';
import { SkyCard } from './SkyCard';
import { TasksCard } from './TasksCard';
import { CountdownWidget, DueWidget, MonthWidget, NoteWidget, QuoteWidget } from './extras';
import { GradesWidget } from './GradesWidget';
import { RemindersWidget } from './RemindersWidget';
import { PortfolioWidget } from './PortfolioWidget';
import { ChristmasWidget } from './ChristmasWidget';
import { Chart, WeatherCard } from './WeatherCard';
import { weatherChart } from '../../shared/weather';
import {
  ClockTile,
  ComingUpTile,
  DateWidget,
  HabitsTile,
  MeetingsTile,
  MoonWidget,
  NowTile,
  RadioWidget,
  RepliesTile,
  SunWidget,
  TasksTile,
  WeatherTile,
  YearWidget,
  type TileContext,
} from './tiles';
import { WeatherIcon } from './WeatherIcon';
import { Icon } from './Icon';
import { GroceryWidget } from './GroceryWidget';
import { NewsWidget } from './NewsWidget';
import { CommuteWidget } from './CommuteWidget';
import { SportsWidget } from './SportsWidget';

export interface WidgetContext {
  snapshot: DashboardSnapshot;
  now: number;
  onWrapUp: () => void;
  onOpenSettings: () => void;
  onOpenCalendar: () => void;
  /** Opens a link in Life Hub's browser, with the AI beside it. */
  onOpenLink?: (url: string) => void;
  /** The radio deck, for the Radio widget. */
  player?: Player;
  /** The size the widget is drawn at; set by the page. */
  size?: WidgetSize;
  /** How many rows tall it is, 1 to 4; bigger widgets show more. */
  rows?: number;
  /** The look picked in the widget editor. */
  style?: string;
}

/** Widgets with their own tiny square design use it at XS. */
function tiny(Tile: (ctx: TileContext) => ReactNode, Normal: (ctx: WidgetContext) => ReactNode) {
  return function Sized(ctx: WidgetContext) {
    return ctx.size === 'xs' ? <Tile {...ctx} size="xs" /> : <Normal {...ctx} />;
  };
}

function tile(View: (ctx: TileContext) => ReactNode) {
  return function Sized(ctx: WidgetContext) {
    return <View {...ctx} size={ctx.size ?? 'xs'} />;
  };
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

function WeatherStat({ snapshot, now, size }: WidgetContext) {
  const w = snapshot.weather;
  if (!w) return <Stat title="Weather" value="—" lines={['Pick your town in Settings']} />;
  const extra = w.feelsLikeF !== undefined && w.feelsLikeF !== w.temperatureF ? `Feels ${w.feelsLikeF}°` : `Rain ${w.precipitationChance}%`;
  const chart = size === 'm' && w.hourly ? weatherChart(w.hourly, now) : null;
  return (
    <Card title="Weather" meta={w.location} className={`stat-card wx-stat wx-sky-${w.kind ?? 'cloudy'} ${chart ? 'has-chart' : ''}`}>
      <div className="stat">
        <WeatherIcon kind={w.kind} size={42} />
        <span className="stat-value wx-stat-temp">{w.temperatureF}°</span>
        <span className="stat-lines">
          <span className="wx-stat-cond">{w.condition}</span>
          <span>
            H {w.highF}° · L {w.lowF}° · {extra}
          </span>
        </span>
        {chart && <Chart chart={chart} compact />}
      </div>
    </Card>
  );
}

/** Ticks every second while shown. */
function useSecondTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** A flip clock: each digit flips over as it changes, with the minute filling in underneath. */
function ClockWidget({ size }: WidgetContext) {
  const date = new Date(useSecondTick());
  const hours = String(date.getHours() % 12 || 12);
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const digit = (ch: string, i: string) => (
    <span key={`${i}${ch}`} className="flip-digit">
      {ch}
    </span>
  );
  return (
    <Card title="Clock" className={`clock-card flip-clock flip-${size}`}>
      <div className="flip-row">
        <span className="flip-group">{[...hours].map((ch, i) => digit(ch, `h${i}`))}</span>
        <span className="flip-colon">:</span>
        <span className="flip-group">{[...minutes].map((ch, i) => digit(ch, `m${i}`))}</span>
        <span className="flip-ampm">{date.getHours() < 12 ? 'AM' : 'PM'}</span>
        {size !== 's' && <span className="flip-date muted">{date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</span>}
      </div>
      <span className="flip-seconds" style={{ ['--p' as string]: date.getSeconds() / 59 }} aria-hidden="true" />
    </Card>
  );
}

/** About how wide a label is in pixels: the time, the title and padding, at most 240. */
function labelPixels(title: string): number {
  return Math.min(240, 70 + title.length * 6.3);
}

/**
 * Today on one strip that fits what's on it: events as bars as long as they
 * last, deadlines at the same time as one flag, plans from email dashed, and
 * a line for now. Labels never cover each other or run off the edge.
 */
function TimelineWidget({ snapshot, now, onOpenCalendar }: WidgetContext) {
  const todayIso = localIsoDate(new Date(now));
  const plans = (snapshot.plans ?? []).filter((p) => p.date === todayIso && p.time).map((p) => ({ id: p.id, title: p.title, at: planTime(p) }));
  const strip = dayStrip(snapshot.events, now, plans);
  // All-day events (birthdays, days off, trips) sit above the strip.
  const allDay = snapshot.events.filter((e) => e.allDay && new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now);
  const next = snapshot.events.find((e) => !e.allDay && new Date(e.start).getTime() > now);
  const body = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || 600));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const label = (item: StripItem) => (item.kind === 'due' ? (item.more.length ? `${item.more.length + 1} due: ${item.title}` : `Due: ${item.title}`) : item.title);
  // Under the strip: what's on now or next, and what's due later today.
  const upcoming = strip.items.filter((i) => i.state !== 'past');
  const current = upcoming.find((i) => i.kind !== 'due' && i.state === 'current');
  const nextUp = upcoming.find((i) => i.kind !== 'due' && i.state === 'upcoming');
  const dueLater = upcoming.filter((i) => i.kind === 'due').reduce((n, i) => n + 1 + i.more.length, 0);
  const inTime = (t: number) => {
    const mins = Math.max(1, Math.round((t - now) / 60_000));
    return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}`;
  };
  const placed = stripRows(
    strip.items,
    strip.items.map((item) => (labelPixels(label(item)) / width) * 100),
  );
  const rowCount = Math.max(1, ...placed.map((p) => p.row + 1));
  const when = (t: number) => formatTime(new Date(t).toISOString());

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
      {allDay.length > 0 && (
        <div className="tl-allday">
          <span className="muted small">All day</span>
          {allDay.map((e) => (
            <span key={e.id} className="tl-allday-chip" title={e.calendar}>
              {e.title}
            </span>
          ))}
        </div>
      )}
      <div className="strip" ref={body} style={{ ['--rows' as string]: rowCount }}>
        <div className="strip-lanes">
          {strip.ticks.map((tick) => (
            <span key={tick.at} className="strip-grid" style={{ left: `${tick.at}%` }} />
          ))}
          {strip.nowAt !== null && <span className="strip-past" style={{ width: `${strip.nowAt}%` }} />}
          {strip.items.map((item, i) => {
            const { row, left } = placed[i];
            const time = item.kind === 'event' ? `${when(item.start)}–${when(item.end)}` : when(item.start);
            const tip = [`${item.kind === 'due' ? 'Due ' : ''}${item.title}`, ...item.more, time].join(' · ');
            const tone = item.color ? ({ ['--tone' as string]: item.color } as CSSProperties) : {};
            return (
              <Fragment key={item.key}>
                {/* The bar shows how long it lasts; the label sits on it, kept inside the strip. */}
                {item.kind !== 'due' && (
                  <span
                    className={`strip-bar is-${item.kind} is-${item.state}`}
                    style={{ ...tone, left: `${item.left}%`, width: `${item.width}%`, top: `calc(${row} * var(--lane))` }}
                  />
                )}
                {item.kind === 'due' && <span className={`strip-flag is-${item.state}`} style={{ ...tone, left: `${item.left}%`, top: `calc(${row} * var(--lane))` }} />}
                <span
                  className={`strip-label is-${item.kind} is-${item.state}`}
                  style={{ ...tone, left: `${left}%`, top: `calc(${row} * var(--lane))` }}
                  title={tip}
                >
                  {item.kind === 'due' && <Icon name="bolt" size={11} />}
                  <b>{when(item.start).replace(/\s?[AP]M$/i, '')}</b>
                  <span className="strip-title">{label(item)}</span>
                </span>
              </Fragment>
            );
          })}
          {strip.nowAt !== null && (
            <span className="strip-now" style={{ left: `${strip.nowAt}%` }}>
              <i>Now</i>
            </span>
          )}
          {strip.items.length === 0 && (
            <p className="tl-empty muted small">
              {next ? (
                <>
                  Nothing timed today. Next: <strong>{next.title}</strong>, {isSameDay(next.start, new Date(now)) ? '' : 'tomorrow '}
                  {formatTime(next.start)}
                </>
              ) : (
                'Nothing on your calendar today.'
              )}
            </p>
          )}
        </div>
        <div className="strip-axis">
          {strip.ticks.map((tick) => (
            <span key={tick.at} className={tick.at < 3 ? 'is-first' : tick.at > 97 ? 'is-last' : ''} style={{ left: `${tick.at}%` }}>
              {shortHour(tick.hour)}
            </span>
          ))}
        </div>
        {strip.items.length > 0 && (current || nextUp || dueLater > 0) && (
          <p className="strip-next">
            {current ? (
              <span>
                <span className="strip-dot is-now" /> Now: <b>{current.title}</b>, until {when(current.end)}
              </span>
            ) : nextUp ? (
              <span>
                <span className="strip-dot" style={nextUp.color ? { background: nextUp.color } : undefined} /> Next: <b>{nextUp.title}</b> at {when(nextUp.start)}, in{' '}
                {inTime(nextUp.start)}
              </span>
            ) : null}
            {dueLater > 0 && (
              <span className="strip-due-count">
                <Icon name="bolt" size={11} /> {dueLater} due today
              </span>
            )}
          </p>
        )}
      </div>
    </Card>
  );
}

const COMING_UP = 4;

/** "Today 7:00 PM", "Fri 9:00 AM", "Fri" for a plan from email. */
function planWhen(plan: EmailPlan, now: number): string {
  const day = plan.date === localIsoDate(new Date(now)) ? 'Today' : new Date(planTime(plan)).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return plan.time ? `${day} ${formatTime(new Date(planTime(plan)).toISOString())}` : day;
}

/** One plan the AI found in email, with Remind me and a link back to the email. */
function PlanRow({ plan, now }: { plan: EmailPlan; now: number }) {
  const [reminded, setReminded] = useState(false);
  const canRemind = typeof window.hub.addReminder === 'function' && planTime(plan) > now;
  return (
    <li className="row plan-row">
      <span className={`plan-kind plan-${plan.kind}`}>{PLAN_LABEL[plan.kind]}</span>
      <span className="row-main">
        {plan.title}
        <span className="muted small">
          {' '}
          · {planWhen(plan, now)} · from {plan.from}
        </span>
      </span>
      {canRemind && (
        <button
          className="tag tag-button"
          disabled={reminded}
          onClick={() => void window.hub.addReminder(`${plan.title} ${plan.date} ${plan.time ?? '09:00'}`).then(() => setReminded(true))}
          title="Get a reminder then"
        >
          {reminded ? 'Set' : 'Remind me'}
        </button>
      )}
      {plan.url && (
        <button className="plan-open" onClick={() => window.hub.openExternal(plan.url!)} title="Open the email" aria-label="Open the email">
          <Icon name="mail" size={13} />
        </button>
      )}
    </li>
  );
}

function ComingUpWidget({ snapshot, now }: WidgetContext) {
  const upcoming = todays(snapshot, now).filter((e) => new Date(e.start).getTime() > now);
  const shown = upcoming.slice(0, COMING_UP);
  // Plans the AI found in email over the next week, that aren't on the calendar.
  const weekAhead = localIsoDate(new Date(now + 7 * 86_400_000));
  const plans = (snapshot.plans ?? []).filter((p) => p.date <= weekAhead).slice(0, 3);
  return (
    <Card title="Coming up" meta={upcoming.length + plans.length}>
      <ul className="rows">
        {shown.length === 0 && plans.length === 0 && <li className="row muted">Nothing else on the calendar today.</li>}
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
        {plans.length > 0 && (
          <li className="plan-head">
            <Icon name="sparkle" size={12} /> Found in your email
          </li>
        )}
        {plans.map((p) => (
          <PlanRow key={p.id} plan={p} now={now} />
        ))}
      </ul>
      {upcoming.length > shown.length && <p className="card-foot muted">+{upcoming.length - shown.length} more today</p>}
    </Card>
  );
}

/** What each widget draws. */
export const WIDGET_VIEWS: Record<WidgetType, (ctx: WidgetContext) => ReactNode> = {
  meetings: tile(MeetingsTile),
  replies: tile(RepliesTile),
  'tasks-open': tile(TasksTile),
  // Made taller, the weather shows the full picture: the sky now and the rain or UV chart.
  weather: (ctx) =>
    ctx.size !== 'xs' && (ctx.rows ?? 1) >= 2 ? (
      <WeatherCard weather={ctx.snapshot.weather} now={ctx.now} onOpenSettings={ctx.onOpenSettings} />
    ) : (
      tiny(WeatherTile, WeatherStat)(ctx)
    ),
  forecast: (ctx) => <WeatherCard weather={ctx.snapshot.weather} now={ctx.now} onOpenSettings={ctx.onOpenSettings} />,
  clock: tiny(ClockTile, ClockWidget),
  now: tiny(NowTile, (ctx) => <NowCard snapshot={ctx.snapshot} now={ctx.now} />),
  timeline: TimelineWidget,
  'coming-up': tiny(ComingUpTile, ComingUpWidget),
  'reply-queue': (ctx) => <EmailCard emails={ctx.snapshot.emails} />,
  habits: tiny(HabitsTile, (ctx) => <SkyCard now={ctx.now} />),
  tasks: (ctx) => <TasksCard tasks={ctx.snapshot.tasks} notes={ctx.snapshot.notes} />,
  briefing: (ctx) => <BriefingCard snapshot={ctx.snapshot} now={ctx.now} onWrapUp={ctx.onWrapUp} onOpenSettings={ctx.onOpenSettings} />,
  date: tile(DateWidget),
  moon: tile(MoonWidget),
  sun: tile(SunWidget),
  radio: tile(RadioWidget),
  year: tile(YearWidget),
  countdown: tile(CountdownWidget),
  note: tile(NoteWidget),
  due: tile(DueWidget),
  month: tile(MonthWidget),
  quote: tile(QuoteWidget),
  grades: tile(GradesWidget),
  reminders: tile(RemindersWidget),
  portfolio: tile(PortfolioWidget),
  christmas: tile(ChristmasWidget),
  groceries: tile(GroceryWidget),
  news: NewsWidget,
  commute: CommuteWidget,
  sports: SportsWidget,
};
