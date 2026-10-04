import { useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hoursMinutes, moonLitPath, moonPhase, sunDay, yearProgress } from '../../shared/almanac';
import { currentEvent, formatDuration, formatTime, isSameDay, localIsoDate, nextEvent } from '../../shared/time';
import { STATIONS } from '../../shared/media';
import type { WidgetSize } from '../../shared/layout';
import type { DashboardSnapshot } from '../../shared/types';
import type { Player } from '../player';
import { Icon } from './Icon';
import { RadioPanel } from './Deck';
import { useHabits } from './SkyCard';
import { WeatherIcon } from './WeatherIcon';

// Tiny square tiles (and the new small widgets). Each one says one thing,
// big, the way a phone's small widgets do.

export interface TileContext {
  snapshot: DashboardSnapshot;
  now: number;
  size: WidgetSize;
  /** How many rows tall, 1 to 4. */
  rows?: number;
  player?: Player;
  onOpenSettings: () => void;
  /** The look picked in the widget editor, for widgets that offer a choice. */
  style?: string;
}

function todays(snapshot: DashboardSnapshot, now: number) {
  return snapshot.events.filter((e) => isSameDay(e.start, new Date(now)) && !e.allDay);
}

/** The square card every tile sits in. */
export function Tile(props: { label?: string; className?: string; style?: CSSProperties; onClick?: () => void; title?: string; children: ReactNode }) {
  const body = (
    <>
      {props.label && <span className="tile-label">{props.label}</span>}
      {props.children}
    </>
  );
  return props.onClick ? (
    <button className={`card tile tile-button ${props.className ?? ''}`} style={props.style} onClick={props.onClick} title={props.title}>
      {body}
    </button>
  ) : (
    <section className={`card tile ${props.className ?? ''}`} style={props.style} title={props.title}>
      {body}
    </section>
  );
}

