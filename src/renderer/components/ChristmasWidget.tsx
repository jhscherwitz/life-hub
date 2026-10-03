import { useEffect, useState, type CSSProperties } from 'react';
import { LIGHTS, christmas, christmasClock, christmasLine } from '../../shared/christmas';
import { Tile, type TileContext } from './tiles';

// A snowy night with a tree. Its lights come on as Christmas gets closer: a
// few over the year, then one a day through Advent, until the whole tree glows.

const COLORS = ['#ff5f6d', '#ffd76a', '#6ee7ff', '#9dff8a', '#ff9ef0'];

/** Where the bulbs hang: four garlands, wider towards the bottom, drooping a little. */
const BULBS: { x: number; y: number }[] = [
  [36, 10, 3],
  [52, 17, 5],
  [69, 24, 7],
  [87, 31, 9],
].flatMap(([y, half, count]) =>
  Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    return { x: 50 + t * half, y: y + (1 - t * t) * 3.5 };
  }),
);

/** The order bulbs come on in: scattered, not left to right. */
const ORDER = BULBS.map((_, i) => (i * 7) % LIGHTS);

function Tree({ lit, glow }: { lit: number; glow: boolean }) {
  const on = new Set(ORDER.slice(0, lit));
  return (
    <svg className={`xmas-tree ${glow ? 'is-glowing' : ''}`} viewBox="0 0 100 112" aria-hidden="true">
      <defs>
        <linearGradient id="xmas-needles" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2f8f5b" />
          <stop offset="1" stopColor="#14532d" />
        </linearGradient>
      </defs>
      <rect x="45" y="94" width="10" height="12" rx="2" className="xmas-trunk" />
      <path d="M50 16 L68 46 H60 L80 72 H70 L92 98 H8 L30 72 H20 L40 46 H32 Z" fill="url(#xmas-needles)" />
      <path d="M50 16 L68 46 H60 L80 72 H70 L92 98 H8 L30 72 H20 L40 46 H32 Z" className="xmas-tree-edge" />
      {BULBS.map((b, i) => (
        <circle
          key={i}
          cx={b.x}
          cy={b.y}
          r={on.has(i) ? 2.6 : 2}
          className={on.has(i) ? 'xmas-bulb is-on' : 'xmas-bulb'}
          style={{ ['--c' as string]: COLORS[i % COLORS.length], ['--d' as string]: `${(i * 0.37) % 2.4}s` } as CSSProperties}
        />
      ))}
      <path className="xmas-star" d="M50 4 l3.2 6.6 7.2 1 -5.2 5 1.3 7.2 -6.5 -3.4 -6.5 3.4 1.3 -7.2 -5.2 -5 7.2 -1 Z" />
    </svg>
  );
}

function Snow({ count }: { count: number }) {
  return (
    <span className="xmas-snow" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <i
          key={i}
          style={
            {
              left: `${(i * 37) % 100}%`,
              ['--size' as string]: `${2 + (i % 3)}px`,
              ['--dur' as string]: `${6 + ((i * 13) % 7)}s`,
              ['--delay' as string]: `-${(i * 1.7) % 9}s`,
              ['--drift' as string]: `${((i % 5) - 2) * 6}px`,
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

/** Ticks every second, for the live countdown. */
function useSecond(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

export function ChristmasWidget({ now, size }: TileContext) {
  const tick = useSecond(size === 'm');
  const v = christmas(size === 'm' ? tick : now);
  const big = v.isChristmas ? '★' : v.days;
  const unit = v.isChristmas ? 'today!' : v.days === 1 ? 'sleep to go' : 'sleeps to go';

  if (size === 'xs') {
    return (
      <Tile className="tile-xmas" title={`${christmasLine(v)} ${v.lit} of ${LIGHTS} lights on.`}>
        <Snow count={8} />
        <Tree lit={v.lit} glow={v.isChristmas} />
        <span className="xmas-tile-count">
          <b>{big}</b>
          {!v.isChristmas && <small>days</small>}
        </span>
      </Tile>
    );
  }

  return (
    <section className={`card xmas-card xmas-${size} ${v.isChristmas ? 'is-christmas' : ''}`}>
      <Snow count={size === 'm' ? 26 : 16} />
      <span className="xmas-ground" aria-hidden="true" />
      <div className="xmas-info">
        <span className="tile-label">Christmas</span>
        <span className="xmas-days">{big}</span>
        <span className="xmas-unit">{unit}</span>
        {size === 'm' && !v.isChristmas && <span className="xmas-clock">{christmasClock(v.msLeft)}</span>}
        <span className="xmas-line">{christmasLine(v)}</span>
        {size === 'm' && (
          <span className="muted small">
            {v.date.toLocaleDateString([], { weekday: 'long' })} this year · {v.lit} of {LIGHTS} lights on
          </span>
        )}
      </div>
      <Tree lit={v.lit} glow={v.isChristmas} />
    </section>
  );
}
