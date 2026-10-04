import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatTime, isSameDay, localIsoDate } from '../../shared/time';
import { PLAN_LABEL, planTime, type EmailPlan } from '../../shared/plans';
import { chipRows, dayTimeline, shortHour } from '../../shared/timeline';
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

/** Roughly how wide a chip is in pixels: the time, the title, and padding. Chips stop at 220px. */
function chipPixels(title: string): number {
  return Math.min(220, 58 + title.length * 6.4);
}

function TimelineWidget({ snapshot, now, onOpenCalendar }: WidgetContext) {
  const t = dayTimeline(snapshot.events, now);
  // All-day events (birthdays, school days off, trips) sit above the strip.
  const allDay = snapshot.events.filter((e) => e.allDay && new Date(e.start).getTime() <= now && new Date(e.end).getTime() > now);
  const next = snapshot.events.find((e) => !e.allDay && new Date(e.start).getTime() > now);
  // Plans found in email for today, with a time, show as dashed chips.
  const todayIso = localIsoDate(new Date(now));
  const emailPlans = (snapshot.plans ?? []).filter((p) => p.date === todayIso && p.time);
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
  const rowsShown = rowCount + ((snapshot.plans ?? []).some((p) => p.date === localIsoDate(new Date(now)) && p.time) ? 1 : 0);
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
      <div className="tl" style={{ ['--rows' as string]: rowsShown }}>
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
          {emailPlans.map((p) => {
            const at = ((planTime(p) - t.start) / (t.end - t.start)) * 100;
            if (at < 0 || at > 100) return null;
            return (
              <span
                key={p.id}
                className="tl-chip tl-chip-email"
                style={{ left: `min(${at}%, calc(100% - 140px))`, ['--row' as string]: rowCount }}
                title={`From ${p.from}'s email: ${p.title}`}
              >
                <i>{formatTime(new Date(planTime(p)).toISOString()).replace(/\s?[AP]M$/i, '')}</i>
                {p.title}
              </span>
            );
          })}
          {t.nowAt !== null && <span className="tl-now" style={{ left: `${t.nowAt}%` }} />}
          {t.items.length === 0 && emailPlans.length === 0 && (
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