/** A thin ring that fills clockwise from the top. */
export function Ring({
  value,
  size = 64,
  stroke = 6,
  color = 'var(--accent-2)',
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * Math.min(1, Math.max(0, value))} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="ring-center">{children}</span>
    </span>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/* ---- Tiny versions of existing widgets ---- */

/**
 * Your day as a ring, like a watch face: each meeting is an arc at its time,
 * a dot marks now, and the middle says how many are left.
 */
export function MeetingsTile({ snapshot, now }: TileContext) {
  const today = todays(snapshot, now);
  const left = today.filter((e) => new Date(e.end).getTime() > now);
  const next = nextEvent(today, now);
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  const at = (t: number) => ((t - day.getTime()) / 86_400_000) * 360;
  const point = (deg: number, r: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return `${50 + Math.cos(a) * r} ${50 + Math.sin(a) * r}`;
  };
  const arc = (from: number, to: number, r: number) => `M ${point(from, r)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to, r)}`;
  return (
    <Tile className="tile-accent tile-meetings" title={next ? `Next: ${next.title} at ${formatTime(next.start)}` : 'No more meetings today'}>
      <svg viewBox="0 0 100 100" className="meet-ring" aria-hidden="true">
        <circle cx="50" cy="50" r="40" className="meet-track" />
        {[0, 6, 12, 18].map((h) => (
          <text key={h} className="meet-hour" x={point(h * 15, 30).split(' ')[0]} y={Number(point(h * 15, 30).split(' ')[1]) + 2.5}>
            {h === 0 ? '12a' : h === 12 ? '12p' : h > 12 ? `${h - 12}p` : `${h}a`}
          </text>
        ))}
        {today.map((e) => {
          const from = at(new Date(e.start).getTime());
          const to = Math.max(from + 3, at(new Date(e.end).getTime()));
          return <path key={e.id} d={arc(from, Math.min(to, 359.9), 40)} className={new Date(e.end).getTime() <= now ? 'meet-arc is-past' : 'meet-arc'} />;
        })}
        <circle cx={point(at(now), 40).split(' ')[0]} cy={point(at(now), 40).split(' ')[1]} r="4" className="meet-now" />
      </svg>
      <span className="meet-count">
        <b>{left.length}</b>
        <small>{left.length === 1 ? 'meeting' : 'meetings'}</small>
      </span>
    </Tile>
  );
}

export function RepliesTile({ snapshot }: TileContext) {
  const waiting = snapshot.emails.filter((e) => e.needsReply);
  return (
    <Tile label="Replies">
      <span className="tile-big">{waiting.length}</span>
      {waiting.length ? (
        <span className="tile-faces">
          {waiting.slice(0, 3).map((e) => (
            <i key={e.id} title={e.from.name}>
              {initials(e.from.name)}
            </i>
          ))}
        </span>
      ) : (
        <span className="tile-foot">Inbox calm</span>
      )}
    </Tile>
  );
}

export function TasksTile({ snapshot, now, style }: TileContext) {
  const total = snapshot.tasks.length;
  const open = snapshot.tasks.filter((t) => !t.done);
  const due = open.filter((t) => t.due && t.due.slice(0, 10) <= localIsoDate(new Date(now)));
  const foot = due.length ? `${due.length} due today` : open.length ? 'open' : 'all clear';
  if (style === 'number') {
    return (
      <Tile label="Tasks">
        <span className="tile-big">{open.length}</span>
        <span className="tile-foot">{foot}</span>
      </Tile>
    );
  }
  return (
    <Tile label="Tasks" className="tile-row">
      <Ring value={total ? (total - open.length) / total : 1} size={58} color="var(--green)">
        <b>{open.length}</b>
      </Ring>
      <span className="tile-foot">{foot}</span>
    </Tile>
  );
}

export function WeatherTile({ snapshot }: TileContext) {
  const w = snapshot.weather;
  if (!w) return <Tile label="Weather">Pick a town</Tile>;
  return (
    <Tile className={`tile-weather wx-sky-${w.kind ?? 'cloudy'}`} title={`${w.location}: ${w.condition}`}>
      <WeatherIcon kind={w.kind} size={40} />
      <span className="tile-big">{w.temperatureF}°</span>
      <span className="tile-foot">
        {w.highF}° / {w.lowF}°
      </span>
    </Tile>
  );
}

/** A real clock face, ticking. */
export function ClockTile({ now, style }: TileContext) {
  const d = new Date(now);
  // Digital by default: easy to read at a glance in a tiny square.
  if (style !== 'analog') {
    const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const [clock, ampm] = time.split(' ');
    return (
      <Tile className="tile-clock-digital" title={d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}>
        <span className="tile-big tile-clock-time">{clock}</span>
        {ampm && <span className="tile-clock-ampm">{ampm}</span>}
        <span className="tile-foot">{d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
      </Tile>
    );
  }
  const minute = d.getMinutes() + d.getSeconds() / 60;
  const hour = (d.getHours() % 12) + minute / 60;
  const hand = (deg: number, len: number, cls: string) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return <line className={cls} x1="50" y1="50" x2={50 + Math.cos(a) * len} y2={50 + Math.sin(a) * len} />;
  };
  return (
    <Tile className="tile-clock" title={d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}>
      <svg viewBox="0 0 100 100" className="clock-face" aria-hidden="true">
        <circle cx="50" cy="50" r="46" className="clock-rim" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const inner = i % 3 === 0 ? 34 : 38;
          return (
            <line
              key={i}
              className={i % 3 === 0 ? 'clock-tick is-major' : 'clock-tick'}
              x1={50 + Math.sin(a) * inner}
              y1={50 - Math.cos(a) * inner}
              x2={50 + Math.sin(a) * 41}
              y2={50 - Math.cos(a) * 41}
            />
          );
        })}
        <text x="50" y="31" className="clock-date">
          {d.toLocaleDateString([], { weekday: 'short' }).toUpperCase()} {d.getDate()}
        </text>
        {hand(hour * 30, 22, 'clock-hour')}
        {hand(minute * 6, 33, 'clock-minute')}
        <circle cx="50" cy="50" r="3" className="clock-pin" />
      </svg>
    </Tile>
  );
}

/** Now, squeezed: how far through the meeting you're in, or the time until the next one. */
export function NowTile({ snapshot, now }: TileContext) {
  const today = todays(snapshot, now);
  const current = currentEvent(today, now);
  if (current) {
    const start = new Date(current.start).getTime();
    const end = new Date(current.end).getTime();
    return (
      <Tile label="Now" className="tile-row tile-now" title={current.title}>
        <Ring value={(now - start) / (end - start)} size={58}>
          <b>{formatDuration(end - now)}</b>
        </Ring>
        <span className="tile-foot tile-clip">{current.title}</span>
      </Tile>
    );
  }
  const next = nextEvent(today, now);
  if (next) {
    return (
      <Tile label="Next" className="tile-now" title={next.title}>
        <span className="tile-big tile-big-sm">{formatDuration(new Date(next.start).getTime() - now)}</span>
        <span className="tile-foot tile-clip">{next.title}</span>
      </Tile>
    );
  }
  return (
    <Tile label="Now" className="tile-now">
      <span className="tile-big tile-big-sm">Free</span>
      <span className="tile-foot">Nothing left today</span>
    </Tile>
  );
}

export function ComingUpTile({ snapshot, now }: TileContext) {
  const next = nextEvent(todays(snapshot, now), now);
  if (!next) {
    return (
      <Tile label="Up next">
        <span className="tile-big tile-big-sm">Clear</span>
        <span className="tile-foot">No more today</span>
      </Tile>
    );
  }
  return (
    <Tile
      label="Up next"
      onClick={next.meetingUrl ? () => window.hub.openExternal(next.meetingUrl!) : undefined}
      title={next.meetingUrl ? `Join ${next.title}` : next.title}
    >
      <span className="tile-big tile-big-sm">{formatTime(next.start).replace(/\s?[AP]M$/i, '')}</span>
      <span className="tile-foot tile-clip">{next.title}</span>
      {next.meetingUrl && <span className="tile-pill">Join</span>}
    </Tile>
  );
}

/** Your daily tasks as stars around a ring. */
export function HabitsTile({ now }: TileContext) {
  const { view } = useHabits(now);
  const total = view?.total ?? 0;
  const done = view?.done ?? 0;
  return (
    <Tile className={`tile-habits ${total && done === total ? 'is-complete' : ''}`} title="Daily tasks">
      <span className="habit-ring">
        {(view?.habits ?? []).map((h, i) => {
          const a = (i / Math.max(1, total)) * 2 * Math.PI - Math.PI / 2;
          return (
            <i key={h.id} className={h.done ? 'is-lit' : ''} style={{ left: `${50 + Math.cos(a) * 40}%`, top: `${50 + Math.sin(a) * 40}%` }} title={h.title} />
          );
        })}
        <b>
          {done}/{total}
        </b>
      </span>
    </Tile>
  );
}

/* ---- New widgets ---- */

/** A calendar page; the small one adds this week. */
export function DateWidget({ now, size }: TileContext) {
  const d = new Date(now);
  const month = d.toLocaleDateString([], { month: 'short' }).toUpperCase();
  const weekday = d.toLocaleDateString([], { weekday: 'long' });
  if (size === 'xs') {
    return (
      <Tile className="tile-date">
        <span className="date-month">{month}</span>
        <span className="date-day">{d.getDate()}</span>
        <span className="tile-foot">{weekday}</span>
      </Tile>
    );
  }
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  const { day, days } = yearProgress(d);
  return (
    <Tile className="tile-date tile-wide">
      <span className="date-page">
        <span className="date-month">{month}</span>
        <span className="date-day">{d.getDate()}</span>
      </span>
      <span className="date-side">
        <strong>{weekday}</strong>
        <span className="date-week">
          {week.map((w) => (
            <i key={w.toISOString()} className={w.getDate() === d.getDate() ? 'is-today' : ''}>
              <small>{w.toLocaleDateString([], { weekday: 'narrow' })}</small>
              {w.getDate()}
            </i>
          ))}
        </span>
        <span className="muted small">
          Day {day} of {days}
        </span>
      </span>
    </Tile>
  );
}

function MoonDisc({ cycle, size }: { cycle: number; size: number }) {
  return (
    <svg className="moon-disc" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id="moonlit" cx="40%" cy="35%" r="75%">
          <stop offset="0" stopColor="#fbf8ff" />
          <stop offset="1" stopColor="#c9bcf2" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill="#1a1830" />
      <path d={moonLitPath(cycle, 50, 50, 44)} fill="url(#moonlit)" />
      {/* A few soft craters, only showing on the lit side. */}
      <g fill="rgba(80, 70, 120, 0.18)">
        <circle cx="36" cy="38" r="7" />
        <circle cx="60" cy="62" r="9" />
        <circle cx="62" cy="32" r="4" />
      </g>
    </svg>
  );
}

export function MoonWidget({ now, size }: TileContext) {
  const moon = moonPhase(now);
  const lit = `${Math.round(moon.illumination * 100)}% lit`;
  if (size === 'xs') {
    return (
      <Tile className="tile-moon" title={`${moon.name}, ${lit}`}>
        <MoonDisc cycle={moon.cycle} size={56} />
        <span className="tile-foot">{moon.name}</span>
      </Tile>
    );
  }
  return (
    <Tile className="tile-moon tile-wide">
      <MoonDisc cycle={moon.cycle} size={76} />
      <span className="moon-side">
        <span className="tile-label">Tonight</span>
        <strong>{moon.name}</strong>
        <span className="muted small">{lit}</span>
        <span className="muted small">{moon.daysToFull === 0 ? 'Full tonight' : `Full moon in ${moon.daysToFull} day${moon.daysToFull === 1 ? '' : 's'}`}</span>
      </span>
    </Tile>
  );
}

/** The sun's arc over the day, with the sun where it is now. */
export function SunWidget({ snapshot, now, size, onOpenSettings }: TileContext) {
  const w = snapshot.weather;
  if (!w?.sunrise || !w.sunset) {
    return (
      <Tile label="Sun" onClick={onOpenSettings}>
        <span className="tile-foot">Pick your town in Settings</span>
      </Tile>
    );
  }
  const sun = sunDay(w.sunrise, w.sunset, now);
  // A half ellipse from (8, 46) to (92, 46), peaking at y = 8.
  const angle = Math.PI * (1 - sun.progress);
  const x = 50 + Math.cos(angle) * 42;
  const y = 46 - Math.sin(angle) * 38;
  const up = sun.state === 'day';
  const line = up ? `Sunset ${formatTime(w.sunset)}` : sun.state === 'before' ? `Sunrise ${formatTime(w.sunrise)}` : `Set ${formatTime(w.sunset)}`;
  return (
    <Tile className={`tile-sun ${up ? 'is-up' : 'is-down'} ${size === 'xs' ? '' : 'tile-wide-sun'}`}>
      {size !== 'xs' && (
        <span className="sun-head">
          <span className="tile-label">Sun</span>
          <span className="muted small">{up ? `${hoursMinutes(sun.leftMs)} of light left` : `${hoursMinutes(sun.daylightMs)} of light today`}</span>
        </span>
      )}
      <svg className="sun-arc" viewBox="0 0 100 54" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
        <defs>
          <linearGradient id="sunpath" x1="0" x2="1">
            <stop offset="0" stopColor="#ff9b3d" />
            <stop offset="0.5" stopColor="#ffd84a" />
            <stop offset="1" stopColor="#ff6b7d" />
          </linearGradient>
        </defs>
        <line x1="2" y1="46" x2="98" y2="46" className="sun-horizon" />
        <path d="M8 46 A42 38 0 0 1 92 46" className="sun-path" />
        {up && <path d={`M8 46 A42 38 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} className="sun-done" />}
        <circle cx={x} cy={up ? y : 46} r="5" className="sun-dot" />
      </svg>
      {size === 'xs' ? (
        <span className="tile-foot">{line}</span>
      ) : (
        <span className="sun-times">
          <span>↑ {formatTime(w.sunrise)}</span>
          <span>↓ {formatTime(w.sunset)}</span>
        </span>
      )}
    </Tile>
  );
}

/** Play and pause the radio deck from the page. */
/** Life Hub's radio as a widget: play and pause on the record, and the full deck one click away. */
export function RadioWidget({ player, size }: TileContext) {
  const [open, setOpen] = useState(false);
  if (!player) return <Tile label="Radio">Restart Life Hub</Tile>;
  const station = player.source.kind === 'radio' ? player.source.station : null;
  const color = station?.color ?? STATIONS[0].color;
  const title = player.source.kind === 'track' ? player.source.track.title : (station?.name ?? 'Radio');
  const song = player.playing && player.song ? `${player.song.title}${player.song.artist ? ` · ${player.song.artist}` : ''}` : (station?.vibe ?? 'My music');
  const deck = open && createPortal(<RadioPanel player={player} onClose={() => setOpen(false)} floating />, document.body);
  return (
    <Tile className={`tile-radio ${size === 'xs' ? '' : 'tile-wide'} ${player.playing ? 'is-playing' : ''}`} style={{ ['--deck' as string]: color }}>
      <button className="tile-record" onClick={player.toggle} aria-label={player.playing ? 'Pause' : 'Play'} title={player.playing ? 'Pause' : 'Play'}>
        <span className={`record ${player.playing ? 'is-spinning' : ''}`} style={{ width: size === 'xs' ? 64 : 76, height: size === 'xs' ? 64 : 76 }}>
          <span className="record-label" />
        </span>
        <span className="tile-record-icon">
          <Icon name={player.playing ? 'pause' : 'play'} size={16} />
        </span>
      </button>
      {size === 'xs' ? (
        <button className="tile-foot tile-clip radio-open-link" onClick={() => setOpen(!open)} data-radio-open title="Open the radio">
          {title}
        </button>
      ) : (
        <span className="radio-side">
          <span className="tile-label">{station ? `${station.freq.toFixed(1)} FM` : 'My music'}</span>
          <strong className="tile-clip">{title}</strong>
          <span className="muted small tile-clip">{song}</span>
          <span className="radio-buttons">
            <button className="icon-button" onClick={player.next} aria-label="Next" title="Next">
              <Icon name="next" size={13} />
            </button>
            <button className="icon-button" onClick={() => setOpen(!open)} aria-label="Open the radio" title="Stations and your music" data-radio-open>
              <Icon name="sliders" size={13} />
            </button>
          </span>
        </span>
      )}
      {deck}
    </Tile>
  );
}

export function YearWidget({ now, size }: TileContext) {
  const d = new Date(now);
  const y = yearProgress(d);
  const percent = Math.floor(y.fraction * 100);
  if (size === 'xs') {
    return (
      <Tile className="tile-year">
        <Ring value={y.fraction} size={64}>
          <b>{percent}%</b>
        </Ring>
        <span className="tile-foot">of {y.year}</span>
      </Tile>
    );
  }
  if (size === 's') {
    return (
      <Tile className="tile-year tile-wide-year">
        <span className="year-head">
          <span className="tile-big tile-big-sm">{percent}%</span>
          <span className="muted small">
            of {y.year} · {y.days - y.day} days left
          </span>
        </span>
        <span className="year-months">
          {Array.from({ length: 12 }, (_, m) => {
            const fill = m < d.getMonth() ? 1 : m > d.getMonth() ? 0 : d.getDate() / new Date(y.year, m + 1, 0).getDate();
            return (
              <i key={m} title={new Date(y.year, m, 1).toLocaleDateString([], { month: 'long' })}>
                <b style={{ height: `${fill * 100}%` }} />
                <small>{new Date(y.year, m, 1).toLocaleDateString([], { month: 'narrow' })}</small>
              </i>
            );
          })}
        </span>
      </Tile>
    );
  }
  return (
    <Tile className="tile-year tile-wide-year">
      <span className="year-head">
        <span className="tile-big tile-big-sm">{percent}%</span>
        <span className="muted small">
          Day {y.day} of {y.days} · {y.days - y.day} left in {y.year}
        </span>
      </span>
      <span className="year-dots" style={{ ['--days' as string]: Math.ceil(y.days / 7) }}>
        {Array.from({ length: y.days }, (_, i) => (
          <i key={i} className={i + 1 < y.day ? 'is-past' : i + 1 === y.day ? 'is-today' : ''} />
        ))}
      </span>
    </Tile>
  );
}
